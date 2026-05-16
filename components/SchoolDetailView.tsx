"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { School, CareerRow } from "@/lib/types";
import { eliteCount, elitePct } from "@/lib/types";
import { CAREER_LABELS } from "@/lib/columnLabels";

/** 표·차트 row 정의 — emphasis는 강조 row (소계·총계) */
const ROW_KEYS: { key: keyof CareerRow; emphasis?: boolean }[] = [
  { key: "graduates", emphasis: true },
  { key: "generalHigh" },
  { key: "scienceHigh" },
  { key: "foreignIntlHigh" },
  { key: "artsSportsHigh" },
  { key: "meisterHigh" },
  { key: "specialPurposeSubtotal", emphasis: true },
  { key: "privateAutonomous" },
  { key: "publicAutonomous" },
  { key: "autonomousSubtotal", emphasis: true },
  { key: "vocationalHigh" },
  { key: "other" },
  { key: "advancedTotal", emphasis: true },
  { key: "employed" },
  { key: "altEducation" },
  { key: "unemployed" },
];

/** 트렌드 차트 — 8종 학교 종류 (메인 테이블과 동일) */
const TREND_CATEGORIES: { key: keyof CareerRow; color: string }[] = [
  { key: "generalHigh",       color: "#94a3b8" },
  { key: "scienceHigh",       color: "#06b6d4" },
  { key: "foreignIntlHigh",   color: "#0ea5e9" },
  { key: "artsSportsHigh",    color: "#f59e0b" },
  { key: "privateAutonomous", color: "#ef4444" },
  { key: "publicAutonomous",  color: "#f97316" },
  { key: "vocationalHigh",    color: "#a78bfa" },
  { key: "meisterHigh",       color: "#84cc16" },
];

