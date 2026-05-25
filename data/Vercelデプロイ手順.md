# 聴覚・音響の鬼 — Vercel + GitHub デプロイ手順（学生自習用）

学生に講義外自習用で提供するための、GitHub への push と Vercel での公開手順です。

---

## 前提・セキュリティ

- **秘密情報はリポジトリに含めません。** `.env` / `.env.local` は Git にコミットしない（`.gitignore` 済み）。
- Supabase の **URL と anon key** は Vercel の「環境変数」だけに設定します。
- **Service Role Key は絶対にフロントや環境変数に置かないでください。**

---

## 1. ローカルでやること

### 1.1 秘密がコミットされていないか確認

```bash
# 過去に .env やキーがコミットされていないか確認（任意）
git log -p --all -S "SUPABASE_ANON" -- . 2>/dev/null | head -50
git log -p --all -S "sk-proj-" -- . 2>/dev/null | head -50
```

何か出た場合は、そのキーは **無効化・再発行** してください。

### 1.2 コミットして GitHub に push

```bash
cd /Users/maedahidehiko/hearing-oni

git add .
git status   # .env* が含まれていないことを確認
git commit -m "chore: prepare for Vercel deploy (env in .gitignore)"
```

**GitHub にリポジトリがない場合**

1. https://github.com/new で新しいリポジトリを作成（private 推奨）
2. 表示される「push するコマンド」を実行（例）：

```bash
git remote add origin https://github.com/あなたのユーザー名/hearing-oni.git
git branch -M main
git push -u origin main
```

**既に remote がある場合**

```bash
git push origin main
```

---

## 2. Vercel でデプロイ

### 2.1 プロジェクトをインポート

1. https://vercel.com にログイン（GitHub アカウントで連携可）
2. **Add New…** → **Project**
3. **Import Git Repository** で、`hearing-oni` を選択
4. **Framework Preset**: Next.js のまま
5. **Root Directory**: そのまま（空でOK）
6. **Environment Variables** を次の 2 つ追加してから **Deploy**：

| Name | Value | 備考 |
|------|--------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase ダッシュボード → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbG...` の長い文字列 | 同上 → Project API keys → **anon public** |

- **Service Role Key は入れないでください。**

### 2.2 デプロイ後の確認

- デプロイが終わると `https://xxxx.vercel.app` のような URL が表示されます。
- その URL を開き、ログイン → 基本修行・鬼問題モードが動くか確認してください。

---

## 3. 学生への案内

- **URL**: Vercel の URL（例: `https://hearing-oni.vercel.app`）だけを共有
- **使い方**: 「このURLにアクセス → メール/パスワードでサインアップ or ログイン → 基本修行 or 鬼問題モードで自習」
- アカウントは **サーバー API（`/api/signup`）** 経由で作成されます（学内メール or 許可リスト以外は登録不可）。
- 教師権限は Supabase の **Table Editor** または SQL で `profiles.role = 'teacher'` を手動設定してください（学生が自分で昇格できないよう `data/SUPABASE_profiles_protect_role.sql` を実行）。

### Supabase で実行する SQL（セキュリティ）

| ファイル | 内容 |
|----------|------|
| `data/SUPABASE_RLS_profiles.sql` | profiles の RLS（未実行なら先に） |
| `data/SUPABASE_profiles_protect_role.sql` | `role` の自己昇格防止 |
| `data/SUPABASE_RLS_questions_core.sql` | 問題はログイン必須 |

Vercel に **`SUPABASE_SERVICE_ROLE_KEY`** が無いと新規登録 API が動きません（`.env.example` 参照）。

**推奨（登録迂回の完全防止）:** Supabase Dashboard → **Authentication** → **Sign In / Providers** → Email で、クライアントからの新規登録（Sign ups）を **無効** にする。登録はアプリの `/api/signup`（service_role）のみが行います。

---

## 4. 今後の更新の流れ

- コードを直したら `git add` → `git commit` → `git push`
- Vercel が自動で再デプロイします（GitHub 連携時）。

---

## 5. トラブル時

| 現象 | 確認すること |
|------|----------------|
| ログインできない | Supabase の Authentication で「Email」が有効か。Vercel の環境変数が正しいか。 |
| 問題が0件 | Supabase の `questions_core` にデータがあるか。**ログイン後**に RLS で SELECT が許可されているか（`data/SUPABASE_RLS_questions_core.sql` を実行済みか。未ログイン anon では読めません）。 |
| 教師ダッシュボードが開けない | `profiles.role = 'teacher'` と RLS の「講師は全件読める」ポリシーが正しく設定されているか。 |
| 新規登録できない | Vercel の `SUPABASE_SERVICE_ROLE_KEY`。学内メール or `signup_allowlist` にメールがあるか。 |
| 確認メールが届かない | Supabase Authentication のメール確認設定。ホームの「確認メール再送」を試す。 |

環境変数を変えたあとは、Vercel の **Deployments** から **Redeploy** すると反映されます。
