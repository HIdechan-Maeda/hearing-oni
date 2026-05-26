import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardRpcRow } from "./leaderboardCohort";
import { leaderboardApiFetch } from "./leaderboardApiClient";

/**
 * 学生: 自分の profiles の所属と同じ所属の全学年ランキング。
 * 教師: p_affiliation を渡す。
 */
export async function fetchLeaderboardAffiliation(
  supabase: SupabaseClient,
  opts: { p_affiliation: string | null }
): Promise<{ rows: LeaderboardRpcRow[]; error: Error | null }> {
  const params = new URLSearchParams();
  if (opts.p_affiliation) params.set("affiliation", opts.p_affiliation);
  const q = params.toString();
  const path = q ? `/api/leaderboard/affiliation?${q}` : "/api/leaderboard/affiliation";

  const { json, error } = await leaderboardApiFetch(supabase, path);
  if (error) {
    return { rows: [], error };
  }

  const rows = (json as { rows?: LeaderboardRpcRow[] }).rows ?? [];
  return { rows, error: null };
}
