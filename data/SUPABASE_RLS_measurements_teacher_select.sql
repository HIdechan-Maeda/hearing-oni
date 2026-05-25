/* OPTIONAL: 教師が measurements を全件 SELECT（is_teacher 作成後のみ）
 * 先に data/SUPABASE_RLS_profiles.sql または data/SUPABASE_fix_is_teacher_grants.sql を実行すること
 */

CREATE POLICY "measurements_select_teacher"
  ON public.measurements
  FOR SELECT
  TO authenticated
  USING (public.is_teacher());
