/**
 * 데이터 로딩 layer — 현재는 정적 JSONL 파일 (`data/schools-with-career.jsonl`).
 * 향후 Firestore로 옮길 때 이 파일의 함수 시그니처만 유지하면 page는 변경 불필요.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { School } from "./types";

const JSONL_PATH = path.join(process.cwd(), "data", "schools-with-career.jsonl");

let _cache: School[] | null = null;

/** 전체 학교 로딩 (한 번만 파싱 후 캐시). server-only. */
export async function loadAllSchools(): Promise<School[]> {
  if (_cache) return _cache;
  const raw = await readFile(JSONL_PATH, "utf-8");
  const list: School[] = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as School);
  _cache = list;
  return list;
}

/** 진로 데이터 있는 학교만 (UI 기본 view) */
export async function loadSchoolsWithCareer(): Promise<School[]> {
  const all = await loadAllSchools();
  return all.filter((s) => s.career != null);
}

/** SHL_IDF_CD 단일 조회 */
export async function loadSchool(SHL_IDF_CD: string): Promise<School | null> {
  const all = await loadAllSchools();
  return all.find((s) => s.SHL_IDF_CD === SHL_IDF_CD) ?? null;
}
