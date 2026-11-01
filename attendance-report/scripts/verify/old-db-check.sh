#!/bin/bash
# 「쓰던 DB」로 설치했을 때를 **일부러 만들어** 돌려봅니다.
#
# 왜: 검수는 늘 새로 깐 DB만 봤습니다. 그런데 1·2차 수강생은 **전원이 쓰던 DB**로 옵니다.
#   그분들 DB에는 retest_sent 도 tasks 표도 tasks.auto 도 없습니다.
#   원장님이 리허설에서 두 번 막히셨고, 둘 다 검수가 한 번도 안 본 자리였습니다.
#
#   bash scripts/verify/old-db-check.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
PGSOCK="${PGSOCK:-/var/run/postgresql}"
PS="psql -h $PGSOCK -p 5433 -U postgres"
DB=tapp_old

if ! $PS -tAc "select 1" >/dev/null 2>&1; then
  echo "❌ 테스트용 PostgreSQL(5433)이 안 떠 있습니다 — verify.sh 안내를 보세요."; exit 1
fi

echo "── 새 DB 를 깐 뒤, 1·2차 수강생 DB 처럼 **깎아냅니다** ──"
$PS -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PS -d $DB -q -c "create role service_role nologin" -c "create extension if not exists pgcrypto" >/dev/null 2>&1
$PS -d $DB -v ON_ERROR_STOP=1 -q -f "$APP/sql/setup.sql" >/dev/null 2>&1 || { echo "❌ setup.sql 실패"; exit 1; }

# 1·2차 수강생 DB 에 **없는 것들** (6차에서 더해진 칸·표)
$PS -d $DB -q \
  -c "alter table daily_records drop column if exists retest_sent" \
  -c "alter table students drop column if exists school" \
  -c "drop table if exists tasks cascade" >/dev/null 2>&1
echo "   retest_sent 칸 · students.school 칸 · tasks 표를 지웠습니다"

echo
MODE=before TESTDB=$DB node old-db-check.mjs; A=$?

echo
echo "── migrate 를 돌립니다 (수강생이 안내대로 하는 것) ──"
for f in migrate_retest.sql migrate_tasks.sql migrate_auto_tasks.sql migrate_school.sql; do
  if [ -f "$APP/sql/$f" ]; then
    ERR=$($PS -d $DB -q -f "$APP/sql/$f" 2>&1 | grep -iE "^ERROR" | head -1)
    [ -n "$ERR" ] && echo "   ❌ $f — $ERR" || echo "   ✅ $f"
  fi
done

# tasks 표를 다시 만들었으니 오늘 과제를 한 번 깔아줍니다
#   (앱은 진도가 정해질 때 깝니다 — 여기서는 그 자리를 대신 눌러주는 셈)
$PS -d $DB -q -c "
insert into tasks (student_id, date, kind, subject, title, done, auto)
select r.student_id, r.date, '집', sub.key, 집.value, false, true
from daily_records r
cross join lateral jsonb_each(r.progress) sub
join textbooks t on t.name = r.books ->> sub.key
cross join lateral jsonb_array_elements(t.units) u
cross join lateral jsonb_array_elements_text(coalesce(u.value -> '집과제','[]'::jsonb)) 집
where r.date = (now() at time zone 'Asia/Seoul')::date
  and u.value ->> 'code' = sub.value ->> 'code'" >/dev/null 2>&1

echo
MODE=after TESTDB=$DB node old-db-check.mjs; B=$?

$PS -q -c "drop database if exists $DB" >/dev/null 2>&1
if [ $A -eq 0 ] && [ $B -eq 0 ]; then
  echo "
✅ 쓰던 DB 로 설치해도 — 화면이 고치는 법을 말해주고, migrate 로 실제로 고쳐집니다."
  exit 0
else
  echo "
❌ 쓰던 DB 검수 실패 — 1·2차 수강생이 당일에 막힙니다."
  exit 1
fi
