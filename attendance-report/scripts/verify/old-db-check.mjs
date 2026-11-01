// 「쓰던 DB」로 설치했을 때 — 화면이 **고치는 법**을 말해주나.
//
// 왜 생겼나: 검수는 늘 **새로 깐 DB**만 봤습니다.
//     drop database → create database → setup.sql (제일 최신)
//   그러니 「칸이 없다」는 상황이 **아예 생길 수가 없었습니다.**
//   그런데 1·2차 수강생은 **전원이 쓰던 DB**로 옵니다. 그분들 DB에는
//   retest_sent 도 tasks 표도 tasks.auto 도 없습니다.
//   원장님이 리허설에서 두 번 막히셨고, 둘 다 검수가 한 번도 안 본 자리였습니다.
//
// 무엇을 보나: 칸·표를 **일부러 지운 DB** 위에서 앱을 돌려서
//   ① 영어 날코드가 아니라 **한국어 + 붙여넣을 SQL** 이 나오는가
//   ② migrate_*.sql 을 돌리면 **실제로 고쳐지는가**
//
//   MODE=before|after TESTDB=<db> node scripts/verify/old-db-check.mjs
//   (혼자 돌리지 마시고 old-db-check.sh 를 쓰세요 — DB를 깎는 일까지 해줍니다)

import { handle } from "./pgrest.mjs";

const MODE = process.env.MODE || "before";
let fail = 0;
function check(name, cond, got) {
  if (cond) console.log(`  ok  ${name}`);
  else { fail++; console.log(`  FAIL ${name}`); console.log(`       받은 것: ${JSON.stringify(got)?.slice(0, 300)}`); }
}

process.env.SUPABASE_URL = "https://fake-supabase";
process.env.SUPABASE_SERVICE_KEY = "fake";
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://fake-supabase")) {
    const m = /\/rest\/v1\/([a-z_]+)\?([\s\S]*)$/.exec(u) || /\/rest\/v1\/([a-z_]+)$/.exec(u);
    try {
      const data = await handle(opts.method || "GET", m[1], m[2] || "", opts.body ? JSON.parse(opts.body) : null,
        (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || "");
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      // pgrest 는 PostgreSQL 오류를 그대로 올려줍니다 — 진짜 Supabase 와 같은 모양으로
      const body = JSON.stringify({ code: e.code || "", message: e.message || String(e) });
      return new Response(body, { status: 400, headers: { "content-type": "application/json" } });
    }
  }
  return new Response("{}", { status: 200 });
};

const { default: attendance } = await import("../../api/attendance.js");
const { default: student } = await import("../../api/student.js");

const res = () => { const r = { _s: 200, _j: null }; r.status = (s) => { r._s = s; return r; }; r.json = (j) => { r._j = j; return r; }; r.setHeader = () => r; return r; };
const call = async (fn, body, method = "POST") => {
  const o = res();
  try { await fn({ method, body, query: method === "GET" ? body : {}, headers: { host: "x.vercel.app" } }, o); }
  catch (e) { return { s: 500, d: { error: `던짐: ${e.message}` } }; }
  return { s: o._s, d: o._j };
};
const 글 = (r) => JSON.stringify(r.d || {});

const KST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const { d: { students = [] } = {} } = await call(attendance, { action: "students" }, "GET");
const stu = students.filter((s) => s.status === "재원")[0];
if (!stu) { console.log("❌ 샘플 학생이 없습니다"); process.exit(1); }

// 1·2차 수강생이 설치 직후 제일 먼저 하는 것들
const 길 = [
  ["데일리 리포트 열기", () => call(attendance, { action: "daily-rows", date: KST }, "GET")],
  ["진도 저장 (과제가 같이 깔리는 자리)", () => call(attendance, { action: "save-record", student_id: stu.id, date: KST, fields: { progress: { 문법: { code: "CH1-1", title: "be동사" } } } })],
  ["단어테스트 불통과 저장 (재시 큐)", () => call(attendance, { action: "save-record", student_id: stu.id, date: KST, fields: { voca_test: "불통과", voca_score: "5/20" } })],
  ["재시 안내 미리보기", () => call(attendance, { action: "send-retest", date: KST, dryRun: true })],
  ["과제 현황", () => call(attendance, { action: "tasks", date: KST }, "GET")],
  ["학생앱 홈", () => call(student, { action: "home", code: stu.student_code, pin: stu.pin })],
  // 학교 칸이 없는 DB 에서 학생을 저장하는 자리 — 여기서 영어 날코드가 떴습니다
  ["학생 저장 (학교 칸)", () => call(attendance, { action: "save-student",
    student: { name: "옛DB점검학생", pin: "7799", grade: "중2", school: "새봄중학교" } })],
];

console.log(`\n${MODE === "before" ? "① 칸을 지운 DB — 화면이 고치는 법을 말해주나" : "② migrate 를 돌린 뒤 — 실제로 고쳐졌나"}\n${"─".repeat(56)}`);

for (const [이름, 부르기] of 길) {
  const r = await 부르기();
  const t = 글(r);
  if (MODE === "before") {
    // 깨지는 건 괜찮습니다. **영어 날코드로 깨지는 게** 문제입니다.
    const 날것 = /does not exist|schema cache|PGRST\d|42703|42P01|column .* of relation/i.test(t);
    const 안내 = /alter table|SQL Editor|setup\.sql|migrate_/.test(t);
    if (r.s === 200) { console.log(`  --  ${이름} — 멀쩡히 돌았습니다 (이 칸을 안 쓰는 길)`); continue; }
    check(`${이름} — 영어 날코드가 안 보인다`, !날것, t);
    check(`${이름} — 고칠 SQL·파일을 알려준다`, 안내, t);
  } else {
    check(`${이름} — 이제 돈다`, r.s === 200, t);
  }
}

if (MODE === "after") {
  // 고쳐진 뒤에는 **기능까지** 살아 있어야 합니다
  const { d } = await call(attendance, { action: "tasks", date: KST }, "GET");
  check("과제가 실제로 깔린다", (d?.tasks || []).length > 0, (d?.tasks || []).length);
  const { d: q } = await call(attendance, { action: "daily-rows", date: KST }, "GET");
  const 행 = (q?.rows || []).find((x) => x.student_id === stu.id);
  check("재시 큐가 살아 있다", 행?.record?.retest_sent === "미전송" || 행?.record?.needs_retest === true, 행?.record);
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
