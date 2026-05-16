/**
 * 학교알리미 진로 데이터 fetch — 순수 fetch (Playwright 없음)
 *
 * 동작:
 *   1. GET  Pneiss_b01_s0.do?SHL_IDF_CD=... → cookie(JSESSIONID) 확보
 *   2. POST Pneiss_b01_s0.do (JG_YEAR=2025) → list3에 b06 포함된 페이지
 *   3. HTML에서 loadGongSi('Pneipp_b06_s0p.do', ...) 인자 정규식 파싱
 *   4. POST Pneipp_b06_s0p.do → 진로 HTML 응답
 *
 * 학교알리미 페이지는 EUC-KR. Node 24 TextDecoder("euc-kr") 사용.
 *
 * CLI:   `tsx scripts/fetch-career.ts [SHL_IDF_CD]`
 * Import: `import { fetchCareer } from "./fetch-career.ts"`
 */
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.schoolinfo.go.kr";
const UA = "HakgunViewer/0.1 (poc; +simsim.hugh@gmail.com)";

function decodeEucKr(buf: ArrayBuffer): string {
  return new TextDecoder("euc-kr").decode(new Uint8Array(buf));
}

function pickCookie(setCookie: string | null): string {
  if (!setCookie) return "";
  const m = setCookie.match(/JSESSIONID=[^;]+/);
  return m ? m[0] : "";
}

export interface GongSiArgs {
  url: string;
  GS_HANGMOK_CD: string;
  GS_HANGMOK_NO: string;
  GS_HANGMOK_NM: string;
  GS_BURYU_CD: string;
  JG_BURYU_CD: string;
  JG_HANGMOK_CD: string;
  JG_GUBUN: string;
}

function parseLoadGongSiB06(html: string): GongSiArgs | null {
  const re = /loadGongSi\(\s*'([^']*Pneipp_b06_s0p\.do)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/;
  const m = html.match(re);
  if (!m) return null;
  return {
    url: m[1], GS_HANGMOK_CD: m[2], GS_HANGMOK_NO: m[3], GS_HANGMOK_NM: m[4],
    GS_BURYU_CD: m[5], JG_BURYU_CD: m[6], JG_HANGMOK_CD: m[7], JG_GUBUN: m[8],
  };
}

export interface FetchCareerResult {
  html: string;
  schoolName: string;
  args: GongSiArgs;
}

export class NoCareerDataError extends Error {
  constructor(public SHL_IDF_CD: string, public year: string) {
    super(`b06 항목 미발견 — ${SHL_IDF_CD}, ${year}년 데이터 없음 또는 중학교 아님`);
    this.name = "NoCareerDataError";
  }
}

/**
 * 학교 한 곳의 진로 데이터 fetch. 4-step HTTP.
 * b06이 list3에 없으면 NoCareerDataError throw (호출자가 retry 무관하게 skip 가능).
 */
export async function fetchCareer(
  SHL_IDF_CD: string,
  opts: { year?: string; log?: (s: string) => void } = {},
): Promise<FetchCareerResult> {
  const YEAR = opts.year ?? "2025";
  const log = opts.log ?? (() => {});

  log(`[1] GET landing (${SHL_IDF_CD.slice(0, 8)}…)`);
  const r1 = await fetch(`${BASE}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SHL_IDF_CD}`, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
    redirect: "follow",
  });
  const cookie = pickCookie(r1.headers.get("set-cookie"));
  if (!cookie) throw new Error(`cookie 미수신 (HTTP ${r1.status})`);

  log(`[2] POST landing JG_YEAR=${YEAR}`);
  const r2 = await fetch(`${BASE}/ei/ss/Pneiss_b01_s0.do`, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Cookie": cookie,
      "Content-Type": "application/x-www-form-urlencoded; charset=EUC-KR",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": `${BASE}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SHL_IDF_CD}`,
    },
    body: new URLSearchParams({ SHL_IDF_CD, JG_YEAR: YEAR }).toString(),
    redirect: "follow",
  });
  const html2 = decodeEucKr(await r2.arrayBuffer());

  // 학교명 추출 (title 영역). title 형식: "<schoolName> 학교정보 | 학교알리미"
  const titleMatch = html2.match(/<title>\s*([^<|]+?)\s*(?:학교정보|학교알리미|\||$)/);
  const schoolName = (titleMatch?.[1] ?? "").trim();

  log(`[3] b06 인자 파싱 (학교: "${schoolName}")`);
  const args = parseLoadGongSiB06(html2);
  if (!args) throw new NoCareerDataError(SHL_IDF_CD, YEAR);

  log(`[4] POST ${args.url}`);
  const r3 = await fetch(`${BASE}${args.url}`, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Cookie": cookie,
      "Content-Type": "application/x-www-form-urlencoded; charset=EUC-KR",
      "X-Requested-With": "XMLHttpRequest",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": `${BASE}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SHL_IDF_CD}`,
    },
    body: new URLSearchParams({
      GS_HANGMOK_CD: args.GS_HANGMOK_CD, GS_HANGMOK_NO: args.GS_HANGMOK_NO,
      GS_HANGMOK_NM: args.GS_HANGMOK_NM, GS_BURYU_CD: args.GS_BURYU_CD,
      JG_BURYU_CD: args.JG_BURYU_CD, JG_HANGMOK_CD: args.JG_HANGMOK_CD,
      JG_GUBUN: args.JG_GUBUN, JG_YEAR2: YEAR, HG_NM: schoolName,
      SHL_IDF_CD, GS_TYPE: "Y", JG_YEAR: YEAR, SORT: "BR",
      CHOSEN_JG_YEAR: YEAR, PRE_JG_YEAR: YEAR, LOAD_TYPE: "single",
    }).toString(),
  });
  if (!r3.ok) throw new Error(`b06 POST 실패 HTTP ${r3.status}`);
  const html = decodeEucKr(await r3.arrayBuffer());

  return { html, schoolName, args };
}

// ─── CLI 진입점 ──────────────────────────────────────────
async function main() {
  const SHL = process.argv[2] ?? "16eebf60-3c71-415a-bd10-1a1ad55b0094";
  const YEAR = process.env.YEAR ?? "2025";
  await mkdir("data/samples", { recursive: true });
  const t0 = performance.now();
  console.log(`SHL_IDF_CD=${SHL}, YEAR=${YEAR}`);

  const { html, schoolName } = await fetchCareer(SHL, {
    year: YEAR, log: (s) => console.log(`    ${s}`),
  });
  await writeFile("data/samples/fetch-career.html", html, "utf-8");

  const probes = ["일반고", "특성화고", "과학고", "외고", "자율형사립고", "졸업자"];
  const hits = probes.filter((p) => html.includes(p));
  console.log(`[5] 학교명="${schoolName}", 키워드 ${hits.length}/${probes.length}`);
  console.log(`총 소요 ${((performance.now() - t0) / 1000).toFixed(2)}s`);
}

if (process.argv[1]?.endsWith("/fetch-career.ts")) {
  main().catch((err) => { console.error("실패:", err); process.exit(1); });
}
