"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { School, CareerRow } from "@/lib/types";
import { dynamicEliteCount, dynamicElitePct, sumYears } from "@/lib/types";
import { CAREER_LABELS, META_LABELS } from "@/lib/columnLabels";

// ─── 컬럼 정의 ────────────────────────────────────────────────────────────
type FilterType = "text" | "loc" | "range" | "chip";

interface Col {
  key: string;
  label: string;
  /** hover 시 표시할 풀네임/설명 */
  description?: string;
  numeric: boolean;
  align: "left" | "right";
  filterType?: FilterType;
  get: (s: School) => number | string;
  render?: (s: School) => string | number;
  muted?: boolean;
  emphasis?: boolean;
  /** 사용자가 표시/숨김 토글 가능 (false 또는 미지정 = 항상 표시) */
  toggleable?: boolean;
}

const t = (s: School): CareerRow => s.career!.total;

const METRO_CITIES_SET = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]);
function siOf(s: School): string {
  const tokens = (s.sigungu ?? "").split(/\s+/).filter(Boolean);
  return METRO_CITIES_SET.has(s.sidoName) ? s.sidoName : (tokens[0] ?? "");
}
function guOf(s: School): string {
  const tokens = (s.sigungu ?? "").split(/\s+/).filter(Boolean);
  return METRO_CITIES_SET.has(s.sidoName) ? (tokens[0] ?? "") : (tokens[1] ?? "");
}

const COLS: Col[] = [
  { key: "schoolName", ...META_LABELS.schoolName, numeric: false, align: "left",
    filterType: "text", get: (s) => s.schoolName },
  { key: "si", ...META_LABELS.si, numeric: false, align: "left", filterType: "chip", get: siOf, muted: true },
  { key: "gu", ...META_LABELS.gu, numeric: false, align: "left", filterType: "chip", get: guOf, muted: true },
  { key: "graduates",       ...CAREER_LABELS.graduates,       numeric: true, align: "right", filterType: "range", get: (s) => t(s).graduates },
  { key: "generalHigh",     ...CAREER_LABELS.generalHigh,     numeric: true, align: "right", filterType: "range", get: (s) => t(s).generalHigh, muted: true, toggleable: true },
  { key: "scienceHigh",     ...CAREER_LABELS.scienceHigh,     numeric: true, align: "right", filterType: "range", get: (s) => t(s).scienceHigh, toggleable: true },
  { key: "foreignIntlHigh", ...CAREER_LABELS.foreignIntlHigh, numeric: true, align: "right", filterType: "range", get: (s) => t(s).foreignIntlHigh, toggleable: true },
  { key: "artsSportsHigh",  ...CAREER_LABELS.artsSportsHigh,  numeric: true, align: "right", filterType: "range", get: (s) => t(s).artsSportsHigh, toggleable: true },
  { key: "privateAutonomous", ...CAREER_LABELS.privateAutonomous, numeric: true, align: "right", filterType: "range", get: (s) => t(s).privateAutonomous, toggleable: true },
  { key: "publicAutonomous",  ...CAREER_LABELS.publicAutonomous,  numeric: true, align: "right", filterType: "range", get: (s) => t(s).publicAutonomous, toggleable: true },
  { key: "vocationalHigh",  ...CAREER_LABELS.vocationalHigh,  numeric: true, align: "right", filterType: "range", get: (s) => t(s).vocationalHigh, muted: true, toggleable: true },
  { key: "meisterHigh",     ...CAREER_LABELS.meisterHigh,     numeric: true, align: "right", filterType: "range", get: (s) => t(s).meisterHigh, muted: true, toggleable: true },
  { key: "eliteCount",        ...CAREER_LABELS.eliteCount,        numeric: true, align: "right", filterType: "range", get: () => 0, emphasis: true },
  { key: "elitePct",          ...CAREER_LABELS.elitePct,          numeric: true, align: "right", filterType: "range", get: () => 0, emphasis: true },
];

