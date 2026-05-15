# 05. 구현 계획

## Phase 구분

| Phase | 목표 | 산출물 | 상태 |
|---|---|---|---|
| 0 | 데이터 소스 검증 | 한 학교에 대한 진학 데이터 추출 성공, SHP 구조 확인 | 진행 중 |
| 1 | 데이터 수집·변환 PoC | scripts/ 하위 단독 실행 가능한 3개 스크립트 | 일부 완료 |
| 2 | Firebase 백엔드 | Functions·Firestore·Scheduler 통합 | 미착수 |
| 3 | 프론트엔드 MVP | 랭킹 테이블 + 학교 상세 | 미착수 |
| 4 | v2 | 지도 뷰, 비교 뷰 | 미착수 |

## 현재 작업 (Phase 0 + Phase 1)

| # | 작업 | 담당 | 상태 |
|---|---|---|---|
| 1 | Firebase 프로젝트 생성 + Firestore/Functions/Hosting 활성화 | User | 대기 |
| 2 | 카카오 REST API 키 발급 | User | 대기 |
| 3 | 공공데이터포털 API 키 발급 | User | 대기 |
| 4 | 수도권 중학교 마스터 리스트 수집 스크립트 | Claude | 코드 완료 (NEIS 키 받으면 실행) |
| 5 | 학교알리미 진학현황 Playwright 스크래퍼 PoC (성복중 단일) | Claude | 코드 완료 (호스트 OS 이슈로 실행 보류) |
| 6 | 학구도 SHP → GeoJSON 변환 파이프라인 | Claude | 코드 완료 (SHP 파일 받으면 실행) |
| 7 | 아파트-중학교 매핑 PoC | Claude | 키 대기 |
| 8 | Firebase Functions + Firestore 스키마 통합 | Both | Phase 2 시작점 |
| 9 | NEIS OpenAPI 인증키 발급 | User | 대기 |
| 10 | 학구도 SHP 파일 다운로드 | User | 대기 |

## 환경 제약 — Playwright × Ubuntu 26.04

현재 호스트 OS는 Ubuntu 26.04 LTS (WSL2). Playwright가 공식 지원하는 최신 LTS는 24.04로, 26.04에서는 `npx playwright install` 후에도 브라우저 바이너리가 실제로 다운로드되지 않는다 (exit 0이지만 실패).

### 회피 옵션

| 옵션 | 설명 | 권장도 |
|---|---|---|
| A | 시스템 google-chrome 설치 + Playwright `launch({ executablePath })`로 지정 | 강력 권장 |
| B | WSL2에 Ubuntu 24.04 LTS 디스트로 별도 설치하고 거기서 개발 | 권장 |
| C | 로컬에서는 PoC 검증 보류, Cloud Functions 컨테이너에서만 실행 | 비권장 |

### 옵션 A 절차

```bash
sudo apt-get update
sudo apt-get install -y wget gnupg ca-certificates
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update
sudo apt-get install -y google-chrome-stable
google-chrome --version
```

설치 후 `scripts/scrape-schoolinfo.ts`의 `chromium.launch()`를 다음과 같이 수정:

```ts
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome-stable",
});
```

## 새로고침 정책

- 학교 단위 새로고침: 학교당 6시간 쿨다운. 직접 학교알리미 페이지를 재스크래핑하고 contentHash 비교 후 변경 시에만 Firestore 갱신.
- 단지 단위 새로고침: 단지당 1시간 쿨다운. 국토부 API에 해당 법정동·계약년월 재호출.
- 학구 단위: 사용자 트리거 불가 (월 1회 cron만).

## Phase 2 (Firebase 통합) 작업 순서

1. Firebase CLI 로컬 인증, 프로젝트 연결
2. Firestore 보안 규칙 작성 (읽기 public, 쓰기 Functions only)
3. PoC 스크립트를 functions/ 하위로 이식 (TypeScript 모노레포 또는 단일 ts-node)
4. Cloud Scheduler 트리거 작성:
   - `dailyScrapeSchools` (변경 감지 + 재파싱)
   - `dailySyncApartments`
   - `monthlyCheckDistrictSHP`
5. HTTP Functions: `refreshSchool`, `refreshApartment`
6. 보안 규칙 + App Check 적용

## Phase 3 (프론트엔드 MVP) 작업 순서

1. Firebase Studio에서 Next.js 워크스페이스 생성
2. Firestore SDK 연결, 메인 페이지에서 schools 전체 조회 + 클라이언트 사이드 정렬·필터 (1500개는 충분히 클라이언트에서 처리 가능)
3. 학교 상세 페이지: 동적 라우트 `/school/[sdSchulCode]`
4. Firebase Hosting 배포

## 검증 기준

- Phase 0: 성복중학교 데이터 추출 성공 + SHP 좌표계 확인
- Phase 1: 수도권 1500개 학교 진학 데이터 수집 완료, 단지-학교 매핑 정확도 95% 이상 (성복중 학구로 샘플 검증)
- Phase 2: cron이 24시간 안정적으로 작동, Functions 오류율 0
- Phase 3: 메인 페이지 첫 페인트 2초 이내, Lighthouse 성능 점수 80 이상
