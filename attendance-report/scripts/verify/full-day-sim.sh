#!/bin/bash
# 선생님 하루 전체를 처음부터 끝까지 — 깨끗한 DB + 진짜 PostgreSQL + 가짜 Anthropic
#
#   bash scripts/verify/full-day-sim.sh
#
# 기능 하나하나는 통과하는데 **하루를 이어서** 돌려본 적이 없어서 만들었습니다.
# 등원 → 진도 → 숙제 내기/취소 → 보강 → 결석 → 기록 → 하원 → 발송 → 평가서.
set -u
set +m
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
export PGSOCK="${PGSOCK:-/var/run/postgresql}"
PS="psql -h $PGSOCK -p 5433 -U postgres"
DB=simday
PORT=4333

[ -d node_modules ] || npm i --silent --no-audit --no-fund >/dev/null 2>&1

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

echo "── 깨끗한 DB 에 설치 (수강생이 세미나에서 하는 그대로) ──"
$PS -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PS -d $DB -q -c "create role service_role nologin" -c "create extension if not exists pgcrypto" >/dev/null 2>&1
ERR=$($PS -d $DB -v ON_ERROR_STOP=1 -q -f "$APP/sql/setup.sql" 2>&1 | grep -i error | head -2)
[ -n "$ERR" ] && { echo "❌ setup.sql 오류: $ERR"; exit 1; }
echo "   setup.sql OK"

echo "── 서버 기동 (가짜 Anthropic 포함 — 돈 안 듭니다) ──"
(fuser -k $PORT/tcp >/dev/null 2>&1 || true); (fuser -k 4399/tcp >/dev/null 2>&1 || true); sleep 1
nohup node anthropic-mock.mjs > /tmp/simday-mock.log 2>&1 < /dev/null & disown 2>/dev/null || true
PORT=$PORT TESTDB=$DB ANTHROPIC_API_KEY=sk-ant-fake-for-verify ANTHROPIC_BASE_URL=http://localhost:4399 \
  nohup node app-server.mjs > /tmp/simday-app.log 2>&1 < /dev/null & disown 2>/dev/null || true
for i in $(seq 1 20); do curl -s -o /dev/null localhost:$PORT/ && break; sleep 0.5; done
curl -s -o /dev/null localhost:$PORT/ || { echo "❌ 서버가 안 떴습니다"; tail -5 /tmp/simday-app.log; exit 1; }
echo "   서버 OK"

# 보강 검사를 실제와 같게 — 수업일 아닌 아이의 오늘 행을 지우는 길
export SIM_CLEAR="psql -h $PGSOCK -p 5433 -U postgres -d $DB -q -c \"delete from tasks where student_id='{id}' and date='{date}'\" -c \"delete from daily_records where student_id='{id}' and date='{date}'\""

SIM_BASE="http://127.0.0.1:$PORT" node full-day-sim.mjs
RC=$?

(fuser -k $PORT/tcp >/dev/null 2>&1 || true); (fuser -k 4399/tcp >/dev/null 2>&1 || true)
$PS -q -c "drop database if exists $DB" >/dev/null 2>&1
exit $RC
