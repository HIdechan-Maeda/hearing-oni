# questions_core をシンプルな列に変更する手順

アプリは **10列** のスキーマに対応しました。

---

## Cursor から 1 コマンドで実行する（推奨）

1. Supabase の **Project Settings → Database** で **Connection string** の **URI** をコピーする（`postgresql://` で始まるもの）。**[YOUR-PASSWORD]** を実際の DB パスワードに置き換える。
2. プロジェクトの `.env.local` に次を追加する：
   ```bash
   SUPABASE_DB_URL=postgresql://postgres.[ref]:[YOUR-PASSWORD]@aws-0-xx.pooler.supabase.com:6543/postgres
   ```
   **注意:** ここに入れるのは **PostgreSQL の接続文字列**（`postgresql://` で始まる）だけです。Supabase の「Data URL」やプロジェクト URL（`https://xxxx.supabase.co`）は **入れないでください**。
3. ターミナルで実行：
   ```bash
   npm run db:migrate
   ```
   - テーブルが無い場合は **新規作成**、既存テーブルに古い列がある場合は **ALTER で 10 列に更新** します。
4. 必要なら **Table Editor** で **questions_core** に **data/questions_core_import.csv** をインポートする。

**「Tenant or user not found」が出る場合:**  
プロジェクトごとに**プーラーのホスト名が違います**。必ず次で**表示された URI をそのままコピー**してください。

**Connect の開き方（どれか試してください）**

- **方法A（URL で開く・いちばん確実）**  
  1. 次のリンクを開く（このプロジェクト用）:  
     **https://supabase.com/dashboard/project/yhzesemtfouvvvcgbamh?showConnect=true**  
  2. Connect パネルが開いたら、**Session mode** の **URI** をすべてコピー  
  （別プロジェクトの場合は、URL の `yhzesemtfouvvvcgbamh` を自分のプロジェクト ID に変えて `?showConnect=true` を付ける）  

- **方法B（設定から）**  
  左下の **歯車アイコン（Project Settings）** → 左メニュー **Database** → ページ内の **Connection string** や **Connect** のリンクを探してクリック  

- **方法C（画面上部）**  
  プロジェクトを開いたとき、画面上部や Database ページに **「Connect」** ボタンやリンクがあればクリック  

**コピーしたあと**

1. コピーした URI の **`[YOUR-PASSWORD]`** だけを実際の DB パスワードに置き換える  
2. その 1 行を `.env.local` の `SUPABASE_DB_URL=` の右に貼り付けて保存  

**ホスト名は手で書かず、表示された文字列をそのまま使ってください。**

---

## それでも「Tenant or user not found」が出る場合（SQL Editor で実行）

接続文字列がどうしても使えない場合は、**Supabase の SQL Editor で直接 SQL を実行**してください。接続文字列は不要です。

1. ダッシュボードで **SQL Editor** を開く（左メニュー）。
2. **テーブルがまだ無い場合**は、次の SQL を貼り付けて **Run** で実行：
   ```sql
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
   ```
3. **既に questions_core があり、古い列（explain_core など）がある場合**は、次の SQL を貼り付けて **Run** で実行：
   ```sql
   ALTER TABLE public.questions_core ADD COLUMN IF NOT EXISTS explain text;
   UPDATE public.questions_core SET explain = COALESCE(explain_core, '') || E'\n' || COALESCE(explain_reason, '') WHERE explain IS NULL;
   ALTER TABLE public.questions_core DROP COLUMN IF EXISTS explain_core;
   ALTER TABLE public.questions_core DROP COLUMN IF EXISTS explain_reason;
   ALTER TABLE public.questions_core DROP COLUMN IF EXISTS kc_ids_raw;
   ```
4. 実行後、**Table Editor** で **questions_core** に **data/questions_core_import.csv** をインポート（必要な場合）。

これで `npm run db:migrate` を使わずに同じ状態にできます。

## 新しい列（10個）

| 列名 | 説明 |
|------|------|
| id | 問題ID |
| stem | 問題文 |
| choice_a ～ choice_e | 選択肢A～E |
| answer | 正解（A～E） |
| explain | 解説（1つにまとめた） |
| tags_raw | 領域タグ（例: audiometry） |

**削除した列:** explain_core, explain_reason, kc_ids_raw

---

## Supabase でやること

### 方法A: 既存テーブルを変更する場合

1. **Table Editor** で **questions_core** を開く
2. 既存のデータはバックアップまたは削除
3. **SQL Editor** で次を実行（列の変更）：

```sql
-- explain_core と explain_reason を explain にまとめる（中身をコピーしてから）
ALTER TABLE public.questions_core ADD COLUMN IF NOT EXISTS explain text;
UPDATE public.questions_core SET explain = COALESCE(explain_core, '') || E'\n' || COALESCE(explain_reason, '') WHERE explain IS NULL;
ALTER TABLE public.questions_core DROP COLUMN IF EXISTS explain_core;
ALTER TABLE public.questions_core DROP COLUMN IF EXISTS explain_reason;
ALTER TABLE public.questions_core DROP COLUMN IF EXISTS kc_ids_raw;
```

4. その後、**data/questions_core_import.csv** をインポート（Import data from CSV）

### 方法B: 新規テーブルを作る場合

1. **SQL Editor** で実行：

```sql
CREATE TABLE public.questions_core (
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
```

2. **Table Editor** で **questions_core** に **data/questions_core_import.csv** をインポート

---

logs テーブルに kc_ids_raw がある場合は、そのまま残して問題ありません（アプリからは空文字で保存します）。
