# 올인원 학원 시스템 (Vercel + Supabase + Claude)

실사용 중인 학원 운영 시스템의 **핵심 3기능 + 학생앱 · 선생님앱**을 바이브 코딩 스택으로 옮긴 실습 템플릿.
노션·앱스크립트 없이, **SQL 붙여넣기 1번 + 환경변수 입력**으로 전부 돌아갑니다.
(학생DB·교재DB 구조는 2차 세미나(앱스크립트)에서 배포한 학생용 템플릿을 그대로 따릅니다.)

**핵심 3기능**
| # | 기능 | 화면/동작 |
|---|------|----------|
| ① | **데일리 리포트 (작성·보내기)** | `daily.html` — 오늘 등원 판단 → 다음 진도 자동 적용해 생성 → 진도·태도·과제·단어테스트 작성(자동 저장) → 📨 학부모 카톡 발송 |
| ② | **출석 현황판** | `board.html` — 등원·곧 하원·하원·미등원 실시간 + 하원 처리(카톡 X) + 미등원 알림톡 |
| ③ | **월말평가서** | `report.html`(AI 생성·수정·저장) → `parent.html`(학부모 열람). 앱스크립트가 아니라 Vercel에서 실행 |

**같이 돌아가는 앱 2개**
| 앱 | 화면 | 누가 쓰나 |
|---|---|---|
| **학생앱** | `student.html` | 학생이 **폰**으로 — 학생ID+출결PIN 로그인 → 오늘 과제 체크 · 내 진도 · 최근 수업기록 · 월말평가서 열람 |
| **선생님앱** | `teacher.html` | 선생님이 — **내 담당 학생만** 현황판 + **과제 내주기**(진도로 자동 채우기) + 체크 현황 |

> 담당 구분은 학생DB의 **담당 선생님**(`students.teacher`) 칸. `daily.html?teacher=이선생` 처럼
> 주소에 붙이면 데일리 리포트 작성·발송도 담당 학생만 됩니다.
> 학생앱 로그인은 **2차 세미나부터 쓰던 학생ID + 출결PIN** 그대로라 새로 만들 게 없어요.

**받쳐주는 기능**
- **학생 카드 `student_card.html`** — 한 학생의 **지난 진도·테스트·과제를 1주/1달/3달로 쭉**.
  과목별 흐름(`Unit 2 → Unit 3 ×11 → Unit 4` — ×가 큰 칸이 멈춘 자리) + 날짜별 표.
  데일리 리포트·학생관리·현황판·선생님앱에서 **학생 이름을 누르면** 열립니다.
- **재시 안내 카톡** — 단어테스트를 「불통과」로 누르거나 **점수만 「12/20」처럼 적어도**(기준 80% 미달)
  `🔁 재시 안내 (n)` 버튼이 자동으로 뜸 (`TPL_RETEST`). 기준은 `lib/retest.js` 맨 위 한 줄
- 출결 키오스크 `kiosk.html` — PIN 등·하원 (등원 알림톡 자동)
- 교재·목차 `books.html` — 목차를 넣으면 데일리 리포트 진도가 다음 목차로 자동 전환
- 학생 관리 `students.html` · 매일 새벽 `api/cron.js` 로 오늘 리포트 행 미리 생성
- 카카오 알림톡(선택) — 솔라피 직접 연동(메이크 없음)

> ⚠️ 실제 학생 이름·전화번호를 코드/DB에 넣지 마세요. 샘플은 전부 가짜입니다.

---

## 설치 (약 15분)

### 1. 이 템플릿 복제 — GitHub **Use this template**

템플릿 저장소: **https://github.com/nauta325/academy-system**

### 2. Supabase
1. 새 프로젝트 생성 → **SQL Editor** 에 `sql/setup.sql` 전체 붙여넣기 → **Run**
   (테이블 6개 + 샘플 학생/기록/과제가 한 번에 생성)
2. **Settings → API**: `Project URL` → `SUPABASE_URL`, `service_role` 키 → `SUPABASE_SERVICE_KEY`

### 3. Vercel
1. **Add New → Project** → 이 리포 Import
2. **Environment Variables**:

| 변수 | 값 | 필수 |
|------|-----|------|
| `SUPABASE_URL` | Supabase Project URL | ✅ |
| `SUPABASE_SERVICE_KEY` | service_role 키 (secret) | ✅ |
| `ANTHROPIC_API_KEY` | Claude 키 (월말평가서 생성용) | 선택 |
| `CRON_SECRET` | cron 보호용 임의 문자열 | 선택 |
| `ACADEMY_NAME` | 학원 이름 — 넣으면 `config.js` 보다 **이것이 이김** | 선택 |
| `BRAND_COLOR` | 대표 색 (예 `#1f7a70`) — 같이 `config.js` 보다 우선 | 선택 |

