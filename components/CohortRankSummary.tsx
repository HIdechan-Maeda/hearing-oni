"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { fetchLeaderboardCohort, type LeaderboardRpcRow } from "../lib/leaderboardCohort";
import { formatSupabaseError, supabaseLeaderboardRpcHint } from "../lib/supabasePolicyHint";

type Props = {
  /** 学生でプロフィール完了時のみ true */
  enabled: boolean;
};

/**
 * ホーム用: 所属・学年グループ内での自分の順位の要約と /ranking への導線
 */
export function CohortRankSummary({ enabled }: Props) {
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderboardRpcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setErr("");
      setMe(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setErr("");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || cancelled) {
        setLoading(false);
        return;
      }
      setMe(u.user.id);
      const { rows: list, error } = await fetchLeaderboardCohort(supabase, {
        p_affiliation: null,
        p_grade: null,
      });
      if (cancelled) return;
      setLoading(false);
      if (error) {
        setErr(
          "ランキング取得エラー: " +
            formatSupabaseError(error) +
            supabaseLeaderboardRpcHint(error.message)
        );
        return;
      }
      setRows(list);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return null;

  if (loading) {
    return (
      <div
        style={{
          marginBottom: 16,
          padding: 14,
          borderRadius: 14,
          background: "linear-gradient(135deg, #f0f7ff 0%, #ffffff 100%)",
          border: "1px solid #c5ddf5",
          fontSize: 14,
          color: "#1a2d42",
        }}
      >
        所属・学年グループのランキングを読み込み中…
      </div>
    );
  }

  if (err) {
    return (
      <p style={{ color: "#b00", fontSize: 13, marginBottom: 16, whiteSpace: "pre-wrap" }}>
        {err}
      </p>
    );
  }

  const mine = me ? rows.find((r) => r.user_id === me) : undefined;

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 16,
        borderRadius: 14,
        background: "linear-gradient(135deg, #e8f4ff 0%, #ffffff 100%)",
        border: "1px solid #9ec5ea",
        boxShadow: "0 4px 16px rgba(11, 79, 156, 0.08)",
      }}
    >
      <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700, color: "#0b315b" }}>
        所属・学年グループ内ランキング
      </h2>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#243a52", lineHeight: 1.5 }}>
        あなたのプロフィールと同じ<strong>所属・学年</strong>の受講生同士で、正解数・正答率の順位を表示します。順位表では<strong>グループ全員</strong>の順位を確認でき、所属の全学年の順位にも切り替えられます。
      </p>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: "#1a2d42" }}>
          このグループにまだデータがありません。問題に解答すると反映されます。
        </p>
      ) : mine ? (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: "8px 16px",
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 800, color: "#0b315b", letterSpacing: "0.02em" }}>
              {mine.rank} 位
            </span>
            <span style={{ fontSize: 14, color: "#243a52" }}>
              （グループ内 {rows.length} 名）
            </span>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 14, color: "#1a1a1a" }}>
            正解 <strong>{mine.total_correct}</strong> 問 ／ 解答{" "}
            <strong>{mine.total_answered}</strong> 問 ／ 正答率{" "}
            <strong>{mine.accuracy_pct}%</strong>
          </p>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 14, color: "#1a2d42" }}>順位を取得できませんでした。</p>
      )}
      <Link
        href="/ranking"
        className="btn-primary-solid"
        style={{
          display: "inline-block",
          textDecoration: "none",
          textAlign: "center",
          padding: "10px 18px",
          fontSize: 14,
        }}
      >
        順位表を見る
      </Link>
    </div>
  );
}
