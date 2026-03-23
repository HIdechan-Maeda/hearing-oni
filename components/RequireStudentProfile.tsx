"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { fetchProfileRow } from "../lib/fetchProfileRow";
import { isStudentProfileComplete } from "../lib/profileComplete";

/**
 * 学生は profiles（ニックネーム・所属・学年）が揃うまで子ページを表示しない。
 * 教師はそのまま通す。
 */
export function RequireStudentProfile({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData, error: uerr } = await supabase.auth.getUser();
      if (uerr || !userData.user) {
        if (!cancelled) router.replace("/");
        return;
      }
      const { data: p, error: perr } = await fetchProfileRow(userData.user.id);

      if (perr) {
        console.error(perr);
        if (!cancelled) router.replace("/?profileError=1");
        return;
      }

      if (!p) {
        if (!cancelled) router.replace("/?needsProfile=1");
        return;
      }

      if (
        isStudentProfileComplete(p.role, p.name, p.affiliation, p.grade)
      ) {
        if (!cancelled) setReady(true);
      } else {
        if (!cancelled) router.replace("/?needsProfile=1");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
        <p>読み込み中...</p>
      </main>
    );
  }

  return <>{children}</>;
}
