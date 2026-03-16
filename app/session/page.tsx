"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { Choice, Confidence, QuestionCore } from "../../types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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
  // 病気・統合問題
  disease: ["desease", "disease", "byouki", "病気", "complex", "統合"],
};

export default function SessionPage() {
  const sp = useSearchParams();
  const domain = (sp.get("domain") ?? "all").trim(); // "all" or tag keyword
  const mode = (sp.get("mode") ?? "").trim(); // "" or "oni"
  const rawCount = Number(sp.get("count") ?? "10");
  const questionCount: 5 | 10 | 20 =
    rawCount === 5 || rawCount === 10 || rawCount === 20 ? (rawCount as 5 | 10 | 20) : 10;

  const [stage, setStage] = useState<Stage>("loading");
  const [questions, setQuestions] = useState<QuestionCore[]>([]);
  const [idx, setIdx] = useState(0);

  const [selected, setSelected] = useState<Choice | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("ok");

  const [startAt, setStartAt] = useState<number>(Date.now());
  const [msg, setMsg] = useState<string>("");

  const q = questions[idx];

  useEffect(() => {
    const load = async () => {
      setMsg("");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        setMsg("ログインしてください。");
        setStage("loading");
        return;
      }

      const { data, error } = await supabase
        .from("questions_core")
        .select("id,difficulty,image_url,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw")
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

      const picked = shuffle(filtered).slice(0, questionCount);
      setQuestions(picked);
      setIdx(0);
      setSelected(null);
      setIsCorrect(null);
      setConfidence("ok");
      setStartAt(Date.now());
      setStage("quiz");
    };

    load();
    // domain / mode が変わったら新セッション
  }, [domain, mode]);

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
      confidence,
      time_spent_sec: timeSpent,
      tags_raw: tagsRaw,
      kc_ids_raw: "",
      answered_at: new Date().toISOString(),
    });

    if (logErr) setMsg("ログ保存エラー: " + logErr.message);

    const shouldReview = !ok || confidence === "hard";
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
    setConfidence("ok");
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
      <main style={wrap}>
        <p style={{ marginBottom: 12 }}>
          <Link href="/" style={backLinkStyle}>← ホームへ</Link>
        </p>
        <h1>{mode === "oni" ? `試練（${questionCount}問）` : `基本修行（${questionCount}問）`}</h1>
        <p>{msg || "読み込み中..."}</p>
        <Link href="/" style={linkStyle}>ホームへ</Link>
      </main>
    );
  }

  if (stage === "done") {
    return (
      <main style={wrap}>
        <p style={{ marginBottom: 12 }}>
          <Link href="/" style={backLinkStyle}>← ホームへ</Link>
        </p>
        <h1>完了</h1>
        <p>
          {questionCount}問おつかれさまでした。（
          {mode === "oni" ? "鬼問題モード" : `領域：${domain}`}
          ）
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" style={linkStyle}>ホームへ</Link>
          <Link href="/review" style={linkStyle}>復習へ</Link>
        </div>
      </main>
    );
  }

  if (!q) return null;

  return (
    <main style={wrap}>
      <p style={{ marginBottom: 12 }}>
        <Link href="/" style={backLinkStyle}>← 問題選択に戻る</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ marginBottom: 8 }}>
          {mode === "oni"
            ? `試練（${questionCount}問）`
            : `基本修行（${questionCount}問）`}
        </h1>
        <div style={{ color: "#000" }}>
          {idx + 1} / {questions.length}（
          {mode === "oni" ? "鬼問題モード" : `領域：${domain}`}
          ）
        </div>
      </div>

      {q.image_url && (
        <div style={{ ...card, background: "#222", padding: 12, marginBottom: 8 }}>
          <img
            src={q.image_url}
            alt="問題の図"
            style={{ maxWidth: "100%", height: "auto", display: "block", borderRadius: 8 }}
          />
        </div>
      )}
      <div style={{ ...card, background: "#333", color: "#fff" }}>
        <div style={{ fontSize: 18, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{q.stem}</div>
      </div>

      {stage === "quiz" && (
        <>
          <div style={{ display: "grid", gap: 10 }}>
            {choices.map(([k, v]) => (
              <button key={k} onClick={() => submit(k)} style={choiceBtn}>
                {v}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ marginBottom: 6, color: "#000" }}>自信度</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {(["easy","ok","hard"] as Confidence[]).map(c => (
                <button
                  key={c}
                  onClick={() => setConfidence(c)}
                  style={{
                    ...pill,
                    borderColor: confidence === c ? "#000" : "#ccc",
                    fontWeight: confidence === c ? 700 : 400,
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {stage === "feedback" && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 18 }}>
            {isCorrect ? "✅ 正解" : "❌ 不正解"}
            （あなたの解答：{(q as any)[`choice_${selected?.toLowerCase()}`] ?? selected} / 正解：{(q as any)[`choice_${q.answer.toLowerCase()}`] ?? q.answer}）
          </div>
          {q.explain && <p style={{ whiteSpace: "pre-wrap" }}><b>解説：</b>{q.explain}</p>}
          {msg && <pre style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</pre>}
          <button onClick={next} style={{ ...btn, marginTop: 8 }}>次へ</button>
        </div>
      )}

      <hr style={{ margin: "18px 0" }} />
      <Link href="/" style={linkStyle}>ホームへ</Link>
    </main>
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

function nextReviewAt(reason: "wrong" | "hard") {
  const now = new Date();
  const days = reason === "wrong" ? 1 : 3;
  now.setDate(now.getDate() + days);
  return now;
}

const wrap: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16 };
const card: React.CSSProperties = { padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 12, color: "#000" };
const btn: React.CSSProperties = { padding: "10px 14px", fontSize: 16, cursor: "pointer", borderRadius: 10, border: "1px solid #ccc", background: "#fff", color: "#000" };
const pill: React.CSSProperties = { ...btn, padding: "8px 12px" };
const choiceBtn: React.CSSProperties = { ...btn, textAlign: "left", color: "#000" };
const linkStyle: React.CSSProperties = { ...btn, textDecoration: "none", display: "inline-block", color: "#000" };
const backLinkStyle: React.CSSProperties = { ...btn, textDecoration: "none", display: "inline-block", color: "#000", padding: "10px 16px", fontSize: 15 };
