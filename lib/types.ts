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
  career: CareerData | null;
}

/** 진학자 (특목 + 자사) 합계 — UI 정렬·표시의 핵심 지표 */
export function eliteCount(t: CareerRow): number {
  return t.specialPurposeSubtotal + t.autonomousSubtotal;
}

export function elitePct(t: CareerRow): number {
  return t.graduates > 0 ? (eliteCount(t) / t.graduates) * 100 : 0;
}
