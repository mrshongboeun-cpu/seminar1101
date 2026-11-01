-- 과제DB(tasks)만 추가하는 보수용 스크립트.
--
-- 언제 쓰나:
--   월말평가서·선생님앱·학생앱에서 이런 에러가 날 때 ─
--   {"code":"PGRST205","message":"Could not find the table 'public.tasks' in the schema cache"}
--   과제 기능이 나중에 들어와서, 그 전에 만든 DB에는 tasks 표가 없습니다.
--
-- ⚠️ setup.sql 을 다시 돌리지 마세요 — 맨 위에 drop table 이 있어서
--    학생·출결·리포트가 전부 지워집니다. 이 파일만 돌리세요.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run. 여러 번 돌려도 안전합니다.

create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  date       date not null,                  -- 해야 하는 날
  kind       text not null default '집',      -- 학원 / 집
  subject    text,                           -- 과목 (선택 — 비워도 됨)
  title      text not null,                  -- 과제 내용 (예: "Unit 5 워크북 p.42~45")
  done       boolean not null default false, -- 학생이 체크했는지
  done_at    timestamptz,                    -- 체크한 시각
  created_at timestamptz not null default now()
);

create index if not exists tasks_student_date_idx on public.tasks (student_id, date);
create index if not exists tasks_date_idx         on public.tasks (date);

-- 모든 접근은 서버(api/*.js)가 service_role 키로 합니다 → RLS 켜고 공개 정책 없음.
alter table public.tasks enable row level security;

-- ★ 이게 빠지면 42501(permission denied) 로 화면이 막힙니다.
grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- PostgREST 가 표 목록을 다시 읽게 (에러 문구의 "schema cache" 가 이것입니다).
notify pgrst, 'reload schema';

-- 확인 — 표 6개가 다 나와야 합니다.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('students','daily_records','monthly_comments',
                     'monthly_reports','textbooks','tasks')
order by table_name;
