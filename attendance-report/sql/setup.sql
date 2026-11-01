-- ============================================================
-- 학원 자동화 (Vercel + Supabase 판) — 셋업 SQL
-- 2차 세미나(노션 + 앱스크립트)의 DB 속성을 그대로 이식 — 노션 데이터 이관 가능:
--   전체학생DB / 데일리리포트DB / 교재DB / 월말참고사항DB / 월말평가서DB
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번이면 끝.
--
-- ⚠️ 실제 학생 이름·전화번호는 넣지 마세요. 아래 샘플은 전부 가짜입니다.
-- ============================================================

drop table if exists tasks cascade;
drop table if exists monthly_reports cascade;
drop table if exists monthly_comments cascade;
drop table if exists daily_records cascade;
drop table if exists textbooks cascade;
drop table if exists students cascade;

-- ── 전체학생DB ────────────────────────────────────────────
create table students (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                -- 학생이름
  student_code  text,                         -- 학생ID (예: nauta01) — 노션 이관용
  pin           text,                         -- 출결PIN (키오스크 등·하원)
  phone         text,                         -- 전화번호 (학부모 알림톡용)
  grade         text,                         -- 학년 (예: 중2)
  school        text,                         -- 학교 (예: 새봄중학교) — 내신 대비·반 편성에 씁니다
  teacher       text,                         -- 담당 선생님
  class_minutes int  not null default 120,    -- 수업시간(분) → 예상 하원시간 계산
  status        text not null default '재원',  -- 재원상태: 재원 / 퇴원
  -- 요일별 등원 예정시간 {"월":"17:00","화":"","수":"17:00",...} (빈값=그날 수업 없음)
  schedule      jsonb not null default '{}',
  -- 현재 교재(문법/리딩/단어 교재 Relation) {"문법":"...", "리딩":"...", "단어":"..."}
  books         jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

-- ── 데일리리포트DB (매일 한 줄) ───────────────────────────
create table daily_records (
  id         uuid not null default gen_random_uuid() primary key,
  student_id uuid not null references students(id) on delete cascade, -- 학생이름 Relation
  date       date not null,                -- 날짜
  check_in   text,                         -- 실제 등원시간 HH:MM
  check_out  text,                         -- 실제 하원시간 HH:MM
  lateness   text,                         -- 지각: 정시등원 / 지각 / 결석
  attitude   text not null default '상',    -- 태도: 상 / 중 / 하
  homework   text not null default '상',    -- 과제: 100%완료 / 상 / 중 / 하
  voca_test  text,                         -- 단어테스트_결과: 통과 / 불통과
  voca_score text,                         -- 단어테스트 점수 (예: 18/20)
  -- 과목별 진도 {"문법":{"code":"Unit 5","title":"현재완료"}, ...}  (유닛 코드 + 실제 제목)
  progress   jsonb not null default '{}',
  -- 그날의 교재 스냅샷(학생DB에서 복사) {"문법":"교재명",...} — 교재 전환 감지용
  books      jsonb not null default '{}',
  note        text,                        -- 지적사항 (내부 기록, 학부모에게 안 나감)
  parent_note text,                        -- 추가사항 (데일리 리포트 카톡에 나가는 내용)
  kakao_sent  text not null default '미전송', -- 등원 알림톡 상태: 미전송/전송/실패
  report_sent text not null default '미전송', -- 데일리 리포트 카톡 상태
  -- 재시 안내 카톡 상태 (빈값=보낼 일 없음 / 미전송=발송 대기 / 전송=보냄)
  -- 단어테스트를 '불통과'로 저장하면 서버가 '미전송'으로 자동 올립니다 (api/attendance.js)
  retest_sent text,
  created_at timestamptz not null default now(),
  unique (student_id, date)
);

-- ── 월말참고사항DB (선생님 코멘트) ────────────────────────
create table monthly_comments (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade, -- 학생 Relation
  month        text not null,               -- 연월 'YYYY-MM'
  comment      text,                        -- 참고사항
  middle_school boolean not null default false, -- 중학생(내신 대비)
  unique (student_id, month)
);

-- ── 월말평가서DB (AI 생성 결과) ───────────────────────────
create table monthly_reports (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  month       text not null,              -- 연월 'YYYY-MM'
  body        text,                       -- 평가서본문
  stats       jsonb not null default '{}',-- 수업일수/단어통과율/과제상비율/태도상비율 등
  progress    jsonb not null default '{}',-- 문법/리딩/단어 최종진도 {과목:{교재명,유닛코드,제목}}
  share_token text not null unique default replace(gen_random_uuid()::text, '-', ''), -- 열람링크 토큰
  kakao_sent  boolean not null default false, -- 카톡전송
  created_at  timestamptz not null default now(), -- 생성일
  updated_at  timestamptz not null default now(),
  unique (student_id, month)
);

-- ── 교재DB (교재비·재고 관리 + 목차/진도) ─────────────────
-- 2차: 교재명(제목)·종류·가격·수량·재고. 여기에 목차(units)+하루진도(step)를 더해 진도 자동화까지.
create table textbooks (
  id           uuid primary key default gen_random_uuid(),
  subject      text,                        -- 종류: 문법 / 리딩 / 단어
  name         text not null unique,        -- 교재명 (학생 books 값과 일치해야 연결됨)
  price        int,                         -- 가격
  stock_total  int,                         -- 누적 교재 수량
  distributed  int  not null default 0,     -- 배포된 수량 (재고 = 누적 - 배포)
  -- 목차 [{ "code":"Unit 1", "title":"be동사" }, ...] — 순서대로 진도 전환
  units        jsonb not null default '[]',
  step         int  not null default 1,     -- 하루(수업) 진도 = 넘길 유닛 수
  created_at   timestamptz not null default now()
);

-- ── 과제DB (학생앱 체크리스트) ────────────────────────────
-- 선생님이 내주고(teacher.html) 학생이 체크한다(student.html).
-- daily_records.homework 는 선생님이 매기는 '상/중/하' 한 칸이고, 이건 학생이 볼 '할 일 목록'.
create table tasks (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  date       date not null,                  -- 해야 하는 날
  kind       text not null default '집',      -- 학원 / 집
  subject    text,                           -- 과목 (선택 — 비워도 됨)
  title      text not null,                  -- 과제 내용 (예: "Unit 5 워크북 p.42~45")
  done       boolean not null default false, -- 학생이 체크했는지
  done_at    timestamptz,                    -- 체크한 시각
  -- 교재 목차의 유닛에 적어둔 과제에서 **저절로** 만들어진 것인지.
  --   true  = 진도가 그 유닛에 닿아서 생긴 것 → 진도가 바뀌면 지우고 다시 만듭니다
  --   false = 선생님이 손으로 낸 것 → 절대 자동으로 지우지 않습니다
  auto       boolean not null default false,
  created_at timestamptz not null default now()
);

create index on daily_records (date);
create index on daily_records (student_id, date);
create index on monthly_reports (month);
create index on tasks (student_id, date);
create index on tasks (date);

-- 모든 접근은 서버(api/*.js)가 service_role 키로 처리 → RLS on, 공개정책 없음(안전).
alter table students         enable row level security;
alter table daily_records    enable row level security;
alter table monthly_comments enable row level security;
alter table monthly_reports  enable row level security;
alter table textbooks        enable row level security;
alter table tasks            enable row level security;

-- ============================================================
-- ★ service_role 권한 부여 (이거 빠지면 세미나 당일 다 막힙니다)
--   실제 사고: 미니 원서 앱 세미나 때 이게 없어서 42501(permission denied)로
--   학생 로그인·관리자 화면이 전부 막혔습니다. 반드시 같이 돌아가야 합니다.
--   RLS 는 켜 두고(공개 정책 없음), 서버(api/*.js)만 service_role 로 접근합니다.
-- ============================================================
grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
-- 앞으로 만들 표에도 자동으로 권한이 붙게
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;


-- ============================================================
-- 샘플 데이터 (전부 가짜 이름). 붙여넣자마자 화면이 돕니다.
-- ============================================================
insert into students (name, student_code, pin, phone, grade, school, teacher, class_minutes, schedule, books) values
-- 12명입니다. 3명이면 현황판·데일리 리포트가 휑해서 실제 느낌이 안 납니다.
-- 요일은 **주말까지** 깔아둡니다 — 토·일에 수업하는 학원도 있고,
-- 무슨 요일에 설치하든 화면이 비지 않게 하려는 것입니다 (평일 7명 · 주말 4명).
-- 연락처는 전부 가짜(010-0000-00XX)입니다. 학생 관리 화면에서 바꿔 쓰세요.
  -- ★ 김민준은 **모든 요일**에 수업이 있습니다. 핸드아웃·교재·키오스크 안내가 전부
  --    이 학생을 예시로 들기 때문입니다 — 무슨 요일에 설치하든 「demo01 / 1111 로
  --    로그인해서 과제를 체크해 보세요」 가 되어야 합니다.
  --    (세미나 당일이 일요일인데 월~금만 넣어뒀다가, 그날 이 학생은 오늘 행도 과제도
  --     없어서 학생앱이 텅 비는 걸 리허설에서 발견했습니다.)
  ('김민준', 'demo01', '1111', '010-0000-0001', '중2', '새봄중학교', '이선생', 120,  -- 가짜 번호 (샘플)
   '{"월":"17:00","화":"17:00","수":"17:00","목":"17:00","금":"17:00","토":"17:00","일":"17:00"}',
   '{"문법":"그래머 인사이드 1","리딩":"리딩튜터 주니어 1","단어":"능률 VOCA 입문"}'),
  ('이서연', 'demo02', '2222', '010-0000-0002', '중3', '푸른중학교', '이선생', 150,  -- 가짜 번호 (샘플)
   '{"월":"18:00","화":"","수":"18:00","목":"","금":"18:00","토":"18:00","일":"18:00"}',
   '{"문법":"그래머 인사이드 3","리딩":"리딩튜터 주니어 3","단어":"능률 VOCA 실력"}'),
  ('박도윤', 'demo03', '3333', '010-0000-0003', '초6', '샛별초등학교', '박선생', 90,  -- 가짜 번호 (샘플)
   '{"월":"","화":"16:00","수":"","목":"16:00","금":"","토":"16:00","일":"16:00"}',
   '{"문법":"그래머 인사이드 2","리딩":"리딩튜터 주니어 2","단어":"능률 VOCA 기본"}'),
  ('최지우', 'demo04', '4444', '010-0000-0004', '중1', '새봄중학교', '이선생', 120,  -- 가짜 번호 (샘플)
   '{"월":"17:00","화":"","수":"17:00","목":"","금":"17:00","토":"17:00","일":"17:00"}',
   '{"문법":"그래머 인사이드 1","리딩":"리딩튜터 주니어 1","단어":"능률 VOCA 입문"}'),
  ('정하윤', 'demo05', '5555', '010-0000-0005', '중2', '푸른중학교', '이선생', 120,  -- 가짜 번호 (샘플)
   '{"월":"","화":"18:00","수":"","목":"18:00","금":"","토":"18:00","일":"18:00"}',
   '{"문법":"그래머 인사이드 3","리딩":"리딩튜터 주니어 3","단어":"능률 VOCA 실력"}'),
  ('강서준', 'demo06', '6666', '010-0000-0006', '초5', '한빛초등학교', '박선생', 90,  -- 가짜 번호 (샘플)
   '{"월":"16:00","화":"","수":"16:00","목":"","금":"16:00","토":"","일":""}',
   '{"문법":"그래머 인사이드 2","리딩":"리딩튜터 주니어 2","단어":"능률 VOCA 기본"}'),
  ('윤아린', 'demo07', '7777', '010-0000-0007', '중1', '새봄중학교', '박선생', 120,  -- 가짜 번호 (샘플)
   '{"월":"","화":"17:00","수":"","목":"17:00","금":"","토":"17:00","일":"17:00"}',
   '{"문법":"그래머 인사이드 1","리딩":"리딩튜터 주니어 1","단어":"능률 VOCA 입문"}'),
  ('임지호', 'demo08', '8888', '010-0000-0008', '중3', '푸른중학교', '이선생', 150,  -- 가짜 번호 (샘플)
   '{"월":"19:00","화":"19:00","수":"19:00","목":"19:00","금":"19:00","토":"","일":""}',
   '{"문법":"그래머 인사이드 3","리딩":"리딩튜터 주니어 3","단어":"능률 VOCA 실력"}'),
  ('한예은', 'demo09', '9999', '010-0000-0009', '초6', '샛별초등학교', '박선생', 90,  -- 가짜 번호 (샘플)
   '{"월":"16:00","화":"","수":"16:00","목":"","금":"16:00","토":"16:00","일":""}',
   '{"문법":"그래머 인사이드 2","리딩":"리딩튜터 주니어 2","단어":"능률 VOCA 기본"}'),
  ('오시우', 'demo10', '1212', '010-0000-0010', '중2', '새봄중학교', '이선생', 120,  -- 가짜 번호 (샘플)
   '{"월":"","화":"18:00","수":"","목":"18:00","금":"","토":"18:00","일":"18:00"}',
   '{"문법":"그래머 인사이드 1","리딩":"리딩튜터 주니어 1","단어":"능률 VOCA 입문"}'),
  ('신채원', 'demo11', '2323', '010-0000-0011', '중1', '푸른중학교', '박선생', 120,  -- 가짜 번호 (샘플)
   '{"월":"17:00","화":"","수":"17:00","목":"","금":"17:00","토":"","일":"17:00"}',
   '{"문법":"그래머 인사이드 1","리딩":"리딩튜터 주니어 1","단어":"능률 VOCA 입문"}'),
  ('배건우', 'demo12', '3434', '010-0000-0012', '초5', '한빛초등학교', '박선생', 90,  -- 가짜 번호 (샘플)
   '{"월":"","화":"16:00","수":"","목":"16:00","금":"","토":"","일":"16:00"}',
   '{"문법":"그래머 인사이드 2","리딩":"리딩튜터 주니어 2","단어":"능률 VOCA 기본"}');

-- 교재DB — 목차는 {code(유닛번호), title(실제 제목)} (코드와 제목이 다름을 보여줌) + 가격/수량
insert into textbooks (subject, name, price, stock_total, distributed, units) values
  ('문법','그래머 인사이드 1', 15000, 30, 12, '[{"code": "CH1-1", "title": "be동사", "집과제": ["워크북 CH1-1 풀기"], "학원과제": "CH1-1 개념 정리 노트"}, {"code": "CH1-2", "title": "일반동사", "집과제": ["워크북 CH1-2 풀기"], "학원과제": "CH1-2 개념 정리 노트"}, {"code": "CH1-3", "title": "현재진행형", "집과제": ["워크북 CH1-3 풀기"], "학원과제": "CH1-3 개념 정리 노트"}, {"code": "CH1-4", "title": "과거시제", "집과제": ["워크북 CH1-4 풀기"], "학원과제": "CH1-4 개념 정리 노트"}, {"code": "CH1-복습", "title": "CH1 복습", "집과제": [], "학원과제": "CH1 복습 문제풀이"}, {"code": "CH2-1", "title": "미래시제", "집과제": ["워크북 CH2-1 풀기"], "학원과제": "CH2-1 개념 정리 노트"}, {"code": "CH2-2", "title": "현재완료", "집과제": ["워크북 CH2-2 풀기"], "학원과제": "CH2-2 개념 정리 노트"}, {"code": "CH2-3", "title": "조동사 can·may", "집과제": ["워크북 CH2-3 풀기"], "학원과제": "CH2-3 개념 정리 노트"}, {"code": "CH2-4", "title": "조동사 must·should", "집과제": ["워크북 CH2-4 풀기"], "학원과제": "CH2-4 개념 정리 노트"}, {"code": "CH2-복습", "title": "CH2 복습", "집과제": [], "학원과제": "CH2 복습 문제풀이"}, {"code": "CH3-1", "title": "명사와 관사", "집과제": ["워크북 CH3-1 풀기"], "학원과제": "CH3-1 개념 정리 노트"}, {"code": "CH3-2", "title": "대명사", "집과제": ["워크북 CH3-2 풀기"], "학원과제": "CH3-2 개념 정리 노트"}, {"code": "CH3-3", "title": "형용사", "집과제": ["워크북 CH3-3 풀기"], "학원과제": "CH3-3 개념 정리 노트"}, {"code": "CH3-4", "title": "부사", "집과제": ["워크북 CH3-4 풀기"], "학원과제": "CH3-4 개념 정리 노트"}, {"code": "CH3-복습", "title": "CH3 복습", "집과제": [], "학원과제": "CH3 복습 문제풀이"}, {"code": "CH4-1", "title": "비교급", "집과제": ["워크북 CH4-1 풀기"], "학원과제": "CH4-1 개념 정리 노트"}, {"code": "CH4-2", "title": "최상급", "집과제": ["워크북 CH4-2 풀기"], "학원과제": "CH4-2 개념 정리 노트"}, {"code": "CH4-3", "title": "의문사", "집과제": ["워크북 CH4-3 풀기"], "학원과제": "CH4-3 개념 정리 노트"}, {"code": "CH4-4", "title": "명령문과 청유문", "집과제": ["워크북 CH4-4 풀기"], "학원과제": "CH4-4 개념 정리 노트"}, {"code": "CH4-복습", "title": "CH4 복습", "집과제": [], "학원과제": "CH4 복습 문제풀이"}, {"code": "CH5-1", "title": "접속사", "집과제": ["워크북 CH5-1 풀기"], "학원과제": "CH5-1 개념 정리 노트"}, {"code": "CH5-2", "title": "전치사", "집과제": ["워크북 CH5-2 풀기"], "학원과제": "CH5-2 개념 정리 노트"}, {"code": "CH5-3", "title": "There is/are", "집과제": ["워크북 CH5-3 풀기"], "학원과제": "CH5-3 개념 정리 노트"}, {"code": "CH5-4", "title": "감각동사", "집과제": ["워크북 CH5-4 풀기"], "학원과제": "CH5-4 개념 정리 노트"}, {"code": "CH5-복습", "title": "CH5 복습", "집과제": [], "학원과제": "CH5 복습 문제풀이"}]'),
  ('문법','그래머 인사이드 2', 16000, 25, 10, '[{"code": "CH1-1", "title": "시제 종합", "집과제": ["워크북 CH1-1 풀기"], "학원과제": "CH1-1 개념 정리 노트"}, {"code": "CH1-2", "title": "현재완료진행", "집과제": ["워크북 CH1-2 풀기"], "학원과제": "CH1-2 개념 정리 노트"}, {"code": "CH1-3", "title": "과거완료", "집과제": ["워크북 CH1-3 풀기"], "학원과제": "CH1-3 개념 정리 노트"}, {"code": "CH1-4", "title": "수동태 기초", "집과제": ["워크북 CH1-4 풀기"], "학원과제": "CH1-4 개념 정리 노트"}, {"code": "CH1-복습", "title": "CH1 복습", "집과제": [], "학원과제": "CH1 복습 문제풀이"}, {"code": "CH2-1", "title": "수동태 심화", "집과제": ["워크북 CH2-1 풀기"], "학원과제": "CH2-1 개념 정리 노트"}, {"code": "CH2-2", "title": "조동사 심화", "집과제": ["워크북 CH2-2 풀기"], "학원과제": "CH2-2 개념 정리 노트"}, {"code": "CH2-3", "title": "to부정사 용법", "집과제": ["워크북 CH2-3 풀기"], "학원과제": "CH2-3 개념 정리 노트"}, {"code": "CH2-4", "title": "동명사 용법", "집과제": ["워크북 CH2-4 풀기"], "학원과제": "CH2-4 개념 정리 노트"}, {"code": "CH2-복습", "title": "CH2 복습", "집과제": [], "학원과제": "CH2 복습 문제풀이"}, {"code": "CH3-1", "title": "분사", "집과제": ["워크북 CH3-1 풀기"], "학원과제": "CH3-1 개념 정리 노트"}, {"code": "CH3-2", "title": "분사구문", "집과제": ["워크북 CH3-2 풀기"], "학원과제": "CH3-2 개념 정리 노트"}, {"code": "CH3-3", "title": "관계대명사", "집과제": ["워크북 CH3-3 풀기"], "학원과제": "CH3-3 개념 정리 노트"}, {"code": "CH3-4", "title": "관계부사", "집과제": ["워크북 CH3-4 풀기"], "학원과제": "CH3-4 개념 정리 노트"}, {"code": "CH3-복습", "title": "CH3 복습", "집과제": [], "학원과제": "CH3 복습 문제풀이"}, {"code": "CH4-1", "title": "명사절", "집과제": ["워크북 CH4-1 풀기"], "학원과제": "CH4-1 개념 정리 노트"}, {"code": "CH4-2", "title": "부사절", "집과제": ["워크북 CH4-2 풀기"], "학원과제": "CH4-2 개념 정리 노트"}, {"code": "CH4-3", "title": "가정법 과거", "집과제": ["워크북 CH4-3 풀기"], "학원과제": "CH4-3 개념 정리 노트"}, {"code": "CH4-4", "title": "가정법 과거완료", "집과제": ["워크북 CH4-4 풀기"], "학원과제": "CH4-4 개념 정리 노트"}, {"code": "CH4-복습", "title": "CH4 복습", "집과제": [], "학원과제": "CH4 복습 문제풀이"}, {"code": "CH5-1", "title": "비교 구문", "집과제": ["워크북 CH5-1 풀기"], "학원과제": "CH5-1 개념 정리 노트"}, {"code": "CH5-2", "title": "도치", "집과제": ["워크북 CH5-2 풀기"], "학원과제": "CH5-2 개념 정리 노트"}, {"code": "CH5-3", "title": "강조", "집과제": ["워크북 CH5-3 풀기"], "학원과제": "CH5-3 개념 정리 노트"}, {"code": "CH5-4", "title": "부정 표현", "집과제": ["워크북 CH5-4 풀기"], "학원과제": "CH5-4 개념 정리 노트"}, {"code": "CH5-복습", "title": "CH5 복습", "집과제": [], "학원과제": "CH5 복습 문제풀이"}]'),
  ('문법','그래머 인사이드 3', 17000, 20, 8, '[{"code": "CH1-1", "title": "문장의 구조", "집과제": ["워크북 CH1-1 풀기"], "학원과제": "CH1-1 개념 정리 노트"}, {"code": "CH1-2", "title": "동사의 시제 정리", "집과제": ["워크북 CH1-2 풀기"], "학원과제": "CH1-2 개념 정리 노트"}, {"code": "CH1-3", "title": "완료시제 심화", "집과제": ["워크북 CH1-3 풀기"], "학원과제": "CH1-3 개념 정리 노트"}, {"code": "CH1-4", "title": "수동태 활용", "집과제": ["워크북 CH1-4 풀기"], "학원과제": "CH1-4 개념 정리 노트"}, {"code": "CH1-복습", "title": "CH1 복습", "집과제": [], "학원과제": "CH1 복습 문제풀이"}, {"code": "CH2-1", "title": "조동사+완료", "집과제": ["워크북 CH2-1 풀기"], "학원과제": "CH2-1 개념 정리 노트"}, {"code": "CH2-2", "title": "부정사 심화", "집과제": ["워크북 CH2-2 풀기"], "학원과제": "CH2-2 개념 정리 노트"}, {"code": "CH2-3", "title": "동명사 심화", "집과제": ["워크북 CH2-3 풀기"], "학원과제": "CH2-3 개념 정리 노트"}, {"code": "CH2-4", "title": "분사의 활용", "집과제": ["워크북 CH2-4 풀기"], "학원과제": "CH2-4 개념 정리 노트"}, {"code": "CH2-복습", "title": "CH2 복습", "집과제": [], "학원과제": "CH2 복습 문제풀이"}, {"code": "CH3-1", "title": "분사구문 심화", "집과제": ["워크북 CH3-1 풀기"], "학원과제": "CH3-1 개념 정리 노트"}, {"code": "CH3-2", "title": "관계사 종합", "집과제": ["워크북 CH3-2 풀기"], "학원과제": "CH3-2 개념 정리 노트"}, {"code": "CH3-3", "title": "명사절 종합", "집과제": ["워크북 CH3-3 풀기"], "학원과제": "CH3-3 개념 정리 노트"}, {"code": "CH3-4", "title": "부사절 종합", "집과제": ["워크북 CH3-4 풀기"], "학원과제": "CH3-4 개념 정리 노트"}, {"code": "CH3-복습", "title": "CH3 복습", "집과제": [], "학원과제": "CH3 복습 문제풀이"}, {"code": "CH4-1", "title": "가정법 종합", "집과제": ["워크북 CH4-1 풀기"], "학원과제": "CH4-1 개념 정리 노트"}, {"code": "CH4-2", "title": "비교 구문 심화", "집과제": ["워크북 CH4-2 풀기"], "학원과제": "CH4-2 개념 정리 노트"}, {"code": "CH4-3", "title": "도치와 강조", "집과제": ["워크북 CH4-3 풀기"], "학원과제": "CH4-3 개념 정리 노트"}, {"code": "CH4-4", "title": "특수 구문", "집과제": ["워크북 CH4-4 풀기"], "학원과제": "CH4-4 개념 정리 노트"}, {"code": "CH4-복습", "title": "CH4 복습", "집과제": [], "학원과제": "CH4 복습 문제풀이"}, {"code": "CH5-1", "title": "병렬 구조", "집과제": ["워크북 CH5-1 풀기"], "학원과제": "CH5-1 개념 정리 노트"}, {"code": "CH5-2", "title": "대명사 심화", "집과제": ["워크북 CH5-2 풀기"], "학원과제": "CH5-2 개념 정리 노트"}, {"code": "CH5-3", "title": "전치사 심화", "집과제": ["워크북 CH5-3 풀기"], "학원과제": "CH5-3 개념 정리 노트"}, {"code": "CH5-4", "title": "접속사 심화", "집과제": ["워크북 CH5-4 풀기"], "학원과제": "CH5-4 개념 정리 노트"}, {"code": "CH5-복습", "title": "CH5 복습", "집과제": [], "학원과제": "CH5 복습 문제풀이"}]'),
  ('리딩','리딩튜터 주니어 1', 14000, 30, 12, '[{"code": "CH1-1", "title": "My New School", "집과제": ["CH1-1 해석해 오기"], "학원과제": "CH1-1 단어·문제풀이·구문분석"}, {"code": "CH1-2", "title": "A Day in the Park", "집과제": ["CH1-2 해석해 오기"], "학원과제": "CH1-2 단어·문제풀이·구문분석"}, {"code": "CH1-3", "title": "The Lost Puppy", "집과제": ["CH1-3 해석해 오기"], "학원과제": "CH1-3 단어·문제풀이·구문분석"}, {"code": "CH1-4", "title": "Making Pancakes", "집과제": ["CH1-4 해석해 오기"], "학원과제": "CH1-4 단어·문제풀이·구문분석"}, {"code": "CH1-복습", "title": "CH1 복습", "집과제": [], "학원과제": "CH1 복습 문제풀이"}, {"code": "CH2-1", "title": "Rainy Season", "집과제": ["CH2-1 해석해 오기"], "학원과제": "CH2-1 단어·문제풀이·구문분석"}, {"code": "CH2-2", "title": "My Best Friend", "집과제": ["CH2-2 해석해 오기"], "학원과제": "CH2-2 단어·문제풀이·구문분석"}, {"code": "CH2-3", "title": "A Trip to the Zoo", "집과제": ["CH2-3 해석해 오기"], "학원과제": "CH2-3 단어·문제풀이·구문분석"}, {"code": "CH2-4", "title": "Winter Sports", "집과제": ["CH2-4 해석해 오기"], "학원과제": "CH2-4 단어·문제풀이·구문분석"}, {"code": "CH2-복습", "title": "CH2 복습", "집과제": [], "학원과제": "CH2 복습 문제풀이"}, {"code": "CH3-1", "title": "The Old Tree", "집과제": ["CH3-1 해석해 오기"], "학원과제": "CH3-1 단어·문제풀이·구문분석"}, {"code": "CH3-2", "title": "Helping Hands", "집과제": ["CH3-2 해석해 오기"], "학원과제": "CH3-2 단어·문제풀이·구문분석"}, {"code": "CH3-3", "title": "A Letter to Grandma", "집과제": ["CH3-3 해석해 오기"], "학원과제": "CH3-3 단어·문제풀이·구문분석"}, {"code": "CH3-4", "title": "Save the Bees", "집과제": ["CH3-4 해석해 오기"], "학원과제": "CH3-4 단어·문제풀이·구문분석"}, {"code": "CH3-복습", "title": "CH3 복습", "집과제": [], "학원과제": "CH3 복습 문제풀이"}, {"code": "CH4-1", "title": "The Night Sky", "집과제": ["CH4-1 해석해 오기"], "학원과제": "CH4-1 단어·문제풀이·구문분석"}, {"code": "CH4-2", "title": "Street Food", "집과제": ["CH4-2 해석해 오기"], "학원과제": "CH4-2 단어·문제풀이·구문분석"}, {"code": "CH4-3", "title": "A Small Library", "집과제": ["CH4-3 해석해 오기"], "학원과제": "CH4-3 단어·문제풀이·구문분석"}, {"code": "CH4-4", "title": "Robots at Home", "집과제": ["CH4-4 해석해 오기"], "학원과제": "CH4-4 단어·문제풀이·구문분석"}, {"code": "CH4-복습", "title": "CH4 복습", "집과제": [], "학원과제": "CH4 복습 문제풀이"}, {"code": "CH5-1", "title": "Ocean Animals", "집과제": ["CH5-1 해석해 오기"], "학원과제": "CH5-1 단어·문제풀이·구문분석"}, {"code": "CH5-2", "title": "A Birthday Surprise", "집과제": ["CH5-2 해석해 오기"], "학원과제": "CH5-2 단어·문제풀이·구문분석"}, {"code": "CH5-3", "title": "Riding a Bike", "집과제": ["CH5-3 해석해 오기"], "학원과제": "CH5-3 단어·문제풀이·구문분석"}, {"code": "CH5-4", "title": "The Flower Market", "집과제": ["CH5-4 해석해 오기"], "학원과제": "CH5-4 단어·문제풀이·구문분석"}, {"code": "CH5-복습", "title": "CH5 복습", "집과제": [], "학원과제": "CH5 복습 문제풀이"}]'),
  ('리딩','리딩튜터 주니어 2', 15000, 25, 10, '[{"code": "CH1-1", "title": "Why Do We Yawn?", "집과제": ["CH1-1 해석해 오기"], "학원과제": "CH1-1 단어·문제풀이·구문분석"}, {"code": "CH1-2", "title": "The Water Cycle", "집과제": ["CH1-2 해석해 오기"], "학원과제": "CH1-2 단어·문제풀이·구문분석"}, {"code": "CH1-3", "title": "Ancient Bridges", "집과제": ["CH1-3 해석해 오기"], "학원과제": "CH1-3 단어·문제풀이·구문분석"}, {"code": "CH1-4", "title": "Life in the Desert", "집과제": ["CH1-4 해석해 오기"], "학원과제": "CH1-4 단어·문제풀이·구문분석"}, {"code": "CH1-복습", "title": "CH1 복습", "집과제": [], "학원과제": "CH1 복습 문제풀이"}, {"code": "CH2-1", "title": "Sign Language", "집과제": ["CH2-1 해석해 오기"], "학원과제": "CH2-1 단어·문제풀이·구문분석"}, {"code": "CH2-2", "title": "City Farms", "집과제": ["CH2-2 해석해 오기"], "학원과제": "CH2-2 단어·문제풀이·구문분석"}, {"code": "CH2-3", "title": "The Story of Paper", "집과제": ["CH2-3 해석해 오기"], "학원과제": "CH2-3 단어·문제풀이·구문분석"}, {"code": "CH2-4", "title": "Volcanoes", "집과제": ["CH2-4 해석해 오기"], "학원과제": "CH2-4 단어·문제풀이·구문분석"}, {"code": "CH2-복습", "title": "CH2 복습", "집과제": [], "학원과제": "CH2 복습 문제풀이"}, {"code": "CH3-1", "title": "How Birds Migrate", "집과제": ["CH3-1 해석해 오기"], "학원과제": "CH3-1 단어·문제풀이·구문분석"}, {"code": "CH3-2", "title": "Food Waste", "집과제": ["CH3-2 해석해 오기"], "학원과제": "CH3-2 단어·문제풀이·구문분석"}, {"code": "CH3-3", "title": "The Silk Road", "집과제": ["CH3-3 해석해 오기"], "학원과제": "CH3-3 단어·문제풀이·구문분석"}, {"code": "CH3-4", "title": "Sleep and Memory", "집과제": ["CH3-4 해석해 오기"], "학원과제": "CH3-4 단어·문제풀이·구문분석"}, {"code": "CH3-복습", "title": "CH3 복습", "집과제": [], "학원과제": "CH3 복습 문제풀이"}, {"code": "CH4-1", "title": "Deep Sea Creatures", "집과제": ["CH4-1 해석해 오기"], "학원과제": "CH4-1 단어·문제풀이·구문분석"}, {"code": "CH4-2", "title": "Plastic Islands", "집과제": ["CH4-2 해석해 오기"], "학원과제": "CH4-2 단어·문제풀이·구문분석"}, {"code": "CH4-3", "title": "The First Flight", "집과제": ["CH4-3 해석해 오기"], "학원과제": "CH4-3 단어·문제풀이·구문분석"}, {"code": "CH4-4", "title": "Color and Mood", "집과제": ["CH4-4 해석해 오기"], "학원과제": "CH4-4 단어·문제풀이·구문분석"}, {"code": "CH4-복습", "title": "CH4 복습", "집과제": [], "학원과제": "CH4 복습 문제풀이"}, {"code": "CH5-1", "title": "Mountains and Weather", "집과제": ["CH5-1 해석해 오기"], "학원과제": "CH5-1 단어·문제풀이·구문분석"}, {"code": "CH5-2", "title": "Street Art", "집과제": ["CH5-2 해석해 오기"], "학원과제": "CH5-2 단어·문제풀이·구문분석"}, {"code": "CH5-3", "title": "Clocks Through Time", "집과제": ["CH5-3 해석해 오기"], "학원과제": "CH5-3 단어·문제풀이·구문분석"}, {"code": "CH5-4", "title": "Rivers and People", "집과제": ["CH5-4 해석해 오기"], "학원과제": "CH5-4 단어·문제풀이·구문분석"}, {"code": "CH5-복습", "title": "CH5 복습", "집과제": [], "학원과제": "CH5 복습 문제풀이"}]'),
  ('리딩','리딩튜터 주니어 3', 16000, 20, 8, '[{"code": "CH1-1", "title": "Artificial Intelligence", "집과제": ["CH1-1 해석해 오기"], "학원과제": "CH1-1 단어·문제풀이·구문분석"}, {"code": "CH1-2", "title": "Climate Migration", "집과제": ["CH1-2 해석해 오기"], "학원과제": "CH1-2 단어·문제풀이·구문분석"}, {"code": "CH1-3", "title": "The Ethics of Cloning", "집과제": ["CH1-3 해석해 오기"], "학원과제": "CH1-3 단어·문제풀이·구문분석"}, {"code": "CH1-4", "title": "Urban Heat Islands", "집과제": ["CH1-4 해석해 오기"], "학원과제": "CH1-4 단어·문제풀이·구문분석"}, {"code": "CH1-복습", "title": "CH1 복습", "집과제": [], "학원과제": "CH1 복습 문제풀이"}, {"code": "CH2-1", "title": "Micro-plastics", "집과제": ["CH2-1 해석해 오기"], "학원과제": "CH2-1 단어·문제풀이·구문분석"}, {"code": "CH2-2", "title": "Space Debris", "집과제": ["CH2-2 해석해 오기"], "학원과제": "CH2-2 단어·문제풀이·구문분석"}, {"code": "CH2-3", "title": "Renewable Energy", "집과제": ["CH2-3 해석해 오기"], "학원과제": "CH2-3 단어·문제풀이·구문분석"}, {"code": "CH2-4", "title": "The Placebo Effect", "집과제": ["CH2-4 해석해 오기"], "학원과제": "CH2-4 단어·문제풀이·구문분석"}, {"code": "CH2-복습", "title": "CH2 복습", "집과제": [], "학원과제": "CH2 복습 문제풀이"}, {"code": "CH3-1", "title": "Fast Fashion", "집과제": ["CH3-1 해석해 오기"], "학원과제": "CH3-1 단어·문제풀이·구문분석"}, {"code": "CH3-2", "title": "Language Extinction", "집과제": ["CH3-2 해석해 오기"], "학원과제": "CH3-2 단어·문제풀이·구문분석"}, {"code": "CH3-3", "title": "Gene Editing", "집과제": ["CH3-3 해석해 오기"], "학원과제": "CH3-3 단어·문제풀이·구문분석"}, {"code": "CH3-4", "title": "Smart Cities", "집과제": ["CH3-4 해석해 오기"], "학원과제": "CH3-4 단어·문제풀이·구문분석"}, {"code": "CH3-복습", "title": "CH3 복습", "집과제": [], "학원과제": "CH3 복습 문제풀이"}, {"code": "CH4-1", "title": "Ocean Acidification", "집과제": ["CH4-1 해석해 오기"], "학원과제": "CH4-1 단어·문제풀이·구문분석"}, {"code": "CH4-2", "title": "Digital Privacy", "집과제": ["CH4-2 해석해 오기"], "학원과제": "CH4-2 단어·문제풀이·구문분석"}, {"code": "CH4-3", "title": "Vertical Farming", "집과제": ["CH4-3 해석해 오기"], "학원과제": "CH4-3 단어·문제풀이·구문분석"}, {"code": "CH4-4", "title": "The Gig Economy", "집과제": ["CH4-4 해석해 오기"], "학원과제": "CH4-4 단어·문제풀이·구문분석"}, {"code": "CH4-복습", "title": "CH4 복습", "집과제": [], "학원과제": "CH4 복습 문제풀이"}, {"code": "CH5-1", "title": "Antibiotic Resistance", "집과제": ["CH5-1 해석해 오기"], "학원과제": "CH5-1 단어·문제풀이·구문분석"}, {"code": "CH5-2", "title": "Carbon Capture", "집과제": ["CH5-2 해석해 오기"], "학원과제": "CH5-2 단어·문제풀이·구문분석"}, {"code": "CH5-3", "title": "Misinformation", "집과제": ["CH5-3 해석해 오기"], "학원과제": "CH5-3 단어·문제풀이·구문분석"}, {"code": "CH5-4", "title": "Biodiversity Loss", "집과제": ["CH5-4 해석해 오기"], "학원과제": "CH5-4 단어·문제풀이·구문분석"}, {"code": "CH5-복습", "title": "CH5 복습", "집과제": [], "학원과제": "CH5 복습 문제풀이"}]'),
  ('단어','능률 VOCA 입문', 11000, 30, 12, '[{"code": "Day 1", "title": "", "집과제": ["Day 1 단어 외우기"], "학원과제": "Day 1 단어 테스트"}, {"code": "Day 2", "title": "", "집과제": ["Day 2 단어 외우기"], "학원과제": "Day 2 단어 테스트"}, {"code": "Day 3", "title": "", "집과제": ["Day 3 단어 외우기"], "학원과제": "Day 3 단어 테스트"}, {"code": "Day 4", "title": "", "집과제": ["Day 4 단어 외우기"], "학원과제": "Day 4 단어 테스트"}, {"code": "Day 5", "title": "", "집과제": ["Day 5 단어 외우기"], "학원과제": "Day 5 단어 테스트"}, {"code": "Day 6", "title": "", "집과제": ["Day 6 단어 외우기"], "학원과제": "Day 6 단어 테스트"}, {"code": "Day 7", "title": "", "집과제": ["Day 7 단어 외우기"], "학원과제": "Day 7 단어 테스트"}, {"code": "Day 8", "title": "", "집과제": ["Day 8 단어 외우기"], "학원과제": "Day 8 단어 테스트"}, {"code": "Day 9", "title": "", "집과제": ["Day 9 단어 외우기"], "학원과제": "Day 9 단어 테스트"}, {"code": "Day 10", "title": "", "집과제": ["Day 10 단어 외우기"], "학원과제": "Day 10 단어 테스트"}, {"code": "Day 11", "title": "", "집과제": ["Day 11 단어 외우기"], "학원과제": "Day 11 단어 테스트"}, {"code": "Day 12", "title": "", "집과제": ["Day 12 단어 외우기"], "학원과제": "Day 12 단어 테스트"}, {"code": "Day 13", "title": "", "집과제": ["Day 13 단어 외우기"], "학원과제": "Day 13 단어 테스트"}, {"code": "Day 14", "title": "", "집과제": ["Day 14 단어 외우기"], "학원과제": "Day 14 단어 테스트"}, {"code": "Day 15", "title": "", "집과제": ["Day 15 단어 외우기"], "학원과제": "Day 15 단어 테스트"}, {"code": "Day 16", "title": "", "집과제": ["Day 16 단어 외우기"], "학원과제": "Day 16 단어 테스트"}, {"code": "Day 17", "title": "", "집과제": ["Day 17 단어 외우기"], "학원과제": "Day 17 단어 테스트"}, {"code": "Day 18", "title": "", "집과제": ["Day 18 단어 외우기"], "학원과제": "Day 18 단어 테스트"}, {"code": "Day 19", "title": "", "집과제": ["Day 19 단어 외우기"], "학원과제": "Day 19 단어 테스트"}, {"code": "Day 20", "title": "", "집과제": ["Day 20 단어 외우기"], "학원과제": "Day 20 단어 테스트"}, {"code": "Day 21", "title": "", "집과제": ["Day 21 단어 외우기"], "학원과제": "Day 21 단어 테스트"}, {"code": "Day 22", "title": "", "집과제": ["Day 22 단어 외우기"], "학원과제": "Day 22 단어 테스트"}, {"code": "Day 23", "title": "", "집과제": ["Day 23 단어 외우기"], "학원과제": "Day 23 단어 테스트"}, {"code": "Day 24", "title": "", "집과제": ["Day 24 단어 외우기"], "학원과제": "Day 24 단어 테스트"}, {"code": "Day 25", "title": "", "집과제": ["Day 25 단어 외우기"], "학원과제": "Day 25 단어 테스트"}, {"code": "Day 26", "title": "", "집과제": ["Day 26 단어 외우기"], "학원과제": "Day 26 단어 테스트"}, {"code": "Day 27", "title": "", "집과제": ["Day 27 단어 외우기"], "학원과제": "Day 27 단어 테스트"}, {"code": "Day 28", "title": "", "집과제": ["Day 28 단어 외우기"], "학원과제": "Day 28 단어 테스트"}, {"code": "Day 29", "title": "", "집과제": ["Day 29 단어 외우기"], "학원과제": "Day 29 단어 테스트"}, {"code": "Day 30", "title": "", "집과제": ["Day 30 단어 외우기"], "학원과제": "Day 30 단어 테스트"}, {"code": "Day 31", "title": "", "집과제": ["Day 31 단어 외우기"], "학원과제": "Day 31 단어 테스트"}, {"code": "Day 32", "title": "", "집과제": ["Day 32 단어 외우기"], "학원과제": "Day 32 단어 테스트"}, {"code": "Day 33", "title": "", "집과제": ["Day 33 단어 외우기"], "학원과제": "Day 33 단어 테스트"}, {"code": "Day 34", "title": "", "집과제": ["Day 34 단어 외우기"], "학원과제": "Day 34 단어 테스트"}, {"code": "Day 35", "title": "", "집과제": ["Day 35 단어 외우기"], "학원과제": "Day 35 단어 테스트"}, {"code": "Day 36", "title": "", "집과제": ["Day 36 단어 외우기"], "학원과제": "Day 36 단어 테스트"}, {"code": "Day 37", "title": "", "집과제": ["Day 37 단어 외우기"], "학원과제": "Day 37 단어 테스트"}, {"code": "Day 38", "title": "", "집과제": ["Day 38 단어 외우기"], "학원과제": "Day 38 단어 테스트"}, {"code": "Day 39", "title": "", "집과제": ["Day 39 단어 외우기"], "학원과제": "Day 39 단어 테스트"}, {"code": "Day 40", "title": "", "집과제": ["Day 40 단어 외우기"], "학원과제": "Day 40 단어 테스트"}, {"code": "Day 41", "title": "", "집과제": ["Day 41 단어 외우기"], "학원과제": "Day 41 단어 테스트"}, {"code": "Day 42", "title": "", "집과제": ["Day 42 단어 외우기"], "학원과제": "Day 42 단어 테스트"}, {"code": "Day 43", "title": "", "집과제": ["Day 43 단어 외우기"], "학원과제": "Day 43 단어 테스트"}, {"code": "Day 44", "title": "", "집과제": ["Day 44 단어 외우기"], "학원과제": "Day 44 단어 테스트"}, {"code": "Day 45", "title": "", "집과제": ["Day 45 단어 외우기"], "학원과제": "Day 45 단어 테스트"}, {"code": "Day 46", "title": "", "집과제": ["Day 46 단어 외우기"], "학원과제": "Day 46 단어 테스트"}, {"code": "Day 47", "title": "", "집과제": ["Day 47 단어 외우기"], "학원과제": "Day 47 단어 테스트"}, {"code": "Day 48", "title": "", "집과제": ["Day 48 단어 외우기"], "학원과제": "Day 48 단어 테스트"}, {"code": "Day 49", "title": "", "집과제": ["Day 49 단어 외우기"], "학원과제": "Day 49 단어 테스트"}, {"code": "Day 50", "title": "", "집과제": ["Day 50 단어 외우기"], "학원과제": "Day 50 단어 테스트"}]'),
  ('단어','능률 VOCA 기본', 12000, 25, 10, '[{"code": "Day 1", "title": "", "집과제": ["Day 1 단어 외우기"], "학원과제": "Day 1 단어 테스트"}, {"code": "Day 2", "title": "", "집과제": ["Day 2 단어 외우기"], "학원과제": "Day 2 단어 테스트"}, {"code": "Day 3", "title": "", "집과제": ["Day 3 단어 외우기"], "학원과제": "Day 3 단어 테스트"}, {"code": "Day 4", "title": "", "집과제": ["Day 4 단어 외우기"], "학원과제": "Day 4 단어 테스트"}, {"code": "Day 5", "title": "", "집과제": ["Day 5 단어 외우기"], "학원과제": "Day 5 단어 테스트"}, {"code": "Day 6", "title": "", "집과제": ["Day 6 단어 외우기"], "학원과제": "Day 6 단어 테스트"}, {"code": "Day 7", "title": "", "집과제": ["Day 7 단어 외우기"], "학원과제": "Day 7 단어 테스트"}, {"code": "Day 8", "title": "", "집과제": ["Day 8 단어 외우기"], "학원과제": "Day 8 단어 테스트"}, {"code": "Day 9", "title": "", "집과제": ["Day 9 단어 외우기"], "학원과제": "Day 9 단어 테스트"}, {"code": "Day 10", "title": "", "집과제": ["Day 10 단어 외우기"], "학원과제": "Day 10 단어 테스트"}, {"code": "Day 11", "title": "", "집과제": ["Day 11 단어 외우기"], "학원과제": "Day 11 단어 테스트"}, {"code": "Day 12", "title": "", "집과제": ["Day 12 단어 외우기"], "학원과제": "Day 12 단어 테스트"}, {"code": "Day 13", "title": "", "집과제": ["Day 13 단어 외우기"], "학원과제": "Day 13 단어 테스트"}, {"code": "Day 14", "title": "", "집과제": ["Day 14 단어 외우기"], "학원과제": "Day 14 단어 테스트"}, {"code": "Day 15", "title": "", "집과제": ["Day 15 단어 외우기"], "학원과제": "Day 15 단어 테스트"}, {"code": "Day 16", "title": "", "집과제": ["Day 16 단어 외우기"], "학원과제": "Day 16 단어 테스트"}, {"code": "Day 17", "title": "", "집과제": ["Day 17 단어 외우기"], "학원과제": "Day 17 단어 테스트"}, {"code": "Day 18", "title": "", "집과제": ["Day 18 단어 외우기"], "학원과제": "Day 18 단어 테스트"}, {"code": "Day 19", "title": "", "집과제": ["Day 19 단어 외우기"], "학원과제": "Day 19 단어 테스트"}, {"code": "Day 20", "title": "", "집과제": ["Day 20 단어 외우기"], "학원과제": "Day 20 단어 테스트"}, {"code": "Day 21", "title": "", "집과제": ["Day 21 단어 외우기"], "학원과제": "Day 21 단어 테스트"}, {"code": "Day 22", "title": "", "집과제": ["Day 22 단어 외우기"], "학원과제": "Day 22 단어 테스트"}, {"code": "Day 23", "title": "", "집과제": ["Day 23 단어 외우기"], "학원과제": "Day 23 단어 테스트"}, {"code": "Day 24", "title": "", "집과제": ["Day 24 단어 외우기"], "학원과제": "Day 24 단어 테스트"}, {"code": "Day 25", "title": "", "집과제": ["Day 25 단어 외우기"], "학원과제": "Day 25 단어 테스트"}, {"code": "Day 26", "title": "", "집과제": ["Day 26 단어 외우기"], "학원과제": "Day 26 단어 테스트"}, {"code": "Day 27", "title": "", "집과제": ["Day 27 단어 외우기"], "학원과제": "Day 27 단어 테스트"}, {"code": "Day 28", "title": "", "집과제": ["Day 28 단어 외우기"], "학원과제": "Day 28 단어 테스트"}, {"code": "Day 29", "title": "", "집과제": ["Day 29 단어 외우기"], "학원과제": "Day 29 단어 테스트"}, {"code": "Day 30", "title": "", "집과제": ["Day 30 단어 외우기"], "학원과제": "Day 30 단어 테스트"}, {"code": "Day 31", "title": "", "집과제": ["Day 31 단어 외우기"], "학원과제": "Day 31 단어 테스트"}, {"code": "Day 32", "title": "", "집과제": ["Day 32 단어 외우기"], "학원과제": "Day 32 단어 테스트"}, {"code": "Day 33", "title": "", "집과제": ["Day 33 단어 외우기"], "학원과제": "Day 33 단어 테스트"}, {"code": "Day 34", "title": "", "집과제": ["Day 34 단어 외우기"], "학원과제": "Day 34 단어 테스트"}, {"code": "Day 35", "title": "", "집과제": ["Day 35 단어 외우기"], "학원과제": "Day 35 단어 테스트"}, {"code": "Day 36", "title": "", "집과제": ["Day 36 단어 외우기"], "학원과제": "Day 36 단어 테스트"}, {"code": "Day 37", "title": "", "집과제": ["Day 37 단어 외우기"], "학원과제": "Day 37 단어 테스트"}, {"code": "Day 38", "title": "", "집과제": ["Day 38 단어 외우기"], "학원과제": "Day 38 단어 테스트"}, {"code": "Day 39", "title": "", "집과제": ["Day 39 단어 외우기"], "학원과제": "Day 39 단어 테스트"}, {"code": "Day 40", "title": "", "집과제": ["Day 40 단어 외우기"], "학원과제": "Day 40 단어 테스트"}, {"code": "Day 41", "title": "", "집과제": ["Day 41 단어 외우기"], "학원과제": "Day 41 단어 테스트"}, {"code": "Day 42", "title": "", "집과제": ["Day 42 단어 외우기"], "학원과제": "Day 42 단어 테스트"}, {"code": "Day 43", "title": "", "집과제": ["Day 43 단어 외우기"], "학원과제": "Day 43 단어 테스트"}, {"code": "Day 44", "title": "", "집과제": ["Day 44 단어 외우기"], "학원과제": "Day 44 단어 테스트"}, {"code": "Day 45", "title": "", "집과제": ["Day 45 단어 외우기"], "학원과제": "Day 45 단어 테스트"}, {"code": "Day 46", "title": "", "집과제": ["Day 46 단어 외우기"], "학원과제": "Day 46 단어 테스트"}, {"code": "Day 47", "title": "", "집과제": ["Day 47 단어 외우기"], "학원과제": "Day 47 단어 테스트"}, {"code": "Day 48", "title": "", "집과제": ["Day 48 단어 외우기"], "학원과제": "Day 48 단어 테스트"}, {"code": "Day 49", "title": "", "집과제": ["Day 49 단어 외우기"], "학원과제": "Day 49 단어 테스트"}, {"code": "Day 50", "title": "", "집과제": ["Day 50 단어 외우기"], "학원과제": "Day 50 단어 테스트"}]'),
  ('단어','능률 VOCA 실력', 13000, 20, 8, '[{"code": "Day 1", "title": "", "집과제": ["Day 1 단어 외우기"], "학원과제": "Day 1 단어 테스트"}, {"code": "Day 2", "title": "", "집과제": ["Day 2 단어 외우기"], "학원과제": "Day 2 단어 테스트"}, {"code": "Day 3", "title": "", "집과제": ["Day 3 단어 외우기"], "학원과제": "Day 3 단어 테스트"}, {"code": "Day 4", "title": "", "집과제": ["Day 4 단어 외우기"], "학원과제": "Day 4 단어 테스트"}, {"code": "Day 5", "title": "", "집과제": ["Day 5 단어 외우기"], "학원과제": "Day 5 단어 테스트"}, {"code": "Day 6", "title": "", "집과제": ["Day 6 단어 외우기"], "학원과제": "Day 6 단어 테스트"}, {"code": "Day 7", "title": "", "집과제": ["Day 7 단어 외우기"], "학원과제": "Day 7 단어 테스트"}, {"code": "Day 8", "title": "", "집과제": ["Day 8 단어 외우기"], "학원과제": "Day 8 단어 테스트"}, {"code": "Day 9", "title": "", "집과제": ["Day 9 단어 외우기"], "학원과제": "Day 9 단어 테스트"}, {"code": "Day 10", "title": "", "집과제": ["Day 10 단어 외우기"], "학원과제": "Day 10 단어 테스트"}, {"code": "Day 11", "title": "", "집과제": ["Day 11 단어 외우기"], "학원과제": "Day 11 단어 테스트"}, {"code": "Day 12", "title": "", "집과제": ["Day 12 단어 외우기"], "학원과제": "Day 12 단어 테스트"}, {"code": "Day 13", "title": "", "집과제": ["Day 13 단어 외우기"], "학원과제": "Day 13 단어 테스트"}, {"code": "Day 14", "title": "", "집과제": ["Day 14 단어 외우기"], "학원과제": "Day 14 단어 테스트"}, {"code": "Day 15", "title": "", "집과제": ["Day 15 단어 외우기"], "학원과제": "Day 15 단어 테스트"}, {"code": "Day 16", "title": "", "집과제": ["Day 16 단어 외우기"], "학원과제": "Day 16 단어 테스트"}, {"code": "Day 17", "title": "", "집과제": ["Day 17 단어 외우기"], "학원과제": "Day 17 단어 테스트"}, {"code": "Day 18", "title": "", "집과제": ["Day 18 단어 외우기"], "학원과제": "Day 18 단어 테스트"}, {"code": "Day 19", "title": "", "집과제": ["Day 19 단어 외우기"], "학원과제": "Day 19 단어 테스트"}, {"code": "Day 20", "title": "", "집과제": ["Day 20 단어 외우기"], "학원과제": "Day 20 단어 테스트"}, {"code": "Day 21", "title": "", "집과제": ["Day 21 단어 외우기"], "학원과제": "Day 21 단어 테스트"}, {"code": "Day 22", "title": "", "집과제": ["Day 22 단어 외우기"], "학원과제": "Day 22 단어 테스트"}, {"code": "Day 23", "title": "", "집과제": ["Day 23 단어 외우기"], "학원과제": "Day 23 단어 테스트"}, {"code": "Day 24", "title": "", "집과제": ["Day 24 단어 외우기"], "학원과제": "Day 24 단어 테스트"}, {"code": "Day 25", "title": "", "집과제": ["Day 25 단어 외우기"], "학원과제": "Day 25 단어 테스트"}, {"code": "Day 26", "title": "", "집과제": ["Day 26 단어 외우기"], "학원과제": "Day 26 단어 테스트"}, {"code": "Day 27", "title": "", "집과제": ["Day 27 단어 외우기"], "학원과제": "Day 27 단어 테스트"}, {"code": "Day 28", "title": "", "집과제": ["Day 28 단어 외우기"], "학원과제": "Day 28 단어 테스트"}, {"code": "Day 29", "title": "", "집과제": ["Day 29 단어 외우기"], "학원과제": "Day 29 단어 테스트"}, {"code": "Day 30", "title": "", "집과제": ["Day 30 단어 외우기"], "학원과제": "Day 30 단어 테스트"}, {"code": "Day 31", "title": "", "집과제": ["Day 31 단어 외우기"], "학원과제": "Day 31 단어 테스트"}, {"code": "Day 32", "title": "", "집과제": ["Day 32 단어 외우기"], "학원과제": "Day 32 단어 테스트"}, {"code": "Day 33", "title": "", "집과제": ["Day 33 단어 외우기"], "학원과제": "Day 33 단어 테스트"}, {"code": "Day 34", "title": "", "집과제": ["Day 34 단어 외우기"], "학원과제": "Day 34 단어 테스트"}, {"code": "Day 35", "title": "", "집과제": ["Day 35 단어 외우기"], "학원과제": "Day 35 단어 테스트"}, {"code": "Day 36", "title": "", "집과제": ["Day 36 단어 외우기"], "학원과제": "Day 36 단어 테스트"}, {"code": "Day 37", "title": "", "집과제": ["Day 37 단어 외우기"], "학원과제": "Day 37 단어 테스트"}, {"code": "Day 38", "title": "", "집과제": ["Day 38 단어 외우기"], "학원과제": "Day 38 단어 테스트"}, {"code": "Day 39", "title": "", "집과제": ["Day 39 단어 외우기"], "학원과제": "Day 39 단어 테스트"}, {"code": "Day 40", "title": "", "집과제": ["Day 40 단어 외우기"], "학원과제": "Day 40 단어 테스트"}, {"code": "Day 41", "title": "", "집과제": ["Day 41 단어 외우기"], "학원과제": "Day 41 단어 테스트"}, {"code": "Day 42", "title": "", "집과제": ["Day 42 단어 외우기"], "학원과제": "Day 42 단어 테스트"}, {"code": "Day 43", "title": "", "집과제": ["Day 43 단어 외우기"], "학원과제": "Day 43 단어 테스트"}, {"code": "Day 44", "title": "", "집과제": ["Day 44 단어 외우기"], "학원과제": "Day 44 단어 테스트"}, {"code": "Day 45", "title": "", "집과제": ["Day 45 단어 외우기"], "학원과제": "Day 45 단어 테스트"}, {"code": "Day 46", "title": "", "집과제": ["Day 46 단어 외우기"], "학원과제": "Day 46 단어 테스트"}, {"code": "Day 47", "title": "", "집과제": ["Day 47 단어 외우기"], "학원과제": "Day 47 단어 테스트"}, {"code": "Day 48", "title": "", "집과제": ["Day 48 단어 외우기"], "학원과제": "Day 48 단어 테스트"}, {"code": "Day 49", "title": "", "집과제": ["Day 49 단어 외우기"], "학원과제": "Day 49 단어 테스트"}, {"code": "Day 50", "title": "", "집과제": ["Day 50 단어 외우기"], "학원과제": "Day 50 단어 테스트"}]');

-- 지난 **두 달치** 데일리 리포트 (완료된 과거 데이터 → 월말평가서를 바로 돌려볼 수 있게)
--
--   ★ 달을 박아두지 않고 **설치한 날 기준 지난 두 달**로 넣습니다.
--     예전에는 '2026-05' 로 고정돼 있어서, 월말평가서 화면에서 그 달을 일부러 찾아
--     골라야만 나왔습니다. 이제 **「지난달」을 고르면 바로** 나옵니다.
--   ★ 수업일은 **학생마다 자기 요일**만 (schedule 에 시간이 들어 있는 요일).
--     그래서 학생마다 수업일수가 다르게 나오고, 월말평가서 통계가 실제처럼 보입니다.
insert into daily_records (student_id, date, check_in, check_out, lateness, attitude, homework, voca_test, voca_score, progress, books)
select
  s.id, days.d::date,
  -- 결석한 날은 등·하원 시각이 없습니다 (월말 수업일수 집계가 결석을 빼는지 바로 보입니다)
  case when rn % 9 = 0 then null
       else to_char(sch.t + case when rn % 5 = 0 then interval '12 minutes' else interval '0 minutes' end, 'HH24:MI') end,
  case when rn % 9 = 0 then null
       else to_char(sch.t + (s.class_minutes || ' minutes')::interval, 'HH24:MI') end,
  case when rn % 9 = 0 then '결석' when rn % 5 = 0 then '지각' else '정시등원' end,
  -- 태도·과제는 not null 컬럼이라 결석한 날에도 값이 들어갑니다 (화면에서 고치시면 됩니다)
  case when rn % 4 = 0 then '중' else '상' end,
  case when rn % 6 = 0 then '중' else '100%완료' end,
  case when rn % 9 = 0 then null when rn % 7 = 0 then '불통과' else '통과' end,
  -- ★ 점수는 **결과와 어긋나면 안 됩니다** — 예전에는 결과와 따로 뽑아서
  --   "불통과 20/20" 같은 줄이 샘플에 섞였습니다(화면이 틀린 것처럼 보임).
  case when rn % 9 = 0 then null
       when rn % 7 = 0 then (10 + (rn % 4)) || '/20'   -- 불통과: 10~13
       else (16 + (rn % 5)) || '/20' end,               -- 통과: 16~20
  -- 진도: 수업을 거듭할수록 목차를 따라 **앞으로만** 갑니다
  --   (앱의 lib/progress.js advanceProgress() 와 같은 규칙 — 거꾸로 가지 않습니다)
  --
  --   ★ **학생마다 시작 자리가 다릅니다.** 예전에는 전원이 목차 1번에서 시작해
  --     두 달 뒤 **다 같은 유닛**에 있었습니다. 진짜 학원은 그렇지 않아요 —
  --     어떤 아이는 CH1, 어떤 아이는 CH3 에 있습니다. 그래야 데일리 리포트도
  --     월말평가서도 진짜처럼 보이고, 「학생마다 과제가 다르다」도 보여집니다.
  --     출결번호(pin) 로 0·3·6·9·12… 칸씩 밀어서 **여섯 갈래**로 벌립니다.
  --
  --   ★ 목차 **끝 3단원은 남겨둡니다.** 샘플이 교재 끝에 닿아 있으면 설치 직후
  --     「진도가 저절로 넘어간다」를 보여줄 수가 없습니다 (이 세미나의 간판 기능).
  jsonb_strip_nulls(jsonb_build_object(
    --   과목마다 **다른 자리**에 있게 벌립니다 — 진짜 학원은 문법은 CH4 인데
    --   리딩은 CH2 인 아이가 있습니다. 같이 움직이면 가짜 티가 납니다.
    '문법', (select t.units -> least((s.pin::int % 6) * 3 + ((rn - 1) / 5)::int, greatest(jsonb_array_length(t.units) - 4, 0)) from textbooks t where t.name = s.books->>'문법'),
    '리딩', (select t.units -> least(((s.pin::int / 7) % 6) * 3 + ((rn - 1) / 5)::int, greatest(jsonb_array_length(t.units) - 4, 0)) from textbooks t where t.name = s.books->>'리딩'),
    '단어', (select t.units -> least((s.pin::int % 5) * 6 + ((rn - 1) / 5)::int, greatest(jsonb_array_length(t.units) - 4, 0)) from textbooks t where t.name = s.books->>'단어')
  )),
  s.books
from students s
cross join lateral (
  select g.d, row_number() over (order by g.d) as rn
  from generate_series(
         (date_trunc('month', (now() at time zone 'Asia/Seoul')::date) - interval '2 month')::date,
         (date_trunc('month', (now() at time zone 'Asia/Seoul')::date) - interval '1 day')::date,
         '1 day') g(d)
  -- 그 학생이 수업하는 요일만
  where coalesce(s.schedule ->> substr('일월화수목금토', extract(dow from g.d)::int + 1, 1), '') <> ''
) days
cross join lateral (
  select (s.schedule ->> substr('일월화수목금토', extract(dow from days.d)::int + 1, 1))::time as t
) sch;

-- ★ "오늘" 은 반드시 **한국 날짜**로 — `(now() at time zone 'Asia/Seoul')::date`
--   Supabase 서버는 UTC 로 돌아서 `current_date` 는 **UTC 날짜**입니다.
--   앱은 전부 한국시간(lib/time.js kstNow)으로 "오늘" 을 판단하므로,
--   밤 12시~아침 9시(KST) 사이에 이 SQL 을 돌리면 샘플이 **하루 전 날짜**로 들어가고
--   현황판·선생님앱이 "오늘 수업 없음"·"과제 없음" 으로 텅 비어 보입니다.
--   (이 리포의 다른 sql/*.sql 도 같은 이유로 전부 KST 로 씁니다 — 되돌리지 마세요)

-- 오늘자 데일리리포트 (출결현황판/키오스크 데모 — 아직 등원 전)
--   ★ 진도는 **지난 기록의 바로 다음 유닛**이어야 합니다. 고정된 번호를 넣으면
--     위 두 달치보다 뒤로 갈 수 있고, 그러면 화면에 진도가 거꾸로 간 것처럼 보입니다.
--     그래서 마지막 기록의 유닛을 찾아 한 칸 앞으로 (목차 끝이면 그대로) 둡니다.
-- ★ **그날 수업이 있는 학생에게만** 깝니다.
--    예전에는 요일을 안 보고 전원에게 깔았습니다. 설치한 날 화면이 비지 않게 한 것인데,
--    그 행이 **월말 수업일수에 그대로 잡혔습니다** — 토요일에 수업이 없는 학생의
--    총수업일수가 1 로 나오고, 정시·지각·결석 어디에도 안 들어가는 유령 수업일이었습니다.
--    (앱은 미래 날짜에 대해 이미 막아뒀는데, 정작 setup.sql 이 만들고 있었습니다)
--    대신 위 명단의 **주말 수업 학생을 늘려서** 무슨 요일에 설치하든 화면이 찹니다.
insert into daily_records (student_id, date, progress, books)
select s.id, (now() at time zone 'Asia/Seoul')::date,
  jsonb_strip_nulls(jsonb_build_object(
    '문법', (select t.units -> least(
               coalesce((select ord::int from jsonb_array_elements(t.units) with ordinality u(el, ord)
                          where el->>'code' = last.progress->'문법'->>'code'), 0),
               jsonb_array_length(t.units) - 1)
             from textbooks t where t.name = s.books->>'문법'),
    '리딩', (select t.units -> least(
               coalesce((select ord::int from jsonb_array_elements(t.units) with ordinality u(el, ord)
                          where el->>'code' = last.progress->'리딩'->>'code'), 0),
               jsonb_array_length(t.units) - 1)
             from textbooks t where t.name = s.books->>'리딩'),
    '단어', (select t.units -> least(
               coalesce((select ord::int from jsonb_array_elements(t.units) with ordinality u(el, ord)
                          where el->>'code' = last.progress->'단어'->>'code'), 0),
               jsonb_array_length(t.units) - 1)
             from textbooks t where t.name = s.books->>'단어')
  )), s.books
from students s
left join lateral (
  -- 그 학생의 가장 최근 기록 (위에서 넣은 지난 두 달치의 마지막 수업일)
  select r.progress from daily_records r
  where r.student_id = s.id order by r.date desc limit 1
) last on true
where coalesce(s.schedule ->> substr('일월화수목금토',
        extract(dow from (now() at time zone 'Asia/Seoul')::date)::int + 1, 1), '') <> '';

-- 오늘 과제 (학생앱 데모 — 로그인하면 바로 체크할 게 보이도록)
--   학생 로그인은 student_code + pin (예: demo01 / 1111)
-- ── 오늘 과제 ──────────────────────────────────────────────
--
--   ① **자동 과제** (auto = true) — 교재 목차의 집과제·학원과제에서 나옵니다.
--      앱이 하는 일(api/attendance.js 의 syncAutoTasks)을 **설치 직후 한 번 미리** 해둡니다.
--      이게 없으면 설치하고 학생앱을 열었을 때 **과제가 텅 비어** 보입니다
--      (자동 과제는 진도가 정해지는 순간에 깔리는데, 그 순간이 아직 안 왔거든요).
--      ★ 학생마다 진도가 다르니 **과제도 학생마다 다릅니다** — 이 세미나의 간판입니다.
insert into tasks (student_id, date, kind, subject, title, done, auto)
select r.student_id, r.date, '집', sub.key, 집.value, (row_number() over ()) % 3 = 0, true
from daily_records r
cross join lateral jsonb_each(r.progress) sub
join textbooks t on t.name = r.books ->> sub.key
cross join lateral jsonb_array_elements(t.units) u
cross join lateral jsonb_array_elements_text(coalesce(u.value -> '집과제', '[]'::jsonb)) 집
where r.date = (now() at time zone 'Asia/Seoul')::date
  and u.value ->> 'code' = sub.value ->> 'code';

insert into tasks (student_id, date, kind, subject, title, done, auto)
select r.student_id, r.date, '학원', sub.key, u.value ->> '학원과제', (row_number() over ()) % 4 = 0, true
from daily_records r
cross join lateral jsonb_each(r.progress) sub
join textbooks t on t.name = r.books ->> sub.key
cross join lateral jsonb_array_elements(t.units) u
where r.date = (now() at time zone 'Asia/Seoul')::date
  and u.value ->> 'code' = sub.value ->> 'code'
  and coalesce(u.value ->> '학원과제', '') <> '';

--   ② **손으로 낸 과제** (auto = false) — 목차에 없는, 그날 선생님이 추가한 것.
--      이게 있어야 「손으로 낸 과제는 진도를 바꿔도 안 지워진다」를 보여줄 수 있습니다
--      (자동 과제만 지워지고 다시 깔립니다 — 선생님앱에 「자동」 표시로 구분됩니다).
--      전원이 아니라 **몇 명만** — 진짜 학원처럼.
insert into tasks (student_id, date, kind, subject, title, done, auto)
select s.id, (now() at time zone 'Asia/Seoul')::date, v.kind, null, v.title, v.done, false
from students s
cross join (values
  ('집',   '오답노트 정리해 오기', false),
  ('학원', '지난주 받아쓰기 다시',  true)
) as v(kind, title, done)
where s.status = '재원' and (s.pin::int % 3) = 0;   -- 전원이 아니라 **몇 명만** (진짜 학원처럼)

-- 월말 참고사항 — 선생님이 평소에 적어두는 한 줄. 평가서 쓸 때 AI 가 같이 읽습니다.
--   달은 **지난달**(데일리 기록이 들어 있는 달)로 맞춥니다.
insert into monthly_comments (student_id, month, comment, middle_school)
select id,
  to_char(date_trunc('month', (now() at time zone 'Asia/Seoul')::date) - interval '1 month', 'YYYY-MM'),
  case (row_number() over (order by student_code)) % 5
    when 0 then '단어 재시험이 몇 번 있었지만 끝까지 통과. 발표에 적극적.'
    when 1 then '리딩 속도가 눈에 띄게 빨라짐. 숙제도 성실하게 해 옴.'
    when 2 then '결석 없이 성실하게 다니고 수업 태도가 좋음.'
    when 3 then '문법 개념은 잡혔고, 쓰기에서 조금 더 연습이 필요함.'
    else '수업 중 집중이 좋아졌음. 단어 암기에 시간을 더 쓰면 좋겠음.'
  end,
  case when grade like '중%' then true else false end
from students;
