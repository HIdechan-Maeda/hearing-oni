-- public.profiles の RLS（Supabase SQL Editor で実行）
--
-- 「プロフィール取得エラー」「プロフィール保存エラー」で
-- row-level security / permission denied が出る場合、
-- テーブルに RLS が有効でポリシーが無い／不十分なことが多いです。
--
-- 前提: public.profiles に user_id uuid（auth.users と対応）があり、
--       affiliation / grade は data/SUPABASE_profiles_affiliation_grade.sql で追加済み。

-- 教師判定（ポリシー内で profiles を再帰参照すると失敗するため SECURITY DEFINER で分離）
-- 安全版: search_path 固定・auth.uid() のみ・boolean のみ・動的 SQL なし
-- Lint「authenticated が SECURITY DEFINER を実行可」は RLS 上必須。意図的設計（下記 COMMENT 参照）
CREATE OR REPLACE FUNCTION public.is_teacher()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND lower(trim(coalesce(p.role, ''))) = 'teacher'
  );
$$;

COMMENT ON FUNCTION public.is_teacher() IS
  'RLS 専用の教師判定。ログイン中ユーザー自身の profiles 行のみ参照。authenticated に EXECUTE 必須（ポリシー評価）。anon/public は不可。';

-- Supabase は関数作成時に anon / authenticated へ EXECUTE を付与することがある。
-- PUBLIC のみ REVOKE では anon が残り、/rest/v1/rpc/is_teacher が未ログインで叩ける（リンター指摘）。
-- ※ セキュリティ自動修復後に「permission denied for function is_teacher」(42501) が出たら
--    data/SUPABASE_fix_is_teacher_grants.sql を実行（authenticated への EXECUTE を復旧）。
REVOKE ALL ON FUNCTION public.is_teacher() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_teacher() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- 既存ポリシーと名前が被る場合は DROP してから再実行してください
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_teacher" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

-- 自分の行は読める
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 教師は全員分のプロフィールを読める（教師ダッシュボード用）
CREATE POLICY "profiles_select_teacher"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_teacher());

-- 自分の行だけ挿入（新規登録後の初期行）
CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 自分の行だけ更新
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
