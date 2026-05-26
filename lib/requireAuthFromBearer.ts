import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export type RequireAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Authorization: Bearer の access_token を検証し、ログイン中ユーザーの userId を返す。
 */
export async function requireAuthFromBearer(req: Request): Promise<RequireAuthResult> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anon) {
    return { ok: false, response: NextResponse.json({ error: "server_misconfigured" }, { status: 503 }) };
  }

  const authClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: authUser, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authUser.user) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  return { ok: true, userId: authUser.user.id };
}
