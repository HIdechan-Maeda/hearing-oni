-- questions_core を新規作成（10 列）
CREATE TABLE IF NOT EXISTS public.questions_core (
  id text PRIMARY KEY,
  stem text NOT NULL,
  choice_a text NOT NULL,
  choice_b text NOT NULL,
  choice_c text NOT NULL,
  choice_d text NOT NULL,
  choice_e text NOT NULL,
  answer text NOT NULL,
  explain text,
  tags_raw text
);
