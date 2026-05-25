-- Lint 0029: is_teacher を private へ（Exposed schemas は public のみ）
-- 1行目から末尾までコピーして Run（チャットや Markdown から貼らない）

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_teacher()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND lower(trim(coalesce(p.role, ''))) = 'teacher'
  );
$$;

COMMENT ON FUNCTION private.is_teacher() IS
  'RLS teacher check; not exposed via REST RPC';

REVOKE ALL ON FUNCTION private.is_teacher() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.is_teacher() FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_teacher() TO authenticated;

-- 旧 public.is_teacher() 参照ポリシーを先にすべて外す（DROP FUNCTION より前に必須）
DROP POLICY IF EXISTS "Teachers can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_teacher" ON public.profiles;

DROP POLICY IF EXISTS "signup_allowlist_teacher_select" ON public.signup_allowlist;
DROP POLICY IF EXISTS "signup_allowlist_teacher_insert" ON public.signup_allowlist;
DROP POLICY IF EXISTS "signup_allowlist_teacher_update" ON public.signup_allowlist;
DROP POLICY IF EXISTS "signup_allowlist_teacher_delete" ON public.signup_allowlist;

DROP POLICY IF EXISTS "announcements_select_authenticated" ON public.announcements;
DROP POLICY IF EXISTS "announcements_teacher_insert" ON public.announcements;
DROP POLICY IF EXISTS "announcements_teacher_update" ON public.announcements;
DROP POLICY IF EXISTS "announcements_teacher_delete" ON public.announcements;

DROP POLICY IF EXISTS "questions_core_tags_insert_authenticated" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_update_authenticated" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_delete_authenticated" ON public.questions_core_tags;

DROP POLICY IF EXISTS "questions_core_insert_teacher" ON public.questions_core;
DROP POLICY IF EXISTS "questions_core_update_teacher" ON public.questions_core;
DROP POLICY IF EXISTS "questions_core_delete_teacher" ON public.questions_core;

DROP FUNCTION IF EXISTS public.is_teacher();

CREATE POLICY "profiles_select_teacher"
  ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT private.is_teacher()));

CREATE POLICY "signup_allowlist_teacher_select"
  ON public.signup_allowlist FOR SELECT TO authenticated
  USING ((SELECT private.is_teacher()));

CREATE POLICY "signup_allowlist_teacher_insert"
  ON public.signup_allowlist FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "signup_allowlist_teacher_update"
  ON public.signup_allowlist FOR UPDATE TO authenticated
  USING ((SELECT private.is_teacher()))
  WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "signup_allowlist_teacher_delete"
  ON public.signup_allowlist FOR DELETE TO authenticated
  USING ((SELECT private.is_teacher()));

CREATE POLICY "questions_core_insert_teacher"
  ON public.questions_core FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "questions_core_update_teacher"
  ON public.questions_core FOR UPDATE TO authenticated
  USING ((SELECT private.is_teacher()))
  WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "questions_core_delete_teacher"
  ON public.questions_core FOR DELETE TO authenticated
  USING ((SELECT private.is_teacher()));

CREATE POLICY "questions_core_tags_insert_authenticated"
  ON public.questions_core_tags FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "questions_core_tags_update_authenticated"
  ON public.questions_core_tags FOR UPDATE TO authenticated
  USING ((SELECT private.is_teacher()))
  WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "questions_core_tags_delete_authenticated"
  ON public.questions_core_tags FOR DELETE TO authenticated
  USING ((SELECT private.is_teacher()));

CREATE POLICY "announcements_select_authenticated"
  ON public.announcements FOR SELECT TO authenticated
  USING (
    (SELECT private.is_teacher())
    OR (is_active = true AND published_at <= now())
  );

CREATE POLICY "announcements_teacher_insert"
  ON public.announcements FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "announcements_teacher_update"
  ON public.announcements FOR UPDATE TO authenticated
  USING ((SELECT private.is_teacher()))
  WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "announcements_teacher_delete"
  ON public.announcements FOR DELETE TO authenticated
  USING ((SELECT private.is_teacher()));

-- 以下はテーブルがあるプロジェクトのみ（無い場合はスキップ）
DO $optional$
BEGIN
  IF to_regclass('public.measurements') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "measurements_select_teacher" ON public.measurements';
    EXECUTE $cmd$
      CREATE POLICY "measurements_select_teacher"
        ON public.measurements FOR SELECT TO authenticated
        USING ((SELECT private.is_teacher()))
    $cmd$;
  END IF;

  IF to_regclass('public.student_progress') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "student_progress_select_teacher" ON public.student_progress';
    EXECUTE $cmd$
      CREATE POLICY "student_progress_select_teacher"
        ON public.student_progress FOR SELECT TO authenticated
        USING ((SELECT private.is_teacher()))
    $cmd$;
  END IF;
END
$optional$;
