-- questions_core を 10 列スキーマに変更するマイグレーション
-- 既存テーブルがある場合: explain を追加し、古い列を削除
ALTER TABLE public.questions_core ADD COLUMN IF NOT EXISTS explain text;
UPDATE public.questions_core SET explain = COALESCE(explain_core, '') || E'\n' || COALESCE(explain_reason, '') WHERE explain IS NULL;
ALTER TABLE public.questions_core DROP COLUMN IF EXISTS explain_core;
ALTER TABLE public.questions_core DROP COLUMN IF EXISTS explain_reason;
ALTER TABLE public.questions_core DROP COLUMN IF EXISTS kc_ids_raw;
