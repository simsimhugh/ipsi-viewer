/**
 * 학교 데이터 타입 — scripts/parse-career.ts의 CareerRow와 동일 스키마.
 * 향후 Firestore document로 그대로 적재 가능한 형식.
 */

export interface CareerRow {
  graduates: number;
  generalHigh: number;
  vocationalHigh: number;
  scienceHigh: number;
  foreignIntlHigh: number;
  artsSportsHigh: number;
  meisterHigh: number;
  specialPurposeSubtotal: number;
  privateAutonomous: number;
  publicAutonomous: number;
  autonomousSubtotal: number;
  other: number;
  advancedTotal: number;
  employed: number;
  altEducation: number;
  unemployed: number;
}

export interface CareerData {
  year: number;
  schoolName?: string;
  male: CareerRow;
  female: CareerRow;
  total: CareerRow;
  ratePct: CareerRow;
  totalGraduatesFromTable: number;
}

export interface School {
  SHL_IDF_CD: string;
  schoolName: string;
  sidoCode: string;
  sidoName: string;
  sdSchulCode: string;
  kind: "초등학교" | "중학교" | "고등학교" | "기타";
  /** v2부터 추가 — 옛 record는 undefined */
  address?: string;
  sigungu?: string;
  lat?: number | null;
  lng?: number | null;
  /** 연도별 진로 — 예: { "2023": {...}, "2024": {...}, "2025": {...} } */
  careersByYear?: Record<string, CareerData>;
  /** backward compat — careersByYear의 가장 최근 연도 (UI가 단년 fallback 가능) */
  career: CareerData | null;
}

/** 사용 가능한 모든 연도 list (정렬됨) */
export function yearsOf(s: School): number[] {
  if (!s.careersByYear) return s.career?.year ? [s.career.year] : [];
  return Object.keys(s.careersByYear).map(Number).sort((a, b) => b - a);
}

/** 선택된 연도들의 카테고리별 합산 CareerRow. 연도가 비면 0. */
export function sumYears(s: School, years: number[]): CareerRow {
  const empty: CareerRow = {
    graduates: 0, generalHigh: 0, vocationalHigh: 0,
    scienceHigh: 0, foreignIntlHigh: 0, artsSportsHigh: 0, meisterHigh: 0,
    specialPurposeSubtotal: 0,
    privateAutonomous: 0, publicAutonomous: 0, autonomousSubtotal: 0,
    other: 0, advancedTotal: 0,
    employed: 0, altEducation: 0, unemployed: 0,
  };
  if (years.length === 0) return s.career?.total ?? empty;
  const out = { ...empty };
  for (const y of years) {
    const row = s.careersByYear?.[String(y)]?.total ?? (s.career?.year === y ? s.career.total : null);
    if (!row) continue;
    for (const k of Object.keys(out) as (keyof CareerRow)[]) out[k] += row[k];
  }
  return out;
}

/** 진학자 (특목 + 자사) 합계 — UI 정렬·표시의 핵심 지표 */
export function eliteCount(t: CareerRow): number {
  return t.specialPurposeSubtotal + t.autonomousSubtotal;
}

export function elitePct(t: CareerRow): number {
  return t.graduates > 0 ? (eliteCount(t) / t.graduates) * 100 : 0;
}

/** 사용자가 표시 중인 진학 종류만 합산. visibleKeys는 toggleable Col key 집합. */
export function dynamicEliteCount(t: CareerRow, visibleToggleableKeys: Set<string>): number {
  let sum = 0;
  if (visibleToggleableKeys.has("scienceHigh"))      sum += t.scienceHigh;
  if (visibleToggleableKeys.has("foreignIntlHigh"))  sum += t.foreignIntlHigh;
  if (visibleToggleableKeys.has("artsSportsHigh"))   sum += t.artsSportsHigh;
  if (visibleToggleableKeys.has("privateAutonomous")) sum += t.privateAutonomous;
  if (visibleToggleableKeys.has("publicAutonomous"))  sum += t.publicAutonomous;
  return sum;
}

export function dynamicElitePct(t: CareerRow, visibleToggleableKeys: Set<string>): number {
  return t.graduates > 0 ? (dynamicEliteCount(t, visibleToggleableKeys) / t.graduates) * 100 : 0;
}
