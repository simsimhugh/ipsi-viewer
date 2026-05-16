import { notFound } from "next/navigation";
import Link from "next/link";
import { loadSchool } from "@/lib/data";
import { eliteCount, elitePct } from "@/lib/types";
import type { CareerRow } from "@/lib/types";
import CareerChart from "@/components/CareerChart";

const ROW_DEFS: { key: keyof CareerRow; label: string; emphasis?: boolean }[] = [
  { key: "graduates",              label: "졸업자",       emphasis: true },
  { key: "generalHigh",            label: "일반고" },
  { key: "vocationalHigh",         label: "특성화고" },
  { key: "scienceHigh",            label: "과학고" },
  { key: "foreignIntlHigh",        label: "외고/국제고" },
  { key: "artsSportsHigh",         label: "예체고" },
  { key: "meisterHigh",            label: "마이스터고" },
  { key: "specialPurposeSubtotal", label: "특목 소계",    emphasis: true },
  { key: "privateAutonomous",      label: "자율형사립고" },
  { key: "publicAutonomous",       label: "자율형공립고" },
  { key: "autonomousSubtotal",     label: "자율 소계",    emphasis: true },
  { key: "other",                  label: "기타" },
  { key: "advancedTotal",          label: "진학자계",     emphasis: true },
  { key: "employed",               label: "취업자" },
  { key: "altEducation",           label: "대안교육" },
  { key: "unemployed",             label: "무직/미상" },
];

export default async function SchoolPage({ params }: { params: { shl: string } }) {
  const SHL = decodeURIComponent(params.shl);
  const school = await loadSchool(SHL);
  if (!school) notFound();

  const career = school.career;
  const t = career?.total;
  const elite = t ? eliteCount(t) : 0;
  const ePct = t ? elitePct(t).toFixed(1) : "-";

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="text-xs text-slate-500 mb-2">
        <Link href="/" className="hover:underline">← 목록으로</Link>
      </div>

      <header className="mb-6">
        <h1 className="text-3xl font-bold">{school.schoolName}</h1>
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
      </header>

      {!career && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          이 학교의 졸업생 진로 데이터를 수집하지 못했습니다 (졸업자 없음 또는 공시 미발견).
        </div>
      )}

      {career && t && (
        <>
          {/* 핵심 KPI */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Kpi label="졸업자" value={t.graduates} suffix="명" />
            <Kpi label="특목 + 자사" value={elite} suffix="명" highlight />
            <Kpi label="엘리트 비율" value={ePct} suffix="%" highlight />
            <Kpi label="공시 기준연도" value={career.year} />
          </section>

          {/* 카테고리 차트 */}
          <section className="mb-6 rounded border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium text-slate-700 mb-2">진로 카테고리 분포 (합계 기준)</h2>
            <CareerChart row={t} />
          </section>

          {/* 남/여/합계 표 */}
          <section className="rounded border border-slate-200 bg-white overflow-x-auto">
            <table className="min-w-full text-sm tabular-nums">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">카테고리</th>
                  <th className="text-right px-3 py-2 font-medium">남</th>
                  <th className="text-right px-3 py-2 font-medium">여</th>
                  <th className="text-right px-3 py-2 font-medium border-l border-slate-200">합계</th>
                  <th className="text-right px-3 py-2 font-medium">비율 %</th>
                </tr>
              </thead>
              <tbody>
                {ROW_DEFS.map(({ key, label, emphasis }) => (
                  <tr key={key} className={`border-t border-slate-100 ${emphasis ? "bg-slate-50/60 font-medium" : ""}`}>
                    <td className="px-3 py-1.5 text-slate-700">{label}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{career.male[key]}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{career.female[key]}</td>
                    <td className="px-3 py-1.5 text-right border-l border-slate-200">{career.total[key]}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{career.ratePct[key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, suffix, highlight }: { label: string; value: string | number; suffix?: string; highlight?: boolean }) {
  return (
    <div className={`rounded border p-4 ${highlight ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${highlight ? "text-brand-700" : "text-slate-900"}`}>
        {value}
        {suffix && <span className="text-sm font-normal text-slate-500 ml-1">{suffix}</span>}
      </div>
    </div>
  );
}
