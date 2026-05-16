"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { School } from "@/lib/types";
import { eliteCount, elitePct } from "@/lib/types";

type SortKey =
  | "elitePct" | "graduates"
  | "scienceHigh" | "foreignIntlHigh"
  | "privateAutonomous" | "specialPurposeSubtotal";

const SORT_LABELS: Record<SortKey, string> = {
  elitePct: "엘리트 비율 (특목+자사 %)",
  graduates: "졸업자 수",
  scienceHigh: "과학고 진학",
  foreignIntlHigh: "외고/국제고 진학",
  privateAutonomous: "자사고 진학",
  specialPurposeSubtotal: "특목고 합계 진학",
};

const SIDO_PRESETS = ["전체", "서울", "경기", "인천"] as const;
type SidoPreset = typeof SIDO_PRESETS[number];

const PAGE_SIZE = 50;

export default function SchoolTable({ schools }: { schools: School[] }) {
  const [query, setQuery] = useState("");
  const [sido, setSido] = useState<SidoPreset>("전체");
  const [sigungu, setSigungu] = useState<string>("전체");
  const [sortKey, setSortKey] = useState<SortKey>("elitePct");
  const [page, setPage] = useState(0);

  const sigunguOptions = useMemo(() => {
    const pool = sido === "전체" ? schools : schools.filter((s) => s.sidoName === sido);
    const set = new Set<string>();
    for (const s of pool) {
      if (s.sigungu) for (const t of s.sigungu.split(/\s+/)) if (t) set.add(t);
    }
    return ["전체", ...[...set].sort((a, b) => a.localeCompare(b, "ko"))];
  }, [sido, schools]);

  const filtered = useMemo(() => {
    let out = schools;
    if (sido !== "전체") out = out.filter((s) => s.sidoName === sido);
    if (sigungu !== "전체") out = out.filter((s) => (s.sigungu ?? "").split(/\s+/).includes(sigungu));
    if (query.trim()) {
      const q = query.trim();
      out = out.filter((s) => s.schoolName.includes(q));
    }
    return [...out].sort((a, b) => {
      const ca = a.career!.total, cb = b.career!.total;
      if (sortKey === "elitePct") return elitePct(cb) - elitePct(ca);
      return (cb[sortKey] ?? 0) - (ca[sortKey] ?? 0);
    });
  }, [schools, sido, sigungu, query, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-slate-500 block mb-1">학교명 검색</label>
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="예: 청심, 영훈국제, 휘문..."
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">시도</label>
          <select
            value={sido}
            onChange={(e) => { setSido(e.target.value as SidoPreset); setSigungu("전체"); setPage(0); }}
            className="rounded border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            {SIDO_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">시군구</label>
          <select
            value={sigungu}
            onChange={(e) => { setSigungu(e.target.value); setPage(0); }}
            className="rounded border border-slate-300 px-3 py-2 text-sm bg-white max-w-[200px]"
          >
            {sigunguOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">정렬</label>
          <select
            value={sortKey}
            onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(0); }}
            className="rounded border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div className="text-sm text-slate-500 ml-auto">
          {filtered.length.toLocaleString()}건 매치
        </div>
      </div>

      {/* 표 */}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="min-w-full text-sm tabular-nums">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 font-medium">학교명</th>
              <th className="text-left px-3 py-2 font-medium">지역</th>
              <th className="text-right px-3 py-2 font-medium">졸업</th>
              <th className="text-right px-3 py-2 font-medium">일반</th>
              <th className="text-right px-3 py-2 font-medium">과학</th>
              <th className="text-right px-3 py-2 font-medium">외고/국제</th>
              <th className="text-right px-3 py-2 font-medium">예체</th>
              <th className="text-right px-3 py-2 font-medium">자사</th>
              <th className="text-right px-3 py-2 font-medium">자공</th>
              <th className="text-right px-3 py-2 font-medium border-l border-slate-200">특목+자사</th>
              <th className="text-right px-3 py-2 font-medium">엘리트%</th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr><td colSpan={11} className="text-center text-slate-400 py-8">결과 없음</td></tr>
            )}
            {slice.map((s) => {
              const t = s.career!.total;
              const e = eliteCount(t);
              const pct = elitePct(t).toFixed(1);
              const loc = s.sigungu ? `${s.sidoName} ${s.sigungu}` : s.sidoName;
              return (
                <tr key={s.SHL_IDF_CD} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/school/${encodeURIComponent(s.SHL_IDF_CD)}`}
                      className="text-brand-700 hover:underline"
                    >
                      {s.schoolName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{loc}</td>
                  <td className="px-3 py-2 text-right">{t.graduates}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{t.generalHigh}</td>
                  <td className="px-3 py-2 text-right">{t.scienceHigh}</td>
                  <td className="px-3 py-2 text-right">{t.foreignIntlHigh}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{t.artsSportsHigh}</td>
                  <td className="px-3 py-2 text-right">{t.privateAutonomous}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{t.publicAutonomous}</td>
                  <td className="px-3 py-2 text-right font-medium border-l border-slate-200">{e}</td>
                  <td className="px-3 py-2 text-right font-bold text-brand-700">{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}
            className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-30">이전</button>
          <span className="text-slate-600">{safePage + 1} / {pageCount}</span>
          <button onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage >= pageCount - 1}
            className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-30">다음</button>
        </div>
      )}
    </div>
  );
}
