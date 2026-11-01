-- ============================================================
-- 마이그레이션: ✏️ 영작 테스트 (daily_records.writing_test / writing_score)
--
-- ⚠️ 이미 `setup.sql` 을 돌려 **실제 학생 데이터가 들어 있는** 경우,
--    setup.sql 을 다시 돌리면 맨 앞의 `drop table` 때문에 데이터가 전부 사라집니다.
--    그런 분은 setup.sql 대신 **이 파일만** SQL Editor 에 붙여넣고 Run 하세요.
--    (처음 설치하시는 분은 setup.sql 에 이미 포함돼 있어 이 파일이 필요 없습니다.)
--
-- 모든 문장이 IF NOT EXISTS 라 여러 번 돌려도 안전합니다. 데이터는 지워지지 않습니다.
-- ============================================================

-- 영작 테스트 결과 (통과 / 불통과) — 단어테스트(voca_test)와 같은 방식
alter table daily_records add column if not exists writing_test  text;
-- 영작 테스트 점수 (예: 9/10) — 단어테스트 점수(voca_score)와 같은 방식
alter table daily_records add column if not exists writing_score text;

-- 영작을 「불통과」로 저장하거나 점수가 기준 미달이면, 서버가 재시 안내 큐(retest_sent)에
-- 자동으로 올립니다 (api/attendance.js 의 save-record → lib/retest.js 의 retestQueueValue).
-- 재시 안내 카톡은 단어·영작을 **한 카톡에 같이** 담아 보냅니다.

-- 확인: 아래가 2 가 나오면 끝
select count(*) as 영작칸
from information_schema.columns
where table_name = 'daily_records' and column_name in ('writing_test', 'writing_score');
