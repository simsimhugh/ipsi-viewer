# 06. 핸드오프 — 일시정지 / 재개 가이드

## 재개

```bash
cd /home/hugh/project/ipsi-viewer
claude --continue        # 이 디렉토리 최근 세션 이어가기
# 또는
claude --resume          # 여러 세션 중 선택
```

대화·task list·상태가 디스크에 보존되어 재부팅해도 살아남습니다.

세션이 손상되거나 새로 시작하고 싶을 때:
```bash
claude
# 첫 메시지: @docs/06-handoff.md 읽고 이어가자.
```

## 현재 상태 스냅샷 (2026-05-17)

| 항목 | 값 |
|---|---|
| 프로젝트 디렉토리 | `/home/hugh/project/ipsi-viewer` |
| GitHub | https://github.com/simsimhugh/ipsi-viewer |
| 브랜치 | main (branch protection: required `ci` + enforce_admins=true → PR 강제) |
| 호스트 | WSL2 Ubuntu 26.04, Node 24.15 |
| 데이터 위치 | `~/hakgun-data/` (repo 밖, 보안 분리) |
| Local dev | `npm run dev` → http://localhost:3000 |

## 완성된 트랙 (진학)

### 데이터 파이프라인
- ✅ 전국 학교 master **13,137교** — sitemapindex 동적 follow, 주소/시군구/좌표 (97~99% 채움)
- ✅ 전국 중학교 진로 **9,911 record** (학교 × 연도) — 2023·2024·2025
- ✅ 진로 매칭 학교 **3,322교** (다년)
- ✅ 데이터 무결성 100% (특목소계·자율소계·진학자·남여=합계 0건 불일치, 졸업자 13건 0.13% 학교알리미 원본 미세 불일치)

### 핵심 스크립트 (`scripts/`)
- `build-school-master.ts` — sitemap → master (45분)
- `filter-master.ts` — kind / sido / sigungu 필터
- `fetch-career.ts` — 학교 1교 진로 fetch (순수 HTTP, 0.24s)
- `batch-fetch.ts` — 학교 list × 연도 batch (queue 워커 3 + 300~800ms jitter + 지수 backoff)
- `parse-career.ts` — 진로 HTML → JSON (td title 매핑)
- `join-careers.ts` — master + careers-by-year → schools-with-career.jsonl (careersByYear 합본)
- `analyze-careers.ts` — 상위 학교 표 (콘솔)
- `check-data-integrity.ts` — 5가지 합산 검증
- `import-to-supabase.ts` — JSONL → Supabase upsert
- `poc-pip.ts` — Point-in-Polygon 알고리즘 (부동산 트랙용, 가짜 데이터로 PASS)

### UI (`app/`, `components/`, `lib/`)
- `app/page.tsx` — 메인 (전국 중학교 표, force-dynamic)
- `app/school/[shl]/page.tsx` — 학교 상세 (force-dynamic, 새 창 popup)
- `components/SchoolTable.tsx` — 표 (시·구 컬럼, chip multi cascading 필터, 헤더 정렬, 컬럼 visibility, 다년 칩 합산, history pushState)
- `components/SchoolDetailView.tsx` — 상세 (연도 매트릭스, 트렌드 line chart 2개, 카테고리 chip 토글)
- `components/CareerChart.tsx` — 단년 막대 차트
- `components/LocationFilter.tsx` — 보존 (현재 미사용, 추후 재사용 가능)
- `lib/types.ts` — School/CareerRow/CareerData + 헬퍼 (eliteCount, sumYears 등)
- `lib/columnLabels.ts` — 라벨 단일 소스 (CAREER_LABELS, META_LABELS)
- `lib/data.ts` — Supabase / JSONL 자동 분기

### 인증·인프라
- ✅ Vitest 15 tests (types · labels)
- ✅ pre-push hook (vitest + check:data)
- ✅ GitHub Actions CI (typecheck + build + test + check:data:fixture)
- ✅ Branch protection (required `ci` + enforce_admins=true) → main 직접 push 막힘. PR 방식 표준.
- ✅ data/fixtures/ (5교 × 3년) — CI 검증용 commit
- ✅ git history 데이터 완전 제거 (filter-repo, force push 끝)

### 라이선스/법적 (`docs/03-data-sources.md`)
- 학교알리미 = 공공누리 제3유형 (출처표시 + 변경금지, 상업 이용 가능)
- robots.txt: Allow: /, Crawl-delay 없음
- 자동수집 금지 조항 없음

## 진행 중 — Supabase + Vercel 배포

- ✅ 코드 준비 완료 (PR #1)
- ⏳ 사용자 액션 대기:
  1. **Vercel** 콘솔에서 `simsimhugh/ipsi-viewer` import → 첫 deploy
  2. **Supabase** 프로젝트 생성 (Seoul region) → URL / anon key / service_role key 받아서 전달
- 받으면 Claude가:
  - Supabase schema 적용 (`supabase/schema.sql`)
  - `~/hakgun-data` → Supabase 적재 (`npm run import:supabase`)
  - Vercel env 등록 (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY)
  - GitHub Secrets 등록 (SUPABASE_URL/SERVICE_ROLE_KEY for weekly sync)
  - 배포 검증 + production URL 안내

## 대기 트랙 (사용자 액션 필요)

- **#10 학구도 SHP 다운로드** → 부동산 트랙 풀가동 (PIP 알고리즘은 검증됨)
- **#2 카카오 REST API 키** → 동(행정동) 정보 좌표→reverse geocoding으로 master 보강 (한 번만 호출, 영구 캐싱) + 아파트 지오코딩
- **#3 공공데이터포털 API 키** → 국토부 실거래가
- **#9 NEIS 키** — 격하 (sitemap이 대체)

## 다음 세션 우선 액션

1. 사용자가 Vercel/Supabase 액션 마치고 토큰 전달
2. Claude가 Supabase 스키마 → 데이터 적재 → Vercel deploy → 검증
3. 그 후 부동산 트랙 (사용자 키/SHP 받는 대로)
4. 디자인 polish (`/frontend-design` 또는 Firebase Studio — 기능 완성 후)

## 우선순위

1. Vercel + Supabase 배포 (사용자 액션 대기)
2. 디자인 polish
3. 부동산 트랙 (#7, #10, #2, #3)
