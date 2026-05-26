import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { LeaderboardRpcRow } from "@/lib/leaderboardCohort";

type RpcRow = {
  rank: number;
  user_id: string;
  display_name: string;
  total_answered: number;
  total_correct: number;
  accuracy_pct: number;
};

function mapRows(data: unknown): LeaderboardRpcRow[] {
  const list = (data ?? []) as RpcRow[];
  return list.map((r) => ({
    rank: Number(r.rank),
    user_id: r.user_id,
    display_name: r.display_name,
    total_answered: Number(r.total_answered),
    total_correct: Number(r.total_correct),
    accuracy_pct: Number(r.accuracy_pct),
  }));
}

/**
 * service_role で public.leaderboard_* を実行。
 * authenticated には EXECUTE なし（/api/leaderboard 経由のみ）。
 */
export async function fetchLeaderboardCohortForUser(
  callerUserId: string,
  opts: { p_affiliation: string | null; p_grade: string | null }
): Promise<{ rows: LeaderboardRpcRow[]; error: string | null }> {
  const admin = createSupabaseAdmin();
  if (!admin) {
    return { rows: [], error: "server_misconfigured" };
  }

  const { data, error } = await admin.rpc("leaderboard_cohort", {
    p_caller_user_id: callerUserId,
    p_affiliation: opts.p_affiliation,
    p_grade: opts.p_grade,
  });

  if (error) {
    return { rows: [], error: error.message };
  }

  return { rows: mapRows(data), error: null };
}

export async function fetchLeaderboardAffiliationForUser(
  callerUserId: string,
  opts: { p_affiliation: string | null }
): Promise<{ rows: LeaderboardRpcRow[]; error: string | null }> {
  const admin = createSupabaseAdmin();
  if (!admin) {
    return { rows: [], error: "server_misconfigured" };
  }

  const { data, error } = await admin.rpc("leaderboard_affiliation", {
    p_caller_user_id: callerUserId,
    p_affiliation: opts.p_affiliation,
  });

  if (error) {
    return { rows: [], error: error.message };
  }

  return { rows: mapRows(data), error: null };
}
