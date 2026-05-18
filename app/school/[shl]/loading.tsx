export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      {/* 뒤로가기 링크 skeleton */}
      <div className="h-4 w-20 bg-slate-100 rounded animate-pulse mb-2" />

      {/* 학교명 + 버튼 skeleton */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="h-9 w-64 bg-slate-200 rounded animate-pulse" />
          <div className="h-7 w-28 bg-slate-100 rounded-full animate-pulse" />
        </div>
        <div className="mt-2 flex gap-3">
          <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
          <div className="h-4 w-12 bg-slate-100 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="mt-1 h-4 w-48 bg-slate-100 rounded animate-pulse" />
      </div>

      {/* KPI 카드 4개 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded border border-slate-200 bg-white p-4">
            <div className="h-3 w-16 bg-slate-100 rounded animate-pulse mb-2" />
            <div className="h-8 w-20 bg-slate-200 rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* 차트 skeleton */}
      <div className="rounded border border-slate-200 bg-white p-4 mb-6">
        <div className="h-4 w-32 bg-slate-200 rounded animate-pulse mb-4" />
        <div className="h-48 bg-slate-100 rounded animate-pulse" />
      </div>

      {/* 부동산 표 skeleton */}
      <div className="rounded border border-slate-200 bg-white p-4">
        <div className="h-4 w-40 bg-slate-200 rounded animate-pulse mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
