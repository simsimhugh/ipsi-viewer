/**
 * 데이터 로딩 layer.
 *
 * 두 가지 mode (env에 따라 자동 선택):
 *   1) Supabase  — NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY 있을 때
 *      production (Vercel) 기본. 5분 in-memory cache.
 *   2) JSONL     — env 없을 때. ~/hakgun-data/schools-with-career.jsonl 직접 read.
 *      로컬 dev fallback.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { School, CareerData, CareerRow } from "./types";

// ─── mode 1: Supabase ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_ANON);

let _supabaseCache: { ts: number; list: School[] } | null = null;
let _supabaseMainCache: { ts: number; list: School[] } | null = null;
const SUPABASE_TTL = 5 * 60 * 1000; // 5분

// 메인 페이지 전용 careers 컬럼 — male/female/rate_pct (JSONB) 제외하여 응답 size 대폭 축소.
const CAREERS_MAIN_COLUMNS = [
  "shl_idf_cd", "year",
  "graduates", "general_high", "vocational_high",
  "science_high", "foreign_intl_high", "arts_sports_high", "meister_high",
  "special_purpose_subtotal", "private_autonomous", "public_autonomous",
  "autonomous_subtotal", "other", "advanced_total",
  "employed", "alt_education", "unemployed",
].join(",");

// 메인 페이지 전용 schools 컬럼 — SchoolTable이 실제 사용하는 필드만.
// address/lat/lng/sd_schul_code 제외 (메인 테이블에 미노출, 상세 페이지만 사용).
const SCHOOLS_MAIN_COLUMNS = [
  "shl_idf_cd", "school_name",
  "sido_code", "sido_name",
  "kind", "sigungu",
].join(",");

// PostgREST는 max-rows 1000 (Supabase 기본). 페이지네이션으로 전량 fetch.
// applyFilters: builder에 추가 filter (eq/in 등) 체이닝 hook — 선택.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows<T>(
  sb: any, table: string, columns: string = "*",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyFilters?: (q: any) => any,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (applyFilters) q = applyFilters(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} fetch (range ${from}~${from + PAGE - 1}): ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return all;
}

// 일부 컬럼은 메인 페이지 projection 으로 제외될 수 있어 옵셔널.
// schoolsFromSB에서 모두 null-safe 처리됨.
type SchoolRowSB = {
  shl_idf_cd: string; school_name: string; sido_code: string; sido_name: string;
  kind: School["kind"];
  sd_schul_code?: string | null;
  address?: string | null; sigungu?: string | null;
  si?: string | null; gu?: string | null;
  lat?: number | null; lng?: number | null;
};

type CareerRowMainSB = {
  shl_idf_cd: string; year: number;
  graduates: number; general_high: number; vocational_high: number;
  science_high: number; foreign_intl_high: number; arts_sports_high: number; meister_high: number;
  special_purpose_subtotal: number; private_autonomous: number; public_autonomous: number;
  autonomous_subtotal: number; other: number; advanced_total: number;
  employed: number; alt_education: number; unemployed: number;
};

type CareerRowFullSB = CareerRowMainSB & {
  male: CareerRow | null; female: CareerRow | null; rate_pct: CareerRow | null;
};

function totalFromSB(c: CareerRowMainSB): CareerRow {
  return {
    graduates: c.graduates, generalHigh: c.general_high, vocationalHigh: c.vocational_high,
    scienceHigh: c.science_high, foreignIntlHigh: c.foreign_intl_high,
    artsSportsHigh: c.arts_sports_high, meisterHigh: c.meister_high,
    specialPurposeSubtotal: c.special_purpose_subtotal,
    privateAutonomous: c.private_autonomous, publicAutonomous: c.public_autonomous,
    autonomousSubtotal: c.autonomous_subtotal,
    other: c.other, advancedTotal: c.advanced_total,
    employed: c.employed, altEducation: c.alt_education, unemployed: c.unemployed,
  };
}

function schoolsFromSB(
  schools: SchoolRowSB[],
  cb: Record<string, Record<string, CareerData>>,
): School[] {
  return schools.map((s) => {
    const byYear = cb[s.shl_idf_cd];
    const yearsDesc = byYear ? Object.keys(byYear).map(Number).sort((a, b) => b - a) : [];
    const newest = yearsDesc[0];
    return {
      SHL_IDF_CD: s.shl_idf_cd,
      schoolName: s.school_name,
      sidoCode: s.sido_code,
      sidoName: s.sido_name,
      sdSchulCode: s.sd_schul_code ?? "",
      kind: s.kind,
      address: s.address ?? undefined,
      sigungu: s.sigungu ?? undefined,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      careersByYear: byYear,
      career: newest && byYear ? byYear[String(newest)] : null,
    };
  });
}

/**
 * 풀 데이터 로드 — careers 모든 컬럼 (male/female/rate_pct JSONB 포함).
 * 상세 페이지에서 사용. 응답 size 크지만 male/female/ratePct 표시에 필요.
 */
