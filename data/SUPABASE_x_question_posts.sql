-- X（Twitter）スレッド投稿の履歴（重複投稿防止用）
-- Supabase SQL Editor で実行

CREATE TABLE IF NOT EXISTS public.x_question_posts (
  id bigserial PRIMARY KEY,
  question_id text NOT NULL REFERENCES public.questions_core (id) ON DELETE CASCADE,
  tweet1_id text NOT NULL,
  tweet2_id text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS x_question_posts_question_id_uidx
  ON public.x_question_posts (question_id);

CREATE INDEX IF NOT EXISTS x_question_posts_posted_at_idx
  ON public.x_question_posts (posted_at DESC);

ALTER TABLE public.x_question_posts ENABLE ROW LEVEL SECURITY;

-- ブラウザ直アクセスは禁止。挿入は service_role（API）のみ。
DROP POLICY IF EXISTS x_question_posts_deny_all ON public.x_question_posts;
CREATE POLICY x_question_posts_deny_all
  ON public.x_question_posts
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.x_question_posts IS
  '聴覚の鬼: Xスレッド投稿済み question_id（教師APIの service_role が書き込み）';
