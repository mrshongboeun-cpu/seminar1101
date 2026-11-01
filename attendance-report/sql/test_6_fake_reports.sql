-- ============================================================
-- [테스트 6] 가짜 월말평가서 심기 (AI 호출 없이 화면 확인용)
--   샘플 3명(김민준·이서연·박도윤)의 '지난달' 평가서를 본문까지 채워 저장.
--   → /report.html 지난달에 '저장됨' 배지 + 학부모 링크
--   → /parent.html?t=... 로 부모님 화면 그대로 확인
--   여러 번 돌려도 됩니다(같은 학생·월이면 갱신). 열람 토큰: demokim / demolee / demopark
-- ============================================================

with rp as (
  select * from (values
    ('김민준', 18, 1, 0, 92, 88, 90, 'demokim',
      E'민준이의 학습 리포트\n\n민준이는 이번 달 거의 매 수업 정시에 등원하며 안정적으로 학습을 이어갔습니다. 발표에 적극적이어서 수업 분위기를 밝게 이끄는 모습이 자주 보였습니다.\n\n문법은 현재완료와 조동사의 쓰임을 익히는 데 집중했습니다. 개념을 예문으로 확인한 뒤 스스로 문장을 만들어 보는 연습을 반복하면서 시제를 구분하는 감각이 한결 좋아졌습니다.\n\n리딩은 짧은 지문에서 주어와 동사를 먼저 찾고 문장을 끊어 읽는 훈련을 꾸준히 했습니다. 단어는 대체로 잘 통과하는 편이며, 재시험이 있어도 끝까지 완수하는 성실함을 보였습니다.\n\n다음 달에는 배운 문법을 문장 쓰기로 연결하고, 리딩 지문의 흐름을 우리말로 요약하는 연습을 더해 이해의 깊이를 키우려 합니다. 가정에서는 그날 배운 단어를 저녁에 한 번 더 소리 내어 읽어 보도록 격려해 주시면 큰 도움이 됩니다.'),
    ('이서연', 19, 2, 1, 88, 84, 85, 'demolee',
      E'서연이의 학습 리포트\n\n서연이는 이번 달에도 거의 빠짐없이 정시에 등원하며 성실한 태도를 이어갔습니다. 이해가 부족한 부분을 스스로 질문으로 확인하려는 모습이 늘어 반가웠습니다.\n\n문법은 완료시제를 다진 뒤 수동태 단원까지 학습을 이어갔고, 능동과 수동의 관계를 스스로 바꿔 쓰는 훈련을 반복했습니다. 개념을 문장에 적용하는 속도가 점차 빨라지고 있습니다.\n\n리딩은 지문을 읽는 속도가 눈에 띄게 빨라졌습니다. 문장을 끊어 읽고 중심 내용을 요약하는 방식이 자리 잡히면서 긴 지문에서도 흐름을 놓치지 않으려는 태도가 좋아졌습니다. 단어는 꾸준히 통과하는 편입니다.\n\n중학생인 만큼 다음 달에는 내신과 서술형 대비에 조금 더 무게를 두려 합니다. 배운 문법을 서술형 문장으로 직접 써 보고, 리딩 지문의 핵심을 우리말로 요약하는 훈련을 병행할 계획입니다. 가정에서는 짧은 영어 문장을 하루 한두 개씩 스스로 만들어 보도록 격려해 주시면 도움이 됩니다.'),
    ('박도윤', 20, 0, 0, 95, 90, 95, 'demopark',
      E'도윤이의 학습 리포트\n\n도윤이는 이번 달 결석 없이 성실하게 다녔고, 차분한 태도로 수업에 잘 참여했습니다.\n\n문법은 기초 개념을 또박또박 다지는 단계로, be동사와 일반동사의 쓰임을 문장 속에서 구분하는 연습을 반복했습니다. 아직 헷갈리는 부분이 있지만 반복하면서 점차 정확해지고 있습니다.\n\n리딩은 짧은 글을 소리 내어 읽고 내용을 이해하는 데 집중했고, 단어는 꾸준히 통과하며 어휘의 기초를 탄탄히 쌓고 있습니다.\n\n다음 달에는 문장을 스스로 만들어 보는 연습을 조금씩 늘려 표현의 폭을 넓히려 합니다. 가정에서는 짧은 영어책을 하루 몇 줄씩 함께 읽어 주시면 읽기에 자신감이 붙습니다.')
  ) as v(name, class_days, late, absent, voca_rate, hw_rate, at_rate, token, body)
)
insert into monthly_reports (student_id, month, body, stats, progress, share_token, kakao_sent, updated_at)
select
  s.id,
  to_char((now() at time zone 'Asia/Seoul')::date - interval '1 month', 'YYYY-MM'),
  rp.body,
  jsonb_build_object('classDays',rp.class_days,'late',rp.late,'absent',rp.absent,'vocaRate',rp.voca_rate,'hwRate',rp.hw_rate,'atRate',rp.at_rate),
  jsonb_strip_nulls(jsonb_build_object(
    '문법', jsonb_build_object('교재명', s.books->>'문법', '유닛코드', (select t.units->3->>'code' from textbooks t where t.name=s.books->>'문법'), '제목', (select t.units->3->>'title' from textbooks t where t.name=s.books->>'문법')),
    '리딩', jsonb_build_object('교재명', s.books->>'리딩', '유닛코드', (select t.units->3->>'code' from textbooks t where t.name=s.books->>'리딩'), '제목', (select t.units->3->>'title' from textbooks t where t.name=s.books->>'리딩')),
    '단어', jsonb_build_object('교재명', s.books->>'단어', '유닛코드', (select t.units->3->>'code' from textbooks t where t.name=s.books->>'단어'), '제목', (select t.units->3->>'title' from textbooks t where t.name=s.books->>'단어'))
  )),
  rp.token,
  false,
  now()
from students s
join rp on rp.name = s.name
on conflict (student_id, month) do update
  set body = excluded.body, stats = excluded.stats, progress = excluded.progress,
      share_token = excluded.share_token, updated_at = now();

-- 확인: 열람 링크 (이 토큰을 /parent.html?t= 뒤에 붙이면 부모님 화면)
select s.name, to_char((now() at time zone 'Asia/Seoul')::date - interval '1 month','YYYY-MM') as 월,
       '/parent.html?t=' || r.share_token as 부모님_링크
from monthly_reports r join students s on s.id = r.student_id
where r.share_token in ('demokim','demolee','demopark')
order by s.name;
