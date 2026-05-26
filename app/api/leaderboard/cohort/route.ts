import { NextResponse } from "next/server";
import { fetchLeaderboardCohortForUser } from "@/lib/leaderboardServer";
import { requireAuthFromBearer } from "@/lib/requireAuthFromBearer";

export const runtime = "nodejs";

/**
 * 所属・学年コホートのランキング（private RPC 経由）。
 * 学生: affiliation/grade 省略で自分のプロフィールから判定。
 * 教師: ?affiliation=&grade= で指定。
 */
export async function GET(req: Request) {
  const auth = await requireAuthFromBearer(req);
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const affiliation = (params.get("affiliation") ?? "").trim() || null;
  const grade = (params.get("grade") ?? "").trim() || null;

  const { rows, error } = await fetchLeaderboardCohortForUser(auth.userId, {
    p_affiliation: affiliation,
    p_grade: grade,
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
