"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchLatestAnnouncement, type AnnouncementPublic } from "../lib/announcements";

const STORAGE_KEY = "hearing_oni_announcement_dismissed_id";

/**
 * ホーム最上部: Supabase announcements の最新1件（公開中・日時到達済み）
 */
export function HomeAnnouncement() {
  const [row, setRow] = useState<AnnouncementPublic | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await fetchLatestAnnouncement(supabase);
      if (cancelled) return;
      setLoading(false);
      if (error || !data) {
        setRow(null);
        return;
      }
      try {
        const dismissed = window.localStorage.getItem(STORAGE_KEY);
        if (dismissed === data.id) {
          setHidden(true);
        }
      } catch {
        /* ignore */
      }
      setRow(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    if (!row) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, row.id);
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  if (loading || !row || hidden) return null;

  const title = (row.title ?? "").trim();
  const body = (row.body ?? "").trim();
  if (!title && !body) return null;

  return (
    <div
      className="home-announcement"
      role="region"
      aria-label="お知らせ"
      style={{
        marginBottom: 16,
        padding: "14px 16px 14px 18px",
        borderRadius: 14,
        border: "1px solid #c5ddf5",
        background: "linear-gradient(135deg, #fffef8 0%, #f0f7ff 55%, #ffffff 100%)",
        boxShadow: "0 4px 18px rgba(11, 79, 156, 0.1)",
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="お知らせを閉じる"
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          border: "none",
          background: "rgba(255,255,255,0.7)",
          borderRadius: 8,
          width: 32,
          height: 32,
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          color: "#243a52",
        }}
      >
        ×
      </button>
      <div style={{ paddingRight: 36 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#0b4f9c", letterSpacing: "0.06em", marginBottom: 6 }}>
          お知らせ
        </div>
        {title ? (
          <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "#0b315b" }}>{title}</h2>
        ) : null}
        {body ? (
          <p style={{ margin: 0, fontSize: 14, color: "#1a2030", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{body}</p>
        ) : null}
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "#6b7a8c" }}>
          閉じるとこのお知らせは再表示されません（新しいお知らせが出たときは再び表示されます）。
        </p>
      </div>
    </div>
  );
}
