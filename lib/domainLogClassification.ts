/**
 * logs.tags_raw を領域別に分類する（学生ダッシュボード・教師ダッシュボードで共通）
 */
export type DomainKeyForStats =
  | "hearing_disability"
  | "acoustics"
  | "psychoacoustics";

/** tags_raw に対して、領域ごとに見るべきキーワード（部分一致・小文字化して照合） */
export const DOMAIN_KEYWORDS: Record<DomainKeyForStats, string[]> = {
  acoustics: ["acoustics", "onkyo"],
  psychoacoustics: ["psychoacoustics"],
  hearing_disability: [],
};

function tagsRawMatchesAnyExactToken(tagsRaw: string | null, keywords: string[]): boolean {
  if (!tagsRaw) return false;
  const tokens = tagsRaw
    .split(/[,;，、/|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.normalize("NFKC").trim().toLowerCase());
  return keywords.some((kw) => {
    const w = kw.normalize("NFKC").trim().toLowerCase();
    return tokens.some((t) => t === w);
  });
}

/** tags_raw がどの領域キーワードに該当するか（複数領域タグが付く場合は複数ヒットし得る） */
export function logTagsMatchDomain(tagsRaw: string | null, key: DomainKeyForStats): boolean {
  const isAcousticsOrPsycho =
    tagsRawMatchesAnyExactToken(tagsRaw, DOMAIN_KEYWORDS.acoustics) ||
    tagsRawMatchesAnyExactToken(tagsRaw, DOMAIN_KEYWORDS.psychoacoustics);
  if (key === "acoustics") {
    return isAcousticsOrPsycho;
  }
  if (key === "hearing_disability") {
    return !isAcousticsOrPsycho;
  }
  return tagsRawMatchesAnyExactToken(tagsRaw, DOMAIN_KEYWORDS[key]);
}
