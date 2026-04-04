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
        marginBottom: 0,
        padding: "10px 12px 10px 14px",
        borderRadius: 12,
        border: "1px solid #c5ddf5",
        background: "linear-gradient(135deg, #fffef8 0%, #f0f7ff 55%, #ffffff 100%)",
        boxShadow: "0 2px 12px rgba(11, 79, 156, 0.08)",
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="お知らせを閉じる"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          border: "none",
          background: "rgba(255,255,255,0.85)",
          borderRadius: 8,
          width: 30,
          height: 30,
          cursor: "pointer",
          fontSize: 17,
          lineHeight: 1,
          color: "#243a52",
          zIndex: 1,
        }}
      >
        ×
      </button>
      <div style={{ paddingRight: 34 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#0b4f9c",
            letterSpacing: "0.06em",
            marginBottom: 4,
          }}
        >
          お知らせ
        </div>
        <div className="home-announcement__scroll">
          {title ? (
            <h2 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "#0b315b", lineHeight: 1.35 }}>
              {title}
            </h2>
          ) : null}
          {body ? (
            <p style={{ margin: 0, fontSize: 13, color: "#1a2030", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{body}</p>
          ) : null}
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 10, color: "#6b7a8c", lineHeight: 1.4 }}>
          ×で閉じると再表示しません（新しいお知らせで再表示）。
        </p>
      </div>
    </div>
  );
}
