/**
 * 전국 시·군·구 LAWD_CD 목록 (행정표준코드 — 법정동코드 5자리, 행정구역 단위).
 *
 * 출처: 행정안전부 법정동코드 (행정표준코드관리시스템 https://www.code.go.kr)
 * 검증: Wikipedia "대한민국의 법정동 코드"
 *
 * 사용:
 *   import { ALL_LAWD_CODES } from "./lawd-codes-all.js";
 *   for (const r of ALL_LAWD_CODES) console.log(r.code, r.sido, r.sigungu);
 */

export interface LawdEntry {
  code: string;   // 5자리 LAWD_CD
  sido: string;   // 광역시도
  sigungu: string; // 시·군·구
}

/**
 * 17개 시·도, 약 250개 시·군·구.
 * 광역시는 자치구, 도는 시/군/자치구 (수원·성남·고양 등은 행정구).
 */
export const ALL_LAWD_CODES: LawdEntry[] = [
  // ─── 서울특별시 (11xxx) ────────────────────────────────────────────────
  { code: "11110", sido: "서울특별시", sigungu: "종로구" },
  { code: "11140", sido: "서울특별시", sigungu: "중구" },
  { code: "11170", sido: "서울특별시", sigungu: "용산구" },
  { code: "11200", sido: "서울특별시", sigungu: "성동구" },
  { code: "11215", sido: "서울특별시", sigungu: "광진구" },
  { code: "11230", sido: "서울특별시", sigungu: "동대문구" },
  { code: "11260", sido: "서울특별시", sigungu: "중랑구" },
  { code: "11290", sido: "서울특별시", sigungu: "성북구" },
  { code: "11305", sido: "서울특별시", sigungu: "강북구" },
  { code: "11320", sido: "서울특별시", sigungu: "도봉구" },
  { code: "11350", sido: "서울특별시", sigungu: "노원구" },
  { code: "11380", sido: "서울특별시", sigungu: "은평구" },
  { code: "11410", sido: "서울특별시", sigungu: "서대문구" },
  { code: "11440", sido: "서울특별시", sigungu: "마포구" },
  { code: "11470", sido: "서울특별시", sigungu: "양천구" },
  { code: "11500", sido: "서울특별시", sigungu: "강서구" },
  { code: "11530", sido: "서울특별시", sigungu: "구로구" },
  { code: "11545", sido: "서울특별시", sigungu: "금천구" },
  { code: "11560", sido: "서울특별시", sigungu: "영등포구" },
  { code: "11590", sido: "서울특별시", sigungu: "동작구" },
  { code: "11620", sido: "서울특별시", sigungu: "관악구" },
  { code: "11650", sido: "서울특별시", sigungu: "서초구" },
  { code: "11680", sido: "서울특별시", sigungu: "강남구" },
  { code: "11710", sido: "서울특별시", sigungu: "송파구" },
  { code: "11740", sido: "서울특별시", sigungu: "강동구" },

  // ─── 부산광역시 (26xxx) ────────────────────────────────────────────────
  { code: "26110", sido: "부산광역시", sigungu: "중구" },
  { code: "26140", sido: "부산광역시", sigungu: "서구" },
  { code: "26170", sido: "부산광역시", sigungu: "동구" },
  { code: "26200", sido: "부산광역시", sigungu: "영도구" },
  { code: "26230", sido: "부산광역시", sigungu: "부산진구" },
  { code: "26260", sido: "부산광역시", sigungu: "동래구" },
  { code: "26290", sido: "부산광역시", sigungu: "남구" },
  { code: "26320", sido: "부산광역시", sigungu: "북구" },
  { code: "26350", sido: "부산광역시", sigungu: "해운대구" },
  { code: "26380", sido: "부산광역시", sigungu: "사하구" },
  { code: "26410", sido: "부산광역시", sigungu: "금정구" },
  { code: "26440", sido: "부산광역시", sigungu: "강서구" },
  { code: "26470", sido: "부산광역시", sigungu: "연제구" },
  { code: "26500", sido: "부산광역시", sigungu: "수영구" },
  { code: "26530", sido: "부산광역시", sigungu: "사상구" },
  { code: "26710", sido: "부산광역시", sigungu: "기장군" },

  // ─── 대구광역시 (27xxx) ────────────────────────────────────────────────
  { code: "27110", sido: "대구광역시", sigungu: "중구" },
  { code: "27140", sido: "대구광역시", sigungu: "동구" },
  { code: "27170", sido: "대구광역시", sigungu: "서구" },
  { code: "27200", sido: "대구광역시", sigungu: "남구" },
  { code: "27230", sido: "대구광역시", sigungu: "북구" },
  { code: "27260", sido: "대구광역시", sigungu: "수성구" },
  { code: "27290", sido: "대구광역시", sigungu: "달서구" },
  { code: "27710", sido: "대구광역시", sigungu: "달성군" },
  { code: "27720", sido: "대구광역시", sigungu: "군위군" },

  // ─── 인천광역시 (28xxx) ────────────────────────────────────────────────
  { code: "28110", sido: "인천광역시", sigungu: "중구" },
  { code: "28140", sido: "인천광역시", sigungu: "동구" },
  { code: "28177", sido: "인천광역시", sigungu: "미추홀구" },
  { code: "28185", sido: "인천광역시", sigungu: "연수구" },
  { code: "28200", sido: "인천광역시", sigungu: "남동구" },
  { code: "28237", sido: "인천광역시", sigungu: "부평구" },
  { code: "28245", sido: "인천광역시", sigungu: "계양구" },
  { code: "28260", sido: "인천광역시", sigungu: "서구" },
  { code: "28710", sido: "인천광역시", sigungu: "강화군" },
  { code: "28720", sido: "인천광역시", sigungu: "옹진군" },

  // ─── 광주광역시 (29xxx) ────────────────────────────────────────────────
  { code: "29110", sido: "광주광역시", sigungu: "동구" },
  { code: "29140", sido: "광주광역시", sigungu: "서구" },
  { code: "29155", sido: "광주광역시", sigungu: "남구" },
  { code: "29170", sido: "광주광역시", sigungu: "북구" },
  { code: "29200", sido: "광주광역시", sigungu: "광산구" },

  // ─── 대전광역시 (30xxx) ────────────────────────────────────────────────
  { code: "30110", sido: "대전광역시", sigungu: "동구" },
  { code: "30140", sido: "대전광역시", sigungu: "중구" },
  { code: "30170", sido: "대전광역시", sigungu: "서구" },
  { code: "30200", sido: "대전광역시", sigungu: "유성구" },
  { code: "30230", sido: "대전광역시", sigungu: "대덕구" },

  // ─── 울산광역시 (31xxx) ────────────────────────────────────────────────
  { code: "31110", sido: "울산광역시", sigungu: "중구" },
  { code: "31140", sido: "울산광역시", sigungu: "남구" },
  { code: "31170", sido: "울산광역시", sigungu: "동구" },
  { code: "31200", sido: "울산광역시", sigungu: "북구" },
  { code: "31710", sido: "울산광역시", sigungu: "울주군" },

  // ─── 세종특별자치시 (36xxx) ────────────────────────────────────────────
  { code: "36110", sido: "세종특별자치시", sigungu: "세종특별자치시" },

  // ─── 경기도 (41xxx) ────────────────────────────────────────────────────
  // 수원시 (행정구 4)
  { code: "41111", sido: "경기도", sigungu: "수원시 장안구" },
  { code: "41113", sido: "경기도", sigungu: "수원시 권선구" },
  { code: "41115", sido: "경기도", sigungu: "수원시 팔달구" },
  { code: "41117", sido: "경기도", sigungu: "수원시 영통구" },
  // 성남시 (행정구 3)
  { code: "41131", sido: "경기도", sigungu: "성남시 수정구" },
  { code: "41133", sido: "경기도", sigungu: "성남시 중원구" },
  { code: "41135", sido: "경기도", sigungu: "성남시 분당구" },
  // 의정부
  { code: "41150", sido: "경기도", sigungu: "의정부시" },
  // 안양시 (행정구 2)
  { code: "41171", sido: "경기도", sigungu: "안양시 만안구" },
  { code: "41173", sido: "경기도", sigungu: "안양시 동안구" },
  // 부천시
  { code: "41190", sido: "경기도", sigungu: "부천시" },
  // 광명
  { code: "41210", sido: "경기도", sigungu: "광명시" },
  // 평택
  { code: "41220", sido: "경기도", sigungu: "평택시" },
  // 동두천
  { code: "41250", sido: "경기도", sigungu: "동두천시" },
  // 안산시 (행정구 2)
  { code: "41271", sido: "경기도", sigungu: "안산시 상록구" },
  { code: "41273", sido: "경기도", sigungu: "안산시 단원구" },
  // 고양시 (행정구 3)
  { code: "41281", sido: "경기도", sigungu: "고양시 덕양구" },
  { code: "41285", sido: "경기도", sigungu: "고양시 일산동구" },
  { code: "41287", sido: "경기도", sigungu: "고양시 일산서구" },
  // 과천
  { code: "41290", sido: "경기도", sigungu: "과천시" },
  // 구리
  { code: "41310", sido: "경기도", sigungu: "구리시" },
  // 남양주
  { code: "41360", sido: "경기도", sigungu: "남양주시" },
  // 오산
  { code: "41370", sido: "경기도", sigungu: "오산시" },
  // 시흥
  { code: "41390", sido: "경기도", sigungu: "시흥시" },
  // 군포
  { code: "41410", sido: "경기도", sigungu: "군포시" },
  // 의왕
  { code: "41430", sido: "경기도", sigungu: "의왕시" },
  // 하남
  { code: "41450", sido: "경기도", sigungu: "하남시" },
  // 용인시 (행정구 3)
  { code: "41461", sido: "경기도", sigungu: "용인시 처인구" },
  { code: "41463", sido: "경기도", sigungu: "용인시 기흥구" },
  { code: "41465", sido: "경기도", sigungu: "용인시 수지구" },
  // 파주
  { code: "41480", sido: "경기도", sigungu: "파주시" },
  // 이천
  { code: "41500", sido: "경기도", sigungu: "이천시" },
  // 안성
  { code: "41550", sido: "경기도", sigungu: "안성시" },
  // 김포
  { code: "41570", sido: "경기도", sigungu: "김포시" },
  // 화성
  { code: "41590", sido: "경기도", sigungu: "화성시" },
  // 광주
  { code: "41610", sido: "경기도", sigungu: "광주시" },
  // 양주
  { code: "41630", sido: "경기도", sigungu: "양주시" },
  // 포천
  { code: "41650", sido: "경기도", sigungu: "포천시" },
  // 여주
  { code: "41670", sido: "경기도", sigungu: "여주시" },
  // 군
  { code: "41800", sido: "경기도", sigungu: "연천군" },
  { code: "41820", sido: "경기도", sigungu: "가평군" },
  { code: "41830", sido: "경기도", sigungu: "양평군" },

  // ─── 강원특별자치도 (51xxx) ────────────────────────────────────────────
  { code: "51110", sido: "강원특별자치도", sigungu: "춘천시" },
  { code: "51130", sido: "강원특별자치도", sigungu: "원주시" },
  { code: "51150", sido: "강원특별자치도", sigungu: "강릉시" },
  { code: "51170", sido: "강원특별자치도", sigungu: "동해시" },
  { code: "51190", sido: "강원특별자치도", sigungu: "태백시" },
  { code: "51210", sido: "강원특별자치도", sigungu: "속초시" },
  { code: "51230", sido: "강원특별자치도", sigungu: "삼척시" },
  { code: "51720", sido: "강원특별자치도", sigungu: "홍천군" },
  { code: "51730", sido: "강원특별자치도", sigungu: "횡성군" },
  { code: "51750", sido: "강원특별자치도", sigungu: "영월군" },
  { code: "51760", sido: "강원특별자치도", sigungu: "평창군" },
  { code: "51770", sido: "강원특별자치도", sigungu: "정선군" },
  { code: "51780", sido: "강원특별자치도", sigungu: "철원군" },
  { code: "51790", sido: "강원특별자치도", sigungu: "화천군" },
  { code: "51800", sido: "강원특별자치도", sigungu: "양구군" },
  { code: "51810", sido: "강원특별자치도", sigungu: "인제군" },
  { code: "51820", sido: "강원특별자치도", sigungu: "고성군" },
  { code: "51830", sido: "강원특별자치도", sigungu: "양양군" },

  // ─── 충청북도 (43xxx) ──────────────────────────────────────────────────
  // 청주시 (행정구 4)
  { code: "43111", sido: "충청북도", sigungu: "청주시 상당구" },
  { code: "43112", sido: "충청북도", sigungu: "청주시 서원구" },
  { code: "43113", sido: "충청북도", sigungu: "청주시 흥덕구" },
  { code: "43114", sido: "충청북도", sigungu: "청주시 청원구" },
  { code: "43130", sido: "충청북도", sigungu: "충주시" },
  { code: "43150", sido: "충청북도", sigungu: "제천시" },
  { code: "43720", sido: "충청북도", sigungu: "보은군" },
  { code: "43730", sido: "충청북도", sigungu: "옥천군" },
  { code: "43740", sido: "충청북도", sigungu: "영동군" },
  { code: "43745", sido: "충청북도", sigungu: "증평군" },
  { code: "43750", sido: "충청북도", sigungu: "진천군" },
  { code: "43760", sido: "충청북도", sigungu: "괴산군" },
  { code: "43770", sido: "충청북도", sigungu: "음성군" },
  { code: "43800", sido: "충청북도", sigungu: "단양군" },

  // ─── 충청남도 (44xxx) ──────────────────────────────────────────────────
  { code: "44131", sido: "충청남도", sigungu: "천안시 동남구" },
  { code: "44133", sido: "충청남도", sigungu: "천안시 서북구" },
  { code: "44150", sido: "충청남도", sigungu: "공주시" },
  { code: "44180", sido: "충청남도", sigungu: "보령시" },
  { code: "44200", sido: "충청남도", sigungu: "아산시" },
  { code: "44210", sido: "충청남도", sigungu: "서산시" },
  { code: "44230", sido: "충청남도", sigungu: "논산시" },
  { code: "44250", sido: "충청남도", sigungu: "계룡시" },
  { code: "44270", sido: "충청남도", sigungu: "당진시" },
  { code: "44710", sido: "충청남도", sigungu: "금산군" },
  { code: "44760", sido: "충청남도", sigungu: "부여군" },
  { code: "44770", sido: "충청남도", sigungu: "서천군" },
  { code: "44790", sido: "충청남도", sigungu: "청양군" },
  { code: "44800", sido: "충청남도", sigungu: "홍성군" },
  { code: "44810", sido: "충청남도", sigungu: "예산군" },
  { code: "44825", sido: "충청남도", sigungu: "태안군" },

  // ─── 전북특별자치도 (52xxx) ────────────────────────────────────────────
  { code: "52111", sido: "전북특별자치도", sigungu: "전주시 완산구" },
  { code: "52113", sido: "전북특별자치도", sigungu: "전주시 덕진구" },
  { code: "52130", sido: "전북특별자치도", sigungu: "군산시" },
  { code: "52140", sido: "전북특별자치도", sigungu: "익산시" },
  { code: "52180", sido: "전북특별자치도", sigungu: "정읍시" },
  { code: "52190", sido: "전북특별자치도", sigungu: "남원시" },
  { code: "52210", sido: "전북특별자치도", sigungu: "김제시" },
  { code: "52710", sido: "전북특별자치도", sigungu: "완주군" },
  { code: "52720", sido: "전북특별자치도", sigungu: "진안군" },
  { code: "52730", sido: "전북특별자치도", sigungu: "무주군" },
  { code: "52740", sido: "전북특별자치도", sigungu: "장수군" },
  { code: "52750", sido: "전북특별자치도", sigungu: "임실군" },
  { code: "52770", sido: "전북특별자치도", sigungu: "순창군" },
  { code: "52790", sido: "전북특별자치도", sigungu: "고창군" },
  { code: "52800", sido: "전북특별자치도", sigungu: "부안군" },

  // ─── 전라남도 (46xxx) ──────────────────────────────────────────────────
  { code: "46110", sido: "전라남도", sigungu: "목포시" },
  { code: "46130", sido: "전라남도", sigungu: "여수시" },
  { code: "46150", sido: "전라남도", sigungu: "순천시" },
  { code: "46170", sido: "전라남도", sigungu: "나주시" },
  { code: "46230", sido: "전라남도", sigungu: "광양시" },
  { code: "46710", sido: "전라남도", sigungu: "담양군" },
  { code: "46720", sido: "전라남도", sigungu: "곡성군" },
  { code: "46730", sido: "전라남도", sigungu: "구례군" },
  { code: "46770", sido: "전라남도", sigungu: "고흥군" },
  { code: "46780", sido: "전라남도", sigungu: "보성군" },
  { code: "46790", sido: "전라남도", sigungu: "화순군" },
  { code: "46800", sido: "전라남도", sigungu: "장흥군" },
  { code: "46810", sido: "전라남도", sigungu: "강진군" },
  { code: "46820", sido: "전라남도", sigungu: "해남군" },
  { code: "46830", sido: "전라남도", sigungu: "영암군" },
  { code: "46840", sido: "전라남도", sigungu: "무안군" },
  { code: "46860", sido: "전라남도", sigungu: "함평군" },
  { code: "46870", sido: "전라남도", sigungu: "영광군" },
  { code: "46880", sido: "전라남도", sigungu: "장성군" },
  { code: "46890", sido: "전라남도", sigungu: "완도군" },
  { code: "46900", sido: "전라남도", sigungu: "진도군" },
  { code: "46910", sido: "전라남도", sigungu: "신안군" },

  // ─── 경상북도 (47xxx) ──────────────────────────────────────────────────
  { code: "47111", sido: "경상북도", sigungu: "포항시 남구" },
  { code: "47113", sido: "경상북도", sigungu: "포항시 북구" },
  { code: "47130", sido: "경상북도", sigungu: "경주시" },
  { code: "47150", sido: "경상북도", sigungu: "김천시" },
  { code: "47170", sido: "경상북도", sigungu: "안동시" },
  { code: "47190", sido: "경상북도", sigungu: "구미시" },
  { code: "47210", sido: "경상북도", sigungu: "영주시" },
  { code: "47230", sido: "경상북도", sigungu: "영천시" },
  { code: "47250", sido: "경상북도", sigungu: "상주시" },
  { code: "47280", sido: "경상북도", sigungu: "문경시" },
  { code: "47290", sido: "경상북도", sigungu: "경산시" },
  { code: "47730", sido: "경상북도", sigungu: "의성군" },
  { code: "47750", sido: "경상북도", sigungu: "청송군" },
  { code: "47760", sido: "경상북도", sigungu: "영양군" },
  { code: "47770", sido: "경상북도", sigungu: "영덕군" },
  { code: "47820", sido: "경상북도", sigungu: "청도군" },
  { code: "47830", sido: "경상북도", sigungu: "고령군" },
  { code: "47840", sido: "경상북도", sigungu: "성주군" },
  { code: "47850", sido: "경상북도", sigungu: "칠곡군" },
  { code: "47900", sido: "경상북도", sigungu: "예천군" },
  { code: "47920", sido: "경상북도", sigungu: "봉화군" },
  { code: "47930", sido: "경상북도", sigungu: "울진군" },
  { code: "47940", sido: "경상북도", sigungu: "울릉군" },

  // ─── 경상남도 (48xxx) ──────────────────────────────────────────────────
  { code: "48121", sido: "경상남도", sigungu: "창원시 의창구" },
  { code: "48123", sido: "경상남도", sigungu: "창원시 성산구" },
  { code: "48125", sido: "경상남도", sigungu: "창원시 마산합포구" },
  { code: "48127", sido: "경상남도", sigungu: "창원시 마산회원구" },
  { code: "48129", sido: "경상남도", sigungu: "창원시 진해구" },
  { code: "48170", sido: "경상남도", sigungu: "진주시" },
  { code: "48220", sido: "경상남도", sigungu: "통영시" },
  { code: "48240", sido: "경상남도", sigungu: "사천시" },
  { code: "48250", sido: "경상남도", sigungu: "김해시" },
  { code: "48270", sido: "경상남도", sigungu: "밀양시" },
  { code: "48310", sido: "경상남도", sigungu: "거제시" },
  { code: "48330", sido: "경상남도", sigungu: "양산시" },
  { code: "48720", sido: "경상남도", sigungu: "의령군" },
  { code: "48730", sido: "경상남도", sigungu: "함안군" },
  { code: "48740", sido: "경상남도", sigungu: "창녕군" },
  { code: "48820", sido: "경상남도", sigungu: "고성군" },
  { code: "48840", sido: "경상남도", sigungu: "남해군" },
  { code: "48850", sido: "경상남도", sigungu: "하동군" },
  { code: "48860", sido: "경상남도", sigungu: "산청군" },
  { code: "48870", sido: "경상남도", sigungu: "함양군" },
  { code: "48880", sido: "경상남도", sigungu: "거창군" },
  { code: "48890", sido: "경상남도", sigungu: "합천군" },

  // ─── 제주특별자치도 (50xxx) ────────────────────────────────────────────
  { code: "50110", sido: "제주특별자치도", sigungu: "제주시" },
  { code: "50130", sido: "제주특별자치도", sigungu: "서귀포시" },
];

/** sido → entries */
export function lawdsBySido(sido: string): LawdEntry[] {
  return ALL_LAWD_CODES.filter((r) => r.sido === sido);
}

/** code(5d) → entry */
export function lawdByCode(code: string): LawdEntry | undefined {
  return ALL_LAWD_CODES.find((r) => r.code === code);
}

/** code(5d) → sido (광역시도 short 이름 — 카카오 주소 검색용) */
export function sidoForKakao(code: string): string {
  const e = lawdByCode(code);
  return e?.sido ?? "";
}

// CLI debug — `tsx scripts/lawd-codes-all.ts` 실행 시 통계 출력
if (process.argv[1]?.endsWith("/lawd-codes-all.ts")) {
  const bySido = new Map<string, number>();
  for (const r of ALL_LAWD_CODES) bySido.set(r.sido, (bySido.get(r.sido) ?? 0) + 1);
  console.log(`총 ${ALL_LAWD_CODES.length}개 시·군·구`);
  for (const [s, n] of bySido) console.log(`  ${s}: ${n}`);
}
