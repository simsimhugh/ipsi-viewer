/**
 * HTML → JSON 파서
 *
 * 입력: 학교알리미 "졸업생의 진로 현황" 응답 HTML
 *        (scripts/fetch-career.ts 또는 Playwright 스크래퍼가 남긴 #gongsiInfo 영역)
 * 출력: 구조화된 JSON
 *
 * 의존성: 없음 (정규식만). HTML 구조가 안정적이라 cheerio 도입은 과잉.
 *
 * CLI:
 *   npx tsx scripts/parse-career.ts <html-path> [--school "성복중학교"] [--year 2025]
 *
 * 표 구조:
 *   1) 차트 데이터 표: 11개 카테고리 한 줄 (합계만, 비율 없음)
 *   2) 졸업자 진로 현황 표: 남/여/합계/비율 4행 × 16컬럼
 *
 * 우리가 핵심으로 쓰는 건 (2)의 "합계" 행.
 */
import { readFile } from "node:fs/promises";

interface CareerRow {
  graduates: number;
  generalHigh: number;            // 진학자 일반고
  vocationalHigh: number;         // 진학자 특성화고
  scienceHigh: number;            // 진학자 특수목적고 과학고
  foreignIntlHigh: number;        // 진학자 특수목적고 외고국제고
  artsSportsHigh: number;         // 진학자 특수목적고 예고체고
  meisterHigh: number;            // 진학자 특수목적고 마이스터고
  specialPurposeSubtotal: number; // 진학자 특수목적고 소계
  privateAutonomous: number;      // 진학자 자율고 자율형사립고
  publicAutonomous: number;       // 진학자 자율고 자율형공립고
  autonomousSubtotal: number;     // 진학자 자율고 소계
  other: number;                  // 진학자 기타
  advancedTotal: number;          // 진학자 진학자계
  employed: number;               // 취업자
  altEducation: number;           // 대안교육기관진학(학력미인정)
  unemployed: number;             // 무직 및 미상
}

interface CareerData {
  schoolName: string | null;
  year: number | null;
  // 두 번째 표 — 남/여/합계 절대값 행
  male: CareerRow;
  female: CareerRow;
  total: CareerRow;
  // 비율 % 행 (값은 동일 키 — 졸업자만 의미 없으므로 0)
  ratePct: CareerRow;
  // 검증용 — 두 번째 표 "합계" 행에서 산출한 졸업자 수
  totalGraduatesFromTable: number;
}

const TITLE_KEY: Record<string, keyof CareerRow> = {
  "졸업자": "graduates",
  "진학자 일반고": "generalHigh",
  "진학자 특성화고": "vocationalHigh",
  "진학자 특수목적고 과학고": "scienceHigh",
  "진학자 특수목적고 외고국제고": "foreignIntlHigh",
  "진학자 특수목적고 예고체고": "artsSportsHigh",
  "진학자 특수목적고 마이스터고": "meisterHigh",
  "진학자 특수목적고 소계": "specialPurposeSubtotal",
  "진학자 자율고 자율형사립고": "privateAutonomous",
  "진학자 자율고 자율형공립고": "publicAutonomous",
  "진학자 자율고 소계": "autonomousSubtotal",
  "진학자 기타": "other",
  "진학자 진학자계": "advancedTotal",
  "취업자": "employed",
  "대안교육기관진학(학력미인정)": "altEducation",
  "무직 및 미상": "unemployed",
};

function emptyRow(): CareerRow {
  return {
    graduates: 0, generalHigh: 0, vocationalHigh: 0,
    scienceHigh: 0, foreignIntlHigh: 0, artsSportsHigh: 0, meisterHigh: 0,
    specialPurposeSubtotal: 0,
    privateAutonomous: 0, publicAutonomous: 0, autonomousSubtotal: 0,
    other: 0, advancedTotal: 0,
    employed: 0, altEducation: 0, unemployed: 0,
  };
}

