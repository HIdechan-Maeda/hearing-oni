/**
 * logs.tags_raw を領域別に分類する（学生ダッシュボード・教師ダッシュボードで共通）
 */
export type DomainKeyForStats =
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

/** tags_raw に対して、領域ごとに見るべきキーワード（部分一致・小文字化して照合） */
export const DOMAIN_KEYWORDS: Record<DomainKeyForStats, string[]> = {
  anatomy: ["anatomy"],
  physiology: ["physiology"],
  acoustics: ["acoustics"],
  psychoacoustics: ["psychoacoustics"],
  audiometry: ["audiometry"],
  screening_audiometry: ["screening audiometry"],
  hearing_aids: ["hearing_aids", "hearing_aid"],
  cochlea_implant: ["cochlea implant", "cochlear implant", "人工内耳"],
  evoked: ["evoked", "abr", "assr"],
  vestibular: ["vestibular"],
  development: ["development"],
  information_support: ["information"],
  disease: ["desease", "disease", "byouki", "病気", "complex", "統合"],
  /** 出題・ログとも tags はトークン単位（session と同じ分割）で「pediatric hearing」と照合 */
  pediatric_hearing_exam: ["pediatric hearing", "小児聴覚検査"],
  pediatric_hearing_loss: ["pediatric hearing loss"],
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
  if (key === "pediatric_hearing_exam") {
    return tagsRawMatchesAnyExactToken(tagsRaw, DOMAIN_KEYWORDS.pediatric_hearing_exam);
  }
  const lower = (tagsRaw ?? "").toLowerCase();
  return DOMAIN_KEYWORDS[key].some((kw) => lower.includes(kw.toLowerCase()));
}
