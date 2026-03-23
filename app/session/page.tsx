"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { Choice, QuestionCore } from "../../types";
import Link from "next/link";
import { RequireStudentProfile } from "../../components/RequireStudentProfile";

type Stage = "loading" | "quiz" | "feedback" | "done";

// domain ごとに tags_raw 内でマッチさせるキーワード一覧
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  anatomy: ["anatomy"],
  physiology: ["physiology"],
  acoustics: ["acoustics"],
  psychoacoustics: ["psychoacoustics"],
  audiometry: ["audiometry"],
  hearing_aids: ["hearing_aids", "hearing_aid"],
  evoked: ["evoked", "abr", "assr"],
  vestibular: ["vestibular"],
  information_support: ["information"],
  development: ["development"],
  // 病気・統合問題
  disease: ["desease", "disease", "byouki", "病気", "complex", "統合"],
};

/** 直前に開始したセッションで出題した question_id（次回は可能な限り避ける） */
const LS_LAST_SESSION_QUESTION_IDS = "hearing-oni:last-session-question-ids";

function readLastSessionExcludedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LS_LAST_SESSION_QUESTION_IDS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveLastSessionQuestionIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_LAST_SESSION_QUESTION_IDS, JSON.stringify(ids));
  } catch {
    // ストレージ満杯などは無視
  }
}

function SessionProgressBar({ current, total }: { current: number; total: number }) {
  const safeTotal = Math.max(1, total);
  const pct = Math.min(100, (100 * Math.min(current, safeTotal)) / safeTotal);
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          fontSize: 13,
          color: "#333",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ fontWeight: 600, color: "#0b315b" }}>進捗</span>
        <span>
          {current} / {total} 問
        </span>
      </div>
      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: "#e8eef5",
          overflow: "hidden",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: "linear-gradient(90deg, #3d9aed, #0b4f9c)",
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

