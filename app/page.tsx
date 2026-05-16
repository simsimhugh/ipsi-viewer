import { loadSchoolsWithCareer } from "@/lib/data";
import SchoolTable from "@/components/SchoolTable";

export default async function HomePage() {
  const schools = await loadSchoolsWithCareer();
  // 전국 중학교 (진로 매칭된 학교만)
  const middleSchools = schools.filter((s) => s.kind === "중학교");

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <h1 className="text-2xl font-bold mb-1">전국 중학교 진학 결과</h1>
      <p className="text-sm text-slate-600 mb-6">
        {middleSchools.length.toLocaleString()}개 중학교의 2023~2025년 졸업생 진로 통계. 학교명을 클릭하면 상세 페이지가 새 창으로 열립니다.
      </p>
      <SchoolTable schools={middleSchools} />
    </div>
  );
}
