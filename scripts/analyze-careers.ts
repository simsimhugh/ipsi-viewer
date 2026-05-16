/**
 * schools-with-career.jsonl → 상위 학교 분석.
 *
 * 사용자가 처음 원했던 핵심: "어느 중학교가 특목·자사·과학·외고에 얼마나 보내는가"를
 * 한 번에 표로 보기.
 *
 * CLI:
 *   tsx scripts/analyze-careers.ts [path] [--sort key] [--top N] [--sido 서울,경기]
 *
 *   --sort 옵션 (CareerRow 키 또는 "elite"):
 *     elite (default)              → (특목+자사) / 졸업자 비율 내림차순
 *     specialPurposeSubtotal       → 특목고 인원
 *     privateAutonomous            → 자사고 인원
 *     scienceHigh / foreignIntlHigh / ...
 */
import { readFile } from "node:fs/promises";

interface CareerRow {
  graduates: number;
  generalHigh: number; vocationalHigh: number;
  scienceHigh: number; foreignIntlHigh: number;
  artsSportsHigh: number; meisterHigh: number;
  specialPurposeSubtotal: number;
  privateAutonomous: number; publicAutonomous: number;
  autonomousSubtotal: number;
  other: number; advancedTotal: number;
  employed: number; altEducation: number; unemployed: number;
}

interface SchoolRecord {
  SHL_IDF_CD: string;
  schoolName: string;
  sidoName: string;
  kind: string;
  career: null | {
    year: number;
    total: CareerRow; male: CareerRow; female: CareerRow; ratePct: CareerRow;
  };
}

function get(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const eliteCount = (t: CareerRow) => t.specialPurposeSubtotal + t.autonomousSubtotal;
const elitePct   = (t: CareerRow) => t.graduates > 0 ? eliteCount(t) / t.graduates * 100 : 0;

/** 한글 1글자 = 2칸으로 보고 padding (대략적). */
function padK(s: string, width: number): string {
  const visible = [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, width - visible));
}

async function main() {
  const inputPath = process.argv[2]?.startsWith("--") ? "data/schools-with-career.jsonl" : (process.argv[2] ?? "data/schools-with-career.jsonl");
  const sort = get("--sort") ?? "elite";
  const topN = Number(get("--top") ?? 20);
  const sidoFilter = get("--sido")?.split(",").map(s => s.trim());

  const raw = await readFile(inputPath, "utf-8");
  let records: SchoolRecord[] = raw.split("\n").filter(s => s.trim()).map(l => JSON.parse(l));
  const beforeFilter = records.length;
  records = records.filter(r => r.career != null);
  if (sidoFilter) records = records.filter(r => sidoFilter.includes(r.sidoName));
  console.log(`[input] ${beforeFilter}건 → 진로 있는 ${records.length}건${sidoFilter ? ` (지역: ${sidoFilter.join(",")})` : ""}`);

  records.sort((a, b) => {
    const ta = a.career!.total, tb = b.career!.total;
    let va: number, vb: number;
    if (sort === "elite") { va = elitePct(ta); vb = elitePct(tb); }
    else { va = (ta as Record<string, number>)[sort] ?? 0; vb = (tb as Record<string, number>)[sort] ?? 0; }
    return vb - va;
  });

  const top = records.slice(0, topN);
  console.log(`\n[상위 ${topN}교 — 정렬: ${sort}]`);
  console.log(
    padK("학교명", 22) + padK("지역", 6) + padK("졸업", 6) +
    padK("일반", 6) + padK("과학", 6) + padK("외고", 6) +
    padK("자사", 6) + padK("자공", 6) + padK("특목+자사", 12) + "엘리트%",
  );
  console.log("─".repeat(80));
  for (const r of top) {
    const t = r.career!.total;
    const elite = eliteCount(t);
    const pct = elitePct(t).toFixed(1);
    console.log(
      padK(r.schoolName, 22) +
      padK(r.sidoName, 6) +
      padK(String(t.graduates), 6) +
      padK(String(t.generalHigh), 6) +
      padK(String(t.scienceHigh), 6) +
      padK(String(t.foreignIntlHigh), 6) +
      padK(String(t.privateAutonomous), 6) +
      padK(String(t.publicAutonomous), 6) +
      padK(String(elite), 12) +
      pct + "%",
    );
  }
}

if (process.argv[1]?.endsWith("/analyze-careers.ts")) {
  main().catch(err => { console.error("실패:", err); process.exit(1); });
}
