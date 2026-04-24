"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { QuestionCore, Choice } from "../../types";
import Link from "next/link";
import { RequireStudentProfile } from "../../components/RequireStudentProfile";
import {
  buildShuffledChoiceRows,
  formatChoicesForLog,
  formatUserFacingCorrectAnswer,
  formatUserPickedDisplay,
  getRequiredAnswerCount,
  isChosenSetCorrect,
  togglePickedChoice,
} from "../../lib/questionChoices";

type ReviewRow = {
  question_id: string;
  next_review_at: string;
  reason: string;
  q: QuestionCore | null;
};

function ReviewPageInner() {
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [msg, setMsg] = useState<string>("");

  const [active, setActive] = useState<ReviewRow | null>(null);
  const [selectedChoices, setSelectedChoices] = useState<Choice[]>([]);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [startAt, setStartAt] = useState<number>(Date.now());

  useEffect(() => {
    const load = async () => {
      setMsg("");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        setMsg("ログインしてください。");
        return;
      }

      // ★B運用：期限前も含めて全部表示（lteフィルタを外す）
      const { data, error } = await supabase
        .from("review_queue")
        .select("question_id,next_review_at,reason")
        .order("next_review_at", { ascending: true })
        .limit(200);

      if (error) {
        setMsg("復習取得エラー: " + error.message);
        return;
      }

      const base = (data ?? []) as Array<{ question_id: string; next_review_at: string; reason: string }>;
      if (base.length === 0) {
        setItems([]);
        return;
      }

      const ids = base.map((x) => x.question_id);
      const { data: qs, error: qerr } = await supabase
        .from("questions_core")
        .select("id,image_url,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw")
        .in("id", ids);

      if (qerr) {
        setMsg("問題取得エラー: " + qerr.message);
        return;
      }

      const map = new Map((qs ?? []).map((q) => [q.id, q as QuestionCore]));
      const merged: ReviewRow[] = base.map((x) => ({ ...x, q: map.get(x.question_id) ?? null }));
      setItems(merged);
    };

    load();
  }, []);

  const now = useMemo(() => new Date(), []);
  const due = items.filter((it) => new Date(it.next_review_at) <= now);
  const scheduled = items.filter((it) => new Date(it.next_review_at) > now);
  const choiceRows = useMemo(() => {
    if (!active?.q) return [];
    return buildShuffledChoiceRows(active.q);
  }, [active?.q]);
  const reviewRequiredSelect = useMemo(
    () => (active?.q ? getRequiredAnswerCount(active.q) : 1),
    [active?.q]
  );

  const start = (it: ReviewRow) => {
    setActive(it);
    setSelectedChoices([]);
    setIsCorrect(null);
    setStartAt(Date.now());
    setMsg("");
  };

  const submitWithChoices = async (picked: Choice[]) => {
    if (!active?.q) return;
    const q = active.q;
    const need = getRequiredAnswerCount(q);
    if (picked.length !== need) return;
    setSelectedChoices(picked);
    const ok = isChosenSetCorrect(q, picked);
    setIsCorrect(ok);
    const selectedLog = formatChoicesForLog(picked);

    const timeSpent = Math.max(0, Math.round((Date.now() - startAt) / 1000));
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setMsg("ユーザー情報取得に失敗しました。");
      return;
    }

    const { error: logErr } = await supabase.from("logs").insert({
      user_id: user.id,
      question_id: q.id,
      selected: selectedLog,
      is_correct: ok,
      confidence: null,
      time_spent_sec: timeSpent,
      tags_raw: q.tags_raw ?? "",
      kc_ids_raw: "",
      answered_at: new Date().toISOString(),
    });
    if (logErr) setMsg("ログ保存エラー: " + logErr.message);

    // 復習更新：正解ならキューから削除、不正解なら延期
    if (ok) {
      await supabase.from("review_queue").delete().eq("question_id", q.id);
    } else {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      await supabase.from("review_queue").upsert(
        {
          user_id: user.id,
          question_id: q.id,
          reason: "wrong",
          next_review_at: next.toISOString(),
        },
        { onConflict: "user_id,question_id" }
      );
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1>復習（キュー）</h1>
      {!active ? (
        <p style={{ marginBottom: 12 }}>
          <Link href="/" style={backLinkStyle}>← ホームへ</Link>
        </p>
      ) : null}

      {!active ? (
        <>
          {msg && <p style={{ color: "#b00" }}>{msg}</p>}

          {items.length === 0 ? (
            <p>復習キューは空です。</p>
          ) : (
            <>
              <section style={{ marginBottom: 18 }}>
                <h2 style={{ marginBottom: 8 }}>今日の復習（期限到来）</h2>
                {due.length === 0 ? (
                  <p style={{ color: "#000" }}>今日の復習はありません（予定は下にあります）。</p>
                ) : (
                  <ul>
                    {due.map((it) => (
                      <li key={it.question_id} style={{ marginBottom: 8 }}>
                        <button onClick={() => start(it)} style={btn}>
                          {it.question_id} / {it.reason} / {new Date(it.next_review_at).toLocaleString()}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h2 style={{ marginBottom: 8 }}>予定（期限前）</h2>
                {scheduled.length === 0 ? (
                  <p style={{ color: "#000" }}>予定はありません。</p>
                ) : (
                  <ul>
                    {scheduled.map((it) => (
                      <li key={it.question_id} style={{ marginBottom: 8 }}>
                        <button onClick={() => start(it)} style={btn}>
                          {it.question_id} / {it.reason} / {new Date(it.next_review_at).toLocaleString()}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          <Link href="/" style={linkStyle}>ホームへ</Link>
        </>
      ) : (
        <>
          <p style={{ marginBottom: 12 }}>
            <button type="button" onClick={() => setActive(null)} style={{ ...backLinkStyle, marginRight: 8 }}>← 一覧へ戻る</button>
            <Link href="/" style={backLinkStyle}>← ホームへ</Link>
          </p>
          {!active.q ? (
            <p>問題データが見つかりませんでした。</p>
          ) : (
            <>
              {active.q.image_url && (
                <div style={{ ...card, background: "#222", padding: 12, marginBottom: 8 }}>
                  <img
                    src={active.q.image_url}
                    alt="問題の図"
                    style={{ maxWidth: "100%", height: "auto", display: "block", borderRadius: 8 }}
                  />
                </div>
              )}
              <div style={{ ...card, background: "#333", color: "#fff" }}>
                <div style={{ fontSize: 18, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {active.q.stem}
                </div>
              </div>

              {isCorrect === null ? (
                <>
                  {reviewRequiredSelect > 1 ? (
                    <p style={{ margin: "10px 0", fontSize: 14, fontWeight: 600, color: "#000" }}>
                      正解は {reviewRequiredSelect} つ選んでください（もう一度タップで選択解除）
                    </p>
                  ) : null}
                  <div style={{ display: "grid", gap: 10 }}>
                    {choiceRows.map((row) => {
                      const picked = selectedChoices.includes(row.letter);
                      return (
                        <button
                          key={row.letter}
                          type="button"
                          onClick={() => {
                            if (reviewRequiredSelect === 1) {
                              void submitWithChoices([row.letter]);
                            } else {
                              setSelectedChoices((prev) =>
                                togglePickedChoice(prev, row.letter, reviewRequiredSelect)
                              );
                            }
                          }}
                          style={{
                            ...btn,
                            ...(reviewRequiredSelect > 1 && picked
                              ? { boxShadow: "inset 0 0 0 2px #333", background: "#f0f4f8" }
                              : {}),
                          }}
                        >
                          <span style={{ fontWeight: 700, marginRight: 8, color: "#555" }}>{row.rank}.</span>
                          {row.text}
                        </button>
                      );
                    })}
                  </div>
                  {reviewRequiredSelect > 1 ? (
                    <button
                      type="button"
                      onClick={() => void submitWithChoices(selectedChoices)}
                      disabled={selectedChoices.length !== reviewRequiredSelect}
                      style={{ ...btn, marginTop: 12, fontWeight: 700 }}
                    >
                      解答する（{selectedChoices.length}/{reviewRequiredSelect}）
                    </button>
                  ) : null}

                </>
              ) : (
                <>
                  <div style={{ fontSize: 18, marginTop: 10 }}>
                    {isCorrect ? "✅ 正解" : "❌ 不正解"}
                    （あなた：{formatUserPickedDisplay(active.q, selectedChoices)} / 正解：
                    {formatUserFacingCorrectAnswer(active.q)}）
                  </div>
                  {active.q.explain && <p style={{ whiteSpace: "pre-wrap" }}><b>解説：</b>{active.q.explain}</p>}
                  {msg && <pre style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</pre>}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setActive(null)} style={btn}>一覧へ戻る</button>
                    <Link href="/" style={linkStyle}>ホームへ</Link>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

export default function ReviewPage() {
  return (
    <RequireStudentProfile>
      <ReviewPageInner />
    </RequireStudentProfile>
  );
}

const btn: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 16,
  cursor: "pointer",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#fff",
  color: "#000",
  textAlign: "left",
};
const linkStyle: React.CSSProperties = { ...btn, textDecoration: "none", display: "inline-block", color: "#000" };
const backLinkStyle: React.CSSProperties = { ...btn, textDecoration: "none", display: "inline-block", color: "#000", padding: "10px 16px", fontSize: 15 };
const card: React.CSSProperties = { padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 12, color: "#000" };