async function loadFromSupabase(): Promise<School[]> {
  if (_supabaseCache && Date.now() - _supabaseCache.ts < SUPABASE_TTL) {
    return _supabaseCache.list;
  }
  const sb = createClient(SUPABASE_URL!, SUPABASE_ANON!, { auth: { persistSession: false } });
  const [schools, careers] = await Promise.all([
    fetchAllRows<SchoolRowSB>(sb, "schools"),
    fetchAllRows<CareerRowFullSB>(sb, "careers"),
  ]);

  const cb: Record<string, Record<string, CareerData>> = {};
  for (const c of careers ?? []) {
    if (!cb[c.shl_idf_cd]) cb[c.shl_idf_cd] = {};
    const total = totalFromSB(c);
    cb[c.shl_idf_cd][String(c.year)] = {
      year: c.year,
      male: (c.male ?? total) as CareerRow,
      female: (c.female ?? total) as CareerRow,
      total,
      ratePct: (c.rate_pct ?? total) as CareerRow,
      totalGraduatesFromTable: c.graduates,
    };
  }

  const list = schoolsFromSB(schools ?? [], cb);
  _supabaseCache = { ts: Date.now(), list };
  return list;
}

/**
 * 메인 페이지 전용 light 로드 — careers에서 male/female/rate_pct JSONB 제외.
 * male/female/ratePct는 total로 fallback (메인 테이블은 total만 사용).
 */
async function loadFromSupabaseMain(): Promise<School[]> {
  if (_supabaseMainCache && Date.now() - _supabaseMainCache.ts < SUPABASE_TTL) {
    return _supabaseMainCache.list;
  }
  const sb = createClient(SUPABASE_URL!, SUPABASE_ANON!, { auth: { persistSession: false } });
  // 메인 페이지는 중학교만 표시 → DB-side filter 로 fetch size ~73% 절감 (13k → ~3.3k).
  // schools 컬럼도 SchoolTable 사용 필드만 (address/lat/lng/sd_schul_code 제외).
  const [schools, careers] = await Promise.all([
    fetchAllRows<SchoolRowSB>(sb, "schools", SCHOOLS_MAIN_COLUMNS,
      (q) => q.eq("kind", "중학교")),
    fetchAllRows<CareerRowMainSB>(sb, "careers", CAREERS_MAIN_COLUMNS),
  ]);

  const cb: Record<string, Record<string, CareerData>> = {};
  for (const c of careers ?? []) {
    if (!cb[c.shl_idf_cd]) cb[c.shl_idf_cd] = {};
    const total = totalFromSB(c);
    cb[c.shl_idf_cd][String(c.year)] = {
      year: c.year,
      male: total,
      female: total,
      total,
      ratePct: total,
      totalGraduatesFromTable: c.graduates,
    };
  }

  const list = schoolsFromSB(schools ?? [], cb);
  _supabaseMainCache = { ts: Date.now(), list };
  return list;
}

// ─── mode 2: JSONL fallback ───────────────────────────────────────────────
const DATA_DIR = process.env.HAKGUN_DATA_DIR
  ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");
const JSONL_PATH = path.join(DATA_DIR, "schools-with-career.jsonl");

let _jsonlCache: { mtimeMs: number; list: School[] } | null = null;

