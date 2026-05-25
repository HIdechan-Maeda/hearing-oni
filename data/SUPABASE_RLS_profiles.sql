-- public.profiles の RLS（Supabase SQL Editor で実行）
--
-- 教師判定は private.is_teacher()（API 非公開スキーマ）。初回は
-- data/SUPABASE_fix_is_teacher_private_schema.sql も実行すること。

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_teacher" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "profiles_select_teacher"
  ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT private.is_teacher()));

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- role の自己昇格防止: data/SUPABASE_profiles_protect_role.sql を別途実行すること
