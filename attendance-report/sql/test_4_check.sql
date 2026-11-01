-- ============================================================
-- [테스트 4] 확인용 SELECT 모음 (데이터를 바꾸지 않음)
--   필요한 쿼리만 골라서 실행하세요.
-- ============================================================

-- (1) 오늘 현황 — 상태·시간·진도 한눈에
select s.name, s.schedule->>substr('일월화수목금토', extract(dow from (now() at time zone 'Asia/Seoul')::date)::int+1, 1) as 오늘예정,
       d.check_in 등원, d.check_out 하원, d.lateness, d.attitude 태도, d.homework 과제,
       d.voca_test 단어, d.voca_score 점수, d.progress 진도, d.parent_note 추가사항, d.report_sent 리포트카톡
from students s
left join daily_records d on d.student_id = s.id and d.date = (now() at time zone 'Asia/Seoul')::date
where s.status = '재원'
order by s.name;

-- (2) 학생별·월별 기록 수 (어느 달에 데이터가 있는지)
select s.name, to_char(d.date,'YYYY-MM') as 월, count(*) as 수업일수
from daily_records d join students s on s.id = d.student_id
group by s.name, 월 order by 월 desc, s.name;

-- (3) 저장된 월말평가서 (있으면)
select s.name, r.month, left(r.body, 40) || '…' as 미리보기, r.kakao_sent, r.share_token
from monthly_reports r join students s on s.id = r.student_id
order by r.month desc, s.name;

-- (4) 교재 목차(진도 자동 전환의 원천)
select subject 과목, name 교재, jsonb_array_length(units) as 목차수
from textbooks order by subject, name;

-- (5) 학생 요일별 등원 스케줄
select name, schedule from students where status = '재원' order by name;
