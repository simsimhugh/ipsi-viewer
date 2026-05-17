/**
 * 전국 부동산 적재 파이프라인 (perf-optimized).
 *
 * 입력: ~/hakgun-data/realestate/fullcountry/<YYYYMM>-<lawd>-<type>.jsonl
 *   (run-realestate-fullcountry.ts 결과)
 *
 * 단계:
 *   [1] 모든 jsonl 로드 → unique 단지 (apt_name + sigungu) 추출
 *       단, realestate_runs에 이미 적재된 (lawd_cd, deal_ym, type)은 skip
 *   [2] 카카오 지오코딩 — 워커 8 병렬 (cache hit 우선)
 *   [3] Supabase apartments upsert (ON CONFLICT name+sigungu DO NOTHING)
 *   [4] Supabase transactions insert (chunk 1500, ON CONFLICT DO NOTHING)
 *   [5] Supabase rentals insert (chunk 1500, ON CONFLICT DO NOTHING)
 *   [6] realestate_runs 기록 (lawd_cd, deal_ym, type) — 다음 실행 시 skip
 *
 * 사전 적용 필요 (SQL Editor 1회):
 *   - apartments UNIQUE (name, coalesce(sigungu,''))
 *   - transactions_dedup_uidx, rentals_dedup_uidx
 *   - realestate_runs 테이블
 *   (supabase/schema.sql 하단 블록 참조)
 *
 * 환경:
 *   PUBLIC_DATA_API_KEY, KAKAO_REST_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * 인자:
 *   --skip-geocode  : 카카오 호출 skip (cache hit만 사용, 신규 단지는 좌표 null)
 *   --skip-tx       : transactions 단계 skip
 *   --skip-rent     : rentals 단계 skip
 *   --geocode-only  : apartments / 지오코딩까지만
 *   --geo-workers N : 카카오 동시 워커 (기본 8)
 *   --chunk N       : Supabase insert 청크 (기본 1500)
 *   --force         : realestate_runs 무시하고 전체 재적재
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

interface RunKey { lawd_cd: string; deal_ym: string; type: "trade" | "rent" }

/** 파일명 <YYYYMM>-<lawd>-<type>.jsonl 파싱. */
function parseFcFilename(f: string): RunKey | null {
  const m = /^(\d{6})-(\d{5})-(trade|rent)\.jsonl$/.exec(f);
  if (!m) return null;
  return { deal_ym: m[1], lawd_cd: m[2], type: m[3] as "trade" | "rent" };
}

async function loadFullcountryFiles(skipKeys: Set<string>): Promise<{ records: AnyRecord[]; processedKeys: RunKey[] }> {
  let files: string[];
  try {
    files = await readdir(FC_DIR);
  } catch {
    console.error(`[import] fullcountry 디렉토리 없음: ${FC_DIR} — 먼저 run-realestate-fullcountry.ts 실행`);
    process.exit(1);
  }
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort();
  console.log(`  jsonl 파일: ${jsonlFiles.length}개 (전체)`);

  const all: AnyRecord[] = [];
  const processed: RunKey[] = [];
  let loaded = 0;
  let skipped = 0;
  for (const f of jsonlFiles) {
    const k = parseFcFilename(f);
    if (k) {
      const keyStr = `${k.lawd_cd}|${k.deal_ym}|${k.type}`;
      if (skipKeys.has(keyStr)) { skipped++; continue; }
    }
    const recs = await loadJsonl<AnyRecord>(path.join(FC_DIR, f));
    all.push(...recs);
    if (k) processed.push(k);
    loaded++;
    if (loaded % 200 === 0) console.log(`  loaded ${loaded}/${jsonlFiles.length} files, records=${all.length}`);
  }
  console.log(`  loaded ${loaded}, skipped(이미 적재됨)=${skipped}, records=${all.length}`);
  return { records: all, processedKeys: processed };
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

/** append-only — 워커 동시 쓰기 안전성 위해 라인 한 번에 쓰기. */
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
    await sleep(80);
  }
  const q2 = [sido, u.sigungu, u.apt_name].filter(Boolean).join(" ");
  try {
    const doc = await kakaoKeyword(q2);
    if (doc) return docToGeo(doc, u, "kakao:keyword");
  } catch (e) { console.warn(`  keyword [${u.apt_name}]: ${(e as Error).message}`); }
  await sleep(80);
  if (u.jibun) {
    const q3 = [sido, u.sigungu, u.jibun].filter(Boolean).join(" ");
    try {
      const doc = await kakaoAddress(q3);
      if (doc) return docToGeo(doc, u, "kakao:address:jibun");
    } catch (e) { console.warn(`  address [${u.apt_name}]: ${(e as Error).message}`); }
  }
  return null;
}

