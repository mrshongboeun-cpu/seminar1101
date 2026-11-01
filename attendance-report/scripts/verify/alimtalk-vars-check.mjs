// 자료의 **알림톡 템플릿 문구**와 앱이 **실제로 보내는 변수**가 같은가.
//
// 왜 생겼나: 원장님이 1차 때 등록한 템플릿으로 보냈더니 「과제수행 :」 「지적사항 :」
//   같은 줄이 **빈 칸으로** 왔습니다. 템플릿의 변수 이름과 앱이 보내는 이름이 달랐거든요.
//   카카오는 **모르는 변수를 그냥 빈 칸으로** 내보냅니다 — 에러도 안 납니다.
//   그래서 **세미나 자료에 적어둔 문구**만큼은 앱과 글자까지 맞아야 합니다.
//   한 글자만 어긋나도 수강생 40명의 학부모 카톡에 빈 줄이 나갑니다.
//
// 어떻게: 진짜 DB 위에서 앱의 발송 지점을 실제로 불러서, 솔라피로 나가는 변수를
//   가로채 모읍니다. 코드를 눈으로 읽는 게 아니라 **나가는 것**을 봅니다.
//
//   TESTDB=tapp node scripts/verify/alimtalk-vars-check.mjs

import fs from "node:fs";
import path from "node:path";
import { handle } from "./pgrest.mjs";

const APP = path.resolve(import.meta.dirname, "../..");
const 자료 = path.resolve(APP, "../자료실/세미나6차 자료실 — 올인원 학원 시스템 (신규).md");

