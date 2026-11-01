// SUPABASE_URL 을 다듬고, 틀렸으면 한국어로 알려주는지 — lib/db.js 단위 점검.
//
// 왜 생겼나: 설치 시뮬레이션에서 Supabase 의 **프로젝트 ID 만** 넣었더니
//   화면에 이게 그대로 떴습니다.
//     Failed to parse URL from khji…/rest/v1/students?status=eq.재원
//   Supabase 화면이 바뀌면서 Settings → General 에는 ID 만 나오기 때문에,
//   당일에 이걸 넣는 분이 반드시 나옵니다. 영어 날코드가 뜨면 아무도 못 고칩니다.
//
//   node scripts/verify/url-unit.mjs

let fail = 0;
function check(name, cond, got) {
  if (cond) console.log(`  ok  ${name}`);
  else { fail++; console.log(`  FAIL ${name}`); console.log(`       받은 것: ${JSON.stringify(got)}`); }
}

// 환경변수를 바꿔 끼우고 lib/db.js 를 새로 읽는다 (모듈이 읽을 때 한 번만 읽으므로)
let seq = 0;
async function 로드(url) {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_KEY = "fake-for-verify";
  return import(`../../lib/db.js?u=${++seq}`);
}

// 실제로 어떤 주소로 요청이 나가나 — fetch 를 잠깐 가짜로 바꿔 끼운다
async function 나가는주소(url) {
  const m = await 로드(url);
  const orig = globalThis.fetch;
  let 본것 = null;
  globalThis.fetch = async (u) => { 본것 = String(u); return { ok: true, json: async () => [] }; };
  try { await m.select("students", "a=1"); } catch (e) { 본것 = `던짐: ${e.name}`; }
  finally { globalThis.fetch = orig; }
  return 본것;
}

// ── 1. 틀린 꼴을 다듬어서 **같은 주소**로 만든다 ──
const 바른주소 = "https://x.supabase.co/rest/v1/students?a=1";
for (const [넣은값, 설명] of [
  ["https://x.supabase.co", "그대로"],
  ["https://x.supabase.co/", "끝에 /"],
  ["https://x.supabase.co//", "끝에 //"],
  ["https://x.supabase.co/rest/v1", "실수로 /rest/v1 까지"],
  ["https://x.supabase.co/rest/v1/", "/rest/v1/ 까지"],
  ["  https://x.supabase.co  ", "앞뒤 공백"],
]) {
  const got = await 나가는주소(넣은값);
  check(`${설명} → 바른 주소로 나간다`, got === 바른주소, { 넣은값, got });
}

// ── 2. 주소 꼴이 아니면 **막고 한국어로** 알려준다 ──
for (const [넣은값, 설명] of [
  ["khjiwjlxkbuhfgyuuysp", "프로젝트 ID 만 (Settings → General 에서 복사한 것)"],
  ["x.supabase.co", "https:// 가 없음"],
  ["supabase.co/x", "https:// 가 없음 2"],
]) {
  const m = await 로드(넣은값);
  const p = m.urlProblem();
  check(`${설명} → 막는다`, typeof p === "string" && p.length > 0, p);
  check(`${설명} → 한국어로 무엇을 넣을지 알려준다`,
    /SUPABASE_URL/.test(p || "") && /supabase\.co/.test(p || "") && /주소 전체/.test(p || ""), p);
  check(`${설명} → 지금 들어 있는 값을 보여준다`, (p || "").includes(넣은값.slice(0, 12)), p);
  check(`${설명} → Redeploy 를 눌러야 한다고 말해준다`, /Redeploy/.test(p || ""), p);

  // 그리고 실제 호출은 **영어로 터지지 않고** DbInputError 로 막혀야 한다
  const got = await 나가는주소(넣은값);
  check(`${설명} → fetch 전에 막힌다 (영어 TypeError 가 안 뜸)`, got === "던짐: DbInputError", got);
}

// ── 3. 멀쩡한 주소는 통과 ──
{
  const m = await 로드("https://x.supabase.co");
  check("바른 주소는 아무 말도 안 한다", m.urlProblem() === null, m.urlProblem());
  check("바른 주소면 설정됐다고 본다", m.dbConfigured() === true);
}
{
  // 아예 비어 있는 건 여기서 말고 「환경변수가 없어요」 쪽에서 안내합니다
  const m = await 로드("");
  check("빈 값은 여기서 말하지 않는다 (환경변수 없음 안내가 따로 있음)", m.urlProblem() === null, m.urlProblem());
  check("빈 값이면 설정 안 된 것", m.dbConfigured() === false);
}

// ── http:// — Supabase 는 항상 https 입니다 ────────────────────────────
// 원장님이 http://dmqpeaauw….supabase.co 를 넣으셨고, 화면에는 「학생이 한 명도 없다」
// 로 보였습니다. http 로 두면 Supabase 가 https 로 넘기면서 **인증 헤더가 떨어져**
// 전혀 엉뚱한 모습으로 나타납니다 — 원인을 찾기가 아주 어려운 자리입니다.
{
  const m = await 로드("http://abcdefghijklmnopqrst.supabase.co");
  const r = { problem: m.urlProblem() };
  check("★ http:// 를 막는다", Boolean(r.problem), r.problem);
  check("★ https 로 고치라고 말한다", /https/.test(r.problem || ""), r.problem);
  check("★ 지금 들어 있는 값을 보여준다", (r.problem || "").includes("http://abcdefghijklmnopqrst.supabase.co"), r.problem);
  check("★ 고친 주소를 그대로 적어준다",
        (r.problem || "").includes("https://abcdefghijklmnopqrst.supabase.co"), r.problem);   // 가짜 주소 (점검용 예시)
  check("★ 왜 학생이 안 보이는지까지 말한다", /한 명도 없|인증/.test(r.problem || ""), r.problem);
  check("★ Redeploy 를 짚어준다", /Redeploy/.test(r.problem || ""), r.problem);
  check("★ 영어 날코드가 아니다", /[가-힣]/.test(r.problem || ""), r.problem);
}
{
  const m = await 로드("https://abcdefghijklmnopqrst.supabase.co");   // 가짜 주소 (점검용 예시)
  const r = { problem: m.urlProblem() };
  check("https 는 그냥 통과한다", !r.problem, r.problem);
}
// ★ 내 컴퓨터에서 돌리는 Supabase 는 **http 가 정상**입니다 (Supabase CLI = http://127.0.0.1:54321).
//   http 를 통째로 막았다가 그걸 쓰는 길을 끊었고, 검수 하네스까지 멈췄습니다.
for (const u of ["http://127.0.0.1:54321", "http://localhost:54321", "http://localhost", "http://[::1]:54321"]) {
  const m = await 로드(u);
  check(`★ 내 컴퓨터 주소는 막지 않는다 — ${u}`, !m.urlProblem(), m.urlProblem());
}
// 바깥 주소는 포트가 붙어도 막아야 합니다 (localhost 흉내)
{
  const m = await 로드("http://localhost.evil.example.com:54321");
  check("★ localhost 를 흉낸 바깥 주소는 막는다", Boolean(m.urlProblem()), m.urlProblem());
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
