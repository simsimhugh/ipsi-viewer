/**
 * 전국 부동산 적재 파이프라인.
 *
 * 입력: ~/hakgun-data/realestate/fullcountry/<YYYYMM>-<lawd>-<type>.jsonl
 *   (run-realestate-fullcountry.ts 결과)
 *
 * 단계:
 *   [1] 모든 jsonl 로드 → unique 단지 (apt_name + sigungu) 추출
 *   [2] 카카오 지오코딩 (cache hit 활용) → apartments-geocoded.cache.jsonl
 *   [3] Supabase apartments upsert (신규만)
 *   [4] Supabase transactions upsert (chunk 500)
 *   [5] Supabase rentals upsert (chunk 500)
 *
 * 환경:
 *   PUBLIC_DATA_API_KEY, KAKAO_REST_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * 인자:
 *   --skip-geocode  : 카카오 호출 skip (cache hit만 사용, 신규 단지는 좌표 null)
 *   --skip-tx       : transactions 단계 skip
 *   --skip-rent     : rentals 단계 skip
 *   --geocode-only  : apartments / 지오코딩까지만
 *
 * 사용:
 *   tsx scripts/import-realestate-fullcountry.ts
 */
import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sidoForKakao } from "./lawd-codes-all.js";

// .env.local 자동 로드
(function loadDotenvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  const raw = readFileSync(file, "utf-8");
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USER_AGENT = "Mozilla/5.0";
const DATA_DIR = process.env.HAKGUN_DATA_DIR ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");
const FC_DIR = path.join(DATA_DIR, "realestate", "fullcountry");
const REAL_DIR = path.join(DATA_DIR, "realestate");
const GEO_CACHE = path.join(REAL_DIR, "apartments-geocoded.cache.jsonl");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── 입력 record types (run-realestate-fullcountry.ts와 동일) ──────────
interface TradeRecord {
  type: "trade";
  lawd_cd: string;
  deal_ym: string;
  apt_name: string;
  sigungu: string;
  jibun: string;
  road_name: string;
  area_m2: number | null;
  price_man_won: number | null;
  floor: number | null;
  build_year: number | null;
  deal_day: string;
}
interface RentRecord {
  type: "rent";
  lawd_cd: string;
  deal_ym: string;
  apt_name: string;
  sigungu: string;
  jibun: string;
  road_name: string;
  area_m2: number | null;
  deposit_man_won: number | null;
  monthly_rent_man_won: number | null;
  floor: number | null;
  build_year: number | null;
  deal_day: string;
}
type AnyRecord = TradeRecord | RentRecord;

interface GeoRecord {
  name: string;
  sigungu: string;
  road_address: string | null;
  lat: number | null;
  lng: number | null;
  built_year: number | null;
  source: string;
}

interface CacheEntry { name: string; sigungu: string; result: GeoRecord | null }

// ─── jsonl 로더 ────────────────────────────────────────────────────────
async function loadJsonl<T>(file: string): Promise<T[]> {
  const text = await readFile(file, "utf-8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s) as T); } catch { /* skip */ }
  }
  return out;
}

async function loadAllRecords(): Promise<AnyRecord[]> {
  let files: string[];
  try {
    files = await readdir(FC_DIR);
  } catch {
    console.error(`[import] fullcountry 디렉토리 없음: ${FC_DIR} — 먼저 run-realestate-fullcountry.ts 실행`);
    process.exit(1);
  }
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort();
  console.log(`  jsonl 파일: ${jsonlFiles.length}개`);

  const all: AnyRecord[] = [];
  let done = 0;
  for (const f of jsonlFiles) {
    const recs = await loadJsonl<AnyRecord>(path.join(FC_DIR, f));
    all.push(...recs);
    done++;
    if (done % 200 === 0) console.log(`  loaded ${done}/${jsonlFiles.length} files, records=${all.length}`);
  }
  return all;
}

// ─── 지오코딩 cache ────────────────────────────────────────────────────
async function loadCache(): Promise<Map<string, GeoRecord | null>> {
  const m = new Map<string, GeoRecord | null>();
  try { await access(GEO_CACHE); } catch { return m; }
  const text = await readFile(GEO_CACHE, "utf-8");
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s) as CacheEntry;
      m.set(`${obj.name}||${obj.sigungu}`, obj.result);
    } catch { /* skip */ }
  }
  return m;
}

