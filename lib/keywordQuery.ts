/**
 * 教師向けキーワード検索（OR / AND）。
 * 例: `聴覚フィルタ OR 臨界帯域幅` / `マスキング AND 臨界帯域` / `A | B` / `A & B`
 */

const MAX_QUERY_LEN = 400;
const MAX_TERM_LEN = 80;
const MAX_OR_GROUPS = 12;
const MAX_AND_TERMS = 8;

export type KeywordQueryAst = {
  /** OR で結ばれたグループ。各グループ内は AND */
  orGroups: string[][];
  rawNormalized: string;
};

function sanitizeTerm(raw: string): string | null {
  const s = raw
    .normalize("NFKC")
    .trim()
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM_LEN);
  return s.length ? s : null;
}

/**
 * キーワード式を解析する。空なら null。
 * 優先順位: OR で分割 → 各部分を AND で分割。
 * 演算子なし・カンマ区切りのみ → 各項を OR。
 * 演算子もカンマもなし → 全体を1語（部分一致）。
 */
export function parseKeywordQuery(raw: string | null | undefined): KeywordQueryAst | null {
  if (raw == null) return null;
  const normalized = String(raw).normalize("NFKC").trim().slice(0, MAX_QUERY_LEN);
  if (!normalized) return null;

  const hasExplicitOr = /\s+(?:OR|\||または)\s+/i.test(normalized);
  const hasExplicitAnd = /\s+(?:AND|&|かつ)\s+/i.test(normalized);
  const hasComma = /[,，、]/.test(normalized);

  let orParts: string[];
  if (hasExplicitOr) {
    orParts = normalized.split(/\s+(?:OR|\||または)\s+/i);
  } else if (!hasExplicitAnd && hasComma) {
    orParts = normalized.split(/[,，、]+/);
  } else {
    orParts = [normalized];
  }

  const orGroups: string[][] = [];
  for (const part of orParts.slice(0, MAX_OR_GROUPS)) {
    const andRaw = hasExplicitAnd || /\s+(?:AND|&|かつ)\s+/i.test(part)
      ? part.split(/\s+(?:AND|&|かつ)\s+/i)
      : [part];
    const terms: string[] = [];
    for (const t of andRaw.slice(0, MAX_AND_TERMS)) {
      const s = sanitizeTerm(t);
      if (s) terms.push(s);
    }
    if (terms.length) orGroups.push(terms);
  }

  if (orGroups.length === 0) return null;
  return { orGroups, rawNormalized: normalized };
}

export function keywordQueryToDisplay(ast: KeywordQueryAst): string {
  return ast.orGroups.map((g) => g.join(" AND ")).join(" OR ");
}

function haystackIncludesTerm(haystackLower: string, term: string): boolean {
  return haystackLower.includes(term.toLowerCase());
}

/** 1行のテキスト（問題文・選択肢・tags・解説など結合済み）に対する照合 */
export function textMatchesKeywordQuery(haystack: string, ast: KeywordQueryAst): boolean {
  const h = haystack.normalize("NFKC").toLowerCase();
  return ast.orGroups.some((andGroup) => andGroup.every((term) => haystackIncludesTerm(h, term)));
}

export function buildQuestionSearchHaystack(row: {
  stem?: string | null;
  choice_a?: string | null;
  choice_b?: string | null;
  choice_c?: string | null;
  choice_d?: string | null;
  choice_e?: string | null;
  tags_raw?: string | null;
  explain?: string | null;
  topic?: string | null;
}): string {
  return [
    row.stem,
    row.choice_a,
    row.choice_b,
    row.choice_c,
    row.choice_d,
    row.choice_e,
    row.tags_raw,
    row.explain,
    row.topic,
  ]
    .map((x) => (x == null ? "" : String(x)))
    .join("\n");
}
