/* OPTIONAL: 教師が student_progress を全件 SELECT（is_teacher 作成後のみ） */

CREATE POLICY "student_progress_select_teacher"
  ON public.student_progress
  FOR SELECT
  TO authenticated
  USING (public.is_teacher());
