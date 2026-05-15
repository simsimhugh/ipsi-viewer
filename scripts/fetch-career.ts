/**
 * 옵션 A PoC — Playwright 없이 순수 fetch로 진로 데이터 받기
 *
 * 동작:
 *   1. GET  Pneiss_b01_s0.do?SHL_IDF_CD=... → cookie(JSESSIONID) 확보
 *   2. POST Pneiss_b01_s0.do (JG_YEAR=2025) → 2025 페이지(list3에 b06 포함)
 *   3. HTML에서 loadGongSi('Pneipp_b06_s0p.do', ...) 인자 정규식 파싱
 *   4. POST Pneipp_b06_s0p.do → 진로 HTML 응답
 *
 * 학교알리미 페이지는 EUC-KR. TextDecoder("euc-kr")로 처리 (Node 24 ICU 빌드 지원).
 *
 * 검증:
 *   - 출력 HTML이 Playwright 결과(sungbok-gongsi-info.html)와 동등한 내용을 가지는지
 *   - 시간 측정 (학교당 몇 초)
 */
import { mkdir, writeFile } from "node:fs/promises";

// CLI: `tsx scripts/fetch-career.ts [SHL_IDF_CD]`. 없으면 성복중.
const SHL_IDF_CD = process.argv[2] ?? "16eebf60-3c71-415a-bd10-1a1ad55b0094";
const YEAR = process.env.YEAR ?? "2025";
const BASE = "https://www.schoolinfo.go.kr";
const UA = "HakgunViewer/0.1 (poc; +simsim.hugh@gmail.com)";

function decodeEucKr(buf: ArrayBuffer): string {
  return new TextDecoder("euc-kr").decode(new Uint8Array(buf));
}

function pickCookie(setCookie: string | null): string {
  if (!setCookie) return "";
  // Node fetch는 set-cookie를 단일 string으로 합쳐 줌. JSESSIONID만 추출.
  const m = setCookie.match(/JSESSIONID=[^;]+/);
  return m ? m[0] : "";
}

interface GongSiArgs {
  url: string;          // /ei/pp/Pneipp_b06_s0p.do
  GS_HANGMOK_CD: string;
  GS_HANGMOK_NO: string;
  GS_HANGMOK_NM: string;
  GS_BURYU_CD: string;
  JG_BURYU_CD: string;
  JG_HANGMOK_CD: string;
  JG_GUBUN: string;
}

function parseLoadGongSiB06(html: string): GongSiArgs | null {
  // <a onclick="loadGongSi('/ei/pp/Pneipp_b06_s0p.do', '06', '13-다', '졸업생의 진로 현황', 'JG040', 'JG130', '52', '1'); return false;">
  const re = /loadGongSi\(\s*'([^']*Pneipp_b06_s0p\.do)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/;
  const m = html.match(re);
  if (!m) return null;
  return {
    url: m[1],
    GS_HANGMOK_CD: m[2],
    GS_HANGMOK_NO: m[3],
    GS_HANGMOK_NM: m[4],
    GS_BURYU_CD: m[5],
    JG_BURYU_CD: m[6],
    JG_HANGMOK_CD: m[7],
    JG_GUBUN: m[8],
  };
}

async function main() {
  await mkdir("data/samples", { recursive: true });
  const t0 = performance.now();
  console.log(`SHL_IDF_CD=${SHL_IDF_CD}, YEAR=${YEAR}`);

  // [1] 페이지 진입 + cookie
  console.log("[1] GET landing — cookie 확보");
  const r1 = await fetch(`${BASE}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SHL_IDF_CD}`, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
    redirect: "follow",
  });
  const cookie = pickCookie(r1.headers.get("set-cookie"));
  console.log(`    HTTP ${r1.status}, cookie=${cookie ? "OK" : "NONE"}`);

  // [2] JG_YEAR=2025 reload (form submit 흉내) — POST
  console.log(`[2] POST landing JG_YEAR=${YEAR}`);
  const r2 = await fetch(`${BASE}/ei/ss/Pneiss_b01_s0.do`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Cookie": cookie,
      "Content-Type": "application/x-www-form-urlencoded; charset=EUC-KR",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": `${BASE}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SHL_IDF_CD}`,
    },
    body: new URLSearchParams({ SHL_IDF_CD, JG_YEAR: YEAR }).toString(),
    redirect: "follow",
  });
  const html2 = decodeEucKr(await r2.arrayBuffer());
  console.log(`    HTTP ${r2.status}, bytes=${html2.length}`);

  // [2.5] 학교명 추출 — title 또는 학교명 표시 영역
  const titleMatch = html2.match(/<title>([^<]+?)(?:[-—]|학교알리미)/);
  const schoolNameMatch = html2.match(/var\s+HG_NM\s*=\s*["']([^"']+)["']/) ||
                          html2.match(/HG_NM["']?\s*:\s*["']([^"']+)["']/);
  const HG_NM = schoolNameMatch?.[1] ?? titleMatch?.[1]?.trim() ?? "";
  // 학교종류는 list3 안의 b06 존재로 추정 (중학교일 가능성 높음)
  console.log(`    학교명: "${HG_NM}"`);

  // [3] b06 파라미터 파싱
  console.log("[3] loadGongSi(b06) 인자 파싱");
  const args = parseLoadGongSiB06(html2);
  if (!args) {
    console.error("    ❌ b06 항목이 list3에 없음 — JG_YEAR reload 실패 가능성");
    process.exit(2);
  }
  console.log(`    ${JSON.stringify(args)}`);

  // [4] 진로 페이지 POST
  console.log("[4] POST Pneipp_b06_s0p.do");
  const r3 = await fetch(`${BASE}${args.url}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Cookie": cookie,
      "Content-Type": "application/x-www-form-urlencoded; charset=EUC-KR",
      "X-Requested-With": "XMLHttpRequest", // jQuery .load()는 XHR
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": `${BASE}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${SHL_IDF_CD}`,
    },
    body: new URLSearchParams({
      GS_HANGMOK_CD: args.GS_HANGMOK_CD,
      GS_HANGMOK_NO: args.GS_HANGMOK_NO,
      GS_HANGMOK_NM: args.GS_HANGMOK_NM,
      GS_BURYU_CD: args.GS_BURYU_CD,
      JG_BURYU_CD: args.JG_BURYU_CD,
      JG_HANGMOK_CD: args.JG_HANGMOK_CD,
      JG_GUBUN: args.JG_GUBUN,
      JG_YEAR2: YEAR,
      HG_NM,
      SHL_IDF_CD: SHL_IDF_CD,
      GS_TYPE: "Y",
      JG_YEAR: YEAR,
      SORT: "BR",
      CHOSEN_JG_YEAR: YEAR,
      PRE_JG_YEAR: YEAR,
      LOAD_TYPE: "single",
    }).toString(),
  });
  const careerHtml = decodeEucKr(await r3.arrayBuffer());
  console.log(`    HTTP ${r3.status}, bytes=${careerHtml.length}`);
  await writeFile("data/samples/fetch-career.html", careerHtml, "utf-8");

  // [5] 검증: 진로 카테고리 키워드 확인
  const probes = ["일반고", "특성화고", "과학고", "외고", "자율형사립고", "졸업자"];
  const hits = probes.filter((p) => careerHtml.includes(p));
  console.log(`[5] 키워드 검증: ${hits.length}/${probes.length} 매칭 — [${hits.join(", ")}]`);

  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\n총 소요 ${elapsed}s — 학교 1건 기준`);
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});
