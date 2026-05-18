/**
 * 네이버 부동산 단지 ID 매핑 batch v2 — 좌표 기반.
 *
 * ── v1 vs v2 ─────────────────────────────────────────────────────────────────
 * v1: new.land 검색 API + fuzzy 매칭 (단지명만)
 *     → "동아", "신반포4" 같은 짧고 일반적 이름에서 매칭 실패 54% (rate-limit도 잦음)
 * v2: m.land cortarNo (법정동) 단위 단지 list 한꺼번에 fetch + 좌표 거리 + fuzzy
 *     → 동 단위로 후보 좁히고 좌표(우리 = kakao geocode, naver = list 자체 좌표)로 best match
 *     → 짧은 이름도 정확 매칭 가능
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 * 1) https://m.land.naver.com/map/getRegionList?cortarNo=<상위>
 *      → 하위 지역 list. 최상위는 cortarNo=0000000000 (전국 시도)
 *      → 단계: 전국 → 시도 → 시군구 → 읍면동
 * 2) https://m.land.naver.com/complex/ajax/complexListByCortarNo?cortarNo=<읍면동>&realEstateType=APT
 *      → 동에 속한 단지 list. 응답 항목: { hscpNo, hscpNm, lat, lng, cortarNo, ... }
 *
 * ── 매칭 ─────────────────────────────────────────────────────────────────────
 * apartments.sigungu (예: "서초구 잠원동", "잠원동") → dong cortarNo로 변환
 *   - sigungu 형식이 다양하므로 (전체/일부) "동" 토큰 추출 + 시군구·시도 추정
 * 각 apt에 대해, 그 dong의 단지 list에서 다음 score 합산으로 best match:
 *   - 이름 fuzzy (levenshtein 기반) × 0.6
 *   - 좌표 거리 < 200m → 0.4, < 500m → 0.2, < 1000m → 0.1, else 0
 *   - 합계 >= 0.6 이면 매칭
 *
 * ── 출력 ─────────────────────────────────────────────────────────────────────
 * ~/hakgun-data/naver-complex-mapping.jsonl
 *   { apt_id, our_name, sigungu, naver_id, naver_name, score, distance_m, status }
 *
 * ── 환경변수 ─────────────────────────────────────────────────────────────────
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   HAKGUN_DATA_DIR (기본 ~/hakgun-data)
 *
 * ── 사용 ─────────────────────────────────────────────────────────────────────
 *   tsx scripts/naver-complex-mapping-v2.ts              # 전체
 *   tsx scripts/naver-complex-mapping-v2.ts --limit 100  # 테스트
 *   tsx scripts/naver-complex-mapping-v2.ts --resume     # 이어서 (실패한 것만 재시도)
 *   tsx scripts/naver-complex-mapping-v2.ts --workers 8  # cortarNo 동 fetch worker 수
 */
import { mkdir, writeFile, appendFile, readFile, access } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ─── .env.local 자동 로드 ──────────────────────────────────────────────
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = process.env.HAKGUN_DATA_DIR ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");
const OUTFILE = path.join(DATA_DIR, "naver-complex-mapping.jsonl");
const REGION_CACHE = path.join(DATA_DIR, "naver-region-tree.json");
const COMPLEX_CACHE = path.join(DATA_DIR, "naver-complex-by-dong.jsonl");

const NAVER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://m.land.naver.com/",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
};

// 매칭 threshold (이름 score × 0.6 + 거리 score × 0.4 의 합)
const COMBINED_THRESHOLD = 0.6;
// 좌표만 매우 가까운 경우 fast-path
const NEAR_DISTANCE_M = 80;     // 80m 이내 → 좌표 단독으로 매칭 인정
const NAME_THRESHOLD_NEAR = 0.5; // 80m 이내일 때는 이름 score 0.5 면 OK

function parseArgs() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let resume = false;
  let workers = 1; // 호출은 직렬 큐로 강제 — workers는 결과 처리 병렬성
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit") limit = parseInt(args[++i], 10);
    else if (a === "--resume") resume = true;
    else if (a === "--workers") workers = parseInt(args[++i], 10);
  }
  return { limit, resume, workers };
}

interface AptRow {
  id: number;
  name: string;
  sigungu: string | null;
  lat: number | null;
  lng: number | null;
}

