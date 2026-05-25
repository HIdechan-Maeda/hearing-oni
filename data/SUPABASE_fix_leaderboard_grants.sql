/* ランキング RPC 修復
 *
 * エラー 42883 function leaderboard_cohort does not exist
 *   → 先に data/SUPABASE_leaderboard_cohort.sql を全文実行（関数を作成）
 *   → 所属・全学年タブも使うなら data/SUPABASE_leaderboard_affiliation.sql も実行
 *   → その後、本ファイルを実行
 *
 * エラー 42501 permission denied for function leaderboard_*
 *   → 関数がある状態で本ファイルのみ実行
 */

REVOKE ALL ON FUNCTION public.leaderboard_cohort(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leaderboard_cohort(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_cohort(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.leaderboard_affiliation(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leaderboard_affiliation(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_affiliation(text) TO authenticated;
