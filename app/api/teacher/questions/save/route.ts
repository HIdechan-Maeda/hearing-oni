import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  normalizeAnswerForDb,
  validateGeneratedDraft,
  type GeneratedQuestionDraft,
} from "@/lib/openaiGeneratedQuestions";
import { requireTeacherFromBearer } from "@/lib/requireTeacherFromBearer";

export const runtime = "nodejs";

type SaveBody = {
  questions?: GeneratedQuestionDraft[];
};

const MAX_SAVE = 16;

function isDraftLike(x: unknown): x is GeneratedQuestionDraft {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.stem === "string";
}

/**
 * 生成プレビューで OK にした下書きだけを questions_core へ保存する。
 */
export async function POST(req: Request) {
  const authResult = await requireTeacherFromBearer(req);
  if (!authResult.ok) return authResult.response;

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const incoming = Array.isArray(body.questions) ? body.questions : [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "no_questions", message: "保存する問題がありません。" }, { status: 400 });
  }
  if (incoming.length > MAX_SAVE) {
    return NextResponse.json(
      { error: "too_many", message: `一度に保存できるのは最大 ${MAX_SAVE} 件です。` },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  }

  type RowOut = {
    id: string;
    stem: string;
    choice_a: string;
    choice_b: string;
    choice_c: string;
    choice_d: string;
    choice_e: string;
    answer: string;
    explain: string | null;
    tags_raw: string | null;
  };

  const accepted: RowOut[] = [];
  const rejected: Array<{ index: number; reason: string; draft: unknown }> = [];

  for (let i = 0; i < incoming.length; i += 1) {
    const raw = incoming[i];
    if (!isDraftLike(raw)) {
      rejected.push({ index: i, reason: "形式が不正です。", draft: raw });
      continue;
    }
    const draft: GeneratedQuestionDraft = {
      stem: String(raw.stem ?? "").trim(),
      choice_a: String(raw.choice_a ?? "").trim(),
      choice_b: String(raw.choice_b ?? "").trim(),
      choice_c: String(raw.choice_c ?? "").trim(),
      choice_d: String(raw.choice_d ?? "").trim(),
      choice_e: String(raw.choice_e ?? "").trim(),
      answer: String(raw.answer ?? "").trim(),
      explain: raw.explain == null ? null : String(raw.explain).trim() || null,
      tags_raw: raw.tags_raw == null ? null : String(raw.tags_raw).trim() || null,
    };
    const v = validateGeneratedDraft(draft);
    if (!v.ok) {
      rejected.push({ index: i, reason: v.reason, draft });
      continue;
    }
    accepted.push({
      id: `ai-${randomUUID()}`,
      stem: draft.stem,
      choice_a: draft.choice_a,
      choice_b: draft.choice_b,
      choice_c: draft.choice_c,
      choice_d: draft.choice_d,
      choice_e: draft.choice_e,
      answer: normalizeAnswerForDb(draft),
      explain: draft.explain,
      tags_raw: draft.tags_raw,
    });
  }

  if (accepted.length === 0) {
    return NextResponse.json(
      {
        error: "nothing_to_insert",
        message: "検証を通った問題がありません。",
        rejected,
      },
      { status: 400 }
    );
  }

  const { error: insErr } = await admin.from("questions_core").insert(accepted);
  if (insErr) {
    return NextResponse.json(
      {
        error: "insert_failed",
        message: insErr.message,
        rejected,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    insertedIds: accepted.map((r) => r.id),
    insertedCount: accepted.length,
    rejected,
  });
}
