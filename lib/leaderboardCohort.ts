import type { SupabaseClient } from "@supabase/supabase-js";
import { leaderboardApiFetch } from "./leaderboardApiClient";

/** ランキング API の1行 */
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
  const params = new URLSearchParams();
  if (opts.p_affiliation) params.set("affiliation", opts.p_affiliation);
  if (opts.p_grade) params.set("grade", opts.p_grade);
  const q = params.toString();
  const path = q ? `/api/leaderboard/cohort?${q}` : "/api/leaderboard/cohort";

  const { json, error } = await leaderboardApiFetch(supabase, path);
  if (error) {
    return { rows: [], error };
  }

  const rows = (json as { rows?: LeaderboardRpcRow[] }).rows ?? [];
  return { rows, error: null };
}
