// Claude API 가 거절했을 때 **사람이 읽을 수 있는 말**이 나오는지.
//
// 왜 생겼나: 리허설에서 월말평가서를 누르니 화면에 이게 그대로 떴습니다.
//   Claude 호출 실패: 401 {"type":"error","error":{"type":"authentication_error",...}}
// 수강생은 앱이 고장난 줄 압니다. 무엇을 하면 되는지(키 새로 발급 → Redeploy)까지
// 적힌 문구가 나와야 합니다.
//
//   node scripts/verify/claude-error-unit.mjs   (서버·DB 없이 그냥 돕니다)

// ★ lib/claude.js 는 **불러오는 순간** ANTHROPIC_BASE_URL 을 읽어 주소를 굳힙니다.
//   그래서 환경변수를 먼저 세우고 **그다음에** 불러와야 합니다.
//   (처음에 import 를 위에 뒀더니 진짜 api.anthropic.com 으로 나가서,
//    모든 경우가 똑같이 진짜 401 을 받아 왔습니다 — 검사가 아무것도 못 보던 상태)

let fail = 0;
const ck = (l, c, d) => {
  console.log(`${c ? "  ok " : "FAIL "} ${l}${c ? "" : "  → " + String(d).slice(0, 200)}`);
  if (!c) fail++;
};

// Anthropic 을 흉내 내서 원하는 status/본문을 돌려주는 작은 서버
const http = await import("node:http");
let 응답 = { status: 200, body: "{}" };
const srv = http.createServer((req, res) => {
  res.writeHead(응답.status, { "content-type": "application/json" });
  res.end(응답.body);
});
await new Promise((r) => srv.listen(4398, r));
process.env.ANTHROPIC_BASE_URL = "http://localhost:4398";
process.env.ANTHROPIC_API_KEY = "sk-ant-fake-for-verify";   // 가짜 (검수용)

const { generateReport } = await import("../../lib/claude.js");

const 학생 = { name: "검수학생" };
// buildDataSummary 가 읽는 최소 모양 (실제 computePlanner 결과와 같은 뼈대)
const planner = {
  총수업일수: 10,
  출석: { 정시등원: 8, 지각: 1, 결석: 1 },
  태도: { 상: 7, 중: 2, 하: 1 },
  단어테스트: { 총횟수: 8, 통과: 7 },
  월초진도: {}, 최종진도: {},
};
const 인자 = { student: 학생, month: "2026-09", planner, comment: "", dailyNotes: [] };

async function 문구(status, body) {
  응답 = { status, body };
  try { await generateReport(인자); return "(에러가 안 났습니다)"; }
  catch (e) { return e.message; }
}

const E = (t) => JSON.stringify({ type: "error", error: { type: t, message: "x" } });

const cases = [
  ["401 키 틀림", 401, E("authentication_error"), [/키가 올바르지 않습니다/, /sk-ant-/, /Redeploy/]],
  ["403 권한 없음", 403, E("permission_error"), [/쓸 수 없습니다/, /Redeploy/]],
  ["429 몰림", 429, E("rate_limit_error"), [/다시 눌러/]],
  ["500 서버 불안정", 500, E("api_error"), [/잠시 뒤 다시/, /그대로 됩니다/]],
  ["크레딧 부족", 400, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "credit balance is too low" } }), [/크레딧이 부족/, /Billing/]],
];

for (const [label, status, body, 기대들] of cases) {
  const msg = await 문구(status, body);
  ck(`${label} — 사람이 읽을 수 있는 말`, 기대들.every((re) => re.test(msg)), msg);
  ck(`${label} — 날 JSON 이 안 샌다`, !/"type"\s*:\s*"error"/.test(msg), msg);
}

srv.close();
console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
