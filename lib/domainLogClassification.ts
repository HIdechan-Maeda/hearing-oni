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
  | "evoked"
  | "vestibular"
  | "disease"
  | "information_support"
  | "development";

/** tags_raw に対して、領域ごとに見るべきキーワード（部分一致・小文字化して照合） */
export const DOMAIN_KEYWORDS: Record<DomainKeyForStats, string[]> = {
  anatomy: ["anatomy"],
  physiology: ["physiology"],
  acoustics: ["acoustics"],
  psychoacoustics: ["psychoacoustics"],
  audiometry: ["audiometry"],
  screening_audiometry: ["screening audiometry"],
  hearing_aids: ["hearing_aids", "hearing_aid"],
  evoked: ["evoked", "abr", "assr"],
  vestibular: ["vestibular"],
  development: ["development"],
  information_support: ["information"],
  disease: ["desease", "disease", "byouki", "病気", "complex", "統合"],
};

/** tags_raw がどの領域キーワードに該当するか（複数領域タグが付く場合は複数ヒットし得る） */
export function logTagsMatchDomain(tagsRaw: string | null, key: DomainKeyForStats): boolean {
  const lower = (tagsRaw ?? "").toLowerCase();
  return DOMAIN_KEYWORDS[key].some((kw) => lower.includes(kw.toLowerCase()));
}