async function appendCacheLine(entry: CacheEntry): Promise<void> {
  await writeFile(GEO_CACHE, JSON.stringify(entry) + "\n", { encoding: "utf-8", flag: "a" });
}

// ─── 카카오 ────────────────────────────────────────────────────────────
interface KakaoDoc {
  x: string;
  y: string;
  road_address?: { address_name?: string } | null;
  road_address_name?: string;
}

async function kakaoKeyword(query: string): Promise<KakaoDoc | null> {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY!}`, "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    if (res.status === 429) { await sleep(1000); return null; }
    throw new Error(`kakao keyword ${res.status}`);
  }
  const j = (await res.json()) as { documents?: KakaoDoc[] };
  return j.documents?.[0] ?? null;
}

async function kakaoAddress(query: string): Promise<KakaoDoc | null> {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY!}`, "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    if (res.status === 429) { await sleep(1000); return null; }
    throw new Error(`kakao address ${res.status}`);
  }
  const j = (await res.json()) as { documents?: KakaoDoc[] };
  return j.documents?.[0] ?? null;
}

interface UniqApt {
  apt_name: string;
  sigungu: string;
  lawd_cd: string;
  road_name: string;
  jibun: string;
  build_year: number | null;
}

function docToGeo(doc: KakaoDoc, u: UniqApt, source: string): GeoRecord {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const road = doc.road_address?.address_name ?? doc.road_address_name ?? null;
  return {
    name: u.apt_name,
    sigungu: u.sigungu,
    road_address: road,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    built_year: u.build_year,
    source,
  };
}

async function geocodeOne(u: UniqApt): Promise<GeoRecord | null> {
  const sido = sidoForKakao(u.lawd_cd);
  if (u.road_name) {
    const q = [sido, u.sigungu, u.road_name, u.apt_name].filter(Boolean).join(" ");
    try {
      const doc = await kakaoKeyword(q);
      if (doc) return docToGeo(doc, u, "kakao:keyword:road");
    } catch (e) { console.warn(`  keyword(road) [${u.apt_name}]: ${(e as Error).message}`); }
    await sleep(150);
  }
  const q2 = [sido, u.sigungu, u.apt_name].filter(Boolean).join(" ");
  try {
    const doc = await kakaoKeyword(q2);
    if (doc) return docToGeo(doc, u, "kakao:keyword");
  } catch (e) { console.warn(`  keyword [${u.apt_name}]: ${(e as Error).message}`); }
  await sleep(150);
  if (u.jibun) {
    const q3 = [sido, u.sigungu, u.jibun].filter(Boolean).join(" ");
    try {
      const doc = await kakaoAddress(q3);
      if (doc) return docToGeo(doc, u, "kakao:address:jibun");
    } catch (e) { console.warn(`  address [${u.apt_name}]: ${(e as Error).message}`); }
  }
  return null;
}

