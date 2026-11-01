-- ============================================================
-- [테스트 2] 오늘 기록 초기화 → '자동 생성' 흐름 확인
--   오늘 행을 지우면(스케줄은 유지),
--     · /daily.html 을 열 때 → 오늘 수업 예정 학생 행이 '다음 진도'로 자동 생성
--     · /board.html 을 열면  → 수업시간+10분 지난 학생은 '미등원'으로 표시
--   샘플 3명에게만 적용.
-- ============================================================

-- (혹시 스케줄이 비어 있으면) 샘플 3명을 오늘 요일에 수업 있도록 세팅
update students s
set schedule = s.schedule || jsonb_build_object(
  substr('일월화수목금토', extract(dow from (now() at time zone 'Asia/Seoul')::date)::int + 1, 1),
  case s.name when '김민준' then '17:00' when '이서연' then '18:00' else '16:00' end)
where s.name in ('김민준','이서연','박도윤');

-- 오늘 기록 삭제(샘플 3명만)
delete from daily_records d using students s
 where d.student_id = s.id and d.date = (now() at time zone 'Asia/Seoul')::date
   and s.name in ('김민준','이서연','박도윤');

-- 이제 /daily.html 을 새로고침하면 행이 자동으로 생기고, 진도가 '직전의 다음 목차'로 채워집니다.
select '오늘 기록을 지웠어요. /daily.html 을 열어 자동 생성 & 진도 자동 전환을 확인하세요.' as 안내;
