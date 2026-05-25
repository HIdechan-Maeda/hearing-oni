import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { formatSignupErrorMessage } from "@/lib/formatAuthLoginError";
import { normalizeSignupEmail } from "@/lib/allowedSignUpEmails";
import { checkSignupEmailAllowed } from "@/lib/signupAllowed";

export const runtime = "nodejs";

type SignupBody = {
  email?: string;
  password?: string;
  redirectTo?: string;
};

/**
 * 新規登録（サーバー専用）。
 * 許可メール以外は Auth にユーザーを作らない（クライアント直 signUp の迂回防止）。
 */
export async function POST(req: Request) {
  let body: SignupBody;
  try {
    body = (await req.json()) as SignupBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeSignupEmail(typeof body.email === "string" ? body.email : "");
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ ok: false, error: "missing_password" }, { status: 400 });
  }

  const allow = await checkSignupEmailAllowed(email);
  if (allow.error === "server_misconfigured") {
    return NextResponse.json(
      {
        ok: false,
        error: "server_misconfigured",
        hint: "SUPABASE_SERVICE_ROLE_KEY が未設定です。Vercel の Environment Variables を確認してください。",
      },
      { status: 503 }
    );
  }
  if (allow.error === "lookup_failed") {
    return NextResponse.json({ ok: false, error: "lookup_failed" }, { status: 200 });
  }
  if (!allow.allowed) {
    return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 403 });
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_misconfigured",
        hint: "SUPABASE_SERVICE_ROLE_KEY が未設定です。",
      },
      { status: 503 }
    );
  }

  const redirectTo =
    typeof body.redirectTo === "string" && body.redirectTo.startsWith("http")
      ? body.redirectTo.trim()
      : undefined;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });

  if (createError) {
    const msg = formatSignupErrorMessage(createError);
    return NextResponse.json({ ok: false, error: "signup_failed", message: msg }, { status: 200 });
  }

  if (!created.user) {
    return NextResponse.json(
      { ok: false, error: "signup_failed", message: "新規登録に失敗しました。" },
      { status: 200 }
    );
  }

  const { error: resendError } = await admin.auth.resend({
    type: "signup",
    email,
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  });

  if (resendError) {
    console.error("[signup] confirmation resend:", resendError.message);
    return NextResponse.json({
      ok: true,
      warning: "confirmation_email_maybe_failed",
      message:
        "アカウントは作成されましたが、確認メールの送信に失敗した可能性があります。「確認メール再送」を試すか、しばらく待ってから再度お試しください。",
    });
  }

  return NextResponse.json({ ok: true, source: allow.source });
}
