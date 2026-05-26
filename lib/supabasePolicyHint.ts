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
  let s = supabaseRlsHint(message) + supabaseSchemaHint(message);
  if (/profiles\.role cannot|cannot be changed by users|cannot be set to teacher/i.test(message)) {
    s += " 教師権限（role）は管理者のみ付与できます。担当教員に連絡してください。";
  }
  return s;
}

/** ランキング API / private RPC 失敗時 */
export function supabaseLeaderboardRpcHint(message: string): string {
  let s = "";
  if (/function|does not exist|PGRST202|schema cache|42883|leaderboard_failed/i.test(message)) {
    s +=
      " Supabase SQL Editor で data/SUPABASE_fix_leaderboard_svc_rpc.sql（未実行なら data/SUPABASE_leaderboard_private_schema.sql も）を実行してください。Vercel に SUPABASE_SERVICE_ROLE_KEY があるかも確認してください。";
  }
  if (/server_misconfigured|503/i.test(message)) {
    s += " Vercel の Environment Variables に SUPABASE_SERVICE_ROLE_KEY を設定し、再デプロイしてください。";
  }
  if (/unauthorized|401/i.test(message)) {
    s += " 一度ログアウトしてから再ログインしてください。";
  }
  return s;
}
