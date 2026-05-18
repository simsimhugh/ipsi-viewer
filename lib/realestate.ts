/**
 * 부동산 데이터 로딩 layer.
 *
 * Supabase apartment_school_map ⨝ apartments + 각 단지의
 *   - 최근 매매 1건 (transactions)
 *   - 최근 전세 1건 (rentals where monthly_rent_man_won = 0)
 *   - 최근 월세 1건 (rentals where monthly_rent_man_won > 0)
 *
 * 표시 방식: 단지마다 **주력 평수(대표 면적)** 의 dealType별 가장 최근 1건.
 *   주력 평수 = transactions + rentals 통합 round(area_m2) group by count desc.
 *   동률 시 면적 큰 쪽 우선 (count desc, area desc).
 *   여러 평수가 섞인 단지(예: 반포자이 60·85·132·165·195·216·245㎡)에서
 *   가장 거래 빈도 높은 평수의 시세만 노출 → 시세 인식 왜곡 방지.
 * 데이터 없는 단지/거래유형은 null 반환 → UI에서 "-" 표시.
 */
import { createClient } from "@supabase/supabase-js";

/**
 * 부동산 sync 기준 기간 (개월).
 * scripts/run-realestate-fullcountry.ts 의 --recent default 와 동일.
 * 변경 시 양쪽 동기화 필요.
 */
export const SYNC_RECENT_MONTHS = 12;

// Server Component 전용 — service_role key 우선, anon fallback.
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 단지의 최근 매매 1건. */
export interface SaleLatest {
  priceWon: number;
  areaM2: number | null;
  contractDate: string; // YYYY-MM-DD
}

/** 단지의 최근 전세 1건. */
export interface JeonseLatest {
  depositManWon: number;
  areaM2: number | null;
  contractDate: string;
}

/** 단지의 최근 월세 1건. */
export interface WolseLatest {
  depositManWon: number;
  monthlyRentManWon: number;
  areaM2: number | null;
  contractDate: string;
}

