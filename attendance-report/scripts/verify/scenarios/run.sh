#!/bin/bash
# 시나리오 검수 — 「깨질 만한 자리」만 모아서 돌립니다.
#
# 왜 따로 있나: 전면 검수(verify.sh)는 **되는 길**을 확인합니다.
#   그런데 실제로 사고가 나는 건 그 바깥입니다 — 날짜를 잘못 치고, 없는 걸 지우고,
#   수기 진도를 적어두고, 같은 PIN 을 두 명에게 주고, 남의 링크를 열어보는 자리.
#   여기서 실제로 여덟 건이 나왔습니다(500 에러 7건 · 수기 진도가 목차로 끌려간 것 1건).
#
# ★ 자기 DB(tapp_sc)와 자기 포트(4332)를 씁니다 — 본 검수 데이터를 흐리지 않게.
#   시나리오마다 DB 를 새로 깝니다. 앞 시나리오가 만든 상태가 뒤에 섞이면
#   「실패」가 떠도 그게 버그인지 순서 탓인지 알 수 없게 됩니다 (실제로 겪었습니다).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
VERIFY="$(cd "$HERE/.." && pwd)"
APP="$(cd "$VERIFY/../.." && pwd)"
cd "$VERIFY"

# 서버가 **진짜 응답할 때까지** 기다립니다 (고정 sleep 은 바쁠 때 모자랍니다).
wait_up() {   # wait_up <url> <최대초>
  local url="$1" max="${2:-40}" i=0
  while [ $i -lt "$max" ]; do
    curl -s -o /dev/null --max-time 2 "$url" && return 0
    i=$((i+1)); sleep 1
  done
  return 1
}

PGSOCK="${PGSOCK:-/var/run/postgresql}"
PS="psql -h $PGSOCK -p 5433 -U postgres"
DB=tapp_sc
PORT=4332
export SC_BASE="http://127.0.0.1:${PORT}"
export SC_SHOTS="${SC_SHOTS:-/tmp/verify-shots}"
mkdir -p "$SC_SHOTS"

if ! $PS -tAc "select 1" >/dev/null 2>&1; then
  echo "❌ 테스트용 PostgreSQL(5433)이 안 떠 있습니다 — verify.sh 안내를 보세요."
  exit 1
fi

# 가짜 Anthropic (평가서 생성에 돈이 들지 않게)
(fuser -k 4399/tcp 2>/dev/null || true); sleep 1
nohup node anthropic-mock.mjs > sc-mock.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 1   # 가짜 Anthropic 은 요청이 와야 응답하므로 기다릴 대상이 없습니다

LIST="1_진도규칙 2_유닛과제 3_권한과비밀값 4_엉뚱한입력 5_등록과평가서
      6_전원_진도과제학생앱 7_전원_출결선생님평가서 8_전원_지각재시학생카드 9_전원_실제화면"

TOTAL=0; FAILS=0; BROKEN=""
for f in $LIST; do
  # 매번 깨끗한 DB
  $PS -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
  $PS -d $DB -q -c "create role service_role nologin" >/dev/null 2>&1   # 이미 있으면 그냥 넘어갑니다
  $PS -d $DB -q -c "create extension if not exists pgcrypto" >/dev/null 2>&1
  $PS -d $DB -v ON_ERROR_STOP=1 -q -f "$APP/sql/setup.sql" >/dev/null 2>&1

  (fuser -k ${PORT}/tcp 2>/dev/null || true); sleep 1
  TESTDB=$DB PORT=$PORT ANTHROPIC_API_KEY=sk-ant-fake-for-verify \
    ANTHROPIC_BASE_URL=http://127.0.0.1:4399 \
    nohup node app-server.mjs > sc-app.log 2>&1 < /dev/null &
  disown 2>/dev/null || true
  if ! wait_up "$SC_BASE/" 40; then
    printf "  %-30s %s\n" "$f" "❌ 서버가 안 떴습니다 (sc-app.log 확인)"
    BROKEN="$BROKEN $f"; FAILS=$((FAILS+1)); continue
  fi

  # 7~9부는 앞 단계가 깔아둔 교재 과제·출결이 있어야 뜻이 있습니다.
  SETUP_OK=1
  case "$f" in
    7_*|8_*|9_*) node scenarios/6_전원_진도과제학생앱.mjs >/dev/null 2>&1 || SETUP_OK=0 ;;
  esac
  case "$f" in
    8_*|9_*) node scenarios/7_전원_출결선생님평가서.mjs >/dev/null 2>&1 || SETUP_OK=0 ;;
  esac
  if [ $SETUP_OK -eq 0 ]; then
    # 밑작업이 깨지면 뒤 결과는 못 믿습니다. 「실패 6건」 으로 보이지만 원인은 여기입니다.
    printf "  %-30s %s\n" "$f" "❌ 밑작업(6·7부)이 실패해 건너뜀"
    BROKEN="$BROKEN $f"; FAILS=$((FAILS+1)); continue
  fi

  OUT=$(node "scenarios/$f.mjs" 2>&1)
  LINE=$(echo "$OUT" | grep -E '^점검 [0-9]+개' | tail -1)
  N=$(echo "$LINE" | sed -E 's/점검 ([0-9]+)개.*/\1/')
  FA=$(echo "$LINE" | sed -E 's/.*실패 ([0-9]+)개/\1/')
  TOTAL=$((TOTAL + ${N:-0})); FAILS=$((FAILS + ${FA:-0}))
  printf "  %-30s %s\n" "$f" "${LINE:-(요약 없음 — sc-app.log 확인)}"
  echo "$OUT" | grep -E '^  ❌' | sed 's/^/    /'
  [ "${FA:-1}" != "0" ] && BROKEN="$BROKEN $f"
done

(fuser -k ${PORT}/tcp 2>/dev/null || true)
(fuser -k 4399/tcp 2>/dev/null || true)
$PS -q -c "drop database if exists $DB" >/dev/null 2>&1

echo
if [ -z "$BROKEN" ]; then
  echo "✅ 시나리오 전부 통과 (점검 ${TOTAL}개)"
  exit 0
fi
echo "❌ 시나리오 실패:${BROKEN}  (점검 ${TOTAL}개 · 실패 ${FAILS}개)"
exit 1
