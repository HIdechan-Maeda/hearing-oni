import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { keywordQueryToDisplay } from "@/lib/keywordQuery";
import {
  generateQuestionsWithOpenAI,
  isQuestionGenerateDomainKey,
  loadExampleQuestionsForGeneration,
  normalizeAnswerForDb,
  sanitizeTagsRawHintInput,
  validateGeneratedDraft,
  type GeneratedQuestionDraft,
  type QuestionGenerateDomainKey,
} from "@/lib/openaiGeneratedQuestions";
import { requireTeacherFromBearer } from "@/lib/requireTeacherFromBearer";

export const runtime = "nodejs";

type GenerateBody = {
  domainKey?: string | null;
  /** 参考例の tags_raw に含まれる文字列（部分一致） */
  tagsRawContains?: string | null;
  /** 生成する問題の tags_raw の目安。省略時は tagsRawContains があればそれを流用 */
  tagsRawOutputHint?: string | null;
  /**
   * 問題文・選択肢・tags・解説を横断するキーワード（OR/AND 可）
   * 例: 聴覚フィルタ OR 臨界帯域幅
   */
  contentKeywords?: string | null;
  count?: number;
  exampleCount?: number;
  /** questions_core から読む最大行数（その中からシャッフルして参考例を選ぶ） */
  fetchPool?: number;
  /** @deprecated 保存は /api/teacher/questions/save を使う。無視される。 */
  persist?: boolean;
};

const MAX_CONTENT_KEYWORDS_LEN = 400;

function sanitizeContentKeywordsInput(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).normalize("NFKC").trim().slice(0, MAX_CONTENT_KEYWORDS_LEN);
  return s.length ? s : null;
}

/**
 * 問題を生成してプレビュー用に返す（DB には保存しない）。
 * 保存は POST /api/teacher/questions/save で、確認後に行う。
 */
export async function POST(req: Request) {
  const authResult = await requireTeacherFromBearer(req);
  if (!authResult.ok) return authResult.response;

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawDomain = body.domainKey != null ? String(body.domainKey).trim() : "";
  const domainKey: QuestionGenerateDomainKey | null =
    rawDomain.length === 0 ? null : isQuestionGenerateDomainKey(rawDomain) ? rawDomain : null;
  if (rawDomain.length > 0 && domainKey === null) {
    return NextResponse.json({ error: "unknown_domain_key" }, { status: 400 });
  }

  const count = Math.min(Math.max(Number(body.count ?? 1), 1), 8);
  const exampleCount = Math.min(Math.max(Number(body.exampleCount ?? 4), 1), 20);
  const fetchPool = Math.min(Math.max(Number(body.fetchPool ?? 1200), 50), 2000);

  const tagsRawContains = sanitizeTagsRawHintInput(body.tagsRawContains ?? null);
  const tagsRawOutputExplicit = sanitizeTagsRawHintInput(body.tagsRawOutputHint ?? null);
  const contentKeywords = sanitizeContentKeywordsInput(body.contentKeywords ?? null);
  const tagsRawOutputHint = tagsRawOutputExplicit ?? tagsRawContains ?? contentKeywords;

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  }

  let examples;
  let keywordAst;
  let matchedPoolSize = 0;
  try {
    const loaded = await loadExampleQuestionsForGeneration(admin, {
      domainKey,
      tagsRawContains,
      contentKeywordQuery: contentKeywords,
      sampleSize: exampleCount,
      fetchPool,
    });
    examples = loaded.examples;
    keywordAst = loaded.keywordAst;
    matchedPoolSize = loaded.matchedPoolSize;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "examples_fetch_failed", message: msg }, { status: 500 });
  }

  if (examples.length === 0) {
    return NextResponse.json(
      {
        error: "no_examples",
        message:
          "参考にする既存問題が取得できませんでした。keywords（OR/AND）・領域・tags_raw・参照プールを見直してください。" +
          (contentKeywords ? ` キーワード「${contentKeywords}」に一致する行がプール内にありません。` : ""),
        matchedPoolSize,
        keywordParsed: keywordAst ? keywordQueryToDisplay(keywordAst) : null,
      },
      { status: 400 }
    );
  }

  const topicFocus = keywordAst ? keywordQueryToDisplay(keywordAst) : contentKeywords;

  let drafts: GeneratedQuestionDraft[];
  try {
    drafts = await generateQuestionsWithOpenAI({
      examples,
      domainKey,
      tagsRawOutputHint,
      topicFocus,
      count,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "openai_failed", message: msg }, { status: 502 });
  }

  const validated: Array<{
    draft: GeneratedQuestionDraft;
    valid: boolean;
    reason?: string;
    idSuggested?: string;
  }> = [];

  for (const draft of drafts) {
    const v = validateGeneratedDraft(draft);
    if (!v.ok) {
      validated.push({ draft, valid: false, reason: v.reason });
      continue;
    }
    // プレビュー用の仮 ID（保存時に再採番）
    const idSuggested = `ai-${randomUUID()}`;
    // answer 正規化は保存時に再実行するが、プレビューでも見やすいよう draft.answer を揃える
    const normalized = normalizeAnswerForDb(draft);
    validated.push({
      draft: { ...draft, answer: normalized },
      valid: true,
      idSuggested,
    });
  }

  return NextResponse.json({
    examplesUsed: examples.map((e) => ({
      id: e.id,
      tags_raw: e.tags_raw,
      stem: (e.stem ?? "").slice(0, 120),
    })),
    matchedPoolSize,
    keywordParsed: keywordAst ? keywordQueryToDisplay(keywordAst) : null,
    results: validated,
    persisted: false,
  });
}
