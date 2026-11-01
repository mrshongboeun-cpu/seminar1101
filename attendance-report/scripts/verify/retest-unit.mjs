// 재시 안내 판정 — lib/retest.js 단위 점검.
//
// 왜 생겼나: 선생님은 보통 **점수만** 적습니다(「12/20」). 예전에는 그러면
//   「불통과」 버튼을 따로 눌러야만 재시 안내가 큐에 올라갔고, 점수만 적은
//   학생은 학부모에게 안내가 **조용히 안 나갔습니다.**
//
//   그리고 이 파일을 쓰면서 바로 사고 하나를 잡았습니다 — 환경변수를 안 넣었을 때
//   Number("") 가 0 이 돼서 **통과 기준이 0%** 가 됐습니다. 즉 아무도 재시 대상이
//   안 됩니다. 눈으로는 멀쩡해 보이는 종류라, 기준값부터 확인하게 만들어 둡니다.
//
//   node scripts/verify/retest-unit.mjs

import {
  RETEST_PASS, VOCA_FULL,
  scorePercent, isFailText, isFail, retestHint, retestQueueValue, needsRetest,
} from "../../lib/retest.js";

let fail = 0;
function check(name, cond, got) {
  if (cond) console.log(`  ok  ${name}`);
  else { fail++; console.log(`  FAIL ${name}`); console.log(`       받은 것: ${JSON.stringify(got)}`); }
}

// ── 0. 기준값이 살아 있나 (0% 사고 재발 방지) ──
check("통과 기준이 0 이 아니다 (환경변수 미설정 → 기본 80)", RETEST_PASS > 0 && RETEST_PASS <= 100, RETEST_PASS);
check("만점 기본값은 0 = 숫자만 적은 건 판정 안 함", VOCA_FULL === 0, VOCA_FULL);

// ── 1. 점수 읽기 ──
const 점수 = [
  ["12/20", 60], ["16/20", 80], ["0/20", 0], ["20/20", 100],
  ["12 / 20", 60], ["16/20점", 80], ["60%", 60],
  ["18", null], ["90점", null],   // 만점을 모르면 **판정하지 않는다**
  ["", null], ["A", null], ["-", null], ["18/0", null],
];
for (const [v, want] of 점수) {
  const got = scorePercent(v);
  check(`점수 "${v}" → ${want === null ? "판정 안 함" : want + "%"}`,
    want === null ? got === null : Math.round(got) === want, got);
}

// ── 2. 결과 문자열 ──
for (const v of ["불통과", "미통과", "재시", "1차미통과", "2차미통과"])
  check(`"${v}" 는 못 넘긴 것`, isFailText(v) === true, v);
for (const v of ["통과", "", null, "100%완료"])
  check(`"${v}" 는 못 넘긴 게 아니다`, isFailText(v) === false, v);

// ── 3. 누가 이기나 — 결과칸을 직접 누르면 그게 점수보다 우선 ──
check("「통과」 + 낮은 점수 → 재시 아님 (선생님 판단 우선)", isFail("통과", "12/20") === false);
check("「불통과」 + 만점 → 재시 (선생님 판단 우선)", isFail("불통과", "20/20") === true);
check("결과 비었고 점수 미달 → 재시", isFail("", "12/20") === true);
check("결과 비었고 점수 충분 → 아님", isFail("", "16/20") === false);
check("결과·점수 둘 다 비면 아님", isFail("", "") === false);
check("만점 모르는 숫자만 → 아님 (잘못 보내지 않는다)", isFail("", "18") === false);

// ── 4. 안내 한 줄 — 조용히 안 올라가는 일이 없게 ──
check("미달이면 「재시 안내 대상」 이라고 적는다", /재시 안내 대상/.test(retestHint("", "12/20")), retestHint("", "12/20"));
check("충분하면 통과라고 적는다", /통과/.test(retestHint("", "18/20")), retestHint("", "18/20"));
check("판정 못 하면 그걸 말해준다", /판정 못/.test(retestHint("", "18")), retestHint("", "18"));
check("결과칸을 눌렀으면 그게 우선이라고 알려준다", /우선/.test(retestHint("통과", "12/20")), retestHint("통과", "12/20"));
check("아무것도 안 적으면 아무 말도 안 한다", retestHint("", "") === "", retestHint("", ""));

// ── 5. 큐 전이 (두 번 보내지 않기 · 고치면 대기 해제) ──
const 큐 = [
  [null, "", "12/20", "미전송", "점수만 적어도 큐에 올라간다"],
  [null, "통과", "20/20", undefined, "통과면 아무것도 안 한다"],
  ["미전송", "통과", "20/20", null, "통과로 고치면 대기 해제"],
  ["미전송", "", "12/20", undefined, "이미 대기 중이면 그대로"],
  ["전송", "", "12/20", undefined, "이미 보냈으면 두 번 안 보낸다"],
  ["미전송", "", "", null, "점수를 지우면 대기 해제"],
];
for (const [cur, t, s, want, why] of 큐) {
  const got = retestQueueValue(cur, t, s);
  check(`큐: ${why}`, got === want, { cur, t, s, got, want });
}

// ── 6. 행 판정 (노션에서 옮겨와 큐를 안 거친 행도 잡히나) ──
check("전송된 행은 대상 아님", needsRetest({ retest_sent: "전송", voca_test: "불통과" }) === false);
check("대기 중인 행은 대상", needsRetest({ retest_sent: "미전송" }) === true);
check("큐를 안 거쳤어도 점수가 미달이면 대상", needsRetest({ voca_test: null, voca_score: "12/20" }) === true);
check("점수가 충분하면 대상 아님", needsRetest({ voca_test: null, voca_score: "18/20" }) === false);
check("빈 행은 대상 아님", needsRetest({}) === false);
check("행이 없으면 대상 아님", needsRetest(null) === false);

console.log(fail ? `\n❌ 실패 ${fail}건` : `\n✅ 전부 통과 (기준 ${RETEST_PASS}%)`);
process.exit(fail ? 1 : 0);
