-- ホーム上部のお知らせ（公開中・日時到達済みのうち新しい順に最大2件。履歴は行として残す）
-- 前提: public.is_teacher() が存在すること（data/SUPABASE_RLS_profiles.sql）

CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  published_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.announcements IS 'アプリのお知らせ。is_active かつ published_at<=現在 のうち published_at が新しい順に最大2件をホームに表示。';

CREATE INDEX IF NOT EXISTS announcements_published_idx
  ON public.announcements (published_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.announcements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;

DROP POLICY IF EXISTS "announcements_select_visible" ON public.announcements;
DROP POLICY IF EXISTS "announcements_select_teacher" ON public.announcements;
DROP POLICY IF EXISTS "announcements_teacher_insert" ON public.announcements;
DROP POLICY IF EXISTS "announcements_teacher_update" ON public.announcements;
DROP POLICY IF EXISTS "announcements_teacher_delete" ON public.announcements;

-- 未ログイン: 公開中かつ掲載日時到達のみ
CREATE POLICY "announcements_select_visible"
ON public.announcements FOR SELECT
TO anon
USING (
  is_active = true
  AND published_at <= now()
);

-- ログイン済み: 一般は上と同じ。教師は全行（履歴・非表示・予約も管理画面用）
CREATE POLICY "announcements_select_authenticated"
ON public.announcements FOR SELECT
TO authenticated
USING (
  public.is_teacher()
  OR (
    is_active = true
    AND published_at <= now()
  )
);

CREATE POLICY "announcements_teacher_insert"
ON public.announcements FOR INSERT TO authenticated
WITH CHECK (public.is_teacher());

CREATE POLICY "announcements_teacher_update"
ON public.announcements FOR UPDATE TO authenticated
USING (public.is_teacher())
WITH CHECK (public.is_teacher());

CREATE POLICY "announcements_teacher_delete"
ON public.announcements FOR DELETE TO authenticated
USING (public.is_teacher());
