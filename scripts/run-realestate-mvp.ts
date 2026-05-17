/**
 * 부동산 MVP 통합 파이프라인 (작게 — 5구 × 3개월 = 15 API call).
 *
 * 1) 국토부 RTMSDataSvcAptTradeDev fetch (5 LAWD × 3개월)
 * 2) unique 단지 (apt_name + sigungu) 추출 → 카카오 지오코딩 (200ms 간격)
 * 3) Supabase apartments upsert
 * 4) Supabase transactions truncate-and-insert
 * 5) apartment_school_map (반경 1km, 중학교만) upsert
 *
 * 환경:
 *   PUBLIC_DATA_API_KEY  — data.go.kr
 *   KAKAO_REST_API_KEY   — kakao local
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  — RLS bypass
 *
 * 사용:
 *   tsx scripts/run-realestate-mvp.ts
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// .env.local 자동 로드 (의존성 없는 단순 파서) — 이미 셋되어 있으면 그대로 유지
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

const PUBLIC_KEY = process.env.PUBLIC_DATA_API_KEY;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USER_AGENT = "Mozilla/5.0";
const MOLIT_ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";

const LAWD_CODES = [
  { code: "11650", name: "서초구" },
  { code: "11680", name: "강남구" },
  { code: "11710", name: "송파구" },
  { code: "11470", name: "양천구" },
  { code: "11350", name: "노원구" },
  { code: "41465", name: "용인시수지구" },
  { code: "41135", name: "성남시분당구" },
];
const MONTHS = ["202502", "202503", "202504"];

const DATA_DIR = process.env.HAKGUN_DATA_DIR ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");
const REAL_DIR = path.join(DATA_DIR, "realestate");
const TX_OUT = path.join(REAL_DIR, "apt-transactions.jsonl");
const GEO_OUT = path.join(REAL_DIR, "apartments-geocoded.jsonl");
const GEO_CACHE = path.join(REAL_DIR, "apartments-geocoded.cache.jsonl");

interface TxRecord {
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

interface GeoRecord {
  name: string;
  sigungu: string;
  road_address: string | null;
  lat: number | null;
  lng: number | null;
  built_year: number | null;
  source: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toNumber(s: string | undefined): number | null {
  if (!s) return null;
  const c = s.replace(/,/g, "").trim();
  if (!c) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

function parseXmlItems(xml: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const body = m[1];
    const obj: Record<string, string> = {};
    const tagRe = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(body))) obj[t[1]] = t[2].trim();
    out.push(obj);
  }
  return out;
}

function parseXmlMeta(xml: string): { resultCode?: string; resultMsg?: string; totalCount?: number } {
  return {
    resultCode: /<resultCode>([\s\S]*?)<\/resultCode>/.exec(xml)?.[1]?.trim(),
    resultMsg: /<resultMsg>([\s\S]*?)<\/resultMsg>/.exec(xml)?.[1]?.trim(),
    totalCount: (() => {
      const v = /<totalCount>([\s\S]*?)<\/totalCount>/.exec(xml)?.[1]?.trim();
      return v ? parseInt(v) : undefined;
    })(),
  };
}

function toTxRecord(raw: Record<string, string>, lawdCd: string, dealYm: string): TxRecord | null {
  const aptName = (raw.aptNm ?? "").trim();
  if (!aptName) return null;
  const y = raw.dealYear ?? dealYm.slice(0, 4);
  const m = raw.dealMonth ?? dealYm.slice(4, 6);
  const d = raw.dealDay ?? "";
  const dealDay = d
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : `${y}-${String(m).padStart(2, "0")}-01`;
  return {
    lawd_cd: lawdCd,
    deal_ym: dealYm,
    apt_name: aptName,
    sigungu: (raw.umdNm ?? "").trim(),
    jibun: (raw.jibun ?? "").trim(),
    road_name: (raw.roadNm ?? "").trim(),
    area_m2: toNumber(raw.excluUseAr),
    price_man_won: toNumber(raw.dealAmount),
    floor: toNumber(raw.floor),
    build_year: toNumber(raw.buildYear),
    deal_day: dealDay,
  };
}

async function fetchMonth(lawdCd: string, dealYm: string): Promise<TxRecord[]> {
  const out: TxRecord[] = [];
  let pageNo = 1;
  const numOfRows = 1000;
  while (true) {
    const params = new URLSearchParams({
      serviceKey: PUBLIC_KEY!,
      LAWD_CD: lawdCd,
      DEAL_YMD: dealYm,
      numOfRows: String(numOfRows),
      pageNo: String(pageNo),
    });
    const res = await fetch(`${MOLIT_ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`molit ${res.status}`);
    const xml = await res.text();
    const meta = parseXmlMeta(xml);
    if (meta.resultCode && meta.resultCode !== "00" && meta.resultCode !== "000") {
      console.warn(`  [${lawdCd}/${dealYm}] result=${meta.resultCode} ${meta.resultMsg ?? ""}`);
      break;
    }
    const items = parseXmlItems(xml);
    for (const raw of items) {
      const rec = toTxRecord(raw, lawdCd, dealYm);
      if (rec) out.push(rec);
    }
    const seen = pageNo * numOfRows;
    if (meta.totalCount != null && seen >= meta.totalCount) break;
    if (items.length < numOfRows) break;
    pageNo++;
    await sleep(150);
  }
  return out;
}

// ─── 카카오 지오코딩 ──────────────────────────────────────────────────────
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

function lawdToSido(lawdCd: string): string {
  const p = lawdCd.slice(0, 2);
  if (p === "11") return "서울특별시";
  if (p === "41") return "경기도";
  return "";
}

async function geocodeOne(tx: TxRecord): Promise<GeoRecord | null> {
  const sido = lawdToSido(tx.lawd_cd);

  // 1) 도로명 + 단지명 키워드
  if (tx.road_name) {
    const q = [sido, tx.sigungu, tx.road_name, tx.apt_name].filter(Boolean).join(" ");
    try {
      const doc = await kakaoKeyword(q);
      if (doc) return docToGeo(doc, tx, "kakao:keyword:road");
    } catch (e) {
      console.warn(`  keyword(road) 실패 [${tx.apt_name}]: ${(e as Error).message}`);
    }
    await sleep(150);
  }

  // 2) 단지명 키워드
  const q2 = [sido, tx.sigungu, tx.apt_name].filter(Boolean).join(" ");
  try {
    const doc = await kakaoKeyword(q2);
    if (doc) return docToGeo(doc, tx, "kakao:keyword");
  } catch (e) {
    console.warn(`  keyword 실패 [${tx.apt_name}]: ${(e as Error).message}`);
  }
  await sleep(150);

  // 3) 지번 주소 fallback
  if (tx.jibun) {
    const q3 = [sido, tx.sigungu, tx.jibun].filter(Boolean).join(" ");
    try {
      const doc = await kakaoAddress(q3);
      if (doc) return docToGeo(doc, tx, "kakao:address:jibun");
    } catch (e) {
      console.warn(`  address 실패 [${tx.apt_name}]: ${(e as Error).message}`);
    }
  }
  return null;
}

function docToGeo(doc: KakaoDoc, tx: TxRecord, source: string): GeoRecord {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const road = doc.road_address?.address_name ?? doc.road_address_name ?? null;
  return {
    name: tx.apt_name,
    sigungu: tx.sigungu,
    road_address: road,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    built_year: tx.build_year,
    source,
  };
}

// ─── Cache helpers ────────────────────────────────────────────────────────
interface CacheEntry { name: string; sigungu: string; result: GeoRecord | null }

async function loadCache(file: string): Promise<Map<string, GeoRecord | null>> {
  const m = new Map<string, GeoRecord | null>();
  try { await access(file); } catch { return m; }
  const text = await readFile(file, "utf-8");
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

async function appendLine(file: string, line: string): Promise<void> {
  await writeFile(file, line + "\n", { encoding: "utf-8", flag: "a" });
}

// ─── Haversine ────────────────────────────────────────────────────────────
function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ─── Main pipeline ────────────────────────────────────────────────────────
async function main() {
  const missing: string[] = [];
  if (!PUBLIC_KEY) missing.push("PUBLIC_DATA_API_KEY");
  if (!KAKAO_KEY) missing.push("KAKAO_REST_API_KEY");
  if (!SUPA_URL) missing.push("SUPABASE_URL");
  if (!SUPA_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    console.error(`[run-realestate-mvp] env 누락: ${missing.join(", ")}`);
    process.exit(1);
  }

  await mkdir(REAL_DIR, { recursive: true });

  // ─── STEP 1: MOLIT fetch ────────────────────────────────────────────────
  console.log(`\n[1/5] MOLIT fetch — ${LAWD_CODES.length}구 × ${MONTHS.length}개월 = ${LAWD_CODES.length * MONTHS.length} call`);
  await writeFile(TX_OUT, "", "utf-8");
  const allTx: TxRecord[] = [];
  let callIdx = 0;
  for (const lawd of LAWD_CODES) {
    for (const ym of MONTHS) {
      callIdx++;
      const recs = await fetchMonth(lawd.code, ym);
      allTx.push(...recs);
      for (const r of recs) await appendLine(TX_OUT, JSON.stringify(r));
      console.log(`  [${callIdx}/${LAWD_CODES.length * MONTHS.length}] ${lawd.name}(${lawd.code}) ${ym}: ${recs.length}건 (누적 ${allTx.length})`);
      await sleep(200);
    }
  }
  console.log(`  → 총 ${allTx.length}건 거래 → ${TX_OUT}`);

  if (allTx.length === 0) {
    console.error("거래 0건 — API key 또는 응답 형식 점검 필요");
    process.exit(1);
  }

  // ─── STEP 2: Kakao geocoding (unique 단지만) ────────────────────────────
  console.log(`\n[2/5] Kakao 지오코딩 — unique 단지 추출`);
  const uniq = new Map<string, TxRecord>();
  for (const tx of allTx) {
    if (!tx.apt_name) continue;
    const key = `${tx.apt_name}||${tx.sigungu}`;
    if (!uniq.has(key)) {
      uniq.set(key, tx);
    } else {
      const ex = uniq.get(key)!;
      if (!ex.build_year && tx.build_year) ex.build_year = tx.build_year;
      if (!ex.road_name && tx.road_name) ex.road_name = tx.road_name;
      if (!ex.jibun && tx.jibun) ex.jibun = tx.jibun;
    }
  }
  console.log(`  unique 단지: ${uniq.size}`);

  const cache = await loadCache(GEO_CACHE);
  console.log(`  cache: ${cache.size}건 로드`);
  await writeFile(GEO_OUT, "", "utf-8");

  let okCount = 0, failCount = 0, cacheHit = 0, idx = 0;
  const geocoded: GeoRecord[] = [];
  for (const tx of uniq.values()) {
    idx++;
    const key = `${tx.apt_name}||${tx.sigungu}`;
    let result: GeoRecord | null;
    if (cache.has(key)) {
      result = cache.get(key) ?? null;
      cacheHit++;
    } else {
      try {
        result = await geocodeOne(tx);
      } catch (e) {
        console.warn(`  [${idx}/${uniq.size}] ${tx.apt_name}: ${(e as Error).message}`);
        result = null;
      }
      await appendLine(GEO_CACHE, JSON.stringify({ name: tx.apt_name, sigungu: tx.sigungu, result } satisfies CacheEntry));
      await sleep(200);
    }
    if (result && result.lat != null && result.lng != null) {
      geocoded.push(result);
      await appendLine(GEO_OUT, JSON.stringify(result));
      okCount++;
    } else {
      failCount++;
    }
    if (idx % 25 === 0) console.log(`  [${idx}/${uniq.size}] ok=${okCount} fail=${failCount} cache=${cacheHit}`);
  }
  console.log(`  → 지오코딩 OK=${okCount} FAIL=${failCount} CACHE=${cacheHit}`);

  // ─── STEP 3: Supabase apartments upsert ─────────────────────────────────
  console.log(`\n[3/5] Supabase apartments upsert`);
  const sb = createClient(SUPA_URL!, SUPA_KEY!, { auth: { persistSession: false } });

  // 기존 apartments 조회 (중복 제거)
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

  const aptRows = geocoded.map((g) => ({
    name: g.name,
    sigungu: g.sigungu || null,
    road_address: g.road_address,
    lat: g.lat,
    lng: g.lng,
    built_year: g.built_year,
    households: null,
    source: g.source,
  }));
  const seenKey = new Set<string>();
  const dedupedApt = aptRows.filter((r) => {
    const k = `${r.name}||${r.sigungu ?? ""}`;
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });
  const toInsert = dedupedApt.filter((r) => !existing.has(`${r.name}||${r.sigungu ?? ""}`));
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

  // ─── STEP 4: transactions insert ────────────────────────────────────────
  console.log(`\n[4/5] Supabase transactions truncate-and-insert`);
  const txRows: Array<{
    apt_id: number;
    area_m2: number | null;
    price_won: number | null;
    contract_date: string;
    floor: number | null;
    source: string;
  }> = [];
  let unmatched = 0;
  for (const t of allTx) {
    const aptId = aptIdByKey.get(`${t.apt_name}||${t.sigungu}`);
    if (aptId == null) { unmatched++; continue; }
    txRows.push({
      apt_id: aptId,
      area_m2: t.area_m2,
      price_won: t.price_man_won != null ? Math.round(t.price_man_won * 10000) : null,
      contract_date: t.deal_day,
      floor: t.floor,
      source: "molit",
    });
  }
  console.log(`  매칭됨: ${txRows.length}, 미매칭(좌표 없음): ${unmatched}`);

  console.log(`  기존 transactions 삭제 (전체)...`);
  const { error: delErr } = await sb.from("transactions").delete().gte("contract_date", "1900-01-01");
  if (delErr) console.warn(`  delete 실패 (계속): ${delErr.message}`);

  for (let i = 0; i < txRows.length; i += CHUNK) {
    const chunk = txRows.slice(i, i + CHUNK);
    const { error } = await sb.from("transactions").insert(chunk);
    if (error) throw new Error(`transactions insert (${i}): ${error.message}`);
    console.log(`  transactions insert ${Math.min(i + chunk.length, txRows.length)}/${txRows.length}`);
  }

  // ─── STEP 5: apartment_school_map (반경 1km, 중학교만) ──────────────────
  console.log(`\n[5/5] apartment_school_map upsert (반경 1km, 중학교)`);
  const schools: Array<{ shl_idf_cd: string; lat: number | null; lng: number | null }> = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from("schools")
      .select("shl_idf_cd,lat,lng,kind")
      .eq("kind", "중학교")
      .range(off, off + PAGE - 1);
    if (error) throw new Error(`schools select: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const s of data as Array<{ shl_idf_cd: string; lat: number | null; lng: number | null; kind: string }>) {
      schools.push({ shl_idf_cd: s.shl_idf_cd, lat: s.lat, lng: s.lng });
    }
    if (data.length < PAGE) break;
  }
  const midsWithGeo = schools.filter((s) => s.lat != null && s.lng != null);
  console.log(`  중학교 (좌표 보유): ${midsWithGeo.length}`);

  // apartments 좌표 모두 (방금 insert + 기존)
  const apts: Array<{ id: number; lat: number | null; lng: number | null; name: string; sigungu: string | null }> = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from("apartments").select("id,name,sigungu,lat,lng").range(off, off + PAGE - 1);
    if (error) throw new Error(`apartments select(map): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: number; name: string; sigungu: string | null; lat: number | null; lng: number | null }>) {
      apts.push(r);
    }
    if (data.length < PAGE) break;
  }
  const aptsWithGeo = apts.filter((a) => a.lat != null && a.lng != null);
  console.log(`  apartments (좌표 보유): ${aptsWithGeo.length}`);

  const radiusM = 1000;
  const mapRows: Array<{
    apt_id: number;
    shl_idf_cd: string;
    distance_m: number;
    in_district: boolean;
    source: string;
  }> = [];
  for (const a of aptsWithGeo) {
    for (const s of midsWithGeo) {
      const d = distMeters({ lat: a.lat!, lng: a.lng! }, { lat: s.lat!, lng: s.lng! });
      if (d <= radiusM) {
        mapRows.push({ apt_id: a.id, shl_idf_cd: s.shl_idf_cd, distance_m: Math.round(d), in_district: false, source: "radius:1km" });
      }
    }
  }
  // (apt_id, shl_idf_cd) 중복 제거 — 같은 pair가 chunk 내에 있으면 ON CONFLICT DO UPDATE가 충돌
  const asmSeen = new Set<string>();
  const mapRowsDedup = mapRows.filter((r) => {
    const k = `${r.apt_id}||${r.shl_idf_cd}`;
    if (asmSeen.has(k)) return false;
    asmSeen.add(k);
    return true;
  });
  console.log(`  매핑 결과: ${mapRowsDedup.length}건 (중복 제거 전 ${mapRows.length}건)`);

  // 기존 apartment_school_map 전체 삭제 후 재삽입 (upsert 충돌 회피)
  console.log(`  기존 apartment_school_map 삭제...`);
  const { error: asmDelErr } = await sb.from("apartment_school_map").delete().gte("distance_m", 0);
  if (asmDelErr) {
    // distance_m이 null인 row 도 있을 수 있으니 or 조건 추가 시도
    console.warn(`  asm delete (distance_m>=0): ${asmDelErr.message} — or 조건으로 재시도`);
    const { error: asmDelErr2 } = await sb.from("apartment_school_map").delete().neq("apt_id", -1);
    if (asmDelErr2) console.warn(`  asm delete 실패 (계속): ${asmDelErr2.message}`);
  }

  for (let i = 0; i < mapRowsDedup.length; i += CHUNK) {
    const chunk = mapRowsDedup.slice(i, i + CHUNK);
    const { error } = await sb.from("apartment_school_map").insert(chunk);
    if (error) throw new Error(`apartment_school_map insert (${i}): ${error.message}`);
    console.log(`  asm insert ${Math.min(i + chunk.length, mapRowsDedup.length)}/${mapRowsDedup.length}`);
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log(`\nOK 완료`);
  console.log(`  transactions(MOLIT): ${allTx.length}건`);
  console.log(`  unique 단지: ${uniq.size}건 (geocode OK ${okCount})`);
  console.log(`  apartments 신규 insert: ${toInsert.length}건`);
  console.log(`  transactions inserted: ${txRows.length}건`);
  console.log(`  apartment_school_map: ${mapRowsDedup.length}건`);
}

main().catch((err) => { console.error("실패:", err); process.exit(1); });
