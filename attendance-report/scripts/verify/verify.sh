#!/bin/bash
# attendance-report 전면 검수 — 매번 깨끗한 DB에서 처음부터.
set -u
set +m   # 백그라운드 서버를 죽일 때 "Killed" 알림이 뜨지 않게 (수강생이 오류로 오해함)
HERE="$(cd "$(dirname "$0")" && pwd)"   # 검수 스크립트 폴더
APP="$(cd "$HERE/../.." && pwd)"        # attendance-report 루트
cd "$HERE"
# ★ 소켓·데이터를 /tmp 에 두지 마세요. /tmp 가 정리되면서 소켓이 사라지고
#   "PostgreSQL 이 안 떠 있습니다" 로 검수가 멈춥니다 (여러 번 겪음).
export PGSOCK="${PGSOCK:-/var/run/postgresql}"
PS="psql -h $PGSOCK -p 5433 -U postgres"

# 검수용 패키지(앱 배포와 무관 — 이 폴더에만 설치)
if [ ! -d node_modules ]; then
  echo "── 검수용 패키지 설치 (처음 한 번) ──"
  npm i --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "❌ npm 설치 실패"; exit 1; }
fi

# 테스트용 PostgreSQL 이 떠 있는지 먼저 확인 (안 떠 있으면 setup.sql 오류로 오인됨)
if ! $PS -tAc "select 1" >/dev/null 2>&1; then
  cat <<'MSG'
❌ 테스트용 PostgreSQL(5433)이 안 떠 있습니다. 아래로 먼저 띄우세요.

  PGDATA=/var/lib/pgtest
  rm -rf $PGDATA && mkdir -p $PGDATA && chown postgres:postgres $PGDATA
  su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -A trust -U postgres"
  su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-p 5433 -k /var/run/postgresql' -l $PGDATA/log start"

(설치가 안 돼 있으면: apt-get install -y postgresql)
MSG
  exit 1
fi

echo "── 0. 깨끗한 DB 만들기 ──"
$PS -q -c "drop database if exists tapp" -c "create database tapp" >/dev/null 2>&1
$PS -d tapp -q -c "create role service_role nologin" -c "create extension if not exists pgcrypto" >/dev/null 2>&1
ERR=$($PS -d tapp -v ON_ERROR_STOP=1 -q -f "$APP/sql/setup.sql" 2>&1 | grep -i error | head -3)
if [ -n "$ERR" ]; then echo "❌ setup.sql 오류:"; echo "$ERR"; exit 1; fi
echo "  setup.sql OK"

echo "── 1. 스키마 ↔ 코드 컬럼 대조 ──"
TESTDB=tapp node audit-schema.mjs > /tmp/schema.out 2>&1; S=$?; tail -3 /tmp/schema.out
[ $S -ne 0 ] && echo "  ⚠️ 스키마 대조 실패 (위 내용 확인)"

echo "── 2. 서버 기동 (진짜 PostgreSQL) ──"
(fuser -k 4330/tcp 2>/dev/null || true); sleep 1
TESTDB=tapp nohup node app-server.mjs > app.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 3
curl -s -o /dev/null -w "  서버 %{http_code}\n" localhost:4330/

echo "── 3. API 전수 검사 ──"
node e2e-api.mjs > /tmp/e2e.out 2>&1; A=$?; tail -4 /tmp/e2e.out

echo "── 3-1. 월말평가서 · 진도 조정 (가짜 Anthropic) ──"
#  간판 두 가지. AI 호출은 가짜 서버로 받아서 돈이 들지 않습니다.
(fuser -k 4330/tcp 2>/dev/null || true); (fuser -k 4399/tcp 2>/dev/null || true); sleep 1
nohup node anthropic-mock.mjs > mock-anthropic.log 2>&1 < /dev/null &
disown 2>/dev/null || true
TESTDB=tapp ANTHROPIC_API_KEY=sk-ant-fake-for-verify \
  ANTHROPIC_BASE_URL=http://localhost:4399 \
  nohup node app-server.mjs > app.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 3
node report-progress-check.mjs > /tmp/report.out 2>&1; R=$?; tail -4 /tmp/report.out
#  가짜 Anthropic 은 3-1-B 까지 쓰므로 여기서 죽이지 않습니다.

echo "── 3-1-B. 학생 등록 → 키오스크 → 진도 수정 → 평가서 → 학부모 ──"
#  수강생이 당일에 걷는 길을 처음부터 끝까지. 한 명씩 등록·붙여넣기 일괄등록이
#  검수에 빠져 있어서 넣었습니다 (PART TWO 의 첫 단추).
node student-flow-check.mjs > /tmp/flow.out 2>&1; F=$?; tail -3 /tmp/flow.out
(fuser -k 4399/tcp 2>/dev/null)

