import { TwitterApi } from "twitter-api-v2";
import type { QuestionCore } from "@/types";
import { resolveCorrectChoices } from "@/lib/questionChoices";

const MAX_WEIGHTED = 270; // 標準280に余裕

/** 投稿2末尾に付けるハッシュタグ（半角 #） */
const TWEET2_HASHTAGS = "\n\n#言語聴覚士 #国試対策";

export type XThreadPreview = {
  questionId: string;
  tweet1: string;
  tweet2: string;
  stem: string;
  answerLabel: string;
};

function choiceText(q: QuestionCore, letter: string): string {
  switch (letter) {
    case "A":
      return q.choice_a ?? "";
    case "B":
      return q.choice_b ?? "";
    case "C":
      return q.choice_c ?? "";
    case "D":
      return q.choice_d ?? "";
    case "E":
      return q.choice_e ?? "";
    default:
      return "";
  }
}

/** X の文字数ウェイト概算（CJK 等はほぼ2） */
export function twitterWeightedLength(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0x7f ? 2 : 1;
  }
  return w;
}

export function truncateToTwitterWeight(text: string, maxWeight: number): string {
  if (twitterWeightedLength(text) <= maxWeight) return text;
  let out = "";
  let w = 0;
  const ellipsis = "…";
  const ellipsisW = twitterWeightedLength(ellipsis);
  for (const ch of text) {
    const cw = (ch.codePointAt(0) ?? 0) > 0x7f ? 2 : 1;
    if (w + cw + ellipsisW > maxWeight) break;
    out += ch;
    w += cw;
  }
  return out + ellipsis;
}

function letterToNum(letter: string): string {
  const map: Record<string, string> = { A: "1", B: "2", C: "3", D: "4", E: "5" };
  return map[letter.toUpperCase()] ?? letter;
}

/**
 * スレッド用テキストを組み立てる。
 * 1投稿目: 問題+選択肢（正答なし）
 * 2投稿目: 正答+解説
 */
export function buildQuestionThreadTexts(q: QuestionCore): XThreadPreview {
  const letters = ["A", "B", "C", "D", "E"] as const;
  const lines: string[] = [];
  for (let i = 0; i < letters.length; i += 1) {
    const t = (choiceText(q, letters[i]) ?? "").trim();
    if (!t) continue;
    lines.push(`${i + 1}. ${t}`);
  }

  const header = "【聴覚の鬼】";
  const footer = "\n\n正答・解説はこのスレッドの続き👇";
  const choicesText = lines.join("\n");
  let stem = (q.stem ?? "").trim().replace(/\s+/g, " ");

  const buildBody = (s: string) =>
    s
      ? `${header}\n${s}\n\n${choicesText}${footer}`
      : `${header}\n\n${choicesText}${footer}`;

  let body = buildBody(stem);

  // はみ出す場合は「選択肢は残し、問題文を先に短縮」する
  if (twitterWeightedLength(body) > MAX_WEIGHTED) {
    const overhead = twitterWeightedLength(buildBody(""));
    const stemBudget = MAX_WEIGHTED - overhead;
    stem = stemBudget > 0 ? truncateToTwitterWeight(stem, stemBudget) : "";
    body = buildBody(stem);
  }
  // 選択肢自体が長すぎて収まらない場合のみ、最終手段で全体を切る
  if (twitterWeightedLength(body) > MAX_WEIGHTED) {
    body = truncateToTwitterWeight(body, MAX_WEIGHTED);
  }

  const correct = resolveCorrectChoices(q);
  const answerParts = correct.map((L) => {
    const n = letterToNum(L);
    const t = (choiceText(q, L) ?? "").trim();
    return t ? `${n}. ${t}` : n;
  });
  const answerLabel = answerParts.join(" / ") || String(q.answer ?? "");
  let explain = (q.explain ?? "").trim().replace(/\s+/g, " ");
  let tweet2 = `正答: ${answerLabel}`;
  if (explain) {
    tweet2 += `\n\n解説: ${explain}`;
  }
  const tagWeight = twitterWeightedLength(TWEET2_HASHTAGS);
  tweet2 = truncateToTwitterWeight(tweet2, Math.max(20, MAX_WEIGHTED - tagWeight));
  tweet2 += TWEET2_HASHTAGS;

  return {
    questionId: q.id,
    tweet1: body,
    tweet2,
    stem: q.stem ?? "",
    answerLabel,
  };
}

const X_ENV_KEYS = [
  "X_API_KEY",
  "X_API_KEY_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
] as const;

/** 実行時参照（静的置換を避ける）。値はログに出さない。 */
function readXEnv(name: (typeof X_ENV_KEYS)[number]): string {
  const env = process.env;
  return String(env[name] ?? "").trim();
}

/** 値は返さない。どれが空かだけ返す（本番トラブルシュート用） */
export function getMissingXEnvKeys(): string[] {
  return X_ENV_KEYS.filter((k) => !readXEnv(k));
}

export function getXEnvPresence(): Record<(typeof X_ENV_KEYS)[number], boolean> {
  return {
    X_API_KEY: Boolean(readXEnv("X_API_KEY")),
    X_API_KEY_SECRET: Boolean(readXEnv("X_API_KEY_SECRET")),
    X_ACCESS_TOKEN: Boolean(readXEnv("X_ACCESS_TOKEN")),
    X_ACCESS_TOKEN_SECRET: Boolean(readXEnv("X_ACCESS_TOKEN_SECRET")),
  };
}

export function createXUserClient(): TwitterApi {
  const missing = getMissingXEnvKeys();
  if (missing.length > 0) {
    throw new Error(
      `X API の環境変数が不足しています（空または未設定: ${missing.join(", ")}）。Vercel で Production に保存したあと、Deployments → Redeploy（Build Cache なし）が必要です。`
    );
  }
  return new TwitterApi({
    appKey: readXEnv("X_API_KEY"),
    appSecret: readXEnv("X_API_KEY_SECRET"),
    accessToken: readXEnv("X_ACCESS_TOKEN"),
    accessSecret: readXEnv("X_ACCESS_TOKEN_SECRET"),
  });
}

export async function postQuestionThread(preview: XThreadPreview): Promise<{
  tweet1Id: string;
  tweet2Id: string;
}> {
  const client = createXUserClient();
  const rw = client.readWrite;
  const t1 = await rw.v2.tweet({ text: preview.tweet1 });
  const id1 = t1.data.id;
  const t2 = await rw.v2.tweet({
    text: preview.tweet2,
    reply: { in_reply_to_tweet_id: id1 },
  });
  return { tweet1Id: id1, tweet2Id: t2.data.id };
}
