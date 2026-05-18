# Design polish v1 — 회고

> **결과**: 폐기 (2026-05-17). 사용자 평가: "진짜 별로다"
> **이 문서의 목적**: 이력 보존 — 같은 톤·접근법으로 두 번 반복하지 않기 위해.

## 메타

| 항목 | 값 |
|---|---|
| 시도 시점 | 2026-05-17 (KST) |
| Commit | `7dfd6df` (브랜치 `design/polish-v1` — 원격에서 삭제됨, dangling commit으로 복원) |
| 변경 규모 | 8 files, +321 / -211 |
| 진행 방식 | `/frontend-design` skill을 designer subagent로 호출 |
| 사용자 사전 협의 | **없음** (제일 큰 실수 — 후술) |
| 폐기 시각 | 2026-05-17 약 24:22 KST |

## 디자인 의도 (subagent 산출물 그대로)

> Korean education tool — override editorial default
> - Background: `#F7F8FA` (cool near-white), surfaces: pure white
> - Primary: `#1D5BD4` (authoritative deep blue), emphasis: `#1B4F9C` (navy)
> - Typography: `Noto Sans KR` 400/500/600/700 — Korean-optimized, tabular legible

### 핵심 변경 10가지

1. **폰트** — `Pretendard` (미로드 상태였음) → `Noto Sans KR` 400/500/600/700, Google Fonts preconnect + preload
2. **팔레트** — sky-blue 계열 → 딥 네이비 `#1D5BD4`/`#1B4F9C`, 배경 `#F7F8FA`
3. **헤더** — 로고 좌측 네이비 accent bar 추가, `shadow-sm`로 부유감
4. **KPI 카드** — 좌측 4px 네이비 bar로 강조 (졸업 / 선택합계 / 선택비율 / 공시연도)
5. **컨트롤 바** — 필터·정렬 chip을 하나의 카드로 통합
6. **테이블** — 짝/홀 교차 배경 + row hover에 `brand-50` 배경
7. **차트 tooltip** — rounded + shadow
8. **숫자 정렬** — `font-feature-settings: "tnum" 1` (tabular numbers)
9. **인터랙션 전환** — 130ms ease-out 일관 적용
10. **뒤로가기** — chevron 아이콘 + "목록으로" 텍스트

## 캡처

### 메인 페이지 (1440×900 viewport)

![메인 페이지](./screenshots/02-main-viewport.png)

### 학교 상세 페이지 — 성복중학교

![학교 상세](./screenshots/04-school-detail-viewport.png)

### 부동산 표 영역

![부동산 표](./screenshots/05-realestate-section.png)

### 모바일 (390×844)

![모바일 메인](./screenshots/06-mobile-main.png)

> 전체 스크린샷은 `./screenshots/` 디렉토리 참고 (fullpage 포함).

## 사용자 평가 — "진짜 별로다"

명시적 reject. 폐기 사유 분석:

| 관점 | 평가 |
|---|---|
| **차별성** | 전형적인 "AI가 만든 데이터 대시보드" 톤 — 인사이드 라이트 블루 + 흰색 카드 + 회색 보조 텍스트의 templated 룩 |
| **편집권 부재** | 사용자가 어떤 톤·레퍼런스·키워드를 원하는지 전혀 묻지 않고 진행 — designer가 도메인만 보고 결정 |
| **접근법** | "데이터 대시보드 = 네이비 + Noto Sans" 라는 안전한 선택 → 결과적으로 평범 |
| **세부 디테일** | KPI 좌측 accent bar, 테이블 hover, tooltip rounded 등은 잘 적용됐지만 전체 인상을 살리지 못함 |

## 회고 — 다음 시도 가이드

### 1. 진행 전 사용자와 협의 필수

- **참고 디자인** (URL·캡처) 1~3개 받기
- **톤 키워드** — "단정한 / 묵직한 / 가볍고 산뜻한 / 학술적인 / 신문 같은" 등
- **하기 싫은 톤** 명시 — 이번 케이스라면 "일반적인 AI 대시보드 톤 X"
- **brand color** 후보 받거나, 적어도 호불호 톤 (네이비 vs 짙은 그린 vs 따뜻한 누드 등)
- **폰트 방향** — Noto Sans KR이 default 답이지만 Pretendard, IBM Plex Sans KR, Spoqa Han Sans 등 선택지 제시

### 2. 작은 단위로 prototype

전체 8 파일을 한 번에 바꾸지 말고, **카드 1개 / 헤더 / 표 1개** 단위로 미리 보여주고 OK 받기. 사용자가 reject 했을 때 손실이 작음.

### 3. "AI 디자인 같다"는 함정 인식

`/frontend-design` skill의 prompt가 "AI 디자인 회피"를 명시하지만, 그것이 곧 success 보장은 아님. **결과를 의심하고 사용자에게 제시 후 판단**.

### 4. 폐기 시 이력 보존

이번에는 브랜치가 폐기 시 같이 지워졌고 PR도 없었음. 브랜치는 `archive/<name>` 형태로 남기거나, retrospective 문서 + 스크린샷을 의무화하면 회고 가능. (이 문서가 그 시작)

## 부록 — 복원 방법

원격에서 브랜치는 삭제됐지만 commit은 git 객체 DB에 살아있음. 동일 결과 재현이 필요하다면:

```bash
git worktree add -b retro/design-polish-v1 /tmp/hakgun-design-v1 7dfd6df
cd /tmp/hakgun-design-v1
cp /home/hugh/project/hakgun-viewer/.env.local .
npm install
PORT=3001 npm run dev
# → http://localhost:3001 접속
```

git GC(garbage collection)로 dangling commit이 정리되면 이 hash는 사라질 수 있음. 영구 보존이 필요하면 `git tag retro/design-polish-v1 7dfd6df` 후 push.
