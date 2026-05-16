import { describe, it, expect } from "vitest";
import type { School, CareerRow } from "@/lib/types";
import {
  eliteCount, elitePct, dynamicEliteCount, dynamicElitePct, sumYears, yearsOf,
} from "@/lib/types";

function row(over: Partial<CareerRow> = {}): CareerRow {
  return {
    graduates: 0, generalHigh: 0, vocationalHigh: 0,
    scienceHigh: 0, foreignIntlHigh: 0, artsSportsHigh: 0, meisterHigh: 0,
    specialPurposeSubtotal: 0,
    privateAutonomous: 0, publicAutonomous: 0, autonomousSubtotal: 0,
    other: 0, advancedTotal: 0,
    employed: 0, altEducation: 0, unemployed: 0,
    ...over,
  };
}

describe("eliteCount / elitePct", () => {
  it("특목 소계 + 자율 소계 합산", () => {
    expect(eliteCount(row({ specialPurposeSubtotal: 25, autonomousSubtotal: 12 }))).toBe(37);
  });
  it("졸업자 0이면 비율 0", () => {
    expect(elitePct(row({ graduates: 0, specialPurposeSubtotal: 10 }))).toBe(0);
  });
  it("비율 계산", () => {
    expect(elitePct(row({ graduates: 100, specialPurposeSubtotal: 20, autonomousSubtotal: 10 }))).toBe(30);
  });
});

describe("dynamicEliteCount / dynamicElitePct — 가시 컬럼 합산", () => {
  it("visibleKeys 빈 set이면 0", () => {
    const r = row({ scienceHigh: 8, foreignIntlHigh: 10, privateAutonomous: 11 });
    expect(dynamicEliteCount(r, new Set())).toBe(0);
  });
  it("일부 토글 시 그 합산만", () => {
    const r = row({ scienceHigh: 8, foreignIntlHigh: 10, artsSportsHigh: 3, privateAutonomous: 11, publicAutonomous: 1 });
    expect(dynamicEliteCount(r, new Set(["scienceHigh", "foreignIntlHigh"]))).toBe(18);
    expect(dynamicEliteCount(r, new Set(["privateAutonomous"]))).toBe(11);
  });
  it("dynamicElitePct는 졸업자 대비", () => {
    const r = row({ graduates: 100, scienceHigh: 20 });
    expect(dynamicElitePct(r, new Set(["scienceHigh"]))).toBe(20);
  });
});

describe("sumYears — 다년 합산", () => {
  const school: School = {
    SHL_IDF_CD: "abc", schoolName: "테스트중", sidoCode: "10", sidoName: "경기",
    sdSchulCode: "999", kind: "중학교",
    careersByYear: {
      "2023": { year: 2023, male: row(), female: row(), total: row({ graduates: 100, scienceHigh: 5 }), ratePct: row(), totalGraduatesFromTable: 100 } as any,
      "2024": { year: 2024, male: row(), female: row(), total: row({ graduates: 120, scienceHigh: 8 }), ratePct: row(), totalGraduatesFromTable: 120 } as any,
      "2025": { year: 2025, male: row(), female: row(), total: row({ graduates: 130, scienceHigh: 10 }), ratePct: row(), totalGraduatesFromTable: 130 } as any,
    },
    career: null,
  };

  it("선택 연도 합산", () => {
    const s = sumYears(school, [2024, 2025]);
    expect(s.graduates).toBe(250);
    expect(s.scienceHigh).toBe(18);
  });
  it("연도 전체 합산", () => {
    const s = sumYears(school, [2023, 2024, 2025]);
    expect(s.graduates).toBe(350);
    expect(s.scienceHigh).toBe(23);
  });
  it("빈 years면 career fallback 또는 empty", () => {
    const s = sumYears(school, []);
    // career is null → empty
    expect(s.graduates).toBe(0);
  });
});

describe("yearsOf", () => {
  it("careersByYear 정렬 (내림차순)", () => {
    const school = {
      careersByYear: { "2023": {}, "2025": {}, "2024": {} },
      career: null,
    } as unknown as School;
    expect(yearsOf(school)).toEqual([2025, 2024, 2023]);
  });
});
