/* update_updated_at_column の search_path 警告修復
 *
 * Supabase Linter: "role mutable search_path"
 * → SET search_path を明示（空パス + pg_catalog 参照が安全）
 *
 * トリガーで使っているテーブルは変更不要（関数名が同じなら既存トリガーはそのまま動く）。
 * 実行前に Dashboard で関数の定義を確認し、本体が大きく違う場合はマージしてから Run。
 */

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at_column() IS
  'BEFORE UPDATE トリガー用: updated_at を現在時刻に更新。search_path 固定。';