// ─── main ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const skipGeocode = hasFlag("skip-geocode");
  const skipTx = hasFlag("skip-tx");
  const skipRent = hasFlag("skip-rent");
  const geocodeOnly = hasFlag("geocode-only");

  const need: string[] = [];
  if (!SUPA_URL) need.push("SUPABASE_URL");
  if (!SUPA_KEY) need.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!skipGeocode && !KAKAO_KEY) need.push("KAKAO_REST_API_KEY");
  if (need.length) { console.error(`[import] env 누락: ${need.join(", ")}`); process.exit(1); }

  console.log(`[import-realestate-fullcountry]`);
  console.log(`  옵션: skipGeocode=${skipGeocode} skipTx=${skipTx} skipRent=${skipRent} geocodeOnly=${geocodeOnly}`);

  await mkdir(REAL_DIR, { recursive: true });

  // ─── [1] 입력 로드 ───────────────────────────────────────────────────
  console.log(`\n[1/5] jsonl 로드`);
  const allRecs = await loadAllRecords();
  const trades = allRecs.filter((r): r is TradeRecord => r.type === "trade");
  const rents = allRecs.filter((r): r is RentRecord => r.type === "rent");
  console.log(`  trade=${trades.length}, rent=${rents.length}, total=${allRecs.length}`);

  // ─── [2] unique 단지 추출 ────────────────────────────────────────────
  const uniqMap = new Map<string, UniqApt>();
  for (const r of allRecs) {
    if (!r.apt_name) continue;
    const key = `${r.apt_name}||${r.sigungu}`;
    const cur = uniqMap.get(key);
    if (!cur) {
      uniqMap.set(key, {
        apt_name: r.apt_name,
        sigungu: r.sigungu,
        lawd_cd: r.lawd_cd,
        road_name: r.road_name,
        jibun: r.jibun,
        build_year: r.build_year ?? null,
      });
    } else {
      if (!cur.build_year && r.build_year) cur.build_year = r.build_year;
      if (!cur.road_name && r.road_name) cur.road_name = r.road_name;
      if (!cur.jibun && r.jibun) cur.jibun = r.jibun;
    }
  }
  console.log(`  unique 단지: ${uniqMap.size}`);

  // ─── [3] 지오코딩 (cache hit 우선) ────────────────────────────────────
  console.log(`\n[2/5] 지오코딩 (cache hit 우선)`);
  const cache = await loadCache();
  console.log(`  기존 cache: ${cache.size}건`);

  const geocoded: GeoRecord[] = [];
  let cacheHit = 0, kakaoCall = 0, okCount = 0, failCount = 0;
  let idx = 0;
  for (const u of uniqMap.values()) {
    idx++;
    const key = `${u.apt_name}||${u.sigungu}`;
    let result: GeoRecord | null;
    if (cache.has(key)) {
      result = cache.get(key) ?? null;
      cacheHit++;
    } else if (skipGeocode) {
      result = null;
    } else {
      try {
        result = await geocodeOne(u);
      } catch (e) {
        console.warn(`  [${idx}] ${u.apt_name}: ${(e as Error).message}`);
        result = null;
      }
      kakaoCall++;
      await appendCacheLine({ name: u.apt_name, sigungu: u.sigungu, result });
      cache.set(key, result);
      await sleep(120);
    }
    if (result && result.lat != null && result.lng != null) {
      geocoded.push(result);
      okCount++;
    } else {
      failCount++;
    }
    if (idx % 500 === 0) console.log(`  [${idx}/${uniqMap.size}] cacheHit=${cacheHit} kakao=${kakaoCall} ok=${okCount} fail=${failCount}`);
  }
  console.log(`  지오코딩 결과: ok=${okCount} fail=${failCount} cacheHit=${cacheHit} kakaoCall=${kakaoCall}`);

  // ─── [4] Supabase apartments upsert ──────────────────────────────────
  console.log(`\n[3/5] Supabase apartments upsert`);
  const sb = createClient(SUPA_URL!, SUPA_KEY!, { auth: { persistSession: false } });

  const existing = new Map<string, number>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from("apartments").select("id,name,sigungu").range(off, off + PAGE - 1);
    if (error) throw new Error(`apartments select: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: number; name: string; sigungu: string | null }>) {
      existing.set(`${r.name}||${r.sigungu ?? ""}`, r.id);
    }
    if (data.length < PAGE) break;
  }
  console.log(`  기존 apartments: ${existing.size}건`);

  const dedupedKeys = new Set<string>();
  const toInsert: Array<{
    name: string; sigungu: string | null; road_address: string | null;
    lat: number | null; lng: number | null; built_year: number | null;
    households: null; source: string;
  }> = [];
  for (const g of geocoded) {
    const k = `${g.name}||${g.sigungu ?? ""}`;
    if (dedupedKeys.has(k)) continue;
    dedupedKeys.add(k);
    if (existing.has(k)) continue;
    toInsert.push({
      name: g.name,
      sigungu: g.sigungu || null,
      road_address: g.road_address,
      lat: g.lat,
      lng: g.lng,
      built_year: g.built_year,
      households: null,
      source: g.source,
    });
  }
  console.log(`  신규 insert: ${toInsert.length}건`);

  const aptIdByKey = new Map<string, number>(existing);
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { data, error } = await sb.from("apartments").insert(chunk).select("id,name,sigungu");
    if (error) throw new Error(`apartments insert: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: number; name: string; sigungu: string | null }>) {
      aptIdByKey.set(`${r.name}||${r.sigungu ?? ""}`, r.id);
    }
    console.log(`  apartments insert ${Math.min(i + chunk.length, toInsert.length)}/${toInsert.length}`);
  }

  if (geocodeOnly) {
    console.log(`\nOK geocodeOnly — apartments 적재까지 완료`);
    return;
  }

  // ─── [5a] transactions upsert ────────────────────────────────────────
  if (!skipTx) {
    console.log(`\n[4/5] transactions insert (truncate-and-insert)`);
    type TxRow = {
      apt_id: number; area_m2: number | null; price_won: number | null;
      contract_date: string; floor: number | null; source: string;
    };
    const txRows: TxRow[] = [];
    let txUnmatched = 0;
    for (const t of trades) {
      const aptId = aptIdByKey.get(`${t.apt_name}||${t.sigungu}`);
      if (aptId == null) { txUnmatched++; continue; }
      txRows.push({
        apt_id: aptId,
        area_m2: t.area_m2,
        price_won: t.price_man_won != null ? Math.round(t.price_man_won * 10000) : null,
        contract_date: t.deal_day,
        floor: t.floor,
        source: "molit",
      });
    }
    console.log(`  매칭됨: ${txRows.length}, 미매칭(좌표/단지 없음): ${txUnmatched}`);

    console.log(`  기존 transactions 삭제...`);
    const { error: delErr } = await sb.from("transactions").delete().gte("contract_date", "1900-01-01");
    if (delErr) console.warn(`  delete: ${delErr.message}`);

    for (let i = 0; i < txRows.length; i += CHUNK) {
      const chunk = txRows.slice(i, i + CHUNK);
      const { error } = await sb.from("transactions").insert(chunk);
      if (error) throw new Error(`transactions insert (${i}): ${error.message}`);
      if ((i / CHUNK) % 20 === 0) console.log(`  tx ${Math.min(i + chunk.length, txRows.length)}/${txRows.length}`);
    }
    console.log(`  ✓ transactions ${txRows.length}건 적재`);
  }

  // ─── [5b] rentals upsert ─────────────────────────────────────────────
  if (!skipRent) {
    console.log(`\n[5/5] rentals insert (truncate-and-insert)`);
    type RentRow = {
      apt_id: number; area_m2: number | null;
      deposit_man_won: number | null; monthly_rent_man_won: number | null;
      contract_date: string; floor: number | null; source: string;
    };
    const rentRows: RentRow[] = [];
    let rentUnmatched = 0;
    for (const r of rents) {
      const aptId = aptIdByKey.get(`${r.apt_name}||${r.sigungu}`);
      if (aptId == null) { rentUnmatched++; continue; }
      rentRows.push({
        apt_id: aptId,
        area_m2: r.area_m2,
        deposit_man_won: r.deposit_man_won,
        monthly_rent_man_won: r.monthly_rent_man_won,
        contract_date: r.deal_day,
        floor: r.floor,
        source: "molit",
      });
    }
    console.log(`  매칭됨: ${rentRows.length}, 미매칭: ${rentUnmatched}`);

    console.log(`  기존 rentals 삭제...`);
    const { error: delErr } = await sb.from("rentals").delete().gte("contract_date", "1900-01-01");
    if (delErr) console.warn(`  delete: ${delErr.message}`);

    for (let i = 0; i < rentRows.length; i += CHUNK) {
      const chunk = rentRows.slice(i, i + CHUNK);
      const { error } = await sb.from("rentals").insert(chunk);
      if (error) throw new Error(`rentals insert (${i}): ${error.message}`);
      if ((i / CHUNK) % 20 === 0) console.log(`  rent ${Math.min(i + chunk.length, rentRows.length)}/${rentRows.length}`);
    }
    console.log(`  ✓ rentals ${rentRows.length}건 적재`);
  }

  console.log(`\nOK 완료`);
  console.log(`  apartments 신규: ${toInsert.length}, 총 기존+신규: ${aptIdByKey.size}`);
}

if (process.argv[1]?.endsWith("/import-realestate-fullcountry.ts")) {
  main().catch((err) => { console.error("실패:", err); process.exit(1); });
}
