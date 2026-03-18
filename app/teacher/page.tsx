"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

type DomainKey =
  | "anatomy"
  | "physiology"
  | "acoustics"
  | "psychoacoustics"
  | "audiometry"
  | "hearing_aids"
  | "evoked"
  | "vestibular"
  | "development";

const DOMAIN_OPTIONS: Array<{ key: DomainKey; label: string }> = [
  { key: "anatomy", label: "解剖（anatomy）" },
  { key: "physiology", label: "生理（physiology）" },
  { key: "acoustics", label: "音響（acoustics）" },
  { key: "psychoacoustics", label: "聴覚心理（psychoacoustics）" },
  { key: "audiometry", label: "聴力検査（audiometry）" },
  { key: "hearing_aids", label: "補聴器（hearing_aids）" },
  { key: "evoked", label: "電気生理（evoked）" },
  { key: "vestibular", label: "前庭（vestibular）" },
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
  stats: Record<DomainKey, DomainStat>;
};

type ProfileRow = {
  user_id: string;
  email: string;
  name: string | null;
  role?: string | null;
};

export default function TeacherDashboardPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

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
        setMsg("プロフィール取得エラー: " + profErr.message);
        setLoading(false);
        return;
      }

      if (!myProfile || myProfile.role !== "teacher") {
        setMsg("教師権限が必要です。profiles.role = 'teacher' に設定してください。");
        setLoading(false);
        return;
      }

      // logs 全体を取得（RLS で teacher のみ全件SELECT可能にしておく）
      const { data: logs, error: logsErr } = await supabase
        .from("logs")
        .select("user_id,is_correct,tags_raw")
        .limit(20000);

      if (logsErr) {
        setMsg("ログ取得エラー: " + logsErr.message);
        setLoading(false);
        return;
      }

      if (!logs || logs.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const userIds = Array.from(new Set(logs.map((l: any) => l.user_id).filter(Boolean)));

      const { data: profiles, error: allProfErr } = await supabase
        .from("profiles")
        .select("user_id,email,name")
        .in("user_id", userIds)
        .returns<ProfileRow[]>();

      if (allProfErr) {
        setMsg("受講生プロフィール取得エラー: " + allProfErr.message);
        setLoading(false);
        return;
      }

      const profileMap = new Map<string, ProfileRow>();
      for (const p of profiles ?? []) {
        profileMap.set(p.user_id, p);
      }

      // ユーザー × 領域別の統計を集計
      const statsByUser: Record<string, Record<DomainKey, DomainStat>> = {};

      for (const log of logs as Array<{ user_id: string; is_correct: boolean; tags_raw: string | null }>) {
        const uid = log.user_id;
        if (!uid) continue;

        if (!statsByUser[uid]) {
          const initStats: Record<DomainKey, DomainStat> = {} as any;
          for (const { key } of DOMAIN_OPTIONS) {
            initStats[key] = { total: 0, correct: 0 };
          }
          statsByUser[uid] = initStats;
        }

        const tagsRaw = log.tags_raw ?? "";
        const lower = tagsRaw.toLowerCase();
        const isCorrect = !!log.is_correct;

        for (const { key } of DOMAIN_OPTIONS) {
          if (lower.includes(key.toLowerCase())) {
            statsByUser[uid][key].total += 1;
            if (isCorrect) statsByUser[uid][key].correct += 1;
          }
        }
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
            stats,
          };
        });

      // 表示を安定させるためメールでソート
      resultRows.sort((a, b) => a.email.localeCompare(b.email));

      setRows(resultRows);
      setLoading(false);
    };

    load();
  }, []);

  const hasData = useMemo(() => rows.length > 0, [rows.length]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
      <h1>教師ダッシュボード（領域別 正答率）</h1>

      {msg && <p style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</p>}

      {loading && <p>読み込み中...</p>}

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
                      <div style={{ color: "#000", fontSize: 12 }}>{row.email}</div>
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

      <hr style={{ margin: "18px 0" }} />
      <Link href="/" style={{ textDecoration: "none" }}>
        ホームへ
      </Link>
    </main>
  );
}

const thStyle: React.CSSProperties = {
  borderBottom: "1px solid #ccc",
  padding: 6,
  textAlign: "left",
  background: "#fafafa",
  fontSize: 13,
  color: "#000",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: 6,
  fontSize: 13,
  color: "#000",
};

