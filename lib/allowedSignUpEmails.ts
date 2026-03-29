/**
 * 新規登録（signUp）に使えるメールかどうか。
 * - 学内 @hoku-iryo-u.ac.jp は常に許可（クライアントでも即判定可）
 * - 学外はサーバー API `/api/signup/check` が signup_allowlist（DB）と照合
 * - 移行用: NEXT_PUBLIC_RONIN_ALLOWED_EMAILS（カンマ区切り）も API 側で参照
 *
 * ※ 学外の最終判定は必ず API（service_role）で行う。クライアントのみでは改ざん可能。
 */

const UNIVERSITY_SUFFIX = "@hoku-iryo-u.ac.jp";

export function normalizeSignupEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getUniversityEmailSuffix(): string {
  return UNIVERSITY_SUFFIX;
}

/** 学内ドメインか（フームの即時バリデーション用） */
export function isEmailUniversityDomain(email: string): boolean {
  const e = normalizeSignupEmail(email);
  if (!e.includes("@")) return false;
  return e.endsWith(UNIVERSITY_SUFFIX);
}

function parseLegacyAllowlist(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_RONIN_ALLOWED_EMAILS ?? "";
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts);
}

const legacyAllowlist = parseLegacyAllowlist();

/** サーバー・移行用: 環境変数の個別許可（レガシー） */
export function legacyRoninEmailAllowed(email: string): boolean {
  return legacyAllowlist.has(normalizeSignupEmail(email));
}

/**
 * @deprecated 学外の可否は `/api/signup/check` を使用。学内の即時チェックには isEmailUniversityDomain を使う。
 * 互換のため「学内 OR レガシー env」の同期判定のみ残す。
 */
export function isEmailAllowedForSignUp(email: string): boolean {
  const e = normalizeSignupEmail(email);
  if (!e.includes("@")) return false;
  if (e.endsWith(UNIVERSITY_SUFFIX)) return true;
  return legacyRoninEmailAllowed(e);
}
