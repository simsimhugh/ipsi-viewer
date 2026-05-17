/**
 * 학교 상세 페이지의 "주변 아파트 단지" 섹션.
 *
 * 데이터 없을 때 (자원 미발급, 적재 전): 안내 placeholder.
 * 데이터 있을 때: 단지명·세대수·준공년·거리·대표 평수 실거래가 중위값 표.
 * - 단지명 클릭 → 네이버 부동산 검색 새 창
 * - 표시 수 selector (10/20/50/전체, 기본 20)
 * - 컬럼 헤더 클릭 정렬 (단지명·세대수·건축년도·거리·실거래가·거래일)
 * - 실거래가 셀: 가격(억) + 보조 "전용 NN㎡ (M건)"
 */
"use client";

import { useMemo, useState } from "react";
import type { ApartmentSummary } from "@/lib/realestate";

function fmtPriceEok(won: number | null): string {
  if (won == null) return "-";
  // 억 단위 표기 (예: 32.5억). 10억 이상은 소수 1자리, 미만은 2자리.
  const eok = won / 1e8;
  if (eok >= 10) return `${eok.toFixed(1)}억`;
  return `${eok.toFixed(2)}억`;
}

function fmtDistance(m: number | null): string {
  if (m == null) return "-";
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(2)}km`;
}

function naverRealEstateUrl(name: string, sigungu: string | null): string {
  const tokens = (sigungu ?? "").split(/\s+/).filter(Boolean);
  // sigungu 마지막 토큰 (예: "서울 강남구" → "강남구") + "아파트"
  const region = tokens.length > 0 ? tokens[tokens.length - 1] : "";
  const q = [name, region, "아파트"].filter(Boolean).join(" ");
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`;
}

type SortKey = "name" | "households" | "builtYear" | "distanceM" | "medianPriceWon" | "latestContractDate";
type SortDir = "asc" | "desc";

const LIMIT_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "전체", value: null },
];

export default function SchoolApartments({ apartments }: { apartments: ApartmentSummary[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("distanceM");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [limit, setLimit] = useState<number | null>(20);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // 숫자 컬럼은 기본 desc (큰 값 먼저), 거리·단지명은 asc
      const numericDescDefault: SortKey[] = ["households", "builtYear", "medianPriceWon", "latestContractDate"];
      setSortDir(numericDescDefault.includes(key) ? "desc" : "asc");
    }
  }

  const sorted = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const arr = [...apartments];
    arr.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      // null 은 항상 뒤로
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
          주변 아파트 데이터 준비 중입니다. 학교 좌표 기준 반경 1km 내 단지 매핑·국토부 실거래가
          데이터가 순차 도착하는 대로 이 영역에 단지명·세대수·실거래가가 표시됩니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm tabular-nums">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <HeaderCell k="name" label="단지명" />
                <HeaderCell k="households" label="세대수" align="right" />
                <HeaderCell k="builtYear" label="준공" align="right" />
                <HeaderCell k="distanceM" label="거리" align="right" />
                <HeaderCell k="medianPriceWon" label="실거래가 (대표 평수 중위)" align="right" />
                <HeaderCell k="latestContractDate" label="최근 거래일" align="right" />
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-800">
                    <a
                      href={naverRealEstateUrl(a.name, a.sigungu)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-brand-700 hover:underline"
                      title="네이버에서 검색"
                    >
                      {a.name}
                    </a>
                  </td>
                  <td className="px-3 py-1.5 text-right">{a.households ?? "-"}</td>
                  <td className="px-3 py-1.5 text-right">{a.builtYear ?? "-"}</td>
                  <td className="px-3 py-1.5 text-right">{fmtDistance(a.distanceM)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div>{fmtPriceEok(a.medianPriceWon)}</div>
                    {a.representativeAreaM2 != null && (
                      <div className="text-[10px] text-slate-400 font-normal">
                        전용 {a.representativeAreaM2}㎡ ({a.representativeAreaCount}건)
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{a.latestContractDate ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11px] text-slate-400">
            * 거리는 학교 좌표 기준 반경 1km 내 단지 (학구도 폴리곤 적재 전 임시).
            실거래가는 국토부 공개 데이터에서 단지별 대표 평수(거래 빈도 최다 area_m2 그룹)의 중위값.
            단지명 클릭 시 네이버 검색.
          </div>
        </div>
      )}
    </section>
  );
}
