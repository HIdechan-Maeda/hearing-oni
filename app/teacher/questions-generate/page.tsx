"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { formatSupabaseError, supabaseProfileErrorHints } from "@/lib/supabasePolicyHint";
import type { GeneratedQuestionDraft, QuestionGenerateDomainKey } from "@/lib/openaiGeneratedQuestions";
import { keywordQueryToDisplay, parseKeywordQuery } from "@/lib/keywordQuery";

const DOMAIN_OPTIONS: Array<{ key: QuestionGenerateDomainKey | ""; label: string }> = [
  { key: "", label: "指定なし（既存プールから参考例を選ぶ）" },
  { key: "anatomy", label: "解剖（anatomy）" },
  { key: "physiology", label: "生理（physiology）" },
  { key: "acoustics", label: "音響（acoustics）" },
  { key: "psychoacoustics", label: "聴覚心理（psychoacoustics）" },
  { key: "audiometry", label: "聴力検査（audiometry）" },
  { key: "screening_audiometry", label: "聴力検査スクリーニング（screening_audiometry）" },
  { key: "hearing_aids", label: "補聴器（hearing_aids）" },
  { key: "cochlea_implant", label: "人工内耳（cochlea implant）" },
  { key: "evoked", label: "電気生理（evoked）" },
  { key: "vestibular", label: "前庭（vestibular）" },
  { key: "disease", label: "病気・統合（disease）" },
  { key: "information_support", label: "情報保障（information support）" },
  { key: "development", label: "療育・発達（development）" },
  { key: "pediatric_hearing_exam", label: "小児聴覚検査（pediatric_hearing_exam）" },
  { key: "pediatric_hearing_loss", label: "小児難聴（pediatric_hearing_loss）" },
];

type ApiResultRow = {
  draft: GeneratedQuestionDraft;
  valid: boolean;
  reason?: string;
  idSuggested?: string;
  /** ローカル: 保存済み */
  savedId?: string;
};

type GenerateResponse = {
  error?: string;
  message?: string;
  examplesUsed?: Array<{ id: string; tags_raw: string | null; stem?: string }>;
  matchedPoolSize?: number;
  keywordParsed?: string | null;
  results?: ApiResultRow[];
};

type SaveResponse = {
  error?: string;
  message?: string;
  ok?: boolean;
  insertedIds?: string[];
  insertedCount?: number;
  rejected?: Array<{ index: number; reason: string }>;
};

async function getTeacherBearerToken(): Promise<string | null> {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) return null;
  return sessionData.session?.access_token ?? null;
}

