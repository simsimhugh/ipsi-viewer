# 06. 핸드오프 — 일시정지 / 재개 가이드

이 문서는 작업을 일시정지하고 컴 끄거나 며칠 후 다시 이어갈 때 사용한다. 두 가지 재개 경로가 있다.

## A. 세션 그대로 이어가기 (가장 자연스러움)

Claude Code는 대화 흐름·task list·컨텍스트를 `~/.claude/` 아래 디스크에 저장한다. 재부팅해도 사라지지 않는다.

```bash
cd /home/hugh/project/hakgun-viewer
claude --continue          # 이 디렉토리의 최근 세션 이어가기
# 또는
claude --resume            # 여러 세션 중 골라서 이어가기
```

이러면 마지막에 했던 대화가 그대로 살아나고, in-progress 작업도 그대로 보임.

## B. 새 세션 + 이 문서로 복원 (fallback)

세션 데이터가 손상되거나 컨텍스트가 너무 길어 새로 시작하고 싶을 때.

```bash
cd /home/hugh/project/hakgun-viewer
claude
```

첫 메시지로 다음을 입력:

```
@docs/06-handoff.md 읽고 이어가자.
```

새 세션 Claude가 이 문서를 보고 현재 상태와 다음 액션을 파악해 진행한다.

## 일시정지 절차 (체크리스트)

1. 작업 중인 거 있으면 마무리하거나 중단점 명확히 함
2. 변경된 파일 확인: `git -C /home/hugh/project/hakgun-viewer status`
3. 의미 있는 변경이면 커밋·푸시:
   ```bash
   git -C /home/hugh/project/hakgun-viewer add .
   git -C /home/hugh/project/hakgun-viewer commit -m "wip: ..."
   git -C /home/hugh/project/hakgun-viewer push
   ```
4. 컴 끄거나 터미널 닫기

## 현재 상태 스냅샷 (작성 시점: 2026-05-16)

| 항목 | 값 |
|---|---|
| 프로젝트 디렉토리 | `/home/hugh/project/hakgun-viewer` |
| GitHub | https://github.com/simsimhugh/hakgun-viewer (public) |
| 브랜치 | main |
| 호스트 OS | WSL2 Ubuntu 26.04 |
| Node | 24.15 |
| Google Chrome (Playwright용) | 148 — `/usr/bin/google-chrome-stable` |

## 완료된 작업

- [x] 프로젝트 스캐폴드 (package.json·tsconfig·.gitignore)
- [x] 설계 문서 5종 (`docs/01-requirements.md` ~ `docs/05-implementation-plan.md`)
- [x] GitHub 리포 생성 + 첫 커밋 push
- [x] Ubuntu 26.04 × Playwright 회피 — 시스템 Chrome 설치
- [x] 학교알리미 페이지 구조 분석 (사용자 onclick 제보로 차단 해제):
  - 학교 페이지 라우팅: `loadGongSi('/ei/pp/Pneipp_b{NN}_s0p.do', ...)`
  - default JG_YEAR=**2026**(데이터 없음) → 학생현황 탭의 list3에 b06 미포함
  - 2025로 form submit reload(`goSearForm('gsYear')`) 시 list3에 b06 포함됨
  - 진로 현황 항목 정확한 onclick:  
    `loadGongSi('/ei/pp/Pneipp_b06_s0p.do', '06', '13-다', '졸업생의 진로 현황', 'JG040', 'JG130', '52', '1')`
- [x] **Playwright 스크래퍼 동작 검증** (12.8s/학교, `scripts/scrape-schoolinfo.ts`)
- [x] **옵션 A — 순수 fetch PoC 완성** (`scripts/fetch-career.ts`, 0.24s/학교)
  - 4-step: GET landing → POST landing(JG_YEAR=2025) → loadGongSi 인자 regex 추출 → POST `/ei/pp/Pneipp_b06_s0p.do`
  - `<td title="진학자 일반고">141</td>` 형식 — 파싱 매우 쉬움
- [x] **다중 학교 sanity check**(성복중·미로중·평원중·대화중) — b06 파라미터 학교별 동일 검증
- [x] **NEIS 키 의존성 격하** — sitemap(`/sitemap/school/main/school_main_{01..10}.xml`)에서 전국 학교 SHL_IDF_CD 직접 추출 가능. NEIS는 주소·시도코드 등 보강용으로만 필요.
- [x] **법적 검토 명문화** (`docs/03-data-sources.md` §1)
  - robots.txt: Allow: /, Crawl-delay 없음
  - 공공누리 제3유형 (출처표시 + 변경금지, 상업적 이용 가능)
  - 자동수집 금지 조항 없음
  - 안전 호출 정책 명시(워커 2~3, 간격 300~800ms, 지수 backoff)
- [x] NEIS schoolInfo API 호출 검증 (익명 호출은 페이지당 5건 한계)

