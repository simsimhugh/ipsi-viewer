/**
 * 국토부 아파트 매매 실거래가 상세 API fetch.
 *
 * Endpoint: RTMSDataSvcAptTradeDev (XML 응답)
 *   https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev
 *
 * 환경변수:
 *   PUBLIC_DATA_API_KEY  — data.go.kr decoded service key
 *
 * 인자:
 *   --lawd <CD>           : 단일 시·군·구 코드 (5자리)
 *   --lawd-list <a,b,c>   : 다수 시·군·구 콤마 구분
 *   --from YYYYMM         : 시작 계약년월
 *   --to YYYYMM           : 종료 계약년월 (inclusive)
 *   --months <N>          : --from/--to 대신 N개월 (오늘 기준 거꾸로)
 *   --workers <N>         : 동시 실행 (default 3)
 *   --out <path>          : 출력 JSONL path (default ~/hakgun-data/apt-transactions.jsonl)
 *
 * 출력 (JSONL — line 별 1 거래):
 *   { lawd_cd, deal_ym, apt_name, sigungu, jibun, road_name, area_m2,
 *     price_man_won, floor, build_year, deal_day }
 *
 * 사용:
 *   PUBLIC_DATA_API_KEY=xxx tsx scripts/fetch-apt-transactions.ts \
 *     --lawd-list 11680,11710 --months 6
 */
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.PUBLIC_DATA_API_KEY;
const ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";
const USER_AGENT = "Mozilla/5.0";
const DEFAULT_OUT = path.join(process.env.HOME ?? "/home/hugh", "hakgun-data", "apt-transactions.jsonl");

