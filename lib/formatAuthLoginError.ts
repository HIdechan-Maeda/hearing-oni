import type { AuthError } from "@supabase/supabase-js";

/**
 * signInWithPassword 失敗時に、利用者向けの案内を付けた日本語メッセージにする。
 */
export function formatLoginErrorMessage(error: AuthError): string {
  const raw = (error.message ?? "").trim();
  const lower = raw.toLowerCase();

  if (lower.includes("email not confirmed")) {
    return (
      "メールアドレスの確認がまだです。新規登録時に届いたメール内のリンクを開いて本登録を完了してから、再度ログインしてください。迷惑メールフォルダも確認してください。"
    );
  }
  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid credentials") ||
    (lower.includes("invalid") && lower.includes("password"))
  ) {
    return (
      "メールアドレスまたはパスワードが一致しません。入力ミスがないか、大文字・小文字を確認してください。まだ本登録（メール内リンクの確認）をしていない場合は、先にメールから本登録を完了してください。"
    );
  }
  if (lower.includes("too many requests") || lower.includes("rate limit") || lower.includes("over_request_rate")) {
    return "試行回数が多すぎます。しばらく待ってから再度お試しください。";
  }
  if (lower.includes("user not found") || lower.includes("user does not exist")) {
    return "このメールアドレスは登録されていない可能性があります。新規登録を行ったか、別のメールで登録していないか確認してください。";
  }

  return raw ? `ログイン失敗: ${raw}` : "ログインに失敗しました。通信環境を確認してください。";
}
