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
import type { DomainKeyForStats } from "../../lib/domainLogClassification";
import { logTagsMatchDomain } from "../../lib/domainLogClassification";

type DomainKey = DomainKeyForStats;

const DOMAIN_OPTIONS: Array<{ key: DomainKey; label: string }> = [
  { key: "anatomy", label: "解剖（anatomy）" },
  { key: "physiology", label: "生理（physiology）" },
  { key: "acoustics", label: "音響（acoustics）" },
  { key: "psychoacoustics", label: "聴覚心理（psychoacoustics）" },
  { key: "audiometry", label: "聴力検査（audiometry）" },
  { key: "screening_audiometry", label: "聴力検査スクリーニング（screening audiometry）" },
  { key: "hearing_aids", label: "補聴器（hearing_aids）" },
  { key: "evoked", label: "電気生理（evoked）" },
  { key: "vestibular", label: "前庭（vestibular）" },
  { key: "disease", label: "病気・統合問題（disease）" },
  { key: "information_support", label: "情報保障（information support）" },
  { key: "development", label: "療育・発達（development）" },
];

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
  total_answered: number;
  total_correct: number;
  accuracy_pct: number;
};

/** PostgREST は 1 リクエストあたりの行数に上限（例: 1000）があり、.limit(80000) でも切られることがある。全件は range でページングする。 */
const LOGS_PAGE_SIZE = 1000;
/** 無限ループ防止（この件数まで取得） */
const MAX_LOG_ROWS_TO_SCAN = 10_000_000;

