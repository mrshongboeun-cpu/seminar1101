-- ============================================================
-- 마이그레이션: 2차 세미나 DB 속성 전체 반영
-- 예전 setup.sql 을 이미 돌려(=실제 학생을 넣어) 둔 경우,
-- 테이블을 지우지 않고 이 파일만 SQL Editor 에 붙여넣어 Run 하세요.
-- (setup.sql 을 처음부터 다시 돌린다면 이 파일은 필요 없습니다.)
-- 모든 문장이 IF NOT EXISTS 라 여러 번 돌려도 안전합니다.
-- ============================================================

-- 학생: 학생ID
alter table students add column if not exists student_code text;

-- 데일리리포트: 단어점수 / 추가사항·지적사항 / 카톡상태 / 교재 스냅샷
alter table daily_records add column if not exists voca_score  text;
alter table daily_records add column if not exists parent_note text;
alter table daily_records add column if not exists report_sent text not null default '미전송';
alter table daily_records add column if not exists books       jsonb not null default '{}'; -- 그날 교재 스냅샷(교재 전환 감지)

-- 월말참고사항: 중학생(내신)
alter table monthly_comments add column if not exists middle_school boolean not null default false;

-- 교재DB: 가격·수량·재고 + 목차/하루진도
alter table textbooks add column if not exists price       int;
alter table textbooks add column if not exists stock_total int;
alter table textbooks add column if not exists distributed int not null default 0;
alter table textbooks add column if not exists step        int not null default 1;

-- 참고: 교재 목차(units)는 이제 [{"code":"Unit 1","title":"be동사"}] 구조입니다.
--   예전 문자열 목차(["Unit 1. be동사",...])도 코드가 자동 흡수(code=문자열, title="")하므로
--   당장 바꿀 필요는 없고, books.html 에서 각 교재를 열어 코드|제목으로 다시 저장하면 제목이 붙습니다.

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