export interface ApartmentSummary {
  id: number;
  name: string;
  sigungu: string | null;
  households: number | null;
  builtYear: number | null;
  distanceM: number | null;
  inDistrict: boolean;
  /** 최근 매매 1건 — 없으면 null */
  latestSale: SaleLatest | null;
  /** 최근 전세 1건 — 없으면 null */
  latestJeonse: JeonseLatest | null;
  /** 최근 월세 1건 — 없으면 null */
  latestWolse: WolseLatest | null;
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

interface RentRow {
  apt_id: number;
  area_m2: number | null;
  deposit_man_won: number | null;
  monthly_rent_man_won: number | null;
  contract_date: string | null;
}

/**
 * 한 학교(SHL)에 매핑된 아파트 + 매매·전세·월세 최근 1건 요약.
 * 데이터 없거나 테이블 미존재 시 [] / null 필드 반환 (graceful).
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
    console.warn(`[realestate] apartment_school_map ${shlIdfCd}: ${asmErr.message}`);
    return [];
  }
  const rows = (asm ?? []) as unknown as AsmRow[];
  if (rows.length === 0) return [];

  const aptIds = rows.map((r) => r.apt_id);

  // 2) 매매 거래 전체 (각 apt 최근 1건 선택은 JS에서)
  // PostgREST default page limit 1000 — 충분 (학교당 단지 수십 × 거래 평균 < 1000).
  // .order desc + 첫 hit 사용이라 누락 위험 낮음. limit을 5000으로 명시해 안전성 확보.
  const { data: tx, error: txErr } = await sb
    .from("transactions")
    .select("apt_id, area_m2, price_won, contract_date")
    .in("apt_id", aptIds)
    .order("contract_date", { ascending: false })
    .limit(5000);
  const txRows = (txErr ? [] : (tx ?? [])) as unknown as TxRow[];
  if (txErr) console.warn(`[realestate] transactions: ${txErr.message}`);

  // 3) 전월세 거래 전체
  const { data: rent, error: rentErr } = await sb
    .from("rentals")
    .select("apt_id, area_m2, deposit_man_won, monthly_rent_man_won, contract_date")
    .in("apt_id", aptIds)
    .order("contract_date", { ascending: false })
    .limit(5000);
  const rentRows = (rentErr ? [] : (rent ?? [])) as unknown as RentRow[];
  if (rentErr) console.warn(`[realestate] rentals: ${rentErr.message}`);

  // 4) 단지별 대표 평수 = round(area_m2) group by count desc, area desc
  //    transactions + rentals 통합 집계. 동률 시 면적 큰 쪽 우선.
  const areaCountByApt = new Map<number, Map<number, number>>();
  function bumpArea(aptId: number, areaM2: number | null) {
    if (areaM2 == null) return;
    const k = Math.round(areaM2);
    let inner = areaCountByApt.get(aptId);
    if (!inner) {
      inner = new Map<number, number>();
      areaCountByApt.set(aptId, inner);
    }
    inner.set(k, (inner.get(k) ?? 0) + 1);
  }
  for (const t of txRows) bumpArea(t.apt_id, t.area_m2);
  for (const r of rentRows) bumpArea(r.apt_id, r.area_m2);

  const repAreaByApt = new Map<number, number>();
  for (const [aptId, counts] of areaCountByApt) {
    let bestArea = -Infinity;
    let bestCount = -1;
    for (const [area, count] of counts) {
      if (count > bestCount || (count === bestCount && area > bestArea)) {
        bestArea = area;
        bestCount = count;
      }
    }
    if (Number.isFinite(bestArea)) repAreaByApt.set(aptId, bestArea);
  }

  function matchesRep(aptId: number, areaM2: number | null): boolean {
    const rep = repAreaByApt.get(aptId);
    if (rep == null) return false;
    if (areaM2 == null) return false;
    return Math.round(areaM2) === rep;
  }

  // apt_id → 최근 매매 (이미 desc 정렬 — 대표 평수 첫 hit 사용)
  const saleByApt = new Map<number, SaleLatest>();
  for (const t of txRows) {
    if (saleByApt.has(t.apt_id)) continue;
    if (t.price_won == null || !t.contract_date) continue;
    if (!matchesRep(t.apt_id, t.area_m2)) continue;
    saleByApt.set(t.apt_id, {
      priceWon: t.price_won,
      areaM2: t.area_m2,
      contractDate: t.contract_date,
    });
  }

  // apt_id → 최근 전세 / 최근 월세 (대표 평수 안에서)
  const jeonseByApt = new Map<number, JeonseLatest>();
  const wolseByApt = new Map<number, WolseLatest>();
  for (const r of rentRows) {
    if (!r.contract_date || r.deposit_man_won == null) continue;
    if (!matchesRep(r.apt_id, r.area_m2)) continue;
    const isWolse = (r.monthly_rent_man_won ?? 0) > 0;
    if (isWolse) {
      if (wolseByApt.has(r.apt_id)) continue;
      wolseByApt.set(r.apt_id, {
        depositManWon: r.deposit_man_won,
        monthlyRentManWon: r.monthly_rent_man_won ?? 0,
        areaM2: r.area_m2,
        contractDate: r.contract_date,
      });
    } else {
      if (jeonseByApt.has(r.apt_id)) continue;
      jeonseByApt.set(r.apt_id, {
        depositManWon: r.deposit_man_won,
        areaM2: r.area_m2,
        contractDate: r.contract_date,
      });
    }
  }

  const out: ApartmentSummary[] = rows
    .filter((r) => r.apartments != null)
    .map((r) => ({
      id: r.apartments!.id,
      name: r.apartments!.name,
      sigungu: r.apartments!.sigungu,
      households: r.apartments!.households,
      builtYear: r.apartments!.built_year,
      distanceM: r.distance_m,
      inDistrict: !!r.in_district,
      latestSale: saleByApt.get(r.apt_id) ?? null,
      latestJeonse: jeonseByApt.get(r.apt_id) ?? null,
      latestWolse: wolseByApt.get(r.apt_id) ?? null,
    }))
    .sort((a, b) => {
      const da = a.distanceM ?? Number.MAX_SAFE_INTEGER;
      const db = b.distanceM ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

  return out;
}
