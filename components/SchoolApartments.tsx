/**
 * 학교 상세 페이지의 "주변 아파트 단지" 섹션.
 *
 * 컬럼: 단지명·준공·거리·매매·전세·월세.
 * (세대수 컬럼은 카카오 지오코딩 데이터에 채워지지 않아 제거.)
 * 매매/전세/월세는 단지별 최근 1건 (contract_date 가장 최근).
 * 셀 형식 예:
 *   매매: "32.5억\n전용 84㎡ · 2025-04"
 *   전세: "9억\n전용 100㎡ · 2025-04"
 *   월세: "보 1억 / 월 250\n전용 60㎡ · 2025-04"
 * 데이터 없으면 "-".
 */
"use client";

import { useMemo, useState } from "react";
import type { ApartmentSummary, SaleLatest, JeonseLatest, WolseLatest } from "@/lib/realestate";

/** 원(₩) → "32.5억" / "9.0억" / "8000만" 표기. */
function fmtPriceEok(won: number | null): string {
  if (won == null) return "-";
  const eok = won / 1e8;
  if (eok >= 10) return `${eok.toFixed(1)}억`;
  if (eok >= 1) return `${eok.toFixed(2)}억`;
  // 1억 미만: 만원 단위
  return `${Math.round(won / 1e4).toLocaleString()}만`;
}

/** 만원 → "9억" / "1.2억" / "8000만" 표기 (전월세 보증금용). */
function fmtManWon(manWon: number | null): string {
  if (manWon == null) return "-";
  const eok = manWon / 1e4;
  if (eok >= 10) return `${eok.toFixed(1)}억`;
  if (eok >= 1) return `${eok.toFixed(2)}억`;
  return `${manWon.toLocaleString()}만`;
}

function fmtDistance(m: number | null): string {
  if (m == null) return "-";
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(2)}km`;
}

/** "2025-04-18" → "2025-04". */
function fmtYearMonth(date: string): string {
  return date.slice(0, 7);
}

function naverRealEstateUrl(name: string, _sigungu: string | null): string {
  // m.land.naver.com/search/result/<단지명> → 302로 단지 ID 페이지 자동 redirect.
  // 매칭 실패 시 검색 결과 페이지로 (네이버 자체 fallback).
  return `https://m.land.naver.com/search/result/${encodeURIComponent(name)}`;
}

/** 정렬 키: 매매/전세/월세는 가격(보증금) 숫자값으로 비교. */
type SortKey = "name" | "builtYear" | "distanceM" | "sale" | "jeonse" | "wolse";
type SortDir = "asc" | "desc";

const LIMIT_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "전체", value: null },
];

/** 정렬 시 비교용 숫자 — null은 항상 뒤로. */
function sortValue(a: ApartmentSummary, key: SortKey): number | string | null {
  switch (key) {
    case "name": return a.name;
    case "builtYear": return a.builtYear;
    case "distanceM": return a.distanceM;
    case "sale": return a.latestSale?.priceWon ?? null;
    case "jeonse": return a.latestJeonse?.depositManWon ?? null;
    case "wolse": return a.latestWolse?.depositManWon ?? null;
  }
}

function SaleCell({ s }: { s: SaleLatest | null }) {
  if (!s) return <span className="text-slate-200">-</span>;
  return (
    <>
      <div className="font-medium">{fmtPriceEok(s.priceWon)}</div>
      <div className="text-[10px] text-slate-400 font-normal">
        {s.areaM2 != null ? `전용 ${Math.round(s.areaM2)}㎡ · ` : ""}{fmtYearMonth(s.contractDate)}
      </div>
    </>
  );
}

function JeonseCell({ j }: { j: JeonseLatest | null }) {
  if (!j) return <span className="text-slate-200">-</span>;
  return (
    <>
      <div className="font-medium">{fmtManWon(j.depositManWon)}</div>
      <div className="text-[10px] text-slate-400 font-normal">
        {j.areaM2 != null ? `전용 ${Math.round(j.areaM2)}㎡ · ` : ""}{fmtYearMonth(j.contractDate)}
      </div>
    </>
  );
}

