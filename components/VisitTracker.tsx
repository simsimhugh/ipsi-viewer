"use client";

import { useEffect, useRef, useState } from "react";

interface SiteStats { views: number; visitors: number }

/**
 * 방문자 카운터 client component — layout에서 mount 후 한 번 /api/visit POST.
 * StrictMode 더블 mount는 ref guard로 1회만 fire. 첫 렌더는 placeholder 비움.
 */
export default function VisitTracker() {
  const [stats, setStats] = useState<SiteStats | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const ac = new AbortController();
    fetch("/api/visit", { method: "POST", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SiteStats | null) => { if (data) setStats(data); })
      .catch(() => { /* abort or network — 무시 */ });
    return () => ac.abort();
  }, []);

  if (!stats) return null;
  return (
    <div className="text-[11px] text-slate-400 tabular-nums">
      지금까지 <b className="text-slate-600">{stats.visitors.toLocaleString()}명</b>·
      <b className="text-slate-600">{stats.views.toLocaleString()}회</b> 방문
    </div>
  );
}
