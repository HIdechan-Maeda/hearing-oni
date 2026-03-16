-- public.questions_core_tags に RLS を有効にする
-- Supabase のセキュリティ警告対応。SQL Editor でこのファイルの内容を実行してください。
-- 既にポリシーがある場合は「policy already exists」が出るので、その行はスキップしてください。

-- 1. RLS を有効化（必須）
ALTER TABLE public.questions_core_tags ENABLE ROW LEVEL SECURITY;

-- 2. 読み取りポリシー（認証済み・匿名の両方で SELECT 可能）
CREATE POLICY "questions_core_tags_select_authenticated"
  ON public.questions_core_tags FOR SELECT TO authenticated USING (true);

CREATE POLICY "questions_core_tags_select_anon"
  ON public.questions_core_tags FOR SELECT TO anon USING (true);

-- 3. 書き込みは認証済みのみ（テーブルをアプリから更新する場合用。不要ならコメントアウト可）
CREATE POLICY "questions_core_tags_insert_authenticated"
  ON public.questions_core_tags FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "questions_core_tags_update_authenticated"
  ON public.questions_core_tags FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "questions_core_tags_delete_authenticated"
  ON public.questions_core_tags FOR DELETE TO authenticated USING (true);