function WolseCell({ w }: { w: WolseLatest | null }) {
  if (!w) return <span className="text-slate-200">-</span>;
  return (
    <>
      <div className="font-medium">{fmtManWon(w.depositManWon)} / <span className="text-slate-600">{w.monthlyRentManWon.toLocaleString()}</span></div>
      <div className="text-[10px] text-slate-400 font-normal">
        {w.areaM2 != null ? `전용 ${Math.round(w.areaM2)}㎡ · ` : ""}{fmtYearMonth(w.contractDate)}
      </div>
    </>
  );
}

export default function SchoolApartments({ apartments }: { apartments: ApartmentSummary[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("distanceM");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [limit, setLimit] = useState<number | null>(20);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // 가격·건축년도는 desc 기본 (큰 값 먼저), 거리·단지명은 asc
      const numericDescDefault: SortKey[] = ["builtYear", "sale", "jeonse", "wolse"];
      setSortDir(numericDescDefault.includes(key) ? "desc" : "asc");
    }
  }

  const sorted = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const arr = [...apartments];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb), "ko") * factor;
    });
    return arr;
  }, [apartments, sortKey, sortDir]);

  const visible = limit == null ? sorted : sorted.slice(0, limit);

  function HeaderCell({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) {
    const active = sortKey === k;
    const sym = active ? (sortDir === "asc" ? "▲" : "▼") : "↕";
    return (
      <th
        onClick={() => toggleSort(k)}
        className={`px-3 py-2.5 font-medium text-xs cursor-pointer select-none hover:text-brand-600 ${align === "right" ? "text-right" : "text-left"} ${active ? "text-brand-600" : ""}`}
      >
        {label}
        <span className={`ml-1 ${active ? "text-brand-500" : "text-slate-300"}`}>{sym}</span>
      </th>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h2 className="text-sm font-semibold text-slate-700">주변 아파트 단지</h2>
        {apartments.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400">표시:</span>
            {LIMIT_OPTIONS.map((opt) => {
              const on = limit === opt.value;
              return (
                <button
                  key={opt.label}
                  onClick={() => setLimit(opt.value)}
                  className={`px-2 py-0.5 rounded-md border transition cursor-pointer ${
                    on
                      ? "bg-brand-600 border-brand-600 text-white shadow-sm"
                      : "bg-white border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
            <span className="text-[10px] text-slate-400 ml-0.5">
              {visible.length}/{apartments.length}
            </span>
          </div>
        )}
      </div>
      {apartments.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 leading-relaxed">
          주변 아파트 데이터 준비 중입니다. 학교 좌표 기준 반경 1km 내 단지 매핑·국토부 매매·전월세
          데이터가 순차 도착하는 대로 이 영역에 표시됩니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm tabular-nums">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <HeaderCell k="name" label="단지명" />
                <HeaderCell k="builtYear" label="준공" align="right" />
                <HeaderCell k="distanceM" label="거리" align="right" />
                <HeaderCell k="sale" label="매매 (최근)" align="right" />
                <HeaderCell k="jeonse" label="전세 (최근)" align="right" />
                <HeaderCell k="wolse" label="월세 (최근)" align="right" />
              </tr>
            </thead>
            <tbody>
              {visible.map((a, idx) => (
                <tr key={a.id} className={`border-t border-slate-100 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                  <td className="px-3 py-2 text-slate-800">
                    <a
                      href={naverRealEstateUrl(a.name, a.sigungu)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-brand-600 hover:text-brand-800 hover:underline font-medium"
                      title="네이버에서 검색"
                    >
                      {a.name}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{a.builtYear ?? "-"}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{fmtDistance(a.distanceM)}</td>
                  <td className="px-3 py-2 text-right"><SaleCell s={a.latestSale} /></td>
                  <td className="px-3 py-2 text-right"><JeonseCell j={a.latestJeonse} /></td>
                  <td className="px-3 py-2 text-right"><WolseCell w={a.latestWolse} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
            거리는 학교 좌표 기준 반경 1km 내 단지 (학구도 폴리곤 적재 전 임시).
            매매·전세·월세는 단지별 가장 최근 거래 1건 (국토부 공개 데이터). 단지명 클릭 시 네이버 검색.
          </div>
        </div>
      )}
    </section>
  );
}
