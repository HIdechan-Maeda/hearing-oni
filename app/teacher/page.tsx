"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { AFFILIATION_PRESETS, GRADE_OPTIONS, normalizeGradeFromDb } from "../../lib/profileFieldOptions";
import { fetchProfilesBatch, type ProfileRowLite } from "../../lib/fetchProfilesBatch";
import {
  formatSupabaseError,
  supabaseLeaderboardRpcHint,
  supabaseProfileErrorHints,
} from "../../lib/supabasePolicyHint";
import {
  isInvalidRefreshTokenMessage,
  signOutLocalIfRefreshTokenInvalid,
} from "../../lib/supabaseInvalidSession";
import { downloadCsv, rowsToCsv, sanitizeFilenamePart } from "../../lib/csvExport";

type DomainKey =
  | "anatomy"
  | "physiology"
  | "acoustics"
  | "psychoacoustics"
  | "audiometry"
  | "screening_audiometry"
  | "hearing_aids"
  | "cochlea_implant"
  | "evoked"
  | "vestibular"
  | "disease"
  | "information_support"
  | "development"
  | "pediatric_hearing_exam"
  | "pediatric_hearing_loss";

const DOMAIN_OPTIONS: Array<{ key: DomainKey; label: string }> = [
  { key: "anatomy", label: "解剖（anatomy）" },
  { key: "physiology", label: "生理（physiology）" },
  { key: "acoustics", label: "音響（acoustics）" },
  { key: "psychoacoustics", label: "聴覚心理（psychoacoustics）" },
  { key: "audiometry", label: "聴力検査（audiometry）" },
  { key: "screening_audiometry", label: "聴力検査スクリーニング（screening audiometry）" },
  { key: "hearing_aids", label: "補聴器（hearing_aids）" },
  { key: "cochlea_implant", label: "人工内耳（cochlea implant）" },
  { key: "evoked", label: "電気生理（evoked）" },
  { key: "vestibular", label: "前庭（vestibular）" },
  { key: "disease", label: "病気・統合問題（disease）" },
  { key: "information_support", label: "情報保障（information support）" },
  { key: "development", label: "療育・発達（development）" },
  { key: "pediatric_hearing_exam", label: "小児聴覚検査（pediatric hearing）" },
  { key: "pediatric_hearing_loss", label: "小児難聴（pediatric hearing loss）" },
];

const DOMAIN_KEYWORDS: Record<DomainKey, string[]> = {
  anatomy: ["anatomy"],
  physiology: ["physiology"],
  acoustics: ["acoustics", "onkyo"],
  psychoacoustics: ["psychoacoustics"],
  audiometry: ["audiometry"],
  screening_audiometry: ["screening audiometry"],
  hearing_aids: ["hearing_aids", "hearing_aid"],
  cochlea_implant: ["cochlea implant", "cochlear implant", "人工内耳"],
  evoked: ["evoked", "abr", "assr"],
  vestibular: ["vestibular"],
  development: ["development"],
  information_support: ["information"],
  disease: ["desease", "disease", "byouki", "病気", "complex", "統合"],
  pediatric_hearing_exam: ["pediatric hearing", "小児聴覚検査"],
  pediatric_hearing_loss: ["pediatric hearing loss"],
};

