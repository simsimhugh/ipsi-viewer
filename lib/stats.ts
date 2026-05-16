/**
 * 방문자 카운터 — Supabase RPC `record_visit` + `site_stats` 테이블.
 *
 * - 매 페이지 요청마다 layout server side에서 recordVisit(ip) 호출.
 * - IP는 단방향 sha256+salt → unique_visitors PK. 원본 IP는 저장 안 함.
 * - 첫 hash 등장이면 visitors++, 항상 views++. atomic (PL/pgSQL).
 * - Vercel Firewall이 봇 차단 후라 카운트는 비교적 깨끗.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SALT = "ipsi-viewer-v1";

export interface SiteStats { views: number; visitors: number }

function client() {
  return createClient(URL!, ANON!, { auth: { persistSession: false } });
}

export async function recordVisit(ip: string | null): Promise<SiteStats | null> {
  if (!URL || !ANON) return null;
  if (!ip) return getStats();
  const hash = createHash("sha256").update(ip + SALT).digest("hex").slice(0, 32);
  try {
    const { data, error } = await client().rpc("record_visit", { visitor_hash: hash });
    if (error) {
      // schema 미적용 등 — 빈 카운터로 fallback (footer 표시 생략)
      return null;
    }
    const row = (data as Array<{ views: number; visitors: number }> | null)?.[0];
    return row ? { views: Number(row.views), visitors: Number(row.visitors) } : null;
  } catch {
    return null;
  }
}

export async function getStats(): Promise<SiteStats | null> {
  if (!URL || !ANON) return null;
  try {
    const { data, error } = await client()
      .from("site_stats")
      .select("total_views,total_visitors")
      .limit(1)
      .single();
    if (error || !data) return null;
    return { views: Number(data.total_views), visitors: Number(data.total_visitors) };
  } catch {
    return null;
  }
}
