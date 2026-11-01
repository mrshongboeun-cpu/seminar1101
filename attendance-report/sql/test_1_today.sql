-- ============================================================
-- [테스트 1] 오늘 현황판 + 데일리 리포트 (다양한 상태)
--   · 샘플 3명을 '오늘 요일'에 수업 있도록 맞추고
--   · 오늘 기록을 서로 다른 상태로 생성 → 현황판/데일리 리포트에서 바로 확인
--   여러 번 돌려도 됩니다(오늘 행을 지우고 다시 넣음). 샘플 3명에게만 적용.
--
--   예상 상태(현재 시각에 따라 달라짐):
--     김민준 = 등원(또는 곧 하원)  ·  이서연 = 하원  ·  박도윤 = 미등원(수업시간+10분 지난 뒤)
-- ============================================================

-- (1) 샘플 3명 모두 '오늘 요일'에 수업 있도록 등원시간 세팅
update students s
set schedule = s.schedule || jsonb_build_object(
  substr('일월화수목금토', extract(dow from (now() at time zone 'Asia/Seoul')::date)::int + 1, 1),
  case s.name when '김민준' then '17:00' when '이서연' then '18:00' else '16:00' end)
where s.name in ('김민준','이서연','박도윤');

-- (2) 오늘 기록 초기화(샘플 3명만) 후 재생성
delete from daily_records d using students s
 where d.student_id = s.id and d.date = (now() at time zone 'Asia/Seoul')::date
   and s.name in ('김민준','이서연','박도윤');

-- (3) 진도는 교재 목차의 4번째(index 3)로 — 직전 수업(지난 기록)과 비교되어 보임
insert into daily_records
  (student_id, date, check_in, check_out, lateness, attitude, homework, voca_test, voca_score, progress, books, parent_note, report_sent)
select s.id, (now() at time zone 'Asia/Seoul')::date,
  v.check_in, v.check_out, v.lateness, v.attitude, v.homework, v.voca_test, v.voca_score,
  jsonb_strip_nulls(jsonb_build_object(
    '문법', (select t.units -> 3 from textbooks t where t.name = s.books->>'문법'),
    '리딩', (select t.units -> 3 from textbooks t where t.name = s.books->>'리딩'),
    '단어', (select t.units -> 3 from textbooks t where t.name = s.books->>'단어')
  )),
  s.books, v.parent_note, '미전송'
from students s
join (values
  -- name,   등원,     하원,      지각/결석, 태도, 과제, 단어테스트, 점수,    추가사항(학부모 카톡)
  ('김민준','17:02', cast(null as text), '정시','상','상','통과',   '20/20','오늘 발표를 아주 잘했어요. 칭찬 많이 해주세요!'),
  ('이서연','18:20', '20:50',            '지각','중','상','불통과', '13/20', cast(null as text)),
  ('박도윤', cast(null as text), cast(null as text), cast(null as text), '상','상', cast(null as text), cast(null as text), cast(null as text))
) as v(name, check_in, check_out, lateness, attitude, homework, voca_test, voca_score, parent_note)
  on v.name = s.name
-- ★ 그날 수업이 있는 학생에게만. 요일을 안 보면 **유령 수업일**이 생겨
--   월말 총수업일수가 부풀고, 정시·지각·결석 어디에도 안 들어갑니다.
where coalesce(s.schedule ->> substr('일월화수목금토',
    extract(dow from (now() at time zone 'Asia/Seoul')::date)::int + 1, 1), '') <> '';

-- ── 오늘 진도를 '직전 수업의 다음 목차'로 바로잡기 ────────────────────────────
-- 위에서 오늘 기록을 넣을 때 진도를 목차의 고정 위치(4번째)로 박아 넣었습니다.
-- 그런데 test_3_month.sql 로 지난달을 채우면 직전 수업이 이미 그보다 앞서 있어서,
-- 화면에 **지난 10/14 5과 → 오늘 4과** 처럼 진도가 거꾸로 가는 것으로 보입니다.
-- (앱의 자동 전환은 정상입니다 — 샘플을 손으로 박아 넣어서 생기는 어긋남입니다.)
-- 이 세미나의 간판이 '진도 자동'이라 그대로 두면 고장난 것처럼 보여서, 넣은 뒤 바로잡습니다.
update daily_records t
set progress = (
  select jsonb_strip_nulls(jsonb_object_agg(x.subj, x.unit))
  from (
    select subj,
           (select tb.units -> (least(
                     coalesce(
                       (select i - 1 from jsonb_array_elements(tb.units) with ordinality u(e, i)
                         where e->>'code' = prev.code),
                       -1) + 1,
                     jsonb_array_length(tb.units) - 1))::int
            from textbooks tb where tb.name = s.books->>subj) as unit
    from (values ('문법'), ('리딩'), ('단어')) as sub(subj)
    cross join lateral (
      select (d.progress->subj->>'code') as code
      from daily_records d
      where d.student_id = t.student_id and d.date < t.date
        and d.progress->subj->>'code' is not null
      order by d.date desc limit 1
    ) prev
  ) x
)
from students s
where s.id = t.student_id
  and t.date = (now() at time zone 'Asia/Seoul')::date
  and exists (select 1 from daily_records d2
               where d2.student_id = t.student_id and d2.date < t.date);

-- 확인: 방금 넣은 오늘 기록
select s.name, d.check_in, d.check_out, d.lateness, d.attitude, d.homework,
       d.voca_test, d.voca_score, d.progress, d.parent_note, d.report_sent
from daily_records d join students s on s.id = d.student_id
where d.date = (now() at time zone 'Asia/Seoul')::date and s.name in ('김민준','이서연','박도윤')
order by s.name;
