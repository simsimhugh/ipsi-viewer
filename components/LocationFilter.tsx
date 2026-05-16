"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { School } from "@/lib/types";

/**
 * 지역 필터 — 시도/시/구 cascading + 검색 + 그룹화.
 *
 * 트리 최상위 그룹 (사용자 정의 우선순위):
 *   - 광역시·세종 (8): 서울·부산·대구·인천·광주·대전·울산·세종 → 그 안의 구
 *   - 경기 큰 시 (3): 수원시·용인시·화성시 → 그 안의 구
 *   - 경기 (기타): 위 3개 시 제외 나머지 시·군
 *   - 도 (8): 강원·충북·충남·전북·전남·경북·경남·제주 → 시·군 (시 안 구는 시 펼침)
 *
 * 선택 단위: 최하위 (구 또는 시 단일). 사용자 매치는 unique key = `${sidoName}/${sigungu}`.
 * UI:
 *   - 외부: 선택된 chip 표시 + 검색 input
 *   - 클릭/입력 → 드롭다운 패널: 그룹별 [전체] 토글 + 자식 chip multi
 *   - ESC, 외부 클릭, 다른 그룹 헤더 클릭으로 닫힘
 */

const METRO_CITIES = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]);
const GG_BIG_CITIES = new Set(["수원시", "용인시", "화성시"]);

interface SiNode {
  /** 표시 라벨 (예: "수원시"). null이면 단일 토큰(군) */
  si: string;
  /** 그 시 안의 구 list. 비어있으면 시 자체가 단일 (구 없음, 군·작은 시) */
  gus: string[];
}

interface TopGroup {
  key: string;     // 식별자
  label: string;   // 표시 라벨 (예: "서울 (광역시)", "수원시 (경기)")
  scope: "metro" | "gg-big" | "gg-other" | "do";
  /** 그 그룹에 속하는 시도 이름 */
  sidoName: string;
  /** 그 그룹의 시 노드 (광역시는 빈 si로 구만) */
  siNodes: SiNode[];
  /** 그룹 안 학교 수 */
  count: number;
}

