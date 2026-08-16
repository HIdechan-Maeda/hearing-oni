import { NextResponse } from "next/server";
import { requireTeacherFromBearer } from "@/lib/requireTeacherFromBearer";
import { getMissingXEnvKeys, getXEnvPresence } from "@/lib/xThreadPost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 教師向け: X 環境変数が「実行中のデプロイ」に載っているかだけ確認（値は返さない）
 */
export async function GET(req: Request) {
  const auth = await requireTeacherFromBearer(req);
  if (!auth.ok) return auth.response;

  const present = getXEnvPresence();
  const missing = getMissingXEnvKeys();
  return NextResponse.json({
    ok: missing.length === 0,
    present,
    missing,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  });
}
