import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isEmailUniversityDomain,
  normalizeSignupEmail,
  legacyRoninEmailAllowed,
} from "@/lib/allowedSignUpEmails";

export const runtime = "nodejs";

/**
 * 新規登録（signUp）前に呼ぶ。学内ドメイン or signup_allowlist or レガシー env。
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ allowed: false, error: "invalid_json" }, { status: 400 });
  }
  const raw = typeof (body as { email?: unknown }).email === "string" ? (body as { email: string }).email : "";
  const email = normalizeSignupEmail(raw);
  if (!email || !email.includes("@")) {
    return NextResponse.json({ allowed: false }, { status: 200 });
  }

  if (isEmailUniversityDomain(email)) {
    return NextResponse.json({ allowed: true, source: "university" });
  }

  if (legacyRoninEmailAllowed(email)) {
    return NextResponse.json({ allowed: true, source: "legacy_env" });
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      {
        allowed: false,
        error: "server_misconfigured",
        hint: "SUPABASE_SERVICE_ROLE_KEY が未設定です。Vercel の Environment Variables を確認してください。",
      },
      { status: 503 }
    );
  }

  const { data, error } = await admin.from("signup_allowlist").select("id").eq("email", email).maybeSingle();

  if (error) {
    console.error("[signup/check]", error.message);
    return NextResponse.json({ allowed: false, error: "lookup_failed" }, { status: 200 });
  }

  return NextResponse.json({ allowed: !!data, source: data ? "allowlist" : "none" });
}
