export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      {/* 페이지 제목 skeleton */}
      <div className="h-8 w-56 bg-slate-200 rounded animate-pulse mb-2" />
      <div className="h-4 w-96 bg-slate-100 rounded animate-pulse mb-6" />

      {/* 테이블 헤더 skeleton */}
      <div className="h-10 bg-slate-200 rounded animate-pulse mb-1" />

      {/* 테이블 행 skeleton */}
      <div className="space-y-1">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}