interface NaverComplex {
  hscpNo: string;
  hscpNm: string;
  lat: string;
  lng: string;
  cortarNo: string;
}

interface MappingResult {
  apt_id: number;
  our_name: string;
  sigungu: string | null;
  naver_id: number | null;
  naver_name: string | null;
  cortar_no: string | null;
  name_score: number;
  distance_m: number | null;
  combined_score: number;
  status: "ok" | "ok_near" | "ok_variant" | "not_found" | "no_dong" | "error";
  error?: string;
}

interface RegionNode {
  CortarNo: string;
  CortarNm: string;
  MapXCrdn: string;
  MapYCrdn: string;
  CortarType: string;
}

// ─── 정규화 / fuzzy ────────────────────────────────────────────────────
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_·]/g, "").replace(/[^\w가-힣]/g, "");
}

// 단지명 비교용 추가 정규화: "아파트", "단지", "차", "동" 접미사 제거
function normalizeForMatch(s: string): string {
  let n = normalize(s);
  // 영문 빌더명 한글화
  const map: Array<[RegExp, string]> = [
    [/lg/gi, "엘지"], [/gs/gi, "지에스"], [/sk/gi, "에스케이"],
    [/xi/gi, "자이"], [/raemian/gi, "래미안"],
    [/hillstate/gi, "힐스테이트"], [/ipark/gi, "아이파크"],
    [/prugio/gi, "푸르지오"], [/thesharp/gi, "더샵"],
    [/lottecastle/gi, "롯데캐슬"], [/castle/gi, "캐슬"],
  ];
  for (const [re, v] of map) n = n.replace(re, v);
  // 흔한 접미/접두 제거
  n = n.replace(/아파트$/, "").replace(/단지$/, "");
  // "N차" ↔ "N단지" 양식은 그대로 두되, "(A)" 등 괄호 제거는 normalize 단계에서 처리됨
  return n;
}

function levenshtein(a: string, b: string): number {
  const la = a.length, lb = b.length;
  const dp: number[] = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[lb];
}

function nameScore(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.length >= 2 && nb.length >= 2) {
    if (na.includes(nb) || nb.includes(na)) {
      const shorter = Math.min(na.length, nb.length);
      const longer = Math.max(na.length, nb.length);
      // 포함 관계 — 길이 비율이 비슷할수록 score 높음
      return 0.7 + 0.25 * (shorter / longer);
    }
  }
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

// haversine 거리 (m)
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function distanceScore(m: number | null): number {
  if (m == null) return 0;
  if (m < 50) return 1.0;
  if (m < 150) return 0.85;
  if (m < 300) return 0.7;
  if (m < 600) return 0.5;
  if (m < 1500) return 0.2;
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(): number {
  return 400 + Math.floor(Math.random() * 600); // 400~1000ms
}

// ─── 네이버 API ────────────────────────────────────────────────────────
// abuse 감지 시 long backoff 후 재시도. 모든 호출이 직렬 큐 통과 → IP burst 방지.

let lastAbuseAt = 0;
const ABUSE_COOLDOWN_MS = 180_000; // abuse 감지 시 3분 정지 후 재시도
let cookieJar = ""; // Naver REALESTATE cookie

async function ensureCookie(): Promise<void> {
  if (cookieJar) return;
  try {
    const res = await fetch("https://m.land.naver.com/", {
      headers: { "User-Agent": NAVER_HEADERS["User-Agent"] },
      redirect: "manual",
    });
    const sc = res.headers.get("set-cookie");
    if (sc) {
      // 첫 cookie value만 추출
      const m = sc.match(/REALESTATE=([^;]+)/);
      if (m) cookieJar = `REALESTATE=${m[1]}`;
    }
  } catch { /* ignore */ }
}

// 직렬 호출 큐 — IP burst 방지
let inFlight: Promise<unknown> = Promise.resolve();
function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = inFlight.then(fn, fn);
  inFlight = next.catch(() => undefined);
  return next;
}

