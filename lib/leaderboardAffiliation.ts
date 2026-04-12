import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardRpcRow } from "./leaderboardCohort";

/**
 * 学生: 自分の profiles の所属と同じ所属の全学年ランキング。
 * 教師: p_affiliation を渡す（任意で教師ダッシュボード等から利用）。
 */
export async function fetchLeaderboardAffiliation(
  supabase: SupabaseClient,
  opts: { p_affiliation: string | null }
): Promise<{ rows: LeaderboardRpcRow[]; error: Error | null }> {
  const { data, error } = await supabase.rpc("leaderboard_affiliation", {
    p_affiliation: opts.p_affiliation,
  });
  if (error) {
    return { rows: [], error };
  }
  const list = (data ?? []) as Array<{
    rank: number;
    user_id: string;
    display_name: string;
    total_answered: number;
    total_correct: number;
    accuracy_pct: number;
  }>;
  const rows: LeaderboardRpcRow[] = list.map((r) => ({
    rank: Number(r.rank),
    user_id: r.user_id,
    display_name: r.display_name,
    total_answered: Number(r.total_answered),
    total_correct: Number(r.total_correct),
    accuracy_pct: Number(r.accuracy_pct),
  }));
  return { rows, error: null };
}
