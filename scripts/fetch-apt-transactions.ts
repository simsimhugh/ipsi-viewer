/**
 * 국토부 아파트 실거래가 API fetch.
 *
 * 환경변수:
 *   PUBLIC_DATA_API_KEY  — data.go.kr 발급 서비스 키 (decoded).
 *
 * 시·군·구 LAWD_CD 5자리 + 계약년월(YYYYMM) 조합으로 호출.
 * 출력: data/transactions/{lawd_cd}/{yyyymm}.jsonl
 *
 * 사용:
 *   PUBLIC_DATA_API_KEY=xxx tsx scripts/fetch-apt-transactions.ts \
 *     --lawd 41135 --from 202401 --to 202412
 *
 * Rate limit: 트래픽 제한 일별 (계정 등급별). 본 script는 200ms sleep.
 *
 * TODO: 키 도착 후
 *   1. .env.local에 PUBLIC_DATA_API_KEY 추가
 *   2. 시·군·구 LAWD_CD 목록 정의 (수도권 우선)
 *   3. apartments 테이블의 (name, sigungu)로 grouping 후 transactions 적재.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.PUBLIC_DATA_API_KEY;
const ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";

interface AptTradeItem {
  aptNm?: string;        // 단지명
  umdNm?: string;        // 법정동
  dealAmount?: string;   // 거래금액(만원, comma)
  excluUseAr?: string;   // 전용면적
  dealYear?: string;
  dealMonth?: string;
  dealDay?: string;
  floor?: string;
  buildYear?: string;
  jibun?: string;
  roadNm?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchMonth(lawdCd: string, yyyymm: string): Promise<AptTradeItem[]> {
  if (!API_KEY) throw new Error("PUBLIC_DATA_API_KEY env 누락");
  const params = new URLSearchParams({
    serviceKey: API_KEY,
    LAWD_CD: lawdCd,
    DEAL_YMD: yyyymm,
    numOfRows: "1000",
    pageNo: "1",
    _type: "json",
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`data.go.kr ${res.status}`);
  const text = await res.text();
  // 일부 응답이 XML로 오는 경우 graceful skip.
  if (text.startsWith("<")) {
    console.warn(`  ${yyyymm}: XML 응답 — 키 형식·인코딩 확인 필요`);
    return [];
  }
  const json = JSON.parse(text) as {
    response?: { body?: { items?: { item?: AptTradeItem | AptTradeItem[] } } };
  };
  const item = json.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = [parseInt(from.slice(0, 4)), parseInt(from.slice(4, 6))];
  const [ye, me] = [parseInt(to.slice(0, 4)), parseInt(to.slice(4, 6))];
  while (y * 100 + m <= ye * 100 + me) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

async function main() {
  if (!API_KEY) {
    console.error("[fetch-apt-transactions] PUBLIC_DATA_API_KEY env 누락 — graceful exit.");
    console.error("  발급: https://www.data.go.kr → 국토교통부_아파트매매 실거래자료 API 신청");
    console.error("  사용 예시:");
    console.error("    PUBLIC_DATA_API_KEY=xxx tsx scripts/fetch-apt-transactions.ts \\");
    console.error("      --lawd 41135 --from 202401 --to 202412");
    process.exit(0);
  }

  const lawd = arg("lawd");
  const from = arg("from");
  const to   = arg("to");
  if (!lawd || !from || !to) {
    console.error("필수 인자: --lawd <5자리 LAWD_CD> --from YYYYMM --to YYYYMM");
    process.exit(1);
  }

  const outDir = path.join("data", "transactions", lawd);
  await mkdir(outDir, { recursive: true });

  const months = monthsBetween(from, to);
  let total = 0;
  for (const ym of months) {
    try {
      const items = await fetchMonth(lawd, ym);
      const filePath = path.join(outDir, `${ym}.jsonl`);
      await writeFile(filePath, items.map((it) => JSON.stringify(it)).join("\n") + (items.length ? "\n" : ""), "utf-8");
      total += items.length;
      console.log(`  ${ym}: ${items.length}건 → ${filePath}`);
    } catch (e) {
      console.warn(`  ${ym}: ${(e as Error).message}`);
    }
    await sleep(200);
  }
  console.log(`\n✅ 저장 완료: ${months.length}개월, 총 ${total}건`);
}

if (process.argv[1]?.endsWith("/fetch-apt-transactions.ts")) {
  main().catch((err) => { console.error("❌ 실패:", err); process.exit(1); });
}