async function fetchJson<T = unknown>(url: string, retries = 4): Promise<T | null> {
  return withQueue(async () => {
    await ensureCookie();
    for (let attempt = 0; attempt <= retries; attempt++) {
      // abuse 직후라면 cooldown
      const since = Date.now() - lastAbuseAt;
      if (lastAbuseAt > 0 && since < ABUSE_COOLDOWN_MS) {
        await sleep(ABUSE_COOLDOWN_MS - since);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const headers: Record<string, string> = { ...NAVER_HEADERS };
        if (cookieJar) headers["Cookie"] = cookieJar;
        const res = await fetch(url, {
          headers,
          signal: controller.signal,
          redirect: "manual",
        });
        clearTimeout(timer);

        if (res.status === 302 || res.status === 307) {
          const loc = res.headers.get("location") ?? "";
          if (loc.includes("/error/abuse") || loc.includes("abuse")) {
            lastAbuseAt = Date.now();
            console.warn(`[abuse] ${url} → ${loc} (cooldown ${ABUSE_COOLDOWN_MS / 1000}s)`);
            await sleep(ABUSE_COOLDOWN_MS);
            continue;
          }
          // 다른 redirect는 404 처리
          return null;
        }
        if (res.status === 429) {
          await sleep(5000 * (attempt + 1));
          continue;
        }
        if (!res.ok) return null;
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("json")) return null;
        const j = await res.json() as T;
        await sleep(jitter()); // 호출 사이 jitter (직렬 큐 안에서)
        return j;
      } catch {
        clearTimeout(timer);
        if (attempt === retries) return null;
        await sleep(2000 * (attempt + 1));
      }
    }
    return null;
  });
}

async function getRegionList(cortarNo: string): Promise<RegionNode[]> {
  const url = `https://m.land.naver.com/map/getRegionList?cortarNo=${cortarNo}`;
  const j = await fetchJson<{ result?: { list?: RegionNode[] } }>(url);
  return j?.result?.list ?? [];
}

async function getComplexListByDong(cortarNo: string): Promise<NaverComplex[]> {
  const url = `https://m.land.naver.com/complex/ajax/complexListByCortarNo?cortarNo=${cortarNo}&realEstateType=APT:ABYG:JGC`;
  const j = await fetchJson<{ result?: NaverComplex[] }>(url);
  return j?.result ?? [];
}

// ─── 지역 트리 빌드 (전국 → 시도 → 시군구 → 동) ───────────────────────
interface RegionTree {
  // dongName ("잠원동") → [{cortarNo, sigunguName ("서초구"), sidoName ("서울시"), lat, lng}, ...]
  byDong: Record<string, Array<{ cortarNo: string; sigungu: string; sido: string; lat: number; lng: number }>>;
  // 직접 검색용: "서울시 서초구 잠원동" → cortarNo
  byFullName: Record<string, string>;
}

