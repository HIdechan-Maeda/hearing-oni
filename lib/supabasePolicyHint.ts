/** PostgREST のエラーオブジェクトを 1 行にまとめる（message / details / hint / code） */
export function formatSupabaseError(err: {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}): string {
  const parts = [err.message.trim()];
  if (err.details?.trim()) parts.push(`詳細: ${err.details.trim()}`);
  if (err.hint?.trim()) parts.push(`ヒント: ${err.hint.trim()}`);
  if (err.code) parts.push(`コード: ${err.code}`);
  return parts.join(" ");
}

/** PostgREST / Postgres の権限・RLS 系メッセージなら、Supabase 側の対処を一文添える */
export function supabaseRlsHint(message: string): string {
  if (/row-level security|\bRLS\b|permission denied|42501|PGRST301/i.test(message)) {
    return " Supabase の SQL Editor で data/SUPABASE_RLS_profiles.sql を実行し、profiles の RLS ポリシーを設定してください。";
  }
  return "";
}

/** カラム未定義などスキーマ不整合のとき */
export function supabaseSchemaHint(message: string): string {
  if (/42703|does not exist|column .+ does not/i.test(message)) {
    return " Supabase で data/SUPABASE_profiles_affiliation_grade.sql を実行し、affiliation / grade カラムを追加済みか確認してください。";
  }
  return "";
}

export function supabaseProfileErrorHints(message: string): string {
  return supabaseRlsHint(message) + supabaseSchemaHint(message);
}
