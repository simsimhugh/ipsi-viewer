import { describe, it, expect } from "vitest";
import { CAREER_LABELS, META_LABELS } from "@/lib/columnLabels";

describe("CAREER_LABELS — 단일 소스 일관성", () => {
  const required = [
    "graduates", "generalHigh", "vocationalHigh",
    "scienceHigh", "foreignIntlHigh", "artsSportsHigh", "meisterHigh",
    "specialPurposeSubtotal",
    "privateAutonomous", "publicAutonomous", "autonomousSubtotal",
    "other", "advancedTotal",
    "employed", "altEducation", "unemployed",
    "eliteCount", "elitePct",
  ];

  it("CareerRow 모든 필드 + 가상 컬럼 라벨이 존재", () => {
    for (const k of required) {
      expect(CAREER_LABELS).toHaveProperty(k);
      expect((CAREER_LABELS as Record<string, { label: string }>)[k].label).toBeTruthy();
      expect((CAREER_LABELS as Record<string, { description: string }>)[k].description).toBeTruthy();
    }
  });

  it("라벨에 가운뎃점 표준 (외고·국제고 등)", () => {
    expect(CAREER_LABELS.foreignIntlHigh.label).toContain("·");
    expect(CAREER_LABELS.artsSportsHigh.label).toContain("·");
    expect(CAREER_LABELS.unemployed.label).toContain("·");
  });

  it("과학고 description에 영재고 포함 언급", () => {
    expect(CAREER_LABELS.scienceHigh.description).toContain("영재고");
  });

  it("eliteCount / elitePct 라벨은 '선택 합계' / '선택 비율' (칩 토글 동적성 명시)", () => {
    expect(CAREER_LABELS.eliteCount.label).toBe("선택 합계");
    expect(CAREER_LABELS.elitePct.label).toBe("선택 비율");
  });
});

describe("META_LABELS", () => {
  it("학교명·시·구 라벨 존재", () => {
    expect(META_LABELS.schoolName.label).toBe("학교명");
    expect(META_LABELS.si.label).toBe("시");
    expect(META_LABELS.gu.label).toBe("구");
  });
});