async function buildRegionTree(): Promise<RegionTree> {
  let tree: RegionTree = { byDong: {}, byFullName: {} };
  if (existsSync(REGION_CACHE)) {
    try {
      const cached = JSON.parse(readFileSync(REGION_CACHE, "utf-8")) as RegionTree;
      if (cached.byDong && cached.byFullName) tree = cached;
    } catch { /* ignore */ }
  }

  console.log("[region-tree] 빌드/보강 (전국 동단위 cortarNo)...");
  const sidoList = await getRegionList("0000000000");
  console.log(`  sido: ${sidoList.length}개`);
  if (sidoList.length === 0) {
    // abuse 등 — 캐시만 사용
    console.warn("[region-tree] sido fetch 실패. 캐시만 사용.");
    return tree;
  }

  // 캐시 안에 이미 그 sido의 dong이 1개라도 있으면 스킵 (보강 시 시간 절약)
  const sidoCovered = new Set<string>();
  for (const candList of Object.values(tree.byDong)) {
    for (const c of candList) sidoCovered.add(c.sido);
  }

  for (const sido of sidoList) {
    if (sidoCovered.has(sido.CortarNm)) {
      console.log(`  ${sido.CortarNm}: 캐시 있음 (skip)`);
      continue;
    }
    const sigunguList = await getRegionList(sido.CortarNo);
    if (sigunguList.length === 0) {
      console.warn(`  ${sido.CortarNm}: sigungu fetch 실패 → skip`);
      continue;
    }
    for (const sg of sigunguList) {
      const dongList = await getRegionList(sg.CortarNo);
      for (const d of dongList) {
        const dongName = d.CortarNm;
        const lat = parseFloat(d.MapYCrdn);
        const lng = parseFloat(d.MapXCrdn);
        if (!tree.byDong[dongName]) tree.byDong[dongName] = [];
        tree.byDong[dongName].push({
          cortarNo: d.CortarNo,
          sigungu: sg.CortarNm,
          sido: sido.CortarNm,
          lat,
          lng,
        });
        tree.byFullName[`${sido.CortarNm} ${sg.CortarNm} ${dongName}`] = d.CortarNo;
        tree.byFullName[`${sg.CortarNm} ${dongName}`] = d.CortarNo;
      }
    }
    console.log(`  ${sido.CortarNm}: ${sigunguList.length} 시군구 처리`);
    // 중간 저장
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(REGION_CACHE, JSON.stringify(tree));
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(REGION_CACHE, JSON.stringify(tree));
  console.log(`[region-tree] 저장: dongs=${Object.keys(tree.byDong).length}`);
  return tree;
}

// ─── apartments.sigungu → dong cortarNo 매핑 ───────────────────────────
/**
 * sigungu 형태 다양함:
 *  - "서초구 잠원동"
 *  - "잠원동"
 *  - "서울특별시 서초구 잠원동"
 *  - "경기도 수원시 영통구 망포동"
 *  - 또는 lat/lng로 가까운 동 찾기
 */
function findDongCortar(
  apt: AptRow,
  tree: RegionTree,
): { cortarNo: string; sigungu: string; sido: string } | null {
  if (!apt.sigungu) {
    if (apt.lat == null || apt.lng == null) return null;
    return nearestDongByCoord(apt.lat, apt.lng, tree);
  }
  const s = apt.sigungu.trim();
  // 1) 완전 일치 시도
  if (tree.byFullName[s]) {
    const cortar = tree.byFullName[s];
    return resolveCortar(cortar, tree);
  }
  // 2) sigungu 안에서 "동/읍/면" 토큰 추출
  const tokens = s.split(/\s+/);
  // 마지막 토큰이 동/읍/면일 가능성 높음
  const last = tokens[tokens.length - 1];
  if (last && /(동|읍|면|가)$/.test(last)) {
    const candidates = tree.byDong[last];
    if (candidates && candidates.length > 0) {
      // sigungu 안에 후보 sigungu/sido 명이 있으면 그걸로 좁힘
      const filtered = candidates.filter((c) => {
        return s.includes(c.sigungu) || (c.sigungu && tokens.includes(c.sigungu));
      });
      const cands = filtered.length > 0 ? filtered : candidates;
      if (cands.length === 1) return cands[0];
      // 여러 후보 — apt 좌표로 가장 가까운 것
      if (apt.lat != null && apt.lng != null) {
        let best = cands[0];
        let bestD = distanceM(apt.lat, apt.lng, best.lat, best.lng);
        for (const c of cands.slice(1)) {
          const d = distanceM(apt.lat, apt.lng, c.lat, c.lng);
          if (d < bestD) { best = c; bestD = d; }
        }
        return best;
      }
      return cands[0];
    }
  }
  // 3) 좌표 기반 fallback
  if (apt.lat != null && apt.lng != null) {
    return nearestDongByCoord(apt.lat, apt.lng, tree);
  }
  return null;
}

function resolveCortar(cortarNo: string, tree: RegionTree): { cortarNo: string; sigungu: string; sido: string } | null {
  for (const candList of Object.values(tree.byDong)) {
    for (const c of candList) {
      if (c.cortarNo === cortarNo) return { cortarNo: c.cortarNo, sigungu: c.sigungu, sido: c.sido };
    }
  }
  return null;
}

function nearestDongByCoord(lat: number, lng: number, tree: RegionTree): { cortarNo: string; sigungu: string; sido: string } | null {
  let best: { cortarNo: string; sigungu: string; sido: string; d: number } | null = null;
  for (const candList of Object.values(tree.byDong)) {
    for (const c of candList) {
      const d = distanceM(lat, lng, c.lat, c.lng);
      if (!best || d < best.d) best = { cortarNo: c.cortarNo, sigungu: c.sigungu, sido: c.sido, d };
    }
  }
  return best && best.d < 5000 ? best : null;
}

// ─── 동별 단지 캐시 ────────────────────────────────────────────────────
const complexCache: Map<string, NaverComplex[]> = new Map();
async function loadComplexCache() {
  if (!existsSync(COMPLEX_CACHE)) return;
  const raw = await readFile(COMPLEX_CACHE, "utf-8");
  // 빈 결과 캐시는 무시 (abuse 차단 시 빈 응답 캐싱된 경우 방지)
  let empty = 0;
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s) as { cortarNo: string; complexes: NaverComplex[] };
      if (!o.complexes || o.complexes.length === 0) { empty++; continue; }
      complexCache.set(o.cortarNo, o.complexes);
    } catch { /* skip */ }
  }
  console.log(`[complex-cache] 로드: ${complexCache.size} dongs (empty skip: ${empty})`);
}