echo "── 3-1-D. 유닛 과제 자동 배정 ──"
#  교재 목차에 적어둔 과제가 **그 학생 진도에 맞춰** 나가나.
#  특히 「선생님이 손으로 낸 과제는 안 지워진다」가 깨지면 수업이 틀어집니다.
node auto-task-check.mjs > /tmp/auto.out 2>&1; T=$?; tail -3 /tmp/auto.out

echo "── 3-1-C. 나머지 동작 (하원·교재삭제·평가서 다시열기) ──"
node rest-actions-check.mjs > /tmp/rest.out 2>&1; X=$?; tail -3 /tmp/rest.out

echo "── 3-1-E. 알림톡 변수 — 자료의 템플릿 문구와 앱이 맞나 ──"
#  카카오는 **모르는 변수를 빈 칸으로** 내보냅니다 — 에러가 안 납니다.
#  자료의 문구가 한 글자만 어긋나도 수강생 40명의 학부모 카톡에 빈 줄이 나갑니다.
TESTDB=tapp node alimtalk-vars-check.mjs > /tmp/alim.out 2>&1; AL=$?; tail -3 /tmp/alim.out

echo "── 3-2. 노션 이관 (가짜 노션) ──"
(fuser -k 4330/tcp 2>/dev/null || true); sleep 1
MOCK_NOTION=1 TESTDB=tapp NOTION_TOKEN=secret_fake \
  NOTION_STUDENTS_DB=db-stu NOTION_DAILY_DB=db-daily NOTION_TEXTBOOKS_DB=db-book \
  NOTION_REPORTS_DB=db-report NOTION_COMMENTS_DB=db-comment \
  nohup node app-server.mjs > app.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 3
node notion-check.mjs > /tmp/notion.out 2>&1; N=$?; tail -4 /tmp/notion.out
# 노션 환경변수 없는 평소 상태로 되돌려 다음 단계 진행
(fuser -k 4330/tcp 2>/dev/null || true); sleep 1
TESTDB=tapp nohup node app-server.mjs > app.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 3

echo "── 3-3. 쓰던 DB 로 설치했을 때 (1·2차 수강생) ──"
#  검수는 늘 **새로 깐 DB**만 봤습니다. 그런데 1·2차 수강생은 전원이 쓰던 DB 로 옵니다.
#  칸·표를 일부러 지워서, 영어 날코드가 아니라 **붙여넣을 SQL** 이 나오는지 봅니다.
bash old-db-check.sh > /tmp/olddb.out 2>&1; OD=$?; tail -2 /tmp/olddb.out

echo "── 3-4. 선생님 하루 전체 (등원→진도→숙제 내기/취소→보강→결석→하원→발송) ──"
#  기능 하나하나는 통과하는데 **하루를 이어서** 돌려본 적이 없었습니다.
#  결석한 아이가 한 과를 건너뛰던 것과 PIN 중복을 여기서 처음 잡았습니다.
#  자기 DB(simday)·자기 포트(4332)로 돌아서 위 단계 데이터를 흐리지 않습니다.
bash full-day-sim.sh > /tmp/fullday.out 2>&1; FD=$?; tail -8 /tmp/fullday.out

echo "── 4. 브라우저에서 전 화면 ──"
if [ -f browser-check.mjs ]; then node browser-check.mjs > /tmp/br.out 2>&1; B=$?; tail -4 /tmp/br.out; else echo "  (생략)"; B=0; fi

echo "── 4-1. 시나리오 (깨질 만한 자리) ──"
#  전면 검수는 **되는 길**을 봅니다. 사고는 그 바깥에서 납니다 —
#  날짜를 잘못 치고, 없는 걸 지우고, 수기 진도를 적어두고, 남의 링크를 열어보는 자리.
#  자기 DB(tapp_sc)·자기 포트(4332)로 돌아서 위 단계 데이터를 흐리지 않습니다.
bash scenarios/run.sh > /tmp/sc.out 2>&1; SC=$?; tail -12 /tmp/sc.out

