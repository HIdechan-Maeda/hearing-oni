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

const HOME_ANNOUNCEMENT_LIMIT = 2;

/** ホーム表示用: 公開中かつ日時が来ているうち、published_at が新しい順に最大2件 */
export async function fetchLatestAnnouncements(supabase: SupabaseClient): Promise<{
  data: AnnouncementPublic[];
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from("announcements")
    .select("id,title,body,published_at")
    .eq("is_active", true)
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(HOME_ANNOUNCEMENT_LIMIT);

  if (error) {
    return { data: [], error };
  }
  return {
    data: ((data ?? []) as AnnouncementPublic[]).filter(Boolean),
    error: null,
  };
}
