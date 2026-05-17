/**
 * 전월세 MVP 통합 파이프라인 (7구 × 3개월 = 21 API call).
 *
 * 1) 국토부 RTMSDataSvcAptRent fetch (전월세 — deposit + monthlyRent)
 * 2) 기존 apartments 매칭 (name + sigungu). 미매칭만 카카오 지오코딩 후 apartments 추가
 *    (matching 우선 — run-realestate-mvp가 먼저 돌아서 거의 모두 hit하는 게 정상)
 * 3) Supabase rentals truncate-and-insert
 *
 * 매매(run-realestate-mvp)와 동일한 7구·3개월 범위. apartment_school_map은 이미 매매 단계에서 생성됨.
 *
 * 환경:
 *   PUBLIC_DATA_API_KEY  — data.go.kr
 *   KAKAO_REST_API_KEY   — kakao local (미매칭 단지에만 사용)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  — RLS bypass
 *
 * 사용:
 *   tsx scripts/run-rentals-mvp.ts
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// .env.local 자동 로드 (의존성 없는 단순 파서)
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
const MOLIT_ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent";

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
const RENT_OUT = path.join(REAL_DIR, "apt-rentals.jsonl");
const GEO_CACHE = path.join(REAL_DIR, "apartments-geocoded.cache.jsonl");

interface RentRecord {
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

function toRentRecord(raw: Record<string, string>, lawdCd: string, dealYm: string): RentRecord | null {
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
    deposit_man_won: toNumber(raw.deposit),
    monthly_rent_man_won: toNumber(raw.monthlyRent),
    floor: toNumber(raw.floor),
    build_year: toNumber(raw.buildYear),
    deal_day: dealDay,
  };
}

async function fetchMonth(lawdCd: string, dealYm: string): Promise<RentRecord[]> {
  const out: RentRecord[] = [];
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
    if (!res.ok) throw new Error(`molit-rent ${res.status}`);
    const xml = await res.text();
    const meta = parseXmlMeta(xml);
    if (meta.resultCode && meta.resultCode !== "00" && meta.resultCode !== "000") {
      console.warn(`  [${lawdCd}/${dealYm}] result=${meta.resultCode} ${meta.resultMsg ?? ""}`);
      break;
    }
    const items = parseXmlItems(xml);
    for (const raw of items) {
      const rec = toRentRecord(raw, lawdCd, dealYm);
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

// ─── 카카오 지오코딩 (미매칭 단지만 — fallback) ──────────────────────────
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

async function geocodeOne(r: RentRecord): Promise<GeoRecord | null> {
  const sido = lawdToSido(r.lawd_cd);
  if (r.road_name) {
    const q = [sido, r.sigungu, r.road_name, r.apt_name].filter(Boolean).join(" ");
    try {
      const doc = await kakaoKeyword(q);
      if (doc) return docToGeo(doc, r, "kakao:keyword:road");
    } catch (e) {
      console.warn(`  keyword(road) 실패 [${r.apt_name}]: ${(e as Error).message}`);
    }
    await sleep(150);
  }
  const q2 = [sido, r.sigungu, r.apt_name].filter(Boolean).join(" ");
  try {
    const doc = await kakaoKeyword(q2);
    if (doc) return docToGeo(doc, r, "kakao:keyword");
  } catch (e) {
    console.warn(`  keyword 실패 [${r.apt_name}]: ${(e as Error).message}`);
  }
  await sleep(150);
  if (r.jibun) {
    const q3 = [sido, r.sigungu, r.jibun].filter(Boolean).join(" ");
    try {
      const doc = await kakaoAddress(q3);
      if (doc) return docToGeo(doc, r, "kakao:address:jibun");
    } catch (e) {
      console.warn(`  address 실패 [${r.apt_name}]: ${(e as Error).message}`);
    }
  }
  return null;
}

function docToGeo(doc: KakaoDoc, r: RentRecord, source: string): GeoRecord {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const road = doc.road_address?.address_name ?? doc.road_address_name ?? null;
  return {
    name: r.apt_name,
    sigungu: r.sigungu,
    road_address: road,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    built_year: r.build_year,
    source,
  };
}

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

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const missing: string[] = [];
  if (!PUBLIC_KEY) missing.push("PUBLIC_DATA_API_KEY");
  if (!KAKAO_KEY) missing.push("KAKAO_REST_API_KEY");
  if (!SUPA_URL) missing.push("SUPABASE_URL");
  if (!SUPA_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    console.error(`[run-rentals-mvp] env 누락: ${missing.join(", ")}`);
    process.exit(1);
  }

  await mkdir(REAL_DIR, { recursive: true });

  // ─── STEP 1: MOLIT rent fetch ──────────────────────────────────────────
  console.log(`\n[1/4] MOLIT 전월세 fetch — ${LAWD_CODES.length}구 × ${MONTHS.length}개월 = ${LAWD_CODES.length * MONTHS.length} call`);
  await writeFile(RENT_OUT, "", "utf-8");
  const allRent: RentRecord[] = [];
  let callIdx = 0;
  for (const lawd of LAWD_CODES) {
    for (const ym of MONTHS) {
      callIdx++;
      const recs = await fetchMonth(lawd.code, ym);
      allRent.push(...recs);
      for (const r of recs) await appendLine(RENT_OUT, JSON.stringify(r));
      console.log(`  [${callIdx}/${LAWD_CODES.length * MONTHS.length}] ${lawd.name}(${lawd.code}) ${ym}: ${recs.length}건 (누적 ${allRent.length})`);
      await sleep(200);
    }
  }
  console.log(`  → 총 ${allRent.length}건 전월세 → ${RENT_OUT}`);

  if (allRent.length === 0) {
    console.error("전월세 0건 — API key 또는 응답 형식 점검 필요");
    process.exit(1);
  }

  // ─── STEP 2: 기존 apartments 매칭 (name + sigungu) ──────────────────────
  console.log(`\n[2/4] Supabase apartments 매칭`);
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

  // 매칭 안 되는 단지 추출
  const uniqUnmatched = new Map<string, RentRecord>();
  for (const r of allRent) {
    const key = `${r.apt_name}||${r.sigungu}`;
    if (existing.has(key)) continue;
    if (!uniqUnmatched.has(key)) {
      uniqUnmatched.set(key, r);
    } else {
      const ex = uniqUnmatched.get(key)!;
      if (!ex.build_year && r.build_year) ex.build_year = r.build_year;
      if (!ex.road_name && r.road_name) ex.road_name = r.road_name;
      if (!ex.jibun && r.jibun) ex.jibun = r.jibun;
    }
  }
  console.log(`  미매칭 unique 단지: ${uniqUnmatched.size} (매매에서 누락된 임대 전용 단지 후보)`);

  // ─── STEP 3: 미매칭 단지 카카오 지오코딩 + apartments 추가 ─────────────
  const cache = await loadCache(GEO_CACHE);
  console.log(`  cache: ${cache.size}건 로드`);
  let okCount = 0, failCount = 0, cacheHit = 0, idx = 0;
  const geocoded: GeoRecord[] = [];
  for (const r of uniqUnmatched.values()) {
    idx++;
    const key = `${r.apt_name}||${r.sigungu}`;
    let result: GeoRecord | null;
    if (cache.has(key)) {
      result = cache.get(key) ?? null;
      cacheHit++;
    } else {
      try {
        result = await geocodeOne(r);
      } catch (e) {
        console.warn(`  [${idx}/${uniqUnmatched.size}] ${r.apt_name}: ${(e as Error).message}`);
        result = null;
      }
      await appendLine(GEO_CACHE, JSON.stringify({ name: r.apt_name, sigungu: r.sigungu, result } satisfies CacheEntry));
      await sleep(200);
    }
    if (result && result.lat != null && result.lng != null) {
      geocoded.push(result);
      okCount++;
    } else {
      failCount++;
    }
    if (idx % 25 === 0) console.log(`  [${idx}/${uniqUnmatched.size}] ok=${okCount} fail=${failCount} cache=${cacheHit}`);
  }
  console.log(`  → 미매칭 지오코딩 OK=${okCount} FAIL=${failCount} CACHE=${cacheHit}`);

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
  console.log(`  apartments 신규 insert: ${dedupedApt.length}건`);

  const aptIdByKey = new Map<string, number>(existing);
  const CHUNK = 500;
  for (let i = 0; i < dedupedApt.length; i += CHUNK) {
    const chunk = dedupedApt.slice(i, i + CHUNK);
    const { data, error } = await sb.from("apartments").insert(chunk).select("id,name,sigungu");
    if (error) throw new Error(`apartments insert: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: number; name: string; sigungu: string | null }>) {
      aptIdByKey.set(`${r.name}||${r.sigungu ?? ""}`, r.id);
    }
    console.log(`  apartments insert ${Math.min(i + chunk.length, dedupedApt.length)}/${dedupedApt.length}`);
  }

  // ─── STEP 4: rentals truncate-and-insert ────────────────────────────────
  console.log(`\n[3/4] Supabase rentals truncate-and-insert`);
  const rentRows: Array<{
    apt_id: number;
    area_m2: number | null;
    deposit_man_won: number | null;
    monthly_rent_man_won: number | null;
    contract_date: string;
    floor: number | null;
    source: string;
  }> = [];
  let unmatched = 0;
  for (const r of allRent) {
    const aptId = aptIdByKey.get(`${r.apt_name}||${r.sigungu}`);
    if (aptId == null) { unmatched++; continue; }
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
  console.log(`  매칭됨: ${rentRows.length}, 미매칭(좌표 없음): ${unmatched}`);

  console.log(`  기존 rentals 삭제 (전체)...`);
  const { error: delErr } = await sb.from("rentals").delete().gte("contract_date", "1900-01-01");
  if (delErr) console.warn(`  delete 실패 (계속): ${delErr.message}`);

  for (let i = 0; i < rentRows.length; i += CHUNK) {
    const chunk = rentRows.slice(i, i + CHUNK);
    const { error } = await sb.from("rentals").insert(chunk);
    if (error) throw new Error(`rentals insert (${i}): ${error.message}`);
    console.log(`  rentals insert ${Math.min(i + chunk.length, rentRows.length)}/${rentRows.length}`);
  }

  // ─── STEP 5: apartment_school_map 보강 (신규 단지 좌표 매핑) ───────────
  console.log(`\n[4/4] apartment_school_map 보강 (신규 단지만, 반경 1km, 중학교)`);
  if (dedupedApt.length === 0) {
    console.log(`  신규 단지 0 — skip`);
  } else {
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

    // 신규 apt만 select (방금 insert된 것들)
    const newKeys = new Set(dedupedApt.map((r) => `${r.name}||${r.sigungu ?? ""}`));
    const newApts: Array<{ id: number; lat: number | null; lng: number | null }> = [];
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await sb.from("apartments").select("id,name,sigungu,lat,lng").range(off, off + PAGE - 1);
      if (error) throw new Error(`apartments select(map): ${error.message}`);
      if (!data || data.length === 0) break;
      for (const r of data as Array<{ id: number; name: string; sigungu: string | null; lat: number | null; lng: number | null }>) {
        if (newKeys.has(`${r.name}||${r.sigungu ?? ""}`) && r.lat != null && r.lng != null) {
          newApts.push({ id: r.id, lat: r.lat, lng: r.lng });
        }
      }
      if (data.length < PAGE) break;
    }
    console.log(`  신규 apartments (좌표): ${newApts.length}, 중학교: ${midsWithGeo.length}`);

    const radiusM = 1000;
    const newMap: Array<{ apt_id: number; shl_idf_cd: string; distance_m: number; in_district: boolean; source: string }> = [];
    for (const a of newApts) {
      for (const s of midsWithGeo) {
        const d = distMeters({ lat: a.lat!, lng: a.lng! }, { lat: s.lat!, lng: s.lng! });
        if (d <= radiusM) {
          newMap.push({ apt_id: a.id, shl_idf_cd: s.shl_idf_cd, distance_m: Math.round(d), in_district: false, source: "radius:1km" });
        }
      }
    }
    const seenMap = new Set<string>();
    const dedupedMap = newMap.filter((r) => {
      const k = `${r.apt_id}||${r.shl_idf_cd}`;
      if (seenMap.has(k)) return false;
      seenMap.add(k);
      return true;
    });
    console.log(`  신규 매핑: ${dedupedMap.length}건`);
    for (let i = 0; i < dedupedMap.length; i += CHUNK) {
      const chunk = dedupedMap.slice(i, i + CHUNK);
      const { error } = await sb.from("apartment_school_map").upsert(chunk, { onConflict: "apt_id,shl_idf_cd" });
      if (error) throw new Error(`apartment_school_map upsert (${i}): ${error.message}`);
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log(`\nOK 완료`);
  console.log(`  rentals(MOLIT): ${allRent.length}건`);
  console.log(`  미매칭 unique 단지: ${uniqUnmatched.size}건 (geocode OK ${okCount})`);
  console.log(`  apartments 신규 insert: ${dedupedApt.length}건`);
  console.log(`  rentals inserted: ${rentRows.length}건`);
}

function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

main().catch((err) => { console.error("실패:", err); process.exit(1); });
