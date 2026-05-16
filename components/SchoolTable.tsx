"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { School, CareerRow } from "@/lib/types";
import { eliteCount, elitePct } from "@/lib/types";

// ─── 컬럼 정의 ────────────────────────────────────────────────────────────
type FilterType = "text" | "loc" | "range";

interface Col {
  key: string;
  label: string;
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

const COLS: Col[] = [
  { key: "schoolName", label: "학교명", numeric: false, align: "left",
    filterType: "text", get: (s) => s.schoolName },
  { key: "loc", label: "지역", numeric: false, align: "left", filterType: "loc",
    get: (s) => `${s.sidoName} ${s.sigungu ?? ""}`,
    render: (s) => s.sigungu ? `${s.sidoName} ${s.sigungu}` : s.sidoName, muted: true },
  { key: "graduates", label: "졸업", numeric: true, align: "right", filterType: "range", get: (s) => t(s).graduates },
  { key: "generalHigh", label: "일반", numeric: true, align: "right", filterType: "range", get: (s) => t(s).generalHigh, muted: true },
  { key: "scienceHigh", label: "과학", numeric: true, align: "right", filterType: "range", get: (s) => t(s).scienceHigh, toggleable: true },
  { key: "foreignIntlHigh", label: "외고/국제", numeric: true, align: "right", filterType: "range", get: (s) => t(s).foreignIntlHigh, toggleable: true },
  { key: "artsSportsHigh", label: "예체", numeric: true, align: "right", filterType: "range", get: (s) => t(s).artsSportsHigh, muted: true, toggleable: true },
  { key: "privateAutonomous", label: "자사", numeric: true, align: "right", filterType: "range", get: (s) => t(s).privateAutonomous, toggleable: true },
  { key: "publicAutonomous", label: "자공", numeric: true, align: "right", filterType: "range", get: (s) => t(s).publicAutonomous, muted: true, toggleable: true },
  { key: "eliteCount", label: "합계", numeric: true, align: "right", filterType: "range", get: (s) => eliteCount(t(s)), emphasis: true },
  { key: "elitePct", label: "비율", numeric: true, align: "right", filterType: "range", get: (s) => elitePct(t(s)), emphasis: true,
    render: (s) => `${elitePct(t(s)).toFixed(1)}%` },
];

const SIDO_PRESETS = ["전체", "서울", "경기", "인천"] as const;
type SidoPreset = typeof SIDO_PRESETS[number];

// ─── 상태 ─────────────────────────────────────────────────────────────────
interface TableState {
  textFilters: Record<string, string>;
  loc: { sido: SidoPreset; sigungu: string[] };
  ranges: Record<string, { min?: number; max?: number }>;
  sortKey: string;
  sortDir: "asc" | "desc";
  page: number;
  hiddenCols: string[]; // 숨김 처리할 컬럼 key 리스트
}

const INITIAL: TableState = {
  textFilters: {},
  loc: { sido: "전체", sigungu: [] },
  ranges: {},
  sortKey: "elitePct",
  sortDir: "desc",
  page: 0,
  hiddenCols: [],
};

const PAGE_SIZE = 50;
const HISTORY_KEY = "__schoolTable";

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────
export default function SchoolTable({ schools }: { schools: School[] }) {
  const [state, setState] = useState<TableState>(INITIAL);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const initRef = useRef(false);

  // 마운트 시 INITIAL을 현재 history entry에 replace (뒤로가기 시작점 확보)
  useEffect(() => {
    window.history.replaceState({ ...(window.history.state ?? {}), [HISTORY_KEY]: INITIAL }, "");
    const onPop = (e: PopStateEvent) => {
      const s = (e.state ?? {})[HISTORY_KEY];
      if (s) setState(s);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 상태 변경 시 history에 push (URL 변경 안 함 → 새로고침 시 초기화)
  useEffect(() => {
    if (!initRef.current) { initRef.current = true; return; }
    window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_KEY]: state }, "");
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

  const sigunguOptions = useMemo(() => {
    const pool = state.loc.sido === "전체" ? schools : schools.filter((s) => s.sidoName === state.loc.sido);
    const set = new Set<string>();
    for (const s of pool) {
      if (s.sigungu) for (const tk of s.sigungu.split(/\s+/)) if (tk) set.add(tk);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [state.loc.sido, schools]);

  const filtered = useMemo(() => {
    let out = schools;
    for (const [k, v] of Object.entries(state.textFilters)) {
      const q = v.trim();
      if (!q) continue;
      const col = COLS.find((c) => c.key === k);
      if (!col) continue;
      out = out.filter((s) => String(col.get(s)).includes(q));
    }
    if (state.loc.sido !== "전체") out = out.filter((s) => s.sidoName === state.loc.sido);
    if (state.loc.sigungu.length > 0) {
      const sel = state.loc.sigungu;
      out = out.filter((s) => {
        const tk = (s.sigungu ?? "").split(/\s+/);
        return sel.some((x) => tk.includes(x));
      });
    }
    for (const [k, r] of Object.entries(state.ranges)) {
      const col = COLS.find((c) => c.key === k);
      if (!col || !r) continue;
      if (r.min !== undefined) out = out.filter((s) => (col.get(s) as number) >= r.min!);
      if (r.max !== undefined) out = out.filter((s) => (col.get(s) as number) <= r.max!);
    }
    const sortCol = COLS.find((c) => c.key === state.sortKey) ?? COLS[COLS.length - 1];
    const dirFactor = state.sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const va = sortCol.get(a);
      const vb = sortCol.get(b);
      if (sortCol.numeric) return ((va as number) - (vb as number)) * dirFactor;
      return (va as string).localeCompare(vb as string, "ko") * dirFactor;
    });
  }, [schools, state]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(state.page, pageCount - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function isColFiltered(key: string): boolean {
    if (key === "loc") return state.loc.sido !== "전체" || state.loc.sigungu.length > 0;
    if (state.textFilters[key]?.trim()) return true;
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

  const visibleCols = COLS.filter((c) => !state.hiddenCols.includes(c.key));

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          {filtered.length.toLocaleString()}건 매치 · 헤더 클릭 정렬, <span className="inline-block px-1 text-xs">▾</span> 클릭 필터
        </div>
        <button
          onClick={() => setState(INITIAL)}
          className="text-xs px-3 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100"
        >
          모든 필터 초기화
        </button>
      </div>

      {/* 표시 컬럼 토글 — 진학 학교 종류만 (학교명·지역·졸업·일반·합계·비율은 항상 표시) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500 mr-1">진학 종류 표시:</span>
        {COLS.filter((c) => c.toggleable).map((c) => {
          const visible = !state.hiddenCols.includes(c.key);
          return (
            <button
              key={c.key}
              onClick={() => toggleColVisible(c.key)}
              className={`text-xs px-2 py-0.5 rounded border transition cursor-pointer ${
                visible
                  ? "bg-brand-50 border-brand-500 text-brand-700"
                  : "bg-white border-slate-300 text-slate-400 line-through hover:bg-slate-100"
              }`}
              title={visible ? "이 컬럼 숨기기" : "이 컬럼 보이기"}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* 표 */}
      <div className="overflow-visible rounded border border-slate-200 bg-white">
        <table className="min-w-full text-sm tabular-nums">
          <thead className="bg-slate-100 text-slate-600 select-none">
            <tr>
              {visibleCols.map((c) => {
                const sortActive = state.sortKey === c.key;
                const dirSym = sortActive ? (state.sortDir === "asc" ? "▲" : "▼") : "↕";
                const colFiltered = isColFiltered(c.key);
                return (
                  <th
                    key={c.key}
                    className={`relative px-3 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"} ${c.emphasis ? "border-l border-slate-200" : ""}`}
                  >
                    <div className={`flex items-center gap-1 ${c.align === "right" ? "justify-end" : "justify-between"}`}>
                      <span
                        onClick={() => toggleSort(c.key)}
                        className={`cursor-pointer hover:text-brand-700 ${sortActive ? "text-brand-700" : ""}`}
                      >
                        {c.label}
                        <span className={`ml-1 text-xs ${sortActive ? "text-brand-600" : "text-slate-300"}`}>{dirSym}</span>
                      </span>
                      {c.filterType && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === c.key ? null : c.key); }}
                          className={`px-1 text-xs ${colFiltered ? "text-brand-600 font-bold" : "text-slate-400 hover:text-slate-700"}`}
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
                        sigunguOptions={sigunguOptions}
                        align={c.align}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr><td colSpan={visibleCols.length} className="text-center text-slate-400 py-8">결과 없음</td></tr>
            )}
            {slice.map((s) => (
              <tr key={s.SHL_IDF_CD} className="border-t border-slate-100 hover:bg-slate-50">
                {visibleCols.map((c) => {
                  const display = c.render ? c.render(s) : c.get(s);
                  const isLink = c.key === "schoolName";
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""} ${c.muted ? "text-slate-500 text-xs" : ""} ${c.emphasis ? "font-medium border-l border-slate-200" : ""} ${c.key === "elitePct" ? "font-bold text-brand-700" : ""}`}
                    >
                      {isLink ? (
                        <Link
                          href={`/school/${encodeURIComponent(s.SHL_IDF_CD)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-700 hover:underline"
                        >
                          {display}
                        </Link>
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
        <div className="flex items-center justify-center gap-2 text-sm">
          <button onClick={() => patch({ page: Math.max(0, safePage - 1) })} disabled={safePage === 0}
            className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-30">이전</button>
          <span className="text-slate-600">{safePage + 1} / {pageCount}</span>
          <button onClick={() => patch({ page: Math.min(pageCount - 1, safePage + 1) })} disabled={safePage >= pageCount - 1}
            className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-30">다음</button>
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
  sigunguOptions: string[];
  align: "left" | "right";
}

const FilterPopover = forwardRef<HTMLDivElement, PopoverProps>(function FilterPopover(
  { col, state, patch, sigunguOptions, align }, ref,
) {
  return (
    <div
      ref={ref}
      className={`absolute top-full mt-1 z-20 rounded border border-slate-300 bg-white shadow-lg p-3 min-w-[240px] text-left font-normal text-slate-700 ${align === "right" ? "right-0" : "left-0"}`}
      onClick={(e) => e.stopPropagation()}
    >
      {col.filterType === "text" && (
        <div>
          <label className="text-xs text-slate-500 block mb-1">학교명 검색</label>
          <input
            type="text"
            autoFocus
            value={state.textFilters[col.key] ?? ""}
            onChange={(e) => patch({ textFilters: { ...state.textFilters, [col.key]: e.target.value } })}
            placeholder="예: 청심, 휘문..."
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
      )}

      {col.filterType === "loc" && (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-slate-500 block mb-1">시도</label>
            <select
              value={state.loc.sido}
              onChange={(e) => patch({ loc: { sido: e.target.value as SidoPreset, sigungu: [] } })}
              className="rounded border border-slate-300 px-2 py-1 text-sm bg-white w-full"
            >
              {SIDO_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {sigunguOptions.length > 0 && (
            <div>
              <label className="text-xs text-slate-500 block mb-1">
                시군구 다중 선택 {state.loc.sigungu.length > 0 && `(${state.loc.sigungu.length})`}
              </label>
              <div className="flex flex-wrap gap-1 max-h-52 overflow-y-auto p-0.5">
                {sigunguOptions.map((name) => {
                  const on = state.loc.sigungu.includes(name);
                  return (
                    <button
                      key={name}
                      onClick={() => {
                        const next = on ? state.loc.sigungu.filter((x) => x !== name) : [...state.loc.sigungu, name];
                        patch({ loc: { ...state.loc, sigungu: next } });
                      }}
                      className={`text-xs px-2 py-0.5 rounded-full border transition ${on ? "bg-brand-600 border-brand-600 text-white" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"}`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
              {state.loc.sigungu.length > 0 && (
                <button
                  onClick={() => patch({ loc: { ...state.loc, sigungu: [] } })}
                  className="mt-1 text-xs text-slate-500 hover:underline"
                >시군구 해제</button>
              )}
            </div>
          )}
        </div>
      )}

      {col.filterType === "range" && (
        <div className="space-y-2">
          <label className="text-xs text-slate-500 block">{col.label} 범위</label>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="number"
              value={state.ranges[col.key]?.min ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : Number(e.target.value);
                patch({ ranges: { ...state.ranges, [col.key]: { ...state.ranges[col.key], min: v } } });
              }}
              placeholder="최소"
              className="w-20 rounded border border-slate-300 px-2 py-1"
            />
            <span className="text-slate-400">~</span>
            <input
              type="number"
              value={state.ranges[col.key]?.max ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : Number(e.target.value);
                patch({ ranges: { ...state.ranges, [col.key]: { ...state.ranges[col.key], max: v } } });
              }}
              placeholder="최대"
              className="w-20 rounded border border-slate-300 px-2 py-1"
            />
          </div>
          {(state.ranges[col.key]?.min !== undefined || state.ranges[col.key]?.max !== undefined) && (
            <button
              onClick={() => {
                const next = { ...state.ranges };
                delete next[col.key];
                patch({ ranges: next });
              }}
              className="text-xs text-slate-500 hover:underline"
            >해제</button>
          )}
        </div>
      )}
    </div>
  );
});
