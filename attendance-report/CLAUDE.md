# 올인원 학원 시스템 — Claude 작업 가이드 (초보 수강생용)

실사용 학원 운영 시스템의 핵심 3기능(데일리 리포트·출석 현황판·월말평가서)에 **학생앱·선생님앱**까지 Vercel로 옮긴 실습 템플릿입니다.
학생DB·교재DB는 2차 세미나(앱스크립트) 학생 배포 템플릿 구조를 따릅니다. 수강생이 Claude에게 말로 시켜서 고칩니다.
(정적 HTML은 리포지토리 루트에 있고 Vercel Root Directory = attendance-report 입니다. `public/` 아님.)

## 이 앱이 하는 일 (핵심 3기능)
- **데일리 리포트** `daily.html` — 오늘 등원을 판단해 다음 진도를 적용한 리포트를 생성 → 진도·태도·과제·단어테스트 작성(자동 저장) → 📨 학부모 카톡 발송
- **출석 현황판** `board.html` — 등원·곧 하원·하원·미등원 실시간, 하원 처리(카톡 X), 미등원 알림톡(수동)
- **월말평가서** `report.html`+`api/report.js` — 통계 집계 + Claude로 평가서 생성 → 학부모는 토큰 링크(`parent.html`)로 열람
- **선생님앱** `teacher.html` — 내 담당 학생만 현황판 + 과제 내주기(오늘 진도로 자동 채우기) + 체크 현황
- **학생앱** `student.html`+`api/student.js` — 학생이 폰으로 로그인(학생ID+출결PIN) → 오늘 과제 체크 · 내 진도 · 최근 수업기록 · 월말평가서
- **학생 카드** `student_card.html`+`api/attendance.js`(`student-history`) — 한 학생의 지난 진도·테스트·과제를 1주/1달/3달로 (과목별 흐름 + 날짜별 표)
- (받침) 키오스크 PIN 등하원 / 교재 목차 → 진도 자동 전환 / 새벽 cron 행 생성

## 건드리면 안 되는 것 (★)
- **service_role 키를 브라우저(public/)로 내보내지 말 것.** DB 접근은 `api/*.js`(서버)에서만.
- **`share_token`**(학부모 열람용 랜덤 토큰)을 약하게 바꾸지 말 것 — 학생ID 노출 방지 장치.
- 환경변수 이름(`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`)은 그대로.
- **`api/student.js` 의 `student_id=eq.<본인>` 조건을 지우지 말 것.** 이게 학생이 '자기 것만' 보게
  막아주는 장치입니다. 지우면 다른 학생 기록·과제가 보입니다.
- **알림톡 변수명**(`#{학생이름}` `#{리딩교재}` `#{리딩진도}` …)은 1·2차 세미나에서 등록한
  카카오 템플릿과 맞춰져 있습니다. 바꾸면 이미 쓰고 계신 템플릿이 안 나가요 — 추가는 괜찮습니다.

## 우리 학원화 (가장 먼저 바꾸는 곳)
- **학원 이름 · 대표 색 → `config.js` 두 줄** (전 화면에 한 번에 적용)
- 코드에 학원 이름을 넣고 싶지 않을 때는 Vercel 환경변수 **`ACADEMY_NAME`/`BRAND_COLOR`**.
  넣으면 `config.js` 값보다 그게 이깁니다 (`api/config.js` 가 내려주고 `config.js` 가 덮어씀).
  → 자료 제작용으로 내 학원 것으로 돌려볼 때 쓰는 길입니다. 수강생은 `config.js` 를 고치면 됩니다.

## 자주 하는 수정 (여기)
- 평가서 어투·모델 → `lib/claude.js` (`reportGuideline()` = 실사용 지침, `MODEL`)
- 월말 통계 집계 → `api/report.js` 의 `computePlanner()` / `displayStats()`
- 데일리 리포트 행/저장/발송 → `api/attendance.js` 의 `daily-rows`·`save-record`·`send-daily`
- 학생 카드 화면 → `student_card.html` / 데이터 → `api/attendance.js` 의 `student-history`
- 재시 안내 카톡 → `api/attendance.js` 의 `send-retest` · **판정·큐 규칙은 `lib/retest.js` 한 곳**
  (「불통과」 버튼 **또는 점수 기준 미달** → `save-record` 가 자동으로 큐에 올림)