echo "── 5. 단위 점검 ──"
(cd "$APP" && node scripts/smoke-test.mjs > /tmp/smoke.out 2>&1); U=$?
grep -E "^FAIL|실패|통과" /tmp/smoke.out | tail -8
(cd "$APP" && node scripts/check-personal.mjs > /tmp/pers.out 2>&1); P=$?; tail -1 /tmp/pers.out
# DB 에러가 수강생이 읽을 수 있는 말로 나오나 (리허설에서 날코드가 화면에 그대로 떴던 건)
node db-error-unit.mjs > /tmp/dberr.out 2>&1; D=$?; tail -1 /tmp/dberr.out
# Claude API 가 거절했을 때도 사람이 읽을 수 있는 말이 나오나
#   (리허설에서 401 응답 JSON 이 화면에 그대로 떴던 건)
node claude-error-unit.mjs > /tmp/clerr.out 2>&1; C=$?; tail -1 /tmp/clerr.out
# 재시 안내 판정 — 점수만 적어도 큐에 올라가나, 기준이 0% 로 죽지 않았나
node retest-unit.mjs > /tmp/retest.out 2>&1; RT=$?; tail -1 /tmp/retest.out
# 같은 유닛코드가 여럿일 때 진도가 맴돌지 않나 (「리뷰」 를 챕터마다 쓰는 분이 많습니다)
node toc-dup-unit.mjs > /tmp/tocdup.out 2>&1; TD=$?; tail -1 /tmp/tocdup.out
# SUPABASE_URL 을 잘못 넣었을 때 한국어로 막아주나 (설치 단계에서 제일 많이 틀리는 칸)
node url-unit.mjs > /tmp/url.out 2>&1; UR=$?; tail -1 /tmp/url.out
# 알림톡이 안 나갈 때 무엇을 고쳐야 하는지 말해주나
node solapi-unit.mjs > /tmp/solapi.out 2>&1; SL=$?; tail -1 /tmp/solapi.out
# 「학생이 한 명도 안 나와요」 가 **왜** 그런지 화면이 말해주나
#   (SUPABASE_URL 에 http:// 를 넣으셨을 때 앱이 그냥 빈 화면이었던 건)
node empty-why-unit.mjs > /tmp/emptywhy.out 2>&1; EW=$?; tail -1 /tmp/emptywhy.out

(fuser -k 4330/tcp 2>/dev/null || true)

# ── 판정: 다섯 단계를 모두 본다 ──
#  예전에는 $A(API)·$B(브라우저)만 봐서, 스키마 대조가 죽어도 단위 점검이 실패해도
#  "전면 검수 통과" 가 찍혔습니다. 한 번 그러고 나면 검수기를 믿을 수 없게 됩니다.
FAILED=""
[ $S -ne 0 ] && FAILED="$FAILED 스키마대조"
[ $A -ne 0 ] && FAILED="$FAILED API"
[ $B -ne 0 ] && FAILED="$FAILED 브라우저"
[ $R -ne 0 ] && FAILED="$FAILED 월말평가서·진도조정"
[ $F -ne 0 ] && FAILED="$FAILED 학생등록흐름"
[ $X -ne 0 ] && FAILED="$FAILED 나머지동작"
[ $T -ne 0 ] && FAILED="$FAILED 유닛과제자동"
[ $N -ne 0 ] && FAILED="$FAILED 노션이관"
[ $U -ne 0 ] && FAILED="$FAILED 단위점검"
[ $P -ne 0 ] && FAILED="$FAILED 개인정보"
[ $D -ne 0 ] && FAILED="$FAILED DB에러문구"
[ $C -ne 0 ] && FAILED="$FAILED AI에러문구"
[ $SC -ne 0 ] && FAILED="$FAILED 시나리오"
[ $RT -ne 0 ] && FAILED="$FAILED 재시판정"
[ $TD -ne 0 ] && FAILED="$FAILED 목차중복"
[ $UR -ne 0 ] && FAILED="$FAILED 주소점검"
[ $SL -ne 0 ] && FAILED="$FAILED 알림톡문구"
[ $AL -ne 0 ] && FAILED="$FAILED 알림톡변수"
[ $OD -ne 0 ] && FAILED="$FAILED 쓰던DB"
[ $FD -ne 0 ] && FAILED="$FAILED 하루전체"
[ $EW -ne 0 ] && FAILED="$FAILED 빈화면이유"
if [ -z "$FAILED" ]; then
  echo "
✅ 전면 검수 통과"
  exit 0
else
  echo "
❌ 검수 실패 —$FAILED
   자세한 내용: /tmp/schema.out · /tmp/notion.out · /tmp/e2e.out · /tmp/report.out · /tmp/flow.out · /tmp/rest.out · /tmp/auto.out · /tmp/br.out · /tmp/smoke.out · /tmp/pers.out · /tmp/dberr.out · /tmp/clerr.out · /tmp/retest.out · /tmp/url.out · /tmp/solapi.out · /tmp/alim.out · /tmp/tocdup.out · /tmp/olddb.out · /tmp/fullday.out · /tmp/emptywhy.out"
  exit 1
fi