function tagsRawMatchesAnyExactToken(tagsRaw: string | null, keywords: string[]): boolean {
  if (!tagsRaw) return false;
  const tokens = tagsRaw
    .split(/[,;，、/|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.normalize("NFKC").trim().toLowerCase());
  return keywords.some((kw) => {
    const w = kw.normalize("NFKC").trim().toLowerCase();
    return tokens.some((t) => t === w);
  });
}

function logTagsMatchDomainDetailed(tagsRaw: string | null, key: DomainKey): boolean {
  if (key === "pediatric_hearing_exam") {
    return tagsRawMatchesAnyExactToken(tagsRaw, DOMAIN_KEYWORDS.pediatric_hearing_exam);
  }
  const lower = (tagsRaw ?? "").toLowerCase();
  return DOMAIN_KEYWORDS[key].some((kw) => lower.includes(kw.toLowerCase()));
}

type DomainStat = {
  total: number;
  correct: number;
};

type UserRow = {
  userId: string;
  name: string | null;
  email: string;
  affiliation: string | null;
  grade: string | null;
  stats: Record<DomainKey, DomainStat>;
};

type ProfileRow = {
  user_id: string;
  email: string;
  name: string | null;
  role?: string | null;
  affiliation?: string | null;
  grade?: string | null;
};

type RankRow = {
  rank: number;
  user_id: string;
  display_name: string;
  email: string;
  total_answered: number;
  total_correct: number;
  accuracy_pct: number;
};

type DailyLoginDaySummary = {
  date: string;
  activeStudents: number;
  totalStudents: number;
};

type DailyLoginStudentRow = {
  userId: string;
  email: string;
  name: string | null;
  affiliation: string | null;
  grade: string | null;
  activeDays: number;
  activeByDay: Record<string, boolean>;
};

type DailyLoginResponse = {
  days: string[];
  filter: { affiliation: string | null; grade: string | null };
  summaryByDay: DailyLoginDaySummary[];
  summaryByDayByGrade: Array<{ grade: string; summaryByDay: DailyLoginDaySummary[] }>;
  students: DailyLoginStudentRow[];
};

/** PostgREST は 1 リクエストあたりの行数に上限（例: 1000）があり、.limit(80000) でも切られることがある。全件は range でページングする。 */
const LOGS_PAGE_SIZE = 1000;
/** 無限ループ防止（この件数まで取得） */
const MAX_LOG_ROWS_TO_SCAN = 10_000_000;
/** logs の .in(user_id) 1 リクエストあたりの上限目安 */
const LOGS_COHORT_IN_CHUNK = 80;

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
const DAILY_LOGIN_GRADE_UNSET = "(学年未設定)";

function dailyLoginStudentsInGrade(
  students: DailyLoginStudentRow[],
  grade: string
): DailyLoginStudentRow[] {
  return grade === DAILY_LOGIN_GRADE_UNSET
    ? students.filter((s) => !s.grade)
    : students.filter((s) => s.grade === grade);
}

export default function TeacherDashboardPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [statsAff, setStatsAff] = useState("");
  const [statsAffOther, setStatsAffOther] = useState("");
  const [statsGrade, setStatsGrade] = useState("");
  const [statsLoadedMeta, setStatsLoadedMeta] = useState<{ affiliation: string; grade: string } | null>(
    null
  );
  const [teacherUserId, setTeacherUserId] = useState<string | null>(null);
  /** 集計したログ件数・人数（仕様の可視化） */
  const [aggregateMeta, setAggregateMeta] = useState<{
    logRows: number;
    studentCount: number;
    truncated: boolean;
  } | null>(null);

  const [rankAff, setRankAff] = useState("");
  const [rankAffOther, setRankAffOther] = useState("");
  const [rankGrade, setRankGrade] = useState("");
  const [rankRows, setRankRows] = useState<RankRow[]>([]);
  const [rankLoadedMeta, setRankLoadedMeta] = useState<{ affiliation: string; grade: string } | null>(
    null
  );
  const [rankMsg, setRankMsg] = useState("");
  const [rankLoading, setRankLoading] = useState(false);
  const [loginAff, setLoginAff] = useState("");
  const [loginAffOther, setLoginAffOther] = useState("");
  const [loginGrade, setLoginGrade] = useState("");
  const [dailyLogin, setDailyLogin] = useState<DailyLoginResponse | null>(null);
  const [dailyLoginLoadedMeta, setDailyLoginLoadedMeta] = useState<{
    affiliation: string;
    grade: string | null;
  } | null>(null);
  const [dailyLoginLoading, setDailyLoginLoading] = useState(false);
  const [dailyLoginMsg, setDailyLoginMsg] = useState("");

  useEffect(() => {
    const checkTeacher = async () => {
      setMsg("");
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        await signOutLocalIfRefreshTokenInvalid(supabase, userErr.message);
        setMsg(
          isInvalidRefreshTokenMessage(userErr.message)
            ? "保存されていたログイン情報が無効です。一度ログアウト済みです。ホームから再度ログインしてください。"
            : "ログインしてください。"
        );
        return;
      }
      if (!userData.user) {
        setMsg("ログインしてください。");
        return;
      }

      const { data: myProfile, error: profErr } = await supabase
        .from("profiles")
        .select("user_id,email,name,role")
        .eq("user_id", userData.user.id)
        .maybeSingle<ProfileRow>();

      if (profErr) {
        setMsg(
          "プロフィール取得エラー: " + formatSupabaseError(profErr) + supabaseProfileErrorHints(profErr.message)
        );
        return;
      }

      const isTeacherRole = (myProfile?.role ?? "").trim().toLowerCase() === "teacher";
      if (!myProfile || !isTeacherRole) {
        setMsg("教師権限が必要です。profiles.role = 'teacher' に設定してください。");
        return;
      }

      setTeacherUserId(userData.user.id);
    };

    checkTeacher();
  }, []);

  const loadDomainStats = async () => {
    if (!teacherUserId) {
      setMsg("教師権限の確認が完了していません。ページを再読み込みしてください。");
      return;
    }
    const me = { id: teacherUserId };
    const effAff = statsAff === "その他" ? statsAffOther.trim() : statsAff.trim();
    const effGrade = normalizeGradeFromDb(statsGrade.trim());
    if (!effAff || !effGrade) {
      setMsg("所属・学年を選択してください。「その他」の場合は所属名も入力してください。");
      return;
    }

    setLoading(true);
    setMsg("");
    setStatsLoaded(false);
    setStatsLoadedMeta(null);
    setRows([]);
    setAggregateMeta(null);

    const fullProf = await supabase
      .from("profiles")
      .select("user_id,email,name,affiliation,grade,role")
      .eq("role", "student")
      .eq("affiliation", effAff);

    let cohortProfiles: ProfileRowLite[] = [];
    if (!fullProf.error && fullProf.data) {
      cohortProfiles = (fullProf.data as ProfileRowLite[]).filter(
        (p) => normalizeGradeFromDb(p.grade) === effGrade && p.user_id !== me.id
      );
    } else {
      const minimal = await supabase.from("profiles").select("user_id,email,name,role").eq("role", "student");
      if (minimal.error) {
        setMsg(
          "受講生プロフィール取得エラー: " +
            minimal.error.message +
            "\n\naffiliation / grade カラムがあるか、data/SUPABASE_profiles_affiliation_grade.sql を実行してください。"
        );
        setStatsLoaded(true);
        setLoading(false);
        return;
      }
      setMsg(
        "所属・学年で絞り込むには profiles の affiliation / grade 列が必要です。data/SUPABASE_profiles_affiliation_grade.sql を Supabase で実行してください。"
      );
      setStatsLoaded(true);
      setLoading(false);
      return;
    }

    if (cohortProfiles.length === 0) {
      setMsg("この所属・学年に該当する受講生がいません。プロフィールの所属・学年を確認してください。");
      setStatsLoaded(true);
      setLoading(false);
      return;
    }

    const initStats = (): Record<DomainKey, DomainStat> => {
      const s: Record<DomainKey, DomainStat> = {} as Record<DomainKey, DomainStat>;
      for (const { key } of DOMAIN_OPTIONS) s[key] = { total: 0, correct: 0 };
      return s;
    };

    const statsByUser: Record<string, Record<DomainKey, DomainStat>> = {};
    for (const p of cohortProfiles) {
      statsByUser[p.user_id] = initStats();
    }

    const cohortIds = cohortProfiles.map((p) => p.user_id);
    let totalLogRows = 0;
    let truncated = false;

    const ingestLogPage = (page: Array<{ user_id: string; is_correct: boolean; tags_raw: string | null }>) => {
      for (const log of page) {
        const uid = log.user_id;
        if (!uid || !statsByUser[uid]) continue;
        const isCorrect = !!log.is_correct;
        for (const { key } of DOMAIN_OPTIONS) {
          if (logTagsMatchDomainDetailed(log.tags_raw, key)) {
            statsByUser[uid][key].total += 1;
            if (isCorrect) statsByUser[uid][key].correct += 1;
          }
        }
      }
    };

    for (const idChunk of chunkIds(cohortIds, LOGS_COHORT_IN_CHUNK)) {
      let offset = 0;
      while (totalLogRows < MAX_LOG_ROWS_TO_SCAN) {
        const { data: page, error: logsErr } = await supabase
          .from("logs")
          .select("user_id,is_correct,tags_raw")
          .in("user_id", idChunk)
          .order("answered_at", { ascending: false })
          .range(offset, offset + LOGS_PAGE_SIZE - 1);

        if (logsErr) {
          setMsg("ログ取得エラー: " + logsErr.message);
          setAggregateMeta(null);
          setStatsLoaded(true);
          setLoading(false);
          return;
        }
        if (!page?.length) break;

        ingestLogPage(page as Array<{ user_id: string; is_correct: boolean; tags_raw: string | null }>);
        totalLogRows += page.length;
        if (totalLogRows >= MAX_LOG_ROWS_TO_SCAN) {
          truncated = true;
          break;
        }
        if (page.length < LOGS_PAGE_SIZE) break;
        offset += LOGS_PAGE_SIZE;
      }
      if (truncated) break;
    }

    const resultRows: UserRow[] = cohortProfiles.map((p) => ({
      userId: p.user_id,
      name: p.name,
      email: p.email,
      affiliation: p.affiliation ?? effAff,
      grade: normalizeGradeFromDb(p.grade) || effGrade,
      stats: statsByUser[p.user_id],
    }));

    resultRows.sort((a, b) => a.email.localeCompare(b.email));

    setStatsLoadedMeta({ affiliation: effAff, grade: effGrade });
    setAggregateMeta({
      logRows: totalLogRows,
      studentCount: resultRows.length,
      truncated,
    });
    setRows(resultRows);
    setStatsLoaded(true);
    setLoading(false);
  };

  const loadDailyLogin = async () => {
    const effAff = loginAff === "その他" ? loginAffOther.trim() : loginAff.trim();
    const effGrade = loginGrade.trim() ? normalizeGradeFromDb(loginGrade.trim()) : "";
    if (!effAff) {
      setDailyLoginMsg("所属を選択してください。「その他」の場合は所属名も入力してください。");
      return;
    }

    setDailyLoginLoading(true);
    setDailyLoginMsg("");
    setDailyLogin(null);
    setDailyLoginLoadedMeta(null);
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) {
      await signOutLocalIfRefreshTokenInvalid(supabase, sessionErr.message);
      setDailyLoginLoading(false);
      setDailyLoginMsg(
        isInvalidRefreshTokenMessage(sessionErr.message)
          ? "セッションの更新に失敗しました。保存されていたログインを消しました。ホームから再度ログインしてください。"
          : "日別ログインの取得には再ログインが必要です。"
      );
      return;
    }
    const token = sessionData.session?.access_token ?? "";
    if (!token) {
      setDailyLoginLoading(false);
      setDailyLoginMsg("日別ログインの取得には再ログインが必要です。");
      return;
    }
    const params = new URLSearchParams({ days: "14", affiliation: effAff });
    if (effGrade) params.set("grade", effGrade);
    const res = await fetch(`/api/teacher/login-daily?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json().catch(() => ({}))) as Partial<DailyLoginResponse> & { error?: string };
    if (!res.ok) {
      setDailyLoginLoading(false);
      setDailyLoginMsg(
        body.error === "forbidden"
          ? "教師権限が必要です。"
          : "日別ログインの取得に失敗しました。時間をおいて再実行してください。"
      );
      return;
    }
    setDailyLogin(body as DailyLoginResponse);
    setDailyLoginLoadedMeta({ affiliation: effAff, grade: effGrade || null });
    setDailyLoginLoading(false);
  };

  const downloadDailyLoginCsv = () => {
    if (!dailyLogin || !dailyLoginLoadedMeta) return;
    const header: Array<string | number> = [
      "所属",
      "学年",
      "ニックネーム",
      "メールアドレス",
      "ログイン日数",
      ...dailyLogin.days.map((d) => d),
    ];
    const dataRows = dailyLogin.students.map((s) => [
      s.affiliation ?? dailyLoginLoadedMeta.affiliation,
      s.grade ?? "",
      s.name ?? "(名前未設定)",
      s.email,
      s.activeDays,
      ...dailyLogin.days.map((d) => (s.activeByDay[d] ? "○" : "")),
    ]);
    const csv = rowsToCsv([header, ...dataRows]);
    const date = new Date().toISOString().slice(0, 10);
    const aff = sanitizeFilenamePart(dailyLoginLoadedMeta.affiliation);
    const gradePart = dailyLoginLoadedMeta.grade
      ? sanitizeFilenamePart(dailyLoginLoadedMeta.grade)
      : "全学年";
    downloadCsv(`login_daily_${aff}_${gradePart}_${date}.csv`, csv);
  };

  const loadRanking = async () => {
    setRankMsg("");
    const effAff =
      rankAff === "その他" ? rankAffOther.trim() : rankAff.trim();
    const effGrade = normalizeGradeFromDb(rankGrade.trim());
    if (!effAff || !effGrade) {
      setRankMsg("所属・学年を選択してください。「その他」の場合は所属名も入力してください。");
      return;
    }
    setRankLoading(true);
    setRankLoadedMeta(null);
    const { data, error } = await supabase.rpc("leaderboard_cohort", {
      p_affiliation: effAff,
      p_grade: effGrade,
    });
    setRankLoading(false);
    if (error) {
      setRankMsg(
        "ランキング取得エラー: " +
          formatSupabaseError(error) +
          supabaseLeaderboardRpcHint(error.message)
      );
      setRankRows([]);
      setRankLoadedMeta(null);
      return;
    }
    const list = (data ?? []) as Array<{
      rank: number;
      user_id: string;
      display_name: string;
      total_answered: number;
      total_correct: number;
      accuracy_pct: number;
    }>;
    const { profiles: rankProfiles, error: profErr } = await fetchProfilesBatch(
      list.map((r) => r.user_id)
    );
    if (profErr) {
      setRankMsg("プロフィール（メール）取得エラー: " + profErr);
      setRankRows([]);
      setRankLoadedMeta(null);
      return;
    }
    const emailByUser = new Map(rankProfiles.map((p) => [p.user_id, p.email]));
    setRankLoadedMeta({ affiliation: effAff, grade: effGrade });
    setRankRows(
      list.map((r) => ({
        rank: Number(r.rank),
        user_id: r.user_id,
        display_name: r.display_name,
        email: emailByUser.get(r.user_id) ?? "(email不明)",
        total_answered: Number(r.total_answered),
        total_correct: Number(r.total_correct),
        accuracy_pct: Number(r.accuracy_pct),
      }))
    );
    if (list.length === 0) {
      setRankMsg("この所属・学年に該当する受講生がいないか、まだ解答ログがありません。");
    }
  };

  const downloadRankingCsv = () => {
    if (rankRows.length === 0 || !rankLoadedMeta) return;
    const header: Array<string | number> = [
      "所属",
      "学年",
      "順位",
      "ニックネーム",
      "メールアドレス",
      "正解数",
      "解答数",
      "正答率(%)",
    ];
    const dataRows = rankRows.map((r) => [
      rankLoadedMeta.affiliation,
      rankLoadedMeta.grade,
      r.rank,
      r.display_name,
      r.email,
      r.total_correct,
      r.total_answered,
      r.accuracy_pct,
    ]);
    const csv = rowsToCsv([header, ...dataRows]);
    const date = new Date().toISOString().slice(0, 10);
    const aff = sanitizeFilenamePart(rankLoadedMeta.affiliation);
    const grade = sanitizeFilenamePart(rankLoadedMeta.grade);
    downloadCsv(`ranking_${aff}_${grade}_${date}.csv`, csv);
  };

  const hasData = useMemo(() => rows.length > 0, [rows.length]);

  return (
    <main className="teacher-dashboard">
      <h1>教師ダッシュボード（領域別 正答率）</h1>
      <p style={{ fontSize: 14, marginTop: 4 }}>
        <Link href="/teacher/allowlist">新規登録許可メール（学外）</Link>
        {" · "}
        <Link href="/teacher/announcements">お知らせ（ホーム上部）</Link>
        {" · "}
        <Link href="/teacher/questions-generate">OpenAI 問題生成</Link>
      </p>
      <p style={{ fontSize: 12, color: "#1a2d42", marginTop: 8, lineHeight: 1.55, maxWidth: 720 }}>
        選択した<strong>所属・学年</strong>の受講生について、解答ログをページ分割で集計し、領域別の正答率を表示します。
        ログが無い受講生も 0 件として一覧に含めます。表示はボタン押下時のみ（ログ件数が多いと時間がかかることがあります）。
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginTop: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>所属</div>
          <select
            className="input-elegant"
            value={statsAff}
            onChange={(e) => {
              setStatsAff(e.target.value);
              if (e.target.value !== "その他") setStatsAffOther("");
            }}
            style={{ minWidth: 180 }}
          >
            <option value="">選択</option>
            {AFFILIATION_PRESETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {statsAff === "その他" && (
          <div>
            <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>所属（記入）</div>
            <input
              className="input-elegant"
              value={statsAffOther}
              onChange={(e) => setStatsAffOther(e.target.value)}
              placeholder="所属名"
              style={{ width: 200 }}
            />
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>学年</div>
          <select
            className="input-elegant"
            value={statsGrade}
            onChange={(e) => setStatsGrade(e.target.value)}
            style={{ minWidth: 100 }}
          >
            <option value="">選択</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={loadDomainStats}
          disabled={loading || !teacherUserId}
          style={{ padding: "8px 16px", cursor: "pointer" }}
        >
          {loading ? "集計中..." : statsLoaded ? "領域別正答率を再表示" : "領域別正答率を表示"}
        </button>
      </div>

      {msg && <p style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</p>}

      {loading && <p>読み込み中…（ログ件数が多いと 1 分近くかかることがあります）</p>}

      {!loading && statsLoaded && statsLoadedMeta && aggregateMeta && (
        <p style={{ fontSize: 13, color: "#0b315b", marginTop: 8, marginBottom: 0 }}>
          対象: <strong>{statsLoadedMeta.affiliation}</strong> ／ <strong>{statsLoadedMeta.grade}</strong>
          {" ・ "}
          集計した解答ログ: <strong>{aggregateMeta.logRows.toLocaleString("ja-JP")}</strong> 件 ／ 受講生:{" "}
          <strong>{aggregateMeta.studentCount}</strong> 名
          {aggregateMeta.truncated ? (
            <span style={{ color: "#a50" }}>（集計件数の上限に達したため、それより古いログは含まれていません）</span>
          ) : null}
        </p>
      )}

      {!loading && hasData && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={thStyle}>受講生</th>
                {DOMAIN_OPTIONS.map((d) => (
                  <th key={d.key} style={thStyle}>
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td style={tdStyle}>
                    <div>
                      <div>{row.name ?? "(名前未設定)"}</div>
                      <div style={{ color: "#1a2d42", fontSize: 12 }}>{row.email}</div>
                      {(row.affiliation || row.grade) && (
                        <div style={{ color: "#1a2d42", fontSize: 12, marginTop: 4 }}>
                          {row.affiliation && <span>所属: {row.affiliation}</span>}
                          {row.affiliation && row.grade && " ／ "}
                          {row.grade && (
                            <span>学年: {normalizeGradeFromDb(row.grade) || row.grade}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  {DOMAIN_OPTIONS.map((d) => {
                    const s = row.stats[d.key];
                    const label =
                      s.total === 0
                        ? "-"
                        : `${s.correct} / ${s.total} (${Math.round((s.correct / s.total) * 100)}%)`;
                    return (
                      <td key={d.key} style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {label}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {statsLoaded && !loading && !hasData && !msg && statsLoadedMeta && (
        <p style={{ fontSize: 13, color: "#1a2d42" }}>
          {statsLoadedMeta.affiliation} ／ {statsLoadedMeta.grade} に該当する受講生はいますが、まだ解答ログがありません。
        </p>
      )}

      <hr style={{ margin: "28px 0" }} />
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>学生の日別ログイン状況（直近14日）</h2>
      <p style={{ fontSize: 13, color: "#1a2d42", marginTop: 0 }}>
        解答ログ（`logs.answered_at`）をもとに、所属・学年で絞った受講生の日別アクティブ状況を表示します。
        学年は「全学年」で学年ごとのサマリ、特定学年でその学年の詳細一覧を表示できます。CSV でもダウンロードできます。
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>所属</div>
          <select
            className="input-elegant"
            value={loginAff}
            onChange={(e) => {
              setLoginAff(e.target.value);
              if (e.target.value !== "その他") setLoginAffOther("");
            }}
            style={{ minWidth: 180 }}
          >
            <option value="">選択</option>
            {AFFILIATION_PRESETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {loginAff === "その他" && (
          <div>
            <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>所属（記入）</div>
            <input
              className="input-elegant"
              value={loginAffOther}
              onChange={(e) => setLoginAffOther(e.target.value)}
              placeholder="所属名"
              style={{ width: 200 }}
            />
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>学年</div>
          <select
            className="input-elegant"
            value={loginGrade}
            onChange={(e) => setLoginGrade(e.target.value)}
            style={{ minWidth: 120 }}
          >
            <option value="">全学年</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={loadDailyLogin}
          disabled={dailyLoginLoading}
          style={{ padding: "8px 16px", cursor: "pointer" }}
        >
          {dailyLoginLoading ? "取得中..." : "日別ログインを表示"}
        </button>
      </div>
      {dailyLoginMsg && <p style={{ color: "#b00", fontSize: 13, whiteSpace: "pre-wrap" }}>{dailyLoginMsg}</p>}
      {!dailyLoginLoading && dailyLogin && dailyLoginLoadedMeta && (
        <>
          <p style={{ marginTop: 8, marginBottom: 8, fontSize: 13, color: "#0b315b" }}>
            対象: <strong>{dailyLoginLoadedMeta.affiliation}</strong>
            {" ／ "}
            <strong>{dailyLoginLoadedMeta.grade ?? "全学年"}</strong>
            （{dailyLogin.students.length} 名）
            <button
              type="button"
              onClick={downloadDailyLoginCsv}
              disabled={dailyLogin.students.length === 0}
              style={{ marginLeft: 12, padding: "6px 14px", cursor: "pointer" }}
            >
              日別ログインを CSV ダウンロード
            </button>
          </p>
          {dailyLogin.summaryByDayByGrade.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <h3 style={{ fontSize: 15, margin: "0 0 8px", color: "#0b315b" }}>日別サマリ（学年別）</h3>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f5f5f5" }}>
                    <th style={thStyle}>日付</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>全体</th>
                    {dailyLogin.summaryByDayByGrade.map((g) => (
                      <th key={g.grade} style={{ ...thStyle, textAlign: "right" }}>
                        {g.grade}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dailyLogin.days.map((date, i) => (
                    <tr key={date}>
                      <td style={tdStyle}>{date}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {dailyLogin.summaryByDay[i]?.activeStudents ?? 0} /{" "}
                        {dailyLogin.summaryByDay[i]?.totalStudents ?? 0}
                      </td>
                      {dailyLogin.summaryByDayByGrade.map((g) => (
                        <td key={g.grade} style={{ ...tdStyle, textAlign: "right" }}>
                          {g.summaryByDay[i]?.activeStudents ?? 0} / {g.summaryByDay[i]?.totalStudents ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 11, color: "#1a2d42", marginTop: 6 }}>
                各セルは「その日に解答した人数 / 対象学年の登録人数」です。
              </p>
            </div>
          )}
          {dailyLogin.summaryByDayByGrade.length === 0 && (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f5f5f5" }}>
                    <th style={thStyle}>日付</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>ログイン学生数</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyLogin.summaryByDay.map((s) => (
                    <tr key={s.date}>
                      <td style={tdStyle}>{s.date}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {s.activeStudents} / {s.totalStudents} 名
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(dailyLoginLoadedMeta.grade
            ? [{ grade: dailyLoginLoadedMeta.grade, students: dailyLogin.students }]
            : dailyLogin.summaryByDayByGrade.map((g) => ({
                grade: g.grade,
                students: dailyLoginStudentsInGrade(dailyLogin.students, g.grade),
              }))
          ).map(({ grade, students }) =>
            students.length === 0 ? null : (
              <div key={grade} style={{ overflowX: "auto", marginTop: 16 }}>
                <h3 style={{ fontSize: 15, margin: "0 0 8px", color: "#0b315b" }}>
                  {grade}（{students.length} 名）
                </h3>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f5f5f5" }}>
                      <th style={thStyle}>学生</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>14日間のログイン日数</th>
                      {dailyLogin.days.map((d) => (
                        <th key={d} style={{ ...thStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                          {d.slice(5)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.userId}>
                        <td style={tdStyle}>
                          <div>{s.name ?? "(名前未設定)"}</div>
                          <div style={{ color: "#1a2d42", fontSize: 12 }}>{s.email}</div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{s.activeDays} 日</td>
                        {dailyLogin.days.map((d) => (
                          <td key={d} style={{ ...tdStyle, textAlign: "center" }}>
                            {s.activeByDay[d] ? "◯" : "-"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {dailyLogin.students.length === 0 && (
            <p style={{ fontSize: 13, color: "#1a2d42", marginTop: 12 }}>
              この所属・学年に該当する受講生がいないか、直近14日に解答ログがありません。
            </p>
          )}
        </>
      )}

      <hr style={{ margin: "28px 0" }} />
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>ランキング（所属・学年グループ別）</h2>
      <p style={{ fontSize: 13, color: "#1a2d42", marginTop: 0 }}>
        受講生のプロフィールに登録された所属・学年が一致するグループ内で、正解数・正答率の順位を表示します。
        表示後は順位・メール・正解数・解答数・正答率などを <strong>CSV</strong> でダウンロードできます（Excel でも開けます）。
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>所属</div>
          <select
            className="input-elegant"
            value={rankAff}
            onChange={(e) => {
              setRankAff(e.target.value);
              if (e.target.value !== "その他") setRankAffOther("");
            }}
            style={{ minWidth: 180 }}
          >
            <option value="">選択</option>
            {AFFILIATION_PRESETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {rankAff === "その他" && (
          <div>
            <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>所属（記入）</div>
            <input
              className="input-elegant"
              value={rankAffOther}
              onChange={(e) => setRankAffOther(e.target.value)}
              placeholder="所属名"
              style={{ width: 200 }}
            />
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, marginBottom: 4, fontWeight: 600, color: "#0b315b" }}>学年</div>
          <select className="input-elegant" value={rankGrade} onChange={(e) => setRankGrade(e.target.value)} style={{ minWidth: 100 }}>
            <option value="">選択</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={loadRanking} disabled={rankLoading} style={{ padding: "8px 16px", cursor: "pointer" }}>
          {rankLoading ? "取得中..." : "ランキングを表示"}
        </button>
      </div>
      {rankMsg && <p style={{ color: "#b00", fontSize: 13, whiteSpace: "pre-wrap" }}>{rankMsg}</p>}
      {!rankLoading && rankRows.length > 0 && (
        <>
        <p style={{ marginTop: 8, marginBottom: 8 }}>
          <button
            type="button"
            onClick={downloadRankingCsv}
            style={{ padding: "8px 16px", cursor: "pointer" }}
          >
            ランキングを CSV ダウンロード
          </button>
          {rankLoadedMeta && (
            <span style={{ marginLeft: 10, fontSize: 12, color: "#1a2d42" }}>
              対象: {rankLoadedMeta.affiliation} ／ {rankLoadedMeta.grade}（{rankRows.length} 名）
            </span>
          )}
        </p>
        <div style={{ overflowX: "auto", marginTop: 0 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={thStyle}>順位</th>
                <th style={thStyle}>ニックネーム</th>
                <th style={{ ...thStyle, textAlign: "right" }}>正解数</th>
                <th style={{ ...thStyle, textAlign: "right" }}>解答数</th>
                <th style={{ ...thStyle, textAlign: "right" }}>正答率</th>
              </tr>
            </thead>
            <tbody>
              {rankRows.map((r) => (
                <tr key={r.user_id}>
                  <td style={tdStyle}>{r.rank}</td>
                  <td style={tdStyle}>
                    <div>{r.display_name}</div>
                    <div style={{ color: "#1a2d42", fontSize: 12 }}>{r.email}</div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.total_correct}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.total_answered}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.accuracy_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <hr style={{ margin: "18px 0" }} />
      <Link href="/">ホームへ</Link>
    </main>
  );
}

const thStyle: React.CSSProperties = {
  borderBottom: "1px solid #ccc",
  padding: 6,
  textAlign: "left",
  background: "#fafafa",
  fontSize: 13,
  color: "#0a1f3a",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: 6,
  fontSize: 13,
  color: "#0a1f3a",
};