- **재시 통과 기준(%)·만점 → `lib/retest.js` 맨 위 두 줄** (`PASS_DEFAULT`=80, `FULL_DEFAULT`=0)
  환경변수 `RETEST_PASS_PERCENT`/`VOCA_FULL_SCORE` 가 있으면 그게 이깁니다.
  `FULL_DEFAULT`=0 은 **「18」처럼 만점 없이 적은 점수는 판정하지 않는다**는 뜻 —
  18점인지 18/20인지 모르는 채로 학부모에게 재시 카톡을 보내는 게 더 나쁩니다.
- 학생앱 화면·문구 → `student.html` / 학생앱이 주는 데이터 → `api/student.js`
- 선생님앱 화면 → `teacher.html` / 과제 내주기·현황 → `api/attendance.js` 의 `save-tasks`·`tasks`
- 담당 선생님 범위 → 학생DB의 `teacher` 칸. API는 `&teacher=이선생` 을 붙이면 그 선생님 것만
  (`students`·`board`·`daily-rows`·`tasks`·`send-daily` 가 지원)
- 진도 자동 전환 규칙 → `lib/progress.js` 의 `advanceProgress()`
- 지각 유예·판정, 곧 하원 기준 → `api/attendance.js` 의 `GRACE`, `LEAVE_SOON`, `lateness()`
- 화면 디자인·문구 → 루트의 `*.html`
- cron 시각 → `vercel.json` (UTC 기준, KST=UTC+9)
- 과목·데이터 구조 → `books`/`progress`/`schedule` 은 jsonb라 컬럼 추가 없이 키만 늘리면 됨

## 알림톡(솔라피) — 메이크 없이 Vercel에서 직접
`lib/solapi.js` 가 HMAC 서명 + send-many 호출을 담당. 미설정이면 조용히 skip(다른 기능 영향 없음).

발송 지점: 등원(`checkin`) · **하원(키오스크 `checkin` 두 번째 터치 — 현황판 `checkout`은 발송 안 함)** · 미등원(`notify-absent`, 수동) · 데일리 리포트(`send-daily`) · **재시 안내(`send-retest`, 수동)** · 월말평가서(report.js `send`).
템플릿 ID는 환경변수 `TPL_CHECKIN`/`TPL_CHECKOUT`/`TPL_LATE`/`TPL_DAILY`/`TPL_REPORT`/`TPL_RETEST`(재시 안내).

## 과제(tasks) 와 과제등급(homework) 은 다른 것 ★
헷갈리기 쉬워서 못 박아둡니다.
- `tasks` 테이블 = **학생이 체크하는 할 일 목록**. 선생님앱에서 내주고 학생앱에서 체크.
- `daily_records.homework` = **선생님이 매기는 수행 등급**(100%완료/상/중/하). 학부모 카톡·월말평가서에 들어감.
"오늘 과제 안 한 학생" 같은 요청이 오면 어느 쪽인지 먼저 확인하세요.

## 규칙
- 실제 학생 이름·전화번호·API 키를 커밋하지 말 것 (샘플은 가짜).
- **SQL 에서 "오늘" 은 `(now() at time zone 'Asia/Seoul')::date`** — `current_date` 를 쓰지 말 것.
  Supabase 서버는 UTC 라 밤 12시~아침 9시(KST)에 돌리면 샘플이 하루 전 날짜로 들어갑니다
  (앱은 전부 `lib/time.js` 의 KST 로 "오늘" 을 판단).
- 한국어 주석 유지. 수정 후 실제 화면을 열어 동작 확인.
- 기능을 고쳤으면 `node scripts/smoke-test.mjs` 를 돌려 전부 ✅ 인지 확인(실제 DB 없이 돌아감).
- **배포 전·세미나 전에는 `bash scripts/verify/verify.sh`** — 진짜 PostgreSQL + 진짜 브라우저로
  SQL·스키마·전 API·전 화면을 한 번에 검사합니다. 마지막 줄이 `✅ 전면 검수 통과` 여야 합니다.
  기능을 추가했으면 `scripts/verify/e2e-api.mjs`·`browser-check.mjs` 에 점검도 같이 추가하세요.
- **커밋 전 `node scripts/check-personal.mjs`** — 실제 키·노션 DB ID·휴대폰 번호·학원 실명이
  코드에 남았는지 봅니다. 위험이 있으면 exit 1. 샘플이라면 그 줄에 '샘플/가짜/예시' 를 적으면 통과.
