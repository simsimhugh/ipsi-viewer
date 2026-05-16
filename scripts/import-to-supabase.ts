/**
 * ~/hakgun-data/ JSONL → Supabase 적재 (upsert).
 *
 * 환경변수:
 *   SUPABASE_URL              — https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service_role secret (RLS bypass)
 *
 * 입력:
 *   ~/hakgun-data/school-master.jsonl      → schools 테이블
 *   ~/hakgun-data/careers-by-year.jsonl    → careers 테이블
 *
 * 사용: `npm run import:supabase`
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const URL  = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DIR  = process.env.HAKGUN_DATA_DIR ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");

if (!URL || !KEY) {
  console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 환경변수 필요");
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const METRO = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]);
function siGuOf(sidoName: string, sigungu: string | undefined): { si: string; gu: string } {
  const tokens = (sigungu ?? "").split(/\s+/).filter(Boolean);
  if (METRO.has(sidoName)) return { si: sidoName, gu: tokens[0] ?? "" };
  return { si: tokens[0] ?? "", gu: tokens[1] ?? "" };
}

async function loadJsonl<T>(filename: string): Promise<T[]> {
  const raw = await readFile(path.join(DIR, filename), "utf-8");
  return raw.split("\n").map(s => s.trim()).filter(Boolean).map(l => JSON.parse(l));
}

async function batchUpsert(table: string, rows: unknown[], chunkSize = 500): Promise<void> {
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk as never);
    if (error) throw new Error(`${table} upsert 실패 (${i}~${i + chunk.length}): ${error.message}`);
    done += chunk.length;
    console.log(`  [${table}] ${done}/${rows.length}`);
  }
}

interface MasterRecord {
  SHL_IDF_CD: string; schoolName: string;
  sidoCode: string; sidoName: string; sdSchulCode: string;
  kind: "초등학교" | "중학교" | "고등학교" | "기타";
  address?: string; sigungu?: string;
  lat?: number | null; lng?: number | null;
}

interface CareerBatchRecord {
  SHL_IDF_CD: string; schoolName: string; year: number;
  data: {
    total: Record<string, number>;
    male: Record<string, number>;
    female: Record<string, number>;
    ratePct: Record<string, number>;
  };
}

async function main() {
  console.log("[1] schools (master)");
  const master = await loadJsonl<MasterRecord>("school-master.jsonl");
  const schoolRows = master.map((m) => {
    const { si, gu } = siGuOf(m.sidoName, m.sigungu);
    return {
      shl_idf_cd:    m.SHL_IDF_CD,
      school_name:   m.schoolName,
      sido_code:     m.sidoCode,
      sido_name:     m.sidoName,
      sd_schul_code: m.sdSchulCode,
      kind:          m.kind,
      address:       m.address ?? null,
      sigungu:       m.sigungu ?? null,
      si, gu,
      lat:           m.lat ?? null,
      lng:           m.lng ?? null,
    };
  });
  console.log(`  ${schoolRows.length} 학교 upsert 시작`);
  await batchUpsert("schools", schoolRows);

  console.log("[2] careers (학교 × 연도)");
  const careers = await loadJsonl<CareerBatchRecord>("careers-by-year.jsonl");
  const careerRows = careers.map((c) => {
    const t = c.data.total;
    return {
      shl_idf_cd:               c.SHL_IDF_CD,
      year:                     c.year,
      graduates:                t.graduates,
      general_high:             t.generalHigh,
      vocational_high:          t.vocationalHigh,
      science_high:             t.scienceHigh,
      foreign_intl_high:        t.foreignIntlHigh,
      arts_sports_high:         t.artsSportsHigh,
      meister_high:             t.meisterHigh,
      special_purpose_subtotal: t.specialPurposeSubtotal,
      private_autonomous:       t.privateAutonomous,
      public_autonomous:        t.publicAutonomous,
      autonomous_subtotal:      t.autonomousSubtotal,
      other:                    t.other,
      advanced_total:           t.advancedTotal,
      employed:                 t.employed,
      alt_education:            t.altEducation,
      unemployed:               t.unemployed,
      male:    c.data.male,
      female:  c.data.female,
      rate_pct: c.data.ratePct,
    };
  });
  console.log(`  ${careerRows.length} 진로 record upsert 시작`);
  await batchUpsert("careers", careerRows);

  console.log("\n✅ 완료");
}

main().catch((e) => { console.error("실패:", e); process.exit(1); });
