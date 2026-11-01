-- 학생DB에 **학교** 칸을 더합니다.
--
-- 왜: 학생 추가 화면에 학교를 적을 데가 아예 없었습니다. 내신 대비·반 편성에
--     학교가 필요한데, 지금까지는 학년만 있었습니다.
--
-- 여러 번 돌려도 안전합니다 (이미 있으면 아무 일도 안 합니다).
-- Supabase → SQL Editor 에 붙여넣고 Run 하세요.

alter table students add column if not exists school text;