/** 워커 풀 — items를 N개 워커로 fan-out. */
async function runWorkerPool<T>(items: T[], workers: number, fn: (t: T, idx: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const total = items.length;
  async function loop() {
    while (true) {
      const idx = cursor++;
      if (idx >= total) break;
      try {
        await fn(items[idx], idx);
      } catch (e) {
        console.warn(`  pool task ${idx} 실패: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, workers) }, () => loop()));
}

// ─── main ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const skipGeocode = hasFlag("skip-geocode");
  const skipTx = hasFlag("skip-tx");
  const skipRent = hasFlag("skip-rent");
  const geocodeOnly = hasFlag("geocode-only");
  const force = hasFlag("force");
  const geoWorkers = parseInt(arg("geo-workers") ?? "8");
  const CHUNK = parseInt(arg("chunk") ?? "1500");

  const need: string[] = [];
  if (!SUPA_URL) need.push("SUPABASE_URL");
  if (!SUPA_KEY) need.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!skipGeocode && !KAKAO_KEY) need.push("KAKAO_REST_API_KEY");
  if (need.length) { console.error(`[import] env 누락: ${need.join(", ")}`); process.exit(1); }

  console.log(`[import-realestate-fullcountry]`);
  console.log(`  옵션: skipGeocode=${skipGeocode} skipTx=${skipTx} skipRent=${skipRent} geocodeOnly=${geocodeOnly} force=${force}`);
  console.log(`  geoWorkers=${geoWorkers} chunk=${CHUNK}`);

  await mkdir(REAL_DIR, { recursive: true });

  const sb = createClient(SUPA_URL!, SUPA_KEY!, { auth: { persistSession: false } });

  // ─── [0] realestate_runs 로드 → 이미 적재된 (lawd_cd, ym, type) 집합 ─
  const completedKeys = new Set<string>();
  if (!force) {
    const { data, error } = await sb.from("realestate_runs").select("lawd_cd,deal_ym,type");
    if (error) {
      // 테이블 미존재 시 — schema.sql 적용 전이면 warning 후 비우고 진행 (legacy 호환)
      console.warn(`  [warn] realestate_runs 조회 실패 (스키마 미적용?): ${error.message}`);
    } else if (data) {
      for (const r of data as Array<{ lawd_cd: string; deal_ym: string; type: string }>) {
        completedKeys.add(`${r.lawd_cd}|${r.deal_ym}|${r.type}`);
      }
      console.log(`  적재 이력(realestate_runs): ${completedKeys.size}건 — 해당 (lawd, ym, type) skip`);
    }
  }

  // ─── [1] 입력 로드 ───────────────────────────────────────────────────
  console.log(`\n[1/6] jsonl 로드 (이미 적재된 파일 skip)`);
  const { records: allRecs, processedKeys } = await loadFullcountryFiles(completedKeys);
  const trades = allRecs.filter((r): r is TradeRecord => r.type === "trade");
  const rents = allRecs.filter((r): r is RentRecord => r.type === "rent");
  console.log(`  trade=${trades.length}, rent=${rents.length}, total=${allRecs.length}`);

  if (allRecs.length === 0) {
    console.log(`\nOK 적재할 신규 데이터 없음 (전부 realestate_runs에 기록됨). --force로 강제 재적재 가능.`);
    return;
  }

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

  // ─── [3] 지오코딩 (cache hit 우선 + 신규는 워커 병렬) ────────────────
  console.log(`\n[2/6] 지오코딩 (cache hit 우선, 신규는 워커 ${geoWorkers} 병렬)`);
  const cache = await loadCache();
  console.log(`  기존 cache: ${cache.size}건`);

  const uniqList = Array.from(uniqMap.values());

  // 먼저 cache hit / miss 분리
  const cacheHits: GeoRecord[] = [];
  const needLookup: UniqApt[] = [];
  let cacheHitCount = 0;
  for (const u of uniqList) {
    const key = `${u.apt_name}||${u.sigungu}`;
    if (cache.has(key)) {
      const r = cache.get(key) ?? null;
      cacheHitCount++;
      if (r && r.lat != null && r.lng != null) cacheHits.push(r);
    } else {
      needLookup.push(u);
    }
  }
  console.log(`  cacheHit=${cacheHitCount}, 신규 lookup 대상=${needLookup.length}`);

  const newlyGeo: GeoRecord[] = [];
  let kakaoCall = 0, newOk = 0, newFail = 0;

  if (!skipGeocode && needLookup.length > 0 && KAKAO_KEY) {
    const startedAt = Date.now();
    await runWorkerPool(needLookup, geoWorkers, async (u, idx) => {
      let result: GeoRecord | null = null;
      try {
        result = await geocodeOne(u);
      } catch (e) {
        console.warn(`  [${idx}] ${u.apt_name}: ${(e as Error).message}`);
      }
      kakaoCall++;
      await appendCacheLine({ name: u.apt_name, sigungu: u.sigungu, result });
      cache.set(`${u.apt_name}||${u.sigungu}`, result);
      if (result && result.lat != null && result.lng != null) {
        newlyGeo.push(result);
        newOk++;
      } else {
        newFail++;
      }
      // jitter 100~250ms — 워커 8 × 175ms ≒ ~45 RPS, 카카오 일일 30만 안전.
      await sleep(100 + Math.random() * 150);
      if (((idx + 1) % 500) === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = (idx + 1) / Math.max(elapsed, 0.001);
        const eta = (needLookup.length - idx - 1) / Math.max(rate, 0.001);
        console.log(`  [${idx + 1}/${needLookup.length}] ok=${newOk} fail=${newFail} elapsed=${Math.round(elapsed)}s ETA=${Math.round(eta / 60)}min`);
      }
    });
  } else if (skipGeocode) {
    console.log(`  skipGeocode=true — 신규 ${needLookup.length}건 좌표 없음`);
  }

  const geocoded: GeoRecord[] = [...cacheHits, ...newlyGeo];
  console.log(`  지오코딩 결과: 좌표 보유=${geocoded.length} (cacheHit=${cacheHits.length} + newOk=${newOk}), newFail=${newFail}, kakaoCall=${kakaoCall}`);

  // ─── [4] apartments upsert (ON CONFLICT DO NOTHING) ──────────────────
  console.log(`\n[3/6] apartments upsert (ON CONFLICT name+sigungu DO NOTHING)`);

  // 신규 후보 dedup (name+sigungu)
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
  console.log(`  upsert 후보: ${toInsert.length}건 (중복 제거 후)`);

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error } = await sb
      .from("apartments")
      .upsert(chunk, { onConflict: "name,sigungu", ignoreDuplicates: true });
    if (error) {
      // ON CONFLICT 키가 없으면 fallback 시도 (기존 동작: 신규 insert만, dup은 error로 떨어질 수도)
      console.warn(`  [warn] apartments upsert (onConflict) 실패: ${error.message} — fallback insert (ignore dup)`);
      const { error: e2 } = await sb.from("apartments").insert(chunk);
      if (e2 && !/duplicate/i.test(e2.message)) throw new Error(`apartments insert: ${e2.message}`);
    }
    if (((i / CHUNK) % 5) === 0) console.log(`  apartments ${Math.min(i + chunk.length, toInsert.length)}/${toInsert.length}`);
  }

  // 적재된 apartments id 조회 (geocoded 키만 — 전체 select 회피)
  console.log(`  apartments id 조회중...`);
  const aptIdByKey = new Map<string, number>();
  // sigungu 기준 페이지네이션 — 단순히 전체 select. (전국 5만+α, 1~2초)
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from("apartments").select("id,name,sigungu").range(off, off + PAGE - 1);
    if (error) throw new Error(`apartments select: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: number; name: string; sigungu: string | null }>) {
      aptIdByKey.set(`${r.name}||${r.sigungu ?? ""}`, r.id);
    }
    if (data.length < PAGE) break;
  }
  console.log(`  apartments id 매핑: ${aptIdByKey.size}건`);

  if (geocodeOnly) {
    console.log(`\nOK geocodeOnly — apartments 적재까지 완료`);
    return;
  }

  // ─── [5a] transactions insert (idempotent — ON CONFLICT DO NOTHING) ──
  if (!skipTx) {
    console.log(`\n[4/6] transactions insert (ON CONFLICT dedup DO NOTHING, chunk=${CHUNK})`);
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

    for (let i = 0; i < txRows.length; i += CHUNK) {
      const chunk = txRows.slice(i, i + CHUNK);
      const { error } = await sb
        .from("transactions")
        .upsert(chunk, { onConflict: "apt_id,contract_date,area_m2,floor,price_won", ignoreDuplicates: true });
      if (error) {
        console.warn(`  [warn] tx upsert 실패: ${error.message} — fallback insert`);
        const { error: e2 } = await sb.from("transactions").insert(chunk);
        if (e2 && !/duplicate/i.test(e2.message)) throw new Error(`transactions insert (${i}): ${e2.message}`);
      }
      if (((i / CHUNK) % 10) === 0) console.log(`  tx ${Math.min(i + chunk.length, txRows.length)}/${txRows.length}`);
    }
    console.log(`  OK transactions ${txRows.length}건 처리`);
  }

  // ─── [5b] rentals insert (idempotent) ────────────────────────────────
  if (!skipRent) {
    console.log(`\n[5/6] rentals insert (ON CONFLICT dedup DO NOTHING, chunk=${CHUNK})`);
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

    for (let i = 0; i < rentRows.length; i += CHUNK) {
      const chunk = rentRows.slice(i, i + CHUNK);
      const { error } = await sb
        .from("rentals")
        .upsert(chunk, { onConflict: "apt_id,contract_date,area_m2,floor,deposit_man_won,monthly_rent_man_won", ignoreDuplicates: true });
      if (error) {
        console.warn(`  [warn] rent upsert 실패: ${error.message} — fallback insert`);
        const { error: e2 } = await sb.from("rentals").insert(chunk);
        if (e2 && !/duplicate/i.test(e2.message)) throw new Error(`rentals insert (${i}): ${e2.message}`);
      }
      if (((i / CHUNK) % 10) === 0) console.log(`  rent ${Math.min(i + chunk.length, rentRows.length)}/${rentRows.length}`);
    }
    console.log(`  OK rentals ${rentRows.length}건 처리`);
  }

  // ─── [6] realestate_runs 기록 ─────────────────────────────────────────
  console.log(`\n[6/6] realestate_runs 기록 (${processedKeys.length}건)`);
  if (processedKeys.length > 0) {
    // counts per (lawd, ym, type)
    const counts = new Map<string, number>();
    for (const r of allRecs) {
      const k = `${r.lawd_cd}|${r.deal_ym}|${r.type}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const rows = processedKeys.map((k) => ({
      lawd_cd: k.lawd_cd,
      deal_ym: k.deal_ym,
      type: k.type,
      records: counts.get(`${k.lawd_cd}|${k.deal_ym}|${k.type}`) ?? 0,
    }));
    const RUN_CHUNK = 500;
    for (let i = 0; i < rows.length; i += RUN_CHUNK) {
      const chunk = rows.slice(i, i + RUN_CHUNK);
      const { error } = await sb
        .from("realestate_runs")
        .upsert(chunk, { onConflict: "lawd_cd,deal_ym,type" });
      if (error) {
        console.warn(`  [warn] realestate_runs upsert 실패 (스키마 미적용?): ${error.message}`);
        break;
      }
    }
    console.log(`  OK realestate_runs 기록 완료`);
  }

  console.log(`\nOK 완료`);
  console.log(`  apartments upsert 후보: ${toInsert.length}, 총 id 매핑: ${aptIdByKey.size}`);
}

if (process.argv[1]?.endsWith("/import-realestate-fullcountry.ts")) {
  main().catch((err) => { console.error("실패:", err); process.exit(1); });
}
