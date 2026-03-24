-- 学生の成績管理用: 所属・学年（Supabase SQL Editor で実行）
-- public.profiles にカラムを追加

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS affiliation text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS grade text;

COMMENT ON COLUMN public.profiles.affiliation IS '所属（学科・クラス等）';
COMMENT ON COLUMN public.profiles.grade IS '学年（例: 3年）';

-- プロフィール取得・保存で RLS エラーが出る場合は、同じく SQL Editor で
-- data/SUPABASE_RLS_profiles.sql を実行してください。
