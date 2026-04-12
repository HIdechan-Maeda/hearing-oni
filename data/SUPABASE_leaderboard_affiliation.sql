-- 同一「所属」内の全学年ランキング（解答ログの正解数ベース）
-- 学生は自分の所属に一致する全受講生（学年は問わない）。教師は p_affiliation で指定。
-- Supabase SQL Editor で実行後、学生は /ranking の「所属・全学年」タブから利用
--
-- leaderboard_cohort と同様 SECURITY DEFINER + row_security off で logs を集計

CREATE OR REPLACE FUNCTION public.leaderboard_affiliation(
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
  PERFORM set_config('row_security', 'off', true);

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pf
    WHERE pf.user_id = auth.uid()
      AND lower(trim(coalesce(pf.role, ''))) = 'teacher'
  )
  INTO v_is_teacher;

  IF v_is_teacher THEN
    v_aff := NULLIF(trim(COALESCE(p_affiliation, '')), '');
  ELSE
    SELECT NULLIF(trim(COALESCE(pf.affiliation, '')), '')
    INTO v_aff
    FROM public.profiles pf
    WHERE pf.user_id = auth.uid();
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

REVOKE ALL ON FUNCTION public.leaderboard_affiliation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leaderboard_affiliation(text) TO authenticated;

COMMENT ON FUNCTION public.leaderboard_affiliation IS
  '学生: 自分の所属に一致する全学年の受講生ランキング。教師: p_affiliation で所属を指定。';
