/**
 * 진로 카테고리 라벨 단일 소스. SchoolTable과 학교 상세 페이지가 모두 이걸 import.
 * key는 CareerRow의 필드명과 동일.
 */
import type { CareerRow } from "./types";

export interface ColumnLabel {
  label: string;        // 화면에 표시할 짧은 라벨
  description: string;  // hover 시 풀네임 / 설명
}

export const CAREER_LABELS: Record<keyof CareerRow, ColumnLabel> & {
  // 가상 컬럼 — SchoolTable의 동적 합계/비율
  eliteCount: ColumnLabel;
  elitePct: ColumnLabel;
} = {
  graduates:              { label: "졸업",      description: "졸업자 인원 (조기졸업자 포함)" },
  generalHigh:            { label: "일반고",    description: "일반 고등학교 진학" },
  vocationalHigh:         { label: "특성화고",  description: "특성화 고등학교 진학" },
  scienceHigh:            { label: "과학고",    description: "[특수목적고] 과학고 + 영재고 진학 (학교알리미 분류상 영재고는 과학고에 포함)" },
  foreignIntlHigh:        { label: "외고·국제고", description: "[특수목적고] 외국어고 + 국제고 진학" },
  artsSportsHigh:         { label: "예고·체고",  description: "[특수목적고] 예술고 + 체육고 진학" },
  meisterHigh:            { label: "마이스터고", description: "[특수목적고] 마이스터고 진학" },
  specialPurposeSubtotal: { label: "특목 소계", description: "특수목적고(과학·외고국제·예체·마이스터) 합계" },
  privateAutonomous:      { label: "자사고",    description: "[자율고] 자율형 사립고 진학" },
  publicAutonomous:       { label: "자공고",    description: "[자율고] 자율형 공립고 진학" },
  autonomousSubtotal:     { label: "자율 소계", description: "자율고(자사+자공) 합계" },
  other:                  { label: "기타",      description: "기타 학교 진학 (외국인학교 등)" },
  advancedTotal:          { label: "진학자계",  description: "전체 진학자 합계" },
  employed:               { label: "취업",      description: "졸업 후 취업" },
  altEducation:           { label: "대안교육",   description: "대안교육기관 진학 (학력 미인정)" },
  unemployed:             { label: "무직·미상", description: "무직 또는 진로 미상" },
  // 동적 (SchoolTable의 합계/비율)
  eliteCount:             { label: "합계",      description: "현재 보이는 진학 종류 합산 (예: 과학고+외고·국제고+자사고…). 컬럼 숨기면 합계에서 빠짐." },
  elitePct:               { label: "비율",      description: "합계 ÷ 졸업자 × 100. 컬럼 숨김에 따라 동적 갱신." },
};

/** 학교 메타 라벨 */
export const META_LABELS = {
  schoolName: { label: "학교명",  description: "학교 이름" },
  si:         { label: "시",      description: "광역시 또는 도 안의 시·군" },
  gu:         { label: "구",      description: "광역시 직속 구 또는 시 안의 구 (없으면 빈칸)" },
} as const;
