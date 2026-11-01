#!/bin/bash
# 「진도 자동 전환」 매일 점검 — 세미나(11/1)까지 하루 한 번 돌린다.
#
# 왜 따로 두나: 이 세미나의 간판이 '진도를 손으로 안 쓴다' 인데, 여기가 조용히 깨지면
# 당일 수강생 화면에서 바로 들통난다. verify.sh 는 전면 검수(느림)라서
# 이 스크립트는 **진도 사슬만** 빠르게 본다.
#
# 쓰는 법:  bash scripts/verify/daily-progress-check.sh
# 마지막 줄이 "✅ 진도 점검 통과" 여야 한다. 아니면 그 위에 이유가 찍힌다.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
export PGSOCK="${PGSOCK:-/var/run/postgresql}"   # /tmp 는 정리돼서 소켓이 사라집니다
PS="psql -h $PGSOCK -p 5433 -U postgres"
DB=pcheck
FAIL=0
note() { echo "  $1"; }
bad()  { echo "  ❌ $1"; FAIL=1; }

# ── 0. 테스트용 PostgreSQL 준비 (없으면 만들고, 꺼져 있으면 켠다) ──────────
if ! $PS -tAc "select 1" >/dev/null 2>&1; then
  if [ ! -f /var/lib/pgtest/PG_VERSION ]; then
    rm -rf /var/lib/pgtest && mkdir -p /var/lib/pgtest && chown postgres:postgres /var/lib/pgtest
    su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/pgtest -A trust -U postgres" >/dev/null 2>&1
  fi
  su postgres -s /bin/bash -c \
    "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/pgtest -o '-p 5433 -k /var/run/postgresql' -l /var/lib/pgtest/log start" >/dev/null 2>&1
  sleep 3
fi
$PS -tAc "select 1" >/dev/null 2>&1 || { echo "❌ 테스트용 PostgreSQL(5433)을 못 띄웠습니다"; exit 1; }

cd "$HERE"
[ -d node_modules ] || npm i --silent --no-audit --no-fund >/dev/null 2>&1

echo "── 깨끗한 DB 에 설치 ──"
$PS -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PS -d $DB -q -c "create role service_role nologin" -c "create extension if not exists pgcrypto" >/dev/null 2>&1
ERR=$($PS -d $DB -v ON_ERROR_STOP=1 -q -f "$APP/sql/setup.sql" 2>&1 | grep -i error | head -2)
[ -n "$ERR" ] && { echo "❌ setup.sql 오류: $ERR"; exit 1; }
note "setup.sql OK"

echo "── 서버 기동 ──"
(fuser -k 4331/tcp >/dev/null 2>&1 || true); sleep 1
PORT=4331 TESTDB=$DB nohup node app-server.mjs > /tmp/pcheck.log 2>&1 < /dev/null &
disown 2>/dev/null || true
for i in $(seq 1 20); do
  curl -s -o /dev/null localhost:4331/ && break; sleep 0.5
done
curl -s -o /dev/null localhost:4331/ || { echo "❌ 서버가 안 떴습니다"; tail -5 /tmp/pcheck.log; exit 1; }
note "서버 OK"

# ── 1. 한 학생의 수업일을 차례로 돌려 진도가 한 칸씩 가는지 ───────────────
echo "── 1. 진도가 한 칸씩 넘어가나 ──"
SID=$($PS -d $DB -tAc "select id from students where name='김민준'")
[ -z "$SID" ] && { echo "❌ 샘플 학생(김민준)이 없습니다"; exit 1; }
$PS -d $DB -q -c "delete from daily_records where student_id='$SID'" >/dev/null

# 김민준은 월·수·금 수업. 연속한 수업일 5번을 만든다.
for d in 2026-10-05 2026-10-07 2026-10-09 2026-10-12 2026-10-14; do
  curl -s "localhost:4331/api/attendance?action=daily-rows&date=$d" -o /dev/null
done

