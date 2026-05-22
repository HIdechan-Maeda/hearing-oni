import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GRADE_OPTIONS, normalizeGradeFromDb } from "@/lib/profileFieldOptions";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
const LOG_PAGE_SIZE = 1000;
const MAX_LOG_SCAN = 200_000;
/** プロフィールに学年が無い受講生の表示用ラベル */
const GRADE_UNSET_LABEL = "(学年未設定)";

type ProfileRow = {
  user_id: string;
  email: string;
  name: string | null;
  role: string | null;
  affiliation?: string | null;
  grade?: string | null;
};

type StudentBase = {
  userId: string;
  email: string;
  name: string | null;
  affiliation: string | null;
  grade: string | null;
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

function buildSummaryByDay(
  cohort: StudentBase[],
  dateKeys: string[],
  activeMap: Map<string, Set<string>>
): Array<{ date: string; activeStudents: number; totalStudents: number }> {
  return dateKeys.map((date) => {
    let activeStudents = 0;
    for (const student of cohort) {
      if (activeMap.get(student.userId)?.has(date)) activeStudents += 1;
    }
    return { date, activeStudents, totalStudents: cohort.length };
  });
}

function sortGrades(grades: string[]): string[] {
  const known = GRADE_OPTIONS.filter((g) => grades.includes(g));
  const rest = grades.filter((g) => !GRADE_OPTIONS.includes(g as (typeof GRADE_OPTIONS)[number])).sort();
  return [...known, ...rest];
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

  const searchParams = new URL(req.url).searchParams;
  const inputDays = Number(searchParams.get("days") ?? "14");
  const days = Number.isFinite(inputDays) ? Math.min(Math.max(Math.trunc(inputDays), 1), 31) : 14;
  const filterAffiliation = (searchParams.get("affiliation") ?? "").trim();
  const filterGradeRaw = (searchParams.get("grade") ?? "").trim();
  const filterGrade = filterGradeRaw ? normalizeGradeFromDb(filterGradeRaw) : "";

  const dateKeys = getDateKeys(days);
  const oldestDate = dateKeys[dateKeys.length - 1];

  const full = await admin
    .from("profiles")
    .select("user_id,email,name,role,affiliation,grade")
    .eq("role", "student")
    .order("email", { ascending: true });

  let profileRows: ProfileRow[] = [];
  if (!full.error && full.data) {
    profileRows = full.data as ProfileRow[];
  } else {
    const minimal = await admin
      .from("profiles")
      .select("user_id,email,name,role")
      .eq("role", "student")
      .order("email", { ascending: true });
    if (minimal.error) {
      return NextResponse.json({ error: "profiles_fetch_failed" }, { status: 500 });
    }
    profileRows = (minimal.data ?? []) as ProfileRow[];
  }

  let students: StudentBase[] = profileRows.map((p) => ({
    userId: p.user_id,
    email: p.email,
    name: p.name,
    affiliation: (p.affiliation ?? "").trim() || null,
    grade: normalizeGradeFromDb(p.grade) || null,
  }));

  if (filterAffiliation) {
    students = students.filter((s) => s.affiliation === filterAffiliation);
  }
  if (filterGrade) {
    students = students.filter((s) => s.grade === filterGrade);
  }

  const studentIds = students.map((s) => s.userId);
  const emptyResponse = {
    days: dateKeys,
    filter: { affiliation: filterAffiliation || null, grade: filterGrade || null },
    summaryByDay: dateKeys.map((date) => ({ date, activeStudents: 0, totalStudents: 0 })),
    summaryByDayByGrade: [] as Array<{
      grade: string;
      summaryByDay: Array<{ date: string; activeStudents: number; totalStudents: number }>;
    }>,
    students: [] as Array<
      StudentBase & { activeDays: number; activeByDay: Record<string, boolean> }
    >,
  };

  if (studentIds.length === 0) {
    return NextResponse.json(emptyResponse);
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

  const summaryByDay = buildSummaryByDay(students, dateKeys, activeMap);

  const gradesForBreakdown = filterGrade
    ? [filterGrade]
    : (() => {
        const fromProfiles = sortGrades([
          ...new Set(students.map((s) => s.grade).filter((g): g is string => !!g)),
        ]);
        const hasUnset = students.some((s) => !s.grade);
        return hasUnset ? [...fromProfiles, GRADE_UNSET_LABEL] : fromProfiles;
      })();

  const cohortForGrade = (grade: string) =>
    grade === GRADE_UNSET_LABEL
      ? students.filter((s) => !s.grade)
      : students.filter((s) => s.grade === grade);

  const summaryByDayByGrade = gradesForBreakdown.map((grade) => ({
    grade,
    summaryByDay: buildSummaryByDay(cohortForGrade(grade), dateKeys, activeMap),
  }));

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
    .sort(
      (a, b) =>
        (a.grade ?? "").localeCompare(b.grade ?? "", "ja") ||
        b.activeDays - a.activeDays ||
        a.email.localeCompare(b.email)
    );

  return NextResponse.json({
    days: dateKeys,
    filter: { affiliation: filterAffiliation || null, grade: filterGrade || null },
    summaryByDay,
    summaryByDayByGrade,
    students: studentRows,
  });
}
