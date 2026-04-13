"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import type { AnnouncementRow } from "../../../lib/announcements";
import { formatSupabaseError, supabaseProfileErrorHints } from "../../../lib/supabasePolicyHint";

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TeacherAnnouncementsPage() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [okTeacher, setOkTeacher] = useState(false);
  const [rows, setRows] = useState<AnnouncementRow[]>([]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publishedAtLocal, setPublishedAtLocal] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [saving, setSaving] = useState(false);

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
      setMsg("プロフィール取得エラー: " + formatSupabaseError(profErr) + supabaseProfileErrorHints(profErr.message));
      setLoading(false);
      return;
    }
    if ((prof?.role ?? "").trim().toLowerCase() !== "teacher") {
      setMsg("教師権限が必要です。");
      setLoading(false);
      return;
    }
    setOkTeacher(true);

    const { data, error } = await supabase
      .from("announcements")
      .select("id,title,body,published_at,is_active,created_at")
      .order("published_at", { ascending: false })
      .limit(50);

    if (error) {
      setMsg(
        "お知らせの取得に失敗しました: " +
          formatSupabaseError(error) +
          "\n\n※ Supabase で data/SUPABASE_announcements.sql を実行済みか確認してください。"
      );
      setRows([]);
    } else {
      setRows((data ?? []) as AnnouncementRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setMsg("");
    const t = title.trim();
    const b = body.trim();
    if (!t && !b) {
      setMsg("タイトルまたは本文のどちらかを入力してください。");
      return;
    }
    if (!publishedAtLocal) {
      setMsg("掲載日時を入力してください。");
      return;
    }
    const publishedIso = new Date(publishedAtLocal).toISOString();
    if (Number.isNaN(new Date(publishedIso).getTime())) {
      setMsg("掲載日時が不正です。");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("announcements").insert({
      title: t,
      body: b,
      published_at: publishedIso,
      is_active: true,
    });
    setSaving(false);
    if (error) {
      setMsg("登録に失敗しました: " + formatSupabaseError(error));
      return;
    }
    setTitle("");
    setBody("");
    setPublishedAtLocal(toDatetimeLocalValue(new Date().toISOString()));
    await load();
    setMsg("お知らせを登録しました。ホームに新しい順で最大2件まで表示されます。");
  };

  const toggleActive = async (id: string, next: boolean) => {
    setMsg("");
    const { error } = await supabase.from("announcements").update({ is_active: next }).eq("id", id);
    if (error) {
      setMsg("更新に失敗しました: " + formatSupabaseError(error));
      return;
    }
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("このお知らせを削除しますか？")) return;
    setMsg("");
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) {
      setMsg("削除に失敗しました: " + formatSupabaseError(error));
      return;
    }
    await load();
  };

  return (
    <main className="teacher-dashboard">
      <h1>お知らせ（ホーム上部）</h1>
      <p style={{ fontSize: 14, color: "#1a2d42", marginTop: 0 }}>
        登録した行のうち、<strong>有効</strong>かつ<strong>掲載日時が現在以前</strong>のもののなかで、<strong>掲載日時が最新</strong>の1件がホームに表示されます。履歴は下の一覧に残ります。
      </p>
      <p style={{ fontSize: 13, marginTop: 0 }}>
        <Link href="/teacher" style={{ color: "#0b4f9c" }}>
          ← 教師ダッシュボード
        </Link>
      </p>

      {msg && (
        <p style={{ color: msg.includes("登録しました") ? "#0a6b3c" : "#b00", whiteSpace: "pre-wrap" }}>{msg}</p>
      )}
      {loading && <p>読み込み中...</p>}

      {okTeacher && !loading && (
        <>
          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, color: "#0b315b" }}>新規登録</h2>
            <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>タイトル</label>
            <input
              className="input-elegant"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: アプリを更新しました"
              style={{ width: "100%", maxWidth: 480, marginBottom: 10 }}
            />
            <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>本文</label>
            <textarea
              className="input-elegant"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="変更内容や注意事項（改行可）"
              rows={5}
              style={{ width: "100%", maxWidth: 560, marginBottom: 10, resize: "vertical" }}
            />
            <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>掲載日時（この時刻以降にホームへ出ます）</label>
            <input
              type="datetime-local"
              className="input-elegant"
              value={publishedAtLocal}
              onChange={(e) => setPublishedAtLocal(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div>
              <button type="button" className="btn-primary-solid" onClick={submit} disabled={saving} style={{ opacity: saving ? 0.7 : 1 }}>
                {saving ? "保存中..." : "お知らせを追加"}
              </button>
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: 16, color: "#0b315b" }}>履歴（直近50件）</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f5f5f5" }}>
                    <th style={th}>掲載日時</th>
                    <th style={th}>タイトル</th>
                    <th style={th}>状態</th>
                    <th style={th}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={td}>{new Date(r.published_at).toLocaleString("ja-JP")}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{(r.title ?? "").trim() || "（無題）"}</div>
                        <div style={{ color: "#555", fontSize: 12, marginTop: 4, whiteSpace: "pre-wrap", maxWidth: 360 }}>
                          {(r.body ?? "").trim().slice(0, 120)}
                          {(r.body ?? "").length > 120 ? "…" : ""}
                        </div>
                      </td>
                      <td style={td}>{r.is_active ? "有効" : "無効"}</td>
                      <td style={td}>
                        <button
                          type="button"
                          onClick={() => toggleActive(r.id, !r.is_active)}
                          style={{ marginRight: 8, cursor: "pointer", fontSize: 12 }}
                        >
                          {r.is_active ? "無効化" : "有効化"}
                        </button>
                        <button type="button" onClick={() => remove(r.id)} style={{ cursor: "pointer", fontSize: 12, color: "#a33" }}>
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <p style={{ fontSize: 14 }}>まだお知らせがありません。</p>}
          </section>
        </>
      )}

      <hr style={{ margin: "24px 0" }} />
      <Link href="/">ホームへ</Link>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: 8, borderBottom: "1px solid #ccc" };
const td: React.CSSProperties = { padding: 8, verticalAlign: "top" };
