"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import type { DomainKeyForStats } from "../../lib/domainLogClassification";
import { logTagsMatchDomain } from "../../lib/domainLogClassification";
import { RequireStudentProfile } from "../../components/RequireStudentProfile";

type DomainKey = DomainKeyForStats;

const DOMAIN_OPTIONS: Array<{ key: DomainKey; label: string }> = [
  { key: "hearing_disability", label: "聴覚障害学" },
  { key: "acoustics", label: "音響学" },
];

type ChartRow = {
  name: string;
  domain: DomainKey;
  正答率: number;
  正解数: number;
  総数: number;
};

function barColor(正答率: number): string {
  if (正答率 >= 70) return "#4a7c59";
  if (正答率 >= 50) return "#b8860b";
  return "#a52a2a";
}

function StudentDashboardPageInner() {
  const [data, setData] = useState<ChartRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        setMsg("ログインしてください。");
        setLoading(false);
        return;
      }
      const user = userData.user;

      const { data: logs, error } = await supabase
        .from("logs")
        .select("is_correct,tags_raw")
        .eq("user_id", user.id)
        .limit(5000);

      if (error) {
        setMsg("ログ取得エラー: " + error.message);
        setLoading(false);
        return;
      }

      const stats: Record<DomainKey, { total: number; correct: number }> = {} as Record<
        DomainKey,
        { total: number; correct: number }
      >;
      for (const { key } of DOMAIN_OPTIONS) {
        stats[key] = { total: 0, correct: 0 };
      }

      for (const row of logs ?? []) {
        const isCorrect = !!row.is_correct;
        for (const { key } of DOMAIN_OPTIONS) {
          if (logTagsMatchDomain(row.tags_raw, key)) {
            stats[key].total += 1;
            if (isCorrect) stats[key].correct += 1;
          }
        }
      }

      const chartData: ChartRow[] = DOMAIN_OPTIONS.map((d) => {
        const s = stats[d.key];
        const 正答率 = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
        return {
          name: d.label,
          domain: d.key,
          正答率,
          正解数: s.correct,
          総数: s.total,
        };
      });

      setData(chartData);
      setLoading(false);
    };
    load();
  }, []);

  const hasAny = data.some((r) => r.総数 > 0);
  const chartData = data.filter((r) => r.総数 > 0);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16, color: "#000" }}>
      <p style={{ marginBottom: 16 }}>
        <Link
          href="/"
          style={{
            display: "inline-block",
            padding: "10px 16px",
            fontSize: 15,
            border: "1px solid #ccc",
            borderRadius: 10,
            background: "#fff",
            color: "#000",
            textDecoration: "none",
          }}
        >
          ← 問題に戻る
        </Link>
      </p>
      <h1 style={{ marginBottom: 8 }}>自分の正答率</h1>
      <p style={{ marginTop: 0, marginBottom: 16, color: "#000" }}>
        領域別の正答率をグラフで確認できます。
      </p>

      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      {loading && <p>読み込み中...</p>}

      {!loading && hasAny && (
        <>
          {/* CSS のみの横棒グラフ（余計な線なし） */}
          <div
            style={{
              width: "100%",
              marginBottom: 24,
              background: "#333",
              borderRadius: 12,
              padding: "16px 12px",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <span style={{ color: "#fff", fontSize: 12, width: 52, flexShrink: 0 }}>領域</span>
              <span style={{ color: "#fff", fontSize: 11, flex: 1 }}>0%</span>
              <span style={{ color: "#fff", fontSize: 11 }}>100%</span>
            </div>
            {chartData.map((r) => (
              <div
                key={r.domain}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <span style={{ color: "#fff", fontSize: 12, width: 52, flexShrink: 0 }}>{r.name}</span>
                <div
                  style={{
                    flex: 1,
                    height: 24,
                    background: "#444",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${r.正答率}%`,
                      height: "100%",
                      background: barColor(r.正答率),
                      borderRadius: 4,
                      minWidth: r.正答率 > 0 ? 4 : 0,
                    }}
                  />
                </div>
                <span style={{ color: "#fff", fontSize: 12, width: 36, textAlign: "right" }}>
                  {r.正答率}%
                </span>
              </div>
            ))}
          </div>

          <p style={{ marginBottom: 8, color: "#000", fontSize: 14 }}>※下は数値テーブル（領域ごとの正解数・正答率）</p>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
              color: "#000",
              background: "#fff",
              border: "1px solid #999",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #666", background: "#f0f0f0" }}>
                <th style={{ textAlign: "left", padding: 10, color: "#000" }}>領域</th>
                <th style={{ textAlign: "right", padding: 10, color: "#000" }}>正解 / 総数</th>
                <th style={{ textAlign: "right", padding: 10, color: "#000" }}>正答率</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.domain} style={{ borderBottom: "1px solid #999" }}>
                  <td style={{ padding: 10, color: "#000" }}>{r.name}</td>
                  <td style={{ padding: 10, textAlign: "right", color: "#000" }}>
                    {r.正解数} / {r.総数}
                  </td>
                  <td style={{ padding: 10, textAlign: "right", color: "#000" }}>
                    {r.総数 === 0 ? "-" : `${r.正答率}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!loading && !hasAny && !msg && (
        <p style={{ color: "#000" }}>まだ解答履歴がありません。基本修行や復習で問題を解くとここに表示されます。</p>
      )}

      <hr style={{ margin: "24px 0" }} />
      <Link href="/" style={{ color: "#000" }}>
        ホームへ
      </Link>
    </main>
  );
}

export default function StudentDashboardPage() {
  return (
    <RequireStudentProfile>
      <StudentDashboardPageInner />
    </RequireStudentProfile>
  );
}