async function loadFromJsonl(): Promise<School[]> {
  let st;
  try {
    st = await stat(JSONL_PATH);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`[lib/data] ${JSONL_PATH} 없음 — 빈 배열 반환`);
      return [];
    }
    throw e;
  }
  if (_jsonlCache && _jsonlCache.mtimeMs === st.mtimeMs) return _jsonlCache.list;
  const raw = await readFile(JSONL_PATH, "utf-8");
  const list: School[] = raw
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .map((l) => JSON.parse(l) as School);
  _jsonlCache = { mtimeMs: st.mtimeMs, list };
  return list;
}

// ─── 공용 API ─────────────────────────────────────────────────────────────
export async function loadAllSchools(): Promise<School[]> {
  return USE_SUPABASE ? loadFromSupabase() : loadFromJsonl();
}

export async function loadSchoolsWithCareer(): Promise<School[]> {
  const all = await loadAllSchools();
  return all.filter((s) => s.career != null || (s.careersByYear && Object.keys(s.careersByYear).length > 0));
}

/**
 * 메인 페이지 전용 — careers JSONB(male/female/rate_pct) 제외한 light 로드.
 * Supabase 응답 size를 대폭 축소 (메인 테이블은 total만 사용).
 * JSONL fallback 시에는 풀 데이터와 동일.
 */
export async function loadSchoolsForMain(): Promise<School[]> {
  const all = USE_SUPABASE ? await loadFromSupabaseMain() : await loadFromJsonl();
  return all.filter((s) => s.career != null || (s.careersByYear && Object.keys(s.careersByYear).length > 0));
}

export async function loadSchool(SHL_IDF_CD: string): Promise<School | null> {
  const all = await loadAllSchools();
  return all.find((s) => s.SHL_IDF_CD === SHL_IDF_CD) ?? null;
}

/**
 * 학교 상세 페이지 전용 — 학교 1건 + 해당 학교 careers 1건만 fetch.
 * 13k schools / 수만 careers 전량 page-fetch 회피 → cold TTFB 대폭 축소.
 * Supabase 모드 전용 — JSONL fallback은 기존 loadSchool 유지.
 */
export async function loadSchoolById(SHL_IDF_CD: string): Promise<School | null> {
  if (!USE_SUPABASE) return loadSchool(SHL_IDF_CD);

  const sb = createClient(SUPABASE_URL!, SUPABASE_ANON!, { auth: { persistSession: false } });
  // schools: 상세 페이지 사용 컬럼만 (lat/lng/sidoCode/si/gu 제외).
  // careers: male/female/rate_pct JSONB 미사용 → CAREERS_MAIN_COLUMNS 동일 projection.
  const SCHOOLS_DETAIL_COLUMNS = "shl_idf_cd, school_name, sido_code, sido_name, sd_schul_code, kind, address, sigungu";
  const [schoolRes, careersRes] = await Promise.all([
    sb.from("schools").select(SCHOOLS_DETAIL_COLUMNS).eq("shl_idf_cd", SHL_IDF_CD).maybeSingle(),
    sb.from("careers").select(CAREERS_MAIN_COLUMNS).eq("shl_idf_cd", SHL_IDF_CD),
  ]);

  if (schoolRes.error) throw new Error(`schools(${SHL_IDF_CD}): ${schoolRes.error.message}`);
  const s = schoolRes.data as SchoolRowSB | null;
  if (!s) return null;

  const careers = (careersRes.error ? [] : (careersRes.data ?? [])) as unknown as CareerRowMainSB[];
  if (careersRes.error) console.warn(`[lib/data] careers(${SHL_IDF_CD}): ${careersRes.error.message}`);

  const byYear: Record<string, CareerData> = {};
  for (const c of careers) {
    const total = totalFromSB(c);
    byYear[String(c.year)] = {
      year: c.year,
      // male/female/rate_pct 미사용 — total 로 fallback (UI 표시 안 함).
      male: total,
      female: total,
      total,
      ratePct: total,
      totalGraduatesFromTable: c.graduates,
    };
  }

  const [out] = schoolsFromSB([s], { [s.shl_idf_cd]: byYear });
  return out ?? null;
}
