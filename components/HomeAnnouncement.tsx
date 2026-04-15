"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchLatestAnnouncements, type AnnouncementPublic } from "../lib/announcements";

/** 複数件対応: 閉じた id の配列 */
const STORAGE_IDS_KEY = "hearing_oni_announcement_dismissed_ids";
/** 旧版（1件のみ）からの移行用 */
const STORAGE_LEGACY_ID_KEY = "hearing_oni_announcement_dismissed_id";

function readDismissedIds(): Set<string> {
  const out = new Set<string>();
  try {
    const raw = window.localStorage.getItem(STORAGE_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const x of parsed) {
          if (typeof x === "string" && x) out.add(x);
        }
      }
    }
    const legacy = window.localStorage.getItem(STORAGE_LEGACY_ID_KEY);
    if (legacy) out.add(legacy);
  } catch {
    /* ignore */
  }
  return out;
}

function writeDismissedIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/**
 * ホーム最上部: Supabase announcements の最新最大2件（公開中・日時到達済み）
 */
export function HomeAnnouncement() {
  const [rows, setRows] = useState<AnnouncementPublic[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await fetchLatestAnnouncements(supabase);
      if (cancelled) return;
      setLoading(false);
      if (error) {
        setRows([]);
        return;
      }
      setRows(data);
      try {
        setDismissedIds(readDismissedIds());
      } catch {
        setDismissedIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (dismissedIds.has(r.id)) return false;
      const title = (r.title ?? "").trim();
      const body = (r.body ?? "").trim();
      return Boolean(title || body);
    });
  }, [rows, dismissedIds]);

  const dismissOne = (id: string) => {
    const next = new Set(dismissedIds);
    next.add(id);
    writeDismissedIds(next);
    setDismissedIds(next);
  };

  if (loading || visibleRows.length === 0) return null;

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
      <div style={{ paddingRight: 4 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#0b4f9c",
            letterSpacing: "0.06em",
            marginBottom: 6,
          }}
        >
          お知らせ
        </div>
        <div className="home-announcement__scroll">
          {visibleRows.map((row, i) => {
            const title = (row.title ?? "").trim();
            const body = (row.body ?? "").trim();
            return (
              <div
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 8,
                  alignItems: "start",
                  marginTop: i > 0 ? 10 : 0,
                  paddingTop: i > 0 ? 12 : 0,
                  borderTop: i > 0 ? "1px solid rgba(11, 79, 156, 0.12)" : undefined,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  {title ? (
                    <h2
                      style={{
                        margin: "0 0 6px",
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#0b315b",
                        lineHeight: 1.35,
                      }}
                    >
                      {title}
                    </h2>
                  ) : null}
                  {body ? (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: "#1a2030",
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {body}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismissOne(row.id)}
                  aria-label="このお知らせを閉じる"
                  style={{
                    position: "sticky",
                    top: 0,
                    border: "none",
                    background: "rgba(255,255,255,0.92)",
                    borderRadius: 8,
                    width: 30,
                    height: 30,
                    cursor: "pointer",
                    fontSize: 17,
                    lineHeight: 1,
                    color: "#243a52",
                    zIndex: 2,
                    boxShadow: "0 0 0 1px rgba(11, 79, 156, 0.08)",
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 10, color: "#6b7a8c", lineHeight: 1.4 }}>
          ×で閉じるとそのお知らせは再表示しません（新しいお知らせで再表示）。
        </p>
      </div>
    </div>
  );
}
