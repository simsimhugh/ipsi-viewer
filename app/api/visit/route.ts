/**
 * 방문자 카운터 API — layout SSR 시점이 아닌 client에서 호출 (force-dynamic 회피용).
 *
 * POST  /api/visit  — IP hash로 visitors/views 증가, 결과 stats 반환
 * GET   /api/visit  — 증가 없이 현재 stats만 조회 (디버그용)
 */
import { NextResponse } from "next/server";
import { recordVisit, getStats } from "@/lib/stats";

// 항상 server에서 평가 (캐시 안 함 — 매 호출이 카운터 증가 이벤트).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const stats = await recordVisit(ip);
  return NextResponse.json(stats);
}

export async function GET() {
  const stats = await getStats();
  return NextResponse.json(stats);
}
