/** 学年プルダウン（1〜4年・既卒） */
export const GRADE_OPTIONS = ["1年", "2年", "3年", "4年", "既卒"] as const;

/**
 * 所属プルダウン
 * - 北海道医療大学
 * - その他 … 学外大学等は自由記入欄へ
 */
export const AFFILIATION_PRESETS = ["北海道医療大学", "その他"] as const;

/**
 * DB の grade がプルダウンと違う表記のときに揃える（再取得で空に戻るのを防ぐ）。
 * DB 側のランキング集計は data/SUPABASE_leaderboard_cohort.sql の normalize_grade_for_cohort と整合させること。
 */
export function normalizeGradeFromDb(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  if (GRADE_OPTIONS.includes(t as (typeof GRADE_OPTIONS)[number])) return t;
  const nfkc = t.normalize("NFKC");
  if (GRADE_OPTIONS.includes(nfkc as (typeof GRADE_OPTIONS)[number])) return nfkc;
  const yearStudent = nfkc.match(/^([1-4])年生$/);
  if (yearStudent) return `${yearStudent[1]}年` as (typeof GRADE_OPTIONS)[number];
  const aliases: Record<string, string> = {
    "1": "1年",
    "2": "2年",
    "3": "3年",
    "4": "4年",
    "１年": "1年",
    "２年": "2年",
    "３年": "3年",
    "４年": "4年",
    卒業: "既卒",
    卒業生: "既卒",
    卒業済: "既卒",
    graduate: "既卒",
    "graduate student": "既卒",
  };
  const aliased = aliases[nfkc] ?? aliases[t];
  if (aliased && GRADE_OPTIONS.includes(aliased as (typeof GRADE_OPTIONS)[number])) return aliased;
  return aliased ?? "";
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
  // DB に「その他」だけ保存されている場合（自由記入なし）
  if (raw === "その他") {
    return { affiliation: "その他", affiliationOther: "" };
  }
  return { affiliation: "その他", affiliationOther: raw };
}
