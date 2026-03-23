/**
 * 新規登録（signUp）に使えるメールかどうか。
 * - 常に @hoku-iryo-u.ac.jp を許可
 * - 浪人生など学外メールは NEXT_PUBLIC_RONIN_ALLOWED_EMAILS（カンマ区切り）で個別許可
 *
 * ※ NEXT_PUBLIC_ はビルドに埋め込まれるため、許可リストはフロントの JS から参照可能です。
 *    より厳密に隠したい場合はサーバー側の Route Handler で検証する方式に切り替えてください。
 */
const UNIVERSITY_SUFFIX = "@hoku-iryo-u.ac.jp";

function parseAllowlist(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_RONIN_ALLOWED_EMAILS ?? "";
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts);
}

const roninAllowlist = parseAllowlist();

export function isEmailAllowedForSignUp(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return false;
  if (e.endsWith(UNIVERSITY_SUFFIX)) return true;
  return roninAllowlist.has(e);
}

export function getUniversityEmailSuffix(): string {
  return UNIVERSITY_SUFFIX;
}
