// 「학생이 한 명도 안 나와요」 — 화면이 **왜** 그런지 말해주나.
//
// 왜 생겼나: 원장님이 SUPABASE_URL 에 `http://…` 를 넣으셨습니다(s 하나 빠짐).
//   앱은 아무 말도 안 하고 그냥 **빈 화면**이었습니다. 원장님은 Supabase 에
//   데이터가 분명히 있는 걸 보고 계셔서, 주소가 원인이라는 걸 알 길이 없었습니다.
//
//   비는 이유가 셋인데 **고치는 법이 전부 다릅니다** —
//     ① 학생이 아예 0명   → setup.sql 미실행 / **다른 프로젝트**를 보고 있음 / Redeploy 안 함
//     ② 있는데 재원 0명   → 전부 퇴원으로 들어갔음
//     ③ 재원은 있는데 그 요일에 없음 → 요일별 등원시간이 비었음
//   뭉쳐서 「요일을 채우세요」 만 띄우면, 정작 ① 인 사람은 영원히 못 찾습니다.
//
//   TESTDB=<db> node scripts/verify/empty-why-unit.mjs
//   (혼자 돌리지 마시고 verify.sh 가 불러줍니다 — DB 를 세 모양으로 만들어야 합니다)

import { execFileSync } from "node:child_process";

// ★ pgrest.mjs 는 **import 하는 순간** TESTDB 로 연결 풀을 만듭니다.
//   그래서 DB 이름을 먼저 정해두고 **그 다음에** 불러와야 합니다 —
//   나중에 process.env.TESTDB 를 바꿔도 이미 늦습니다 (여기서 한 번 데었습니다).
//   DB 는 하나만 쓰고, 모양을 바꿀 때마다 **같은 이름으로 다시 깝니다.**
const DB = (process.env.TESTDB || "tapp") + "_w";
process.env.TESTDB = DB;
const PGSOCK = process.env.PGSOCK || "/var/run/postgresql";
const psql = (db, ...args) =>
  execFileSync("psql", ["-h", PGSOCK, "-p", "5433", "-U", "postgres", "-d", db, "-q", ...args], { stdio: "pipe" });

let fail = 0;
const check = (name, cond, got) => {
  if (cond) console.log(`  ok  ${name}`);
  else { fail++; console.log(`  FAIL ${name}`); if (got !== undefined) console.log(`       받은 것: ${JSON.stringify(got)?.slice(0, 300)}`); }
};

// ★ https — lib/db.js 가 http 를 막습니다 (그게 이 점검이 생긴 이유입니다)
process.env.SUPABASE_URL = "https://fake-supabase";   // 가짜 주소 (점검용)
process.env.SUPABASE_SERVICE_KEY = "fake";
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const m = /\/rest\/v1\/([a-z_]+)\?([\s\S]*)$/.exec(u) || /\/rest\/v1\/([a-z_]+)$/.exec(u);
  if (!m) return new Response("{}", { status: 200 });
  try {
    const data = await handle(opts.method || "GET", m[1], m[2] || "", opts.body ? JSON.parse(opts.body) : null,
      (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || "");
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ code: e.code || "", message: e.message || String(e) }), { status: 400 });
  }
};

// DB 를 먼저 만들어 두고(풀이 붙을 대상), 그 다음에 pgrest·api 를 불러옵니다.
//   ⚠️ 한 번 붙은 풀 때문에 **DB 를 다시 drop 할 수 없습니다.**
//      그래서 처음 한 번만 깔고, 모양을 바꿀 때는 **내용만 되돌립니다.**
const 표들 = ["tasks", "monthly_reports", "monthly_comments", "daily_records", "students", "textbooks"];
execFileSync("psql", ["-h", PGSOCK, "-p", "5433", "-U", "postgres", "-d", "postgres", "-q",
  "-c", `drop database if exists ${DB}`, "-c", `create database ${DB}`], { stdio: "pipe" });
psql(DB, "-c", "create role service_role nologin", "-c", "create extension if not exists pgcrypto");
psql(DB, "-v", "ON_ERROR_STOP=1", "-f", new URL("../../sql/setup.sql", import.meta.url).pathname);
// 깔린 그대로를 떠놓습니다
for (const t of 표들) psql(DB, "-c", `create table _bak_${t} as select * from ${t}`);
// 되돌리기 — 자식 표부터 지우고, 부모부터 다시 넣습니다 (외래키 순서)
const 깔기 = () => {
  for (const t of 표들) psql(DB, "-c", `delete from ${t}`);
  for (const t of [...표들].reverse()) psql(DB, "-c", `insert into ${t} select * from _bak_${t}`);
};
const { handle } = await import("./pgrest.mjs");
const { default: attendance } = await import("../../api/attendance.js");
const res = () => { const r = { _s: 200, _j: null }; r.status = (s) => { r._s = s; return r; }; r.json = (j) => { r._j = j; return r; }; r.setHeader = () => r; return r; };
const 불러오기 = async (action) => {
  const o = res();
  await attendance({ method: "GET", query: { action }, headers: { host: "x.vercel.app" } }, o);
  return o._j || {};
};

// 세 모양을 만들어 각각 물어봅니다. 원래대로 되돌리며 갑니다.
const 모양 = [
  ["① 학생이 아예 0명 (다른 프로젝트를 보는 것과 같은 상태)", "학생없음",
   ["delete from tasks", "delete from monthly_reports", "delete from monthly_comments", "delete from daily_records", "delete from students"],
   [/setup\.sql/, /SUPABASE_URL/]],
  ["② 있는데 전부 퇴원", "재원없음",
   ["update students set status='퇴원'"],
   [/재원/]],
  ["③ 재원인데 요일이 비었음", "요일없음",
   ["delete from daily_records", "update students set schedule='{}'::jsonb"],
   [/요일/, /고장난 게 아닙니다/]],
];

for (const [이름, 기대kind, sql, 들어야할말] of 모양) {
  깔기();
  for (const q of sql) psql(DB, "-c", q);
  console.log(`\n${이름}`);
  for (const action of ["daily-rows", "board"]) {
    const d = await 불러오기(action);
    check(`${action} — 왜 비었는지 알려준다`, d.empty && d.empty.kind === 기대kind, { empty: d.empty, error: d.error });
    const 말 = d.empty?.message || "";
    check(`${action} — 한국어다`, /[가-힣]/.test(말), 말);
    for (const 꼴 of 들어야할말) check(`${action} — ${꼴} 를 짚어준다`, 꼴.test(말), 말);
  }
}

// ④ 정상이면 **아무 말도 하지 않아야** 합니다 (멀쩡한데 경고가 뜨면 더 나쁩니다)
깔기();
console.log("\n④ 정상 (비교)");
for (const action of ["daily-rows", "board"]) {
  const d = await 불러오기(action);
  check(`${action} — 멀쩡하면 아무 말도 안 한다`, !d.empty, d.empty);
}

try { psql("postgres", "-c", `drop database if exists ${DB}`); } catch {}
console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
