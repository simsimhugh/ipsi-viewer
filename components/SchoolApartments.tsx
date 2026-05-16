/**
 * 학교 상세 페이지의 "학구 내 아파트 단지" 섹션.
 *
 * 데이터 없을 때 (자원 미발급, 적재 전): 안내 placeholder.
 * 데이터 있을 때: 단지명·세대수·준공년·거리·최근 실거래가 중위값 표.
 */
import type { ApartmentSummary } from "@/lib/realestate";

function fmtPrice(won: number | null): string {
  if (won == null) return "-";
  // 1억=1e8. 억/천만 단위 표기.
  const eok = Math.floor(won / 1e8);
  const remCheonman = Math.round((won - eok * 1e8) / 1e7);
  if (eok === 0) return `${remCheonman.toLocaleString()}천만원`;
  if (remCheonman === 0) return `${eok}억원`;
  return `${eok}억 ${remCheonman}천만원`;
}

function fmtDistance(m: number | null): string {
  if (m == null) return "-";
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(2)}km`;
}

export default function SchoolApartments({ apartments }: { apartments: ApartmentSummary[] }) {
  return (
    <section className="mt-6 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-medium text-slate-700 mb-3">학구 내 아파트 단지</h2>
      {apartments.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          학구 매핑 데이터 준비 중입니다. 학구도 SHP·카카오 지오코딩·국토부 실거래가 데이터가
          순차 도착하는 대로 이 영역에 단지명·세대수·최근 실거래가가 표시됩니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm tabular-nums">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left  px-3 py-2 font-medium">단지명</th>
                <th className="text-right px-3 py-2 font-medium">세대수</th>
                <th className="text-right px-3 py-2 font-medium">준공</th>
                <th className="text-right px-3 py-2 font-medium">거리</th>
                <th className="text-left  px-3 py-2 font-medium">학구</th>
                <th className="text-right px-3 py-2 font-medium">최근 실거래가 (중위)</th>
                <th className="text-right px-3 py-2 font-medium">최근 거래일</th>
              </tr>
            </thead>
            <tbody>
              {apartments.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-800">{a.name}</td>
                  <td className="px-3 py-1.5 text-right">{a.households ?? "-"}</td>
                  <td className="px-3 py-1.5 text-right">{a.builtYear ?? "-"}</td>
                  <td className="px-3 py-1.5 text-right">{fmtDistance(a.distanceM)}</td>
                  <td className="px-3 py-1.5">
                    {a.inDistrict ? (
                      <span className="text-[11px] rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5">내</span>
                    ) : (
                      <span className="text-[11px] rounded-full bg-slate-50 border border-slate-200 text-slate-500 px-2 py-0.5">인접</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">{fmtPrice(a.medianPriceWon)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{a.latestContractDate ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11px] text-slate-400">
            * 거리 기준은 학구도 폴리곤 적재 전 임시 (학교 좌표 기준 반경 1km).
            실거래가는 국토부 공개 데이터 최근 1년 중위값.
          </div>
        </div>
      )}
    </section>
  );
}
