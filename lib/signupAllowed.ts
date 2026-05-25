import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isEmailUniversityDomain,
  legacyRoninEmailAllowed,
  normalizeSignupEmail,
} from "@/lib/allowedSignUpEmails";

export type SignupAllowSource = "university" | "legacy_env" | "allowlist" | "none";

export type SignupAllowResult =
  | { allowed: true; source: SignupAllowSource }
  | { allowed: false; source: SignupAllowSource; error?: "server_misconfigured" | "lookup_failed" };

/**
 * 新規登録を許可するメールか（学内 / allowlist / レガシー env）。
 * サーバー専用。クライアントだけでは改ざんできない。
 */
export async function checkSignupEmailAllowed(rawEmail: string): Promise<SignupAllowResult> {
  const email = normalizeSignupEmail(rawEmail);
  if (!email || !email.includes("@")) {
    return { allowed: false, source: "none" };
  }

  if (isEmailUniversityDomain(email)) {
    return { allowed: true, source: "university" };
  }

  if (legacyRoninEmailAllowed(email)) {
    return { allowed: true, source: "legacy_env" };
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return { allowed: false, source: "none", error: "server_misconfigured" };
  }

  const { data, error } = await admin.from("signup_allowlist").select("id").eq("email", email).maybeSingle();

  if (error) {
    console.error("[signupAllowed]", error.message);
    return { allowed: false, source: "none", error: "lookup_failed" };
  }

  if (data) {
    return { allowed: true, source: "allowlist" };
  }

  return { allowed: false, source: "none" };
}
