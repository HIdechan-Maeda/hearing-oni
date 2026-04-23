-- public.questions_core_tags に RLS を有効にする
-- Supabase のセキュリティ警告対応。SQL Editor でこのファイルの内容を実行してください。
-- 前提: public.is_teacher() が存在すること（data/SUPABASE_RLS_profiles.sql）

-- 1. RLS を有効化（必須）
ALTER TABLE public.questions_core_tags ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.questions_core_tags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions_core_tags TO authenticated;

DROP POLICY IF EXISTS "questions_core_tags_select_authenticated" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_select_anon" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_insert_authenticated" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_update_authenticated" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_delete_authenticated" ON public.questions_core_tags;

-- 2. 読み取りポリシー（認証済み・匿名の両方で SELECT 可能）
CREATE POLICY "questions_core_tags_select_authenticated"
  ON public.questions_core_tags FOR SELECT TO authenticated USING (true);

CREATE POLICY "questions_core_tags_select_anon"
  ON public.questions_core_tags FOR SELECT TO anon USING (true);

-- 3. 書き込みは教師のみ（認証済み全員に開くとRLS警告対象になる）
CREATE POLICY "questions_core_tags_insert_authenticated"
  ON public.questions_core_tags FOR INSERT TO authenticated WITH CHECK (public.is_teacher());

CREATE POLICY "questions_core_tags_update_authenticated"
  ON public.questions_core_tags FOR UPDATE TO authenticated USING (public.is_teacher()) WITH CHECK (public.is_teacher());

CREATE POLICY "questions_core_tags_delete_authenticated"
  ON public.questions_core_tags FOR DELETE TO authenticated USING (public.is_teacher());
