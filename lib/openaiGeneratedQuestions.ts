import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuestionCore } from "@/types";
import { formatChoicesForLog, resolveCorrectChoices } from "@/lib/questionChoices";

export type QuestionGenerateDomainKey =
  | "anatomy"
  | "physiology"
  | "acoustics"
  | "psychoacoustics"
  | "audiometry"
  | "screening_audiometry"
  | "hearing_aids"
  | "cochlea_implant"
  | "evoked"
  | "vestibular"
  | "disease"
  | "information_support"
  | "development"
  | "pediatric_hearing_exam"
  | "pediatric_hearing_loss";

/** tags_raw の ILIKE に渡す代表トークン（既存データのタグ表記に寄せる） */
const DOMAIN_TAG_FILTER: Record<QuestionGenerateDomainKey, string> = {
  anatomy: "anatomy",
  physiology: "physiology",
  acoustics: "acoustics",
  psychoacoustics: "psychoacoustics",
  audiometry: "audiometry",
  screening_audiometry: "screening",
  hearing_aids: "hearing_aid",
  cochlea_implant: "implant",
  evoked: "evoked",
  vestibular: "vestibular",
  disease: "disease",
  information_support: "information",
  development: "development",
  pediatric_hearing_exam: "pediatric",
  pediatric_hearing_loss: "pediatric",
};

export type ExampleQuestionRow = Pick<
  QuestionCore,
  "id" | "stem" | "choice_a" | "choice_b" | "choice_c" | "choice_d" | "choice_e" | "answer" | "explain" | "tags_raw"
>;

export type GeneratedQuestionDraft = Pick<
  QuestionCore,
  "stem" | "choice_a" | "choice_b" | "choice_c" | "choice_d" | "choice_e" | "answer" | "explain" | "tags_raw"
>;

const MAX_TAGS_RAW_HINT_LEN = 200;

/**
 * tags_raw の ILIKE 用。% _ \ を除き、長さを制限する（ワイルドカード注入を防ぐ）。
 */
export function sanitizeTagsRawHintInput(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).normalize("NFKC").trim().slice(0, MAX_TAGS_RAW_HINT_LEN);
  if (!s) return null;
  const noWild = s.replace(/[%_\\]/g, " ");
  const collapsed = noWild.replace(/\s+/g, " ").trim();
  return collapsed.length ? collapsed : null;
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isNonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

