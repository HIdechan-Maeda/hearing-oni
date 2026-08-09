import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireTeacherFromBearer } from "@/lib/requireTeacherFromBearer";
import { buildQuestionThreadTexts } from "@/lib/xThreadPost";
import type { QuestionCore } from "@/types";

export const runtime = "nodejs";

type PickBody = {
  /** tags_raw / stem などに含む（任意） */
  keyword?: string | null;
};

function isUsableQuestion(q: QuestionCore): boolean {
  if (!(q.stem ?? "").trim()) return false;
  if (!(q.choice_a ?? "").trim()) return false;
  if (!(q.choice_b ?? "").trim()) return false;
  if (!(q.answer ?? "").trim()) return false;
  // 図問題はテキスト投稿では省略
  if ((q.image_url ?? "").trim()) return false;
  return true;
}

/**
 * X投稿用に1問ピックアップ（プレビューのみ・投稿しない）
 */
export async function POST(req: Request) {
  const auth = await requireTeacherFromBearer(req);
  if (!auth.ok) return auth.response;

  let body: PickBody = {};
  try {
    body = (await req.json()) as PickBody;
  } catch {
    body = {};
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  }

  const keyword = body.keyword != null ? String(body.keyword).normalize("NFKC").trim().slice(0, 80) : "";

  let postedIds: string[] = [];
  const postedRes = await admin.from("x_question_posts").select("question_id");
  if (!postedRes.error && postedRes.data) {
    postedIds = postedRes.data.map((r) => String((r as { question_id: string }).question_id));
  }

  let q = admin
    .from("questions_core")
    .select("id,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw,image_url,difficulty")
    .limit(800);

  if (keyword) {
    const safe = keyword.replace(/[%_,]/g, " ").trim();
    if (safe) {
      q = q.or(
        `stem.ilike.%${safe}%,choice_a.ilike.%${safe}%,choice_b.ilike.%${safe}%,tags_raw.ilike.%${safe}%,explain.ilike.%${safe}%`
      );
    }
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  const posted = new Set(postedIds);
  let pool = ((data ?? []) as unknown as QuestionCore[]).filter(
    (row) => isUsableQuestion(row) && !posted.has(row.id)
  );

  // 未投稿が無い場合は履歴無視で再候補（運用初期）
  if (pool.length === 0) {
    pool = ((data ?? []) as unknown as QuestionCore[]).filter(isUsableQuestion);
  }

  if (pool.length === 0) {
    return NextResponse.json(
      {
        error: "no_question",
        message: "投稿できる問題がありません（図なし・選択肢ありの問題を確認してください）。",
      },
      { status: 404 }
    );
  }

  const picked = pool[Math.floor(Math.random() * pool.length)];
  const preview = buildQuestionThreadTexts(picked);

  return NextResponse.json({
    preview,
    alreadyPostedCount: postedIds.length,
    poolSize: pool.length,
    note:
      postedRes.error != null
        ? "x_question_posts が未作成の可能性があります。data/SUPABASE_x_question_posts.sql を実行すると重複防止できます。"
        : null,
  });
}
