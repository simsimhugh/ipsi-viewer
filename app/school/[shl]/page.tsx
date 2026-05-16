import { notFound } from "next/navigation";
import Link from "next/link";
import { loadSchool } from "@/lib/data";
import SchoolDetailView from "@/components/SchoolDetailView";

// SSG 미사용 — 데이터 파일이 build 시점에 없을 수 있음 (CI 환경)
export const dynamic = "force-dynamic";

export default async function SchoolPage({ params }: { params: { shl: string } }) {
  const SHL = decodeURIComponent(params.shl);
  const school = await loadSchool(SHL);
  if (!school) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="text-xs text-slate-500 mb-2">
        <Link href="/" className="hover:underline">← 목록으로</Link>
      </div>

      <header className="mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h1 className="text-3xl font-bold">{school.schoolName}</h1>
          <a
            href={`https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${encodeURIComponent(school.SHL_IDF_CD)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 hover:text-brand-700 hover:underline inline-flex items-center gap-1 border border-slate-300 rounded-full px-3 py-1 bg-white"
            title="이 학교의 학교알리미 공시 페이지 (출처)"
          >
            <span>학교알리미 원본 ↗</span>
          </a>
        </div>
        <div className="mt-2 text-sm text-slate-600 flex flex-wrap gap-3">
          <span>{school.sidoName}{school.sigungu ? ` ${school.sigungu}` : ""}</span>
          <span className="text-slate-400">·</span>
          <span>{school.kind}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">학교코드 {school.sdSchulCode}</span>
        </div>
        {school.address && (
          <div className="mt-1 text-sm text-slate-500">{school.address}</div>
        )}
        <div className="mt-2 text-[11px] text-slate-400">
          데이터 출처: 학교알리미 (공공누리 제3유형). 위 수치는 원본 공시 그대로이며 가공·수정하지 않습니다.
        </div>
      </header>

      <SchoolDetailView school={school} />
    </div>
  );
}
