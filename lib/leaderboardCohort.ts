import type { SupabaseClient } from "@supabase/supabase-js";

/** leaderboard_cohort RPC の1行 */
export type LeaderboardRpcRow = {
  rank: number;
  user_id: string;
  display_name: string;
  total_answered: number;
  total_correct: number;
  accuracy_pct: number;
};

/**
 * 学生: 自分の profiles の所属・学年と同じコホートのランキング一覧。
 * 教師: p_affiliation / p_grade を渡す（teacher/page と同じ）。
 */
export async function fetchLeaderboardCohort(
  supabase: SupabaseClient,
  opts: { p_affiliation: string | null; p_grade: string | null }
): Promise<{ rows: LeaderboardRpcRow[]; error: Error | null }> {
  const { data, error } = await supabase.rpc("leaderboard_cohort", {
    p_affiliation: opts.p_affiliation,
    p_grade: opts.p_grade,
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