> 💡 `ACADEMY_NAME`/`BRAND_COLOR` 는 **코드에 학원 이름을 넣지 않고** 내 학원으로 띄우기 위한 것입니다.
> 수강생은 `config.js` 두 줄을 고치는 게 기본(그게 첫 실습)이고, 이 환경변수는 선택입니다.

**알림톡을 쓸 경우(선택)** — 솔라피 가입 + 카카오 채널 연동 + 템플릿 5종 검수 후
(1·2차 세미나에서 등록한 템플릿은 **그대로 재사용** — 1차=데일리리포트, 2차=나머지 4종):

| 변수 | 값 |
|------|-----|
| `SOLAPI_API_KEY` / `SOLAPI_API_SECRET` | 솔라피 API 키/시크릿 |
| `SOLAPI_SENDER` | 등록한 발신번호 |
| `SOLAPI_PFID` | 카카오 채널 pfId |
| `TPL_CHECKIN` / `TPL_CHECKOUT` / `TPL_LATE` / `TPL_DAILY` / `TPL_REPORT` / `TPL_RETEST` | 검수 통과한 템플릿 ID (등원·하원·미등원·데일리리포트·월말평가서·**재시 안내**) |

> 알림톡 미설정이면 등원·미등원·데일리리포트·평가서 발송은 조용히 건너뛰고 **나머지 전 기능은 정상 동작**해요.
> 데일리리포트 템플릿 변수(1차 세미나 템플릿 그대로 동작):
> `#{학생이름}#{날짜}#{과제}#{태도}#{지각}#{단어테스트}#{추가사항}`
> + 과목별 `#{리딩교재}#{리딩진도}#{문법교재}#{문법진도}#{단어교재}#{단어진도}` (`#{진도}` 한 줄 요약도 함께 보냄)
> - `#{과목진도}` 에는 **유닛 제목까지** 들어갑니다 — `CH1-1 be동사`. 목차에 제목을 안 넣으면 코드만(`CH1-1`).
>   코드·제목을 줄을 나눠 쓰고 싶으면 `#{과목유닛}`(코드만)·`#{과목제목}`(제목만)도 함께 나갑니다.
> 과목은 고정이 아니라 `books`/`progress` 의 **실제 키**로 만들어져요 — 수학학원이면 `#{연산교재}` `#{교과진도}` 가 그대로 채워집니다.

3. **Deploy** → `https://내프로젝트.vercel.app/` 접속 (홈에서 각 화면으로 이동)

> ⚠️ **이미 실제 학생 데이터가 들어 있다면 `setup.sql` 을 다시 돌리지 마세요** — 맨 앞의
> `drop table` 때문에 데이터가 사라집니다. 대신 아래 마이그레이션만 SQL Editor 에 Run 하세요.
> - `sql/migrate_daily_report.sql` — 2차 DB 속성(단어점수·추가사항·교재 스냅샷 등) 반영
> - `sql/migrate_tasks.sql` — **학생앱·선생님앱용 `tasks` 테이블 추가** (+ 학생ID·PIN·담당 비어있는 학생 점검)
> - `sql/migrate_retest.sql` — **재시 안내용 `daily_records.retest_sent` 칸 추가**

### DB 속성 (2차 세미나 노션 DB 이관 대응)
2차 세미나의 전체학생/데일리리포트/교재 DB 속성을 그대로 담습니다 — 노션에 쌓아둔 데일리리포트를 옮겨 월말평가서까지 생성 가능.
- **students**: 이름·학생ID(`student_code`)·PIN·전화·학년·담당·수업시간·재원상태·요일별 등원시간(`schedule`)·현재 교재(`books`)
- **daily_records**: 날짜·등하원시간·지각(정시등원/지각/결석)·태도·과제(100%완료/상/중/하)·단어테스트(결과+점수)·진도(`progress`)·그날 교재 스냅샷(`books`, 교재 전환 감지용)
- **textbooks**: 교재명·종류·가격·누적수량·배포수량 + **목차(`units`)** — 각 유닛은 `{ "code":"Unit 1", "title":"be동사" }` (유닛 번호와 실제 제목 분리). 데일리 리포트에서 유닛을 바꾸면 제목이 자동으로 붙습니다.
- **monthly_comments**: 참고사항 + 중학생(내신) · **monthly_reports**: 본문·통계·최종진도·열람토큰·카톡전송
- **tasks**(추가): 학생앱 과제 체크리스트 — 학생·날짜·구분(학원/집)·과목·내용·완료여부.
  `daily_records.homework`(선생님이 매기는 상/중/하)와는 **다른 것**입니다 — 이건 학생이 볼 '할 일 목록'.

> `vercel.json` 에 매일 새벽(UTC 20:00 = KST 05:00) `api/cron` 자동 실행이 등록돼 있어요 —
> 오늘 등원 예정 학생의 데일리리포트 행을 미리 만들고 진도를 전날 값으로 채웁니다(캐리포워드).

