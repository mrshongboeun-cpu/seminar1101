// DB 에러를 수강생이 읽을 수 있는 말로 바꾸는지 — lib/db.js 단위 점검.
//
// 왜 생겼나: 리허설에서 월말평가서 화면에 이게 그대로 떴습니다.
//   select tasks 실패: 404 {"code":"PGRST205","message":"Could not find the table
//   'public.tasks' in the schema cache"}
// 세미나 당일 이게 뜨면 수강생은 아무것도 못 합니다. 원인별로 할 일이 보여야 합니다.
//
//   node scripts/verify/db-error-unit.mjs

import { select } from "../../lib/db.js";

let fail = 0;
function check(name, cond, got) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       받은 것: ${JSON.stringify(got)}`);
  }
}

// select() 가 던지는 메시지를 보기 위해 fetch 를 잠깐 가짜로 바꿔 끼운다.
async function messageFor(status, body) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status, text: async () => body });
  try {
    await select("tasks", "");
    return null; // 에러가 안 났다 = 잘못됨
  } catch (e) {
    return e.message;
  } finally {
    globalThis.fetch = orig;
  }
}

const RAW = /PGRST\d+|schema cache|permission denied for table|Invalid API key/;

{
  const m = await messageFor(
    404,
    JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.tasks' in the schema cache" })
  );
  check("★ 표가 없을 때 — 무엇을 돌려야 하는지 알려준다",
    m?.includes("표가 없습니다") && m.includes("setup.sql"), m);
  check("★ 쓰던 DB 는 setup.sql 재실행하지 말라고 경고한다",
    m?.includes("재실행 금지"), m);
  check("날코드(PGRST205·schema cache)가 그대로 새지 않는다", !RAW.test(m || ""), m);
}

{
  const m = await messageFor(403, JSON.stringify({ code: "42501", message: "permission denied for table students" }));
  check("★ 권한 누락 — grant 문을 그대로 보여준다",
    m?.includes("service_role") && m.includes("grant usage on schema public"), m);
  check("날코드가 그대로 새지 않는다", !RAW.test(m || ""), m);
}

{
  const m = await messageFor(401, JSON.stringify({ message: "Invalid API key" }));
  check("★ 키가 틀렸을 때 — anon 키 실수를 짚어준다",
    m?.includes("SUPABASE_SERVICE_KEY") && m.includes("anon"), m);
  check("날코드가 그대로 새지 않는다", !RAW.test(m || ""), m);
}

{
  const m = await messageFor(400, JSON.stringify({ code: "PGRST204", message: "Could not find the 'retest_sent' column" }));
  check("칸이 없을 때 — add column 을 안내한다", m?.includes("add column"), m);
}

{
  // 모르는 에러는 숨기지 말고 그대로 보여줘야 한다 (디버깅 가능해야 하므로)
  const m = await messageFor(500, "boom");
  check("모르는 에러는 원문을 그대로 남긴다", m?.includes("500") && m.includes("boom"), m);
}

// ── 원장님이 리허설에서 겪은 두 가지 (여기 없으면 다시 영어 날코드가 뜹니다) ──
{
  // 칸이 없을 때 — **돌릴 SQL 한 줄**을 그대로 줘야 합니다.
  //   예전엔 "서버 로그의 칸 이름을 보고 alter table 하세요" 라서 아무도 못 고쳤습니다.
  const m = await messageFor(400, JSON.stringify({
    code: "PGRST204",
    message: "Could not find the 'retest_sent' column of 'daily_records' in the schema cache",
  }));
  check("칸 없음 — 어느 칸인지 말해준다", m?.includes("retest_sent"), m);
  check("칸 없음 — 붙여넣을 SQL 을 그대로 준다",
    m?.includes("alter table daily_records add column if not exists retest_sent text;"), m);
  check("칸 없음 — 어디에 붙여넣는지 말해준다", m?.includes("SQL Editor"), m);
  check("칸 없음 — 데이터가 안 지워진다고 안심시킨다", m?.includes("지워지지 않"), m);
}
{
  // 모르는 칸이어도 쓸 수 있는 SQL 을 만들어 줘야 합니다
  const m = await messageFor(400, JSON.stringify({
    code: "PGRST204",
    message: "Could not find the 'wibble' column of 'tasks' in the schema cache",
  }));
  check("모르는 칸도 alter table 문장을 만들어 준다",
    m?.includes("alter table tasks add column if not exists wibble"), m);
}
{
  // tasks 표가 통째로 없을 때 — 돌릴 **파일 이름**을 정확히
  const m = await messageFor(404, JSON.stringify({
    code: "PGRST205", message: "Could not find the table 'public.tasks' in the schema cache",
  }));
  check("표 없음 — migrate_tasks.sql 을 짚어준다", m?.includes("migrate_tasks.sql"), m);
  check("표 없음 — setup.sql 재실행을 막는다", m?.includes("재실행 금지"), m);
}
{
  // ★ SUPABASE_URL 에 Vercel 주소를 넣은 경우 (원장님이 실제로 겪은 것)
  const m = await messageFor(404,
    "The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND icn1:iad1::qb8f4-179-7b8");
  check("Vercel 주소를 넣었을 때 — SUPABASE_URL 을 짚어준다", m?.includes("SUPABASE_URL"), m);
  check("Vercel 주소를 넣었을 때 — 어디서 복사하는지 말해준다", m?.includes("Project URL"), m);
  check("Vercel 주소를 넣었을 때 — Redeploy 를 말해준다", m?.includes("Redeploy"), m);
  check("Vercel 주소를 넣었을 때 — 영어 원문이 안 보인다", !m?.includes("DEPLOYMENT_NOT_FOUND"), m);
}

{
  // ★ PostgreSQL 까지 간 경우 — 원장님 화면에 이게 날것으로 떴습니다.
  //   delete tasks 실패: 400 {"code":"42703","message":"column tasks.auto does not exist"}
  const m = await messageFor(400, JSON.stringify({
    code: "42703", message: "column tasks.auto does not exist",
  }));
  check("42703 — 어느 칸인지 말해준다", m?.includes("auto"), m);
  check("42703 — 붙여넣을 SQL 을 그대로 준다",
    m?.includes("alter table tasks add column if not exists auto boolean"), m);
  check("42703 — 영어 원문이 안 보인다", !m?.includes("does not exist"), m);
}
{
  // 모르는 칸이어도 쓸 수 있는 문장을 만들어 줘야 합니다
  const m = await messageFor(400, JSON.stringify({
    code: "42703", message: "column students.wibble does not exist",
  }));
  check("42703 — 모르는 칸도 alter table 문장을 만들어 준다",
    m?.includes("alter table students add column if not exists wibble"), m);
}

{
  // ★ **쓸 때** 나는 꼴 — 읽을 때와 글자가 다릅니다.
  //   읽을 때: column tasks.auto does not exist
  //   쓸 때  : column "school" of relation "students" does not exist
  //   게다가 원문이 JSON 이라 따옴표가 \" 로 **역슬래시와 함께** 옵니다.
  //   이 둘 때문에 학교 칸이 없는 DB 에서 학생을 저장하면 영어 날코드가 그대로 떴습니다.
  const m = await messageFor(400, JSON.stringify({
    code: "42703", message: `column "school" of relation "students" does not exist`,
  }));
  check("★ 쓸 때 꼴(of relation) — 어느 칸인지 말해준다", m?.includes("school"), m);
  check("★ 쓸 때 꼴 — 붙여넣을 SQL 을 그대로 준다",
    m?.includes("alter table students add column if not exists school text"), m);
  check("★ 쓸 때 꼴 — 고칠 파일도 알려준다", m?.includes("migrate_school.sql"), m);
  check("★ 쓸 때 꼴 — 영어 원문이 안 보인다", !m?.includes("does not exist"), m);
}
{
  // 모르는 칸이어도 (of relation 꼴로) 쓸 수 있는 문장을 만들어 줘야 합니다
  const m = await messageFor(400, JSON.stringify({
    code: "42703", message: `column "wibble" of relation "students" does not exist`,
  }));
  check("★ 쓸 때 꼴 — 모르는 칸도 문장을 만들어 준다",
    m?.includes("alter table students add column if not exists wibble"), m);
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
