"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import type { Choice, QuestionCore } from "../../types";
import Link from "next/link";
import { RequireStudentProfile } from "../../components/RequireStudentProfile";

type Stage = "loading" | "quiz" | "feedback" | "done";

/** URL の ?domain=&mode=&count= と #anatomy / #domain=anatomy を解釈（試練で領域が効かないバグ対策：layout で先に state へ載せる） */
function parseSessionLocation(): {
  domain: string;
  mode: string;
  count: 5 | 10 | 20;
  includeKeywords: string[];
  excludeKeywords: string[];
} {
  if (typeof window === "undefined") {
    return { domain: "all", mode: "", count: 10, includeKeywords: [], excludeKeywords: [] };
  }
  const sp = new URLSearchParams(window.location.search);
  let d = (sp.get("domain") ?? "all").trim() || "all";
  const m = (sp.get("mode") ?? "").trim();
  const includeKeywords = splitKeywords(sp.get("include"));
  const excludeKeywords = splitKeywords(sp.get("exclude"));
  const rawCount = Number(sp.get("count") ?? "10");
  const qc: 5 | 10 | 20 =
    rawCount === 5 || rawCount === 10 || rawCount === 20 ? (rawCount as 5 | 10 | 20) : 10;
  const h = window.location.hash.replace(/^#/, "").trim();
  if (d === "all" && h) {
    if (h.startsWith("domain=")) {
      d = h.slice("domain=".length).trim() || "all";
    } else if (/^[a-z_]+$/.test(h)) {
      d = h;
    }
  }
  return { domain: d, mode: m, count: qc, includeKeywords, excludeKeywords };
}

function splitKeywords(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，、;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// domain ごとに tags_raw を「カンマ等で分割したトークン」と完全一致で照合する（部分一致禁止）
// ※ "information" を includes すると information_support や無関係な語に誤マッチする
// ※ "acoustics" が psychoacoustics に含まれる等も防ぐ
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  // CSV では anatomy/physiology のようにスラッシュ区切りの行が多い → parseTagTokens で / も分割する
  anatomy: ["anatomy", "解剖", "解剖学", "anatomical"],
  physiology: ["physiology", "生理", "生理学", "physiological", "phisiology"],
  acoustics: ["acoustics"],
  psychoacoustics: ["psychoacoustics"],
  audiometry: ["audiometry"],
  screening_audiometry: ["screening audiometry"],
  hearing_aids: ["hearing_aids", "hearing_aid", "補聴器"],
  cochlea_implant: ["cochlea implant", "cochlear implant", "人工内耳"],
  evoked: ["evoked", "abr", "assr"],
  vestibular: ["vestibular"],
  information_support: ["information_support", "情報保障", "information"],
  development: ["development"],
  pediatric_hearing_exam: ["pediatric hearing", "小児聴覚検査"],
  pediatric_hearing_loss: ["pediatric hearing loss"],
  // 病気・統合問題
  disease: ["desease", "disease", "byouki", "病気", "complex", "統合"],
};

/** 全領域試練のロビン用: 先に判定するほうが「より専用の領域」（psychoacoustics を acoustics より先） */
const DOMAIN_BUCKET_ORDER: string[] = [
  "psychoacoustics",
  "information_support",
  "hearing_aids",
  "cochlea_implant",
  "screening_audiometry",
  "audiometry",
  "pediatric_hearing_exam",
  "evoked",
  "vestibular",
  "development",
  "pediatric_hearing_loss",
  "disease",
  "physiology",
  "anatomy",
  "acoustics",
];

function parseTagTokens(tagsRaw: string | null | undefined): string[] {
  if (!tagsRaw) return [];
  return tagsRaw
    // CSV 上で "anatomy phisiology" のように空白区切りされているケースも拾う
    .split(/[\s,;，、/|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeTagToken(t: string): string {
  return t.normalize("NFKC").trim().toLowerCase();
}

/** トークンとキーワードは完全一致（NFKC・大小無視）。部分一致は使わない */
function tokenMatchesKeyword(token: string, keyword: string): boolean {
  return normalizeTagToken(token) === normalizeTagToken(keyword);
}

function questionMatchesDomain(q: QuestionCore, domainKey: string): boolean {
  const keywords = DOMAIN_KEYWORDS[domainKey] ?? [domainKey];
  const tokens = parseTagTokens(q.tags_raw);
  if (tokens.length === 0) return false;
  return keywords.some((kw) => tokens.some((t) => tokenMatchesKeyword(t, kw)));
}

function questionSearchText(q: QuestionCore): string {
  return [
    q.stem ?? "",
    q.choice_a ?? "",
    q.choice_b ?? "",
    q.choice_c ?? "",
    q.choice_d ?? "",
    q.choice_e ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function questionMatchesContentKeywords(
  q: QuestionCore,
  includeKeywords: string[],
  excludeKeywords: string[]
): boolean {
  if (includeKeywords.length === 0 && excludeKeywords.length === 0) return true;
  const text = questionSearchText(q);
  const includes = includeKeywords.map((k) => k.toLowerCase());
  const excludes = excludeKeywords.map((k) => k.toLowerCase());
  const includeOk = includes.length === 0 || includes.some((kw) => text.includes(kw));
  const excludeHit = excludes.some((kw) => text.includes(kw));
  return includeOk && !excludeHit;
}

/**
 * tags_raw を DOMAIN_KEYWORDS に照らして「領域」バケットに分類（試練モードの偏り対策）
 */
function questionDomainBucketKey(q: QuestionCore): string {
  for (const dk of DOMAIN_BUCKET_ORDER) {
    if (questionMatchesDomain(q, dk)) return dk;
  }
  return "__other__";
}

const ONI_FETCH_PAGE = 1000;

/**
 * 基本修行で領域指定ありのとき: limit(500) だとその500件に領域一致が1件しかなく1問で終了するため、全件をページング取得する。
 */
async function fetchAllQuestionsCorePaged(
  select: string
): Promise<{ data: QuestionCore[]; error: { message: string } | null }> {
  const out: QuestionCore[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("questions_core")
      .select(select)
      .order("id", { ascending: true })
      .range(from, from + ONI_FETCH_PAGE - 1);
    if (error) return { data: [], error: { message: error.message } };
    const chunk = (data ?? []) as unknown as QuestionCore[];
    out.push(...chunk);
    if (chunk.length < ONI_FETCH_PAGE) break;
    from += ONI_FETCH_PAGE;
  }
  return { data: out, error: null };
}

/** DB の difficulty が鬼問題か（表記ゆれ対応） */
function isOniDifficulty(difficulty: string | null | undefined): boolean {
  const s = (difficulty ?? "").trim();
  if (!s) return false;
  if (s === "鬼") return true;
  return s.toLowerCase() === "oni";
}

/**
 * 試練（oni）用: Supabase は 1 回あたり件数に上限があるためページングで取り切る。
 * 重要: range() だけだと行の順序が不定で、ページ間で重複・欠落が起きうるため必ず order する。
 */
async function fetchAllOniQuestions(select: string): Promise<{ data: QuestionCore[]; error: { message: string } | null }> {
  const out: QuestionCore[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("questions_core")
      .select(select)
      .ilike("difficulty", "oni")
      .order("id", { ascending: true })
      .range(from, from + ONI_FETCH_PAGE - 1);
    if (error) return { data: [], error: { message: error.message } };
    const chunk = (data ?? []) as unknown as QuestionCore[];
    out.push(...chunk);
    if (chunk.length < ONI_FETCH_PAGE) break;
    from += ONI_FETCH_PAGE;
  }
  const filtered = out.filter((x) => isOniDifficulty(x.difficulty));
  return { data: filtered, error: null };
}

/**
 * 直近のセッションで出題した question_id を蓄積（次回は可能な限り避ける）
 * ※「直前の1セッションだけ」だと、3回目にまた同じ問題群に戻るため、複数セッション分を保持する
 */
const LS_LAST_SESSION_QUESTION_IDS = "hearing-oni:last-session-question-ids";
/** 保持する直近IDの上限（多めに取り、10問×10セッション程度は避けられる） */
const MAX_RECENT_QUESTION_IDS = 200;

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
    const prevRaw = window.localStorage.getItem(LS_LAST_SESSION_QUESTION_IDS);
    let prev: string[] = [];
    if (prevRaw) {
      const p = JSON.parse(prevRaw) as unknown;
      if (Array.isArray(p)) prev = p.filter((x): x is string => typeof x === "string");
    }
    const merged = [...prev, ...ids];
    // 末尾からユニークを拾い、直近 MAX 件まで（古い方から落とす）
    const seen = new Set<string>();
    const kept: string[] = [];
    for (let i = merged.length - 1; i >= 0; i--) {
      const id = merged[i];
      if (seen.has(id)) continue;
      seen.add(id);
      kept.unshift(id);
      if (kept.length >= MAX_RECENT_QUESTION_IDS) break;
    }
    window.localStorage.setItem(LS_LAST_SESSION_QUESTION_IDS, JSON.stringify(kept));
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
          color: "#1a1a1a",
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
  const [includeKeywords, setIncludeKeywords] = useState<string[]>([]);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);

  const [stage, setStage] = useState<Stage>("loading");
  const [questions, setQuestions] = useState<QuestionCore[]>([]);
  const [idx, setIdx] = useState(0);

  const [selected, setSelected] = useState<Choice | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  /** 戻る／次へで復元するため、各問の解答を保持 */
  const [answersByQuestionId, setAnswersByQuestionId] = useState<
    Record<string, { selected: Choice; isCorrect: boolean }>
  >({});

  const [startAt, setStartAt] = useState<number>(Date.now());
  const [msg, setMsg] = useState<string>("");

  const q = questions[idx];

  const oniLineLabel = useMemo(() => {
    if (mode !== "oni") return "";
    return domain === "all"
      ? "鬼問題モード（全領域ミックス）"
      : `鬼問題モード（領域：${domain}）`;
  }, [mode, domain]);

  // useEffect(load) より先に URL を state へ載せないと、mode が空のまま基本修行プールが走り領域フィルタも効かない
  useLayoutEffect(() => {
    const { domain: d, mode: m, count: qc, includeKeywords: ik, excludeKeywords: ek } = parseSessionLocation();
    setDomain(d);
    setMode(m);
    setQuestionCount(qc);
    setIncludeKeywords(ik);
    setExcludeKeywords(ek);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setMsg("");
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled) return;
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
          if (!cancelled) setMsg("復習用ログ取得エラー: " + wrongErr.message);
          return;
        }

        const ids = Array.from(
          new Set((wrongLogs ?? []).map((l) => l.question_id).filter(Boolean))
        );

        if (ids.length === 0) {
          if (!cancelled) setMsg("直近1週間で間違えた問題がありません。");
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
          if (!cancelled) setMsg("問題取得エラー: " + qerr.message);
          return;
        }

        const pool = (qs ?? []) as QuestionCore[];
        if (pool.length === 0) {
          if (!cancelled) setMsg("直近1週間で間違えた問題が見つかりません。");
          return;
        }

        const excludeIds = readLastSessionExcludedIds();
        const picked = shuffle(pickAvoidingLastSession(pool, questionCount, excludeIds));
        if (cancelled) return;
        saveLastSessionQuestionIds(picked.map((q) => q.id));
        setQuestions(picked);
        setIdx(0);
        setSelected(null);
        setIsCorrect(null);
        setAnswersByQuestionId({});
        setStartAt(Date.now());
        setStage("quiz");
        return;
      }

      // 通常の出題（基本修行 / 試練）
      const SELECT_CORE =
        "id,difficulty,image_url,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw";

      let pool: QuestionCore[];

      if (mode === "oni") {
        const { data: oniData, error: oniErr } = await fetchAllOniQuestions(SELECT_CORE);
        if (cancelled) return;
        if (oniErr) {
          if (!cancelled) setMsg("問題取得エラー: " + oniErr.message);
          return;
        }
        pool = oniData;
      } else if (domain !== "all") {
        const { data: allCore, error: pageErr } = await fetchAllQuestionsCorePaged(SELECT_CORE);
        if (cancelled) return;
        if (pageErr) {
          if (!cancelled) setMsg("問題取得エラー: " + pageErr.message);
          return;
        }
        pool = allCore;
      } else {
        const { data, error } = await supabase.from("questions_core").select(SELECT_CORE).limit(500);
        if (cancelled) return;
        if (error) {
          if (!cancelled) setMsg("問題取得エラー: " + error.message);
          return;
        }
        pool = (data ?? []) as QuestionCore[];
      }
      if (pool.length === 0) {
        if (!cancelled) setMsg("questions_core に問題がありません。SupabaseへCSV Importしてください。");
        return;
      }
      let filtered = pool;

      if (mode === "oni") {
        // 1) 鬼問題のみ 2) 領域指定時は tags のトークンが領域キーワードと完全一致するものだけ
        filtered = filtered.filter((x) => isOniDifficulty(x.difficulty));
        if (domain !== "all") {
          filtered = filtered.filter((x) => questionMatchesDomain(x, domain));
        }
      } else {
        // 基本修行: oni タグ付け（difficulty = 'oni'）の問題は出題しない
        filtered = filtered.filter(
          (x) => (x.difficulty ?? "").toLowerCase() !== "oni"
        );
        if (domain !== "all") {
          filtered = filtered.filter((x) => questionMatchesDomain(x, domain));
        }
      }
      filtered = filtered.filter((x) =>
        questionMatchesContentKeywords(x, includeKeywords, excludeKeywords)
      );

      if (filtered.length === 0) {
        if (cancelled) return;
        const label =
          mode === "oni"
            ? domain === "all"
              ? "鬼問題（difficulty = 'oni'）"
              : `鬼問題かつ領域「${domain}」`
            : `領域「${domain}」`;
        const hasKeywordFilter = includeKeywords.length > 0 || excludeKeywords.length > 0;
        setMsg(
          hasKeywordFilter
            ? `${label} かつキーワード条件に該当する問題が0件です。検索語を調整してください。`
            : mode === "oni" && domain !== "all"
            ? `${label} に該当する問題が0件です。その領域の tags_raw と difficulty='oni' を確認してください。`
            : `${label} に該当する問題が0件です。鬼問題にしたい行の difficulty 列を 'oni' に設定してください。`
        );
        return;
      }

      const excludeIds = readLastSessionExcludedIds();
      // 試練・全領域: 領域（DOMAIN_KEYWORDS）ごとにロビン抽選 → shuffle しない
      // 試練・1領域: その領域に絞ったうえでランダム抽出（領域→oni→ランダム）
      // 基本修行: タグ先頭でサブトピック分散 → 順序シャッフル
      const oniAllDomains = mode === "oni" && domain === "all";
      const oniOneDomain = mode === "oni" && domain !== "all";
      const bucketKey = oniAllDomains ? questionDomainBucketKey : questionBucketKey;
      const rawPicked = pickAvoidingLastSession(filtered, questionCount, excludeIds, {
        bucketKey,
        // 試練（1領域）と、基本修行で少問数（5 or 10）のときは
        // 「サブトピック分散」よりも純粋なランダム性を優先する。
        pickRandom: oniOneDomain || (mode !== "oni" && questionCount <= 10),
      });
      let picked = oniAllDomains ? rawPicked : shuffle(rawPicked);
      // 試練は必ず difficulty=oni/鬼 のみ（万一プールに混ざった場合の最終ガード）
      if (mode === "oni") {
        picked = picked.filter((p) => isOniDifficulty(p.difficulty));
        if (picked.length === 0) {
          if (!cancelled) {
            setMsg(
              "鬼問題（difficulty が oni または 鬼）のみ出題します。該当データが選ばれませんでした。Supabase の difficulty 列を確認してください。"
            );
          }
          return;
        }
      }
      if (cancelled) return;
      saveLastSessionQuestionIds(picked.map((q) => q.id));
      setQuestions(picked);
      setIdx(0);
      setSelected(null);
      setIsCorrect(null);
      setAnswersByQuestionId({});
      setStartAt(Date.now());
      setStage("quiz");
    };

    load();
    return () => {
      cancelled = true;
    };
    // domain / mode / 出題数 が変わったら新セッション
  }, [domain, mode, questionCount, includeKeywords, excludeKeywords]);

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
    setAnswersByQuestionId((prev) => ({ ...prev, [q.id]: { selected: choice, isCorrect: ok } }));
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
    if (idx + 1 >= questions.length) {
      setStage("done");
      return;
    }
    const nextIdx = idx + 1;
    const nextQ = questions[nextIdx];
    const saved = answersByQuestionId[nextQ.id];
    setIdx(nextIdx);
    if (saved) {
      setSelected(saved.selected);
      setIsCorrect(saved.isCorrect);
      setStage("feedback");
    } else {
      setSelected(null);
      setIsCorrect(null);
      setStartAt(Date.now());
      setStage("quiz");
    }
  };

  const goBackToPreviousFeedback = () => {
    if (idx <= 0) return;
    setMsg("");
    const prevIdx = idx - 1;
    const prevQ = questions[prevIdx];
    const saved = answersByQuestionId[prevQ.id];
    if (!saved) return;
    setIdx(prevIdx);
    setSelected(saved.selected);
    setIsCorrect(saved.isCorrect);
    setStage("feedback");
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
          <p style={{ margin: "8px 0 0", color: "#1a1a1a" }}>
            {n}問終了（
            {mode === "oni" ? oniLineLabel : mode === "recent_wrong" ? "直近の間違い" : `領域：${domain}`}
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
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#1a1a1a" }}>
        {mode === "oni" ? oniLineLabel : mode === "recent_wrong" ? "直近1週間の間違い" : `領域：${domain}`}
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
          {idx > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <button type="button" onClick={goBackToPreviousFeedback} className="btn-back-prev">
                ← 前の問題の解説を見る
              </button>
            </div>
          ) : null}
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
          <p style={{ fontSize: 15, color: "#1a1a1a", lineHeight: 1.65, margin: "0 0 12px" }}>
            あなたの解答：{(q as any)[`choice_${selected?.toLowerCase()}`] ?? selected} / 正解：{(q as any)[`choice_${q.answer.toLowerCase()}`] ?? q.answer}
          </p>
          {q.explain && (
            <p
              style={{
                whiteSpace: "pre-wrap",
                padding: 14,
                borderRadius: 12,
                background: "rgba(255,255,255,0.95)",
                border: "1px solid #d0e3f5",
                color: "#0f1f33",
                lineHeight: 1.65,
              }}
            >
              <b>解説：</b>
              {q.explain}
            </p>
          )}
          {msg && <pre style={{ color: "#b00", whiteSpace: "pre-wrap" }}>{msg}</pre>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            {idx > 0 ? (
              <button type="button" onClick={goBackToPreviousFeedback} className="btn-back-prev">
                ← 前の問題の解説を見る
              </button>
            ) : null}
            <button type="button" onClick={next} className="btn-next">
              次へ
            </button>
          </div>
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

/** 試練（1領域指定時）: 領域内からランダムに n 問 */
function pickRandomSubset(pool: QuestionCore[], n: number): QuestionCore[] {
  if (pool.length <= n) return shuffle([...pool]);
  return shuffle([...pool]).slice(0, n);
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
function pickDiverseQuestions(
  pool: QuestionCore[],
  n: number,
  bucketKey: (q: QuestionCore) => string = questionBucketKey
): QuestionCore[] {
  if (pool.length <= n) return shuffle([...pool]);
  const buckets = new Map<string, QuestionCore[]>();
  for (const q of pool) {
    const k = bucketKey(q);
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
  excludeIds: Set<string>,
  options?: { bucketKey?: (q: QuestionCore) => string; pickRandom?: boolean }
): QuestionCore[] {
  const bucketKey = options?.bucketKey ?? questionBucketKey;
  const pickRandom = options?.pickRandom ?? false;
  const pickFn = pickRandom
    ? pickRandomSubset
    : (p: QuestionCore[], take: number) => pickDiverseQuestions(p, take, bucketKey);
  const preferred = pool.filter((q) => !excludeIds.has(q.id));
  // 「最近出た問題」を強く避けるため、基本的には preferred だけから出題する。
  // preferred が n 件に満たない場合は「足りない分は諦めて件数を減らす」ことで、
  // 直前セッションとほぼ同じセットが再登場するのを防ぐ。
  if (preferred.length === 0) {
    // すべて最近出題済みなら従来どおりプール全体から選ぶ（出題不能を避けるための最終手段）
    return pickFn(pool, n);
  }
  const take = Math.min(n, preferred.length);
  return pickFn(preferred, take);
}

function nextReviewAt(reason: "wrong" | "hard") {
  const now = new Date();
  const days = reason === "wrong" ? 1 : 3;
  now.setDate(now.getDate() + days);
  return now;
}

const card: React.CSSProperties = { padding: 12, border: "1px solid #ddd", borderRadius: 12, marginBottom: 12, color: "#000" };
