import { loadSchoolsWithCareer } from "@/lib/data";
import SchoolTable from "@/components/SchoolTable";

export default async function HomePage() {
  const schools = await loadSchoolsWithCareer();
  // 기본 view: 수도권(서울/경기/인천) 중학교만
  const sudogwon = schools.filter(
    (s) => s.kind === "중학교" && ["서울", "경기", "인천"].includes(s.sidoName),
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <h1 className="text-2xl font-bold mb-1">수도권 중학교 진학 결과</h1>
      <p className="text-sm text-slate-600 mb-6">
        {sudogwon.length.toLocaleString()}개 중학교의 2025년 졸업생 진로 통계. 학교명을 클릭하면 상세를 볼 수 있습니다.
      </p>
      <SchoolTable schools={sudogwon} />
    </div>
  );
}
