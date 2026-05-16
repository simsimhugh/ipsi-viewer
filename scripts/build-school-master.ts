/**
 * 학교알리미 sitemap 10개 → 학교 마스터(SHL_IDF_CD, 학교명, 시도, 학교종류) JSONL.
 *
 * 흐름:
 *   1) /sitemap/school/main/school_main_{01..10}.xml 10개 GET (병렬) → SHL_IDF_CD 합집합
 *   2) 각 학교의 landing 페이지 GET 1회 → 학교명·lctnScCd·sdSchulCode 추출
 *   3) JSONL 출력 (한 줄 = 한 학교). 매 record flush.
 *
 * 학교 종류는 학교명에 포함된 "초등학교/중학교/고등학교" 키워드로 추정 (학교알리미 페이지 별도 필드 없음).
 *
 * CLI:
 *   tsx scripts/build-school-master.ts [--out data/school-master.jsonl]
 *        [--workers 3] [--limit N] [--sitemap 01|02|...|all]
 *
 * 검증/마스터 빌드 모두 한 스크립트로:
 *   - limit 50  → 5분 미만 sanity check
 *   - sitemap 1개 → 약 1100교, 약 8분
 *   - all 풀 빌드 → 약 11000교, 약 30분
 */
import { mkdir, open, readFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { runWithLimit, withRetry, sleep, jitter } from "./batch-fetch.ts";

const BASE = "https://www.schoolinfo.go.kr";
const UA = "HakgunViewer/0.1 (master-builder; +simsim.hugh@gmail.com)";

const SIDO_NAMES: Record<string, string> = {
  "01": "서울", "02": "부산", "03": "대구", "04": "인천",
  "05": "광주", "06": "대전", "07": "울산", "08": "세종",
  "10": "경기", "11": "강원", "12": "충북", "13": "충남",
  "14": "전북", "15": "전남", "16": "경북", "17": "경남",
  "18": "제주", "20": "재외한국학교",
};

function decodeEucKr(buf: ArrayBuffer): string {
  return new TextDecoder("euc-kr").decode(new Uint8Array(buf));
}

function classifyKind(schoolName: string): "초등학교" | "중학교" | "고등학교" | "기타" {
  // 정렬 중요: "고등학교"는 "고"보다 먼저, "중학교"는 단독으로 잡음.
  if (schoolName.includes("초등학교") || schoolName.includes("분교")) return "초등학교";
  if (schoolName.includes("고등학교")) return "고등학교";
  if (schoolName.includes("중학교")) return "중학교";
  return "기타";
}

interface SchoolMaster {
  SHL_IDF_CD: string;
  schoolName: string;
  sidoCode: string;
  sidoName: string;
  sdSchulCode: string;
  kind: ReturnType<typeof classifyKind>;
}

/** sitemapindex.xml에서 school_main_*.xml URL들을 동적으로 발견. */
async function getAllSitemapUrls(): Promise<string[]> {
  const res = await fetch(`${BASE}/sitemap/sitemapindex.xml`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`sitemapindex HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]*school_main_\d+\.xml)<\/loc>/g)].map(m => m[1]);
}

async function fetchSitemapSHLsFromUrl(url: string): Promise<string[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`sitemap ${url} HTTP ${res.status}`);
  const xml = await res.text();
  const set = new Set<string>();
  for (const m of xml.matchAll(/SHL_IDF_CD=([a-f0-9-]+)/g)) set.add(m[1]);
  return [...set];
}

async function fetchSchoolInfo(SHL: string): Promise<SchoolMaster> {
  const url = `${BASE}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SHL}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!res.ok) throw new Error(`landing HTTP ${res.status}`);
  const html = decodeEucKr(await res.arrayBuffer());

  const titleMatch = html.match(/<title>\s*([^<|]+?)\s*(?:학교정보|학교알리미|\||$)/);
  const schoolName = (titleMatch?.[1] ?? "").trim();
  if (!schoolName) throw new Error("학교명 미발견");

  const sdMatch = html.match(/var\s+sdSchulCode\s*=\s*["']([^"']+)["']/);
  const lctnMatch = html.match(/var\s+lctnScCd\s*=\s*["']([^"']+)["']/);
  const sdSchulCode = sdMatch?.[1] ?? "";
  const sidoCode = lctnMatch?.[1] ?? "";
  const sidoName = SIDO_NAMES[sidoCode] ?? "";

  return {
    SHL_IDF_CD: SHL,
    schoolName,
    sidoCode,
    sidoName,
    sdSchulCode,
    kind: classifyKind(schoolName),
  };
}

interface CliArgs {
  outPath: string;
  workers: number;
  limit: number | null;
  sitemap: string; // "all" | "01" | "11-17" 등
  append: boolean; // true면 기존 outPath의 SHL은 skip + 파일에 append
}

