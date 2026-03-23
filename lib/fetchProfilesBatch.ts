import { supabase } from "./supabaseClient";

export type ProfileRowLite = {
  user_id: string;
  email: string;
  name: string | null;
  affiliation: string | null;
  grade: string | null;
};

const CHUNK = 80;

/**
 * 教師ダッシュボード用: 多数の user_id を分割して profiles を取得。
 * affiliation/grade カラムが無い DB では name,email のみにフォールバック。
 */
export async function fetchProfilesBatch(userIds: string[]): Promise<{
  profiles: ProfileRowLite[];
  error: string | null;
}> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return { profiles: [], error: null };

  const out: ProfileRowLite[] = [];

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);

    const full = await supabase
      .from("profiles")
      .select("user_id,email,name,affiliation,grade")
      .in("user_id", chunk);

    if (!full.error && full.data) {
      for (const row of full.data) {
        const r = row as ProfileRowLite;
        out.push(r);
      }
      continue;
    }

    const minimal = await supabase
      .from("profiles")
      .select("user_id,email,name")
      .in("user_id", chunk);

    if (minimal.error) {
      return {
        profiles: [],
        error: minimal.error.message + (full.error ? `（詳細: ${full.error.message}）` : ""),
      };
    }
    for (const row of minimal.data ?? []) {
      const r = row as { user_id: string; email: string; name: string | null };
      out.push({
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        affiliation: null,
        grade: null,
      });
    }
  }

  return { profiles: out, error: null };
}
