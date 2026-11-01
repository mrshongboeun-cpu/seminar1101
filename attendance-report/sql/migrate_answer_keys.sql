-- ============================================================
-- 마이그레이션: 📖 답지 (answer_keys 표 + 비공개 파일 보관함 answers)
--
-- ⚠️ 이미 학생 데이터가 들어 있는 분은 setup.sql 을 다시 돌리지 마시고
--    **이 파일만** SQL Editor 에 붙여넣고 Run 하세요. (여러 번 돌려도 안전합니다)
--
-- 답지는 교재의 **유닛마다 파일 1개**(PDF 또는 사진)입니다.
-- 학생앱에서 「📖 답지」 를 누르면 그 학생의 **지금 진도 유닛** 답지만,
-- **학원 와이파이**(Vercel 환경변수 ACADEMY_IPS)에서만 열립니다.
-- ============================================================

create table if not exists answer_keys (
  id           uuid primary key default gen_random_uuid(),
  textbook_id  uuid not null references textbooks(id) on delete cascade,
  unit_code    text not null,                -- 교재 목차의 유닛코드 (예: UNIT 05)
  path         text not null,                -- 보관함 안의 파일 위치 (앱이 정함)
  file_name    text,                         -- 올린 파일 원래 이름 (화면 표시용)
  content_type text,                         -- application/pdf, image/jpeg …
  created_at   timestamptz not null default now(),
  unique (textbook_id, unit_code)
);
alter table answer_keys enable row level security;   -- 서버(service_role)만 접근
grant all privileges on answer_keys to service_role;

-- 비공개 파일 보관함 (Supabase 에서만 — 일반 PostgreSQL 에는 storage 가 없어서 건너뜀)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('answers', 'answers', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- 확인: 1 이 나오면 끝
select count(*) as 답지표 from information_schema.tables where table_name = 'answer_keys';
