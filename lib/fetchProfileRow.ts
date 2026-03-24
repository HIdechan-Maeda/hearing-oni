import { supabase } from "./supabaseClient";
import { formatSupabaseError } from "./supabasePolicyHint";

export type ProfileRow = {
  name: string | null;
  role: string | null;
  email: string | null;
  affiliation: string | null;
  grade: string | null;
};

/**
 * affiliation / grade カラムが未追加の Supabase でも動くよう、
 * フル SELECT に失敗したら name,role,email のみで再取得する。
 */
export async function fetchProfileRow(
  userId: string
): Promise<{ data: ProfileRow | null; error: Error | null }> {
  const full = await supabase
    .from("profiles")
    .select("name,role,email,affiliation,grade")
    .eq("user_id", userId)
    .maybeSingle();

  if (!full.error && full.data) {
    return { data: full.data as ProfileRow, error: null };
  }

  const minimal = await supabase
    .from("profiles")
    .select("name,role,email")
    .eq("user_id", userId)
    .maybeSingle();

  if (minimal.error) {
    return { data: null, error: new Error(formatSupabaseError(minimal.error)) };
  }
  if (!minimal.data) {
    return {
      data: null,
      error: full.error ? new Error(formatSupabaseError(full.error)) : null,
    };
  }
  return {
    data: {
      ...(minimal.data as { name: string | null; role: string | null; email: string | null }),
      affiliation: null,
      grade: null,
    },
    error: null,
  };
}