## 진행 중 (in_progress)

- [ ] #4 수도권 중학교 마스터 리스트 — sitemap 경유로 NEIS 키 없이도 가능
- [ ] #5 학교알리미 진로현황 스크래퍼 — **PoC 완료**. 다음은 파서(HTML → JSON) + 안전 정책 코드화
- [ ] #6 학구도 SHP → GeoJSON 변환 — 코드 완성, SHP 파일 받으면 실행

## 대기 중 (pending)

- [ ] #1 [User] Firebase 프로젝트 생성 + Firestore/Functions/Hosting
- [ ] #2 [User] 카카오 REST API 키 발급
- [ ] #3 [User] 공공데이터포털 API 키 발급
- [ ] #7 [Claude] 아파트 ↔ 중학교 매핑 PoC (사용자 키 #2 + #3 대기)
- [ ] #8 [Both] Firebase Functions + Firestore 스키마 통합
- [ ] #9 [User] NEIS OpenAPI 인증키 발급 (우선순위 격하 — sitemap이 대체 가능)
- [ ] #10 [User] 학구도 SHP 파일 다운로드 → `data/raw/middle_zones.{shp,shx,dbf,prj}`

## 다음 세션 우선 액션

1. **HTML → JSON 파서** 작성 (`scripts/parse-career.ts`)
   - `<td title="진학자 XXX">N</td>` 형식 그대로 매핑
   - 출력 스키마: `{ schoolName, year, totalGraduates, generalHigh, scienceHigh, foreignIntlHigh, ... }`
   - 검증: `data/samples/fetch-career.html` (성복중 2025) 파싱 결과가 합산 315명 일치
2. **안전 호출 정책 코드화**
   - `p-limit` 또는 자작 queue (워커 2~3)
   - 워커당 300~800ms jitter
   - 지수 backoff 재시도 (1s → 2s → 4s → 8s, 최대 5회)
3. **sitemap → 중학교 마스터 추출** 스크립트
   - sitemap 10개에서 SHL_IDF_CD 전부 모음 → 1차 빠른 페이지 GET으로 학교명 추출 → "중학교" 필터
   - 수도권 한정은 NEIS 키 받으면 ATPT_OFCDC_SC_CODE로 필터 가능, 또는 sitemap 학교명 + 주소 추출
4. (옵션) NEIS 키 받으면 `fetch-schools.ts`로 보강 (주소·교육청 등)

## 자산 위치

| 파일 | 내용 |
|---|---|
| `scripts/fetch-schools.ts` | NEIS schoolInfo API로 수도권 중학교 마스터 수집 |
| `scripts/scrape-schoolinfo.ts` | 학교알리미 Playwright 스크래퍼 (12.8s/학교) — reference |
| **`scripts/fetch-career.ts`** | **순수 fetch 스크래퍼 PoC (0.24s/학교) — 정식 채택 후보** |
| `scripts/convert-districts.ts` | SHP → GeoJSON 변환 |
| `data/samples/fetch-career.html` | 옵션 A 결과 (성복중 2025 진로 페이지) |
| `data/samples/fetch-landing-2025.html` | 옵션 A step 2 (JG_YEAR=2025 reload 결과) |
| `data/samples/sungbok-gongsi-info.html` | Playwright 결과 (옵션 A와 비교용) |
| `data/samples/sungbok-career-tables.html` | Playwright table dump |
| `data/samples/sungbok-career.png` | 진로 페이지 전체 스크린샷 |
| `data/samples/sungbok-landing.html` | 첫 진입 페이지 HTML (default 2026) |
| `data/schools.json` | NEIS 익명 호출로 가져온 15개 학교 샘플 (gitignore — 키 발급 후 재생성) |
| `/tmp/sm-{01..10}.xml` | 학교알리미 sitemap (전국 학교 SHL_IDF_CD 인덱스) — 휘발성, 필요 시 재다운로드 |

## 환경 재현 — 새 머신에서 시작할 때

```bash
git clone https://github.com/simsimhugh/hakgun-viewer.git
cd hakgun-viewer
npm install
npx playwright install chromium-headless-shell  # Ubuntu 24.04 이하면
# Ubuntu 26.04는 시스템 Chrome 설치:
#   sudo apt-get install -y google-chrome-stable
```

`.env` 파일은 별도로 생성 — `docs/04-api-keys.md` 참고.

## 우선순위

1. **사용자**: 학교알리미 진로 페이지 URL/onclick 확인 (최우선, 진로 PoC 차단 해제)
2. **사용자**: NEIS 키 발급 → `#4` 풀 실행 가능
3. **사용자**: 학구도 SHP 다운로드 → `#6` 실행 가능
4. **사용자**: 카카오·공공데이터·Firebase 키 발급 → `#7`, `#8` 시작 가능
