/**
 * 네이버 부동산 단지 ID 매핑 batch.
 *
 * ── 전략 ──────────────────────────────────────────────────────────────────
 * new.land.naver.com/api/search/complexes?query=<name>&type=APT
 *   → JSON { complexes: [{ complexNo, complexName, ... }] } 반환
 *   → 검색 결과 중 우리 단지명과 가장 유사한 항목을 fuzzy 매칭으로 선택.
 *
 * 매칭 실패(결과 없음 또는 score 임계값 미달) 시 변형명 재시도:
 *   - 한↔영 빌더 치환 (엘지↔LG, 지에스↔GS, 케이씨씨↔KCC, 에스케이↔SK,
 *                       힐스테이트↔Hillstate, 아이파크↔IPark, 자이↔Xi 등)
 *   - "○○마을" prefix 제거
 *   - 동명 prefix 치환 (성동마을→성복마을)
 *   - "1차"↔"1단지", "(A)" 제거
 *
 * ── Rate limit 대응 ────────────────────────────────────────────────────────
 *   - 워커 5 (기본), 각 요청 후 200~400ms jitter
 *   - TOO_MANY_REQUESTS(429) → 3s backoff 후 최대 3회 재시도
 *   - 단지당 원본 + 변형 합산 호출 수 << 기존 HEAD 방식 (1호출 + fuzzy로 끝)
 *
 * ── 출력 ──────────────────────────────────────────────────────────────────
 * ~/hakgun-data/naver-complex-mapping.jsonl
 *   { apt_id, our_name, sigungu, naver_id|null, naver_name|null, matched_with, score, status }
 *
 * ── 환경변수 ──────────────────────────────────────────────────────────────
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   HAKGUN_DATA_DIR (기본 ~/hakgun-data)
 *
 * ── 사용 ──────────────────────────────────────────────────────────────────
 *   tsx scripts/naver-complex-mapping.ts              # 전체
 *   tsx scripts/naver-complex-mapping.ts --limit 50   # 테스트
 *   tsx scripts/naver-complex-mapping.ts --resume     # 이어서
 *   tsx scripts/naver-complex-mapping.ts --workers 5  # 워커 수 조정
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

// 네이버 new.land API
const NAVER_SEARCH_URL = "https://new.land.naver.com/api/search/complexes";
const NAVER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://new.land.naver.com/",
  "Accept": "application/json",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

// fuzzy 매칭 점수 임계값 (0~1). 이 값 이상이면 매칭 성공으로 간주.
const FUZZY_THRESHOLD = 0.65;

// ─── CLI 옵션 ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let resume = false;
  let workers = 5;
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
}

interface MappingResult {
  apt_id: number;
  our_name: string;
  sigungu: string | null;
  naver_id: number | null;
  naver_name: string | null;   // 네이버에서 받은 단지명 (디버깅용)
  matched_with: string | null; // 어떤 변형명이 hit 했는지
  score: number;               // fuzzy 매칭 점수 (0~1)
  status: "ok" | "ok_variant" | "not_found" | "error";
  error?: string;
}

// ─── 네이버 빌더명 한↔영 매핑 ─────────────────────────────────────────
// 각 엔트리: [한글표기, 영문표기]
// 탐색 순서: 한글→영문, 영문→한글 양방향 적용.
const BUILDER_MAP: Array<[string, string]> = [
  ["엘지", "LG"],
  ["지에스", "GS"],
  ["케이씨씨", "KCC"],
  ["에스케이", "SK"],
  ["힐스테이트", "Hillstate"],
  ["힐스테이트", "HILLSTATE"],
  ["아이파크", "IPark"],
  ["아이파크", "iPark"],
  ["아이파크", "IPARK"],
  ["자이", "Xi"],
  ["자이", "xi"],
  ["래미안", "Raemian"],
  ["래미안", "RAEMIAN"],
  ["롯데캐슬", "Lotte Castle"],
  ["롯데캐슬", "LotteCastle"],
  ["푸르지오", "Prugio"],
  ["푸르지오", "PRUGIO"],
  ["e편한세상", "이편한세상"],
  ["더샵", "TheSharp"],
  ["더샵", "The Sharp"],
  ["캐슬", "Castle"],
  ["파크", "Park"],
  ["빌리지", "Village"],
  ["빌리지", "VILLAGE"],
];

/**
 * 단지명 정규화: 비교 전 양쪽에 동일하게 적용.
 * - 공백 제거, 소문자화, 특수문자 제거
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_·]/g, "").replace(/[^\w가-힣]/g, "");
}

/**
 * 두 단지명 간 fuzzy 점수 (0~1).
 * - 정규화 후 정확 일치: 1.0
 * - 포함 관계: 0.85
 * - LCS 비율 기반: 그 이하
 */
function fuzzyScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  // Levenshtein 기반 similarity
  const la = na.length, lb = nb.length;
  if (la === 0 || lb === 0) return 0;
  const maxLen = Math.max(la, lb);
  const dist = levenshtein(na, nb);
  return 1 - dist / maxLen;
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

/**
 * 네이버 검색 결과에서 best match 선택.
 * complexes 배열에서 우리 단지명과 가장 높은 fuzzy score를 가진 항목 반환.
 */
function pickBestMatch(
  candidates: Array<{ complexNo: string; complexName: string }>,
  query: string,
): { id: number; name: string; score: number } | null {
  let best: { id: number; name: string; score: number } | null = null;
  for (const c of candidates) {
    const score = fuzzyScore(query, c.complexName);
    if (!best || score > best.score) {
      best = { id: parseInt(c.complexNo, 10), name: c.complexName, score };
    }
  }
  return best && best.score >= FUZZY_THRESHOLD ? best : null;
}

// ─── 네이버 API 호출 (rate limit 재시도 포함) ─────────────────────────
interface NaverComplex {
  complexNo: string;
  complexName: string;
  [key: string]: unknown;
}

interface NaverSearchResponse {
  complexes?: NaverComplex[];
  // 실제 응답 키가 다를 경우 fallback: body 탐색
  [key: string]: unknown;
}

async function searchNaverComplexes(
  query: string,
  timeoutMs = 10000,
  retries = 3,
): Promise<NaverComplex[]> {
  const url = `${NAVER_SEARCH_URL}?query=${encodeURIComponent(query)}&type=APT`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: NAVER_HEADERS,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        // rate limit — backoff
        const waitMs = 3000 * (attempt + 1);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) return [];

      const body = await res.json() as NaverSearchResponse;

      // 응답 구조 탐색 — 실제 키가 complexes, list, items, data.complexes 등일 수 있음
      // 가장 긴 배열 필드를 complexes로 간주
      if (Array.isArray(body.complexes)) return body.complexes;
      if (Array.isArray(body.list)) return body.list as NaverComplex[];
      if (Array.isArray(body.items)) return body.items as NaverComplex[];
      if (body.data && Array.isArray((body.data as NaverSearchResponse).complexes)) {
        return (body.data as NaverSearchResponse).complexes!;
      }
      // 최후 탐색: 배열을 가진 첫 번째 키
      for (const v of Object.values(body)) {
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") {
          return v as NaverComplex[];
        }
      }
      return [];
    } catch {
      clearTimeout(timer);
      if (attempt === retries) return [];
      await sleep(1000 * (attempt + 1));
    }
  }
  return [];
}

