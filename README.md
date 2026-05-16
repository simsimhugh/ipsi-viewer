# hakgun-viewer

수도권(서울/경기/인천) 중학교의 **고등학교 진학 결과**(특목·자사·영재·외고·과학·국제)와 **학구 내 아파트 단지**를 한눈에 비교·정렬·필터링할 수 있는 웹 서비스.

학부모가 자녀 진학 시점에서 "어떤 중학교가 어떤 고교로 얼마나 보내는가", "그 중학교 학군에 들어가려면 어떤 아파트를 보면 되는가"를 한 화면에서 확인하는 것을 목표로 한다.

## 기술 스택

- 백엔드: Firebase Functions (Node.js / TypeScript) + Firestore + Cloud Scheduler
- 프론트엔드: Firebase Studio 기반 Next.js + Firestore SDK + Firebase Hosting
- 데이터 수집: 학교알리미 순수 HTTP 호출(0.24s/학교), 학구도 SHP, 국토부 실거래가 OpenAPI, Kakao Local API
  - NEIS OpenAPI는 옵션(주소·교육청 보강용) — 학교알리미 sitemap이 마스터 대체 가능

## 디렉토리 구조

```
hakgun-viewer/
├── docs/                 설계·요구사항 문서
│   ├── 01-requirements.md
│   ├── 02-architecture.md
│   ├── 03-data-sources.md
│   ├── 04-api-keys.md
│   ├── 05-implementation-plan.md
│   └── 06-handoff.md             # 일시정지·재개 가이드
├── scripts/              데이터 수집·변환 스크립트 (TypeScript)
│   ├── build-school-master.ts    # sitemap → 전국 학교 마스터 JSONL
│   ├── filter-master.ts          # 마스터에서 중학교/수도권 등 필터
│   ├── fetch-career.ts           # 학교 1교 진로 fetch (순수 HTTP)
│   ├── batch-fetch.ts            # 학교 리스트 → 진로 JSONL (queue+jitter+backoff)
│   ├── parse-career.ts           # 진로 HTML → 구조화된 JSON
│   ├── join-careers.ts           # 마스터 + 진로 → 학교 단위 단일 JSONL
│   ├── scrape-schoolinfo.ts      # (구) Playwright 스크래퍼 — reference
│   ├── fetch-schools.ts          # (옵션) NEIS 보강용
│   └── convert-districts.ts      # 학구도 SHP → GeoJSON 변환
├── data/                 수집·변환 결과물 (gitignore, samples/만 공유)
├── package.json
└── tsconfig.json
```

## 데이터 수집 파이프라인 (진로 트랙)

```
build-school-master           filter-master                 batch-fetch                  join-careers
sitemap 10개  ────▶  school-master.jsonl  ───▶  middle-sudogwon.txt  ───▶  careers.jsonl  ───▶  schools-with-career.jsonl
                     (전국 ~8000교)         (수도권 중학교 ~700교)      (진로 JSON)         (Firestore 적재 후보)
```

학교당 0.24초 (순수 fetch), 워커 2~3 + 300~800ms jitter + 지수 backoff로 학교알리미 부하 최소.
법적 검토(공공누리 제3유형, robots Allow, 자동수집 금지 없음) 는 `docs/03-data-sources.md` §1 참고.

## 문서 진입점

- [요구사항](docs/01-requirements.md)
- [아키텍처](docs/02-architecture.md)
- [데이터 소스](docs/03-data-sources.md)
- [API 키 발급](docs/04-api-keys.md)
- [구현 계획](docs/05-implementation-plan.md)
- [핸드오프 (일시정지·재개)](docs/06-handoff.md)

## 라이선스

미정.
