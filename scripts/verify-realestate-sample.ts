/**
 * 부동산 데이터 정확도 검증 샘플 스크립트.
 *
 * UI에 실제 표시되는 값(loadApartmentsForSchool)을 그대로 꺼내
 * 사람이 아실(asil.kr) 등에서 cross-check 하기 쉬운 형태로 출력.
 *
 * 실행:
 *   cd /home/hugh/project/hakgun-viewer
 *   npx tsx --env-file=.env.local scripts/verify-realestate-sample.ts
 *
 * 결과: 콘솔 stdout + /tmp/realestate-verify-sample.txt 동시 저장.
 */

import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import { loadApartmentsForSchool } from "../lib/realestate";

const OUTPUT_FILE = "/tmp/realestate-verify-sample.txt";
const SCHOOL_SAMPLE_COUNT = 5;
const MIN_APARTMENTS = 3; // 인근 아파트 최소 개수

// ────────────────────────────────────────────────────────────
// Supabase 클라이언트 (lib/realestate.ts 와 동일 패턴)
// ────────────────────────────────────────────────────────────
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 없음");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ────────────────────────────────────────────────────────────
// 포맷 헬퍼
// ────────────────────────────────────────────────────────────
function fmtWon(won: number): string {
  const eok = won / 1e8;
  if (eok >= 10) return `${eok.toFixed(1)}억`;
  if (eok >= 1) return `${eok.toFixed(2)}억`;
  return `${Math.round(won / 1e4).toLocaleString()}만`;
}

function fmtManWon(manWon: number): string {
  const eok = manWon / 1e4;
  if (eok >= 10) return `${eok.toFixed(1)}억`;
  if (eok >= 1) return `${eok.toFixed(2)}억`;
  return `${manWon.toLocaleString()}만`;
}

function fmtArea(m2: number | null): string {
  if (m2 == null) return "면적 미상";
  return `${m2.toFixed(2)}㎡`;
}

// ────────────────────────────────────────────────────────────
// 학교 목록 조회 — apartment_school_map 집계로 인근 단지 수 파악
// ────────────────────────────────────────────────────────────
interface SchoolRow {
  shl_idf_cd: string;
  school_name: string;
  address: string | null;
  sigungu: string | null;
  lat: number | null;
  lng: number | null;
  apt_count: number;
}

