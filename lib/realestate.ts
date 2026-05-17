/**
 * 부동산 데이터 로딩 layer.
 *
 * Supabase의 apartment_school_map ⨝ apartments ⨝ transactions JOIN.
 * 자원 없을 때 (테이블 비어있거나 schema 미적용) graceful empty 반환.
 *
 * 실거래가 산정 방식: 단지 내 거래를 area_m2 (반올림한 정수 m²) 별로 그룹화하여
 * 빈도(거래 건수) 가장 많은 평수 = "대표 평수". 그 그룹의 price_won 중위값이 표시값.
 * 단지 내 다양한 평수 혼재 시 단순 중위값이 왜곡되는 문제 회피.
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
  sigungu: string | null;
  households: number | null;
  builtYear: number | null;
  distanceM: number | null;
  inDistrict: boolean;
  /** 대표 평수 그룹의 실거래가 중위값 (원) — 없으면 null */
  medianPriceWon: number | null;
  /** 대표 평수 (m², 반올림 정수) — 없으면 null */
  representativeAreaM2: number | null;
  /** 대표 평수 그룹 거래 건수 */
  representativeAreaCount: number;
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
    sigungu: string | null;
    households: number | null;
    built_year: number | null;
  } | null;
}

interface TxRow {
  apt_id: number;
  area_m2: number | null;
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
 * 단지의 거래 목록에서 대표 평수(빈도 최대 area_m2)와 그 그룹 중위값을 계산.
 * 빈도 동률 시: area_m2 큰 쪽 우선 (큰 평수가 가격 신호 더 명확).
 */
function representativePrice(
  txs: { area_m2: number | null; price_won: number | null }[],
): { areaM2: number | null; medianWon: number | null; count: number } {
  // area_m2 정수 반올림 그룹화
  const byArea = new Map<number, number[]>();
  for (const t of txs) {
    if (t.area_m2 == null || t.price_won == null) continue;
    const key = Math.round(t.area_m2);
    const arr = byArea.get(key) ?? [];
    arr.push(t.price_won);
    byArea.set(key, arr);
  }
  if (byArea.size === 0) return { areaM2: null, medianWon: null, count: 0 };

  // 빈도 최대 (동률 시 area 큰 쪽)
  let bestArea: number | null = null;
  let bestCount = -1;
  for (const [area, prices] of byArea) {
    if (prices.length > bestCount || (prices.length === bestCount && area > (bestArea ?? -Infinity))) {
      bestCount = prices.length;
      bestArea = area;
    }
  }
  if (bestArea == null) return { areaM2: null, medianWon: null, count: 0 };
  return {
    areaM2: bestArea,
    medianWon: median(byArea.get(bestArea) ?? []),
    count: bestCount,
  };
}

/**
 * 한 학교(SHL)에 매핑된 아파트 + 대표 평수 기준 실거래가 요약.
 * 데이터 없거나 테이블 미존재 시 [] 반환 (graceful).
 */
export async function loadApartmentsForSchool(shlIdfCd: string): Promise<ApartmentSummary[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];

  // 1) 매핑 + 단지 정보
  const { data: asm, error: asmErr } = await sb
    .from("apartment_school_map")
    .select("apt_id, distance_m, in_district, apartments(id, name, sigungu, households, built_year)")
    .eq("shl_idf_cd", shlIdfCd);

  if (asmErr) {
    // 테이블 미존재 (schema 미적용) 또는 RLS 차단 — graceful.
    console.warn(`[realestate] apartment_school_map ${shlIdfCd}: ${asmErr.message}`);
    return [];
  }
  const rows = (asm ?? []) as unknown as AsmRow[];
  if (rows.length === 0) return [];

  // 2) 해당 apt 들의 실거래가 (전체 — 최근 1년 한정 시 데이터 부족 단지 다수 발생)
  const aptIds = rows.map((r) => r.apt_id);

  const { data: tx, error: txErr } = await sb
    .from("transactions")
    .select("apt_id, area_m2, price_won, contract_date")
    .in("apt_id", aptIds);

  const txRows = (txErr ? [] : (tx ?? [])) as unknown as TxRow[];
  if (txErr) console.warn(`[realestate] transactions: ${txErr.message}`);

  // apt_id → 거래 목록 + 최신 거래일
  const txByApt = new Map<number, TxRow[]>();
  const latestByApt = new Map<number, string>();
  for (const t of txRows) {
    const arr = txByApt.get(t.apt_id) ?? [];
    arr.push(t);
    txByApt.set(t.apt_id, arr);
    if (t.contract_date) {
      const prev = latestByApt.get(t.apt_id);
      if (!prev || t.contract_date > prev) latestByApt.set(t.apt_id, t.contract_date);
    }
  }

  const out: ApartmentSummary[] = rows
    .filter((r) => r.apartments != null)
    .map((r) => {
      const rep = representativePrice(txByApt.get(r.apt_id) ?? []);
      return {
        id: r.apartments!.id,
        name: r.apartments!.name,
        sigungu: r.apartments!.sigungu,
        households: r.apartments!.households,
        builtYear: r.apartments!.built_year,
        distanceM: r.distance_m,
        inDistrict: !!r.in_district,
        medianPriceWon: rep.medianWon,
        representativeAreaM2: rep.areaM2,
        representativeAreaCount: rep.count,
        latestContractDate: latestByApt.get(r.apt_id) ?? null,
      };
    })
    // 기본 정렬: 거리 ASC (학구 in/out 구분 표시 컬럼은 제거됐지만 데이터는 유지)
    .sort((a, b) => {
      const da = a.distanceM ?? Number.MAX_SAFE_INTEGER;
      const db = b.distanceM ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

  return out;
}
