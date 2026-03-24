/** 学年（1〜4年・既卒） */
export const GRADE_OPTIONS = ["1年", "2年", "3年", "4年", "既卒"] as const;

/** 所属（北海道医療大学を既定、「その他」は自由記入） */
export const AFFILIATION_PRESETS = ["北海道医療大学", "その他"] as const;

/** DB の grade がプルダウンと違う表記のときに揃える（再取得で空に戻るのを防ぐ） */
export function normalizeGradeFromDb(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  if (GRADE_OPTIONS.includes(t as (typeof GRADE_OPTIONS)[number])) return t;
  const nfkc = t.normalize("NFKC");
  if (GRADE_OPTIONS.includes(nfkc as (typeof GRADE_OPTIONS)[number])) return nfkc;
  const aliases: Record<string, string> = {
    "1": "1年",
    "2": "2年",
    "3": "3年",
    "4": "4年",
    "１年": "1年",
    "２年": "2年",
    "３年": "3年",
    "４年": "4年",
  };
  return aliases[nfkc] ?? aliases[t] ?? "";
}

/** affiliation 列をフォームの select + その他用に分解 */
export function mapAffiliationToForm(aff: string | null | undefined): {
  affiliation: string;
  affiliationOther: string;
} {
  const raw = (aff ?? "").trim();
  if (!raw) return { affiliation: "", affiliationOther: "" };
  if (raw === "北海道医療大学") {
    return { affiliation: "北海道医療大学", affiliationOther: "" };
  }
  return { affiliation: "その他", affiliationOther: raw };
}
