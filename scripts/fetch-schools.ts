/**
 * #4 수도권 중학교 마스터 리스트 수집
 *
 * NEIS 교육정보 개방 포털 OpenAPI(schoolInfo)에서 서울/경기/인천 중학교만 가져온다.
 * 인증키 없이 호출 시 일일 한도가 낮으므로, 향후 NEIS_API_KEY 환경변수가 있으면 사용.
 *
 * 출력: data/schools.json — [{ sdSchulCode, schoolName, sido, address, orgEnName, foundType, ... }]
 */
import { writeFile } from "node:fs/promises";

const NEIS_BASE = "https://open.neis.go.kr/hub/schoolInfo";
const SIDOS = [
  { code: "B10", name: "서울" },
  { code: "J10", name: "경기" },
  { code: "E10", name: "인천" },
] as const;
const MIDDLE_SCHOOL = "03"; // SCHUL_KND_SC_CODE: 중학교
const PAGE_SIZE = 1000;
const KEY = process.env.NEIS_API_KEY ?? "";

interface NeisSchool {
  ATPT_OFCDC_SC_CODE: string;
  ATPT_OFCDC_SC_NM: string;
  SD_SCHUL_CODE: string;
  SCHUL_NM: string;
  ENG_SCHUL_NM?: string;
  SCHUL_KND_SC_NM: string;
  LCTN_SC_NM: string;
  JU_ORG_NM?: string;
  FOND_SC_NM?: string;
  ORG_RDNZC?: string;
  ORG_RDNMA?: string;
  ORG_RDNDA?: string;
  FOAS_MEMRD?: string;
  HS_SC_NM?: string;
}

interface NeisResponse {
  schoolInfo?: Array<{
    head?: Array<{ list_total_count?: number; RESULT?: { CODE: string; MESSAGE: string } }>;
    row?: NeisSchool[];
  }>;
  RESULT?: { CODE: string; MESSAGE: string };
}

async function fetchPage(sidoCode: string, pIndex: number): Promise<NeisSchool[]> {
  const params = new URLSearchParams({
    Type: "json",
    pIndex: String(pIndex),
    pSize: String(PAGE_SIZE),
    ATPT_OFCDC_SC_CODE: sidoCode,
    SCHUL_KND_SC_CODE: MIDDLE_SCHOOL,
  });
  if (KEY) params.set("KEY", KEY);

  const url = `${NEIS_BASE}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = (await res.json()) as NeisResponse;

  // NEIS 응답: 성공 시 schoolInfo[0].head, schoolInfo[1].row 구조
  if (body.RESULT && body.RESULT.CODE !== "INFO-000") {
    if (body.RESULT.CODE === "INFO-200") return []; // 데이터 없음
    throw new Error(`NEIS error: ${body.RESULT.CODE} ${body.RESULT.MESSAGE}`);
  }

  const rows: NeisSchool[] = [];
  for (const block of body.schoolInfo ?? []) {
    if (block.row) rows.push(...block.row);
  }
  return rows;
}

async function fetchSidoSchools(sidoCode: string, sidoName: string): Promise<NeisSchool[]> {
  const all: NeisSchool[] = [];
  for (let pIndex = 1; pIndex < 20; pIndex++) {
    const page = await fetchPage(sidoCode, pIndex);
    if (page.length === 0) break;
    all.push(...page);
    process.stdout.write(`  [${sidoName}] page ${pIndex}: +${page.length} (total ${all.length})\n`);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  if (!KEY) {
    console.warn("⚠️  NEIS_API_KEY 미설정 — 익명 호출(일일 한도 매우 낮음). 키 발급 권장.");
    console.warn("    https://open.neis.go.kr → 회원가입 → 마이페이지 → 인증키 신청");
  }

  const result: Array<{
    sdSchulCode: string;
    schoolName: string;
    sido: string;
    sigungu: string;
    address: string;
    foundType: string;
    orgEnName: string;
  }> = [];

  for (const { code, name } of SIDOS) {
    console.log(`\n[수집] ${name} 중학교`);
    const rows = await fetchSidoSchools(code, name);
    for (const r of rows) {
      // NEIS의 SCHUL_KND_SC_CODE 필터링이 느슨해 고교가 섞임 — 학교종류명으로 재필터
      if (r.SCHUL_KND_SC_NM !== "중학교") continue;
      result.push({
        sdSchulCode: r.SD_SCHUL_CODE,
        schoolName: r.SCHUL_NM,
        sido: r.LCTN_SC_NM,
        sigungu: r.JU_ORG_NM ?? "",
        address: r.ORG_RDNMA ?? "",
        foundType: r.FOND_SC_NM ?? "",
        orgEnName: r.ENG_SCHUL_NM ?? "",
      });
    }
  }

  await writeFile("data/schools.json", JSON.stringify(result, null, 2), "utf-8");
  console.log(`\n✅ 저장: data/schools.json (${result.length}개)`);
  console.log(`   서울: ${result.filter(r => r.sido.includes("서울")).length}`);
  console.log(`   경기: ${result.filter(r => r.sido.includes("경기")).length}`);
  console.log(`   인천: ${result.filter(r => r.sido.includes("인천")).length}`);
}

main().catch((err) => {
  console.error("❌ 실패:", err);
  process.exit(1);
});
