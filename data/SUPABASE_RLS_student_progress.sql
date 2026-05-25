/* public.student_progress の RLS 修復
 *
 * このテーブルに user_id 列が無い場合の版（student_id text で本人判定）
 * student_id に auth.users.id（UUID）を文字列で保存している前提
 *
 * 別の意味の学籍番号を入れている場合はポリシーを要調整（列一覧を確認）
 *
 * 列確認:
 * SELECT column_name, data_type FROM information_schema.columns
 * WHERE table_schema = 'public' AND table_name = 'student_progress';
 */

ALTER TABLE public.student_progress ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_progress TO authenticated;

DROP POLICY IF EXISTS "Users can insert their own progress" ON public.student_progress;
DROP POLICY IF EXISTS "Users can update their own progress" ON public.student_progress;
DROP POLICY IF EXISTS "Users can delete their own progress" ON public.student_progress;
DROP POLICY IF EXISTS "Users can view their own progress" ON public.student_progress;
DROP POLICY IF EXISTS "Users can read their own progress" ON public.student_progress;

DROP POLICY IF EXISTS "student_progress_insert_own" ON public.student_progress;
DROP POLICY IF EXISTS "student_progress_select_own" ON public.student_progress;
DROP POLICY IF EXISTS "student_progress_update_own" ON public.student_progress;
DROP POLICY IF EXISTS "student_progress_delete_own" ON public.student_progress;
DROP POLICY IF EXISTS "student_progress_select_teacher" ON public.student_progress;

CREATE POLICY "student_progress_insert_own"
  ON public.student_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (student_id = auth.uid()::text);

CREATE POLICY "student_progress_select_own"
  ON public.student_progress
  FOR SELECT
  TO authenticated
  USING (student_id = auth.uid()::text);

CREATE POLICY "student_progress_update_own"
  ON public.student_progress
  FOR UPDATE
  TO authenticated
  USING (student_id = auth.uid()::text)
  WITH CHECK (student_id = auth.uid()::text);

CREATE POLICY "student_progress_delete_own"
  ON public.student_progress
  FOR DELETE
  TO authenticated
  USING (student_id = auth.uid()::text);
