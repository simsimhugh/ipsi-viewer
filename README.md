# ipsi-viewer

전국 중학교의 **고등학교 진학 결과**(특목·자사·외고·국제·예체·자사·자공·일반·특성화·마이스터)와 **학구 내 아파트 단지**를 한눈에 비교·정렬·필터링할 수 있는 웹 서비스.

학부모가 자녀 진학 시점에 "어떤 중학교가 어떤 고교로 얼마나 보내는가", "그 학군 안에 들어가려면 어떤 아파트를 보면 되는가"를 한 화면에서 확인하는 것이 목표.

## 기술 스택

- 프론트엔드: **Next.js 14** (App Router) + Tailwind + Recharts
- 백엔드/배포: **Vercel** (Hosting + Cron) + **Supabase** (PostgreSQL + RLS public read)
- 데이터: **순수 HTTP**로 학교알리미 진로 수집(0.24s/학교), 학구도 SHP, 국토부 실거래가, Kakao Local API
- 검증: Vitest + git pre-push hook + GitHub Actions CI + Branch protection

## 디렉토리 구조

```
ipsi-viewer/
├── app/                      Next.js app router (page · school detail)
├── components/               SchoolTable · SchoolDetailView · CareerChart
├── lib/                      types, columnLabels (단일 소스), data (Supabase/JSONL 분기)
├── scripts/                  데이터 수집·변환 (build-master, filter, fetch, batch, parse, join, analyze, check, import)
├── supabase/                 schema.sql
├── tests/                    Vitest 유닛 테스트
├── data/fixtures/            CI 검증용 sample (5교 × 3년)
├── .github/workflows/        ci.yml (typecheck·build·test·check) + weekly-sync.yml (KST 03:00 batch)
├── docs/                     01~06 설계·요구사항·데이터·API키·구현·핸드오프
└── package.json
```

실제 데이터는 **repo 밖 `~/hakgun-data/`** 에 보관 (env `HAKGUN_DATA_DIR`로 지정).

## 데이터 파이프라인

```
build-school-master  ─▶  filter-master  ─▶  batch-fetch  ─▶  join-careers  ─▶  import-to-supabase
sitemap 17개              kind/sido 필터     학교×연도 fetch    년도별 합본          Supabase upsert
전국 ~13,000교 master                        9,911 record       3,322교 매칭        production DB
```

- 학교알리미 부하 최소화: 워커 3 + 300~800ms jitter + 지수 backoff + 졸업생 없는 학교 즉시 skip
- 법적 검토(공공누리 제3유형, robots Allow): `docs/03-data-sources.md` §1
- 데이터 무결성 100% (특목·자율·진학자 합산), 졸업자 13건(0.13%) 학교알리미 원본 미세 불일치

## 개발

```bash
npm install
npm run setup:hooks      # pre-push 자동 검증 설치 (vitest + check:data)
npm run dev              # http://localhost:3000
```

데이터가 `~/hakgun-data/` 에 있을 때만 실제 화면 보임. 없으면 빈 페이지 (CI 환경 graceful).

## 검증

| Layer | 명령 | 검사 |
|---|---|---|
| 로컬 pre-push hook | 자동 | Vitest + 데이터 무결성 (풀) |
| GitHub Actions CI | push/PR 자동 | typecheck + build + test + check:data (fixture) |
| Branch Protection | enforce_admins=true | `ci` 통과 PR만 main 머지 가능 |

수동 실행:
```bash
npm run test:run         # Vitest
npm run typecheck        # TypeScript
npm run check:data       # ~/hakgun-data 풀 검증
npm run check:data:fixture  # data/fixtures 검증
```

## 문서

- [요구사항](docs/01-requirements.md) · [아키텍처](docs/02-architecture.md) · [데이터 소스](docs/03-data-sources.md)
- [API 키](docs/04-api-keys.md) · [구현 계획](docs/05-implementation-plan.md) · [핸드오프](docs/06-handoff.md)

## 라이선스

미정.
