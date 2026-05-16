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
const SUPABASE_TTL = 5 * 60 * 1000; // 5분

async function loadFromSupabase(): Promise<School[]> {
  if (_supabaseCache && Date.now() - _supabaseCache.ts < SUPABASE_TTL) {
    return _supabaseCache.list;
  }
  const sb = createClient(SUPABASE_URL!, SUPABASE_ANON!, { auth: { persistSession: false } });
  const [{ data: schools, error: se }, { data: careers, error: ce }] = await Promise.all([
    sb.from("schools").select("*").range(0, 50000),
    sb.from("careers").select("*").range(0, 50000),
  ]);
  if (se) throw new Error(`schools fetch: ${se.message}`);
  if (ce) throw new Error(`careers fetch: ${ce.message}`);

  // careers → careersByYear
  const cb: Record<string, Record<string, CareerData>> = {};
  for (const c of careers ?? []) {
    if (!cb[c.shl_idf_cd]) cb[c.shl_idf_cd] = {};
    const total: CareerRow = {
      graduates: c.graduates, generalHigh: c.general_high, vocationalHigh: c.vocational_high,
      scienceHigh: c.science_high, foreignIntlHigh: c.foreign_intl_high,
      artsSportsHigh: c.arts_sports_high, meisterHigh: c.meister_high,
      specialPurposeSubtotal: c.special_purpose_subtotal,
      privateAutonomous: c.private_autonomous, publicAutonomous: c.public_autonomous,
      autonomousSubtotal: c.autonomous_subtotal,
      other: c.other, advancedTotal: c.advanced_total,
      employed: c.employed, altEducation: c.alt_education, unemployed: c.unemployed,
    };
    cb[c.shl_idf_cd][String(c.year)] = {
      year: c.year,
      male: (c.male ?? total) as CareerRow,
      female: (c.female ?? total) as CareerRow,
      total,
      ratePct: (c.rate_pct ?? total) as CareerRow,
      totalGraduatesFromTable: c.graduates,
    };
  }

  const list: School[] = (schools ?? []).map((s) => {
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
      lat: s.lat,
      lng: s.lng,
      careersByYear: byYear,
      career: newest && byYear ? byYear[String(newest)] : null,
    };
  });

  _supabaseCache = { ts: Date.now(), list };
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

export async function loadSchool(SHL_IDF_CD: string): Promise<School | null> {
  const all = await loadAllSchools();
  return all.find((s) => s.SHL_IDF_CD === SHL_IDF_CD) ?? null;
}
