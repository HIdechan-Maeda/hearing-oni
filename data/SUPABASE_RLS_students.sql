/* public.students の RLS 修復
 *
 * Lint: INSERT "Users can insert their own student record" の WITH CHECK (true)
 *
 * id が bigint（連番）のため auth.uid() とは比較しない。
 * 本人判定は user_id uuid（auth.users.id）を使用。
 *
 * user_id 列が無い場合は列一覧を確認:
 * SELECT column_name, data_type FROM information_schema.columns
 * WHERE table_schema = 'public' AND table_name = 'students';
 */

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;

DROP POLICY IF EXISTS "Users can insert their own student record" ON public.students;
DROP POLICY IF EXISTS "Users can update their own student record" ON public.students;
DROP POLICY IF EXISTS "Users can delete their own student record" ON public.students;
DROP POLICY IF EXISTS "Users can view their own student record" ON public.students;
DROP POLICY IF EXISTS "Users can read their own student record" ON public.students;

DROP POLICY IF EXISTS "students_insert_own" ON public.students;
DROP POLICY IF EXISTS "students_select_own" ON public.students;
DROP POLICY IF EXISTS "students_update_own" ON public.students;
DROP POLICY IF EXISTS "students_delete_own" ON public.students;
DROP POLICY IF EXISTS "students_select_teacher" ON public.students;

CREATE POLICY "students_insert_own"
  ON public.students
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "students_select_own"
  ON public.students
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "students_update_own"
  ON public.students
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "students_delete_own"
  ON public.students
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
