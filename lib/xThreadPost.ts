import { TwitterApi } from "twitter-api-v2";
import type { QuestionCore } from "@/types";
import { resolveCorrectChoices } from "@/lib/questionChoices";

const MAX_WEIGHTED = 270; // 標準280に余裕

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
  let stem = (q.stem ?? "").trim().replace(/\s+/g, " ");
  let body = `${header}\n${stem}\n\n${lines.join("\n")}${footer}`;

  // はみ出す場合は選択肢を短く／問題文を短縮
  if (twitterWeightedLength(body) > MAX_WEIGHTED) {
    const shortChoices = lines.map((line) => truncateToTwitterWeight(line, 40));
    body = `${header}\n${stem}\n\n${shortChoices.join("\n")}${footer}`;
  }
  if (twitterWeightedLength(body) > MAX_WEIGHTED) {
    const budget =
      MAX_WEIGHTED -
      twitterWeightedLength(`${header}\n\n\n${lines.map((l) => truncateToTwitterWeight(l, 36)).join("\n")}${footer}`);
    stem = truncateToTwitterWeight(stem, Math.max(20, budget));
    body = `${header}\n${stem}\n\n${lines.map((l) => truncateToTwitterWeight(l, 36)).join("\n")}${footer}`;
  }
  body = truncateToTwitterWeight(body, MAX_WEIGHTED);

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
  tweet2 = truncateToTwitterWeight(tweet2, MAX_WEIGHTED);

  return {
    questionId: q.id,
    tweet1: body,
    tweet2,
    stem: q.stem ?? "",
    answerLabel,
  };
}

export function createXUserClient(): TwitterApi {
  const appKey = (process.env.X_API_KEY ?? "").trim();
  const appSecret = (process.env.X_API_KEY_SECRET ?? "").trim();
  const accessToken = (process.env.X_ACCESS_TOKEN ?? "").trim();
  const accessSecret = (process.env.X_ACCESS_TOKEN_SECRET ?? "").trim();
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error(
      "X API の環境変数が不足しています（X_API_KEY / X_API_KEY_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET）。"
    );
  }
  return new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
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
