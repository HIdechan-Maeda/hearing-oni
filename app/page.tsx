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
    <main className="app-shell">
      {!userEmail ? (
        <section className="glass-panel glass-panel--narrow">
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <img
              src="/choukaku-oni-512.png"
              alt="聴覚の鬼ロゴ"
              style={{ width: 88, height: 88, borderRadius: 22, marginBottom: 10, boxShadow: "0 8px 24px rgba(0,40,100,0.15)" }}
            />
            <h1 style={{ margin: 0, fontSize: 26, color: "#0b315b", letterSpacing: "0.04em" }}>聴覚・音響の鬼</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#5a6b7c", lineHeight: 1.5 }}>
              学内メールで新規登録してからログインしてください。
            </p>
          </div>

          <label style={{ display: "block", marginTop: 8, color: "#334", fontSize: 13, fontWeight: 600 }}>Email（@hoku-iryo-u.ac.jp）</label>
          <input
            className="input-elegant"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@hoku-iryo-u.ac.jp"
          />

          <label style={{ display: "block", marginTop: 12, color: "#334", fontSize: 13, fontWeight: 600 }}>Password</label>
          <input
            className="input-elegant"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
          />

          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            <button type="button" onClick={signIn} className="btn-primary-solid" style={{ flex: 1, minWidth: 120 }}>
              ログイン
            </button>
            <button type="button" onClick={signUp} className="btn-accent-outline" style={{ flex: 1, minWidth: 120 }}>
              新規登録
            </button>
          </div>

          {msg && <p style={{ color: "#b00", marginTop: 12, whiteSpace: "pre-wrap", fontSize: 14 }}>{msg}</p>}
        </section>
      ) : !profileLoaded ? (
        <section className="glass-panel glass-panel--narrow" style={{ textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 16, color: "#334" }}>プロフィールを読み込み中です…</p>
        </section>
      ) : showStudentGate ? (
        <section className="glass-panel glass-panel--gate">
          <h1 style={{ marginTop: 0, fontSize: 22 }}>プロフィール登録（必須）</h1>
          <p style={{ marginTop: 0, fontSize: 14, color: "#333" }}>
            成績・学習状況の管理のため、以下を入力してから学習を開始してください。
          </p>
          <p style={{ fontSize: 13, color: "#555" }}>ログイン中：<b>{userEmail}</b></p>

          <label style={{ display: "block", marginTop: 14, color: "#334", fontWeight: 600, fontSize: 13 }}>ニックネーム</label>
          <input
            className="input-elegant"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="例: 山田"
            maxLength={50}
          />

          <label style={{ display: "block", marginTop: 12, color: "#334", fontWeight: 600, fontSize: 13 }}>所属</label>
          <select
            className="input-elegant"
            value={affiliation}
            onChange={(e) => {
              setAffiliation(e.target.value);
              if (e.target.value !== "その他") setAffiliationOther("");
            }}
            style={{ marginBottom: 8 }}
          >
            <option value="">選択してください</option>
            {AFFILIATION_PRESETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          {affiliation === "その他" && (
            <input
              className="input-elegant"
              value={affiliationOther}
              onChange={(e) => setAffiliationOther(e.target.value)}
              placeholder="所属を入力（例: ○○大学 ○○学科）"
              maxLength={120}
            />
          )}

          <label style={{ display: "block", marginTop: 12, color: "#334", fontWeight: 600, fontSize: 13 }}>学年</label>
          <select className="input-elegant" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">選択してください</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={saveStudentProfile}
            disabled={profileSaving}
            className="btn-primary-solid"
            style={{ marginTop: 18, width: "100%", opacity: profileSaving ? 0.7 : 1 }}
          >
            {profileSaving ? "保存中..." : "登録して学習を始める"}
          </button>
          <button onClick={signOut} type="button" className="btn-logout-soft" style={{ marginTop: 12, maxWidth: "100%" }}>
            ログアウト
          </button>

          {msg && (
            <p style={{ color: msg.includes("保存しました") ? "#0a0" : "#b00", marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</p>
          )}
        </section>
      ) : (
        <section className="glass-panel glass-panel--home">
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
              <label style={{ display: "block", color: "#334", marginBottom: 6, fontWeight: 600, fontSize: 13 }}>ニックネーム</label>
              <input
                className="input-elegant"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={50}
              />
              <label style={{ display: "block", color: "#334", marginTop: 10, marginBottom: 6, fontWeight: 600, fontSize: 13 }}>所属</label>
              <select
                className="input-elegant"
                value={affiliation}
                onChange={(e) => {
                  setAffiliation(e.target.value);
                  if (e.target.value !== "その他") setAffiliationOther("");
                }}
                style={{ marginBottom: 8 }}
              >
                <option value="">選択してください</option>
                {AFFILIATION_PRESETS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              {affiliation === "その他" && (
                <input
                  className="input-elegant"
                  value={affiliationOther}
                  onChange={(e) => setAffiliationOther(e.target.value)}
                  placeholder="所属を入力"
                  maxLength={120}
                  style={{ marginBottom: 8 }}
                />
              )}
              <label style={{ display: "block", color: "#334", marginTop: 10, marginBottom: 6, fontWeight: 600, fontSize: 13 }}>学年</label>
              <select className="input-elegant" value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">選択してください</option>
                {GRADE_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={saveStudentProfile}
                disabled={profileSaving}
                className="btn-primary-solid"
                style={{ marginTop: 12, width: "100%", maxWidth: 320, opacity: profileSaving ? 0.7 : 1 }}
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
                className="input-elegant"
                value={domain}
                onChange={(e) => setDomain(e.target.value as DomainKey)}
              >
                {DOMAIN_OPTIONS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", color: "#333", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>1セットの出題数</label>
              <select
                className="input-elegant"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value) as 5 | 10 | 20)}
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
            <Link href={sessionHref} className="menu-card">基本修行</Link>
            <Link href={oniSessionHref} className="menu-card menu-card--oni">試練モード</Link>
            <Link href={recentWrongHref} className="menu-card">直近1週間の間違い</Link>
            <Link href="/review" className="menu-card">復習キュー</Link>
            <Link href="/logs" className="menu-card">日々の学習成果</Link>
            <Link href="/dashboard" className="menu-card">正答率グラフ</Link>
            {!isTeacher && <Link href="/ranking" className="menu-card">ランキング</Link>}
            {isTeacher && (
              <Link href="/teacher" className="menu-card menu-card--wide">
                教師ダッシュボード
              </Link>
            )}
          </div>

          <button onClick={signOut} type="button" className="btn-logout-soft">
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