export interface AptTxRecord {
  lawd_cd: string;
  deal_ym: string;
  apt_name: string;
  sigungu: string;     // 법정동 (umdNm)
  jibun: string;
  road_name: string;
  area_m2: number | null;
  price_man_won: number | null;
  floor: number | null;
  build_year: number | null;
  deal_day: string;    // YYYY-MM-DD
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function recentMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}${String(m).padStart(2, "0")}`);
    m--;
    if (m < 1) { m = 12; y--; }
  }
  return out;
}

/** XML에서 <item>…</item> 블록 단순 추출 (정규식 — 의존성 없음). */
function parseXmlItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const body = m[1];
    const obj: Record<string, string> = {};
    const tagRe = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(body))) {
      obj[t[1]] = t[2].trim();
    }
    items.push(obj);
  }
  return items;
}

/** XML response 에서 resultCode / resultMsg / totalCount 등 메타 추출. */
function parseXmlMeta(xml: string): { resultCode?: string; resultMsg?: string; totalCount?: number } {
  const code = /<resultCode>([\s\S]*?)<\/resultCode>/.exec(xml)?.[1]?.trim();
  const msg  = /<resultMsg>([\s\S]*?)<\/resultMsg>/.exec(xml)?.[1]?.trim();
  const tc   = /<totalCount>([\s\S]*?)<\/totalCount>/.exec(xml)?.[1]?.trim();
  return { resultCode: code, resultMsg: msg, totalCount: tc ? parseInt(tc) : undefined };
}

function toNumber(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toRecord(raw: Record<string, string>, lawdCd: string, dealYm: string): AptTxRecord | null {
  // 필드명은 RTMSDataSvcAptTradeDev 스펙 — 예: aptNm, umdNm, jibun, excluUseAr,
  //   dealAmount, dealYear, dealMonth, dealDay, floor, buildYear, roadNm.
  const aptName = raw.aptNm ?? raw.aptDong ?? "";
  if (!aptName) return null;
  const y = raw.dealYear ?? dealYm.slice(0, 4);
  const m = raw.dealMonth ?? dealYm.slice(4, 6);
  const d = raw.dealDay ?? "";
  const dealDay = d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : `${y}-${String(m).padStart(2, "0")}-01`;
  return {
    lawd_cd: lawdCd,
    deal_ym: dealYm,
    apt_name: aptName.trim(),
    sigungu: (raw.umdNm ?? "").trim(),
    jibun: (raw.jibun ?? "").trim(),
    road_name: (raw.roadNm ?? "").trim(),
    area_m2: toNumber(raw.excluUseAr),
    price_man_won: toNumber(raw.dealAmount),
    floor: toNumber(raw.floor) as number | null,
    build_year: toNumber(raw.buildYear) as number | null,
    deal_day: dealDay,
  };
}

async function fetchPage(lawdCd: string, dealYm: string, pageNo: number, numOfRows = 1000): Promise<{ items: Record<string, string>[]; totalCount?: number; resultCode?: string; resultMsg?: string }> {
  if (!API_KEY) throw new Error("PUBLIC_DATA_API_KEY env 누락");
  const params = new URLSearchParams({
    serviceKey: API_KEY,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYm,
    numOfRows: String(numOfRows),
    pageNo: String(pageNo),
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`data.go.kr ${res.status}`);
  const text = await res.text();
  const meta = parseXmlMeta(text);
  const items = parseXmlItems(text);
  return { items, ...meta };
}

async function fetchMonthAll(lawdCd: string, dealYm: string): Promise<AptTxRecord[]> {
  const out: AptTxRecord[] = [];
  let pageNo = 1;
  const numOfRows = 1000;
  while (true) {
    const { items, totalCount, resultCode, resultMsg } = await fetchPage(lawdCd, dealYm, pageNo, numOfRows);
    if (resultCode && resultCode !== "00" && resultCode !== "000") {
      console.warn(`  [${lawdCd}/${dealYm}] result=${resultCode} ${resultMsg ?? ""}`);
      break;
    }
    for (const raw of items) {
      const rec = toRecord(raw, lawdCd, dealYm);
      if (rec) out.push(rec);
    }
    const got = items.length;
    const seen = pageNo * numOfRows;
    if (totalCount != null && seen >= totalCount) break;
    if (got < numOfRows) break;
    pageNo++;
    await sleep(200 + Math.random() * 300);
  }
  return out;
}

async function runWorkerPool<T, R>(items: T[], workers: number, fn: (t: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function loop() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        console.warn(`  task ${idx} 실패: ${(e as Error).message}`);
      }
      await sleep(200 + Math.random() * 300);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => loop()));
  return results;
}

async function main() {
  if (!API_KEY) {
    console.error("[fetch-apt-transactions] PUBLIC_DATA_API_KEY env 누락 — graceful exit.");
    process.exit(0);
  }

  const lawdSingle = arg("lawd");
  const lawdList = arg("lawd-list");
  const fromYm = arg("from");
  const toYm = arg("to");
  const months = arg("months");
  const workers = parseInt(arg("workers") ?? "3");
  const outPath = arg("out") ?? DEFAULT_OUT;

  const lawdCodes: string[] = [];
  if (lawdSingle) lawdCodes.push(lawdSingle);
  if (lawdList) lawdCodes.push(...lawdList.split(",").map((s) => s.trim()).filter(Boolean));
  if (lawdCodes.length === 0) {
    console.error("필수: --lawd <CD> 또는 --lawd-list <CD,CD,...>");
    process.exit(1);
  }

  let monthList: string[] = [];
  if (months) {
    monthList = recentMonths(parseInt(months));
  } else if (fromYm && toYm) {
    monthList = monthsBetween(fromYm, toYm);
  } else {
    console.error("필수: --months <N> 또는 --from YYYYMM --to YYYYMM");
    process.exit(1);
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, "", "utf-8"); // truncate
  console.log(`[fetch-apt-transactions] lawd=${lawdCodes.length}개, months=${monthList.length}개, workers=${workers}`);
  console.log(`  out: ${outPath}`);

  // (lawd, ym) cross product
  const tasks: { lawd: string; ym: string }[] = [];
  for (const l of lawdCodes) for (const m of monthList) tasks.push({ lawd: l, ym: m });

  let totalRows = 0;
  let done = 0;
  await runWorkerPool(tasks, workers, async (t) => {
    const recs = await fetchMonthAll(t.lawd, t.ym);
    if (recs.length > 0) {
      const lines = recs.map((r) => JSON.stringify(r)).join("\n") + "\n";
      await appendFile(outPath, lines, "utf-8");
    }
    totalRows += recs.length;
    done++;
    console.log(`  [${done}/${tasks.length}] ${t.lawd}/${t.ym}: ${recs.length}건 (누적 ${totalRows})`);
  });

  console.log(`\nOK 저장 완료: ${totalRows}건 → ${outPath}`);
}

if (process.argv[1]?.endsWith("/fetch-apt-transactions.ts")) {
  main().catch((err) => { console.error("실패:", err); process.exit(1); });
}
