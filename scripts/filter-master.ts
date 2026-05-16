/**
 * 학교 마스터 JSONL 필터링 + 분포 출력.
 *
 * 일반적 사용:
 *   - 수도권 중학교만 추출 + batch-fetch에 던질 SHL 리스트로 변환
 *
 * CLI:
 *   tsx scripts/filter-master.ts <master.jsonl>
 *     [--kind 중학교[,초등학교]]
 *     [--sido 서울,경기,인천]     # 이름 또는 코드(01,04,10) 둘 다 허용
 *     [--out filtered.jsonl]      # JSONL 출력
 *     [--shl-only shls.txt]       # SHL_IDF_CD만 (batch-fetch 입력용)
 *
 * 예:
 *   tsx scripts/filter-master.ts data/school-master.jsonl \
 *     --kind 중학교 --sido 서울,경기,인천 \
 *     --out data/middle-sudogwon.jsonl \
 *     --shl-only data/middle-sudogwon.txt
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

interface CliArgs {
  inputPath: string;
  kinds: string[] | null;
  sidos: string[] | null;
  outJsonl: string | null;
  outShl: string | null;
}

function parseCli(): CliArgs {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("사용법: tsx scripts/filter-master.ts <master.jsonl> [--kind 중학교] [--sido 서울,경기,인천] [--out filtered.jsonl] [--shl-only shls.txt]");
    process.exit(1);
  }
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const csv = (v: string | null) => v ? v.split(",").map(s => s.trim()).filter(Boolean) : null;
  return {
    inputPath: args[0],
    kinds: csv(get("--kind")),
    sidos: csv(get("--sido")),
    outJsonl: get("--out"),
    outShl: get("--shl-only"),
  };
}

async function main() {
  const cli = parseCli();
  const raw = await readFile(cli.inputPath, "utf-8");
  const records: MasterRecord[] = raw.split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .map(l => JSON.parse(l));
  console.log(`[input] ${records.length} records`);

  let filtered = records;
  if (cli.kinds) {
    filtered = filtered.filter(r => cli.kinds!.includes(r.kind));
    console.log(`[filter kind=${cli.kinds.join(",")}] → ${filtered.length}`);
  }
  if (cli.sidos) {
    filtered = filtered.filter(r => cli.sidos!.includes(r.sidoName) || cli.sidos!.includes(r.sidoCode));
    console.log(`[filter sido=${cli.sidos.join(",")}] → ${filtered.length}`);
  }

  // 분포
  const distSido = new Map<string, number>();
  const distKind = new Map<string, number>();
  for (const r of filtered) {
    distSido.set(r.sidoName || "(unknown)", (distSido.get(r.sidoName) ?? 0) + 1);
    distKind.set(r.kind, (distKind.get(r.kind) ?? 0) + 1);
  }
  console.log("\n시도별:");
  for (const [k, n] of [...distSido].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
  console.log("종류별:");
  for (const [k, n] of [...distKind].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

  if (cli.outJsonl) {
    await writeFile(cli.outJsonl, filtered.map(r => JSON.stringify(r)).join("\n") + "\n", "utf-8");
    console.log(`\n[out jsonl] ${cli.outJsonl} (${filtered.length}건)`);
  }
  if (cli.outShl) {
    await writeFile(cli.outShl, filtered.map(r => r.SHL_IDF_CD).join("\n") + "\n", "utf-8");
    console.log(`[out shl-only] ${cli.outShl} (${filtered.length}건)`);
  }
}

if (process.argv[1]?.endsWith("/filter-master.ts")) {
  main().catch(err => { console.error("실패:", err); process.exit(1); });
}
