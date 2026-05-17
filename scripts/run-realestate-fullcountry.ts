/**
 * 전국 × N개월 부동산 fetch — 매매 (RTMSDataSvcAptTradeDev) + 전월세 (RTMSDataSvcAptRent).
 *
 * 결과 (per LAWD × month × type): ~/hakgun-data/realestate/fullcountry/<YYYYMM>-<lawd>-<type>.jsonl
 * - 파일 존재하면 skip (idempotent).
 * - 워커 5, 200~500ms jitter (rate-limit 안전).
 * - 진행: 50 호출마다 ETA stdout.
 *
 * 환경:
 *   PUBLIC_DATA_API_KEY (필수)
 *   HAKGUN_DATA_DIR (선택)
 *
 * 인자:
 *   --months <YYYYMM,YYYYMM,...>   : 명시 (기본: 최근 12개월)
 *   --recent <N>                   : 최근 N개월 (기본 12)
 *   --type <trade|rent|both>       : 기본 both
 *   --lawd-filter <a,b,c>          : 일부 시·군·구 코드만
 *   --workers <N>                  : 기본 5
 *
 * 사용:
 *   tsx scripts/run-realestate-fullcountry.ts --recent 12 --type both --workers 5
 */
import { mkdir, writeFile, access, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ALL_LAWD_CODES, type LawdEntry } from "./lawd-codes-all.js";

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

const PUBLIC_KEY = process.env.PUBLIC_DATA_API_KEY;
const USER_AGENT = "Mozilla/5.0";

const ENDPOINTS = {
  trade: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
  rent: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
} as const;

type FetchType = "trade" | "rent";

const DATA_DIR = process.env.HAKGUN_DATA_DIR ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");
const OUT_DIR = path.join(DATA_DIR, "realestate", "fullcountry");

// ─── 공통 records (매매 / 전월세) ────────────────────────────────────────
export interface TradeRecord {
  type: "trade";
  lawd_cd: string;
  deal_ym: string;
  apt_name: string;
  sigungu: string;
  jibun: string;
  road_name: string;
  area_m2: number | null;
  price_man_won: number | null;
  floor: number | null;
  build_year: number | null;
  deal_day: string;
}

