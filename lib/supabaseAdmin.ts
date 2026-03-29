import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * サーバー専用（service_role）。RLS をバイパスして signup_allowlist を照会する。
 * SUPABASE_SERVICE_ROLE_KEY はクライアントに出さないこと。
 */
export function createSupabaseAdmin(): SupabaseClient | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
