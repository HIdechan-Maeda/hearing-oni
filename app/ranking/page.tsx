"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { RequireStudentProfile } from "../../components/RequireStudentProfile";
import { fetchProfileRow } from "../../lib/fetchProfileRow";
import { formatSupabaseError, supabaseLeaderboardRpcHint } from "../../lib/supabasePolicyHint";

export type LeaderboardRpcRow = {
  rank: number;
  user_id: string;
  display_name: string;
  total_answered: number;
  total_correct: number;
  accuracy_pct: number;
};

function RankingPageInner() {
  const [me, setMe] = useState<string | null>(null);
  const [cohortLabel, setCohortLabel] = useState<string>("");
  const [rows, setRows] = useState<LeaderboardRpcRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setMsg("ログインしてください。");
        setLoading(false);
        return;
      }
      setMe(u.user.id);

      const { data: prof } = await fetchProfileRow(u.user.id);
      if ((prof?.role ?? "").trim().toLowerCase() === "teacher") {
        setMsg("教師アカウントは「教師ダッシュボード」内のランキングをご利用ください。");
        setLoading(false);
        return;
      }
      const aff = (prof?.affiliation ?? "").trim();
      const gr = (prof?.grade ?? "").trim();
      if (!aff || !gr) {
        setMsg("ホームで所属・学年を登録してからご利用ください。");
        setLoading(false);
        return;
      }
      setCohortLabel(`${aff} ／ ${gr}`);

      const { data, error } = await supabase.rpc("leaderboard_cohort", {
        p_affiliation: null,
        p_grade: null,
      });

      if (error) {
        setMsg(
          "ランキング取得エラー: " +
            formatSupabaseError(error) +
            supabaseLeaderboardRpcHint(error.message)
        );
        setLoading(false);
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
      setRows(
        list.map((r) => ({
          rank: Number(r.rank),
          user_id: r.user_id,
          display_name: r.display_name,
          total_answered: Number(r.total_answered),
          total_correct: Number(r.total_correct),
          accuracy_pct: Number(r.accuracy_pct),
        }))
      );
      setLoading(false);
    };
    load();
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16, color: "#000" }}>
      <p style={{ marginBottom: 12 }}>
        <Link href="/" style={backStyle}>
          ← ホームへ
        </Link>
      </p>
      <h1 style={{ marginTop: 0 }}>ランキング（所属・学年のグループ内）</h1>
      <p style={{ fontSize: 14, color: "#333" }}>
        あなたと同じプロフィール（所属・学年）の受講生同士で、解答ログの正解数・正答率を比較します。
      </p>
      {cohortLabel && (
        <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          対象グループ: {cohortLabel}
        </p>
      )}

      {msg && <p style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</p>}
      {msg?.includes("教師アカウント") && (
        <p style={{ marginTop: 8 }}>
          <Link href="/teacher" style={{ color: "#0b4f9c" }}>教師ダッシュボードへ</Link>
        </p>
      )}
      {loading && <p>読み込み中...</p>}

      {!loading && !msg && rows.length === 0 && (
        <p>このグループに該当する受講生がまだいません。</p>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #666", background: "#f5f5f5" }}>
                <th style={th}>順位</th>
                <th style={th}>ニックネーム</th>
                <th style={{ ...th, textAlign: "right" }}>正解数</th>
                <th style={{ ...th, textAlign: "right" }}>解答数</th>
                <th style={{ ...th, textAlign: "right" }}>正答率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = me && r.user_id === me;
                return (
                  <tr
                    key={r.user_id}
                    style={{
                      borderBottom: "1px solid #ddd",
                      background: mine ? "#e8f4ff" : undefined,
                    }}
                  >
                    <td style={td}>{r.rank}</td>
                    <td style={td}>
                      {r.display_name}
                      {mine && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: "#0b4f9c" }}>（あなた）</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{r.total_correct}</td>
                    <td style={{ ...td, textAlign: "right" }}>{r.total_answered}</td>
                    <td style={{ ...td, textAlign: "right" }}>{r.accuracy_pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default function RankingPage() {
  return (
    <RequireStudentProfile>
      <RankingPageInner />
    </RequireStudentProfile>
  );
}

const backStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #ccc",
  textDecoration: "none",
  color: "#000",
  background: "#fff",
  display: "inline-block",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  color: "#000",
};

const td: React.CSSProperties = {
  padding: 10,
  color: "#000",
};