CHAIN=$($PS -d $DB -tAc "
  select string_agg(progress->'문법'->>'code', ' → ' order by date)
  from daily_records where student_id='$SID'")
note "문법: $CHAIN"
# ★ 기대값을 **목차에서 읽어옵니다.** 예전에는 "Unit 1 → Unit 2 …" 를 박아뒀는데,
#   샘플 교재를 바꾸는 순간 멀쩡한데도 실패했습니다 (실제로 그렇게 헛걸렸습니다).
EXPECT=$($PS -d $DB -tAc "
  select string_agg(u ->> 'code', ' → ' order by i)
  from students s
  join textbooks t on t.name = s.books ->> '문법'
  cross join lateral jsonb_array_elements(t.units) with ordinality as x(u, i)
  where s.id='$SID' and i <= 5")
[ "$CHAIN" = "$EXPECT" ] || bad "기대: $EXPECT"

# ── 2. 아직 안 쓴 날을 만들면 '다음 목차'가 들어오나 (cron 과 같은 길) ────
echo "── 2. 다음 수업일에 다음 목차가 미리 들어오나 ──"
curl -s "localhost:4331/api/attendance?action=daily-rows&date=2026-10-16" -o /dev/null
NEXT=$($PS -d $DB -tAc "
  select progress->'문법'->>'code' from daily_records where student_id='$SID' and date='2026-10-16'")
# 목차의 **여섯 번째 줄**이 들어와야 합니다 (코드 글자를 박아두지 않습니다)
SIXTH=$($PS -d $DB -tAc "
  select u ->> 'code'
  from students s
  join textbooks t on t.name = s.books ->> '문법'
  cross join lateral jsonb_array_elements(t.units) with ordinality as x(u, i)
  where s.id='$SID' and i = 6")
note "10/16 문법: $NEXT  (목차 6번째 = $SIXTH)"
[ "$NEXT" = "$SIXTH" ] || bad "10/16 은 목차 6번째($SIXTH)여야 합니다 — 받은 값: $NEXT"

# ── 3. 미래 날짜는 저장하지 않나 (월말평가서 수업일수가 부풀면 안 됨) ────
echo "── 3. 미래 날짜는 행을 만들지 않나 ──"
BEFORE=$($PS -d $DB -tAc "select count(*) from daily_records where student_id='$SID'")
curl -s "localhost:4331/api/attendance?action=daily-rows&date=2026-12-21" -o /dev/null
AFTER=$($PS -d $DB -tAc "select count(*) from daily_records where student_id='$SID'")
note "미래 날짜 조회 전 $BEFORE 행 → 조회 후 $AFTER 행"
[ "$BEFORE" = "$AFTER" ] || bad "미래 날짜를 열어보기만 했는데 행이 생겼습니다 (수업일수가 부풀어 학부모에게 틀린 숫자가 나갑니다)"

# ── 3-2. 목차 경계 동작 (끝에서 멈춤 · 수기 진도 인식 등) ────────────────
echo "── 3-2. 목차 경계 동작 ──"
node "$HERE/progress-unit.mjs" 2>&1 | sed 's/^/  /'
[ ${PIPESTATUS[0]:-0} -eq 0 ] || bad "경계 동작 점검 실패 (위 참고)"

# ── 4. 샘플 SQL 을 돌렸을 때 진도가 거꾸로 가는 행이 없나 ─────────────────
#     (test_5/test_1 이 오늘 진도를 고정값으로 넣던 문제 — 2026-10-15 수정)
echo "── 4. 샘플 SQL 을 돌려도 진도가 거꾸로 안 가나 ──"
for order in "test_5_demo_students test_1_today test_3_month" "test_3_month test_5_demo_students test_1_today"; do
  $PS -q -c "drop database if exists ${DB}2" -c "create database ${DB}2" >/dev/null 2>&1
  $PS -d ${DB}2 -q -c "create role service_role nologin" -c "create extension if not exists pgcrypto" >/dev/null 2>&1
  $PS -d ${DB}2 -q -v ON_ERROR_STOP=1 -f "$APP/sql/setup.sql" >/dev/null 2>&1
  for f in $order; do
    $PS -d ${DB}2 -q -v ON_ERROR_STOP=1 -f "$APP/sql/$f.sql" >/dev/null 2>&1
  done
  # ★ **목차에서 몇 번째 줄인가**로 비교합니다. 예전에는 코드에서 숫자만 뽑아 비교했는데,
  #   「CH1-4」(→14) 다음 「CH1-복습」(→1) 이 거꾸로 간 것으로 잡혔습니다.
  #   복습 줄이 있는 교재면 멀쩡한데도 실패합니다.
  BACK=$($PS -d ${DB}2 -tAc "
    with 자리 as (
      select t.name as 교재, u ->> 'code' as code, i
      from textbooks t
      cross join lateral jsonb_array_elements(t.units) with ordinality as x(u, i)),
    r as (
      select d.date, d.student_id,
             z.i as c
      from daily_records d
      join students s on s.id = d.student_id
      left join 자리 z
        on z.교재 = coalesce(d.books ->> '문법', s.books ->> '문법')
       and z.code = d.progress->'문법'->>'code'),
    t as (
      select date, c, lag(c) over (partition by student_id order by date) as p from r)
    select count(*) from t
    where date=(now() at time zone 'Asia/Seoul')::date
      and p is not null and c is not null and c < p")
  note "순서 [$(echo $order | sed 's/ / -> /g')] 거꾸로 가는 행: $BACK"
  [ "$BACK" = "0" ] || bad "진도가 거꾸로 가는 행이 $BACK 개 있습니다"

  # ── 샘플끼리 출결PIN 이 겹치면 **설치 직후 명단에 빨간 경고가 뜹니다.**
  #    키오스크는 PIN 만으로 학생을 찾으니 겹친 학생은 등원이 안 됩니다.
  #    샘플을 손볼 때 조용히 깨질 자리라 여기서 못 박습니다.
  DUP=$($PS -d ${DB}2 -tAc "
    select coalesce(string_agg(x, ' / '), '') from (
      select pin || ' → ' || string_agg(name, ', ') as x
      from students where status = '재원' and coalesce(pin, '') <> ''
      group by pin having count(*) > 1) t")
  [ -z "$DUP" ] || bad "샘플 학생의 출결PIN 이 겹칩니다 ($DUP) — 설치 직후 경고가 뜹니다"
  NOPIN=$($PS -d ${DB}2 -tAc "select count(*) from students where status='재원' and coalesce(pin,'')=''")
  [ "$NOPIN" = "0" ] || bad "출결PIN 이 빈 샘플 학생이 $NOPIN 명 — 그 학생은 키오스크·학생앱이 안 됩니다"
  note "출결PIN: 겹침 없음 · 빈 학생 없음"

  # ── ★ **유령 수업일** — 그날 수업이 없는 학생에게 행을 깔면 안 됩니다.
  #    setup.sql 이 요일을 안 보고 전원에게 오늘 행을 깔아서, 토요일에 수업이 없는
  #    학생의 월말 **총수업일수가 1** 로 나왔습니다 (정시·지각·결석 어디에도 안 들어감).
  #    앱은 미래 날짜에 대해 막아뒀는데 정작 샘플 SQL 이 만들고 있었습니다.
  GHOST=$($PS -d ${DB}2 -tAc "
    select count(*) from daily_records r join students s on s.id = r.student_id
    where r.date = (now() at time zone 'Asia/Seoul')::date
      and coalesce(s.schedule ->> substr('일월화수목금토',
            extract(dow from r.date)::int + 1, 1), '') = ''")
  [ "$GHOST" = "0" ] || bad "그날 수업이 없는 학생에게 오늘 행이 $GHOST 개 깔렸습니다 — 월말 수업일수가 부풀어 학부모에게 틀린 숫자가 나갑니다"

  # 그리고 **어느 요일에 설치해도 화면이 비면 안 됩니다** (세미나 당일이 일요일입니다)
  THIN=$($PS -d ${DB}2 -tAc "
    select coalesce(string_agg(d || '요일 ' || n || '명', ', '), '') from (
      select d, count(*) n from students s, unnest(array['월','화','수','목','금','토','일']) d
      where s.status='재원' and coalesce(s.schedule->>d,'') <> '' group by d) t
    where n < 4")
  [ -z "$THIN" ] || bad "수업 예정이 너무 적은 요일이 있습니다 ($THIN) — 그날 설치하면 화면이 휑합니다"
  # ── ★ **자료가 예시로 드는 학생**은 어느 요일에 설치해도 수업이 있어야 합니다.
  #    핸드아웃·교재·키오스크 안내가 전부 demo01(1111)·demo02·demo03 을 예시로 듭니다.
  #    세미나 당일이 일요일인데 demo01 이 월~금만이면, 그날 「로그인해서 과제를
  #    체크해 보세요」 가 **빈 화면**으로 끝납니다 (리허설에서 발견).
  #    (키오스크는 수업일이 아니어도 등원이 되니 demo02·03 은 괜찮고,
  #     **학생앱 과제 체크 데모**를 하는 demo01 만 요일이 다 있으면 됩니다)
  #    ⚠️ bash 는 한글 변수명을 못 씁니다 — 여기서 세 번째로 데었습니다.
  MISSDAY=$($PS -d ${DB}2 -tAc "
    select coalesce(string_agg(d, ', '), '') from
      unnest(array['월','화','수','목','금','토','일']) d
    where coalesce((select s.schedule ->> d from students s where s.student_code = 'demo01'), '') = ''")
  [ -z "$MISSDAY" ] || bad "학생앱 데모용 학생(demo01)이 $MISSDAY 요일엔 수업이 없습니다 — 그날 설치하면 「로그인해서 과제 체크」 가 빈 화면입니다"
  note "오늘 행: 유령 없음 · 요일마다 학생 충분 · 예시 학생은 요일 전부 있음"
done

(fuser -k 4331/tcp >/dev/null 2>&1 || true)
$PS -q -c "drop database if exists $DB" -c "drop database if exists ${DB}2" >/dev/null 2>&1

echo
[ $FAIL -eq 0 ] && echo "✅ 진도 점검 통과" || echo "❌ 진도 점검 실패 — 위 ❌ 줄을 보세요"
exit $FAIL
