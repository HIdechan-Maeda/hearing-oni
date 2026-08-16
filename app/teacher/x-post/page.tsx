"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { formatSupabaseError, supabaseProfileErrorHints } from "@/lib/supabasePolicyHint";

type Preview = {
  questionId: string;
  tweet1: string;
  tweet2: string;
  stem: string;
  answerLabel: string;
};

type PickResponse = {
  error?: string;
  message?: string;
  preview?: Preview;
  poolSize?: number;
  alreadyPostedCount?: number;
  note?: string | null;
};

type PostResponse = {
  error?: string;
  message?: string;
  ok?: boolean;
  tweet1Id?: string;
  tweet2Id?: string;
  logWarning?: string | null;
  urls?: { tweet1: string; tweet2: string };
  preview?: Preview;
  missingXEnv?: string[];
};

type EnvCheckResponse = {
  ok?: boolean;
  present?: Record<string, boolean>;
  missing?: string[];
  vercelEnv?: string | null;
  deploymentId?: string | null;
  error?: string;
  message?: string;
};

async function bearer(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

export default function TeacherXPostPage() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [okTeacher, setOkTeacher] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [meta, setMeta] = useState<{ poolSize?: number; alreadyPostedCount?: number; note?: string | null }>({});
  const [lastUrls, setLastUrls] = useState<{ tweet1: string; tweet2: string } | null>(null);

  const load = useCallback(async () => {
    setMsg("");
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      setMsg("ログインしてください。");
      setLoading(false);
      return;
    }
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (profErr) {
      setMsg(
        "プロフィール取得エラー: " + formatSupabaseError(profErr) + supabaseProfileErrorHints(profErr.message)
      );
      setLoading(false);
      return;
    }
    if ((prof?.role ?? "").trim().toLowerCase() !== "teacher") {
      setMsg("教師権限が必要です。");
      setLoading(false);
      return;
    }
    setOkTeacher(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const pickQuestion = async () => {
    setMsg("");
    setLastUrls(null);
    setBusy(true);
    const token = await bearer();
    if (!token) {
      setBusy(false);
      setMsg("セッションが無効です。再ログインしてください。");
      return;
    }
    const res = await fetch("/api/teacher/x/pick", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: keyword.trim() || null }),
    });
    const json = (await res.json().catch(() => ({}))) as PickResponse;
    setBusy(false);
    if (!res.ok) {
      setPreview(null);
      setMsg(json.message ?? json.error ?? `取得失敗（HTTP ${res.status}）`);
      return;
    }
    setPreview(json.preview ?? null);
    setMeta({
      poolSize: json.poolSize,
      alreadyPostedCount: json.alreadyPostedCount,
      note: json.note,
    });
    setMsg("プレビューを確認し、問題なければ「Xにスレッド投稿」を押してください。");
  };

  const checkEnv = async () => {
    setMsg("");
    setBusy(true);
    const token = await bearer();
    if (!token) {
      setBusy(false);
      setMsg("セッションが無効です。再ログインしてください。");
      return;
    }
    const res = await fetch("/api/teacher/x/env-check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as EnvCheckResponse;
    setBusy(false);
    if (!res.ok) {
      setMsg(json.message ?? json.error ?? `環境変数チェック失敗（HTTP ${res.status}）`);
      return;
    }
    const lines = Object.entries(json.present ?? {}).map(
      ([k, v]) => `${k}: ${v ? "あり" : "なし"}`
    );
    setMsg(
      [
        json.ok ? "X 環境変数は揃っています。" : "X 環境変数が不足しています（このデプロイ時点）。",
        ...lines,
        `VERCEL_ENV=${json.vercelEnv ?? "?"}`,
        json.missing && json.missing.length > 0 ? `不足: ${json.missing.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  };

  const postThread = async () => {
    if (!preview) return;
    setMsg("");
    setBusy(true);
    const token = await bearer();
    if (!token) {
      setBusy(false);
      setMsg("セッションが無効です。再ログインしてください。");
      return;
    }
    const res = await fetch("/api/teacher/x/post", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: preview.questionId }),
    });
    const json = (await res.json().catch(() => ({}))) as PostResponse;
    setBusy(false);
    if (!res.ok) {
      const missing =
        Array.isArray(json.missingXEnv) && json.missingXEnv.length > 0
          ? `\n未設定: ${json.missingXEnv.join(", ")}`
          : "";
      setMsg((json.message ?? json.error ?? `投稿失敗（HTTP ${res.status}）`) + missing);
      return;
    }
    setLastUrls(json.urls ?? null);
    setMsg(
      json.logWarning
        ? `投稿成功。※${json.logWarning}`
        : "スレッド投稿に成功しました（1:問題 / 2:正答・解説）。"
    );
  };

  return (
    <main className="teacher-dashboard">
      <h1>X スレッド投稿（問題 → 正答・解説）</h1>
      <p style={{ fontSize: 14, color: "#1a2d42", marginTop: 0 }}>
        <Link href="/teacher">← 教師ダッシュボード</Link>
      </p>
      <p style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 720, color: "#1a2d42" }}>
        1) 問題をピックアップしてプレビュー → 2) OKなら X にスレッド投稿。
        URL誘導なし。投稿1＝問題＋選択肢、投稿2（返信）＝正答＋解説＋
        <code>#言語聴覚士 #国試対策</code>。
      </p>
      <aside
        style={{
          maxWidth: 720,
          padding: "10px 12px",
          fontSize: 12,
          lineHeight: 1.55,
          background: "#f4f8fc",
          border: "1px solid #c5d6e8",
          borderRadius: 6,
        }}
      >
        Vercel 環境変数: <code>X_API_KEY</code> / <code>X_API_KEY_SECRET</code> /{" "}
        <code>X_ACCESS_TOKEN</code> / <code>X_ACCESS_TOKEN_SECRET</code>（Read and write）。
        <br />
        重複防止: Supabase で <code>data/SUPABASE_x_question_posts.sql</code> を実行。
      </aside>

      {loading && <p>読み込み中…</p>}
      {!loading && !okTeacher && msg && <p style={{ color: "#b00" }}>{msg}</p>}

      {!loading && okTeacher && (
        <>
          {msg && (
            <p style={{ color: msg.includes("成功") || msg.startsWith("プレビュー") ? "#063" : "#b00", whiteSpace: "pre-wrap" }}>
              {msg}
            </p>
          )}

          <section style={{ marginTop: 16, maxWidth: 640 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>キーワード（任意）</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="例: 聴覚フィルタ / ABR"
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
          </section>

          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={busy} onClick={() => void checkEnv()} style={{ padding: "10px 16px" }}>
              環境変数チェック
            </button>
            <button type="button" disabled={busy} onClick={() => void pickQuestion()} style={{ padding: "10px 16px", fontWeight: 600 }}>
              {busy ? "処理中…" : "1. 問題をピックアップ"}
            </button>
            <button
              type="button"
              disabled={busy || !preview}
              onClick={() => void postThread()}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                background: preview ? "#1d9bf0" : undefined,
                color: preview ? "#fff" : undefined,
                border: "none",
                borderRadius: 4,
                opacity: preview ? 1 : 0.5,
                cursor: preview ? "pointer" : "not-allowed",
              }}
            >
              2. X にスレッド投稿
            </button>
          </div>

          {(meta.poolSize != null || meta.alreadyPostedCount != null) && (
            <p style={{ fontSize: 12, color: "#555", marginTop: 10 }}>
              候補 {meta.poolSize ?? "—"} 件 / 投稿済み記録 {meta.alreadyPostedCount ?? "—"} 件
              {meta.note ? ` ※${meta.note}` : ""}
            </p>
          )}

          {preview && (
            <section style={{ marginTop: 20, maxWidth: 640 }}>
              <h2 style={{ fontSize: 16 }}>プレビュー（id: {preview.questionId}）</h2>
              <article style={{ marginTop: 10, padding: 12, border: "1px solid #ccc", borderRadius: 8, background: "#fff" }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>投稿1（問題）</div>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 14 }}>{preview.tweet1}</pre>
              </article>
              <article style={{ marginTop: 10, padding: 12, border: "1px solid #ccc", borderRadius: 8, background: "#f8fff8" }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>投稿2（続き＝正答・解説）</div>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 14 }}>{preview.tweet2}</pre>
              </article>
            </section>
          )}

          {lastUrls && (
            <p style={{ marginTop: 16, fontSize: 14 }}>
              <a href={lastUrls.tweet1} target="_blank" rel="noreferrer">
                投稿1を開く
              </a>
              {" · "}
              <a href={lastUrls.tweet2} target="_blank" rel="noreferrer">
                投稿2（続き）を開く
              </a>
            </p>
          )}
        </>
      )}
    </main>
  );
}