function buildTree(schools: School[]): TopGroup[] {
  // sido → si → gus 집합 누적
  const acc: Record<string, Record<string, Set<string> | null>> = {};
  const counts: Record<string, number> = {}; // sidoName 또는 큰시 카운트
  for (const s of schools) {
    if (!s.sidoName || !s.sigungu) continue;
    const tokens = s.sigungu.split(/\s+/).filter(Boolean);
    const sido = s.sidoName;
    if (!acc[sido]) acc[sido] = {};
    if (METRO_CITIES.has(sido)) {
      const gu = tokens[0]; if (!gu) continue;
      if (!acc[sido][gu]) acc[sido][gu] = null; // 광역시는 단일 토큰
    } else {
      const si = tokens[0]; if (!si) continue;
      const gu = tokens[1];
      if (!acc[sido][si]) acc[sido][si] = new Set();
      if (gu) acc[sido][si]!.add(gu);
    }
  }
  // 학교 카운트 — 그룹별 (큰 시는 별도)
  for (const s of schools) {
    if (!s.sidoName || !s.sigungu) continue;
    const tokens = s.sigungu.split(/\s+/).filter(Boolean);
    let key: string;
    if (METRO_CITIES.has(s.sidoName)) key = s.sidoName;
    else if (s.sidoName === "경기" && GG_BIG_CITIES.has(tokens[0])) key = `경기/${tokens[0]}`;
    else if (s.sidoName === "경기") key = "경기 (기타)";
    else key = s.sidoName;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const groups: TopGroup[] = [];

  // 광역시 (8개, 고정 순서)
  for (const m of ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]) {
    if (!acc[m]) continue;
    const gus = Object.keys(acc[m]).sort((a, b) => a.localeCompare(b, "ko"));
    groups.push({
      key: m, label: `${m} (광역시)`, scope: "metro", sidoName: m,
      siNodes: [{ si: "", gus }], count: counts[m] ?? 0,
    });
  }

  // 경기 큰 시 (3개)
  for (const bs of ["수원시", "용인시", "화성시"]) {
    const set = acc["경기"]?.[bs];
    if (set === undefined) continue;
    const gus = set === null ? [] : [...set].sort((a, b) => a.localeCompare(b, "ko"));
    groups.push({
      key: `경기/${bs}`, label: `${bs} (경기)`, scope: "gg-big", sidoName: "경기",
      siNodes: [{ si: bs, gus }], count: counts[`경기/${bs}`] ?? 0,
    });
  }

  // 경기 기타
  if (acc["경기"]) {
    const sisLeft = Object.keys(acc["경기"]).filter((si) => !GG_BIG_CITIES.has(si));
    if (sisLeft.length > 0) {
      const siNodes: SiNode[] = sisLeft
        .sort((a, b) => a.localeCompare(b, "ko"))
        .map((si) => {
          const gset = acc["경기"]![si];
          const gus = gset === null ? [] : [...gset].sort((a, b) => a.localeCompare(b, "ko"));
          return { si, gus };
        });
      groups.push({
        key: "경기-other", label: "경기 (기타)", scope: "gg-other", sidoName: "경기",
        siNodes, count: counts["경기 (기타)"] ?? 0,
      });
    }
  }

  // 도 (8개, 고정 순서)
  for (const d of ["강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]) {
    if (!acc[d]) continue;
    const sis = Object.keys(acc[d]).sort((a, b) => a.localeCompare(b, "ko"));
    const siNodes: SiNode[] = sis.map((si) => {
      const gset = acc[d][si];
      const gus = gset === null ? [] : [...gset].sort((a, b) => a.localeCompare(b, "ko"));
      return { si, gus };
    });
    groups.push({ key: d, label: `${d} (도)`, scope: "do", sidoName: d, siNodes, count: counts[d] ?? 0 });
  }

  return groups;
}

/** Selection key: `${sidoName}/${sigunguFull}` — sigunguFull = "강남구" 또는 "수원시 영통구" */
function makeKey(sidoName: string, sigunguFull: string): string {
  return `${sidoName}/${sigunguFull}`;
}

interface Leaf {
  sidoName: string;
  sigunguFull: string; // "강남구" or "수원시 영통구"
  label: string;       // 표시용 (예: "강남구", "영통구")
  parentSi: string;    // 도일 때 시 ("수원시"), 광역시면 ""
}

function leavesOf(group: TopGroup): Leaf[] {
  const out: Leaf[] = [];
  for (const sn of group.siNodes) {
    if (sn.gus.length === 0) {
      // 시·군 단일 (구 없음). 광역시는 sn.si === "" → 발생 안 함.
      // 도일 때 시 자체가 leaf
      if (sn.si) out.push({ sidoName: group.sidoName, sigunguFull: sn.si, label: sn.si, parentSi: "" });
    } else {
      for (const gu of sn.gus) {
        const full = sn.si ? `${sn.si} ${gu}` : gu;
        out.push({ sidoName: group.sidoName, sigunguFull: full, label: gu, parentSi: sn.si });
      }
    }
  }
  return out;
}

export default function LocationFilter({
  schools,
  selected,
  onChange,
}: {
  schools: School[];
  selected: string[]; // key set
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildTree(schools), [schools]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function toggleLeaf(leaf: Leaf) {
    const k = makeKey(leaf.sidoName, leaf.sigunguFull);
    const next = new Set(selected);
    if (next.has(k)) next.delete(k); else next.add(k);
    onChange([...next]);
  }
  function toggleAllInGroup(group: TopGroup) {
    const leaves = leavesOf(group);
    const keys = leaves.map((l) => makeKey(l.sidoName, l.sigunguFull));
    const allOn = keys.every((k) => selectedSet.has(k));
    const next = new Set(selected);
    if (allOn) keys.forEach((k) => next.delete(k));
    else keys.forEach((k) => next.add(k));
    onChange([...next]);
  }
  function toggleAllInSi(group: TopGroup, si: string) {
    // 도 안 한 시(예: 수원시) 모든 구 토글 — gg-other 그룹의 시 헤더에 사용
    const sn = group.siNodes.find((s) => s.si === si);
    if (!sn) return;
    const keys = sn.gus.map((gu) => makeKey(group.sidoName, `${si} ${gu}`));
    if (keys.length === 0) keys.push(makeKey(group.sidoName, si)); // 시 단일
    const allOn = keys.every((k) => selectedSet.has(k));
    const next = new Set(selected);
    if (allOn) keys.forEach((k) => next.delete(k));
    else keys.forEach((k) => next.add(k));
    onChange([...next]);
  }

  // 검색 매치 leaf set
  const matchKeys = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.trim();
    const out = new Set<string>();
    for (const g of tree) {
      for (const l of leavesOf(g)) {
        if (l.sigunguFull.includes(q) || l.label.includes(q) || g.sidoName.includes(q) || (l.parentSi && l.parentSi.includes(q))) {
          out.add(makeKey(l.sidoName, l.sigunguFull));
        }
      }
    }
    return out;
  }, [query, tree]);

  return (
    <div ref={ref} className="relative w-full">
      <div
        onClick={() => setOpen(true)}
        className="border border-slate-300 rounded bg-white px-2 py-1 min-h-[34px] flex flex-wrap gap-1 items-center cursor-text"
      >
        {selected.length === 0 && !open && (
          <span className="text-xs text-slate-400">지역 선택 (검색 가능)</span>
        )}
        {selected.map((k) => {
          const [sido, sg] = k.split("/", 2);
          return (
            <span key={k} className="inline-flex items-center gap-1 text-xs bg-brand-100 text-brand-700 rounded-full px-2 py-0.5">
              {sido} {sg}
              <button
                onClick={(e) => { e.stopPropagation(); onChange(selected.filter((x) => x !== k)); }}
                className="text-brand-700 hover:text-brand-900"
              >×</button>
            </span>
          );
        })}
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length === 0 ? "" : "추가 검색…"}
          className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
        />
        {selected.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange([]); setQuery(""); }}
            className="text-xs text-slate-400 hover:text-slate-700"
            title="전체 해제"
          >해제</button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-30 rounded border border-slate-300 bg-white shadow-lg max-h-96 overflow-y-auto p-2 text-sm font-normal text-slate-700">
          {tree.map((g) => {
            const leaves = leavesOf(g);
            // 검색 시 leaf가 없으면 group 숨김
            const visibleLeaves = matchKeys
              ? leaves.filter((l) => matchKeys.has(makeKey(l.sidoName, l.sigunguFull)))
              : leaves;
            if (matchKeys && visibleLeaves.length === 0) return null;
            const allKeysInGroup = leaves.map((l) => makeKey(l.sidoName, l.sigunguFull));
            const selectedInGroup = allKeysInGroup.filter((k) => selectedSet.has(k)).length;

            return (
              <div key={g.key} className="mb-2">
                <div className="flex items-center justify-between sticky top-0 bg-slate-50 px-2 py-1 rounded">
                  <span className="font-medium text-slate-700 text-xs">
                    {g.label}
                    <span className="ml-1 text-slate-400">({g.count})</span>
                    {selectedInGroup > 0 && <span className="ml-1 text-brand-600">· {selectedInGroup} 선택</span>}
                  </span>
                  <button
                    onClick={() => toggleAllInGroup(g)}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    {allKeysInGroup.length > 0 && allKeysInGroup.every((k) => selectedSet.has(k)) ? "전체 해제" : "이 그룹 전체"}
                  </button>
                </div>
                {/* gg-other 그룹은 시 헤더로 한 번 더 그룹화 */}
                {g.scope === "gg-other" || g.scope === "do" ? (
                  <div className="pl-2 mt-1 space-y-1">
                    {g.siNodes.map((sn) => {
                      const siLeaves = sn.gus.length > 0
                        ? sn.gus.map((gu) => ({ leaf: leaves.find((l) => l.parentSi === sn.si && l.label === gu)! }))
                        : (sn.si ? [{ leaf: leaves.find((l) => l.label === sn.si)! }] : []);
                      const siKeys = siLeaves.map((x) => makeKey(x.leaf.sidoName, x.leaf.sigunguFull));
                      const siVisible = matchKeys ? siLeaves.filter((x) => matchKeys.has(makeKey(x.leaf.sidoName, x.leaf.sigunguFull))) : siLeaves;
                      if (matchKeys && siVisible.length === 0) return null;
                      return (
                        <div key={sn.si} className="text-xs">
                          {sn.gus.length > 0 ? (
                            <div className="flex items-center gap-1 text-slate-500 mt-1">
                              <span className="font-medium text-slate-600">{sn.si}</span>
                              <button
                                onClick={() => toggleAllInSi(g, sn.si)}
                                className="text-[10px] text-brand-600 hover:underline"
                              >
                                {siKeys.every((k) => selectedSet.has(k)) ? "해제" : "전체"}
                              </button>
                              <span className="flex flex-wrap gap-1 ml-1">
                                {siVisible.map(({ leaf }) => (
                                  <Chip key={makeKey(leaf.sidoName, leaf.sigunguFull)} on={selectedSet.has(makeKey(leaf.sidoName, leaf.sigunguFull))} onClick={() => toggleLeaf(leaf)}>
                                    {leaf.label}
                                  </Chip>
                                ))}
                              </span>
                            </div>
                          ) : (
                            // 시 단일 (구 없음)
                            siVisible.map(({ leaf }) => (
                              <Chip key={makeKey(leaf.sidoName, leaf.sigunguFull)} on={selectedSet.has(makeKey(leaf.sidoName, leaf.sigunguFull))} onClick={() => toggleLeaf(leaf)}>
                                {leaf.label}
                              </Chip>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // 광역시·세종·gg-big — 한 줄에 구 chip
                  <div className="flex flex-wrap gap-1 mt-1 pl-2">
                    {visibleLeaves.map((leaf) => (
                      <Chip
                        key={makeKey(leaf.sidoName, leaf.sigunguFull)}
                        on={selectedSet.has(makeKey(leaf.sidoName, leaf.sigunguFull))}
                        onClick={() => toggleLeaf(leaf)}
                      >
                        {leaf.label}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded-full border transition ${
        on
          ? "bg-brand-600 border-brand-600 text-white"
          : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

/** UI 외부에서 학교가 선택된 키들에 매치되는지 검사 */
export function matchesLocation(school: School, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const key = makeKey(school.sidoName, school.sigungu ?? "");
  return selected.includes(key);
}
