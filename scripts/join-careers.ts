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
  console.log(`[input] master=${master.length}, careers=${careers.length}`);

  const careerBy = new Map<string, CareerBatchRecord>();
  for (const c of careers) careerBy.set(c.SHL_IDF_CD, c);

  const out: unknown[] = [];
  let withCareer = 0;
  for (const m of master) {
    const c = careerBy.get(m.SHL_IDF_CD);
    if (c) withCareer++;
    out.push({
      ...m,
      career: c
        ? { year: c.year, ...(c.data as Record<string, unknown>) }
        : null,
    });
  }

  await writeFile(outPath, out.map(r => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  console.log(`[out] ${outPath} — 총 ${master.length}건 (진로 매칭 ${withCareer})`);
}

if (process.argv[1]?.endsWith("/join-careers.ts")) {
  main().catch(err => { console.error("실패:", err); process.exit(1); });
}
