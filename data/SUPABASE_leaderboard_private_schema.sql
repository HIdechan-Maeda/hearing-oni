-- ランキングを private スキーマへ移行（Linter 0029 根本対応）
-- アプリは /api/leaderboard/* 経由（service_role）のみ呼ぶ
-- 前提: public.normalize_grade_for_cohort が存在（SUPABASE_leaderboard_cohort.sql）
-- 1行目から末尾までコピーして Run

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.leaderboard_cohort(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_aff text;
  v_grade text;
  v_is_teacher boolean := false;
BEGIN
  IF p_caller_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('row_security', 'off', true);

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pf
    WHERE pf.user_id = p_caller_user_id
      AND lower(trim(coalesce(pf.role, ''))) = 'teacher'
  )
  INTO v_is_teacher;

  IF v_is_teacher THEN
    v_aff := NULLIF(trim(COALESCE(p_affiliation, '')), '');
    v_grade := public.normalize_grade_for_cohort(p_grade);
  ELSE
    SELECT
      NULLIF(trim(COALESCE(pf.affiliation, '')), ''),
      public.normalize_grade_for_cohort(pf.grade)
    INTO v_aff, v_grade
    FROM public.profiles pf
    WHERE pf.user_id = p_caller_user_id;
  END IF;

  IF v_aff IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cohort AS (
    SELECT p.user_id, p.name
    FROM public.profiles p
    WHERE lower(trim(COALESCE(p.role, ''))) IS DISTINCT FROM 'teacher'
      AND NULLIF(trim(COALESCE(p.affiliation, '')), '') = v_aff
      AND public.normalize_grade_for_cohort(p.grade) IS NOT DISTINCT FROM v_grade
  ),
  agg AS (
    SELECT
      l.user_id,
      COUNT(*)::bigint AS ta,
      SUM(CASE WHEN l.is_correct THEN 1 ELSE 0 END)::bigint AS tc
    FROM public.logs l
    INNER JOIN cohort c ON c.user_id = l.user_id
    GROUP BY l.user_id
  )
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(a.tc, 0) DESC,
        (COALESCE(a.tc, 0)::double precision / NULLIF(COALESCE(a.ta, 0), 0)) DESC NULLS LAST,
        c.user_id::text
    )::bigint,
    c.user_id,
    COALESCE(NULLIF(trim(c.name), ''), '（ニックネーム未設定）')::text,
    COALESCE(a.ta, 0::bigint),
    COALESCE(a.tc, 0::bigint),
    CASE
      WHEN COALESCE(a.ta, 0) = 0 THEN 0::numeric
      ELSE ROUND((100.0 * COALESCE(a.tc, 0) / a.ta)::numeric, 1)
    END
  FROM cohort c
  LEFT JOIN agg a ON a.user_id = c.user_id
  ORDER BY 1;
END;
$$;

CREATE OR REPLACE FUNCTION private.leaderboard_affiliation(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_aff text;
  v_is_teacher boolean := false;
BEGIN
  IF p_caller_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('row_security', 'off', true);

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pf
    WHERE pf.user_id = p_caller_user_id
      AND lower(trim(coalesce(pf.role, ''))) = 'teacher'
  )
  INTO v_is_teacher;

  IF v_is_teacher THEN
    v_aff := NULLIF(trim(COALESCE(p_affiliation, '')), '');
  ELSE
    SELECT NULLIF(trim(COALESCE(pf.affiliation, '')), '')
    INTO v_aff
    FROM public.profiles pf
    WHERE pf.user_id = p_caller_user_id;
  END IF;

  IF v_aff IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cohort AS (
    SELECT p.user_id, p.name
    FROM public.profiles p
    WHERE lower(trim(COALESCE(p.role, ''))) IS DISTINCT FROM 'teacher'
      AND NULLIF(trim(COALESCE(p.affiliation, '')), '') = v_aff
  ),
  agg AS (
    SELECT
      l.user_id,
      COUNT(*)::bigint AS ta,
      SUM(CASE WHEN l.is_correct THEN 1 ELSE 0 END)::bigint AS tc
    FROM public.logs l
    INNER JOIN cohort c ON c.user_id = l.user_id
    GROUP BY l.user_id
  )
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(a.tc, 0) DESC,
        (COALESCE(a.tc, 0)::double precision / NULLIF(COALESCE(a.ta, 0), 0)) DESC NULLS LAST,
        c.user_id::text
    )::bigint,
    c.user_id,
    COALESCE(NULLIF(trim(c.name), ''), '（ニックネーム未設定）')::text,
    COALESCE(a.ta, 0::bigint),
    COALESCE(a.tc, 0::bigint),
    CASE
      WHEN COALESCE(a.ta, 0) = 0 THEN 0::numeric
      ELSE ROUND((100.0 * COALESCE(a.tc, 0) / a.ta)::numeric, 1)
    END
  FROM cohort c
  LEFT JOIN agg a ON a.user_id = c.user_id
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION private.leaderboard_cohort(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.leaderboard_affiliation(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.leaderboard_cohort(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION private.leaderboard_affiliation(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION private.leaderboard_cohort(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION private.leaderboard_affiliation(uuid, text) FROM authenticated;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.leaderboard_cohort(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.leaderboard_affiliation(uuid, text) TO service_role;

-- 旧シグネチャ（auth.uid 版）が残っていれば削除
DROP FUNCTION IF EXISTS public.leaderboard_cohort(text, text);
DROP FUNCTION IF EXISTS public.leaderboard_affiliation(text);

-- サーバー API 用: public RPC（service_role のみ EXECUTE → ブラウザ直叩き不可）
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
