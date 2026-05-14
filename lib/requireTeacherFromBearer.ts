import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";

export type RequireTeacherResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Authorization: Bearer で渡した access_token を検証し、profiles.role === teacher のみ通す。
 */
export async function requireTeacherFromBearer(req: Request): Promise<RequireTeacherResult> {
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

  const admin = createSupabaseAdmin();
  if (!admin) {
    return { ok: false, response: NextResponse.json({ error: "server_misconfigured" }, { status: 503 }) };
  }

  const { data: meProfile, error: meProfileError } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", authUser.user.id)
    .maybeSingle<{ role: string | null }>();
  if (meProfileError) {
    return { ok: false, response: NextResponse.json({ error: "profile_lookup_failed" }, { status: 500 }) };
  }
  const isTeacher = (meProfile?.role ?? "").trim().toLowerCase() === "teacher";
  if (!isTeacher) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { ok: true, userId: authUser.user.id };
}
