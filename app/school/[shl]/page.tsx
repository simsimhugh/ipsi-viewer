import { notFound } from "next/navigation";
import Link from "next/link";
import { loadSchoolById } from "@/lib/data";
import { loadApartmentsForSchool } from "@/lib/realestate";
import SchoolDetailView from "@/components/SchoolDetailView";
import SchoolApartments from "@/components/SchoolApartments";

// ISR — cold TTFB 단축. 첫 요청만 SSR, 이후 5분간 캐시된 HTML 재사용.
// 데이터 변경은 매월 sync라 5분 stale 허용.
export const revalidate = 300;

export default async function SchoolPage({ params }: { params: { shl: string } }) {
  const SHL = decodeURIComponent(params.shl);
  const [school, apartments] = await Promise.all([
    loadSchoolById(SHL),
    loadApartmentsForSchool(SHL),
  ]);
  if (!school) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* 뒤로가기 */}
      <div className="mb-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-brand-600 group"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="group-hover:-translate-x-0.5 transition-transform">
            <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          목록으로
        </Link>
      </div>

      <header className="mb-8 pb-7 border-b border-slate-200">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h1 className="text-[1.75rem] font-semibold tracking-tight text-slate-900 leading-tight">{school.schoolName}</h1>
          <a
            href={`https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${encodeURIComponent(school.SHL_IDF_CD)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-600 border border-slate-200 hover:border-brand-300 rounded-full px-3 py-1.5 bg-white hover:bg-brand-50 shrink-0"
            title="이 학교의 학교알리미 공시 페이지 (출처)"
          >
            학교알리미 원본
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 8L8 2M8 2H4M8 2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
          <span className="font-medium text-slate-700">{school.sidoName}{school.sigungu ? ` ${school.sigungu}` : ""}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">{school.kind}</span>
          <span className="text-slate-300">·</span>
          <span className="text-xs text-slate-400">학교코드 {school.sdSchulCode}</span>
        </div>
        {school.address && (
          <div className="mt-1.5 text-xs text-slate-400">{school.address}</div>
        )}
        <div className="mt-3 text-[11px] text-slate-400 bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 inline-block">
          데이터 출처: 학교알리미 (공공누리 제3유형) · 원본 공시 수치 그대로 표시
        </div>
      </header>

      <SchoolDetailView school={school} />
      <SchoolApartments apartments={apartments} />
    </div>
  );
}