export default function TeacherDashboardPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
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
  const [rankMsg, setRankMsg] = useState("");
  const [rankLoading, setRankLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");

      // ログインユーザー確認
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        setMsg("ログインしてください。");
        setLoading(false);
        return;
      }
      const me = userData.user;

      // 自分のロール確認（profiles.role === 'teacher' を想定）
      const { data: myProfile, error: profErr } = await supabase
        .from("profiles")
        .select("user_id,email,name,role")
        .eq("user_id", me.id)
        .maybeSingle<ProfileRow>();

      if (profErr) {
        setMsg(
          "プロフィール取得エラー: " + formatSupabaseError(profErr) + supabaseProfileErrorHints(profErr.message)
        );
        setLoading(false);
        return;
      }

      const isTeacherRole = (myProfile?.role ?? "").trim().toLowerCase() === "teacher";
      if (!myProfile || !isTeacherRole) {
        setMsg("教師権限が必要です。profiles.role = 'teacher' に設定してください。");
        setLoading(false);
        return;
      }

      // 全 logs をページング取得して集計（1 回だけ limit すると直近 N 件に「活発な少数ユーザー」が偏り、他の受講生が表に出ない。また API の行数上限で 1000 件などに切られることがある）
      const statsByUser: Record<string, Record<DomainKey, DomainStat>> = {};
      let totalLogRows = 0;
      let offset = 0;
      let truncated = false;
      while (totalLogRows < MAX_LOG_ROWS_TO_SCAN) {
        const { data: page, error: logsErr } = await supabase
          .from("logs")
          .select("user_id,is_correct,tags_raw")
          .order("answered_at", { ascending: false })
          .range(offset, offset + LOGS_PAGE_SIZE - 1);

        if (logsErr) {
          setMsg("ログ取得エラー: " + logsErr.message);
          setAggregateMeta(null);
          setLoading(false);
          return;
        }
        if (!page?.length) break;

        for (const log of page as Array<{ user_id: string; is_correct: boolean; tags_raw: string | null }>) {
          const uid = log.user_id;
          if (!uid) continue;

          if (!statsByUser[uid]) {
            const initStats: Record<DomainKey, DomainStat> = {} as any;
            for (const { key } of DOMAIN_OPTIONS) {
              initStats[key] = { total: 0, correct: 0 };
            }
            statsByUser[uid] = initStats;
          }

          const isCorrect = !!log.is_correct;
          for (const { key } of DOMAIN_OPTIONS) {
            if (logTagsMatchDomain(log.tags_raw, key)) {
              statsByUser[uid][key].total += 1;
              if (isCorrect) statsByUser[uid][key].correct += 1;
            }
          }
        }
        totalLogRows += page.length;
        if (totalLogRows >= MAX_LOG_ROWS_TO_SCAN) {
          truncated = true;
          break;
        }
        if (page.length < LOGS_PAGE_SIZE) break;
        offset += LOGS_PAGE_SIZE;
      }

      if (totalLogRows === 0) {
        setRows([]);
        setAggregateMeta(null);
        setLoading(false);
        return;
      }

      const userIds = Object.keys(statsByUser);

      const { profiles: profileList, error: batchErr } = await fetchProfilesBatch(userIds);
      if (batchErr) {
        setMsg(
          "受講生プロフィール取得エラー: " +
            batchErr +
            "\n\n※ ログに出ている user が非常に多い場合は、.in() の件数制限で失敗することがあります（バッチ取得に変更済み）。affiliation / grade カラムが無い場合は name のみで取得します。"
        );
        setAggregateMeta(null);
        setLoading(false);
        return;
      }

      const profileMap = new Map<string, ProfileRowLite>();
      for (const p of profileList) {
        profileMap.set(p.user_id, p);
      }

      const resultRows: UserRow[] = Object.entries(statsByUser)
        // 教師自身のログは除外
        .filter(([uid]) => uid !== me.id)
        .map(([uid, stats]) => {
          const prof = profileMap.get(uid);
          return {
            userId: uid,
            name: prof?.name ?? null,
            email: prof?.email ?? "(email不明)",
            affiliation: prof?.affiliation ?? null,
            grade: prof?.grade ?? null,
            stats,
          };
        });

      // 表示を安定させるためメールでソート
      resultRows.sort((a, b) => a.email.localeCompare(b.email));

      setAggregateMeta({ logRows: totalLogRows, studentCount: resultRows.length, truncated });
      setRows(resultRows);
      setLoading(false);
    };

    load();
  }, []);

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
    setRankRows(
      list.map((r) => ({
        rank: Number(r.rank),
        user_id: r.user_id,
        display_name: r.display_name,
        total_answered: Number(r.total_answered),
        total_correct: Number(r.total_correct),
        accuracy_pct: Number(r.accuracy_pct),
      }))
    );
    if (list.length === 0) {
      setRankMsg("この所属・学年に該当する受講生がいないか、まだ解答ログがありません。");
    }
  };

  const hasData = useMemo(() => rows.length > 0, [rows.length]);

  return (
    <main className="teacher-dashboard">
      <h1>教師ダッシュボード（領域別 正答率）</h1>
      <p style={{ fontSize: 14, marginTop: 4 }}>
        <Link href="/teacher/allowlist">新規登録許可メール（学外）</Link>
        {" · "}
        <Link href="/teacher/announcements">お知らせ（ホーム上部）</Link>
      </p>
      <p style={{ fontSize: 12, color: "#1a2d42", marginTop: 8, lineHeight: 1.55, maxWidth: 720 }}>
        解答ログを<strong>全件</strong>（ページ分割）集計し、ログが 1 件以上ある受講生を一覧表示します。以前は直近のみの取得で人数が少なく見えることがありました。
      </p>

      {msg && <p style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</p>}

      {loading && <p>読み込み中…（ログ件数が多いと 1 分近くかかることがあります）</p>}

      {!loading && hasData && aggregateMeta && (
        <p style={{ fontSize: 13, color: "#0b315b", marginTop: 8, marginBottom: 0 }}>
          集計した解答ログ: <strong>{aggregateMeta.logRows.toLocaleString("ja-JP")}</strong> 件 ／ 表示中の受講生:{" "}
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

      {!loading && !hasData && !msg && <p>まだログがありません。</p>}

      <hr style={{ margin: "28px 0" }} />
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>ランキング（所属・学年グループ別）</h2>
      <p style={{ fontSize: 13, color: "#1a2d42", marginTop: 0 }}>
        受講生のプロフィールに登録された所属・学年が一致するグループ内で、正解数・正答率の順位を表示します。
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
        <div style={{ overflowX: "auto", marginTop: 8 }}>
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
                  <td style={tdStyle}>{r.display_name}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.total_correct}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.total_answered}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.accuracy_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

