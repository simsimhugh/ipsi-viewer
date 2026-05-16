import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import ProtectionLayer from "@/components/ProtectionLayer";

export const metadata: Metadata = {
  title: "학군 뷰어 — 전국 중학교 진학 결과",
  description: "전국 중학교 졸업생 진로(특목·자사·과학·외고·국제) 한눈 비교",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <ProtectionLayer />
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
            <a href="/" className="text-lg font-bold text-slate-900">
              학군 뷰어 <span className="text-sm font-normal text-slate-500">— 전국 중학교 진학 결과</span>
            </a>
            <div className="text-xs text-slate-400">
              출처: 학교알리미 (공공누리 제3유형)
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="mt-16 border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-6 text-xs text-slate-500">
            본 서비스는 학교알리미(<a className="underline" href="https://www.schoolinfo.go.kr" target="_blank" rel="noreferrer">schoolinfo.go.kr</a>)
            의 공시정보를 공공누리 제3유형(출처표시 + 변경금지, 상업적 이용 가능)에 따라 재구성합니다.
            수치는 원본 그대로 표시되며 가공·수정하지 않습니다.
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
