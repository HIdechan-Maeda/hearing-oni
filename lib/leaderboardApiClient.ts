import type { SupabaseClient } from "@supabase/supabase-js";

export async function getLeaderboardAccessToken(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function leaderboardApiFetch(
  supabase: SupabaseClient,
  path: string
): Promise<{ ok: boolean; status: number; json: unknown; error: Error | null }> {
  const token = await getLeaderboardAccessToken(supabase);
  if (!token) {
    return { ok: false, status: 401, json: null, error: new Error("ログインしてください。") };
  }

  try {
    const res = await fetch(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const msg =
        typeof json === "object" &&
        json !== null &&
        "message" in json &&
        typeof (json as { message: unknown }).message === "string"
          ? (json as { message: string }).message
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, json, error: new Error(msg) };
    }
    return { ok: true, status: res.status, json, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, json: null, error: new Error(msg) };
  }
}
