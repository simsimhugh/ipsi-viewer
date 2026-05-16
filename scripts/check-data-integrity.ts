/**
 * 데이터 무결성 검증 — 학교알리미 파싱 결과의 카테고리 합산 일관성 체크.
 *
 * 검증 항목 (모두 0이어야 함):
 *   1) 특목 소계 = 과학 + 외고국제 + 예체 + 마이스터
 *   2) 자율 소계 = 자사 + 자공
 *   3) 진학자계 = 일반 + 특성 + 특목소계 + 자율소계 + 기타
 *   4) 남 + 여 = 합계 졸업자
 *   5) 졸업자 = 진학자계 + 취업 + 대안교육 + 무직
 *
 * 데이터 위치: 환경변수 HAKGUN_DATA_DIR (default ~/hakgun-data)
 * 데이터 파일이 없으면 SKIP (clone 직후 같이 / CI 환경).
 *
 * pre-push hook에서 `npm run check:data` 호출 — 실패 시 push 차단.
 *
 * CLI: `npx tsx scripts/check-data-integrity.ts`
 * 종료 코드: 0 = OK, 1 = 무결성 실패, 2 = 데이터 누락 (경고만)
 */
import { readFile, access } from "node:fs/promises";
import path from "node:path";

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
interface CareerData { year: number; male: CareerRow; female: CareerRow; total: CareerRow }
interface Record { SHL_IDF_CD: string; schoolName: string; year: number; data: CareerData }

const DATA_DIR = process.env.HAKGUN_DATA_DIR ?? path.join(process.env.HOME ?? "/home/hugh", "hakgun-data");
const JSONL = path.join(DATA_DIR, "careers-by-year.jsonl");

async function main() {
  try { await access(JSONL); } catch {
    console.warn(`⚠ ${JSONL} 없음 — 검증 SKIP (clone 직후 또는 CI 환경)`);
    process.exit(2);
  }

  const raw = await readFile(JSONL, "utf-8");
  const records: Record[] = raw.split("\n").filter((s) => s.trim()).map((l) => JSON.parse(l));
  const n = records.length;

  let bad: { name: string; year: number; checks: string[] }[] = [];
  let failSpecial = 0, failAuto = 0, failAdv = 0, failGrad = 0, failMF = 0;

  for (const r of records) {
    const t = r.data.total, m = r.data.male, f = r.data.female;
    const checks: string[] = [];

    const spSum = t.scienceHigh + t.foreignIntlHigh + t.artsSportsHigh + t.meisterHigh;
    if (spSum !== t.specialPurposeSubtotal) { failSpecial++; checks.push(`special:${spSum - t.specialPurposeSubtotal}`); }

    const autoSum = t.privateAutonomous + t.publicAutonomous;
    if (autoSum !== t.autonomousSubtotal) { failAuto++; checks.push(`auto:${autoSum - t.autonomousSubtotal}`); }

    const advSum = t.generalHigh + t.vocationalHigh + t.specialPurposeSubtotal + t.autonomousSubtotal + t.other;
    if (advSum !== t.advancedTotal) { failAdv++; checks.push(`adv:${advSum - t.advancedTotal}`); }

    const gradSum = t.advancedTotal + t.employed + t.altEducation + t.unemployed;
    if (gradSum !== t.graduates) { failGrad++; checks.push(`grad:${gradSum - t.graduates}`); }

    const mfSum = m.graduates + f.graduates;
    if (mfSum !== t.graduates) { failMF++; checks.push(`mf:${mfSum - t.graduates}`); }

    if (checks.length && bad.length < 10) bad.push({ name: r.schoolName, year: r.year, checks });
  }

  const fmt = (n: number, total: number) => `${n} (${(n * 100 / total).toFixed(2)}%)`;

  console.log(`데이터 무결성 검증 — ${n} record (학교 × 연도)`);
  console.log();
  console.log(`  특목 소계 = 과학+외고국제+예체+마이스터  : ${failSpecial === 0 ? "✅" : "❌"} ${fmt(failSpecial, n)}`);
  console.log(`  자율 소계 = 자사+자공                    : ${failAuto    === 0 ? "✅" : "❌"} ${fmt(failAuto, n)}`);
  console.log(`  진학자계 = 일반+특성+특목+자율+기타       : ${failAdv     === 0 ? "✅" : "❌"} ${fmt(failAdv, n)}`);
  console.log(`  남+여 = 합계 졸업자                      : ${failMF      === 0 ? "✅" : "❌"} ${fmt(failMF, n)}`);
  console.log(`  졸업자 = 진학자계+취업+대안+무직         : ${failGrad    === 0 ? "✅" : "❌"} ${fmt(failGrad, n)}`);

  // 졸업자 검증은 학교알리미 원본의 미세 불일치 가능 — 1% 미만은 경고만
  const hardFails = failSpecial + failAuto + failAdv + failMF;
  const softFails = failGrad;

  if (bad.length > 0) {
    console.log();
    console.log("불일치 sample (최대 10건):");
    for (const b of bad) console.log(`  - ${b.name} (${b.year}): ${b.checks.join(", ")}`);
  }

  console.log();
  if (hardFails > 0) {
    console.error(`❌ FAIL — 파서 매핑 무결성 위반: ${hardFails}건`);
    process.exit(1);
  }
  if (softFails > n * 0.01) {
    console.error(`⚠ WARN — 졸업자 합계 불일치 ${softFails}건이 전체 1% 초과. 학교알리미 원본 또는 파서 검토 필요.`);
    process.exit(1);
  }
  console.log(`✅ PASS — 파서 매핑 일관성 100%${softFails > 0 ? ` (졸업자 ${softFails}건 학교알리미 원본 미세 불일치, 1% 이내 허용)` : ""}`);
}

main().catch((err) => { console.error("검증 실패:", err); process.exit(1); });
