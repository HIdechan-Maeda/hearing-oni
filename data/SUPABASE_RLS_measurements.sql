/* public.measurements の RLS 修復
 *
 * Lint: INSERT "Users can insert their own measurements" の WITH CHECK (true)
 * → user_id = auth.uid() に限定
 *
 * 前提: このファイルだけで完結（is_teacher は不要）
 * 教師が全件 SELECT する場合は末尾の OPTIONAL を is_teacher 作成後に実行
 */

ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurements TO authenticated;

DROP POLICY IF EXISTS "Users can insert their own measurements" ON public.measurements;
DROP POLICY IF EXISTS "Users can update their own measurements" ON public.measurements;
DROP POLICY IF EXISTS "Users can delete their own measurements" ON public.measurements;
DROP POLICY IF EXISTS "Users can view their own measurements" ON public.measurements;
DROP POLICY IF EXISTS "Users can read their own measurements" ON public.measurements;

DROP POLICY IF EXISTS "measurements_insert_own" ON public.measurements;
DROP POLICY IF EXISTS "measurements_select_own" ON public.measurements;
DROP POLICY IF EXISTS "measurements_update_own" ON public.measurements;
DROP POLICY IF EXISTS "measurements_delete_own" ON public.measurements;
DROP POLICY IF EXISTS "measurements_select_teacher" ON public.measurements;

CREATE POLICY "measurements_insert_own"
  ON public.measurements
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "measurements_select_own"
  ON public.measurements
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "measurements_update_own"
  ON public.measurements
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "measurements_delete_own"
  ON public.measurements
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
