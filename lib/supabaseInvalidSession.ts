import type { SupabaseClient } from "@supabase/supabase-js";

/** Supabase が返す「保存済みリフレッシュトークンがサーバー側と一致しない」系エラー */
export function isInvalidRefreshTokenMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /invalid refresh token|refresh token not found|refresh_token_not_found/i.test(message);
}

/**
 * ブラウザに残ったセッションだけを破棄する（無効な refresh で revoke API が失敗しても使える）。
 * 成功したら呼び出し元で再ログインを促すこと。
 */
export async function signOutLocalIfRefreshTokenInvalid(
  client: SupabaseClient,
  message: string | null | undefined
): Promise<boolean> {
  if (!isInvalidRefreshTokenMessage(message)) return false;
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    try {
      await client.auth.signOut();
    } catch {
      /* 無視 */
    }
  }
  return true;
}
