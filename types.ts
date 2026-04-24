export type QuestionCore = {
  id: string;
  // 難易度（core / oni など）。過去データとの互換性のため null 許可
  difficulty?: string | null;
  /** 問題文の上に表示する図のURL（Supabase Storage や外部URL） */
  image_url?: string | null;
  stem: string;
  choice_a: string;
  choice_b: string;
  choice_c: string;
  choice_d: string;
  choice_e: string;
  /**
   * 正解。単一は `C` や `(C)`、選択肢本文1件など従来どおり。
   * 複数正解は `B,D` や `B、D` のような区切りで A〜E を列挙（順不同）。
   */
  answer: string;
  explain: string | null;
  tags_raw: string | null;
};

export type Confidence = "easy" | "ok" | "hard";
export type Choice = "A" | "B" | "C" | "D" | "E";

/** 1セットの出題数（ホーム選択・URL ?count= と一致） */
export type QuestionSetCount = 5 | 10 | 20 | 30 | 40 | 50;
