"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

type LogRow = {
  question_id: string;
  is_correct: boolean;
  answered_at: string;
};

type DayGroup = {
  date: string;
  label: string; // "3/10" など
  total: number;
  correct: number;
  正答率: number;
};

function barColor(正答率: number): string {
  if (正答率 >= 70) return "#4a7c59";
  if (正答率 >= 50) return "#b8860b";
  return "#a52a2a";
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildDays(rows: LogRow[]): DayGroup[] {
  const byDate = new Map<string, LogRow[]>();
  for (const row of rows) {
    const at = row.answered_at ? new Date(row.answered_at) : null;
    const key = at ? toLocalDateKey(at) : "";
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(row);
  }
  const result: DayGroup[] = [];
  for (const [date, dayLogs] of byDate.entries()) {
    const [, m, day] = date.split("-").map(Number);
    const label = `${m}/${day}`;
    const correct = dayLogs.filter((r) => r.is_correct).length;
    const total = dayLogs.length;
    const 正答率 = total > 0 ? Math.round((correct / total) * 100) : 0;
    result.push({ date, label, total, correct, 正答率 });
  }
  result.sort((a, b) => b.date.localeCompare(a.date));
  return result;
}

type FilterType = "all" | "core" | "oni";

export default function LogsPage() {
  const [rawLogs, setRawLogs] = useState<LogRow[]>([]);
  const [qTypeMap, setQTypeMap] = useState<Record<string, "oni" | "core">>({});
  const [filter, setFilter] = useState<FilterType>("all");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async (userId: string) => {
    const { data: logs, error } = await supabase
      .from("logs")
      .select("question_id,is_correct,answered_at")
      .eq("user_id", userId)
      .order("answered_at", { ascending: false })
      .limit(1000);

    if (error) {
      setMsg("データ取得エラー: " + error.message);
      return;
    }
    const rows = (logs ?? []) as LogRow[];
    setRawLogs(rows);

    const ids = [...new Set(rows.map((r) => r.question_id))];
    if (ids.length === 0) {
      setQTypeMap({});
      return;
    }
    const { data: questions } = await supabase
      .from("questions_core")
      .select("id,difficulty")
      .in("id", ids);
    const map: Record<string, "oni" | "core"> = {};
    for (const row of questions ?? []) {
      const id = (row as { id: string; difficulty: string | null }).id;
      const d = (row as { id: string; difficulty: string | null }).difficulty;
      map[id] = (d ?? "").toLowerCase() === "oni" ? "oni" : "core";
    }
    setQTypeMap(map);
  }, []);

  const filteredLogs = rawLogs.filter((r) => {
    const type = qTypeMap[r.question_id] ?? "core";
    if (filter === "all") return true;
    return filter === type;
  });
  const days = buildDays(filteredLogs);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const load = async () => {
      setLoading(true);
      setMsg("");
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        setMsg("ログインしてください。");
        setLoading(false);
        return;
      }
      const userId = userData.user.id;

      await fetchLogs(userId);
      setLoading(false);

      // リアルタイム: 自分の logs に INSERT があったら再取得してグラフを更新
      channel = supabase
        .channel("logs-realtime")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "logs",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            fetchLogs(userId);
          }
        )
        .subscribe();
    };

    load();
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchLogs]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16, color: "#000" }}>
      <p style={{ marginBottom: 12 }}>
        <Link href="/" style={backStyle}>← ホームへ</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>日々の学習成果</h1>
      <p style={{ color: "#333", fontSize: 14, marginBottom: 16 }}>
        日付ごとの正答率と解答数をグラフで確認できます。解答するたびに自動で更新されます。
      </p>

      {!loading && rawLogs.length > 0 && (
        <p style={{ marginBottom: 12 }}>
          <label style={{ marginRight: 8, color: "#000" }}>表示:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            style={{ padding: "6px 10px", fontSize: 14, borderRadius: 6, border: "1px solid #999" }}
          >
            <option value="all">すべて</option>
            <option value="core">CORE</option>
            <option value="oni">鬼問題</option>
          </select>
        </p>
      )}

      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      {loading && <p>読み込み中...</p>}

      {!loading && rawLogs.length === 0 && !msg && (
        <p style={{ color: "#000" }}>
          まだ記録がありません。基本修行や復習で問題を解くと、ここに日々の成果が表示されます。
        </p>
      )}

      {!loading && rawLogs.length > 0 && days.length === 0 && (
        <p style={{ color: "#000" }}>
          {filter === "all" ? "記録がありません。" : filter === "core" ? "COREの記録がありません。" : "鬼問題の記録がありません。"}
        </p>
      )}

      {!loading && days.length > 0 && (
        <>
          <section style={chartSectionStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <span style={{ color: "#fff", fontSize: 12, width: 48, flexShrink: 0 }}>日付</span>
              <span style={{ color: "#fff", fontSize: 11, flex: 1 }}>0%</span>
              <span style={{ color: "#fff", fontSize: 11 }}>100%</span>
            </div>
            {days.map((d) => (
              <div key={d.date} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ color: "#fff", fontSize: 12, width: 48, flexShrink: 0 }}>{d.label}</span>
                <div
                  style={{
                    flex: 1,
                    height: 22,
                    background: "#444",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${d.正答率}%`,
                      height: "100%",
                      background: barColor(d.正答率),
                      borderRadius: 4,
                      minWidth: d.正答率 > 0 ? 4 : 0,
                    }}
                  />
                </div>
                <span style={{ color: "#fff", fontSize: 12, width: 80, textAlign: "right" }}>
                  {d.正答率}% ({d.correct}/{d.total})
                </span>
              </div>
            ))}
          </section>

          <p style={{ marginBottom: 8, color: "#000", fontSize: 14 }}>数値一覧</p>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>日付</th>
                <th style={thStyle}>解答数</th>
                <th style={thStyle}>正解数</th>
                <th style={thStyle}>正答率</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td style={tdStyle}>{d.label}</td>
                  <td style={tdStyle}>{d.total}</td>
                  <td style={tdStyle}>{d.correct}</td>
                  <td style={tdStyle}>{d.正答率}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <hr style={{ margin: "18px 0" }} />
      <Link href="/" style={linkStyle}>ホームへ</Link>
    </main>
  );
}

const chartSectionStyle: React.CSSProperties = {
  width: "100%",
  marginBottom: 24,
  background: "#333",
  borderRadius: 12,
  padding: "16px 12px",
  boxSizing: "border-box",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
  background: "#fff",
  border: "1px solid #999",
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  background: "#f0f0f0",
  borderBottom: "2px solid #666",
  color: "#000",
};
const tdStyle: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid #ddd",
  color: "#000",
};
const backStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #ccc",
  textDecoration: "none",
  color: "#000",
  background: "#fff",
};
const linkStyle: React.CSSProperties = { ...backStyle, display: "inline-block" };
