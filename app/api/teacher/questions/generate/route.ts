import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  generateQuestionsWithOpenAI,
  isQuestionGenerateDomainKey,
  loadExampleQuestionsForGeneration,
  normalizeAnswerForDb,
  validateGeneratedDraft,
  type GeneratedQuestionDraft,
  type QuestionGenerateDomainKey,
} from "@/lib/openaiGeneratedQuestions";
import { requireTeacherFromBearer } from "@/lib/requireTeacherFromBearer";

export const runtime = "nodejs";

type GenerateBody = {
  domainKey?: string | null;
  count?: number;
  exampleCount?: number;
  persist?: boolean;
};

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
  const exampleCount = Math.min(Math.max(Number(body.exampleCount ?? 4), 1), 10);
  const persist = Boolean(body.persist);

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  }

  let examples;
  try {
    examples = await loadExampleQuestionsForGeneration(admin, {
      domainKey,
      sampleSize: exampleCount,
      fetchPool: 400,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "examples_fetch_failed", message: msg }, { status: 500 });
  }

  if (examples.length === 0) {
    return NextResponse.json(
      {
        error: "no_examples",
        message:
          "参考にする既存問題が取得できませんでした。questions_core にデータがあるか、領域指定なら tags_raw が一致する行があるか確認してください。",
      },
      { status: 400 }
    );
  }

  let drafts: GeneratedQuestionDraft[];
  try {
    drafts = await generateQuestionsWithOpenAI({ examples, domainKey, count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "openai_failed", message: msg }, { status: 502 });
  }

  type RowOut = {
    id: string;
    stem: string;
    choice_a: string;
    choice_b: string;
    choice_c: string;
    choice_d: string;
    choice_e: string;
    answer: string;
    explain: string | null;
    tags_raw: string | null;
  };

  const validated: Array<{ draft: GeneratedQuestionDraft; valid: boolean; reason?: string; row?: RowOut }> = [];

  for (const draft of drafts) {
    const v = validateGeneratedDraft(draft);
    if (!v.ok) {
      validated.push({ draft, valid: false, reason: v.reason });
      continue;
    }
    const answer = normalizeAnswerForDb(draft);
    const id = `ai-${randomUUID()}`;
    validated.push({
      draft,
      valid: true,
      row: {
        id,
        stem: draft.stem.trim(),
        choice_a: draft.choice_a.trim(),
        choice_b: draft.choice_b.trim(),
        choice_c: draft.choice_c.trim(),
        choice_d: draft.choice_d.trim(),
        choice_e: draft.choice_e.trim(),
        answer,
        explain: draft.explain?.trim() || null,
        tags_raw: draft.tags_raw?.trim() || null,
      },
    });
  }

  const insertedIds: string[] = [];

  if (persist) {
    const rows = validated.map((x) => x.row).filter((r): r is RowOut => Boolean(r));
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "nothing_to_insert",
          examplesUsed: examples.map((e) => ({ id: e.id, tags_raw: e.tags_raw })),
          results: validated.map(({ draft, valid, reason }) => ({ draft, valid, reason })),
        },
        { status: 400 }
      );
    }

    const { error: insErr } = await admin.from("questions_core").insert(rows);
    if (insErr) {
      return NextResponse.json(
        {
          error: "insert_failed",
          message: insErr.message,
          examplesUsed: examples.map((e) => ({ id: e.id, tags_raw: e.tags_raw })),
          results: validated.map(({ draft, valid, reason, row }) => ({
            draft,
            valid,
            reason,
            idSuggested: row?.id,
          })),
        },
        { status: 500 }
      );
    }
    for (const r of rows) insertedIds.push(r.id);
  }

  return NextResponse.json({
    examplesUsed: examples.map((e) => ({ id: e.id, tags_raw: e.tags_raw })),
    results: validated.map(({ draft, valid, reason, row }) => ({
      draft,
      valid,
      reason,
      idSuggested: row?.id,
    })),
    insertedIds,
    persisted: persist && insertedIds.length > 0,
  });
}
