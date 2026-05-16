# 02. 아키텍처

## 1. 시스템 컨텍스트

```mermaid
flowchart LR
  User([학부모·사용자])
  Web[ipsi-viewer Web]
  Firestore[(Firestore)]
  Functions[Firebase Functions]

  NEIS[(NEIS OpenAPI<br/>학교 마스터)]
  SchoolInfo[(학교알리미<br/>진학 공시)]
  SchoolZone[(학구도안내서비스<br/>SHP)]
  MOLIT[(국토부 실거래가<br/>OpenAPI)]
  Kakao[(Kakao Local API<br/>지오코딩)]

  User -- HTTPS --> Web
  Web -- 읽기 --> Firestore
  Web -- 새로고침 트리거 --> Functions
  Functions -- 쓰기 --> Firestore

  Functions -.수집.- NEIS
  Functions -.스크래핑.- SchoolInfo
  Functions -.SHP fetch.- SchoolZone
  Functions -.단지 fetch.- MOLIT
  Functions -.주소→좌표.- Kakao
```

## 2. 데이터 파이프라인

```mermaid
flowchart TB
  subgraph Daily[일 1회 Cron]
    A1[학교알리미 변경감지<br/>학교당 페이지 해시 비교]
    A2[변경된 학교만 진학현황 재파싱]
    A3[국토부 실거래가 일일 동기화]
    A4[신규 단지에 대해 Kakao 지오코딩]
    A5[Point-in-Polygon으로 배정 중학교 재계산]
  end

  subgraph Monthly[월 1회 Cron]
    B1[학구도 SHP 다운로드 체크]
    B2[변경 시 GeoJSON 재변환]
    B3[전체 단지 배정 재계산]
  end

  subgraph Yearly[수동 또는 연 1회]
    C1[NEIS로 학교 마스터 갱신]
  end

  A1 --> A2 --> Firestore[(Firestore)]
  A3 --> A4 --> A5 --> Firestore
  B1 --> B2 --> B3 --> Firestore
  C1 --> Firestore
```

## 3. Firestore 데이터 모델

```mermaid
erDiagram
  schools ||--o{ career : has
  schools ||--|| district : has
  district ||--o{ apartmentInDistrict : contains
  apartments ||--|| apartmentInDistrict : maps

  schools {
    string sdSchulCode PK
    string schoolName
    string sido
    string sigungu
    string address
    string foundType
    timestamp lastScrapedAt
    string contentHash
  }

  career {
    string year PK
    int graduateTotal
    int generalHigh
    int autonomousPrivate
    int autonomousPublic
    int foreignLang
    int international
    int science
    int arts
    int sports
    int meister
    int gifted
    int specialized
    int other
    timestamp publishedAt
  }

  district {
    string sdSchulCode PK
    geojson polygon
    string sourceVersion
  }

  apartments {
    string aptId PK
    string aptName
    string roadAddress
    double lat
    double lng
    string lawdCd
    timestamp lastSyncedAt
  }

  apartmentInDistrict {
    string aptId PK
    string sdSchulCode FK
    timestamp computedAt
  }
```

## 4. 사용자 인터랙션

```mermaid
sequenceDiagram
  participant U as 사용자
  participant W as Web (Next.js)
  participant FS as Firestore
  participant CF as Cloud Functions
  participant SI as 학교알리미

  U->>W: 메인 페이지 진입
  W->>FS: schools + career(latest) 조회
  FS-->>W: 학교 1500여 건
  W-->>U: 랭킹 테이블 렌더

  U->>W: 학교 클릭
  W->>FS: 해당 학교 상세 + 학구 폴리곤 내 단지
  FS-->>W: 데이터
  W-->>U: 대시보드 렌더

  U->>W: [새로고침] 클릭
  W->>CF: refreshSchool(sdSchulCode)
  CF->>CF: 쿨다운 체크 (6h)
  CF->>SI: Playwright 스크래핑
  SI-->>CF: HTML
  CF->>FS: career 업데이트
  CF-->>W: 성공
  W->>FS: 재조회
  FS-->>W: 신규 데이터
  W-->>U: UI 갱신
```

## 5. 컴포넌트 책임

| 컴포넌트 | 책임 |
|---|---|
| `scripts/` (PoC) | 수집·변환 로직의 단독 실행 가능한 프로토타입 |
| `functions/` | 위 PoC를 Cloud Functions로 옮긴 운영 코드, Cloud Scheduler로 정기 실행 |
| `web/` | Next.js 클라이언트 — Firestore SDK 직접 사용, Cloud Functions는 새로고침·관리용 |
| `data/` | 로컬 PoC 산출물 보관(gitignore) |
| `docs/` | 요구사항·아키텍처·운영 문서 |

## 6. 기술 선택 근거

- **TypeScript 일관**: scripts·functions·web 모두 동일 스택 → 도메인 타입 공유
- **Firestore over Cloud SQL**: 학교 1500개·단지 수만 개 수준에서 Firestore 무료 한도 내 충분, 스키마 진화 자유
- **Playwright over Cheerio/HTTP**: 학교알리미가 JS 렌더링 SPA — 단순 HTTP 요청 불가
- **Firebase Hosting + Functions over Cloud Run**: 통합 배포·인증·관제. 트래픽 작아 Cloud Run의 분리 가치가 적음
- **Cloud Scheduler over GitHub Actions**: Firebase 콘솔에서 단일 관리, 인증 일원화

## 7. 외부 인터페이스 요약

| 외부 시스템 | 인증 | 호출 빈도 | 폴백 |
|---|---|---|---|
| NEIS schoolInfo | API Key (선택) | 연 1회 (학교 마스터) | 익명 호출 시 페이지당 5건 |
| 학교알리미 | 없음 (스크래핑) | 일 1회 변경감지 | 페이지 변경 시 셀렉터 보수 필요 |
| 학구도(schoolzone.emac.kr) | 없음 (파일 DL) | 월 1회 체크 | 수동 다운로드 fallback |
| 국토부 실거래가 | 공공데이터포털 키 | 일 1회 | 익일 재시도 |
| Kakao Local | REST Key | 단지 신규 시만 | 일 30만 호출 한도 내 |
