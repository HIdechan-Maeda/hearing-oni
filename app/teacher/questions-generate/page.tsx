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
};

type GenerateResponse = {
  error?: string;
  message?: string;
  examplesUsed?: Array<{ id: string; tags_raw: string | null; stem?: string }>;
  matchedPoolSize?: number;
  keywordParsed?: string | null;
  results?: ApiResultRow[];
  insertedIds?: string[];
  persisted?: boolean;
};

export default function TeacherQuestionsGeneratePage() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [okTeacher, setOkTeacher] = useState(false);
  const [busy, setBusy] = useState(false);

  const [domainKey, setDomainKey] = useState<QuestionGenerateDomainKey | "">("");
  const [contentKeywords, setContentKeywords] = useState("");
  const [tagsRawContains, setTagsRawContains] = useState("");
  const [tagsRawOutputHint, setTagsRawOutputHint] = useState("");
  const [count, setCount] = useState(2);
  const [exampleCount, setExampleCount] = useState(4);
  const [fetchPool, setFetchPool] = useState(1200);
  const [persist, setPersist] = useState(false);

  const [lastResponse, setLastResponse] = useState<GenerateResponse | null>(null);

  const keywordPreview = useMemo(() => {
    const ast = parseKeywordQuery(contentKeywords);
    return ast ? keywordQueryToDisplay(ast) : null;
  }, [contentKeywords]);

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
    setLastResponse(null);
    setBusy(true);
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    if (sessionErr || !token) {
      setBusy(false);
      setMsg("セッションが無効です。再ログインしてください。");
      return;
    }

    const body: Record<string, unknown> = {
      count,
      exampleCount,
      fetchPool,
      persist,
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
    setLastResponse(json);
    setBusy(false);

    if (!res.ok) {
      if (json.error === "forbidden") setMsg("教師権限が必要です。");
      else if (json.error === "unauthorized") setMsg("認証に失敗しました。再ログインしてください。");
      else if (json.error === "no_examples") setMsg(json.message ?? "参考問題が取得できませんでした。");
      else if (json.error === "openai_failed") setMsg("OpenAI 呼び出しエラー: " + (json.message ?? ""));
      else if (json.error === "insert_failed") setMsg("Supabase への保存に失敗: " + (json.message ?? ""));
      else if (json.message) setMsg(json.message);
      else setMsg("生成に失敗しました（HTTP " + res.status + "）。");
      return;
    }

    if (json.persisted) {
      setMsg(`保存しました（${(json.insertedIds ?? []).length} 件）。questions_core を確認してください。`);
    } else {
      setMsg("生成が完了しました。内容を確認のうえ、「Supabase に保存」にチェックして再実行すると書き込みます。");
    }
  };

  return (
    <main className="teacher-dashboard">
      <h1>OpenAI による問題生成（下書き）</h1>
      <p style={{ fontSize: 14, color: "#1a2d42", marginTop: 0 }}>
        <Link href="/teacher">← 教師ダッシュボード</Link>
      </p>
      <p style={{ fontSize: 13, color: "#1a2d42", lineHeight: 1.55, maxWidth: 800 }}>
        サーバーが <code>questions_core</code> から参考例を読み、OpenAI に同型の<strong>新規</strong>
        問題を JSON で生成させます。Vercel 等の環境変数に <code>OPENAI_API_KEY</code> が必要です。任意で{" "}
        <code>OPENAI_QUESTION_MODEL</code>（既定: gpt-4o-mini）。医学的事実は必ず人間が確認してください。
        参考例は DB から最大「参照プール」行を読み、その中からランダムに「参考例の件数」だけ OpenAI に渡します。
      </p>
      <aside
        style={{
          marginTop: 12,
          maxWidth: 800,
          padding: "10px 12px",
          fontSize: 12,
          lineHeight: 1.55,
          background: "#f4f8fc",
          border: "1px solid #c5d6e8",
          borderRadius: 6,
        }}
      >
        <strong>生成結果がイマイチなとき</strong>（自動生成の限界です）:
        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
          <li>
            <code>OPENAI_QUESTION_MODEL</code> を一段上のモデルにすると改善することがあります（料金・TPM に注意）。
          </li>
          <li>参考例を「良問だけ」に近づける（キーワード・領域・tags_raw・参照プールで母集団を調整）。</li>
          <li>保存前に stem / 誤答肢のリアリティ / 解説の根拠を人間が手直しする前提が安全です。</li>
        </ul>
      </aside>

      {loading && <p>読み込み中…</p>}
      {!loading && !okTeacher && msg && <p style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</p>}

      {!loading && okTeacher && (
        <>
          {msg && (
            <p style={{ color: msg.startsWith("保存") || msg.startsWith("生成が完了") ? "#063" : "#b00", whiteSpace: "pre-wrap" }}>
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
              <code>OR</code> / <code>|</code> / <code>または</code>（いずれか）　
              <code>AND</code> / <code>&amp;</code> / <code>かつ</code>（すべて）　
              カンマ区切りは OR 扱い。
              <br />
              例: <code>聴覚フィルタ OR 臨界帯域幅</code>　
              <code>マスキング AND 臨界帯域</code>
            </p>
            {keywordPreview && (
              <p style={{ fontSize: 12, color: "#0b315b", margin: "6px 0 0" }}>
                解釈: <code>{keywordPreview}</code>
              </p>
            )}
          </section>

          <section style={{ marginTop: 16, maxWidth: 640 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>領域（参考例の絞り込み・任意）</label>
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
              tags_raw に含む文字列（任意・追加フィルタ）
            </label>
            <input
              type="text"
              value={tagsRawContains}
              onChange={(e) => setTagsRawContains(e.target.value)}
              placeholder="例: acoustics / psychoacoustics（キーワードと併用可）"
              style={{ width: "100%", padding: 8, fontSize: 14, boxSizing: "border-box" }}
            />
            <p style={{ fontSize: 12, color: "#555", margin: "6px 0 0" }}>
              キーワードがあるときは全文検索が主で、ここは tags_raw の追加条件になります。
            </p>
          </section>

          <section style={{ marginTop: 16, maxWidth: 640 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
              新規問題の tags_raw の目安（任意）
            </label>
            <input
              type="text"
              value={tagsRawOutputHint}
              onChange={(e) => setTagsRawOutputHint(e.target.value)}
              placeholder="空ならキーワードまたは tags フィルタを目安に使います"
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
              <label
                style={{ display: "block", marginBottom: 4, fontWeight: 600 }}
                title="questions_core から読む最大行数（その中からシャッフルして参考例を選ぶ）"
              >
                参照プール（行）
              </label>
              <input
                type="number"
                min={50}
                max={2000}
                value={fetchPool}
                onChange={(e) => setFetchPool(Number(e.target.value))}
                style={{ width: 96, padding: 8 }}
              />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
              Supabase の questions_core に保存する
            </label>
          </section>

          <p style={{ fontSize: 12, color: "#555", marginTop: 12 }}>
            保存時は service_role で挿入します。問題IDは <code>ai-…</code> 形式です。
          </p>

          <button
            type="button"
            onClick={() => void load()}
            style={{ marginTop: 8, marginRight: 8, padding: "8px 14px" }}
          >
            権限を再確認
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runGenerate()}
            style={{ marginTop: 8, padding: "10px 18px", fontWeight: 600 }}
          >
            {busy ? "生成中…" : persist ? "生成して保存" : "生成のみ（プレビュー）"}
          </button>

          {lastResponse?.keywordParsed && (
            <p style={{ fontSize: 13, marginTop: 16 }}>
              キーワード解釈: <code>{lastResponse.keywordParsed}</code>
              {typeof lastResponse.matchedPoolSize === "number" ? (
                <>（一致候補 {lastResponse.matchedPoolSize} 件から参考例を抽出）</>
              ) : null}
            </p>
          )}

          {lastResponse?.examplesUsed && lastResponse.examplesUsed.length > 0 && (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 16 }}>使用した参考例（id / tags / 問題文）</h2>
              <ul style={{ fontSize: 13 }}>
                {lastResponse.examplesUsed.map((e) => (
                  <li key={e.id} style={{ marginBottom: 8 }}>
                    <code>{e.id}</code> — {e.tags_raw ?? "—"}
                    {e.stem ? <div style={{ color: "#444", marginTop: 2 }}>{e.stem}</div> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lastResponse?.results && lastResponse.results.length > 0 && (
            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16 }}>生成結果</h2>
              {lastResponse.results.map((r, i) => (
                <article
                  key={i}
                  style={{
                    marginTop: 12,
                    padding: 12,
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    background: r.valid ? "#f8fff8" : "#fff8f8",
                  }}
                >
                  <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                    <strong>{r.valid ? "検証OK" : "検証NG"}</strong>
                    {r.idSuggested ? (
                      <>
                        {" "}
                        / id: <code>{r.idSuggested}</code>
                      </>
                    ) : null}
                    {!r.valid && r.reason ? <span style={{ color: "#a00" }}> — {r.reason}</span> : null}
                  </p>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      fontSize: 12,
                      margin: 0,
                      maxHeight: 320,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(r.draft, null, 2)}
                  </pre>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
