"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { formatSupabaseError, supabaseProfileErrorHints } from "../../../lib/supabasePolicyHint";
import { isEmailUniversityDomain, normalizeSignupEmail } from "../../../lib/allowedSignUpEmails";

type AllowRow = {
  id: string;
  email: string;
  memo: string | null;
  created_at: string;
};

export default function TeacherSignupAllowlistPage() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [okTeacher, setOkTeacher] = useState(false);
  const [rows, setRows] = useState<AllowRow[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newMemo, setNewMemo] = useState("");
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
      .from("signup_allowlist")
      .select("id,email,memo,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setMsg(
        "許可リストの取得に失敗しました: " +
          formatSupabaseError(error) +
          "\n\n※ Supabase で data/SUPABASE_signup_allowlist.sql を実行済みか確認してください。"
      );
      setRows([]);
    } else {
      setRows((data ?? []) as AllowRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addRow = async () => {
    const e = normalizeSignupEmail(newEmail);
    setMsg("");
    if (!e || !e.includes("@")) {
      setMsg("有効なメールアドレスを入力してください。");
      return;
    }
    if (isEmailUniversityDomain(e)) {
      setMsg("学内メール（@hoku-iryo-u.ac.jp）はもともと登録可能なため、許可リストに追加する必要はありません。");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("signup_allowlist").insert({
      email: e,
      memo: newMemo.trim() || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
        setMsg("このメールアドレスは既に登録されています。");
      } else {
        setMsg("追加に失敗しました: " + formatSupabaseError(error));
      }
      return;
    }
    setNewEmail("");
    setNewMemo("");
    await load();
  };

  const removeRow = async (id: string) => {
    if (!confirm("この許可を削除しますか？（未登録のユーザーが新規登録できなくなります）")) return;
    setMsg("");
    const { error } = await supabase.from("signup_allowlist").delete().eq("id", id);
    if (error) {
      setMsg("削除に失敗しました: " + formatSupabaseError(error));
      return;
    }
    await load();
  };

  return (
    <main className="teacher-dashboard">
      <h1>新規登録・許可メール（学外）</h1>
      <p style={{ fontSize: 14, color: "#1a2d42", marginTop: 0 }}>
        学内メール（@hoku-iryo-u.ac.jp）はそのまま登録可能です。学外メールは、ここに追加したアドレスのみ新規登録できます。
      </p>

      {loading && <p>読み込み中...</p>}
      {!loading && !okTeacher && msg && <p style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</p>}

      {!loading && okTeacher && (
        <>
          {msg && (
            <p style={{ color: msg.includes("失敗") ? "#b00" : "#0a0", whiteSpace: "pre-wrap" }}>{msg}</p>
          )}

          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, color: "#0b315b" }}>メールを追加</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginTop: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>メール</label>
                <input
                  className="input-elegant"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  style={{ width: 280 }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>メモ（任意）</label>
                <input
                  className="input-elegant"
                  value={newMemo}
                  onChange={(e) => setNewMemo(e.target.value)}
                  placeholder="所属・理由など"
                  style={{ width: 220 }}
                />
              </div>
              <button
                type="button"
                onClick={addRow}
                disabled={saving}
                className="btn-primary-solid"
                style={{ opacity: saving ? 0.7 : 1 }}
              >
                {saving ? "追加中..." : "追加"}
              </button>
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: 16, color: "#0b315b" }}>許可一覧（{rows.length} 件）</h2>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f5f5f5" }}>
                    <th style={thStyle}>メール</th>
                    <th style={thStyle}>メモ</th>
                    <th style={thStyle}>追加日時</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={tdStyle}>
                        まだありません。学外利用者のメールを上から追加してください。
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id}>
                        <td style={tdStyle}>{r.email}</td>
                        <td style={tdStyle}>{r.memo ?? "—"}</td>
                        <td style={tdStyle}>{new Date(r.created_at).toLocaleString("ja-JP")}</td>
                        <td style={tdStyle}>
                          <button type="button" onClick={() => removeRow(r.id)} style={{ color: "#c00", cursor: "pointer" }}>
                            削除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p style={{ marginTop: 24 }}>
            <Link href="/teacher">← 教師ダッシュボード</Link>
            {" · "}
            <Link href="/">ホームへ</Link>
          </p>
        </>
      )}
    </main>
  );
}

const thStyle: CSSProperties = {
  borderBottom: "2px solid #ccc",
  padding: 8,
  textAlign: "left",
  fontSize: 12,
  color: "#0a1f3a",
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: 8,
  color: "#0a1f3a",
};
