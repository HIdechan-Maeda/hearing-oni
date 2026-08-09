import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireTeacherFromBearer } from "@/lib/requireTeacherFromBearer";
import { buildQuestionThreadTexts, postQuestionThread } from "@/lib/xThreadPost";
import type { QuestionCore } from "@/types";

export const runtime = "nodejs";

type PostBody = {
  questionId?: string;
};

/**
 * 確認済みの1問を X スレッド投稿（1:問題 2:正答・解説）
 */
export async function POST(req: Request) {
  const auth = await requireTeacherFromBearer(req);
  if (!auth.ok) return auth.response;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const questionId = typeof body.questionId === "string" ? body.questionId.trim() : "";
  if (!questionId) {
    return NextResponse.json({ error: "missing_question_id" }, { status: 400 });
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  }

  const { data: row, error: fetchErr } = await admin
    .from("questions_core")
    .select("id,stem,choice_a,choice_b,choice_c,choice_d,choice_e,answer,explain,tags_raw,image_url")
    .eq("id", questionId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: "fetch_failed", message: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const q = row as unknown as QuestionCore;
  const preview = buildQuestionThreadTexts(q);

  let tweet1Id: string;
  let tweet2Id: string;
  try {
    const posted = await postQuestionThread(preview);
    tweet1Id = posted.tweet1Id;
    tweet2Id = posted.tweet2Id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "x_post_failed", message: msg }, { status: 502 });
  }

  const { error: logErr } = await admin.from("x_question_posts").upsert(
    {
      question_id: questionId,
      tweet1_id: tweet1Id,
      tweet2_id: tweet2Id,
      posted_by: auth.userId,
      posted_at: new Date().toISOString(),
    },
    { onConflict: "question_id" }
  );

  return NextResponse.json({
    ok: true,
    questionId,
    tweet1Id,
    tweet2Id,
    preview,
    logWarning: logErr
      ? `投稿は成功しましたが履歴保存に失敗: ${logErr.message}（SUPABASE_x_question_posts.sql を実行してください）`
      : null,
    urls: {
      tweet1: `https://x.com/i/web/status/${tweet1Id}`,
      tweet2: `https://x.com/i/web/status/${tweet2Id}`,
    },
  });
}