// ── 1. 자료에서 템플릿 6종의 변수를 뽑는다 ──
function 자료변수() {
  if (!fs.existsSync(자료)) return null;
  const md = fs.readFileSync(자료, "utf8");
  const parts = md.split(/^\*\*([①-⑥]) ([^*]+)\*\* → `(TPL_[A-Z]+)`/m);
  const out = {};
  for (let i = 1; i < parts.length; i += 4) {
    const [번호, 이름, tpl] = [parts[i], parts[i + 1].trim(), parts[i + 2]];
    let 본문 = parts[i + 3];
    const 끝 = 본문.indexOf("\n**");
    if (끝 > 0) 본문 = 본문.slice(0, 끝);
    // ★ ```…``` **안쪽만** 봅니다. 바깥 설명문에는 「#{○○교재}」 같은 **자리표시자**가
    //   있어서, 그것까지 세면 멀쩡한데도 어긋났다고 뜹니다.
    const 코드 = [...본문.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]).join("\n");
    out[tpl] = { 이름: `${번호} ${이름}`, 변수: new Set([...코드.matchAll(/#\{([^}]+)\}/g)].map((m) => m[1])) };
  }
  return out;
}

// ── 2. 앱을 진짜 DB 위에 올리고, 솔라피로 나가는 변수를 가로챈다 ──
process.env.SUPABASE_URL = "https://fake-supabase";
process.env.SUPABASE_SERVICE_KEY = "fake";
process.env.SOLAPI_API_KEY = "k";
process.env.SOLAPI_API_SECRET = "s";
process.env.SOLAPI_SENDER = "01000000000";
process.env.SOLAPI_PFID = "pf";
for (const t of ["CHECKIN", "CHECKOUT", "LATE", "DAILY", "REPORT", "RETEST"]) process.env[`TPL_${t}`] = `TPL_${t}`;

const 나간것 = {};   // templateId → Set(변수명)
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://fake-supabase")) {
    const m = /\/rest\/v1\/([a-z_]+)\?([\s\S]*)$/.exec(u) || /\/rest\/v1\/([a-z_]+)$/.exec(u);
    const data = await handle(opts.method || "GET", m[1], m[2] || "", opts.body ? JSON.parse(opts.body) : null,
      (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || "");
    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.includes("api.solapi.com")) {
    const body = JSON.parse(opts.body);
    const k = body.messages[0].kakaoOptions;
    (나간것[k.templateId] ||= new Set());
    for (const v of Object.keys(k.variables || {})) 나간것[k.templateId].add(v.replace(/^#\{|\}$/g, ""));
    return new Response(JSON.stringify({ groupInfo: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 200 });
};

const { default: attendance } = await import("../../api/attendance.js");
const { default: report } = await import("../../api/report.js");

const 가짜res = () => {
  const r = { _s: 200, _j: null };
  r.status = (s) => { r._s = s; return r; };
  r.json = (j) => { r._j = j; return r; };
  r.setHeader = () => r;
  return r;
};
// GET 은 req.query, POST 는 req.body 를 봅니다 (api/attendance.js 와 같게)
const call = async (fn, body, method = "POST") => {
  const res = 가짜res();
  await fn({ method, body, query: method === "GET" ? body : {}, headers: { host: "example.vercel.app" } }, res);
  return res._j;
};

const KST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const 월 = KST.slice(0, 7);

// 발송 지점을 **하나씩 실제로** 부른다
const { students } = (await call(attendance, { action: "students" }, "GET")) || { students: [] };
const stu = (students || []).filter((s) => s.status === "재원")[0];
if (!stu) { console.log("❌ 샘플 학생이 없습니다 — setup.sql 을 먼저 돌리세요"); process.exit(1); }

// ★ 미등원을 **먼저** — 등원해버리면 미등원 대상이 아니라서 안 나갑니다.
//   그리고 미등원은 「예정 시각 + 유예 10분이 지나야」 나갑니다. 시계에 기대면
//   새벽에 돌릴 때 멀쩡한데도 실패합니다 — 예정 시각을 00:01 로 바꿔 대상이 되게 만듭니다.
const 요일 = ["일","월","화","수","목","금","토"][new Date(`${KST}T00:00:00Z`).getUTCDay()];
await call(attendance, { action: "save-student", student: { ...stu, schedule: { ...(stu.schedule||{}), [요일]: "00:01" } } });
await call(attendance, { action: "notify-absent", date: KST });
// 등원·하원 (키오스크 두 번 터치) → TPL_CHECKIN / TPL_CHECKOUT
await call(attendance, { action: "checkin", pin: stu.pin });
await call(attendance, { action: "checkin", pin: stu.pin });
// 데일리 리포트 → TPL_DAILY
await call(attendance, { action: "save-record", student_id: stu.id, date: KST, fields: { voca_test: "불통과", voca_score: "5/20" } });
await call(attendance, { action: "send-daily", date: KST, student_ids: [stu.id] });
// 재시 안내 → TPL_RETEST
await call(attendance, { action: "send-retest", date: KST, student_ids: [stu.id] });
// 월말평가서 → TPL_REPORT (평가서 행이 있어야 나갑니다)
await call(report, { action: "save", month: 월, student_id: stu.id, body: "검수용" });
await call(report, { action: "send", month: 월, student_ids: [stu.id] });

// ── 3. 대조 ──
const 자료들 = 자료변수();
let fail = 0;
console.log(`\n자료의 템플릿 문구 ↔ 앱이 실제로 보내는 변수\n${"─".repeat(60)}`);
if (!자료들) {
  console.log("⚠️ 자료실 파일을 못 찾았습니다 — 대조를 건너뜁니다.");
  process.exit(0);
}
for (const [tpl, { 이름, 변수 }] of Object.entries(자료들)) {
  const 보낸것 = 나간것[tpl];
  if (!보낸것) { fail++; console.log(`\n❌ ${이름} (${tpl}) — 앱이 **한 번도 안 보냈습니다** (발송 지점을 못 탔습니다)`); continue; }
  const 빠진것 = [...변수].filter((v) => !보낸것.has(v));          // 템플릿엔 있는데 앱이 안 보냄 → 빈 칸
  const 남는것 = [...보낸것].filter((v) => !변수.has(v));          // 앱은 보내는데 템플릿엔 없음 → 무시됨(괜찮음)
  if (빠진것.length) {
    fail++;
    console.log(`\n❌ ${이름} (${tpl})`);
    console.log(`   템플릿엔 있는데 앱이 안 보냄 → **빈 칸으로 나갑니다**:`);
    빠진것.forEach((v) => console.log(`      #{${v}}`));
  } else {
    console.log(`\n✅ ${이름} (${tpl}) — 템플릿 변수 ${변수.size}개 전부 채워집니다`);
  }
  if (남는것.length) console.log(`   (앱이 더 보내는 것 — 템플릿에 없으면 무시됩니다: ${남는것.map((v) => "#{" + v + "}").join(" ")})`);
}
console.log(fail ? `\n❌ ${fail}종이 어긋납니다 — 학부모 카톡에 빈 줄이 나갑니다.` : `\n✅ 템플릿 6종 전부 앱과 맞습니다.`);
process.exit(fail ? 1 : 0);
