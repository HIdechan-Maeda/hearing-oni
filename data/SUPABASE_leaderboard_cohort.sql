-- 同一「所属・学年」内のランキング（解答ログの正解数ベース）
-- Supabase SQL Editor で実行後、学生は /ranking、教師はダッシュボードから利用可能
-- （user_id 曖昧さ対策: 関数内先頭の #variable_conflict use_column を削除しないこと）
--
-- normalize_grade_for_cohort は lib/profileFieldOptions.ts の normalizeGradeFromDb と揃えること
-- （「4年生」「４年」などを「4年」に統一し、教師が選ぶプルダウン値と一致させる）

CREATE OR REPLACE FUNCTION public.normalize_grade_for_cohort(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  t text;
  s text;
BEGIN
  t := trim(coalesce(p, ''));
  IF t = '' THEN
    RETURN NULL;
  END IF;
  s := translate(t, '１２３４', '1234');
  IF s IN ('1年', '2年', '3年', '4年', '既卒') THEN
    RETURN s;
  END IF;
  IF s ~ '^[1-4]年生$' THEN
    RETURN substr(s, 1, 1) || '年';
  END IF;
  IF s IN ('1', '2', '3', '4') THEN
    RETURN s || '年';
  END IF;
  IF s IN ('卒業', '卒業生', '卒業済') THEN
    RETURN '既卒';
  END IF;
  IF lower(s) IN ('graduate', 'graduate student') THEN
    RETURN '既卒';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_grade_for_cohort(text) FROM PUBLIC;

COMMENT ON FUNCTION public.normalize_grade_for_cohort(text) IS
  'profiles.grade の表記ゆれ（4年生・４年など）を 1年〜4年・既卒 に統一。leaderboard_cohort 内で使用。';

CREATE OR REPLACE FUNCTION public.leaderboard_cohort(
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
  -- RLS が有効な logs / profiles でも集計できるよう、関数内だけ行セキュリティを無効化
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
    v_grade := public.normalize_grade_for_cohort(p_grade);
  ELSE
    SELECT
      NULLIF(trim(COALESCE(pf.affiliation, '')), ''),
      public.normalize_grade_for_cohort(pf.grade)
    INTO v_aff, v_grade
    FROM public.profiles pf
    WHERE pf.user_id = auth.uid();
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

REVOKE ALL ON FUNCTION public.leaderboard_cohort(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leaderboard_cohort(text, text) TO authenticated;

COMMENT ON FUNCTION public.leaderboard_cohort IS
  '学生: 自分の所属・学年のコホート内ランキング。教師: p_affiliation, p_grade で指定。';
