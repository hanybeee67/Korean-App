# Everest-Pay(에베레스트 페이) 한국어 챌린지 및 월간 이벤트 구현 계획

## 목표
직원들의 한국어 학습 동기를 강화하기 위해 일일 미션 보상("Everest-Pay")과 월간 성과 평가 이벤트("지점별 한국어 왕")를 도입합니다.
데이터의 신뢰성과 통합 관리를 위해 **중앙 서버(Render + DB)**를 구축하여 운영합니다.

## User Review Required (중요!)
> [!IMPORTANT]
> **백엔드 서버 구축 필요**
> - 기존의 정적 웹사이트(GitHub Pages) 구조에 **Node.js 백엔드 서버**가 추가됩니다.
> - 프로젝트 폴더 내에 `server/` 디렉토리를 신설하여 백엔드 코드를 작성할 예정입니다.
> - 실제 운영을 위해서는 Render.com 등의 호스팅 서비스에 이 백엔드 코드를 배포해야 합니다.

## 주요 기능 및 아키텍처

### 1. 시스템 아키텍처
- **Frontend**: HTML/JS (기존 앱) + 로그인 & API 통신 모듈
- **Backend**: Node.js (Express)
- **Database**: PostgreSQL (Render 제공 DB 사용)

### 2. 세부 기능

#### A. 사용자 인증 (로그인)
- 앱 실행 시 최초 1회 로그인 필요.
- **입력 정보**:
  - **지점 선택**: (드롭다운: 영통, 동탄, 하남, 등 9개 지점)
  - **이름 입력**: (텍스트)
- 로그인 성공 시 `token`을 발급받아 LocalStorage에 저장(자동 로그인).

#### B. Everest-Pay (보상 시스템)
- **미션 수행**: 매일 2개의 문장 따라하기 성공 시 API 호출.
- **API**: `POST /api/score/earn`
  - 요청: `{ userId, missionId, points: 200 }`
  - 응답: `{ currentBalance: 600, message: "적립 완료!" }`
- **UI**: 상단에 현재 적립금 실시간 표시.

#### C. 관리자(Admin) 페이지
- **URL**: `index.html?mode=admin` 또는 별도 `admin.html`
- **기능**:
  - 지점별 총 적립금 현황 (막대 그래프)
  - 월간 Top 랭커 직원 목록
  - 엑셀 다운로드 (CSV)

### 3. 데이터베이스 스키마 설계
- **Users**: `id`, `name`, `branch`, `total_points`, `level`
- **Missions**: `id`, `date`, `sentence_korean`, `sentence_nepali`
- **Logs**: `id`, `user_id`, `type(EARN/TEST)`, `amount`, `timestamp`

## 구현 순서
1.  **Backend 설정 (`server/`)**:
    - Node.js 프로젝트 초기화 (`package.json`)
    - PostgreSQL 연결 설정 (`db.js`)
    - API 엔드포인트 구현 (`server.js`)
2.  **Frontend 로그인 구현**:
    - 로그인 모달 생성
    - 로그인 정보 저장 및 인증 상태 관리
3.  **Hany-Pay 로직 연동**:
    - 미션 성공 시 서버로 데이터 전송
    - 앱 시작 시 서버에서 내 정보(포인트) 동기화
4.  **Admin 페이지**:
    - 간단한 통계 대시보드 구현

## Verification Plan (검증 계획)
### Automated
- API 통신 테스트 (Postman 또는 `curl` 활용)
- DB 연결 및 데이터 저장 확인

### Manual
- **로그인 테스트**: 앱 재실행 시 로그인 유지 여부 확인.
- **적립 테스트**: 미션 성공 후 DB에 로그가 쌓이는지, 다른 기기(관리자)에서 조회가 되는지 확인.
- **관리자 기능**: 엑셀 다운로드 데이터 정확성 검증.
