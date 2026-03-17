"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Link from "next/link";

type DomainKey =
  | "all"
  | "anatomy"
  | "physiology"
  | "acoustics"
  | "psychoacoustics"
  | "audiometry"
  | "hearing_aids"
  | "evoked"
  | "vestibular"
  | "disease"
  | "information_support";

const DOMAIN_OPTIONS: Array<{ key: DomainKey; label: string }> = [
  { key: "all", label: "全領域（ランダム）" },
  { key: "anatomy", label: "解剖（anatomy）" },
  { key: "physiology", label: "生理（physiology）" },
  { key: "acoustics", label: "音響（acoustics）" },
  { key: "psychoacoustics", label: "聴覚心理（psychoacoustics）" },
  { key: "audiometry", label: "聴力検査（audiometry）" },
  { key: "hearing_aids", label: "補聴器（hearing_aids）" },
  { key: "evoked", label: "電気生理（evoked）" },
  { key: "vestibular", label: "前庭（vestibular）" },
  { key: "disease", label: "病気・統合問題（disease）" },
  { key: "information_support", label: "情報保障（information support）" },
];

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");

  const [domain, setDomain] = useState<DomainKey>("all");
  const [nickname, setNickname] = useState<string>("");
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [questionCount, setQuestionCount] = useState<5 | 10 | 20>(10);
  const [isTeacher, setIsTeacher] = useState(false);

  useEffect(() => {
    const savedDomain = window.localStorage.getItem("hearing_oni_domain");
    if (savedDomain) setDomain(savedDomain as DomainKey);

    const savedCount = window.localStorage.getItem("hearing_oni_qcount");
    if (savedCount && ["5", "10", "20"].includes(savedCount)) {
      setQuestionCount(Number(savedCount) as 5 | 10 | 20);
    }

    const getSession = async () => {
      const { data } = await supabase.auth.getSession();
      setUserEmail(data.session?.user.email ?? null);
    };
    getSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ログイン中はプロフィール（ニックネーム）を取得
  useEffect(() => {
    if (!userEmail) {
      setNickname("");
      setIsTeacher(false);
      return;
    }
    const loadProfile = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const user = userData.user;

      // プロフィールがなければ、Auth の email だけでも保存しておく
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("name,role,email")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile || error) {
        await supabase.from("profiles").upsert(
          {
            user_id: user.id,
            email: user.email ?? "",
            name: profile?.name ?? null,
          },
          { onConflict: "user_id" }
        );
      }

      setNickname((profile?.name ?? "") || "");
      setIsTeacher((profile?.role ?? "") === "teacher");
    };
    loadProfile();
  }, [userEmail]);

  const saveNickname = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    setNicknameSaving(true);
    setMsg("");
    const { error } = await supabase.from("profiles").upsert(
      {
        user_id: userData.user.id,
        email: userData.user.email ?? "",
        name: nickname.trim() || null,
      },
      { onConflict: "user_id" }
    );
    setNicknameSaving(false);
    if (error) setMsg("ニックネーム保存エラー: " + error.message);
  };

  useEffect(() => {
    window.localStorage.setItem("hearing_oni_domain", domain);
  }, [domain]);

  useEffect(() => {
    window.localStorage.setItem("hearing_oni_qcount", String(questionCount));
  }, [questionCount]);

  const signIn = async () => {
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg("ログイン失敗: " + error.message);
  };

  const signUp = async () => {
    setMsg("");
    const trimmed = email.trim();
    if (!trimmed.endsWith("@hoku-iryo-u.ac.jp")) {
      setMsg("新規登録は学内メールアドレス（@hoku-iryo-u.ac.jp）のみ利用できます。");
      return;
    }
    if (!password) {
      setMsg("パスワードを入力してください。");
      return;
    }
    const { error } = await supabase.auth.signUp({ email: trimmed, password });
    if (error) {
      setMsg("新規登録失敗: " + error.message);
    } else {
      setMsg("仮登録しました。メールに届く案内を確認してください。");
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const sessionHref = useMemo(() => {
    const params = new URLSearchParams();
    if (domain !== "all") params.set("domain", domain);
    params.set("count", String(questionCount));
    const q = params.toString();
    return q ? `/session?${q}` : "/session";
  }, [domain, questionCount]);

  const oniSessionHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("mode", "oni");
    params.set("count", String(questionCount));
    return `/session?${params.toString()}`;
  }, [questionCount]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "linear-gradient(145deg, #0b315b, #1c7ed6)",
      }}
    >
      {!userEmail ? (
        <section
          style={{
            width: "100%",
            maxWidth: 420,
            padding: 24,
            borderRadius: 20,
            background: "rgba(255,255,255,0.96)",
            boxShadow: "0 18px 45px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <img
              src="/choukaku-oni-512.png"
              alt="聴覚の鬼ロゴ"
              style={{ width: 80, height: 80, borderRadius: 20, marginBottom: 8 }}
            />
            <h1 style={{ margin: 0, fontSize: 24 }}>聴覚・音響の鬼</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#555" }}>
              学内メールで新規登録してからログインしてください。
            </p>
          </div>

          <label style={{ display: "block", marginTop: 8, color: "#000", fontSize: 14 }}>Email（@hoku-iryo-u.ac.jp）</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@hoku-iryo-u.ac.jp"
            style={{ width: "100%", padding: 10, fontSize: 16, boxSizing: "border-box", borderRadius: 10, border: "1px solid #ccc" }}
          />

          <label style={{ display: "block", marginTop: 10, color: "#000", fontSize: 14 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            style={{ width: "100%", padding: 10, fontSize: 16, boxSizing: "border-box", borderRadius: 10, border: "1px solid #ccc" }}
          />

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={signIn} style={{ ...btnStyle, flex: 1 }}>ログイン</button>
            <button onClick={signUp} style={{ ...btnStyle, flex: 1, background: "#0b4f9c", color: "#fff", borderColor: "#0b4f9c" }}>
              新規登録
            </button>
          </div>

          {msg && <p style={{ color: "#b00", marginTop: 10, whiteSpace: "pre-wrap" }}>{msg}</p>}
        </section>
      ) : (
        <section
          style={{
            width: "100%",
            maxWidth: 720,
            padding: 24,
            borderRadius: 20,
            background: "rgba(255,255,255,0.98)",
            boxShadow: "0 18px 45px rgba(0,0,0,0.25)",
          }}
        >
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>聴覚・音響の鬼 (MVP)</h1>
          <p style={{ marginTop: 0 }}>
            ログイン中：<b>{userEmail}</b>
          </p>

          <div style={{ marginTop: 12, marginBottom: 10 }}>
            <label style={{ display: "block", color: "#000", marginBottom: 6 }}>ニックネーム（教師ダッシュボードに表示）</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="例: 田中"
                maxLength={50}
                style={{ flex: "1 1 200px", minWidth: 120, padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc", boxSizing: "border-box" }}
              />
              <button onClick={saveNickname} disabled={nicknameSaving} style={btnStyle}>
                {nicknameSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, marginBottom: 10 }}>
            <div style={{ color: "#000", marginBottom: 6 }}>領域別出題</div>
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value as DomainKey)}
              style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid #ccc" }}
            >
              {DOMAIN_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 4, marginBottom: 12 }}>
            <div style={{ color: "#000", marginBottom: 6 }}>1セットの出題数</div>
            <select
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value) as 5 | 10 | 20)}
              style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid #ccc" }}
            >
              <option value={5}>5問</option>
              <option value={10}>10問</option>
              <option value={20}>20問</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href={sessionHref} style={linkBtnStyle}>基本修行</Link>
            <Link href={oniSessionHref} style={linkBtnStyle}>試練モード</Link>
            <Link href="/review" style={linkBtnStyle}>復習（キュー）</Link>
            <Link href="/logs" style={linkBtnStyle}>日々の学習成果</Link>
            <Link href="/dashboard" style={linkBtnStyle}>正答率グラフ</Link>
            {isTeacher && (
              <Link href="/teacher" style={linkBtnStyle}>教師ダッシュボード</Link>
            )}
            <button onClick={signOut} style={btnStyle}>ログアウト</button>
          </div>
        </section>
      )}
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 16,
  cursor: "pointer",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#fff",
  color: "#000",
};

const linkBtnStyle: React.CSSProperties = {
  ...btnStyle,
  textDecoration: "none",
  display: "inline-block",
  color: "#000",
};
