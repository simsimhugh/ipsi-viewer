/**
 * 학교 마스터 + 진로 데이터를 학교 단위로 join.
 *
 * 입력:
 *   - master.jsonl  : { SHL_IDF_CD, schoolName, sidoCode, sidoName, sdSchulCode, kind }
 *   - careers.jsonl : { SHL_IDF_CD, schoolName, year, data: CareerData }
 *
 * 출력 (Firestore 적재 형식 후보):
 *   {
 *     SHL_IDF_CD, schoolName, sidoCode, sidoName, sdSchulCode, kind,
 *     career: { year, total, male, female, ratePct } | null
 *   }
 *
 * CLI:
 *   tsx scripts/join-careers.ts --master data/school-master.jsonl \
 *     --careers data/careers.jsonl --out data/schools-with-career.jsonl
 */
import { readFile, writeFile } from "node:fs/promises";

interface MasterRecord {
  SHL_IDF_CD: string;
  schoolName: string;
  sidoCode: string;
  sidoName: string;
  sdSchulCode: string;
  kind: string;
}

interface CareerBatchRecord {
  SHL_IDF_CD: string;
  schoolName: string;
  year: number;
  data: unknown; // parse-career.ts의 CareerData
}

function get(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf-8");
  return raw.split("\n").map(s => s.trim()).filter(Boolean).map(l => JSON.parse(l) as T);
}

async function main() {
  const masterPath = get("--master") ?? "data/school-master.jsonl";
  const careersPath = get("--careers") ?? "data/careers.jsonl";
  const outPath = get("--out") ?? "data/schools-with-career.jsonl";

  const master = await readJsonl<MasterRecord>(masterPath);
  const careers = await readJsonl<CareerBatchRecord>(careersPath);
  console.log(`[input] master=${master.length}, careers=${careers.length} (학교 × 연도)`);

  // SHL_IDF_CD 별로 careersByYear group
  const careersByMap = new Map<string, Record<string, unknown>>();
  for (const c of careers) {
    const cur = careersByMap.get(c.SHL_IDF_CD) ?? {};
    cur[String(c.year)] = c.data;
    careersByMap.set(c.SHL_IDF_CD, cur);
  }

  const out: unknown[] = [];
  let withCareer = 0;
  let yearCounts = new Map<string, number>();
  for (const m of master) {
    const byYear = careersByMap.get(m.SHL_IDF_CD);
    if (byYear) withCareer++;
    // 옛 career 필드 — 가장 최근 연도 (backward compat)
    let careerLegacy: unknown = null;
    if (byYear) {
      const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));
      for (const y of years) yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
      const newest = years[0];
      const data = byYear[newest] as Record<string, unknown>;
      careerLegacy = { year: Number(newest), ...data };
    }
    out.push({
      ...m,
      careersByYear: byYear
        ? Object.fromEntries(
            Object.entries(byYear).map(([y, data]) => [y, { year: Number(y), ...(data as Record<string, unknown>) }]),
          )
        : undefined,
      career: careerLegacy,
    });
  }

  await writeFile(outPath, out.map(r => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  console.log(`[out] ${outPath} — 총 ${master.length}건 (진로 매칭 ${withCareer})`);
  console.log("연도별 매칭:");
  for (const [y, n] of [...yearCounts].sort()) console.log(`  ${y}: ${n}`);
}

if (process.argv[1]?.endsWith("/join-careers.ts")) {
  main().catch(err => { console.error("실패:", err); process.exit(1); });
}