function SessionPageInner() {
  const [domain, setDomain] = useState<string>("all");
  const [mode, setMode] = useState<string>("");
  const [questionCount, setQuestionCount] = useState<5 | 10 | 20>(10);

  const [stage, setStage] = useState<Stage>("loading");
  const [questions, setQuestions] = useState<QuestionCore[]>([]);
  const [idx, setIdx] = useState(0);

  const [selected, setSelected] = useState<Choice | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  const [startAt, setStartAt] = useState<number>(Date.now());
  const [msg, setMsg] = useState<string>("");

  const q = questions[idx];

  // 初回マウント時に URL からクエリパラメータを読む（useSearchParams を使わない）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const d = (sp.get("domain") ?? "all").trim();
    const m = (sp.get("mode") ?? "").trim();
    const rawCount = Number(sp.get("count") ?? "10");
    const qc: 5 | 10 | 20 =
      rawCount === 5 || rawCount === 10 || rawCount === 20 ? (rawCount as 5 | 10 | 20) : 10;
    setDomain(d || "all");
    setMode(m);
    setQuestionCount(qc);
  }, []);

  useEffect(() => {
    const load = async () => {
      setMsg("");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        setMsg("ログインしてください。");
        setStage("loading");
        return;
      }

      // 直近1週間の「間違えた問題」モード
      if (mode === "recent_wrong") {
        const userId = sess.session.user.id;
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: wrongLogs, error: wrongErr } = await supabase
          .from("logs")
          .select("question_id,answered_at")
          .eq("user_id", userId)
          .eq("is_correct", false)
          .gte("answered_at", sevenDaysAgo.toISOString())
          .order("answered_at", { ascending: false })
          .limit(200);

        if (wrongErr) {
          setMsg("復習用ログ取得エラー: " + wrongErr.message);
          return;
        }

        const ids = Array.from(
          new Set((wrongLogs ?? []).map((l) => l.question_id).filter(Boolean))
        );

        if (ids.length === 0) {
          setMsg("直近1週間で間違えた問題がありません。");
          return;
        }

        const { data: qs, error: qerr } = await supabase
          .from("questions_core")
          .select(
            "id,difficulty,image_url,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw"
          )
          .in("id", ids)
          .limit(200);

        if (qerr) {
          setMsg("問題取得エラー: " + qerr.message);
          return;
        }

        const pool = (qs ?? []) as QuestionCore[];
        if (pool.length === 0) {
          setMsg("直近1週間で間違えた問題が見つかりません。");
          return;
        }

        const excludeIds = readLastSessionExcludedIds();
        const picked = pickAvoidingLastSession(pool, questionCount, excludeIds);
        saveLastSessionQuestionIds(picked.map((q) => q.id));
        setQuestions(picked);
        setIdx(0);
        setSelected(null);
        setIsCorrect(null);
        setStartAt(Date.now());
        setStage("quiz");
        return;
      }

      // 通常の出題（基本修行 / 試練）
      const { data, error } = await supabase
        .from("questions_core")
        .select(
          "id,difficulty,image_url,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw"
        )
        .limit(500);

      if (error) {
        setMsg("問題取得エラー: " + error.message);
        return;
      }

      const pool = (data ?? []) as QuestionCore[];
      if (pool.length === 0) {
        setMsg("questions_core に問題がありません。SupabaseへCSV Importしてください。");
        return;
      }
      let filtered = pool;
      const lowerTagIncludes = (x: QuestionCore, keyword: string) =>
        (x.tags_raw ?? "").toLowerCase().includes(keyword.toLowerCase());

      if (mode === "oni") {
        // 鬼問題モード: difficulty = 'oni' の問題だけを出題
        filtered = filtered.filter(
          (x) => (x.difficulty ?? "").toLowerCase() === "oni"
        );
      } else {
        // 基本修行: oni タグ付け（difficulty = 'oni'）の問題は出題しない
        filtered = filtered.filter(
          (x) => (x.difficulty ?? "").toLowerCase() !== "oni"
        );
        if (domain !== "all") {
          const keywords = DOMAIN_KEYWORDS[domain] ?? [domain];
          filtered = filtered.filter((x) =>
            keywords.some((kw) => lowerTagIncludes(x, kw))
          );
        }
      }

      if (filtered.length === 0) {
        const label =
          mode === "oni"
            ? "鬼問題（difficulty = 'oni'）"
            : `領域「${domain}」`;
        setMsg(
          `${label} に該当する問題が0件です。鬼問題にしたい行の difficulty 列を 'oni' に設定してください。`
        );
        return;
      }

      const excludeIds = readLastSessionExcludedIds();
      const picked = pickAvoidingLastSession(filtered, questionCount, excludeIds);
      saveLastSessionQuestionIds(picked.map((q) => q.id));
      setQuestions(picked);
      setIdx(0);
      setSelected(null);
      setIsCorrect(null);
      setStartAt(Date.now());
      setStage("quiz");
    };

    load();
    // domain / mode / 出題数 が変わったら新セッション
  }, [domain, mode, questionCount]);

  const choices = useMemo(() => {
    if (!q) return [];
    const base: Array<[Choice, string]> = [
      ["A", q.choice_a],
      ["B", q.choice_b],
      ["C", q.choice_c],
      ["D", q.choice_d],
      ["E", q.choice_e],
    ];
    // 選択肢の表示順だけ毎回シャッフルする（A〜Eラベルと正解判定は維持）
    return shuffle(base);
  }, [q]);

  const submit = async (choice: Choice) => {
    if (!q) return;
    setSelected(choice);
    const ok = choice === q.answer;
    setIsCorrect(ok);
    setStage("feedback");

    const timeSpent = Math.max(0, Math.round((Date.now() - startAt) / 1000));

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setMsg("ユーザー情報取得に失敗しました。");
      return;
    }

    const tagsRaw = q.tags_raw ?? "";

    const { error: logErr } = await supabase.from("logs").insert({
      user_id: user.id,
      question_id: q.id,
      selected: choice,
      is_correct: ok,
      confidence: null,
      time_spent_sec: timeSpent,
      tags_raw: tagsRaw,
      kc_ids_raw: "",
      answered_at: new Date().toISOString(),
    });

    if (logErr) setMsg("ログ保存エラー: " + logErr.message);

    const shouldReview = !ok;
    if (shouldReview) {
      // 復習はB運用：予定も表示されるので、翌日/3日後でOK
      const next = nextReviewAt(!ok ? "wrong" : "hard");
      const { error: revErr } = await supabase.from("review_queue").upsert(
        {
          user_id: user.id,
          question_id: q.id,
          reason: !ok ? "wrong" : "hard",
          next_review_at: next.toISOString(),
        },
        { onConflict: "user_id,question_id" }
      );
      if (revErr) setMsg((m) => (m ? m + "\n" : "") + "復習キュー保存エラー: " + revErr.message);
    }
  };

  const next = () => {
    setMsg("");
    setSelected(null);
    setIsCorrect(null);
    setStartAt(Date.now());

    if (idx + 1 >= questions.length) {
      setStage("done");
    } else {
      setIdx(idx + 1);
      setStage("quiz");
    }
  };

  if (stage === "loading") {
    return (
      <main className="session-page">
        <p style={{ marginBottom: 12 }}>
          <Link href="/" className="session-back-link">← ホームへ</Link>
        </p>
        <h1 style={{ color: "#0b315b", fontSize: 22 }}>
          {mode === "oni"
            ? `試練（${questionCount}問）`
            : mode === "recent_wrong"
            ? `直近1週間の間違えた問題（${questionCount}問）`
            : `基本修行（${questionCount}問）`}
        </h1>
        <SessionProgressBar current={0} total={questionCount} />
        <p style={{ lineHeight: 1.6 }}>{msg || "読み込み中..."}</p>
        <Link href="/" className="link-pill">ホームへ</Link>
      </main>
    );
  }

  if (stage === "done") {
    const n = questions.length || questionCount;
    return (
      <main className="session-page">
        <p style={{ marginBottom: 12 }}>
          <Link href="/" className="session-back-link">← ホームへ</Link>
        </p>
        <h1 style={{ color: "#0b315b", fontSize: 24 }}>完了</h1>
        <SessionProgressBar current={n} total={n} />
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            background: "linear-gradient(180deg, #f0f9ff 0%, #ffffff 100%)",
            border: "1px solid #c5ddf5",
            marginBottom: 16,
            lineHeight: 1.65,
          }}
        >
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#0b315b" }}>おつかれさまでした</p>
          <p style={{ margin: "8px 0 0", color: "#333" }}>
            {n}問終了（
            {mode === "oni" ? "鬼問題モード" : mode === "recent_wrong" ? "直近の間違い" : `領域：${domain}`}
            ）
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" className="link-pill">ホームへ</Link>
          <Link href="/review" className="link-pill">復習へ</Link>
        </div>
      </main>
    );
  }

  if (!q) return null;

  return (
    <main className="session-page">
      <p style={{ marginBottom: 12 }}>
        <Link href="/" className="session-back-link">← 問題選択に戻る</Link>
      </p>
      <h1 style={{ marginBottom: 8, color: "#0b315b", fontSize: 20 }}>
        {mode === "oni"
          ? `試練（${questions.length}問）`
          : mode === "recent_wrong"
          ? `直近1週間の間違えた問題（${questions.length}問）`
          : `基本修行（${questions.length}問）`}
      </h1>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#555" }}>
        {mode === "oni" ? "鬼問題モード" : mode === "recent_wrong" ? "直近1週間の間違い" : `領域：${domain}`}
      </p>
      <SessionProgressBar current={idx + 1} total={questions.length} />

      {q.image_url && (
        <div style={{ ...card, background: "#222", padding: 12, marginBottom: 8 }}>
          <img
            src={q.image_url}
            alt="問題の図"
            style={{ maxWidth: "100%", height: "auto", display: "block", borderRadius: 8 }}
          />
        </div>
      )}
      <div
        style={{
          ...card,
          background: "linear-gradient(145deg, #2a2a2a 0%, #1a1a1a 100%)",
          color: "#fff",
          border: "1px solid #444",
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ fontSize: 18, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{q.stem}</div>
      </div>

      {stage === "quiz" && (
        <>
          <div style={{ display: "grid", gap: 10 }}>
            {choices.map(([k, v]) => (
              <button key={k} type="button" onClick={() => submit(k)} className="choice-btn">
                {v}
              </button>
            ))}
          </div>
        </>
      )}

      {stage === "feedback" && (
        <div style={{ marginTop: 18 }}>
          <div style={{ marginBottom: 10 }}>
            <span className={isCorrect ? "feedback-badge feedback-badge--ok" : "feedback-badge feedback-badge--ng"}>
              {isCorrect ? "正解" : "不正解"}
            </span>
          </div>
          <p style={{ fontSize: 15, color: "#333", lineHeight: 1.65, margin: "0 0 12px" }}>
            あなたの解答：{(q as any)[`choice_${selected?.toLowerCase()}`] ?? selected} / 正解：{(q as any)[`choice_${q.answer.toLowerCase()}`] ?? q.answer}
          </p>
          {q.explain && (
            <p style={{ whiteSpace: "pre-wrap", padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.9)", border: "1px solid #d0e3f5" }}>
              <b>解説：</b>
              {q.explain}
            </p>
          )}
          {msg && <pre style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</pre>}
          <button type="button" onClick={next} className="btn-next">
            次へ
          </button>
        </div>
      )}

      <hr style={{ margin: "22px 0", border: "none", borderTop: "1px solid rgba(0,0,0,0.08)" }} />
      <Link href="/" className="link-pill">ホームへ</Link>
    </main>
  );
}

export default function SessionPage() {
  return (
    <Suspense fallback={<main className="session-page"><p>読み込み中...</p></main>}>
      <RequireStudentProfile>
        <SessionPageInner />
      </RequireStudentProfile>
    </Suspense>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** tags_raw の先頭トークン（カンマ・セミコロン区切り）でバケット化。同じサブトピックばかり選ばれにくくする */
function questionBucketKey(q: QuestionCore): string {
  const raw = (q.tags_raw ?? "").trim();
  if (!raw) return "__untagged__";
  const first = raw.split(/[,;，、]/)[0]?.trim().toLowerCase() ?? "";
  return first || "__untagged__";
}

/**
 * ランダムだが「タグ（サブトピック）の偏り」を抑えて取り出す。
 * 各バケットから交互に1問ずつ取り、足りなければ残りをシャッフルして埋める。
 */
function pickDiverseQuestions(pool: QuestionCore[], n: number): QuestionCore[] {
  if (pool.length <= n) return shuffle([...pool]);
  const buckets = new Map<string, QuestionCore[]>();
  for (const q of pool) {
    const k = questionBucketKey(q);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(q);
  }
  for (const arr of buckets.values()) shuffle(arr);

  const bucketKeys = shuffle([...buckets.keys()]);
  const out: QuestionCore[] = [];
  const idxMap = new Map<string, number>();
  for (const k of bucketKeys) idxMap.set(k, 0);

  // ラウンドロビン（バケット順は毎回シャッフル済み）
  let progressed = true;
  while (out.length < n && progressed) {
    progressed = false;
    for (const k of bucketKeys) {
      if (out.length >= n) break;
      const arr = buckets.get(k)!;
      const i = idxMap.get(k)!;
      if (i < arr.length) {
        out.push(arr[i]);
        idxMap.set(k, i + 1);
        progressed = true;
      }
    }
  }

  if (out.length < n) {
    const used = new Set(out.map((q) => q.id));
    const rest = shuffle(pool.filter((q) => !used.has(q.id)));
    for (const q of rest) {
      if (out.length >= n) break;
      out.push(q);
    }
  }

  return out.slice(0, n);
}

/**
 * 直近セッションで出た問題 ID は除外して選ぶ。
 * 除外だけだと件数が足りない場合は残りプールから埋める（重複しうるが出題数は保証）。
 */
function pickAvoidingLastSession(
  pool: QuestionCore[],
  n: number,
  excludeIds: Set<string>
): QuestionCore[] {
  const preferred = pool.filter((q) => !excludeIds.has(q.id));
  if (preferred.length >= n) {
    return pickDiverseQuestions(preferred, n);
  }
  if (preferred.length === 0) {
    return pickDiverseQuestions(pool, n);
  }
  const primary = pickDiverseQuestions(preferred, preferred.length);
  const used = new Set(primary.map((q) => q.id));
  const restPool = pool.filter((q) => !used.has(q.id));
  const need = n - primary.length;
  const secondary = pickDiverseQuestions(restPool, need);
  return [...primary, ...secondary].slice(0, n);
}

function nextReviewAt(reason: "wrong" | "hard") {
  const now = new Date();
  const days = reason === "wrong" ? 1 : 3;
  now.setDate(now.getDate() + days);
  return now;
}

const card: React.CSSProperties = { padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 12, color: "#000" };
