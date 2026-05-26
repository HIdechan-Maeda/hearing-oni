import { NextResponse } from "next/server";
import { fetchLeaderboardAffiliationForUser } from "@/lib/leaderboardServer";
import { requireAuthFromBearer } from "@/lib/requireAuthFromBearer";

export const runtime = "nodejs";

/**
 * 所属内・全学年ランキング（private RPC 経由）。
 */
export async function GET(req: Request) {
  const auth = await requireAuthFromBearer(req);
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const affiliation = (params.get("affiliation") ?? "").trim() || null;

  const { rows, error } = await fetchLeaderboardAffiliationForUser(auth.userId, {
    p_affiliation: affiliation,
  });

  if (error === "server_misconfigured") {
    return NextResponse.json(
      {
        error: "server_misconfigured",
        hint: "SUPABASE_SERVICE_ROLE_KEY が未設定です。",
      },
      { status: 503 }
    );
  }

  if (error) {
    return NextResponse.json({ error: "leaderboard_failed", message: error }, { status: 500 });
  }

  return NextResponse.json({ rows });
}
