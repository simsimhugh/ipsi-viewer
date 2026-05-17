/**
 * 부동산 MVP — apartments + transactions Supabase 적재.
 *
 * 입력:
 *   ~/hakgun-data/apartments-geocoded.jsonl  (kakao-geocode 산출)
 *   ~/hakgun-data/apt-transactions.jsonl     (fetch-apt-transactions 산출)
 *
 * 환경변수:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 동작:
 *   1) apartments-geocoded.jsonl → apartments 테이블 upsert (id 받아 in-memory map)
 *   2) apt-transactions.jsonl → transactions 테이블 insert (apt_id 매핑)
 *      매핑 키: (name, sigungu) — 지오코딩에 실패한 단지는 transaction도 skip.
 *
 * 사용:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx scripts/import-apartments.ts
 */
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DIR = process.env.HAKGUN_DATA_DIR ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");
const APT_FILE = path.join(DIR, "apartments-geocoded.jsonl");
const TX_FILE  = path.join(DIR, "apt-transactions.jsonl");

interface GeoRow {
  name: string;
  sigungu: string;
  road_address: string | null;
  lat: number | null;
  lng: number | null;
  built_year: number | null;
  source: string;
}

interface TxRow {
  apt_name: string;
  sigungu: string;
  area_m2: number | null;
  price_man_won: number | null;
  floor: number | null;
  deal_day: string;
  build_year: number | null;
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function loadJsonl<T>(file: string): Promise<T[]> {
  const raw = await readFile(file, "utf-8");
  return raw.split("\n").map((s) => s.trim()).filter(Boolean).map((l) => JSON.parse(l) as T);
}

async function main() {
  if (!URL || !KEY) {
    console.error("[import-apartments] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요 — graceful exit.");
    process.exit(0);
  }
  if (!(await exists(APT_FILE))) {
    console.error(`[import-apartments] ${APT_FILE} 없음 — kakao-geocode 먼저 실행`);
    process.exit(1);
  }

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  // ── 1. apartments upsert ─────────────────────────────────────────────────
  const geos = await loadJsonl<GeoRow>(APT_FILE);
  console.log(`[1/2] apartments: ${geos.length}건 로드`);

  // (name, sigungu) 중복 제거 — kakao-geocode 단계에서 unique 했지만 안전
  const seen = new Set<string>();
  const aptRows = geos.filter((g) => {
    if (g.lat == null || g.lng == null) return false;
    const k = `${g.name}||${g.sigungu}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((g) => ({
    name: g.name,
    sigungu: g.sigungu || null,
    road_address: g.road_address,
    lat: g.lat,
    lng: g.lng,
    built_year: g.built_year,
    households: null,
    source: g.source,
  }));
  console.log(`  유효 단지 (좌표 보유): ${aptRows.length}`);

  // chunked upsert — Supabase에 unique constraint가 없으므로 select 후 insert/update 분기.
  // 단순화: 전부 insert 시도, 충돌나는 케이스만 update로 빠지지 않게 (name+sigungu) PK 없음.
  // → upsert 대신 "name+sigungu" 별로 일단 select 후 없는 것만 insert.
  console.log(`  기존 apartments 조회 (중복 제거용)...`);
  const existing = new Map<string, number>(); // "name||sigungu" → id
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from("apartments")
      .select("id,name,sigungu")
      .range(off, off + PAGE - 1);
    if (error) throw new Error(`apartments select: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: number; name: string; sigungu: string | null }>) {
      existing.set(`${r.name}||${r.sigungu ?? ""}`, r.id);
    }
    if (data.length < PAGE) break;
  }
  console.log(`  기존 apartments: ${existing.size}건`);

  const toInsert = aptRows.filter((r) => !existing.has(`${r.name}||${r.sigungu ?? ""}`));
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

  // built_year/lat/lng 업데이트가 필요한 기존 row — 좌표는 있는데 built_year만 비어있는 경우 갱신.
  // MVP에선 skip — 신규 insert만 처리.

  // ── 2. transactions insert ───────────────────────────────────────────────
  if (!(await exists(TX_FILE))) {
    console.log(`[2/2] transactions: ${TX_FILE} 없음 — skip`);
    return;
  }
  const txs = await loadJsonl<TxRow>(TX_FILE);
  console.log(`[2/2] transactions: ${txs.length}건 로드`);

  // 동일 (apt_id, contract_date, price_won, area_m2, floor) 중복 방지 — 같은 거래가 여러 번 수집될 수 있음.
  // MVP: 단순 insert. 중복은 DB에 부담은 있지만 정확성에 영향 없음 (중복 row 표시되는 정도).
  // 더 안전한 방법: 사전 fetch + Set 비교. MVP는 truncate-and-insert로 깔끔.

  const txRowsAll: Array<{
    apt_id: number;
    area_m2: number | null;
    price_won: number | null;
    contract_date: string;
    floor: number | null;
    source: string;
  }> = [];
  let unmatched = 0;
  for (const t of txs) {
    const aptId = aptIdByKey.get(`${t.apt_name}||${t.sigungu}`);
    if (aptId == null) { unmatched++; continue; }
    txRowsAll.push({
      apt_id: aptId,
      area_m2: t.area_m2,
      price_won: t.price_man_won != null ? Math.round(t.price_man_won * 10000) : null,
      contract_date: t.deal_day,
      floor: t.floor,
      source: "molit",
    });
  }
  console.log(`  매칭됨: ${txRowsAll.length}, 미매칭(단지 좌표 없음): ${unmatched}`);

  // truncate 후 insert — apt_id가 cascade라 apartments delete 시 자동 정리.
  // MVP 정책: 매 import 시 transactions 새로 쓰는 게 깔끔.
  console.log(`  기존 transactions 삭제...`);
  // contract_date >= '1900-01-01' 으로 전부 (필터 없는 delete는 PostgREST가 막음)
  const { error: delErr } = await sb.from("transactions").delete().gte("contract_date", "1900-01-01");
  if (delErr) {
    console.warn(`  delete 실패 (계속): ${delErr.message}`);
  }

  for (let i = 0; i < txRowsAll.length; i += CHUNK) {
    const chunk = txRowsAll.slice(i, i + CHUNK);
    const { error } = await sb.from("transactions").insert(chunk);
    if (error) throw new Error(`transactions insert (${i}): ${error.message}`);
    console.log(`  transactions insert ${Math.min(i + chunk.length, txRowsAll.length)}/${txRowsAll.length}`);
  }

  console.log(`\nOK 완료: apartments=${aptIdByKey.size} (신규 ${toInsert.length}), transactions=${txRowsAll.length}`);
}

if (process.argv[1]?.endsWith("/import-apartments.ts")) {
  main().catch((e) => { console.error("실패:", e); process.exit(1); });
}
