/**
 * 학교 리스트를 받아 진로 데이터를 안전한 속도로 batch fetch.
 *
 * 안전 정책 (docs/03-data-sources.md §1):
 *   - 워커 N개 (기본 2)
 *   - 워커당 시작 시 300~800ms jitter
 *   - 실패 시 지수 backoff (1→2→4→8→16s, 최대 5회 재시도)
 *   - "데이터 없음(b06 미발견)"은 재시도 무의미 → 즉시 skip
 *
 * 출력: JSONL (한 줄 = 한 학교). 매 record마다 즉시 flush (도중 중단 시 부분 결과 보존).
 *
 * CLI:
 *   tsx scripts/batch-fetch.ts <shl-list.txt> [--out result.jsonl]
 *        [--workers 2] [--year 2025] [--save-html]
 *
 * shl-list.txt 형식: 한 줄에 한 SHL_IDF_CD. # 시작은 주석.
 */
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchCareer, NoCareerDataError } from "./fetch-career.ts";
import { parseCareerHtml, CareerTableMissingError } from "./parse-career.ts";

interface CliArgs {
  schoolsPath: string;
  outPath: string;
  workers: number;
  years: string[];
  saveHtml: boolean;
}

function parseCli(): CliArgs {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("사용법: tsx scripts/batch-fetch.ts <shl-list.txt> [--out result.jsonl] [--workers 3] [--years 2023,2024,2025] [--save-html]");
    process.exit(1);
  }
  const schoolsPath = args[0];
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const yearsRaw = get("--years") ?? get("--year") ?? "2025";
  const years = yearsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    schoolsPath,
    outPath: get("--out") ?? "data/career-batch.jsonl",
    workers: Number(get("--workers") ?? 3),
    years,
    saveHtml: args.includes("--save-html"),
  };
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const jitter = () => 300 + Math.random() * 500; // 300~800ms

/** 지수 backoff 재시도. `skipPredicate`가 true면 즉시 throw (재시도 안 함). */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: { max?: number; skipPredicate?: (e: unknown) => boolean } = {},
): Promise<T> {
  const max = opts.max ?? 5;
  let delay = 1000;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (e) {
      if (opts.skipPredicate?.(e)) throw e;
      if (i === max - 1) throw e;
      console.warn(`  ! ${label} 실패 (${(e as Error).message}) — ${delay}ms 후 재시도 ${i+1}/${max}`);
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error("unreachable");
}

/** 워커 N개로 items 큐를 소비. 각 워커는 끝낼 때까지 다음 item을 가져감. */
export async function runWithLimit<T>(items: T[], limit: number, worker: (item: T, idx: number) => Promise<void>) {
  let index = 0;
  async function lane() {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

async function main() {
  const cli = parseCli();
  const t0 = performance.now();

  const raw = await readFile(cli.schoolsPath, "utf-8");
  const schools = raw.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  const totalCalls = schools.length * cli.years.length;
  console.log(`[CFG] schools=${schools.length}, years=[${cli.years.join(",")}], total calls=${totalCalls}, workers=${cli.workers}, out=${cli.outPath}`);

  await mkdir(dirname(cli.outPath), { recursive: true });
  const fh = await open(cli.outPath, "w");

  let done = 0, failed = 0, skipped = 0, processed = 0;
  await runWithLimit(schools, cli.workers, async (SHL, idx) => {
    for (const year of cli.years) {
      await sleep(jitter());
      const tag = `${SHL.slice(0, 8)}/${year}`;
      try {
        const { html, schoolName } = await withRetry(
          () => fetchCareer(SHL, { year }),
          tag,
          { skipPredicate: (e) => e instanceof NoCareerDataError || e instanceof CareerTableMissingError },
        );
        const parsed = parseCareerHtml(html, { schoolName, year: Number(year) });
        const record = { SHL_IDF_CD: SHL, schoolName, year: Number(year), data: parsed };
        await fh.write(JSON.stringify(record) + "\n");
        done++;
      } catch (e) {
        if (e instanceof NoCareerDataError || e instanceof CareerTableMissingError) {
          skipped++;
        } else {
          failed++;
          console.error(`  ✗ ${tag} 실패: ${(e as Error).message}`);
        }
      }
      processed++;
      if (processed % 200 === 0) {
        const elapsed = ((performance.now() - t0) / 1000);
        const rate = (processed / elapsed).toFixed(1);
        const etaMin = ((totalCalls - processed) / Number(rate) / 60).toFixed(1);
        console.log(`  [${processed}/${totalCalls}] ${elapsed.toFixed(0)}s ${rate}/s, ETA ${etaMin}min — 성공 ${done} / skip ${skipped} / 실패 ${failed}`);
      }
    }
  });

  await fh.close();
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\n총 ${totalCalls} 호출 — 성공 ${done} / skip ${skipped} / 실패 ${failed}, ${elapsed}s`);
  console.log(`출력: ${cli.outPath}`);
}

// CLI 진입점 — 직접 실행 시만 (import 시에는 skip)
if (process.argv[1]?.endsWith("/batch-fetch.ts")) {
  main().catch((err) => { console.error("실패:", err); process.exit(1); });
}