function parseCli(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  return {
    outPath: get("--out") ?? "data/school-master.jsonl",
    workers: Number(get("--workers") ?? 3),
    limit: get("--limit") !== null ? Number(get("--limit")) : null,
    sitemap: get("--sitemap") ?? "all",
    append: args.includes("--append"),
  };
}

function selectSitemapUrls(allUrls: string[], spec: string): string[] {
  if (spec === "all") return allUrls;
  // "01" 단일
  if (/^\d+$/.test(spec)) {
    const n = String(Number(spec)).padStart(2, "0");
    return allUrls.filter(u => u.includes(`school_main_${n}.xml`));
  }
  // "11-17" 범위
  const rangeMatch = spec.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    const hi = Number(rangeMatch[2]);
    return allUrls.filter(u => {
      const m = u.match(/school_main_(\d+)\.xml/);
      if (!m) return false;
      const n = Number(m[1]);
      return n >= lo && n <= hi;
    });
  }
  // "01,02,03" 콤마
  if (spec.includes(",")) {
    const nums = spec.split(",").map(s => String(Number(s.trim())).padStart(2, "0"));
    return allUrls.filter(u => nums.some(n => u.includes(`school_main_${n}.xml`)));
  }
  throw new Error(`알 수 없는 --sitemap 형식: "${spec}"`);
}

async function readExistingSHLs(path: string): Promise<Set<string>> {
  try { await access(path); } catch { return new Set(); }
  const raw = await readFile(path, "utf-8");
  const set = new Set<string>();
  for (const line of raw.split("\n")) {
    const m = line.match(/"SHL_IDF_CD":\s*"([^"]+)"/);
    if (m) set.add(m[1]);
  }
  return set;
}

async function main() {
  const cli = parseCli();
  const t0 = performance.now();
  console.log(`[CFG] sitemap=${cli.sitemap}, workers=${cli.workers}, limit=${cli.limit ?? "∞"}, out=${cli.outPath}, append=${cli.append}`);

  // ── step 1: sitemap → SHL_IDF_CD 합집합 ─────────────────────────────
  console.log("[1] sitemapindex.xml 자동 발견");
  const allUrls = await getAllSitemapUrls();
  console.log(`    전체 sitemap 발견: ${allUrls.length}개`);
  const sitemapUrls = selectSitemapUrls(allUrls, cli.sitemap);
  console.log(`    이번 실행 대상: ${sitemapUrls.length}개 (${cli.sitemap})`);

  const allLists = await Promise.all(sitemapUrls.map(fetchSitemapSHLsFromUrl));
  const seen = new Set<string>();
  for (const list of allLists) for (const s of list) seen.add(s);
  let SHLs = [...seen];
  console.log(`    sitemap 안 unique SHL_IDF_CD = ${SHLs.length}`);

  // append 모드: 기존 출력 파일의 SHL 제외
  let existing: Set<string> = new Set();
  if (cli.append) {
    existing = await readExistingSHLs(cli.outPath);
    const before = SHLs.length;
    SHLs = SHLs.filter(s => !existing.has(s));
    console.log(`    기존 ${existing.size}건 skip → ${before} → ${SHLs.length}건 처리`);
  }

  if (cli.limit !== null) SHLs = SHLs.slice(0, cli.limit);
  console.log(`    최종 처리 대상: ${SHLs.length}`);

  // ── step 2: 각 학교 정보 fetch ──────────────────────────────────────
  await mkdir(dirname(cli.outPath), { recursive: true });
  const fh = await open(cli.outPath, cli.append ? "a" : "w");

  let done = 0, failed = 0;
  const kindCount = new Map<string, number>();

  await runWithLimit(SHLs, cli.workers, async (SHL, idx) => {
    await sleep(jitter());
    try {
      const info = await withRetry(() => fetchSchoolInfo(SHL), SHL.slice(0, 8));
      await fh.write(JSON.stringify(info) + "\n");
      kindCount.set(info.kind, (kindCount.get(info.kind) ?? 0) + 1);
      done++;
      if (done % 50 === 0 || idx + 1 === SHLs.length) {
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        const rate = (done / Number(elapsed)).toFixed(1);
        console.log(`    [${idx + 1}/${SHLs.length}] ${elapsed}s ${rate}/s — ${info.schoolName} (${info.sidoName})`);
      }
    } catch (e) {
      failed++;
      console.error(`  ✗ ${SHL.slice(0, 8)}…: ${(e as Error).message}`);
    }
  });

  await fh.close();
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n총 ${SHLs.length}교 — 성공 ${done} / 실패 ${failed}, ${elapsed}s`);
  console.log("종류별 분포:");
  for (const [k, n] of kindCount) console.log(`  ${k}: ${n}`);
  console.log(`\n출력: ${cli.outPath}`);
}

if (process.argv[1]?.endsWith("/build-school-master.ts")) {
  main().catch((err) => { console.error("실패:", err); process.exit(1); });
}
