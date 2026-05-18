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
 * 데이터 없으면 "최근 N개월 거래 없음" (SYNC_RECENT_MONTHS 기준).
 */
"use client";

import { useMemo, useState } from "react";
import type { ApartmentSummary, SaleLatest, JeonseLatest, WolseLatest } from "@/lib/realestate";
import { SYNC_RECENT_MONTHS } from "@/lib/realestate";

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

/** 네이버지도: 좌표 POI 매칭으로 국토부/네이버 명칭 차이를 우회. */
function naverMapUrl(name: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(name)}`;
}

/** 구글검색: 아실·호갱노노 등 비교 사이트가 결과에 포함됨. */
function googleSearchUrl(name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(name)}`;
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
  if (!s) return <span className="text-xs text-slate-400">최근 {SYNC_RECENT_MONTHS}개월 거래 없음</span>;
  return (
    <>
      <div>{fmtPriceEok(s.priceWon)}</div>
      <div className="text-[10px] text-slate-400 font-normal">
        {s.areaM2 != null ? `전용 ${Math.round(s.areaM2)}㎡ · ` : ""}{fmtYearMonth(s.contractDate)}
      </div>
    </>
  );
}

function JeonseCell({ j }: { j: JeonseLatest | null }) {
  if (!j) return <span className="text-xs text-slate-400">최근 {SYNC_RECENT_MONTHS}개월 거래 없음</span>;
  return (
    <>
      <div>{fmtManWon(j.depositManWon)}</div>
      <div className="text-[10px] text-slate-400 font-normal">
        {j.areaM2 != null ? `전용 ${Math.round(j.areaM2)}㎡ · ` : ""}{fmtYearMonth(j.contractDate)}
      </div>
    </>
  );
}

function WolseCell({ w }: { w: WolseLatest | null }) {
  if (!w) return <span className="text-xs text-slate-400">최근 {SYNC_RECENT_MONTHS}개월 거래 없음</span>;
  return (
    <>
      <div>{fmtManWon(w.depositManWon)} / {w.monthlyRentManWon.toLocaleString()}</div>
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
        className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-brand-700 ${align === "right" ? "text-right" : "text-left"} ${active ? "text-brand-700" : ""}`}
      >
        {label}
        <span className={`ml-1 text-xs ${active ? "text-brand-600" : "text-slate-300"}`}>{sym}</span>
      </th>
    );
  }

  return (
    <section className="mt-6 rounded border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-sm font-medium text-slate-700">주변 아파트 단지</h2>
        {apartments.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">표시:</span>
            {LIMIT_OPTIONS.map((opt) => {
              const on = limit === opt.value;
              return (
                <button
                  key={opt.label}
                  onClick={() => setLimit(opt.value)}
                  className={`px-2 py-0.5 rounded border transition cursor-pointer ${
                    on
                      ? "bg-brand-600 border-brand-600 text-white"
                      : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
            <span className="text-[10px] text-slate-400 ml-1">
              {visible.length}/{apartments.length}
            </span>
          </div>
        )}
      </div>
      {apartments.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          주변 아파트 데이터 준비 중입니다. 학교 좌표 기준 반경 1km 내 단지 매핑·국토부 매매·전월세
          데이터가 순차 도착하는 대로 이 영역에 표시됩니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm tabular-nums">
            <thead className="bg-slate-100 text-slate-600">
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
              {visible.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-800">
                    <div className="flex flex-col gap-0.5">
                      <span>{a.name}</span>
                      <div className="flex gap-1">
                        <a
                          href={naverMapUrl(a.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${a.name} 네이버지도에서 보기`}
                          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded px-1.5 py-0.5 transition-colors"
                        >
                          네이버지도
                        </a>
                        <a
                          href={googleSearchUrl(a.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${a.name} 구글에서 검색`}
                          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded px-1.5 py-0.5 transition-colors"
                        >
                          구글
                        </a>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right">{a.builtYear ?? "-"}</td>
                  <td className="px-3 py-1.5 text-right">{fmtDistance(a.distanceM)}</td>
                  <td className="px-3 py-1.5 text-right"><SaleCell s={a.latestSale} /></td>
                  <td className="px-3 py-1.5 text-right"><JeonseCell j={a.latestJeonse} /></td>
                  <td className="px-3 py-1.5 text-right"><WolseCell w={a.latestWolse} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11px] text-slate-400">
            * 거리는 학교 좌표 기준 반경 1km 내 단지 (학구도 폴리곤 적재 전 임시).
            매매·전세·월세는 단지별 가장 최근 거래 1건 (국토부 공개 데이터).
            단지명 옆 chip: 네이버지도(좌표 POI 매칭) · 구글(단지명 검색 — 아실·호갱노노 포함).
          </div>
        </div>
      )}
    </section>
  );
}
