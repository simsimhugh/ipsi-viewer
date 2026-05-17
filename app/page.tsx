import { loadSchoolsForMain } from "@/lib/data";
import SchoolTable from "@/components/SchoolTable";

// ISR — 5분마다 재생성. 메인 테이블은 total만 사용하므로 male/female/ratePct 제외.
// 첫 진입 TTFB·HTML size 모두 축소 (force-dynamic 제거).
export const revalidate = 300;

export default async function HomePage() {
  const schools = await loadSchoolsForMain();
  // 전국 중학교 (진로 매칭된 학교만)
  const middleSchools = schools.filter((s) => s.kind === "중학교");

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1.5">전국 학교 입시 결과</h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          {middleSchools.length.toLocaleString()}개 중학교 · 2023~2025년 졸업생 진학 데이터.
          학교명 클릭 시 상세 페이지가 새 창으로 열립니다.
        </p>
      </div>
      <SchoolTable schools={middleSchools} />
    </div>
  );
}
