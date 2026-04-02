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

/**
 * signUp 失敗時（Supabase Auth）のメッセージを日本語化。
 */
export function formatSignupErrorMessage(error: AuthError): string {
  const raw = (error.message ?? "").trim();
  const lower = raw.toLowerCase();

  if (
    lower.includes("user already registered") ||
    lower.includes("already registered") ||
    lower.includes("user already exists") ||
    lower.includes("email address is already") ||
    lower.includes("already exists") ||
    lower.includes("duplicate key") ||
    lower.includes("unique constraint")
  ) {
    return (
      "このメールアドレスは既に登録されています。「ログイン」を試すか、届いた本登録メールのリンクから確認してください。別のメールで登録した可能性もあります。"
    );
  }
  if (lower.includes("password") && (lower.includes("least") || lower.includes("short") || lower.includes("6"))) {
    return "パスワードが短すぎるか、要件を満たしていません。より長いパスワード（英数字を組み合わせる等）を設定してください。";
  }
  if (lower.includes("rate limit") || lower.includes("too many") || lower.includes("over_request_rate")) {
    return "試行回数が多すぎます。しばらく待ってから再度お試しください。";
  }
  if (lower.includes("invalid email") || lower.includes("unable to validate email")) {
    return "メールアドレスの形式が正しくありません。入力ミスがないか確認してください。";
  }
  if (lower.includes("signup") && lower.includes("disabled")) {
    return "現在このアプリでは新規登録を受け付けていません。担当教員に連絡してください。";
  }
  if (lower.includes("database") || lower.includes("internal error")) {
    return "登録処理でサーバーエラーが発生しました。しばらくしてから再度お試しください。繰り返す場合は担当教員に連絡してください。";
  }

  return raw ? `新規登録失敗: ${raw}` : "新規登録に失敗しました。通信環境を確認してください。";
}
