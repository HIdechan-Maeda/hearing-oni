import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
const LOG_PAGE_SIZE = 1000;
const MAX_LOG_SCAN = 200_000;

type ProfileRow = {
  user_id: string;
  email: string;
  name: string | null;
  role: string | null;
};

function toDateKeyJst(source: string | Date): string {
  const d = new Date(source);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function getDateKeys(days: number): string[] {
  const now = new Date();
  const baseUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const list: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(baseUtc);
    d.setUTCDate(baseUtc.getUTCDate() - i);
    list.push(d.toISOString().slice(0, 10));
  }
  return list;
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anon) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  }

  const authClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: authUser, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authUser.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  }

  const { data: meProfile, error: meProfileError } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", authUser.user.id)
    .maybeSingle<{ role: string | null }>();
  if (meProfileError) {
    return NextResponse.json({ error: "profile_lookup_failed" }, { status: 500 });
  }
  const isTeacher = (meProfile?.role ?? "").trim().toLowerCase() === "teacher";
  if (!isTeacher) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const inputDays = Number(new URL(req.url).searchParams.get("days") ?? "14");
  const days = Number.isFinite(inputDays) ? Math.min(Math.max(Math.trunc(inputDays), 1), 31) : 14;
  const dateKeys = getDateKeys(days);
  const oldestDate = dateKeys[dateKeys.length - 1];

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("user_id,email,name,role")
    .eq("role", "student")
    .order("email", { ascending: true });
  if (profilesError) {
    return NextResponse.json({ error: "profiles_fetch_failed" }, { status: 500 });
  }

  const students = ((profiles ?? []) as ProfileRow[]).map((p) => ({
    userId: p.user_id,
    email: p.email,
    name: p.name,
  }));
  const studentIds = students.map((s) => s.userId);
  if (studentIds.length === 0) {
    return NextResponse.json({
      days: dateKeys,
      summaryByDay: dateKeys.map((date) => ({ date, activeStudents: 0 })),
      students: [],
    });
  }

  const activeMap = new Map<string, Set<string>>();
  const dateKeySet = new Set(dateKeys);
  let offset = 0;
  let scanned = 0;
  while (scanned < MAX_LOG_SCAN) {
    const { data: page, error: logsError } = await admin
      .from("logs")
      .select("user_id,answered_at")
      .in("user_id", studentIds)
      .order("answered_at", { ascending: false })
      .range(offset, offset + LOG_PAGE_SIZE - 1);
    if (logsError) {
      return NextResponse.json({ error: "logs_fetch_failed" }, { status: 500 });
    }
    if (!page?.length) break;

    let reachedOlderThanWindow = false;
    for (const row of page as Array<{ user_id: string; answered_at: string }>) {
      const userId = row.user_id;
      const dateKey = toDateKeyJst(row.answered_at);
      if (dateKey < oldestDate) {
        reachedOlderThanWindow = true;
        continue;
      }
      if (!dateKeySet.has(dateKey)) continue;
      if (!activeMap.has(userId)) activeMap.set(userId, new Set<string>());
      activeMap.get(userId)!.add(dateKey);
    }

    scanned += page.length;
    if (reachedOlderThanWindow) break;
    if (page.length < LOG_PAGE_SIZE) break;
    offset += LOG_PAGE_SIZE;
  }

  const summaryByDay = dateKeys.map((date) => {
    let activeStudents = 0;
    for (const student of students) {
      if (activeMap.get(student.userId)?.has(date)) activeStudents += 1;
    }
    return { date, activeStudents };
  });

  const studentRows = students
    .map((student) => {
      const set = activeMap.get(student.userId) ?? new Set<string>();
      const activeByDay: Record<string, boolean> = {};
      for (const date of dateKeys) activeByDay[date] = set.has(date);
      return {
        ...student,
        activeDays: dateKeys.filter((d) => activeByDay[d]).length,
        activeByDay,
      };
    })
    .sort((a, b) => b.activeDays - a.activeDays || a.email.localeCompare(b.email));

  return NextResponse.json({
    days: dateKeys,
    summaryByDay,
    students: studentRows,
  });
}
