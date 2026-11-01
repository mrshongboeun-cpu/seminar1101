-- ============================================================
-- 마이그레이션: 🔁 재시 안내 카톡 (daily_records.retest_sent)
--
-- ⚠️ 이미 `setup.sql` 을 돌려 **실제 학생 데이터가 들어 있는** 경우,
--    setup.sql 을 다시 돌리면 맨 앞의 `drop table` 때문에 데이터가 전부 사라집니다.
--    그런 분은 setup.sql 대신 **이 파일만** SQL Editor 에 붙여넣고 Run 하세요.
--    (처음 설치하시는 분은 setup.sql 에 이미 포함돼 있어 이 파일이 필요 없습니다.)
--
-- 모든 문장이 IF NOT EXISTS 라 여러 번 돌려도 안전합니다.
-- ============================================================

-- 재시 안내 카톡 상태
--   빈값(null) = 보낼 일 없음 / '미전송' = 발송 대기 / '전송' = 보냄
-- 데일리 리포트에서 단어테스트를 **'불통과'로 저장하면 서버가 '미전송'으로 자동 올립니다**
-- (api/attendance.js 의 save-record → retestQueueValue). 선생님은 보내기만 누르면 됩니다.
alter table daily_records add column if not exists retest_sent text;

-- ── 이미 쌓인 기록 중 「불통과인데 아직 안 보낸」 행을 큐에 올립니다 ──
-- (이 줄은 **한 번만** 돌려도 되고 여러 번 돌려도 같은 결과입니다)
-- ⚠️ 지난 날짜까지 전부 큐에 올라오는 게 부담이면 아래 `and date >= (now() at time zone 'Asia/Seoul')::date` 를 살려 주세요.
update daily_records
set retest_sent = '미전송'
where retest_sent is null
  and voca_test ~ '불통과|미통과'
  -- and date >= (now() at time zone 'Asia/Seoul')::date
;

-- 올라온 개수 확인
select date, count(*) as 재시_대기
from daily_records
where retest_sent = '미전송'
group by date
order by date desc
limit 20;

-- ============================================================
-- ★ 이 다음에 할 일 (Vercel)
--   환경변수 `TPL_RETEST` 에 **재시 안내용 카카오 템플릿 ID** 를 넣어주세요.
--   변수: #{학생이름} #{날짜} #{단어교재} #{단어테스트} #{점수}
--   비워두면 큐에만 쌓이고 발송은 조용히 건너뜁니다 (다른 기능엔 영향 없음).
--   → 템플릿 검수에 1~2영업일 걸리니 먼저 솔라피에 올려두세요.
-- ============================================================
