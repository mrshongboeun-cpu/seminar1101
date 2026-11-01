-- ============================================================
-- [마이그레이션] 과제 자동 배정용 칸 추가
--   이미 설치해서 쓰고 계신 분만 **한 번** 돌리시면 됩니다.
--   (새로 설치하는 분은 setup.sql 에 이미 들어 있습니다)
--
--   하는 일: tasks 표에 auto 칸을 추가합니다.
--     auto = true  → 교재 목차의 유닛에 적어둔 과제에서 저절로 생긴 것
--     auto = false → 선생님이 손으로 낸 것 (자동으로 지워지지 않습니다)
--
--   여러 번 돌려도 안전합니다. 기존 과제는 전부 auto=false(손으로 낸 것)가 됩니다.
-- ============================================================

alter table tasks add column if not exists auto boolean not null default false;

-- 확인용
select count(*) filter (where auto) as 자동과제,
       count(*) filter (where not auto) as 손으로낸과제
from tasks;