function Kpi({ label, value, suffix, highlight }: { label: string; value: string | number; suffix?: string; highlight?: boolean }) {
  return (
    <div className={`rounded border p-4 ${highlight ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${highlight ? "text-brand-700" : "text-slate-900"}`}>
        {value}{suffix && <span className="text-sm font-normal text-slate-500 ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

export default function SchoolDetailView({ school }: { school: School }) {
  // 모든 가능 연도 (오름차순 — 표·차트 모두 동일)
  const yearsAsc = useMemo(() => {
    const set = new Set<number>();
    if (school.careersByYear) for (const y of Object.keys(school.careersByYear)) set.add(Number(y));
    if (school.career?.year) set.add(school.career.year);
    return [...set].sort((a, b) => a - b);
  }, [school]);

  // 차트 라인 토글 (기본 모두 활성)
  const [hiddenCats, setHiddenCats] = useState<Set<keyof CareerRow>>(new Set());
  function toggleCat(key: keyof CareerRow) {
    setHiddenCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // 각 연도별 합계 row (배경) + 다년 합산 row (마지막 column)
  const yearRows = useMemo(() => yearsAsc.map((y) => school.careersByYear?.[String(y)]?.total ?? null), [school, yearsAsc]);
  const aggregatedTotal = useMemo<CareerRow>(() => {
    const empty: CareerRow = { graduates: 0, generalHigh: 0, vocationalHigh: 0, scienceHigh: 0, foreignIntlHigh: 0, artsSportsHigh: 0, meisterHigh: 0, specialPurposeSubtotal: 0, privateAutonomous: 0, publicAutonomous: 0, autonomousSubtotal: 0, other: 0, advancedTotal: 0, employed: 0, altEducation: 0, unemployed: 0 };
    const out = { ...empty };
    for (const r of yearRows) {
      if (!r) continue;
      for (const k of Object.keys(empty) as (keyof CareerRow)[]) out[k] += r[k];
    }
    return out;
  }, [yearRows]);

  // KPI
  const elite = eliteCount(aggregatedTotal);
  const ePct = aggregatedTotal.graduates > 0 ? elitePct(aggregatedTotal).toFixed(1) : "-";

  // 차트 데이터
  const countData = useMemo(() => yearsAsc.map((y, i) => {
    const c = yearRows[i];
    const row: Record<string, number | string> = { year: y };
    for (const cat of TREND_CATEGORIES) row[CAREER_LABELS[cat.key].label] = c?.[cat.key] ?? 0;
    return row;
  }), [yearsAsc, yearRows]);
  const pctData = useMemo(() => yearsAsc.map((y, i) => {
    const c = yearRows[i];
    const grad = c?.graduates ?? 0;
    const row: Record<string, number | string> = { year: y };
    for (const cat of TREND_CATEGORIES) {
      row[CAREER_LABELS[cat.key].label] = grad > 0 ? Math.round((c?.[cat.key] ?? 0) / grad * 1000) / 10 : 0;
    }
    return row;
  }), [yearsAsc, yearRows]);

  if (yearsAsc.length === 0) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        진로 데이터를 수집하지 못했습니다 (졸업자 없음 또는 공시 미발견).
      </div>
    );
  }

  /** 한 셀: 인원 + 비율 % (graduates는 인원만) */
  function Cell({ row, field, total }: { row: CareerRow | null; field: keyof CareerRow; total: CareerRow }) {
    if (!row) return <span className="text-slate-300">—</span>;
    const n = row[field];
    if (field === "graduates") return <span>{n}</span>;
    const denom = total.graduates;
    if (denom <= 0) return <span>{n}</span>;
    const pct = (n / denom * 100).toFixed(1);
    return (
      <span>
        <span className="font-medium">{n}</span>
        <span className="text-slate-400 text-[10px] ml-1">({pct}%)</span>
      </span>
    );
  }

  return (
    <>
      {/* KPI — 전체 합산 */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label={CAREER_LABELS.graduates.label} value={aggregatedTotal.graduates} suffix="명" />
        <Kpi label={CAREER_LABELS.eliteCount.label} value={elite} suffix="명" highlight />
        <Kpi label={CAREER_LABELS.elitePct.label} value={ePct} suffix="%" highlight />
        <Kpi label="공시 연도" value={`${yearsAsc[0]}~${yearsAsc[yearsAsc.length - 1]} (${yearsAsc.length}개년)`} />
      </section>

      {/* 연도별 트렌드 — 카테고리 토글 chip + 인원·비율 line 2 차트 */}
      {yearsAsc.length > 1 && (
        <section className="mb-6 rounded border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="text-sm font-medium text-slate-700">연도별 진로 트렌드</h2>
            <span className="text-[10px] text-slate-400">·  카테고리 칩 클릭으로 라인 토글</span>
          </div>
          {/* 카테고리 chip 범례 */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {TREND_CATEGORIES.map((cat) => {
              const on = !hiddenCats.has(cat.key);
              return (
                <button
                  key={cat.key}
                  onClick={() => toggleCat(cat.key)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition cursor-pointer inline-flex items-center gap-1 ${on ? "" : "opacity-40 line-through"}`}
                  style={{
                    borderColor: on ? cat.color : "#cbd5e1",
                    color: on ? cat.color : "#94a3b8",
                    backgroundColor: on ? `${cat.color}14` : "white",
                  }}
                >
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: cat.color }} />
                  {CAREER_LABELS[cat.key].label}
                </button>
              );
            })}
          </div>

          <div className="mb-2 text-xs text-slate-500">인원 (명)</div>
          <div className="w-full h-60 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={countData} margin={{ top: 4, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v}명`, name]}
                  labelFormatter={(y) => `${y}년`}
                  contentStyle={{ fontSize: 12 }}
                />
                {TREND_CATEGORIES.filter((c) => !hiddenCats.has(c.key)).map((c) => (
                  <Line key={c.key} type="monotone" dataKey={CAREER_LABELS[c.key].label}
                    stroke={c.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mb-2 text-xs text-slate-500">비율 (%, 졸업자 대비)</div>
          <div className="w-full h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pctData} margin={{ top: 4, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
                  labelFormatter={(y) => `${y}년`}
                  contentStyle={{ fontSize: 12 }}
                />
                {TREND_CATEGORIES.filter((c) => !hiddenCats.has(c.key)).map((c) => (
                  <Line key={c.key} type="monotone" dataKey={CAREER_LABELS[c.key].label}
                    stroke={c.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 연도 매트릭스 표 — row=카테고리, col=연도들 + 합계 */}
      <section className="rounded border border-slate-200 bg-white overflow-x-auto">
        <table className="min-w-full text-sm tabular-nums">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 font-medium">카테고리</th>
              {yearsAsc.map((y) => (
                <th key={y} className="text-right px-3 py-2 font-medium">{y}</th>
              ))}
              <th className="text-right px-3 py-2 font-medium border-l border-slate-200 bg-brand-50/40 text-brand-700">
                합계 ({yearsAsc.length}년)
              </th>
            </tr>
          </thead>
          <tbody>
            {ROW_KEYS.map(({ key, emphasis }) => (
              <tr key={key} className={`border-t border-slate-100 ${emphasis ? "bg-slate-50/60 font-medium" : ""}`}>
                <td className="px-3 py-1.5 text-slate-700" title={CAREER_LABELS[key].description}>{CAREER_LABELS[key].label}</td>
                {yearRows.map((r, i) => (
                  <td key={yearsAsc[i]} className="px-3 py-1.5 text-right">
                    <Cell row={r} field={key} total={r ?? aggregatedTotal} />
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right border-l border-slate-200 bg-brand-50/40">
                  <Cell row={aggregatedTotal} field={key} total={aggregatedTotal} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
