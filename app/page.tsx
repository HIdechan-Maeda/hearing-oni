"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Link from "next/link";
import { isStudentProfileComplete } from "../lib/profileComplete";
import { fetchProfileRow } from "../lib/fetchProfileRow";
import { AFFILIATION_PRESETS, GRADE_OPTIONS } from "../lib/profileFieldOptions";

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
  | "information_support"
  | "development";

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
  { key: "development", label: "療育・発達（development）" },
];

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");

  const [domain, setDomain] = useState<DomainKey>("all");
  const [nickname, setNickname] = useState<string>("");
  /** プルダウン値: 北海道医療大学 | その他 | 未選択 */
  const [affiliation, setAffiliation] = useState<string>("");
  const [affiliationOther, setAffiliationOther] = useState<string>("");
  const [grade, setGrade] = useState<string>("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [questionCount, setQuestionCount] = useState<5 | 10 | 20>(10);
  const [isTeacher, setIsTeacher] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    const savedDomain = window.localStorage.getItem("hearing_oni_domain");
    if (savedDomain) setDomain(savedDomain as DomainKey);

    const savedCount = window.localStorage.getItem("hearing_oni_qcount");
    if (savedCount && ["5", "10", "20"].includes(savedCount)) {
      setQuestionCount(Number(savedCount) as 5 | 10 | 20);
    }

    const sp = new URLSearchParams(window.location.search);
    if (sp.get("needsProfile") === "1") {
      setMsg("先にニックネーム・所属・学年を登録してください。");
    }
    if (sp.get("profileError") === "1") {
      setMsg("プロフィールの取得に失敗しました。Supabase に affiliation / grade カラムを追加済みか確認してください。");
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

  // ログイン中はプロフィールを取得
  useEffect(() => {
    if (!userEmail) {
      setNickname("");
      setAffiliation("");
      setAffiliationOther("");
      setGrade("");
      setIsTeacher(false);
      setProfileLoaded(false);
      return;
    }
    const loadProfile = async () => {
      setProfileLoaded(false);
      setMsg("");
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const user = userData.user;

      let { data: profile, error: fetchErr } = await fetchProfileRow(user.id);

      if (fetchErr && !profile) {
        setMsg("プロフィール取得エラー: " + fetchErr.message);
        setProfileLoaded(true);
        return;
      }

      if (!profile) {
        const { error: upErr } = await supabase.from("profiles").upsert(
          {
            user_id: user.id,
            email: user.email ?? "",
          },
          { onConflict: "user_id" }
        );
        if (upErr) {
          setMsg("プロフィール初期化エラー: " + upErr.message);
          setProfileLoaded(true);
          return;
        }
        const again = await fetchProfileRow(user.id);
        if (again.error && !again.data) {
          setMsg("プロフィール取得エラー: " + again.error.message);
          setProfileLoaded(true);
          return;
        }
        profile = again.data;
      } else if ((profile.email ?? "") !== (user.email ?? "")) {
        const { error: updErr } = await supabase
          .from("profiles")
          .update({ email: user.email ?? "" })
          .eq("user_id", user.id);
        if (updErr) {
          console.error(updErr);
        }
      }

      const role = profile?.role ?? "";
      setIsTeacher(role.trim().toLowerCase() === "teacher");

      setNickname((profile?.name ?? "").trim());
      const aff = (profile?.affiliation ?? "").trim();
      if (aff === "北海道医療大学") {
        setAffiliation("北海道医療大学");
        setAffiliationOther("");
      } else if (aff) {
        setAffiliation("その他");
        setAffiliationOther(aff);
      } else {
        setAffiliation("");
        setAffiliationOther("");
      }
      const g = (profile?.grade ?? "").trim();
      setGrade(GRADE_OPTIONS.includes(g as (typeof GRADE_OPTIONS)[number]) ? g : "");
      setProfileLoaded(true);
    };
    loadProfile();
  }, [userEmail]);

  const effectiveAffiliation =
    affiliation === "その他" ? affiliationOther.trim() : affiliation.trim();
  const effectiveGrade = grade.trim();

  const studentProfileOk = isStudentProfileComplete(
    isTeacher ? "teacher" : null,
    nickname.trim(),
    effectiveAffiliation,
    effectiveGrade
  );

  const saveStudentProfile = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data: roleRow } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if ((roleRow?.role ?? "").trim().toLowerCase() === "teacher") {
      setMsg("");
      return;
    }
    const n = nickname.trim();
    const a = effectiveAffiliation;
    const g = effectiveGrade;
    if (!n || !a || !g) {
      setMsg("ニックネーム・所属・学年をすべて入力してください。");
      return;
    }
    if (!affiliation) {
      setMsg("所属を選択してください。");
      return;
    }
    if (affiliation === "その他" && !affiliationOther.trim()) {
      setMsg("「所属」でその他を選んだ場合は、所属名を入力してください。");
      return;
    }
    setProfileSaving(true);
    setMsg("");
    const { error } = await supabase.from("profiles").upsert(
      {
        user_id: userData.user.id,
        email: userData.user.email ?? "",
        name: n,
        affiliation: a,
        grade: g,
      },
      { onConflict: "user_id" }
    );
    setProfileSaving(false);
    if (error) {
      setMsg("プロフィール保存エラー: " + error.message);
      return;
    }
    setMsg("保存しました。学習メニューから問題に進めます。");
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

  const recentWrongHref = "/session?mode=recent_wrong&count=10";

  const showStudentGate = userEmail && profileLoaded && !isTeacher && !studentProfileOk;

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
      ) : !profileLoaded ? (
        <section
          style={{
            width: "100%",
            maxWidth: 420,
            padding: 24,
            borderRadius: 20,
            background: "rgba(255,255,255,0.98)",
            boxShadow: "0 18px 45px rgba(0,0,0,0.25)",
            textAlign: "center",
            color: "#000",
          }}
        >
          <p style={{ margin: 0, fontSize: 16 }}>プロフィールを読み込み中です…</p>
        </section>
      ) : showStudentGate ? (
        <section
          style={{
            width: "100%",
            maxWidth: 480,
            padding: 24,
            borderRadius: 20,
            background: "rgba(255,255,255,0.98)",
            boxShadow: "0 18px 45px rgba(0,0,0,0.25)",
          }}
        >
          <h1 style={{ marginTop: 0, fontSize: 22 }}>プロフィール登録（必須）</h1>
          <p style={{ marginTop: 0, fontSize: 14, color: "#333" }}>
            成績・学習状況の管理のため、以下を入力してから学習を開始してください。
          </p>
          <p style={{ fontSize: 13, color: "#555" }}>ログイン中：<b>{userEmail}</b></p>

          <label style={{ display: "block", marginTop: 14, color: "#000", fontWeight: 600 }}>ニックネーム</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="例: 山田"
            maxLength={50}
            style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc", boxSizing: "border-box" }}
          />

          <label style={{ display: "block", marginTop: 12, color: "#000", fontWeight: 600 }}>所属</label>
          <select
            value={affiliation}
            onChange={(e) => {
              setAffiliation(e.target.value);
              if (e.target.value !== "その他") setAffiliationOther("");
            }}
            style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc", marginBottom: 8 }}
          >
            <option value="">選択してください</option>
            {AFFILIATION_PRESETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          {affiliation === "その他" && (
            <input
              value={affiliationOther}
              onChange={(e) => setAffiliationOther(e.target.value)}
              placeholder="所属を入力（例: ○○大学 ○○学科）"
              maxLength={120}
              style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc", boxSizing: "border-box" }}
            />
          )}

          <label style={{ display: "block", marginTop: 12, color: "#000", fontWeight: 600 }}>学年</label>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc" }}
          >
            <option value="">選択してください</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>

          <button
            onClick={saveStudentProfile}
            disabled={profileSaving}
            style={{ ...btnStyle, marginTop: 18, width: "100%", background: "#0b4f9c", color: "#fff", borderColor: "#0b4f9c" }}
          >
            {profileSaving ? "保存中..." : "登録して学習を始める"}
          </button>
          <button onClick={signOut} type="button" style={{ ...btnStyle, marginTop: 10, width: "100%" }}>
            ログアウト
          </button>

          {msg && (
            <p style={{ color: msg.includes("保存しました") ? "#0a0" : "#b00", marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</p>
          )}
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
          <h1 style={{ marginTop: 0, marginBottom: 6, fontSize: 26, color: "#0b315b", letterSpacing: "0.02em" }}>
            聴覚・音響の鬼
          </h1>
          <p style={{ marginTop: 0, marginBottom: 16, fontSize: 14, color: "#444" }}>
            ログイン中：<b style={{ color: "#111" }}>{userEmail}</b>
            {isTeacher && (
              <span style={{ marginLeft: 8, fontSize: 13, color: "#0b4f9c", fontWeight: 600 }}>（教師）</span>
            )}
          </p>

          {!isTeacher && profileLoaded && studentProfileOk && (
            <div
              style={{
                marginTop: 12,
                marginBottom: 12,
                padding: 12,
                borderRadius: 12,
                background: "#f0f7ff",
                border: "1px solid #c5ddf5",
                fontSize: 14,
                color: "#000",
              }}
            >
              <div>
                <b>ニックネーム</b>：{nickname}
              </div>
              <div>
                <b>所属</b>：{effectiveAffiliation}
              </div>
              <div>
                <b>学年</b>：{effectiveGrade}
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#555" }}>
                変更する場合は下の欄を編集し「プロフィールを更新」を押してください。
              </p>
            </div>
          )}

          {!isTeacher && profileLoaded && (
            <div style={{ marginTop: 8, marginBottom: 10 }}>
              <label style={{ display: "block", color: "#000", marginBottom: 6, fontWeight: 600 }}>ニックネーム</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={50}
                style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc", boxSizing: "border-box" }}
              />
              <label style={{ display: "block", color: "#000", marginTop: 10, marginBottom: 6, fontWeight: 600 }}>所属</label>
              <select
                value={affiliation}
                onChange={(e) => {
                  setAffiliation(e.target.value);
                  if (e.target.value !== "その他") setAffiliationOther("");
                }}
                style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc", marginBottom: 8 }}
              >
                <option value="">選択してください</option>
                {AFFILIATION_PRESETS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              {affiliation === "その他" && (
                <input
                  value={affiliationOther}
                  onChange={(e) => setAffiliationOther(e.target.value)}
                  placeholder="所属を入力"
                  maxLength={120}
                  style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc", boxSizing: "border-box", marginBottom: 8 }}
                />
              )}
              <label style={{ display: "block", color: "#000", marginTop: 10, marginBottom: 6, fontWeight: 600 }}>学年</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 8, border: "1px solid #ccc" }}
              >
                <option value="">選択してください</option>
                {GRADE_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <button
                onClick={saveStudentProfile}
                disabled={profileSaving}
                style={{ ...btnStyle, marginTop: 10 }}
              >
                {profileSaving ? "保存中..." : "プロフィールを更新"}
              </button>
            </div>
          )}

          <div
            style={{
              marginTop: 8,
              marginBottom: 20,
              padding: 16,
              borderRadius: 14,
              background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)",
              border: "1px solid #d0e3f7",
              boxShadow: "0 4px 14px rgba(11, 79, 156, 0.06)",
            }}
          >
            <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#0b315b" }}>出題の設定</h2>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", color: "#333", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>領域</label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value as DomainKey)}
                style={{ width: "100%", padding: 12, fontSize: 16, borderRadius: 10, border: "1px solid #c5ddf5", background: "#fff", boxSizing: "border-box" }}
              >
                {DOMAIN_OPTIONS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", color: "#333", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>1セットの出題数</label>
              <select
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value) as 5 | 10 | 20)}
                style={{ width: "100%", padding: 12, fontSize: 16, borderRadius: 10, border: "1px solid #c5ddf5", background: "#fff", boxSizing: "border-box" }}
              >
                <option value={5}>5問</option>
                <option value={10}>10問</option>
                <option value={20}>20問</option>
              </select>
            </div>
          </div>

          <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#0b315b" }}>学習メニュー</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(158px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <Link href={sessionHref} style={menuCardStyle}>基本修行</Link>
            <Link href={oniSessionHref} style={{ ...menuCardStyle, borderColor: "#f5c6cb", background: "linear-gradient(180deg, #fff5f5 0%, #ffffff 100%)" }}>試練モード</Link>
            <Link href={recentWrongHref} style={menuCardStyle}>直近1週間の間違い</Link>
            <Link href="/review" style={menuCardStyle}>復習キュー</Link>
            <Link href="/logs" style={menuCardStyle}>日々の学習成果</Link>
            <Link href="/dashboard" style={menuCardStyle}>正答率グラフ</Link>
            {!isTeacher && <Link href="/ranking" style={menuCardStyle}>ランキング</Link>}
            {isTeacher && <Link href="/teacher" style={{ ...menuCardStyle, gridColumn: "1 / -1" }}>教師ダッシュボード</Link>}
          </div>

          <button onClick={signOut} type="button" style={{ ...btnStyle, width: "100%", maxWidth: 280, borderColor: "#bbb", color: "#444" }}>
            ログアウト
          </button>

          {msg && !showStudentGate && (
            <p style={{ color: msg.includes("保存しました") ? "#0a0" : "#b00", marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</p>
          )}
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

const menuCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 52,
  padding: "12px 14px",
  fontSize: 15,
  fontWeight: 600,
  textDecoration: "none",
  textAlign: "center",
  color: "#0b315b",
  borderRadius: 12,
  border: "1px solid #c5ddf5",
  background: "linear-gradient(180deg, #ffffff 0%, #f3f8ff 100%)",
  boxShadow: "0 2px 10px rgba(11, 79, 156, 0.08)",
  lineHeight: 1.35,
};