// ─── 단지명 변형 후보 생성 ────────────────────────────────────────────
function generateVariants(name: string, sigungu: string | null): string[] {
  const variants = new Set<string>();

  // 1) 한↔영 빌더 치환 (양방향)
  for (const [ko, en] of BUILDER_MAP) {
    if (name.includes(ko)) variants.add(name.split(ko).join(en));
    if (name.includes(en)) variants.add(name.split(en).join(ko));
  }

  // 2) "○○마을" prefix 제거 (예: "성동마을엘지빌리지1차" → "엘지빌리지1차")
  const villageMatch = name.match(/^([^\s]{1,5}마을)(.+)$/);
  if (villageMatch) {
    const stripped = villageMatch[2];
    variants.add(stripped);
    // 마을 prefix 제거 + 빌더 영문화 조합
    for (const [ko, en] of BUILDER_MAP) {
      if (stripped.includes(ko)) variants.add(stripped.split(ko).join(en));
    }
  }

  // 3) 동명으로 마을 prefix 치환
  //    "성동마을엘지빌리지1차" + sigungu="성복동" → "성복마을엘지빌리지1차", "성복마을LG빌리지1차"
  if (sigungu) {
    const tokens = sigungu.trim().split(/\s+/);
    const lastTok = tokens[tokens.length - 1];
    if (lastTok && lastTok.endsWith("동")) {
      const dongShort = lastTok.slice(0, -1); // "성복동" → "성복"
      if (villageMatch) {
        const body = villageMatch[2];
        // "성복마을엘지빌리지1차"
        variants.add(`${dongShort}마을${body}`);
        // 빌더 영문화 조합
        for (const [ko, en] of BUILDER_MAP) {
          if (body.includes(ko)) variants.add(`${dongShort}마을${body.split(ko).join(en)}`);
        }
        // prefix 없이 동명 단순 prefix: "성복엘지빌리지1차"
        variants.add(`${dongShort}${body}`);
        for (const [ko, en] of BUILDER_MAP) {
          if (body.includes(ko)) variants.add(`${dongShort}${body.split(ko).join(en)}`);
        }
      }
    }
  }

  // 4) "N차" ↔ "N단지" 양방향
  for (let n = 1; n <= 9; n++) {
    if (name.includes(`${n}차`)) {
      const v = name.split(`${n}차`).join(`${n}단지`);
      variants.add(v);
      // 차→단지 + 빌더 영문화 조합
      for (const [ko, en] of BUILDER_MAP) {
        if (v.includes(ko)) variants.add(v.split(ko).join(en));
      }
    }
    if (name.includes(`${n}단지`)) {
      const v = name.split(`${n}단지`).join(`${n}차`);
      variants.add(v);
    }
  }

  // 5) "(A)" "(B)" 등 괄호 제거
  if (/\([A-Za-z0-9가-힣]+\)/.test(name)) {
    variants.add(name.replace(/\([A-Za-z0-9가-힣]+\)/g, "").trim());
  }

  // 6) 시공사 단독 (마을 prefix + 본체만 시공사명인 경우 → 시공사명으로만 검색)
  //    예: "성동마을엘지빌리지1차" → "LG빌리지1차"
  if (villageMatch) {
    const body = villageMatch[2];
    for (const [ko, en] of BUILDER_MAP) {
      if (body.startsWith(ko)) {
        variants.add(en + body.slice(ko.length));
      }
    }
  }

  variants.delete(name);
  return [...variants];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(): number {
  return 200 + Math.floor(Math.random() * 200); // 200~400ms
}

// ─── 단일 단지 처리 ───────────────────────────────────────────────────
async function mapOneApartment(apt: AptRow): Promise<MappingResult> {
  // 1) 원본명으로 검색
  const candidates = await searchNaverComplexes(apt.name);
  if (candidates.length > 0) {
    const best = pickBestMatch(candidates, apt.name);
    if (best) {
      return {
        apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
        naver_id: best.id, naver_name: best.name, matched_with: apt.name,
        score: best.score, status: "ok",
      };
    }
  }

  // 2) 변형명 시도 (각 변형 간 jitter)
  const variants = generateVariants(apt.name, apt.sigungu);
  for (const v of variants) {
    await sleep(jitter());
    const vcandidates = await searchNaverComplexes(v);
    if (vcandidates.length > 0) {
      // 변형명 검색 결과에서 원본명 기준으로도 fuzzy 비교
      const bestOrig = pickBestMatch(vcandidates, apt.name);
      const bestVariant = pickBestMatch(vcandidates, v);
      const best = (!bestOrig || (bestVariant && bestVariant.score > bestOrig.score))
        ? bestVariant
        : bestOrig;
      if (best) {
        return {
          apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
          naver_id: best.id, naver_name: best.name, matched_with: v,
          score: best.score, status: "ok_variant",
        };
      }
    }
  }

  return {
    apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
    naver_id: null, naver_name: null, matched_with: null, score: 0, status: "not_found",
  };
}

// ─── 메인 ───────────────────────────────────────────────────────────────
async function main() {
  const { limit, resume, workers } = parseArgs();
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[naver-mapping] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // 1) apartments 전체 fetch
  console.log("[1/3] apartments fetch...");
  const allApts: AptRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from("apartments")
      .select("id, name, sigungu")
      .order("id", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) throw new Error(`apartments select: ${error.message}`);
    if (!data || data.length === 0) break;
    allApts.push(...(data as AptRow[]));
    if (data.length < PAGE) break;
  }
  console.log(`  apartments: ${allApts.length}건`);

  // 2) resume 처리
  await mkdir(DATA_DIR, { recursive: true });
  const processed = new Set<number>();
  if (resume) {
    try {
      await access(OUTFILE);
      const raw = await readFile(OUTFILE, "utf-8");
      for (const line of raw.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try { processed.add((JSON.parse(s) as MappingResult).apt_id); } catch { /* skip */ }
      }
      console.log(`[resume] 기존 처리: ${processed.size}건`);
    } catch { /* file 없음 */ }
  } else {
    await writeFile(OUTFILE, "");
  }

  let todo = allApts.filter((a) => !processed.has(a.id));
  if (limit != null) todo = todo.slice(0, limit);
  console.log(`[2/3] 처리 대상: ${todo.length}건 (workers=${workers}, threshold=${FUZZY_THRESHOLD})`);

  // 3) 병렬 워커 풀 (shared cursor — mutex 없이 단순 증분)
  let cursor = 0;
  let okCount = 0, okVariantCount = 0, notFoundCount = 0, errorCount = 0;
  const startTime = Date.now();

  // 스키마 자동 감지를 위해 첫 성공 응답의 필드를 로그
  let schemaLogged = false;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= todo.length) return;
      const apt = todo[idx];
      try {
        // 스키마 자동 감지: 첫 단지 원본 검색 결과를 raw로 로그
        if (!schemaLogged) {
          const raw = await searchNaverComplexes(apt.name);
          if (raw.length > 0) {
            console.log(`[schema] 첫 결과 키: ${Object.keys(raw[0]).join(", ")}`);
            console.log(`[schema] 첫 항목: ${JSON.stringify(raw[0]).substring(0, 300)}`);
            schemaLogged = true;
          }
        }

        const result = await mapOneApartment(apt);
        await appendFile(OUTFILE, JSON.stringify(result) + "\n");

        if (result.status === "ok") okCount++;
        else if (result.status === "ok_variant") okVariantCount++;
        else if (result.status === "not_found") notFoundCount++;
        else errorCount++;

        const done = okCount + okVariantCount + notFoundCount + errorCount;
        if (done % 100 === 0 || done === todo.length) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = elapsed > 0 ? done / elapsed : 0;
          const eta = rate > 0 ? Math.round((todo.length - done) / rate) : 0;
          console.log(
            `  [${done}/${todo.length}] ` +
            `ok=${okCount} variant=${okVariantCount} miss=${notFoundCount} err=${errorCount} ` +
            `rate=${rate.toFixed(1)}/s eta=${eta}s`,
          );
        }
      } catch (e) {
        errorCount++;
        await appendFile(OUTFILE, JSON.stringify({
          apt_id: apt.id, our_name: apt.name, sigungu: apt.sigungu,
          naver_id: null, naver_name: null, matched_with: null, score: 0,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        } satisfies MappingResult) + "\n");
      }
      await sleep(jitter());
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));

  const total = okCount + okVariantCount + notFoundCount + errorCount;
  console.log("\n[3/3] 완료 통계:");
  console.log(`  원본 hit    : ${okCount} (${(okCount / total * 100).toFixed(1)}%)`);
  console.log(`  변형 hit    : ${okVariantCount} (${(okVariantCount / total * 100).toFixed(1)}%)`);
  console.log(`  매칭 실패   : ${notFoundCount} (${(notFoundCount / total * 100).toFixed(1)}%)`);
  console.log(`  error       : ${errorCount}`);
  console.log(`  매칭률      : ${((okCount + okVariantCount) / total * 100).toFixed(1)}%`);
  console.log(`  출력        : ${OUTFILE}`);
}

main().catch((e) => { console.error("실패:", e); process.exit(1); });