export default function TeacherQuestionsGeneratePage() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [okTeacher, setOkTeacher] = useState(false);
  const [busyGenerate, setBusyGenerate] = useState(false);
  const [busySave, setBusySave] = useState(false);

  const [domainKey, setDomainKey] = useState<QuestionGenerateDomainKey | "">("");
  const [contentKeywords, setContentKeywords] = useState("");
  const [tagsRawContains, setTagsRawContains] = useState("");
  const [tagsRawOutputHint, setTagsRawOutputHint] = useState("");
  const [count, setCount] = useState(2);
  const [exampleCount, setExampleCount] = useState(4);
  const [fetchPool, setFetchPool] = useState(1200);

  const [examplesUsed, setExamplesUsed] = useState<GenerateResponse["examplesUsed"]>([]);
  const [keywordParsed, setKeywordParsed] = useState<string | null>(null);
  const [matchedPoolSize, setMatchedPoolSize] = useState<number | null>(null);
  const [results, setResults] = useState<ApiResultRow[]>([]);
  /** 保存対象としてチェックした結果インデックス */
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const keywordPreview = useMemo(() => {
    const ast = parseKeywordQuery(contentKeywords);
    return ast ? keywordQueryToDisplay(ast) : null;
  }, [contentKeywords]);

  const selectedCount = useMemo(
    () =>
      results.reduce((n, r, i) => {
        if (!r.valid || r.savedId) return n;
        return selected[i] ? n + 1 : n;
      }, 0),
    [results, selected]
  );

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

  const runGenerate = async () => {
    setMsg("");
    setBusyGenerate(true);
    const token = await getTeacherBearerToken();
    if (!token) {
      setBusyGenerate(false);
      setMsg("セッションが無効です。再ログインしてください。");
      return;
    }

    const body: Record<string, unknown> = {
      count,
      exampleCount,
      fetchPool,
    };
    if (domainKey) body.domainKey = domainKey;
    if (contentKeywords.trim()) body.contentKeywords = contentKeywords.trim();
    if (tagsRawContains.trim()) body.tagsRawContains = tagsRawContains.trim();
    if (tagsRawOutputHint.trim()) body.tagsRawOutputHint = tagsRawOutputHint.trim();

    const res = await fetch("/api/teacher/questions/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as GenerateResponse;
    setBusyGenerate(false);

    if (!res.ok) {
      if (json.error === "forbidden") setMsg("教師権限が必要です。");
      else if (json.error === "unauthorized") setMsg("認証に失敗しました。再ログインしてください。");
      else if (json.error === "no_examples") setMsg(json.message ?? "参考問題が取得できませんでした。");
      else if (json.error === "openai_failed") setMsg("OpenAI 呼び出しエラー: " + (json.message ?? ""));
      else if (json.message) setMsg(json.message);
      else setMsg("生成に失敗しました（HTTP " + res.status + "）。");
      return;
    }

    const nextResults = json.results ?? [];
    setResults(nextResults);
    setExamplesUsed(json.examplesUsed ?? []);
    setKeywordParsed(json.keywordParsed ?? null);
    setMatchedPoolSize(typeof json.matchedPoolSize === "number" ? json.matchedPoolSize : null);

    const nextSelected: Record<number, boolean> = {};
    nextResults.forEach((r, i) => {
      nextSelected[i] = Boolean(r.valid);
    });
    setSelected(nextSelected);

    setMsg(
      nextResults.length > 0
        ? "生成が完了しました。内容を確認し、OKな問題にチェックを入れて「Supabase に保存」してください。"
        : "生成結果が空でした。"
    );
  };

  const runSaveSelected = async () => {
    setMsg("");
    const toSave = results
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => r.valid && !r.savedId && selected[i])
      .map(({ r }) => r.draft);

    if (toSave.length === 0) {
      setMsg("保存対象の問題が選択されていません（検証OKかつ未保存のものにチェックを入れてください）。");
      return;
    }

    setBusySave(true);
    const token = await getTeacherBearerToken();
    if (!token) {
      setBusySave(false);
      setMsg("セッションが無効です。再ログインしてください。");
      return;
    }

    const res = await fetch("/api/teacher/questions/save", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ questions: toSave }),
    });
    const json = (await res.json().catch(() => ({}))) as SaveResponse;
    setBusySave(false);

    if (!res.ok) {
      if (json.error === "forbidden") setMsg("教師権限が必要です。");
      else if (json.error === "unauthorized") setMsg("認証に失敗しました。再ログインしてください。");
      else if (json.error === "insert_failed") setMsg("Supabase への保存に失敗: " + (json.message ?? ""));
      else if (json.message) setMsg(json.message);
      else setMsg("保存に失敗しました（HTTP " + res.status + "）。");
      return;
    }

    const ids = json.insertedIds ?? [];
    let idCursor = 0;
    setResults((prev) =>
      prev.map((r, i) => {
        if (!r.valid || r.savedId || !selected[i]) return r;
        const savedId = ids[idCursor];
        idCursor += 1;
        return savedId ? { ...r, savedId } : r;
      })
    );
    setSelected((prev) => {
      const next = { ...prev };
      results.forEach((r, i) => {
        if (r.valid && !r.savedId && prev[i]) next[i] = false;
      });
      return next;
    });

    setMsg(`保存しました（${json.insertedCount ?? ids.length} 件）。questions_core を確認してください。`);
  };

  const toggleAllValid = (on: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      results.forEach((r, i) => {
        if (r.valid && !r.savedId) next[i] = on;
      });
      return next;
    });
  };

  return (
    <main className="teacher-dashboard">
      <h1>OpenAI による問題生成（確認 → 保存）</h1>
      <p style={{ fontSize: 14, color: "#1a2d42", marginTop: 0 }}>
        <Link href="/teacher">← 教師ダッシュボード</Link>
      </p>
      <p style={{ fontSize: 13, color: "#1a2d42", lineHeight: 1.55, maxWidth: 800 }}>
        1) キーワード等で<strong>生成</strong> → 2) 内容を確認し OK にチェック → 3){" "}
        <strong>Supabase に保存</strong>。保存前は DB に書き込みません。環境変数に{" "}
        <code>OPENAI_API_KEY</code> と <code>SUPABASE_SERVICE_ROLE_KEY</code> が必要です。
      </p>

      {loading && <p>読み込み中…</p>}
      {!loading && !okTeacher && msg && <p style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</p>}

      {!loading && okTeacher && (
        <>
          {msg && (
            <p
              style={{
                color: msg.startsWith("保存") || msg.startsWith("生成が完了") ? "#063" : "#b00",
                whiteSpace: "pre-wrap",
              }}
            >
              {msg}
            </p>
          )}

          <section style={{ marginTop: 16, maxWidth: 640 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
              キーワード（類題の焦点・参考例検索）
            </label>
            <input
              type="text"
              value={contentKeywords}
              onChange={(e) => setContentKeywords(e.target.value)}
              placeholder="例: 聴覚フィルタ OR 臨界帯域幅"
              style={{ width: "100%", padding: 8, fontSize: 14, boxSizing: "border-box" }}
            />
            <p style={{ fontSize: 12, color: "#555", margin: "6px 0 0", lineHeight: 1.5 }}>
              問題文・選択肢・tags_raw・解説を DB 横断検索します（キーワード指定時は領域の tags 絞りを掛けません）。
              <br />
              <code>OR</code> / <code>|</code> / <code>または</code>　
              <code>AND</code> / <code>&amp;</code> / <code>かつ</code>　カンマは OR。
            </p>
            {keywordPreview && (
              <p style={{ fontSize: 12, color: "#0b315b", margin: "6px 0 0" }}>
                解釈: <code>{keywordPreview}</code>
              </p>
            )}
          </section>

          <section style={{ marginTop: 16, maxWidth: 640 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>領域（任意）</label>
            <select
              value={domainKey}
              onChange={(e) => setDomainKey((e.target.value || "") as QuestionGenerateDomainKey | "")}
              style={{ width: "100%", padding: 8, fontSize: 14 }}
            >
              {DOMAIN_OPTIONS.map((o) => (
                <option key={o.key || "none"} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </section>

          <section style={{ marginTop: 16, maxWidth: 640 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
              tags_raw 追加フィルタ（任意）
            </label>
            <input
              type="text"
              value={tagsRawContains}
              onChange={(e) => setTagsRawContains(e.target.value)}
              placeholder="例: acoustics"
              style={{ width: "100%", padding: 8, fontSize: 14, boxSizing: "border-box" }}
            />
          </section>

          <section style={{ marginTop: 16, maxWidth: 640 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
              新規問題の tags_raw 目安（任意）
            </label>
            <input
              type="text"
              value={tagsRawOutputHint}
              onChange={(e) => setTagsRawOutputHint(e.target.value)}
              style={{ width: "100%", padding: 8, fontSize: 14, boxSizing: "border-box" }}
            />
          </section>

          <section style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>生成件数</label>
              <input
                type="number"
                min={1}
                max={8}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={{ width: 96, padding: 8 }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>参考例の件数</label>
              <input
                type="number"
                min={1}
                max={20}
                value={exampleCount}
                onChange={(e) => setExampleCount(Number(e.target.value))}
                style={{ width: 96, padding: 8 }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>参照プール（行）</label>
              <input
                type="number"
                min={50}
                max={2000}
                value={fetchPool}
                onChange={(e) => setFetchPool(Number(e.target.value))}
                style={{ width: 96, padding: 8 }}
              />
            </div>
          </section>

          <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={() => void load()} style={{ padding: "8px 14px" }}>
              権限を再確認
            </button>
            <button
              type="button"
              disabled={busyGenerate || busySave}
              onClick={() => void runGenerate()}
              style={{ padding: "10px 18px", fontWeight: 600 }}
            >
              {busyGenerate ? "生成中…" : "1. 問題を生成（プレビュー）"}
            </button>
            <button
              type="button"
              disabled={busyGenerate || busySave || selectedCount === 0}
              onClick={() => void runSaveSelected()}
              style={{
                padding: "10px 18px",
                fontWeight: 600,
                background: selectedCount > 0 ? "#0b5" : undefined,
                color: selectedCount > 0 ? "#fff" : undefined,
                border: "none",
                borderRadius: 4,
                opacity: selectedCount === 0 ? 0.5 : 1,
                cursor: selectedCount === 0 ? "not-allowed" : "pointer",
              }}
            >
              {busySave ? "保存中…" : `2. 選択した問題を Supabase に保存（${selectedCount}）`}
            </button>
          </div>

          {keywordParsed && (
            <p style={{ fontSize: 13, marginTop: 16 }}>
              キーワード解釈: <code>{keywordParsed}</code>
              {matchedPoolSize != null ? <>（一致候補 {matchedPoolSize} 件）</> : null}
            </p>
          )}

          {examplesUsed && examplesUsed.length > 0 && (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 16 }}>使用した参考例</h2>
              <ul style={{ fontSize: 13 }}>
                {examplesUsed.map((e) => (
                  <li key={e.id} style={{ marginBottom: 8 }}>
                    <code>{e.id}</code> — {e.tags_raw ?? "—"}
                    {e.stem ? <div style={{ color: "#444", marginTop: 2 }}>{e.stem}</div> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.length > 0 && (
            <section style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>生成結果（確認）</h2>
                <button type="button" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => toggleAllValid(true)}>
                  検証OKをすべて選択
                </button>
                <button type="button" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => toggleAllValid(false)}>
                  選択解除
                </button>
              </div>

              {results.map((r, i) => {
                const canSelect = r.valid && !r.savedId;
                return (
                  <article
                    key={i}
                    style={{
                      marginTop: 12,
                      padding: 12,
                      border: "1px solid #ccc",
                      borderRadius: 6,
                      background: r.savedId ? "#eef6ff" : r.valid ? "#f8fff8" : "#fff8f8",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        marginBottom: 8,
                        cursor: canSelect ? "pointer" : "default",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(selected[i])}
                        disabled={!canSelect}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [i]: e.target.checked }))}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ fontSize: 13 }}>
                        <strong>
                          {r.savedId ? "保存済み" : r.valid ? "検証OK（保存可）" : "検証NG"}
                        </strong>
                        {r.savedId ? (
                          <>
                            {" "}
                            / id: <code>{r.savedId}</code>
                          </>
                        ) : r.idSuggested ? (
                          <>
                            {" "}
                            / 仮id: <code>{r.idSuggested}</code>
                          </>
                        ) : null}
                        {!r.valid && r.reason ? <span style={{ color: "#a00" }}> — {r.reason}</span> : null}
                        {canSelect ? (
                          <span style={{ color: "#555" }}> — チェック = 保存する</span>
                        ) : null}
                      </span>
                    </label>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{r.draft.stem}</div>
                    <ol style={{ margin: "0 0 8px", paddingLeft: 22, fontSize: 13 }}>
                      <li>{r.draft.choice_a}</li>
                      <li>{r.draft.choice_b}</li>
                      <li>{r.draft.choice_c}</li>
                      <li>{r.draft.choice_d}</li>
                      <li>{r.draft.choice_e}</li>
                    </ol>
                    <p style={{ margin: "0 0 6px", fontSize: 13 }}>
                      正答: <strong>{r.draft.answer}</strong>
                      {r.draft.tags_raw ? (
                        <>
                          {" "}
                          / tags: <code>{r.draft.tags_raw}</code>
                        </>
                      ) : null}
                    </p>
                    {r.draft.explain ? (
                      <p style={{ margin: 0, fontSize: 12, color: "#333", whiteSpace: "pre-wrap" }}>
                        解説: {r.draft.explain}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}
    </main>
  );
}