// ─── 상태 ─────────────────────────────────────────────────────────────────
interface TableState {
  textFilters: Record<string, string>;
  chipFilters: Record<string, string[]>;
  ranges: Record<string, { min?: number; max?: number }>;
  /** 선택된 연도. 빈 배열이면 "전체 합산" (모든 가능 연도) */
  yearsSelected: number[];
  sortKey: string;
  sortDir: "asc" | "desc";
  page: number;
  hiddenCols: string[];
}

const INITIAL: TableState = {
  textFilters: {},
  chipFilters: {},
  ranges: {},
  yearsSelected: [], // 빈 = 전체 합산
  sortKey: "elitePct",
  sortDir: "desc",
  page: 0,
  // 일반고는 default 숨김 — 컬럼 토글 버튼 인지성 향상
  // (localStorage에 기존 hiddenCols가 있으면 그쪽이 우선 — 기존 사용자 상태 유지)
  hiddenCols: ["generalHigh"],
};

const PAGE_SIZE = 50;
const HISTORY_KEY = "__schoolTable";
const STORAGE_KEY = "ipsi-viewer.table.state.v1";

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────
export default function SchoolTable({ schools }: { schools: School[] }) {
  const [state, setState] = useState<TableState>(INITIAL);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const initRef = useRef(false);

  // 마운트 시 localStorage에서 필터 복원 + history replaceState
  useEffect(() => {
    let restored: TableState | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) restored = { ...INITIAL, ...JSON.parse(raw) } as TableState;
    } catch { /* corrupt JSON 등 — 무시 */ }
    const initial = restored ?? INITIAL;
    window.history.replaceState({ ...(window.history.state ?? {}), [HISTORY_KEY]: initial }, "");
    if (restored) setState(restored);

    const onPop = (e: PopStateEvent) => {
      const s = (e.state ?? {})[HISTORY_KEY];
      if (s) setState(s);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 상태 변경 시 history push + localStorage 저장 (영속화)
  useEffect(() => {
    if (!initRef.current) { initRef.current = true; return; }
    window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_KEY]: state }, "");
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota 등 */ }
  }, [state]);

  // 팝오버 outside click + ESC 닫기
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openFilter) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpenFilter(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenFilter(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [openFilter]);

  function patch(p: Partial<TableState>) {
    setState((s) => ({ ...s, ...p, page: p.page ?? 0 }));
  }

  function toggleSort(key: string) {
    setState((s) => {
      if (s.sortKey === key) return { ...s, sortDir: s.sortDir === "asc" ? "desc" : "asc", page: 0 };
      const col = COLS.find((c) => c.key === key);
      return { ...s, sortKey: key, sortDir: col?.numeric ? "desc" : "asc", page: 0 };
    });
  }

  // 표시 컬럼 + 합계/비율 계산용 visible toggleable 키 집합
  const visibleCols = COLS.filter((c) => !state.hiddenCols.includes(c.key));
  const visibleToggleableKeys = useMemo(
    () => new Set(COLS.filter((c) => c.toggleable && !state.hiddenCols.includes(c.key)).map((c) => c.key)),
    [state.hiddenCols],
  );

  // 다년 — 전체 학교에서 가능한 연도 모두 수집
  const yearsAvailable = useMemo(() => {
    const set = new Set<number>();
    for (const s of schools) {
      if (s.careersByYear) for (const y of Object.keys(s.careersByYear)) set.add(Number(y));
      else if (s.career?.year) set.add(s.career.year);
    }
    return [...set].sort((a, b) => b - a);
  }, [schools]);

  // 사용자가 선택 안 했으면 모든 연도 합산
  const effectiveYears = state.yearsSelected.length > 0 ? state.yearsSelected : yearsAvailable;
  const rowOf = (s: School): CareerRow => sumYears(s, effectiveYears);
  // 동적 elite 헬퍼 (rowOf + visible toggleable 기준)
  const eliteOf    = (s: School) => dynamicEliteCount(rowOf(s), visibleToggleableKeys);
  const elitePctOf = (s: School) => dynamicElitePct(rowOf(s), visibleToggleableKeys);

  const filtered = useMemo(() => {
    let out = schools;
    for (const [k, v] of Object.entries(state.textFilters)) {
      const q = v.trim();
      if (!q) continue;
      const col = COLS.find((c) => c.key === k);
      if (!col) continue;
      out = out.filter((s) => String(col.get(s)).includes(q));
    }
    // chip multi 필터 (시·구). 빈 배열이면 필터 안 함.
    for (const [k, chips] of Object.entries(state.chipFilters)) {
      if (!chips || chips.length === 0) continue;
      const col = COLS.find((c) => c.key === k);
      if (!col) continue;
      const set = new Set(chips);
      out = out.filter((s) => set.has(String(col.get(s))));
    }
    // 다년 합산 + dynamic 합계/비율 — 모든 진로 카테고리 키에 대해 rowOf 사용
    const valueOf = (key: string, s: School): number | string => {
      if (key === "schoolName") return s.schoolName;
      if (key === "si") return siOf(s);
      if (key === "gu") return guOf(s);
      const row = rowOf(s);
      if (key === "eliteCount") return dynamicEliteCount(row, visibleToggleableKeys);
      if (key === "elitePct")   return dynamicElitePct(row, visibleToggleableKeys);
      return (row as unknown as Record<string, number>)[key] ?? 0;
    };
    for (const [k, r] of Object.entries(state.ranges)) {
      if (!r) continue;
      if (r.min !== undefined) out = out.filter((s) => (valueOf(k, s) as number) >= r.min!);
      if (r.max !== undefined) out = out.filter((s) => (valueOf(k, s) as number) <= r.max!);
    }
    const sortCol = COLS.find((c) => c.key === state.sortKey) ?? COLS[COLS.length - 1];
    const dirFactor = state.sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const va = valueOf(state.sortKey, a);
      const vb = valueOf(state.sortKey, b);
      if (sortCol.numeric) return ((va as number) - (vb as number)) * dirFactor;
      return (va as string).localeCompare(vb as string, "ko") * dirFactor;
    });
  }, [schools, state, visibleToggleableKeys, effectiveYears.join(",")]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(state.page, pageCount - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function isColFiltered(key: string): boolean {
    if (state.textFilters[key]?.trim()) return true;
    if ((state.chipFilters[key]?.length ?? 0) > 0) return true;
    const r = state.ranges[key];
    return r != null && (r.min !== undefined || r.max !== undefined);
  }

  function toggleColVisible(key: string) {
    setState((s) => {
      const hidden = new Set(s.hiddenCols);
      if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
      return { ...s, hiddenCols: [...hidden] };
    });
  }

  const hasActiveFilters =
    Object.values(state.textFilters).some((v) => v.trim()) ||
    Object.values(state.chipFilters).some((v) => v.length > 0) ||
    Object.values(state.ranges).some((r) => r?.min !== undefined || r?.max !== undefined);

  return (
    <div className="space-y-3">
      {/* 상단 바 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">{filtered.length.toLocaleString()}건</span>
          {" "}매치
          <span className="text-slate-300 mx-2">·</span>
          <span className="text-xs text-slate-400">헤더 클릭 정렬 · ▾ 클릭 필터</span>
        </div>
        <button
          onClick={() => setState(INITIAL)}
          className={`text-xs px-3 py-1.5 rounded-md border transition ${
            hasActiveFilters
              ? "border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          필터 초기화
        </button>
      </div>

      {/* 활성 시·구 칩 요약 */}
      {((state.chipFilters.si?.length ?? 0) + (state.chipFilters.gu?.length ?? 0)) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
          <span className="text-xs text-slate-500 mr-0.5">선택:</span>
          {(state.chipFilters.si ?? []).map((v) => (
            <button
              key={`active-si-${v}`}
              onClick={() => patch({ chipFilters: { ...state.chipFilters, si: (state.chipFilters.si ?? []).filter((x) => x !== v) } })}
              className="text-xs px-2 py-0.5 rounded-full bg-white border border-brand-300 text-brand-700 hover:bg-brand-100 inline-flex items-center gap-1"
              title="해제"
            >
              <span className="text-[10px] text-brand-400 font-medium">시</span>
              {v}
              <span className="text-brand-300 ml-0.5">×</span>
            </button>
          ))}
          {(state.chipFilters.gu ?? []).map((v) => (
            <button
              key={`active-gu-${v}`}
              onClick={() => patch({ chipFilters: { ...state.chipFilters, gu: (state.chipFilters.gu ?? []).filter((x) => x !== v) } })}
              className="text-xs px-2 py-0.5 rounded-full bg-white border border-brand-300 text-brand-700 hover:bg-brand-100 inline-flex items-center gap-1"
              title="해제"
            >
              <span className="text-[10px] text-brand-400 font-medium">구</span>
              {v}
              <span className="text-brand-300 ml-0.5">×</span>
            </button>
          ))}
          <button
            onClick={() => patch({ chipFilters: { ...state.chipFilters, si: [], gu: [] } })}
            className="text-[10px] text-slate-400 hover:text-slate-600 ml-1"
          >
            전체 해제
          </button>
        </div>
      )}

      {/* 컨트롤 바 — 연도 + 컬럼 토글 */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
        {/* 연도 칩 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400 font-medium mr-0.5">연도</span>
          {yearsAvailable.map((y) => {
            const on = state.yearsSelected.includes(y);
            return (
              <button
                key={y}
                onClick={() => {
                  const next = on ? state.yearsSelected.filter((x) => x !== y) : [...state.yearsSelected, y].sort((a, b) => b - a);
                  patch({ yearsSelected: next });
                }}
                className={`text-xs px-2 py-0.5 rounded-md border transition cursor-pointer ${
                  on
                    ? "bg-brand-600 border-brand-600 text-white shadow-sm"
                    : "bg-white border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700"
                }`}
                title={`${y}년 진로 데이터${on ? " (선택 해제)" : " 포함"}`}
              >
                {y}
              </button>
            );
          })}
          <span className="text-[10px] text-slate-400">
            {state.yearsSelected.length === 0
              ? `전체 ${yearsAvailable.length}개년 합산`
              : `${state.yearsSelected.length}개년 합산`}
          </span>
        </div>

        {/* 구분선 */}
        <div className="hidden sm:block w-px bg-slate-200 self-stretch" />

        {/* 컬럼 토글 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400 font-medium mr-0.5">진학 종류</span>
          {COLS.filter((c) => c.toggleable).map((c) => {
            const visible = !state.hiddenCols.includes(c.key);
            return (
              <button
                key={c.key}
                onClick={() => toggleColVisible(c.key)}
                className={`text-xs px-2 py-0.5 rounded-md border transition cursor-pointer ${
                  visible
                    ? "bg-brand-50 border-brand-400 text-brand-700 hover:bg-brand-100"
                    : "bg-white border-slate-200 text-slate-400 line-through hover:border-slate-300"
                }`}
                title={visible ? "이 컬럼 숨기기" : "이 컬럼 보이기"}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 표 */}
      <div className="overflow-visible rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm tabular-nums">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 select-none">
            <tr>
              {visibleCols.map((c) => {
                const sortActive = state.sortKey === c.key;
                const dirSym = sortActive ? (state.sortDir === "asc" ? "▲" : "▼") : "↕";
                const colFiltered = isColFiltered(c.key);
                return (
                  <th
                    key={c.key}
                    title={c.description ?? c.label}
                    className={`relative px-3 py-2.5 font-medium text-xs ${c.align === "right" ? "text-right" : "text-left"} ${c.emphasis ? "border-l border-slate-200" : ""}`}
                  >
                    <div className={`flex items-center gap-1 ${c.align === "right" ? "justify-end" : "justify-between"}`}>
                      <span
                        onClick={() => toggleSort(c.key)}
                        className={`cursor-pointer hover:text-brand-600 ${sortActive ? "text-brand-600 font-semibold" : ""}`}
                      >
                        {c.label}
                        <span className={`ml-1 ${sortActive ? "text-brand-500" : "text-slate-300"}`}>{dirSym}</span>
                      </span>
                      {c.filterType && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === c.key ? null : c.key); }}
                          className={`px-1 text-xs leading-none ${colFiltered ? "text-brand-500 font-bold" : "text-slate-300 hover:text-slate-500"}`}
                          title={colFiltered ? "필터 활성" : "필터"}
                        >
                          {colFiltered ? "●" : "▾"}
                        </button>
                      )}
                    </div>
                    {openFilter === c.key && (
                      <FilterPopover
                        ref={popoverRef}
                        col={c}
                        state={state}
                        patch={patch}
                        align={c.align}
                        schools={schools}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="text-center text-slate-400 py-12 text-sm">
                  조건에 맞는 학교가 없습니다
                </td>
              </tr>
            )}
            {slice.map((s, idx) => (
              <tr
                key={s.SHL_IDF_CD}
                className={`border-t border-slate-100 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}
              >
                {visibleCols.map((c) => {
                  const row = rowOf(s);
                  const display =
                    c.key === "schoolName" ? s.schoolName :
                    c.key === "si" ? siOf(s) :
                    c.key === "gu" ? guOf(s) :
                    c.key === "eliteCount" ? eliteOf(s) :
                    c.key === "elitePct"   ? `${elitePctOf(s).toFixed(1)}%` :
                    c.render ? c.render(s) : ((row as unknown as Record<string, number>)[c.key] ?? 0);
                  const isLink = c.key === "schoolName";
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""} ${c.muted ? "text-slate-400 text-xs" : ""} ${c.emphasis ? "font-medium border-l border-slate-200" : ""} ${c.key === "elitePct" ? "font-bold text-brand-600" : ""}`}
                    >
                      {isLink ? (
                        <button
                          onClick={() => {
                            const url = `/school/${encodeURIComponent(s.SHL_IDF_CD)}`;
                            window.open(
                              url,
                              `school-${s.SHL_IDF_CD.slice(0, 8)}`,
                              "popup=yes,width=960,height=900,scrollbars=yes,resizable=yes,noopener,noreferrer",
                            );
                          }}
                          className="text-brand-600 hover:text-brand-800 hover:underline text-left font-medium"
                        >
                          {display}
                        </button>
                      ) : display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm pt-1">
          <button
            onClick={() => patch({ page: Math.max(0, safePage - 1) })}
            disabled={safePage === 0}
            className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-30 hover:border-brand-300 hover:text-brand-600"
          >
            이전
          </button>
          <span className="text-slate-500 text-xs tabular-nums">{safePage + 1} / {pageCount}</span>
          <button
            onClick={() => patch({ page: Math.min(pageCount - 1, safePage + 1) })}
            disabled={safePage >= pageCount - 1}
            className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-30 hover:border-brand-300 hover:text-brand-600"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 필터 팝오버 ───────────────────────────────────────────────────────────
interface PopoverProps {
  col: Col;
  state: TableState;
  patch: (p: Partial<TableState>) => void;
  align: "left" | "right";
  schools: School[];
}

const FilterPopover = forwardRef<HTMLDivElement, PopoverProps>(function FilterPopover(
  { col, state, patch, align, schools }, ref,
) {
  return (
    <div
      ref={ref}
      className={`absolute top-full mt-1.5 z-20 rounded-lg border border-slate-200 bg-white shadow-popover p-3 min-w-[240px] text-left font-normal text-slate-700 ${align === "right" ? "right-0" : "left-0"}`}
      onClick={(e) => e.stopPropagation()}
    >
      {col.filterType === "text" && (
        <div>
          <label className="text-xs text-slate-400 block mb-1.5 font-medium">{col.label} 포함 검색</label>
          <input
            type="text"
            autoFocus
            value={state.textFilters[col.key] ?? ""}
            onChange={(e) => patch({ textFilters: { ...state.textFilters, [col.key]: e.target.value } })}
            placeholder={
              col.key === "schoolName" ? "예: 청심, 휘문, 영훈..." :
              col.key === "si"         ? "예: 강남, 수원, 분당..." :
              col.key === "gu"         ? "예: 영통, 수지, 분당..." :
              "검색어"
            }
            className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100"
          />
        </div>
      )}

      {col.filterType === "chip" && (
        <ChipFilterBody col={col} state={state} patch={patch} schools={schools} />
      )}

      {col.filterType === "range" && (
        <div className="space-y-2 min-w-[220px]">
          <label className="text-xs text-slate-400 block font-medium">{col.label} 범위</label>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="number"
              value={state.ranges[col.key]?.min ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : Number(e.target.value);
                patch({ ranges: { ...state.ranges, [col.key]: { ...state.ranges[col.key], min: v } } });
              }}
              placeholder="최소"
              className="w-20 rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:border-brand-400"
            />
            <span className="text-slate-300">~</span>
            <input
              type="number"
              value={state.ranges[col.key]?.max ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : Number(e.target.value);
                patch({ ranges: { ...state.ranges, [col.key]: { ...state.ranges[col.key], max: v } } });
              }}
              placeholder="최대"
              className="w-20 rounded-md border border-slate-200 px-2 py-1.5 focus:outline-none focus:border-brand-400"
            />
          </div>
          {(state.ranges[col.key]?.min !== undefined || state.ranges[col.key]?.max !== undefined) && (
            <button
              onClick={() => {
                const next = { ...state.ranges };
                delete next[col.key];
                patch({ ranges: next });
              }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >해제</button>
          )}
        </div>
      )}
    </div>
  );
});

// ─── chip multi 필터 (시·구 등) ───────────────────────────────────────────
function ChipFilterBody({
  col, state, patch, schools,
}: {
  col: Col;
  state: TableState;
  patch: (p: Partial<TableState>) => void;
  schools: School[];
}) {
  const [query, setQuery] = useState("");
  const selected = state.chipFilters[col.key] ?? [];

  const pool = useMemo(() => {
    const set = new Set<string>();
    if (col.key === "gu") {
      // 시 필터 활성 시 그 시들의 구만 노출 (cascading)
      const siChips = state.chipFilters["si"] ?? [];
      const siActive = siChips.length > 0;
      const siSet = new Set(siChips);
      for (const s of schools) {
        if (siActive && !siSet.has(siOf(s))) continue;
        const g = guOf(s);
        if (g) set.add(g);
      }
    } else {
      for (const s of schools) {
        const v = String(col.get(s));
        if (v) set.add(v);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [col, schools, state.chipFilters]);

  const q = query.trim();
  const matched = q ? pool.filter((o) => o.includes(q)) : pool;

  return (
    <div className="space-y-2 min-w-[260px] max-w-[320px]">
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-400 font-medium">
          {col.label} 선택 {selected.length > 0 && `(${selected.length} / ${pool.length})`}
        </label>
        {selected.length > 0 && (
          <button
            onClick={() => patch({ chipFilters: { ...state.chipFilters, [col.key]: [] } })}
            className="text-[10px] text-slate-400 hover:text-slate-600"
          >해제</button>
        )}
      </div>
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={col.key === "si" ? "검색: 수원, 강남, 분당…" : "검색: 영통, 분당, 수지…"}
        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-400"
      />
      {selected.length > 0 && (
        <div className="border-b border-slate-100 pb-2">
          <div className="text-[10px] text-slate-400 mb-1">선택됨 ({selected.length})</div>
          <div className="flex flex-wrap gap-1">
            {selected.map((opt) => (
              <button
                key={`sel-${opt}`}
                onClick={() => patch({ chipFilters: { ...state.chipFilters, [col.key]: selected.filter((x) => x !== opt) } })}
                className="text-xs px-2 py-0.5 rounded-full border bg-brand-600 border-brand-600 text-white hover:bg-brand-700 inline-flex items-center gap-1"
                title="해제"
              >
                {opt}
                <span className="text-brand-200 text-[10px]">×</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1 max-h-56 overflow-y-auto p-0.5">
        {matched.length === 0 ? (
          <span className="text-xs text-slate-400 px-1">매치 없음</span>
        ) : matched.filter((opt) => !selected.includes(opt)).map((opt) => (
          <button
            key={opt}
            onClick={() => patch({ chipFilters: { ...state.chipFilters, [col.key]: [...selected, opt] } })}
            className="text-xs px-2 py-0.5 rounded-full border bg-white border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700 transition"
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