async function getComplexesCached(cortarNo: string): Promise<NaverComplex[]> {
  const hit = complexCache.get(cortarNo);
  if (hit) return hit;
  const list = await getComplexListByDong(cortarNo);
  complexCache.set(cortarNo, list);
  await appendFile(COMPLEX_CACHE, JSON.stringify({ cortarNo, complexes: list }) + "\n");
  return list;
}

// ─── 단지 매칭 ─────────────────────────────────────────────────────────
function pickBest(
  apt: AptRow,
  list: NaverComplex[],
): { complex: NaverComplex; name_score: number; distance_m: number | null; combined: number } | null {
  let best: { complex: NaverComplex; name_score: number; distance_m: number | null; combined: number } | null = null;
  for (const c of list) {
    const ns = nameScore(apt.name, c.hscpNm);
    let dm: number | null = null;
    if (apt.lat != null && apt.lng != null) {
      dm = distanceM(apt.lat, apt.lng, parseFloat(c.lat), parseFloat(c.lng));
    }
    const ds = distanceScore(dm);
    // 좌표 있으면 0.55·이름 + 0.45·거리, 없으면 이름만
    const combined = apt.lat != null && apt.lng != null
      ? 0.55 * ns + 0.45 * ds
      : ns;
    if (!best || combined > best.combined) {
      best = { complex: c, name_score: ns, distance_m: dm, combined };
    }
  }
  return best;
}

