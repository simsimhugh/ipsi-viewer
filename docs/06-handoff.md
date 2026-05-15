# 06. 핸드오프 — 일시정지 / 재개 가이드

이 문서는 작업을 일시정지하고 컴 끄거나 며칠 후 다시 이어갈 때 사용한다. 두 가지 재개 경로가 있다.

## A. 세션 그대로 이어가기 (가장 자연스러움)

Claude Code는 대화 흐름·task list·컨텍스트를 `~/.claude/` 아래 디스크에 저장한다. 재부팅해도 사라지지 않는다.

```bash
cd /home/hugh/hakgun-viewer
claude --continue          # 이 디렉토리의 최근 세션 이어가기
# 또는
claude --resume            # 여러 세션 중 골라서 이어가기
```

이러면 마지막에 했던 대화가 그대로 살아나고, in-progress 작업도 그대로 보임.

## B. 새 세션 + 이 문서로 복원 (fallback)

세션 데이터가 손상되거나 컨텍스트가 너무 길어 새로 시작하고 싶을 때.

```bash
cd /home/hugh/hakgun-viewer
claude
```

첫 메시지로 다음을 입력:

```
@docs/06-handoff.md 읽고 이어가자.
```

새 세션 Claude가 이 문서를 보고 현재 상태와 다음 액션을 파악해 진행한다.

## 일시정지 절차 (체크리스트)

1. 작업 중인 거 있으면 마무리하거나 중단점 명확히 함
2. 변경된 파일 확인: `git -C /home/hugh/hakgun-viewer status`
3. 의미 있는 변경이면 커밋·푸시:
   ```bash
   git -C /home/hugh/hakgun-viewer add .
   git -C /home/hugh/hakgun-viewer commit -m "wip: ..."
   git -C /home/hugh/hakgun-viewer push
   ```
4. 컴 끄거나 터미널 닫기

## 현재 상태 스냅샷 (작성 시점: 2026-05-15)

| 항목 | 값 |
|---|---|
| 프로젝트 디렉토리 | `/home/hugh/hakgun-viewer` |
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
- [x] 학교알리미 페이지 구조 분석:
  - 성복중 학교코드 `7751031`, `SHL_IDF_CD=16eebf60-3c71-415a-bd10-1a1ad55b0094`
  - 학교 페이지 라우팅: `loadGongSi('/ei/pp/Pneipp_b{NN}_s0p.do', ...)`
  - 카테고리 탭 4종: 교육활동 / 교육여건 / 학생현황 / 학업성취사항
- [x] NEIS schoolInfo API 호출 검증 (익명 호출은 페이지당 5건 한계)

## 진행 중 (in_progress)

- [ ] #4 수도권 중학교 마스터 리스트 — 코드 완성, NEIS 키 받으면 수도권 1500+개 풀 수집 실행
- [ ] #5 학교알리미 진로현황 Playwright 스크래퍼 — **막혀 있음, 아래 참고**
- [ ] #6 학구도 SHP → GeoJSON 변환 — 코드 완성, SHP 파일 받으면 실행

## 대기 중 (pending)

- [ ] #1 [User] Firebase 프로젝트 생성 + Firestore/Functions/Hosting
- [ ] #2 [User] 카카오 REST API 키 발급
- [ ] #3 [User] 공공데이터포털 API 키 발급
- [ ] #7 [Claude] 아파트 ↔ 중학교 매핑 PoC (사용자 키 #2 + #3 대기)
- [ ] #8 [Both] Firebase Functions + Firestore 스키마 통합
- [ ] #9 [User] NEIS OpenAPI 인증키 발급
- [ ] #10 [User] 학구도 SHP 파일 다운로드 → `data/raw/middle_zones.{shp,shx,dbf,prj}`

## 가장 큰 미해결 — 학교알리미 진로 URL

학교 메인 페이지(`Pneiss_b01_s0`)에 **"진로 / 졸업 / 진학" 텍스트 자체가 안 보임**. 4개 카테고리 탭(교육활동·교육여건·학생현황·학업성취사항) 모두 자동 클릭해 봤지만 진로 항목 미노출. 항목 번호(b??)도 미확인.

### 다음 액션 — 사용자 협조 필요

브라우저에서 직접 확인하면 5분이면 끝난다.

1. 브라우저로 접속:
   <https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=16eebf60-3c71-415a-bd10-1a1ad55b0094>
2. 페이지 하단의 **"공시정보 (2026년)"** 섹션에서 **"학업성취사항"** 탭 클릭
3. 그 안의 **"졸업생의 진로 현황"** 항목 위에서 우클릭 → 검사(Inspect)
4. 개발자도구에서 보이는 **`onclick="loadGongSi(...)"`** 전체 텍스트 복사
5. 다음 세션에서 Claude에게 그대로 알려주면 됨

또는 그 항목 클릭해서 표시되는 페이지의 URL이라도 알려주면 충분하다.

### 시도했지만 막힌 것

- Playwright `getByText("졸업생의 진로 현황")` → 0건
- 카테고리 탭 4종 모두 click() → DOM에 진로 텍스트 나타나지 않음
- 학교 페이지 dump한 17개 공시 항목(b07~b75) 중 진로 관련 b 번호 없음
- 호갱노노/지역내일 기사로 데이터 존재 확인됨 (양천구 기사) — 다만 원본 URL 미확정

## 자산 위치

| 파일 | 내용 |
|---|---|
| `scripts/fetch-schools.ts` | NEIS schoolInfo API로 수도권 중학교 마스터 수집 |
| `scripts/scrape-schoolinfo.ts` | 학교알리미 Playwright 스크래퍼 (디버그 모드 포함) |
| `scripts/convert-districts.ts` | SHP → GeoJSON 변환 |
| `data/samples/sungbok-landing.html` | 성복중 페이지 HTML dump (518KB) |
| `data/samples/sungbok-landing.png` | 학교 페이지 전체 스크린샷 |
| `data/samples/sungbok-clickables.json` | 페이지 내 모든 클릭 가능 요소(243건) |
| `data/samples/sungbok-xhr.json` | 페이지 로드 시 XHR 호출(15건) |
| `data/samples/sungbok-after-tabs.json` | 카테고리 탭 클릭 후 진로 관련 요소(0건) |
| `data/schools.json` | NEIS 익명 호출로 가져온 15개 학교 샘플 (gitignore — 키 발급 후 재생성) |

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
