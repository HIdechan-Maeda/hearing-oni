-- 学外メールの新規登録許可リスト（Supabase SQL Editor で実行）
-- アプリは Route Handler が service_role で照会。教師は Dashboard から追加。
--
-- 前提: public.is_teacher() が存在すること（data/SUPABASE_RLS_profiles.sql）

CREATE TABLE IF NOT EXISTS public.signup_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signup_allowlist_email_unique UNIQUE (email)
);

COMMENT ON TABLE public.signup_allowlist IS '学外メールの新規登録許可（email は小文字で保存推奨）';

ALTER TABLE public.signup_allowlist ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_allowlist TO authenticated;

DROP POLICY IF EXISTS "signup_allowlist_teacher_select" ON public.signup_allowlist;
DROP POLICY IF EXISTS "signup_allowlist_teacher_insert" ON public.signup_allowlist;
DROP POLICY IF EXISTS "signup_allowlist_teacher_update" ON public.signup_allowlist;
DROP POLICY IF EXISTS "signup_allowlist_teacher_delete" ON public.signup_allowlist;

CREATE POLICY "signup_allowlist_teacher_select"
ON public.signup_allowlist FOR SELECT TO authenticated
USING (public.is_teacher());

CREATE POLICY "signup_allowlist_teacher_insert"
ON public.signup_allowlist FOR INSERT TO authenticated
WITH CHECK (public.is_teacher());

CREATE POLICY "signup_allowlist_teacher_update"
ON public.signup_allowlist FOR UPDATE TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

CREATE POLICY "signup_allowlist_teacher_delete"
ON public.signup_allowlist FOR DELETE TO authenticated
USING (public.is_teacher());
