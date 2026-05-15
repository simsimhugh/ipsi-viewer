# 03. 데이터 소스

각 데이터 소스의 출처·갱신주기·접근방식·법적 고려사항을 정리한다.

## 1. 학교알리미 (schoolinfo.go.kr) — 진학 결과

### 개요
- 운영: 한국교육학술정보원(KERIS)
- 공시 주기: 연 4회(4·5·9·11월). 졸업생 진로 현황은 주로 11월 공시
- 우리가 필요한 항목: "졸업생의 진로 현황" (중학교)

### 데이터 항목

| 카테고리 | 세부 |
|---|---|
| 일반고 | 인원·비율 |
| 특목고 | 과학고, 외국어고, 국제고, 예술고, 체육고, 마이스터고 (각각 인원·비율) |
| 자율고 | 자율형 사립고, 자율형 공립고 |
| 특성화고 | 인원·비율 |
| 기타 | 외국인학교, 특수학교, 각종학교, 영재학교, 대안교육기관, 무직/미상 |

### 접근 방식
- **공식 OpenAPI에는 진학 데이터 항목 없음** (학생 수·교원 수·시설 등만)
- 공공데이터포털 학교알리미 데이터셋(15098092, 15014351, 15090212)에도 진학 데이터 미포함
- → **Playwright headless 브라우저 스크래핑이 유일한 경로**
- 학교별 URL: `https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD={UUID}`
- SHL_IDF_CD는 학교코드와 별개의 UUID 형태로 학교알리미 내부 식별자

### 법적·윤리적
- robots.txt: `User-agent: * Allow: /` — Disallow 없음, 스크래핑 기술적으로 허용
- 이용약관: 무차별 트래픽 금지 → 동시성 1, 학교당 일 1회 한도 준수
- 출처 표기 의무

## 2. 학구도안내서비스 (schoolzone.emac.kr) — 학구 폴리곤

### 개요
- 운영: 한국교육시설안전원
- 갱신: DB는 매주 화요일, SHP은 연 2회(3·9월)
- 제공 데이터: 초등 통학구역, 중학교 학구·학군(SHP), 고등학교 학교군, 학교-학구도 연계정보(CSV/JSON/XML)

### 우리가 사용하는 것
- 중학교 학교군 SHP (전국, 수도권 필터)
- 학교-학구도 연계정보 CSV (학구코드 ↔ 학교코드 매핑)

### 접근 방식
- 공공데이터포털 또는 schoolzone.emac.kr 에서 SHP 압축 파일 직접 다운로드
- 공식 REST API는 없으나 SHP은 공공데이터로 합법적으로 개방
- 좌표계 확인 필요 (EPSG:5179 / EPSG:4326 등) → GeoJSON 변환 시 WGS84로 통일

### 한계
- SHP은 연 2회 갱신 → 그 사이 학구 변경 분 미반영. UI에 "본 매핑은 schoolzone.emac.kr 기준 YYYY-MM 자료입니다" 명시

## 3. NEIS OpenAPI (open.neis.go.kr) — 학교 마스터

### 개요
- 운영: 한국교육학술정보원
- 인증키 발급: 회원가입 후 즉시 발급 (무료)
- 우리가 사용하는 엔드포인트: `schoolInfo` — 학교 기본정보

### 사용 파라미터

```
GET https://open.neis.go.kr/hub/schoolInfo
  ?KEY={NEIS_API_KEY}
  &Type=json
  &pIndex={1..N}
  &pSize=1000
  &ATPT_OFCDC_SC_CODE={B10|J10|E10}   # 서울/경기/인천
  &SCHUL_KND_SC_CODE=03                # 중학교
```

### 응답 필드

- `SD_SCHUL_CODE` — 표준 학교코드
- `SCHUL_NM` — 학교명
- `LCTN_SC_NM` — 시·도명
- `JU_ORG_NM` — 관할 교육지원청
- `ORG_RDNMA` — 도로명주소
- `FOND_SC_NM` — 설립구분 (공립/사립/국립)
- `SCHUL_KND_SC_NM` — 학교종류명 (중학교 등 — **익명 호출에서는 필터가 느슨해 후처리 필요**)

### 한계
- 익명 호출은 페이지당 5건 한도 → 키 필수
- 진학 데이터는 NEIS에 없음

## 4. 국토교통부 실거래가 OpenAPI

### 개요
- 데이터셋: 공공데이터포털 `15126469` (아파트매매 실거래자료)
- 인증키: 공공데이터포털 일반 인증키 (Decoding)

### 사용 방식
- 법정동코드(`LAWD_CD`, 5자리) × 계약년월(`DEAL_YMD`)로 순회
- 응답 필드: `aptNm`(단지명), `roadNm`, `roadNmBonbun`, `roadNmBubun`, `umdNm`(법정동), `dealAmount` 등
- 도로명주소는 필드 조합으로 구성

### 활용 범위
- 수도권 모든 법정동코드 순회 → 단지 마스터 구축 (단지명 + 도로명주소 dedupe)
- 일 1회 cron으로 최신 거래가 갱신

## 5. Kakao Local API — 지오코딩

### 개요
- 카카오 디벨로퍼스 REST API
- 무료 일 30만 호출

### 사용 방식
- `GET https://dapi.kakao.com/v2/local/search/address.json?query={주소}`
- 헤더: `Authorization: KakaoAK {REST_API_KEY}`
- 응답: `documents[0].x` (경도), `documents[0].y` (위도)

### 활용 범위
- 국토부 API로 받은 신규 아파트 단지의 도로명주소 → 좌표 변환
- 변환 후 캐싱 (단지당 1회면 충분)

## 6. 출처 표기 (UI에 명시 필요)

- 학교 기본정보: NEIS 교육정보 개방 포털
- 진학 결과: 학교알리미 (www.schoolinfo.go.kr)
- 학구도: 학구도안내서비스 (schoolzone.emac.kr) / 한국교육시설안전원
- 실거래가: 국토교통부 실거래가 공개시스템
- 지도 좌표: Kakao Map / 도로명주소
- 라이선스: 공공누리 제3유형(출처표시 + 상업적 이용가능 + 변경금지) 가정 — 각 데이터셋별 실제 라이선스 확인 필요
