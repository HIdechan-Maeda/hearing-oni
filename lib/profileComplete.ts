/**
 * 教師はプロフィール必須チェック対象外。学生はニックネーム・所属・学年がすべて入力済みなら完了。
 */
export function isStudentProfileComplete(
  role: string | null | undefined,
  name: string | null | undefined,
  affiliation: string | null | undefined,
  grade: string | null | undefined
): boolean {
  if ((role ?? "").trim() === "teacher") return true;
  const n = (name ?? "").trim();
  const a = (affiliation ?? "").trim();
  const g = (grade ?? "").trim();
  return n.length > 0 && a.length > 0 && g.length > 0;
}