async function fetchCandidateSchools(): Promise<SchoolRow[]> {
  const sb = getSupabaseClient();

  // schools 테이블에서 좌표 있는 학교 목록 (최대 2000개)
  const { data: schools, error: schoolErr } = await sb
    .from("schools")
    .select("shl_idf_cd, school_name, address, sigungu, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .limit(2000);

  if (schoolErr) throw new Error(`schools 조회 실패: ${schoolErr.message}`);
  if (!schools || schools.length === 0) throw new Error("schools 테이블 데이터 없음");

  // apartment_school_map에서 단지 수 집계
  const shlIds = schools.map((s: { shl_idf_cd: string }) => s.shl_idf_cd);
  const { data: mapRows, error: mapErr } = await sb
    .from("apartment_school_map")
    .select("shl_idf_cd")
    .in("shl_idf_cd", shlIds);

  if (mapErr) throw new Error(`apartment_school_map 조회 실패: ${mapErr.message}`);

  // 학교별 단지 수 집계
  const countMap = new Map<string, number>();
  for (const row of mapRows ?? []) {
    countMap.set(row.shl_idf_cd, (countMap.get(row.shl_idf_cd) ?? 0) + 1);
  }

  // MIN_APARTMENTS 이상인 학교만 필터
  const candidates: SchoolRow[] = schools
    .map((s: { shl_idf_cd: string; school_name: string; address: string | null; sigungu: string | null; lat: number | null; lng: number | null }) => ({
      shl_idf_cd: s.shl_idf_cd,
      school_name: s.school_name,
      address: s.address,
      sigungu: s.sigungu,
      lat: s.lat,
      lng: s.lng,
      apt_count: countMap.get(s.shl_idf_cd) ?? 0,
    }))
    .filter((s: SchoolRow) => s.apt_count >= MIN_APARTMENTS);

  return candidates;
}

// ────────────────────────────────────────────────────────────
// 랜덤 N개 선정 (시군구 중복 최소화 — 같은 시군구 후순위)
// ────────────────────────────────────────────────────────────
function pickRandom(candidates: SchoolRow[], n: number): SchoolRow[] {
  // Fisher-Yates 셔플
  const arr = [...candidates];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  // 시군구 중복 최소화: 첫 선택 시군구 집합 추적
  const picked: SchoolRow[] = [];
  const usedSigungu = new Set<string>();

  // 1순위: 시군구 겹치지 않는 학교
  for (const s of arr) {
    if (picked.length >= n) break;
    const sg = s.sigungu ?? "미상";
    if (!usedSigungu.has(sg)) {
      picked.push(s);
      usedSigungu.add(sg);
    }
  }

  // 2순위: 부족하면 중복 허용
  for (const s of arr) {
    if (picked.length >= n) break;
    if (!picked.includes(s)) picked.push(s);
  }

  return picked.slice(0, n);
}

// ────────────────────────────────────────────────────────────
// 메인
// ────────────────────────────────────────────────────────────
async function main() {
  const lines: string[] = [];

  function out(s: string) {
    console.log(s);
    lines.push(s);
  }

  out(`부동산 데이터 정확도 검증 샘플`);
  out(`생성 시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  out(`검증 방법: 아실(asil.kr) 등에서 단지명 검색 후 날짜·면적·가격 비교`);
  out("");

  out("후보 학교 목록 조회 중...");
  const candidates = await fetchCandidateSchools();
  out(`인근 아파트 ${MIN_APARTMENTS}개 이상 학교: ${candidates.length}개`);
  out("");

  const selected = pickRandom(candidates, SCHOOL_SAMPLE_COUNT);

  let totalTrades = 0;
  let suspectCount = 0;

  for (let i = 0; i < selected.length; i++) {
    const school = selected[i];
    const url = `http://localhost:3000/school/${school.shl_idf_cd}`;

    out("═══════════════════════════════════════════════════════════════════");
    out(`[${i + 1}/${selected.length}] 학교명: ${school.school_name}`);
    out(`주소: ${school.address ?? "주소 미상"}`);
    out(`좌표: (${school.lat?.toFixed(6) ?? "??"}, ${school.lng?.toFixed(6) ?? "??"})`);
    out(`학교 상세 페이지: ${url}`);
    out("───────────────────────────────────────────────────────────────────");

    const apartments = await loadApartmentsForSchool(school.shl_idf_cd);

    // 거리순 상위 10개만 표시 (너무 많으면 읽기 어려움)
    const displayed = apartments.slice(0, 10);

    out(`주변 단지 ${displayed.length}개 표시 중 (전체 매핑 ${apartments.length}개, 거리순):`);
    out("");

    if (displayed.length === 0) {
      out("  ※ 표시할 단지 없음 (아파트 데이터 준비 중)");
    }

    for (const apt of displayed) {
      const distStr = apt.distanceM != null
        ? apt.distanceM < 1000
          ? `${apt.distanceM}m`
          : `${(apt.distanceM / 1000).toFixed(2)}km`
        : "거리 미상";

      out(`▸ 단지명: ${apt.name}`);
      out(`  준공: ${apt.builtYear != null ? `${apt.builtYear}년` : "미상"} | 거리: ${distStr}`);

      // 매매
      if (apt.latestSale) {
        const s = apt.latestSale;
        out(`  매매 최근: ${s.contractDate} / ${fmtArea(s.areaM2)} / ${fmtWon(s.priceWon)}`);
        totalTrades++;
      } else {
        out(`  매매 최근: 데이터 없음`);
      }

      // 전세
      if (apt.latestJeonse) {
        const j = apt.latestJeonse;
        out(`  전세 최근: ${j.contractDate} / ${fmtArea(j.areaM2)} / ${fmtManWon(j.depositManWon)}`);
        totalTrades++;
      } else {
        out(`  전세 최근: 데이터 없음`);
      }

      // 월세 — 보증금 0 은 의심 케이스 마킹
      if (apt.latestWolse) {
        const w = apt.latestWolse;
        const isZeroDeposit = w.depositManWon === 0;
        const suspectMark = isZeroDeposit ? "  ⚠️ 보증금 0 — 이상값 의심" : "";
        out(`  월세 최근: ${w.contractDate} / ${fmtArea(w.areaM2)} / 보 ${fmtManWon(w.depositManWon)} / 월 ${w.monthlyRentManWon.toLocaleString()}만${suspectMark}`);
        totalTrades++;
        if (isZeroDeposit) suspectCount++;
      } else {
        out(`  월세 최근: 데이터 없음`);
      }

      out("");
    }
  }

  out("═══════════════════════════════════════════════════════════════════");
  out(`요약: 총 ${selected.length}개 학교 / 거래 데이터 ${totalTrades}건 확인`);
  out(`      의심 케이스 (보증금 0 월세): ${suspectCount}건`);
  out("");
  out(`결과 파일 저장 위치: ${OUTPUT_FILE}`);

  // 파일 저장
  await writeFile(OUTPUT_FILE, lines.join("\n") + "\n", "utf-8");
  console.log(`\n파일 저장 완료: ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("오류 발생:", err);
  process.exit(1);
});
