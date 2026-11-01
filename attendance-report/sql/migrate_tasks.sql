-- ============================================================
-- 마이그레이션: 학생앱 · 선생님앱 추가 (tasks 테이블)
--
-- ⚠️ 이미 `setup.sql` 을 돌려 **실제 학생 데이터가 들어 있는** 경우,
--    setup.sql 을 다시 돌리면 맨 앞의 `drop table` 때문에 데이터가 전부 사라집니다.
--    그런 분은 setup.sql 대신 **이 파일만** SQL Editor 에 붙여넣고 Run 하세요.
--    (처음 설치하시는 분은 setup.sql 에 이미 포함돼 있어 이 파일이 필요 없습니다.)
--
-- 모든 문장이 IF NOT EXISTS 라 여러 번 돌려도 안전합니다.
-- ============================================================

-- ── 과제DB (학생앱 체크리스트) ────────────────────────────
-- 선생님이 내주고(teacher.html) 학생이 체크한다(student.html).
-- daily_records.homework 는 선생님이 매기는 '상/중/하' 등급이고, 이건 학생이 볼 '할 일 목록'.
create table if not exists tasks (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  date       date not null,                  -- 해야 하는 날
  kind       text not null default '집',      -- 학원 / 집
  subject    text,                           -- 과목 (선택 — 비워도 됨)
  title      text not null,                  -- 과제 내용 (예: "Unit 5 워크북 p.42~45")
  done       boolean not null default false, -- 학생이 체크했는지
  done_at    timestamptz,                    -- 체크한 시각
  created_at timestamptz not null default now()
);

create index if not exists tasks_student_date_idx on tasks (student_id, date);
create index if not exists tasks_date_idx         on tasks (date);

-- 모든 접근은 서버(api/*.js)가 service_role 키로 처리 → RLS on, 공개정책 없음(안전).
alter table tasks enable row level security;

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


-- ── 학생앱 로그인에 필요한 값 점검 ────────────────────────
-- 학생앱은 students 의 **student_code(학생ID) + pin(출결번호)** 로 로그인합니다.
-- 둘 중 하나라도 비어 있으면 그 학생은 로그인할 수 없어요.
-- 아래를 Run 해서 비어 있는 학생이 있으면 /students.html 에서 채워주세요.
select name, student_code, pin
from students
where status = '재원'
  and (student_code is null or student_code = '' or pin is null or pin = '')
order by name;

-- ── 선생님앱에 필요한 값 점검 ─────────────────────────────
-- 선생님앱은 students.teacher(담당 선생님)로 담당 학생을 가립니다.
-- 담당이 비어 있는 학생은 **어느 선생님 화면에도 안 보입니다** (가장 흔한 막힘).
select name, teacher
from students
where status = '재원' and (teacher is null or teacher = '')
order by name;
