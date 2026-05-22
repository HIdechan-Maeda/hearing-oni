-- public.questions_core の RLS（Supabase SQL Editor で実行）
-- 前提: public.is_teacher() が存在すること（data/SUPABASE_RLS_profiles.sql）
--
-- 受講生: セッション・復習で SELECT のみ
-- 教師: INSERT / UPDATE / DELETE（Table Editor やクライアント直書き用）
-- OpenAI 問題生成 API は service_role で書き込むため RLS をバイパスしますが、
-- 多層防御として教師ロール以外の authenticated からの書き込みは拒否します。

ALTER TABLE public.questions_core ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.questions_core TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions_core TO authenticated;

-- 古い is_maehide() 用ポリシー（あれば削除）
DROP POLICY IF EXISTS "questions_core_insert_maehide" ON public.questions_core;
DROP POLICY IF EXISTS "questions_core_update_maehide" ON public.questions_core;
DROP POLICY IF EXISTS "questions_core_delete_maehide" ON public.questions_core;

-- 再実行用: 同名の is_teacher() ポリシーをいったん削除
DROP POLICY IF EXISTS "questions_core_select_authenticated" ON public.questions_core;
DROP POLICY IF EXISTS "questions_core_select_anon" ON public.questions_core;
DROP POLICY IF EXISTS "questions_core_insert_teacher" ON public.questions_core;
DROP POLICY IF EXISTS "questions_core_update_teacher" ON public.questions_core;
DROP POLICY IF EXISTS "questions_core_delete_teacher" ON public.questions_core;

CREATE POLICY "questions_core_select_authenticated"
  ON public.questions_core FOR SELECT TO authenticated USING (true);

CREATE POLICY "questions_core_select_anon"
  ON public.questions_core FOR SELECT TO anon USING (true);

CREATE POLICY "questions_core_insert_teacher"
  ON public.questions_core FOR INSERT TO authenticated
  WITH CHECK (public.is_teacher());

CREATE POLICY "questions_core_update_teacher"
  ON public.questions_core FOR UPDATE TO authenticated
  USING (public.is_teacher()) WITH CHECK (public.is_teacher());

CREATE POLICY "questions_core_delete_teacher"
  ON public.questions_core FOR DELETE TO authenticated
  USING (public.is_teacher());