// ─── 메인 ───────────────────────────────────────────────────────────────
async function main() {
  const { limit, resume, workers } = parseArgs();
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[v2] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요");
    process.exit(1);
  }
  await mkdir(DATA_DIR, { recursive: true });

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // 1) 지역 트리 빌드
  const tree = await buildRegionTree();

  // 2) apartments fetch
  console.log("[1/3] apartments fetch...");
  const allApts: AptRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from("apartments")
      .select("id, name, sigungu, lat, lng")
      .order("id", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) throw new Error(`apartments select: ${error.message}`);
    if (!data || data.length === 0) break;
    allApts.push(...(data as AptRow[]));
    if (data.length < PAGE) break;
  }
  console.log(`  apartments: ${allApts.length}건`);

  // 3) resume 처리
  const processed = new Set<number>();
  if (resume) {
    try {
      await access(OUTFILE);
      const raw = await readFile(OUTFILE, "utf-8");
      for (const line of raw.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try {
          const r = JSON.parse(s) as MappingResult;
          // resume 시: 성공한 건만 skip, 실패한 건은 재시도
          if (r.naver_id != null) processed.add(r.apt_id);
        } catch { /* skip */ }
      }
      console.log(`[resume] 성공 처리 완료: ${processed.size}건 (실패건은 재시도)`);
    } catch { /* file 없음 */ }
  } else {
    await writeFile(OUTFILE, "");
  }

  let todo = allApts.filter((a) => !processed.has(a.id));
  if (limit != null) todo = todo.slice(0, limit);
  console.log(`[2/3] 처리 대상: ${todo.length}건 (workers=${workers}, threshold=${COMBINED_THRESHOLD})`);

  // 4) 동별로 grouping — 같은 cortarNo는 한 번만 fetch
  await loadComplexCache();

  // 5) 워커 풀 — apt 단위 처리 (동 list는 캐시 공유)
  let cursor = 0;
  let okCount = 0, okNearCount = 0, notFoundCount = 0, noDongCount = 0, errorCount = 0;
  const startTime = Date.now();

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= todo.length) return;
      const apt = todo[idx];
      try {
        const dong = findDongCortar(apt, tree);
        if (!dong) {
          await appendFile(OUTFILE, JSON.stringify({
            apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
            naver_id: null, naver_name: null, cortar_no: null,
            name_score: 0, distance_m: null, combined_score: 0, status: "no_dong",
          } satisfies MappingResult) + "\n");
          noDongCount++;
          continue;
        }
        // sigungu의 동 cortarNo로 단지 list 받기
        const complexes = await getComplexesCached(dong.cortarNo);
        // 근처 동도 시도 (좌표가 동 경계에 가까운 경우)
        const allCandidates: NaverComplex[] = [...complexes];
        if (apt.lat != null && apt.lng != null) {
          // 거리 1km 안의 다른 동 cortarNo 후보 — 동 좌표 기준
          for (const candList of Object.values(tree.byDong)) {
            for (const c of candList) {
              if (c.cortarNo === dong.cortarNo) continue;
              const d = distanceM(apt.lat, apt.lng, c.lat, c.lng);
              if (d < 1500) {
                const extra = await getComplexesCached(c.cortarNo);
                allCandidates.push(...extra);
              }
            }
          }
        }
        const best = pickBest(apt, allCandidates);
        if (!best) {
          await appendFile(OUTFILE, JSON.stringify({
            apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
            naver_id: null, naver_name: null, cortar_no: dong.cortarNo,
            name_score: 0, distance_m: null, combined_score: 0, status: "not_found",
          } satisfies MappingResult) + "\n");
          notFoundCount++;
          continue;
        }

        const veryClose = best.distance_m != null && best.distance_m < NEAR_DISTANCE_M;
        const pass =
          best.combined >= COMBINED_THRESHOLD ||
          (veryClose && best.name_score >= NAME_THRESHOLD_NEAR);
        if (pass) {
          const status: MappingResult["status"] = veryClose ? "ok_near" : "ok";
          await appendFile(OUTFILE, JSON.stringify({
            apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
            naver_id: parseInt(best.complex.hscpNo, 10),
            naver_name: best.complex.hscpNm,
            cortar_no: best.complex.cortarNo,
            name_score: best.name_score, distance_m: best.distance_m,
            combined_score: best.combined, status,
          } satisfies MappingResult) + "\n");
          if (status === "ok_near") okNearCount++; else okCount++;
        } else {
          await appendFile(OUTFILE, JSON.stringify({
            apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
            naver_id: null, naver_name: best.complex.hscpNm,
            cortar_no: dong.cortarNo,
            name_score: best.name_score, distance_m: best.distance_m,
            combined_score: best.combined, status: "not_found",
          } satisfies MappingResult) + "\n");
          notFoundCount++;
        }

        const done = okCount + okNearCount + notFoundCount + noDongCount + errorCount;
        if (done % 100 === 0 || done === todo.length) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = elapsed > 0 ? done / elapsed : 0;
          const eta = rate > 0 ? Math.round((todo.length - done) / rate) : 0;
          console.log(
            `  [${done}/${todo.length}] ok=${okCount} near=${okNearCount} miss=${notFoundCount} ` +
            `no_dong=${noDongCount} err=${errorCount} rate=${rate.toFixed(1)}/s eta=${eta}s`,
          );
        }
      } catch (e) {
        errorCount++;
        await appendFile(OUTFILE, JSON.stringify({
          apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
          naver_id: null, naver_name: null, cortar_no: null,
          name_score: 0, distance_m: null, combined_score: 0,
          status: "error", error: e instanceof Error ? e.message : String(e),
        } satisfies MappingResult) + "\n");
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));

  const total = okCount + okNearCount + notFoundCount + noDongCount + errorCount;
  console.log("\n[3/3] 완료 통계:");
  console.log(`  매칭 ok      : ${okCount} (${(okCount / total * 100).toFixed(1)}%)`);
  console.log(`  좌표 근접 ok : ${okNearCount} (${(okNearCount / total * 100).toFixed(1)}%)`);
  console.log(`  매칭 실패    : ${notFoundCount} (${(notFoundCount / total * 100).toFixed(1)}%)`);
  console.log(`  동 못 찾음   : ${noDongCount} (${(noDongCount / total * 100).toFixed(1)}%)`);
  console.log(`  error        : ${errorCount}`);
  console.log(`  매칭률       : ${((okCount + okNearCount) / total * 100).toFixed(1)}%`);
  console.log(`  출력         : ${OUTFILE}`);
}

main().catch((e) => { console.error("실패:", e); process.exit(1); });
