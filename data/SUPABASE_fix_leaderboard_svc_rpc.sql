-- ランキング API 修復: Invalid schema: private 対策
-- 集計本体は private（DEFINER）。アプリは public RPC を service_role のみ実行。
-- private スキーマ SQL 実行済みの環境でこのファイルを Run。
-- 未実行なら data/SUPABASE_leaderboard_private_schema.sql を先に全文実行。

-- 旧シグネチャ（auth.uid 版）が残っていれば削除
DROP FUNCTION IF EXISTS public.leaderboard_cohort(text, text);
DROP FUNCTION IF EXISTS public.leaderboard_affiliation(text);

CREATE OR REPLACE FUNCTION public.leaderboard_cohort(
  p_caller_user_id uuid,
  p_affiliation text DEFAULT NULL,
  p_grade text DEFAULT NULL
)
RETURNS TABLE (
  rank bigint,
  user_id uuid,
  display_name text,
  total_answered bigint,
  total_correct bigint,
  accuracy_pct numeric
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM private.leaderboard_cohort(p_caller_user_id, p_affiliation, p_grade);
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_affiliation(
  p_caller_user_id uuid,
  p_affiliation text DEFAULT NULL
)
RETURNS TABLE (
  rank bigint,
  user_id uuid,
  display_name text,
  total_answered bigint,
  total_correct bigint,
  accuracy_pct numeric
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM private.leaderboard_affiliation(p_caller_user_id, p_affiliation);
$$;

REVOKE ALL ON FUNCTION public.leaderboard_cohort(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leaderboard_affiliation(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leaderboard_cohort(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.leaderboard_affiliation(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.leaderboard_cohort(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.leaderboard_affiliation(uuid, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.leaderboard_cohort(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.leaderboard_affiliation(uuid, text) TO service_role;
