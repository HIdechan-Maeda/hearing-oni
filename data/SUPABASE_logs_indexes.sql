-- logs テーブルの読み取り負荷軽減（教師ダッシュボード・日別ログイン・学生ダッシュボード）
-- Supabase SQL Editor で実行

CREATE INDEX IF NOT EXISTS logs_answered_at_desc_idx
  ON public.logs (answered_at DESC);

CREATE INDEX IF NOT EXISTS logs_user_id_answered_at_desc_idx
  ON public.logs (user_id, answered_at DESC);

COMMENT ON INDEX public.logs_answered_at_desc_idx IS
  '教師ダッシュボードの全件ページング（answered_at 降順）向け';

COMMENT ON INDEX public.logs_user_id_answered_at_desc_idx IS
  '学生別ログ取得・日別ログイン集計（user_id + answered_at）向け';