export async function loadExampleQuestionsForGeneration(
  admin: SupabaseClient,
  opts: {
    domainKey: QuestionGenerateDomainKey | null;
    /** 参考例の tags_raw に含まれる部分文字列（ILIKE）。領域指定と併用すると両方を満たす行のみ。 */
    tagsRawContains: string | null;
    sampleSize: number;
    fetchPool: number;
  }
): Promise<ExampleQuestionRow[]> {
  const pool = Math.min(Math.max(opts.fetchPool, 20), 2000);
  const sampleSize = Math.min(Math.max(opts.sampleSize, 1), 24);

  let q = admin
    .from("questions_core")
    .select("id,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw")
    .limit(pool);

  const domainHint = opts.domainKey ? DOMAIN_TAG_FILTER[opts.domainKey] : null;
  if (domainHint) {
    q = q.ilike("tags_raw", `%${domainHint}%`);
  }
  if (opts.tagsRawContains) {
    q = q.ilike("tags_raw", `%${opts.tagsRawContains}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(`questions_core の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as ExampleQuestionRow[];
  const usable = rows.filter(
    (r) =>
      isNonEmpty(r.stem) &&
      isNonEmpty(r.choice_a) &&
      isNonEmpty(r.choice_b) &&
      isNonEmpty(r.choice_c) &&
      isNonEmpty(r.choice_d) &&
      isNonEmpty(r.choice_e) &&
      isNonEmpty(r.answer)
  );
  return fisherYates(usable).slice(0, sampleSize);
}

function toCoreForValidation(d: GeneratedQuestionDraft): QuestionCore {
  return {
    id: "__validate__",
    stem: d.stem,
    choice_a: d.choice_a,
    choice_b: d.choice_b,
    choice_c: d.choice_c,
    choice_d: d.choice_d,
    choice_e: d.choice_e,
    answer: d.answer,
    explain: d.explain ?? "",
    tags_raw: d.tags_raw ?? null,
  };
}

export function validateGeneratedDraft(d: GeneratedQuestionDraft): { ok: true } | { ok: false; reason: string } {
  if (!isNonEmpty(d.stem)) return { ok: false, reason: "問題文が空です。" };
  for (const key of ["choice_a", "choice_b", "choice_c", "choice_d", "choice_e"] as const) {
    if (!isNonEmpty(d[key])) return { ok: false, reason: `選択肢 ${key} が空です。` };
  }
  if (!isNonEmpty(d.answer)) return { ok: false, reason: "正答が空です。" };
  const core = toCoreForValidation(d);
  const resolved = resolveCorrectChoices(core);
  if (resolved.length === 0) return { ok: false, reason: "正答が A〜E のいずれにも解釈できません。" };
  return { ok: true };
}

export function normalizeAnswerForDb(d: GeneratedQuestionDraft): string {
  const core = toCoreForValidation(d);
  return formatChoicesForLog(resolveCorrectChoices(core));
}

function buildSystemPrompt(): string {
  return [
    "あなたは言語聴覚士・聴覚学の学習用の五択問題を作成するアシスタントです。",
    "ユーザーが提示する「既存問題のJSON」は形式・難易度の参考にしつつ、設問・選択肢・解説はすべてオリジナルで新規に書いてください。",
    "既存の問題文をコピーしたり、特定の教材の記述を再現しないでください。",
    "出力は JSON のみ。次の型に従うこと: { \"questions\": Array<{ \"stem\", \"choice_a\", \"choice_b\", \"choice_c\", \"choice_d\", \"choice_e\", \"answer\", \"explain\", \"tags_raw\" }> }",
    "answer は単一正解なら A〜E のいずれか1文字。複数正解の場合は英大文字をカンマ区切り（例: B,D）。",
    "tags_raw は英語のタグをカンマ区切りで（例: audiometry, screening）。日本語だけにしないこと。",
    "解説 explain は学習に役立つ短い日本語（空にしない）。",
  ].join("\n");
}

export async function generateQuestionsWithOpenAI(params: {
  examples: ExampleQuestionRow[];
  domainKey: QuestionGenerateDomainKey | null;
  /** 新規問題の tags_raw に寄せてほしい表記（空ならモデル任せ） */
  tagsRawOutputHint: string | null;
  count: number;
}): Promise<GeneratedQuestionDraft[]> {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が未設定です。");
  }

  const model = (process.env.OPENAI_QUESTION_MODEL ?? "gpt-4o-mini").trim() || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  const domainLine = params.domainKey
    ? `出題領域のヒント: ${params.domainKey}（tags_raw に関連語を含めること）`
    : "出題領域: 例に近い領域でよいが、tags_raw を一貫して付けること。";

  const tagsOut =
    params.tagsRawOutputHint?.trim() ?
      `新規作成する各問題の tags_raw は、次の表記にできるだけ合わせること（カンマ区切りの英語タグ推奨）: ${params.tagsRawOutputHint.trim()}`
    : "";

  const userPayload = {
    instruction: [domainLine, tagsOut, `新規問題を ${params.count} 問、指定スキーマの questions 配列で返してください。`]
      .filter(Boolean)
      .join("\n"),
    reference_examples_json: params.examples.map((e) => ({
      stem: e.stem,
      choice_a: e.choice_a,
      choice_b: e.choice_b,
      choice_c: e.choice_c,
      choice_d: e.choice_d,
      choice_e: e.choice_e,
      answer: e.answer,
      explain: e.explain,
      tags_raw: e.tags_raw,
    })),
  };

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.55,
    max_completion_tokens: Math.min(
      16000,
      900 + params.count * 900 + Math.min(params.examples.length, 24) * 650
    ),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("OpenAI から空の応答が返りました。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("OpenAI の応答が JSON として解析できませんでした。");
  }

  if (!parsed || typeof parsed !== "object" || !("questions" in parsed)) {
    throw new Error("OpenAI の JSON に questions 配列がありません。");
  }

  const arr = (parsed as { questions: unknown }).questions;
  if (!Array.isArray(arr)) {
    throw new Error("questions が配列ではありません。");
  }

  const out: GeneratedQuestionDraft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const draft: GeneratedQuestionDraft = {
      stem: String(o.stem ?? "").trim(),
      choice_a: String(o.choice_a ?? "").trim(),
      choice_b: String(o.choice_b ?? "").trim(),
      choice_c: String(o.choice_c ?? "").trim(),
      choice_d: String(o.choice_d ?? "").trim(),
      choice_e: String(o.choice_e ?? "").trim(),
      answer: String(o.answer ?? "").trim(),
      explain: String(o.explain ?? "").trim() || null,
      tags_raw: String(o.tags_raw ?? "").trim() || null,
    };
    out.push(draft);
  }

  return out.slice(0, params.count);
}

export function isQuestionGenerateDomainKey(s: string): s is QuestionGenerateDomainKey {
  return s in DOMAIN_TAG_FILTER;
}
