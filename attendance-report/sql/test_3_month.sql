-- ============================================================
-- [테스트 3] 월말평가서용 — '지난달' 한 달치 데일리 리포트 생성
--   현재 날짜 기준 지난달 평일을 채웁니다(진도는 교재 목차에서 뽑음).
--   → /report.html 에서 '지난달'을 선택해 AI 평가서를 바로 생성/저장/발송 테스트.
--   샘플 3명에게만 적용. 여러 번 돌려도 됩니다(지난달 기록을 지우고 다시 넣음).
--
--   ⚠️ AI 평가서 '생성'은 Vercel 환경변수 ANTHROPIC_API_KEY 가 있어야 동작합니다.
--      키가 없어도 통계 집계·저장·학부모 링크 화면은 확인할 수 있어요.
-- ============================================================

-- 지난달 기록 초기화(샘플 3명만)
delete from daily_records d using students s
 where d.student_id = s.id
   and s.name in ('김민준','이서연','박도윤')
   and d.date >= date_trunc('month', (now() at time zone 'Asia/Seoul')::date - interval '1 month')::date
   and d.date <  date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date;

-- 지난달 평일 데일리 리포트 (월초=목차 2번째 → 월말=목차 3번째 유닛)
insert into daily_records
  (student_id, date, check_in, check_out, lateness, attitude, homework, voca_test, voca_score, progress, books)
select
  s.id, d::date,
  '17:0' || (rn % 6), '19:0' || (rn % 6),
  case when rn % 9 = 0 then '결석' when rn % 5 = 0 then '지각' else '정시등원' end,
  case when rn % 4 = 0 then '중' else '상' end,
  case when rn % 6 = 0 then '중' else '100%완료' end,
  case when rn % 9 = 0 then null when rn % 7 = 0 then '불통과' else '통과' end,
  -- 점수는 결과와 맞춰서 (불통과인데 20/20 이면 화면이 틀린 것처럼 보입니다)
  case when rn % 9 = 0 then null
       when rn % 7 = 0 then (10 + (rn % 4)) || '/20'
       else (16 + (rn % 5)) || '/20' end,
  jsonb_strip_nulls(jsonb_build_object(
    '문법', (select t.units -> (case when extract(day from d) <= 15 then 1 else 2 end) from textbooks t where t.name = s.books->>'문법'),
    '리딩', (select t.units -> (case when extract(day from d) <= 15 then 1 else 2 end) from textbooks t where t.name = s.books->>'리딩'),
    '단어', (select t.units -> (case when extract(day from d) <= 15 then 1 else 2 end) from textbooks t where t.name = s.books->>'단어')
  )),
  s.books
from students s
cross join lateral (
  select d, row_number() over (order by d) as rn
  from generate_series(
    date_trunc('month', (now() at time zone 'Asia/Seoul')::date - interval '1 month')::date,
    (date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date - 1),
    '1 day') g(d)
  where extract(dow from d) between 1 and 5
) days
where s.name in ('김민준','이서연','박도윤');

-- 월말 참고사항(선생님 메모) — AI 평가서에 반영됨
insert into monthly_comments (student_id, month, comment)
select id, to_char((now() at time zone 'Asia/Seoul')::date - interval '1 month', 'YYYY-MM'),
  case name
    when '김민준' then '단어 재시험이 몇 번 있었지만 끝까지 통과. 발표에 적극적.'
    when '이서연' then '리딩 속도가 눈에 띄게 빨라짐. 숙제 성실. 중학생이라 내신 대비 필요.'
    else '결석 없이 성실하게 다니고 수업 태도가 좋음.'
  end
from students
where name in ('김민준','이서연','박도윤')
on conflict (student_id, month) do update set comment = excluded.comment;

-- 확인: 지난달이 며칠치 들어갔는지
select to_char((now() at time zone 'Asia/Seoul')::date - interval '1 month', 'YYYY-MM') as 지난달,
       s.name, count(*) as 수업일수
from daily_records d join students s on s.id = d.student_id
where s.name in ('김민준','이서연','박도윤')
  and d.date >= date_trunc('month', (now() at time zone 'Asia/Seoul')::date - interval '1 month')::date
  and d.date <  date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date
group by s.name order by s.name;