/** caption "졸업자 진로 현황 (진학·취업·기타)" ~ </table>까지 슬라이스 */
function extractSecondTable(html: string): string {
  const start = html.indexOf("졸업자 진로 현황");
  if (start < 0) throw new Error("졸업자 진로 현황 표를 찾을 수 없음");
  // 그 위치의 <table>까지 거슬러 올라가서 슬라이스 시작
  const tableStart = html.lastIndexOf("<table", start);
  const tableEnd = html.indexOf("</table>", start);
  if (tableStart < 0 || tableEnd < 0) throw new Error("</table> 매칭 실패");
  return html.slice(tableStart, tableEnd + "</table>".length);
}

/** <tr> 단위로 분할 (단순 split — 표 안에 중첩 table 없다는 전제) */
function splitRows(tableHtml: string): string[] {
  const rows: string[] = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableHtml)) !== null) rows.push(m[1]);
  return rows;
}

/** 행 헤더(<th scope="row">) 추출 — "남" / "여" / "합계" / "비율" 등 */
function rowLabel(rowHtml: string): string {
  const m = rowHtml.match(/<th[^>]*scope=["']row["'][^>]*>([\s\S]*?)<\/th>/);
  if (!m) return "";
  return m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
}

/** <td title="..."> 매핑 (값 행 한 줄을 CareerRow로) */
function parseRow(rowHtml: string): CareerRow {
  const row = emptyRow();
  const re = /<td\s+[^>]*title=["']([^"']+)["'][^>]*>([\s\S]*?)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml)) !== null) {
    const title = m[1].trim();
    const valueText = m[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
    const key = TITLE_KEY[title];
    if (!key) continue;
    const n = parseFloat(valueText);
    if (!Number.isNaN(n)) row[key] = n;
  }
  return row;
}

export function parseCareerHtml(html: string, opts: { schoolName?: string; year?: number } = {}): CareerData {
  const table = extractSecondTable(html);
  const rows = splitRows(table);

  let male = emptyRow();
  let female = emptyRow();
  let total = emptyRow();
  let ratePct = emptyRow();

  for (const r of rows) {
    const label = rowLabel(r);
    if (!label) continue;
    if (label === "남") male = parseRow(r);
    else if (label === "여") female = parseRow(r);
    else if (label === "합계") total = parseRow(r);
    else if (label === "비율") ratePct = parseRow(r);
  }

  return {
    schoolName: opts.schoolName ?? null,
    year: opts.year ?? null,
    male, female, total, ratePct,
    totalGraduatesFromTable: total.graduates,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("사용법: tsx scripts/parse-career.ts <html-path> [--school 학교명] [--year YYYY]");
    process.exit(1);
  }
  const htmlPath = args[0];
  const schoolIdx = args.indexOf("--school");
  const yearIdx = args.indexOf("--year");
  const schoolName = schoolIdx >= 0 ? args[schoolIdx + 1] : undefined;
  const year = yearIdx >= 0 ? Number(args[yearIdx + 1]) : undefined;

  const html = await readFile(htmlPath, "utf-8");
  const data = parseCareerHtml(html, { schoolName, year });

  console.log(JSON.stringify(data, null, 2));

  // 검증 출력
  const t = data.total;
  const sum = t.generalHigh + t.vocationalHigh + t.specialPurposeSubtotal +
              t.autonomousSubtotal + t.other + t.employed + t.altEducation + t.unemployed;
  console.error(`\n[검증] 졸업자=${t.graduates}, 분류 합=${sum} → ${t.graduates === sum ? "OK" : "MISMATCH"}`);
  console.error(`[남+여=합계 검증] ${male_plus_female(data)} vs ${t.graduates} → ${male_plus_female(data) === t.graduates ? "OK" : "MISMATCH"}`);
}

function male_plus_female(d: CareerData): number {
  return d.male.graduates + d.female.graduates;
}

// CLI 진입점 — 직접 실행 시만 (import 시에는 skip)
if (process.argv[1]?.endsWith("/parse-career.ts")) {
  main().catch((err) => {
    console.error("실패:", err);
    process.exit(1);
  });
}
