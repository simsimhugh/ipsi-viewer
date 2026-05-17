import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import ProtectionLayer from "@/components/ProtectionLayer";
import VisitTracker from "@/components/VisitTracker";

export const metadata: Metadata = {
  title: "입결 뷰어 — 전국 학교 입시 결과",
  description: "전국 중학교 졸업생 입시 결과(특목·자사·과학·외고·국제) 한눈 비교",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ProtectionLayer />
        <header className="border-b border-slate-200 bg-white shadow-sm">
          <div className="mx-auto max-w-7xl px-6 py-0 flex items-stretch justify-between">
            <a
              href="/"
              className="flex items-center gap-2.5 py-4 group"
            >
              {/* 로고 accent bar */}
              <span className="inline-block w-1 h-6 rounded-full bg-brand-500 group-hover:bg-brand-600" />
              <span className="text-[15px] font-700 tracking-tight text-slate-900 group-hover:text-brand-700">
                입결 뷰어
              </span>
              <span className="text-sm font-normal text-slate-400 hidden sm:inline">
                전국 학교 입시 결과
              </span>
            </a>
            <div className="flex items-center text-xs text-slate-400">
              출처: 학교알리미 (공공누리 제3유형)
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="mt-16 border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-6 text-xs text-slate-400 space-y-2">
            <VisitTracker />
            <div className="leading-relaxed">
              본 서비스는 학교알리미(
              <a
                className="text-slate-500 underline hover:text-brand-600"
                href="https://www.schoolinfo.go.kr"
                target="_blank"
                rel="noreferrer"
              >
                schoolinfo.go.kr
              </a>
              )의 공시정보를 공공누리 제3유형(출처표시 + 변경금지, 상업적 이용 가능)에 따라 재구성합니다.
              수치는 원본 그대로 표시되며 가공·수정하지 않습니다.
            </div>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
