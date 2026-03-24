import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  const msg =
    "[hearing-oni] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。" +
    " ローカルは .env.local、本番は Vercel の Environment Variables を確認し、設定後に再ビルド・再デプロイしてください。";
  if (typeof window === "undefined") {
    console.warn(msg);
  } else {
    console.error(msg);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
