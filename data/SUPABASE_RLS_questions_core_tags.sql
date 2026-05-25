-- public.questions_core_tags に RLS を有効にする
-- Supabase のセキュリティ警告対応。SQL Editor でこのファイルの内容を実行してください。
-- 前提: private.is_teacher()（data/SUPABASE_fix_is_teacher_private_schema.sql）
--
-- 読み取り: ログイン済み（authenticated）のみ。未ログイン anon は不可。

ALTER TABLE public.questions_core_tags ENABLE ROW LEVEL SECURITY;

REVOKE SELECT ON public.questions_core_tags FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions_core_tags TO authenticated;

-- 古い is_maehide() 用ポリシー（あれば削除）
DROP POLICY IF EXISTS "tags_insert_only_maehide" ON public.questions_core_tags;
DROP POLICY IF EXISTS "tags_update_only_maehide" ON public.questions_core_tags;
DROP POLICY IF EXISTS "tags_delete_only_maehide" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_insert_maehide" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_update_maehide" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_delete_maehide" ON public.questions_core_tags;

DROP POLICY IF EXISTS "questions_core_tags_select_authenticated" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_select_anon" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_insert_authenticated" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_update_authenticated" ON public.questions_core_tags;
DROP POLICY IF EXISTS "questions_core_tags_delete_authenticated" ON public.questions_core_tags;

CREATE POLICY "questions_core_tags_select_authenticated"
  ON public.questions_core_tags FOR SELECT TO authenticated USING (true);

CREATE POLICY "questions_core_tags_insert_authenticated"
  ON public.questions_core_tags FOR INSERT TO authenticated WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "questions_core_tags_update_authenticated"
  ON public.questions_core_tags FOR UPDATE TO authenticated USING ((SELECT private.is_teacher())) WITH CHECK ((SELECT private.is_teacher()));

CREATE POLICY "questions_core_tags_delete_authenticated"
  ON public.questions_core_tags FOR DELETE TO authenticated USING ((SELECT private.is_teacher()));
