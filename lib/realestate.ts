/**
 * 부동산 데이터 로딩 layer.
 *
 * Supabase의 apartment_school_map ⨝ apartments ⨝ transactions(최신) JOIN.
 * 자원 없을 때 (테이블 비어있거나 schema 미적용) graceful empty 반환.
 */
import { createClient } from "@supabase/supabase-js";

// Server Component 전용 — service_role key 사용 (클라이언트에 노출 안 됨).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 서버 전용 env var (NEXT_PUBLIC_ 아님).
// anon key fallback: public read RLS가 있으므로 anon으로도 읽기 가능하지만,
// Vercel 빌드 시 NEXT_PUBLIC_ 인라이닝 문제를 피하기 위해 서버 전용 키 우선.
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  // service_role key 우선 (서버 전용), 없으면 anon key fallback
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface ApartmentSummary {
  id: number;
  name: string;
  households: number | null;
  builtYear: number | null;
  distanceM: number | null;
  inDistrict: boolean;
  /** 최근 1년 실거래가 중위값 (원) — 없으면 null */
  medianPriceWon: number | null;
  /** 최근 거래 일자 — 없으면 null */
  latestContractDate: string | null;
}

interface AsmRow {
  apt_id: number;
  distance_m: number | null;
  in_district: boolean | null;
  apartments: {
    id: number;
    name: string;
    households: number | null;
    built_year: number | null;
  } | null;
}

interface TxRow {
  apt_id: number;
  price_won: number | null;
  contract_date: string | null;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/**
 * 한 학교(SHL)에 매핑된 아파트 + 최신 실거래가 요약.
 * 데이터 없거나 테이블 미존재 시 [] 반환 (graceful).
 */
export async function loadApartmentsForSchool(shlIdfCd: string): Promise<ApartmentSummary[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];

  // 1) 매핑 + 단지 정보
  const { data: asm, error: asmErr } = await sb
    .from("apartment_school_map")
    .select("apt_id, distance_m, in_district, apartments(id, name, households, built_year)")
    .eq("shl_idf_cd", shlIdfCd);

  if (asmErr) {
    // 테이블 미존재 (schema 미적용) 또는 RLS 차단 — graceful.
    console.warn(`[realestate] apartment_school_map ${shlIdfCd}: ${asmErr.message}`);
    return [];
  }
  const rows = (asm ?? []) as unknown as AsmRow[];
  if (rows.length === 0) return [];

  // 2) 해당 apt 들의 최근 1년 실거래가
  const aptIds = rows.map((r) => r.apt_id);
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data: tx, error: txErr } = await sb
    .from("transactions")
    .select("apt_id, price_won, contract_date")
    .in("apt_id", aptIds)
    .gte("contract_date", sinceStr);

  const txRows = (txErr ? [] : (tx ?? [])) as unknown as TxRow[];
  if (txErr) console.warn(`[realestate] transactions: ${txErr.message}`);

  // apt_id → [price, latestDate]
  const priceByApt = new Map<number, number[]>();
  const latestByApt = new Map<number, string>();
  for (const t of txRows) {
    if (t.price_won != null) {
      const arr = priceByApt.get(t.apt_id) ?? [];
      arr.push(t.price_won);
      priceByApt.set(t.apt_id, arr);
    }
    if (t.contract_date) {
      const prev = latestByApt.get(t.apt_id);
      if (!prev || t.contract_date > prev) latestByApt.set(t.apt_id, t.contract_date);
    }
  }

  const out: ApartmentSummary[] = rows
    .filter((r) => r.apartments != null)
    .map((r) => ({
      id: r.apartments!.id,
      name: r.apartments!.name,
      households: r.apartments!.households,
      builtYear: r.apartments!.built_year,
      distanceM: r.distance_m,
      inDistrict: !!r.in_district,
      medianPriceWon: median(priceByApt.get(r.apt_id) ?? []),
      latestContractDate: latestByApt.get(r.apt_id) ?? null,
    }))
    // 정렬: 학구 내 우선, 그다음 거리 ASC
    .sort((a, b) => {
      if (a.inDistrict !== b.inDistrict) return a.inDistrict ? -1 : 1;
      const da = a.distanceM ?? Number.MAX_SAFE_INTEGER;
      const db = b.distanceM ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

  return out;
}