---

## 하루 흐름
```
새벽   cron    → 오늘 등원 예정 학생 데일리리포트 행 자동 생성 (다음 진도 자동 적용)
등원   kiosk   → 학생 PIN → 등원 기록 (지각 자동 판정) + 등원 알림톡
수업중 board   → 출석 현황판: 등원·곧 하원·하원·미등원 실시간, 하원 처리·미등원 알림톡
수업중 teacher → 선생님앱: 내 담당 학생만 보고, 오늘 진도로 과제 내주기
하원후 daily   → 데일리 리포트: 진도·태도·과제·단어테스트 작성(자동 저장) → 📨 학부모 카톡
집에서 student → 학생앱: 과제 체크(선생님 화면에 바로 반영) · 내 진도 확인
월말   report  → 월 선택 → 통계 집계 → AI 평가서 → 수정·저장 → 학부모 링크
학부모 parent  → 토큰 링크로 자기 아이 리포트만 열람
```

## 바이브 코딩 — "말해서 바꾸기" 예시
| 말하기 | 바뀌는 곳 |
|--------|-----------|
| "평가서 어투 더 따뜻하게" / "모델 opus로" | `lib/claude.js` |
| "지각은 노란색으로" | `board.html` 카드 스타일 |
| "토요일도 수업해" | 학생관리의 요일 + 스키마(schedule은 자유 키) |
| "미등원 20분 뒤 알림" | `api/attendance.js`/`api/cron.js` 판정 |
| "등원 알림톡 자동 발송" | `api/attendance.js` 의 checkin (솔라피 붙이기) |
| "수학 과목 추가" | books/progress는 jsonb — 스키마 변경 없이 키만 추가 |
| "학생앱에 칭찬 스티커 붙여줘" | `student.html` (가장 좋은 첫 실습 — 결과가 바로 보임) |
| "과제 안 한 학생만 모아 보여줘" | `teacher.html` 의 `renderTasks()` |
| "학생도 자기 평가서 못 보게 해줘" | `api/student.js` 의 `reports` 부분 삭제 |

## 폴더 구조
```
sql/setup.sql        테이블 + 샘플 (SQL Editor 1회 실행)
vercel.json          매일 새벽 cron 등록
api/attendance.js    학생·교재관리 · PIN 등하원 · 현황판 · 데일리 리포트 행/저장/발송 · 진도 자동 채우기
api/report.js        월별 통계 · AI 평가서 · 저장 · 학부모 열람
api/student.js       학생앱 — 학생ID+PIN 확인 · 오늘 과제 · 내 진도 · 과제 체크
api/cron.js          데일리리포트 자동생성 (교재 목차 기반 진도 자동 전환)
lib/db.js            Supabase REST 헬퍼
lib/claude.js        Claude 호출 + 평가서 프롬프트(어투·모델)
lib/progress.js      교재 목차 → 다음 진도 자동 계산
lib/solapi.js        솔라피 알림톡(등원·미등원·데일리·월말)
lib/time.js          한국시간 헬퍼
index.html           홈(화면 이동)
daily.html           데일리 리포트 (작성 + 학부모 카톡 보내기) ★
board.html           출석 현황판 (등원·곧 하원·하원·미등원) ★
report.html          월말평가서(선생님) ★
kiosk.html           출결 키오스크 (PIN 등·하원)
students.html        학생 관리
books.html           교재 · 목차 관리 (진도 자동 전환의 원천)
student_card.html    학생 카드 (한 학생의 지난 진도·테스트·과제 쭉) ★
parent.html          월말평가서(학부모 열람)
teacher.html         선생님앱 (담당 학생 현황 + 과제 내주기) ★
student.html         학생앱 (학생이 폰으로 — 과제 체크·내 진도) ★
scripts/smoke-test.mjs  (선택) API 자체 점검 — Supabase 없이 `node scripts/smoke-test.mjs`
```

## 자체 점검
```bash
bash scripts/verify/verify.sh    # ★ 전면 검수 — 진짜 DB+브라우저로 SQL·API·전 화면
node scripts/smoke-test.mjs        # API 로직 27항목 (실제 DB 없이 돌아감)
node scripts/check-personal.mjs    # ★ 커밋 전 — 개인정보·실키 유출 점검
```
- `smoke-test.mjs` — "학생이 남의 과제를 바꿀 수 있나" 같은 **보안 점검까지** 포함.
  클로드에게 **"기능 추가했으니 smoke-test.mjs 에 점검도 추가해줘"** 라고 하면 같이 늘려줍니다.
- `check-personal.mjs` — 실제 키·노션 DB ID·솔라피 pfId·휴대폰 번호·학원 실명이 코드에
  남았는지 찾습니다. `--staged` 를 붙이면 `git add` 한 것만 봅니다.
  내 학원 것으로 돌려본 뒤 커밋하기 전에 꼭 한 번 돌리세요.
