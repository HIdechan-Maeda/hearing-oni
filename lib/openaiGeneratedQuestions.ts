import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuestionCore } from "@/types";
import { formatChoicesForLog, resolveCorrectChoices } from "@/lib/questionChoices";
import {
  buildQuestionSearchHaystack,
  keywordQueryToDisplay,
  parseKeywordQuery,
  textMatchesKeywordQuery,
  type KeywordQueryAst,
} from "@/lib/keywordQuery";

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
    /**
     * 問題文・選択肢・tags_raw・解説を横断するキーワード式（OR/AND）。
     * 例: `聴覚フィルタ OR 臨界帯域幅`
     */
    contentKeywordQuery: string | null;
    sampleSize: number;
    fetchPool: number;
  }
): Promise<{ examples: ExampleQuestionRow[]; keywordAst: KeywordQueryAst | null; matchedPoolSize: number }> {
  const pool = Math.min(Math.max(opts.fetchPool, 20), 2000);
  const sampleSize = Math.min(Math.max(opts.sampleSize, 1), 24);
  const keywordAst = parseKeywordQuery(opts.contentKeywordQuery);

  let q = admin
    .from("questions_core")
    .select("id,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw")
    .limit(pool);

  const domainHint = opts.domainKey ? DOMAIN_TAG_FILTER[opts.domainKey] : null;
  if (domainHint) {
    q = q.ilike("tags_raw", `%${domainHint}%`);
  }
  // キーワード横断検索があるときは tags_raw 単独の ILIKE に頼らず、取得後に全文照合する
  if (opts.tagsRawContains && !keywordAst) {
    q = q.ilike("tags_raw", `%${opts.tagsRawContains}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(`questions_core の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as ExampleQuestionRow[];
  let usable = rows.filter(
    (r) =>
      isNonEmpty(r.stem) &&
      isNonEmpty(r.choice_a) &&
      isNonEmpty(r.choice_b) &&
      isNonEmpty(r.choice_c) &&
      isNonEmpty(r.choice_d) &&
      isNonEmpty(r.choice_e) &&
      isNonEmpty(r.answer)
  );

  if (opts.tagsRawContains && keywordAst) {
    const tagNeedle = opts.tagsRawContains.toLowerCase();
    usable = usable.filter((r) => (r.tags_raw ?? "").toLowerCase().includes(tagNeedle));
  }

  if (keywordAst) {
    usable = usable.filter((r) => textMatchesKeywordQuery(buildQuestionSearchHaystack(r), keywordAst));
  }

  return {
    examples: fisherYates(usable).slice(0, sampleSize),
    keywordAst,
    matchedPoolSize: usable.length,
  };
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

function normalizedChoiceKey(text: string): string {
  return text.trim().normalize("NFKC").toLowerCase();
}

export function validateGeneratedDraft(d: GeneratedQuestionDraft): { ok: true } | { ok: false; reason: string } {
  if (!isNonEmpty(d.stem)) return { ok: false, reason: "問題文が空です。" };
  for (const key of ["choice_a", "choice_b", "choice_c", "choice_d", "choice_e"] as const) {
    if (!isNonEmpty(d[key])) return { ok: false, reason: `選択肢 ${key} が空です。` };
  }
  const keys = new Set(
    [d.choice_a, d.choice_b, d.choice_c, d.choice_d, d.choice_e].map((t) => normalizedChoiceKey(t))
  );
  if (keys.size !== 5) return { ok: false, reason: "選択肢の内容が重複しています（別の誤答にしてください）。" };
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
    "",
    "【品質ルール（必須）】",
    "- 問題文 stem は一文で主眼が明確に。「次のうち正しいのは」「誤っているのは」など、解答形式が読み取れる終わり方にする。",
    "- 曖昧な括弧だらけ・二重否定の多用・「適切なものを選べ」のみ、のような抽象的すぎる出題は避ける。",
    "- 選択肢 A〜E は内容が互いに重複しないこと（同義の言い換えだけ並べない）。長さは極端に偏らないようにする。",
    "- 誤答肢は「ありがちな誤解」「用語の取り違え」「数値・単位の取り違え」など、学習者が選びそうなリアルな誤答にする。無意味なダミー文は禁止。",
    "- 原則は単一正解。複数正解にする場合は設問文で複数選択が明確に分かる書き方にする。",
    "- 解説 explain は日本語で 2〜5 文。正解の根拠と、代表的な誤答がなぜ誤りかを一言ずつ触れる。断定は根拠のある範囲に留める。",
    "- 数値・閾値・周波数・dB などを出す場合は、一貫した単位と妥当な桁を用いる。",
    "",
    "出力は JSON のみ。次の型に従うこと: { \"questions\": Array<{ \"stem\", \"choice_a\", \"choice_b\", \"choice_c\", \"choice_d\", \"choice_e\", \"answer\", \"explain\", \"tags_raw\" }> }",
    "answer は単一正解なら A〜E のいずれか1文字。複数正解の場合は英大文字をカンマ区切り（例: B,D）。",
    "tags_raw は英語のタグをカンマ区切りで（例: audiometry, screening）。日本語だけにしないこと。",
    "解説 explain は空にしない。",
  ].join("\n");
}

export async function generateQuestionsWithOpenAI(params: {
  examples: ExampleQuestionRow[];
  domainKey: QuestionGenerateDomainKey | null;
  /** 新規問題の tags_raw に寄せてほしい表記（空ならモデル任せ） */
  tagsRawOutputHint: string | null;
  /** 類題の焦点（キーワード式の表示用文字列） */
  topicFocus: string | null;
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

  const topicLine = params.topicFocus?.trim()
    ? [
        `類題の焦点キーワード: ${params.topicFocus.trim()}`,
        "参考例は上記キーワードに関連する既存問題です。同じ概念・用語・仕組みを問う新規の類題を作成すること。",
        "キーワードを無視して無関係な領域へ逸れないこと。ただし参考例の文言をコピーしないこと。",
      ].join("\n")
    : "";

  const tagsOut =
    params.tagsRawOutputHint?.trim() ?
      `新規作成する各問題の tags_raw は、次の表記にできるだけ合わせること（カンマ区切りの英語タグ推奨）: ${params.tagsRawOutputHint.trim()}`
    : "";

  const userPayload = {
    instruction: [
      domainLine,
      topicLine,
      tagsOut,
      `新規問題を ${params.count} 問、指定スキーマの questions 配列で返してください。`,
      "各問はシステム指示の「品質ルール」をすべて満たすこと。参考例より難易度を大きく外さないこと。",
    ]
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
    temperature: 0.42,
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