export interface RentRecord {
  type: "rent";
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

export type AnyRecord = TradeRecord | RentRecord;

// ─── helpers ───────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function toNumber(s: string | undefined): number | null {
  if (!s) return null;
  const c = s.replace(/,/g, "").trim();
  if (!c) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

function recentMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  // 이번 달은 데이터 보고 누락 가능성이 높아 1달 이전부터 시작
  m--;
  if (m < 1) { m = 12; y--; }
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}${String(m).padStart(2, "0")}`);
    m--;
    if (m < 1) { m = 12; y--; }
  }
  return out;
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

function toTradeRecord(raw: Record<string, string>, lawdCd: string, dealYm: string): TradeRecord | null {
  const aptName = (raw.aptNm ?? "").trim();
  if (!aptName) return null;
  const y = raw.dealYear ?? dealYm.slice(0, 4);
  const m = raw.dealMonth ?? dealYm.slice(4, 6);
  const d = raw.dealDay ?? "";
  const dealDay = d
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : `${y}-${String(m).padStart(2, "0")}-01`;
  return {
    type: "trade",
    lawd_cd: lawdCd,
    deal_ym: dealYm,
    apt_name: aptName,
    sigungu: (raw.umdNm ?? "").trim(),
    jibun: (raw.jibun ?? "").trim(),
    road_name: (raw.roadNm ?? "").trim(),
    area_m2: toNumber(raw.excluUseAr),
    price_man_won: toNumber(raw.dealAmount),
    floor: toNumber(raw.floor),
    build_year: toNumber(raw.buildYear),
    deal_day: dealDay,
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
    type: "rent",
    lawd_cd: lawdCd,
    deal_ym: dealYm,
    apt_name: aptName,
    sigungu: (raw.umdNm ?? "").trim(),
    jibun: (raw.jibun ?? "").trim(),
    road_name: (raw.roadNm ?? "").trim(),
    area_m2: toNumber(raw.excluUseAr),
    // 전월세 응답: deposit (보증금만원), monthlyRent (월세만원)
    deposit_man_won: toNumber(raw.deposit),
    monthly_rent_man_won: toNumber(raw.monthlyRent),
    floor: toNumber(raw.floor),
    build_year: toNumber(raw.buildYear),
    deal_day: dealDay,
  };
}

async function fetchMonth(type: FetchType, lawdCd: string, dealYm: string): Promise<AnyRecord[]> {
  const out: AnyRecord[] = [];
  let pageNo = 1;
  const numOfRows = 1000;
  const endpoint = ENDPOINTS[type];
  while (true) {
    const params = new URLSearchParams({
      serviceKey: PUBLIC_KEY!,
      LAWD_CD: lawdCd,
      DEAL_YMD: dealYm,
      numOfRows: String(numOfRows),
      pageNo: String(pageNo),
    });
    const res = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      // 429 등은 backoff 후 한 번 재시도
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000);
        continue;
      }
      throw new Error(`${type} ${lawdCd}/${dealYm} HTTP ${res.status}`);
    }
    const xml = await res.text();
    const meta = parseXmlMeta(xml);
    if (meta.resultCode && meta.resultCode !== "00" && meta.resultCode !== "000") {
      // 03 = 데이터없음 등 normal
      if (meta.resultCode !== "03") {
        console.warn(`  [${type} ${lawdCd}/${dealYm}] result=${meta.resultCode} ${meta.resultMsg ?? ""}`);
      }
      break;
    }
    const items = parseXmlItems(xml);
    for (const raw of items) {
      const rec = type === "trade" ? toTradeRecord(raw, lawdCd, dealYm) : toRentRecord(raw, lawdCd, dealYm);
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

interface Task {
  lawd: LawdEntry;
  ym: string;
  type: FetchType;
}

function taskOutPath(t: Task): string {
  return path.join(OUT_DIR, `${t.ym}-${t.lawd.code}-${t.type}.jsonl`);
}

async function fileExistsNonEmpty(file: string): Promise<boolean> {
  try {
    await access(file);
    const st = await stat(file);
    return st.size >= 0; // exists — 빈 파일도 valid (0건 보고)
  } catch {
    return false;
  }
}

async function runWorkerPool<T>(items: T[], workers: number, fn: (t: T, idx: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const total = items.length;
  const startedAt = Date.now();
  async function loop() {
    while (true) {
      const idx = cursor++;
      if (idx >= total) break;
      try {
        await fn(items[idx], idx);
      } catch (e) {
        console.warn(`  task ${idx} 실패: ${(e as Error).message}`);
      }
      // jitter 200~500ms
      await sleep(200 + Math.random() * 300);
      if (((idx + 1) % 50) === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = (idx + 1) / elapsed;
        const remaining = (total - idx - 1) / Math.max(rate, 0.001);
        console.log(`  ${idx + 1}/${total} done, elapsed=${Math.round(elapsed)}s ETA=${Math.round(remaining / 60)}min`);
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, () => loop()));
}

async function main(): Promise<void> {
  if (!PUBLIC_KEY) {
    console.error("[fullcountry] PUBLIC_DATA_API_KEY env 누락");
    process.exit(1);
  }

  // 인자 파싱
  const monthsArg = arg("months");
  const recentArg = arg("recent");
  const typeArg = (arg("type") ?? "both") as "trade" | "rent" | "both";
  const lawdFilterArg = arg("lawd-filter");
  const workers = parseInt(arg("workers") ?? "5");

  const months: string[] = monthsArg
    ? monthsArg.split(",").map((s) => s.trim()).filter(Boolean)
    : recentMonths(parseInt(recentArg ?? "12"));

  let lawdList: LawdEntry[] = ALL_LAWD_CODES;
  if (lawdFilterArg) {
    const set = new Set(lawdFilterArg.split(",").map((s) => s.trim()).filter(Boolean));
    lawdList = ALL_LAWD_CODES.filter((r) => set.has(r.code));
  }

  const types: FetchType[] = typeArg === "both" ? ["trade", "rent"] : [typeArg];

  await mkdir(OUT_DIR, { recursive: true });

  // 모든 task 생성, 이미 fetch한 것 skip
  const allTasks: Task[] = [];
  for (const lawd of lawdList) {
    for (const ym of months) {
      for (const t of types) {
        allTasks.push({ lawd, ym, type: t });
      }
    }
  }
  console.log(`[fullcountry] lawd=${lawdList.length}, months=${months.length}, types=${types.join("+")}, total tasks=${allTasks.length}`);
  console.log(`  out dir: ${OUT_DIR}`);

  const todo: Task[] = [];
  let skipped = 0;
  for (const t of allTasks) {
    const out = taskOutPath(t);
    if (await fileExistsNonEmpty(out)) {
      skipped++;
      continue;
    }
    todo.push(t);
  }
  console.log(`  skip(이미 fetch): ${skipped}, todo: ${todo.length}, workers=${workers}`);

  let totalRecords = 0;
  let zeroCount = 0;
  await runWorkerPool(todo, workers, async (t) => {
    const recs = await fetchMonth(t.type, t.lawd.code, t.ym);
    const lines = recs.map((r) => JSON.stringify(r)).join("\n");
    await writeFile(taskOutPath(t), lines + (lines ? "\n" : ""), "utf-8");
    totalRecords += recs.length;
    if (recs.length === 0) zeroCount++;
  });

  console.log(`\nOK 완료 — todo=${todo.length}, 0건 task=${zeroCount}, 총 record=${totalRecords}, skipped=${skipped}`);
  console.log(`  파일 위치: ${OUT_DIR}/<YYYYMM>-<lawd>-<type>.jsonl`);
}

if (process.argv[1]?.endsWith("/run-realestate-fullcountry.ts")) {
  main().catch((err) => { console.error("실패:", err); process.exit(1); });
}
