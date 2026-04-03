import type { SupabaseClient } from "@supabase/supabase-js";

/** 教師一覧・DB 行 */
export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  is_active: boolean;
  created_at?: string;
};

/** ホーム表示用 */
export type AnnouncementPublic = {
  id: string;
  title: string;
  body: string;
  published_at: string;
};

/** ホーム表示用: 公開中かつ日時が来ているうち、published_at が最新の1件 */
export async function fetchLatestAnnouncement(supabase: SupabaseClient): Promise<{
  data: AnnouncementPublic | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from("announcements")
    .select("id,title,body,published_at")
    .eq("is_active", true)
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }
  if (!data) {
    return { data: null, error: null };
  }
  return {
    data: data as AnnouncementPublic,
    error: null,
  };
}
