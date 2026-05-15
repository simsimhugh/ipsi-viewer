# 04. API 키 발급 가이드

필요한 외부 자격증명과 발급 절차를 모아둔다. 모든 키는 `.env` 파일에 저장하고 절대 커밋하지 않는다 (`.gitignore`에 `.env` 포함됨).

## 키 일람

| 키 환경변수 | 발급처 | 비용 | 용도 |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` | console.firebase.google.com | 무료 (Blaze 시 종량) | 백엔드·DB·호스팅 |
| `KAKAO_REST_KEY` | developers.kakao.com | 무료 30만/일 | 지오코딩 |
| `DATA_GO_KR_KEY` | data.go.kr | 무료 (호출 한도) | 국토부 실거래가 |
| `NEIS_API_KEY` | open.neis.go.kr | 무료 | 학교 마스터 |

## 1. Firebase

1. https://console.firebase.google.com 접속 (Google 계정)
2. **프로젝트 추가** → 이름 입력 (예: `hakgun-viewer`)
3. Google Analytics 사용 안 함
4. 생성 후 좌측 **빌드 → Firestore Database** → **데이터베이스 만들기**
   - 위치: `asia-northeast3` (서울)
   - 모드: 테스트 모드로 시작 (보안 규칙은 추후 강화)
5. 좌측 **빌드 → Functions** → **요금제 업그레이드** → **Blaze 종량제** 선택
   - 결제 카드 등록 필요 (무료 한도 내 운영)
6. 좌측 **빌드 → Hosting** → **시작하기**

기록할 값: 프로젝트 ID (예: `hakgun-viewer-abc12`)

## 2. Kakao Local API

1. https://developers.kakao.com 접속 (Kakao 계정)
2. **내 애플리케이션** → **애플리케이션 추가**
3. 앱 이름: `hakgun-viewer`
4. 생성 후 **앱 키** 페이지에서 **REST API 키** 복사
5. **플랫폼** → **Web 플랫폼 등록** → `http://localhost:3000`, 배포 후 호스팅 도메인 추가

환경변수: `KAKAO_REST_KEY`

## 3. 공공데이터포털 (국토부 실거래가)

1. https://data.go.kr 회원가입·로그인
2. 검색: **아파트 매매 실거래가 자료** (또는 데이터셋 ID `15126469`)
3. 해당 페이지에서 **활용신청** 클릭
4. 사용 목적·시스템 정보 입력 → 즉시 자동 승인
5. **마이페이지 → 인증키 발급내역** → **일반 인증키 (Decoding)** 복사

환경변수: `DATA_GO_KR_KEY`

학구도 SHP은 활용신청 없이 다운로드 가능하나 일부 데이터셋은 별도 신청 필요 — 그때는 동일 인증키 사용.

## 4. NEIS OpenAPI

1. https://open.neis.go.kr 접속 → 회원가입 (이메일 인증)
2. 로그인 후 우측 상단 **마이페이지 → 인증키 신청**
3. 신청 정보 작성 → 즉시 발급

환경변수: `NEIS_API_KEY`

## .env 파일 예시 (커밋 금지)

`.env` 파일을 프로젝트 루트에 생성:

```dotenv
FIREBASE_PROJECT_ID=hakgun-viewer-abc12
KAKAO_REST_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DATA_GO_KR_KEY=xxxxxxxxxxxxxxxxxxxx...
NEIS_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 보안 권고

- `.env`는 `.gitignore`에 이미 등록됨 — 절대 커밋 금지
- Cloud Functions 배포 시에는 Firebase Functions의 환경변수 또는 Secret Manager에 별도 저장
- Kakao REST 키는 클라이언트(브라우저)에서 사용 시 도메인 화이트리스트 등록 필수
- 키 노출 시 즉시 재발급
