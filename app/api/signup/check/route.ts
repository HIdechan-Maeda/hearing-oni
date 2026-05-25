import { NextResponse } from "next/server";
import { normalizeSignupEmail } from "@/lib/allowedSignUpEmails";
import { checkSignupEmailAllowed } from "@/lib/signupAllowed";

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

  const result = await checkSignupEmailAllowed(email);

  if (result.error === "server_misconfigured") {
    return NextResponse.json(
      {
        allowed: false,
        error: "server_misconfigured",
        hint: "SUPABASE_SERVICE_ROLE_KEY が未設定です。Vercel の Environment Variables を確認してください。",
      },
      { status: 503 }
    );
  }

  if (result.error === "lookup_failed") {
    return NextResponse.json({ allowed: false, error: "lookup_failed" }, { status: 200 });
  }

  return NextResponse.json({
    allowed: result.allowed,
    source: result.allowed ? result.source : "none",
  });
}
