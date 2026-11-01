// ★ 기본 포트를 **4332** 로 둡니다 (시나리오 전용). 예전에는 4331 이었는데,
//   그건 진도 점검(daily-progress-check.sh)이 쓰는 포트입니다. SC_BASE 가 어쩌다
//   안 넘어오면 **다른 검수의 서버에 조용히 붙어** 엉뚱한 DB 를 보게 됩니다.
export const B = process.env.SC_BASE || "http://127.0.0.1:4332";

// 서버가 안 떠 있으면 **무슨 일인지 바로** 알려줍니다 —
//   예전에는 undici 의 "fetch failed" 스택만 쏟아져서 원인을 찾는 데 한참 걸렸습니다.
async function 서버살았나() {
  try { await fetch(`${B}/`); } catch (e) {
    console.log(`\n❌ 시나리오용 서버(${B})가 안 떠 있습니다.`);
    console.log("   scenarios/run.sh 로 돌리세요 — DB 를 깔고 서버를 띄워줍니다.");
    console.log("   (혼자 돌리려면 SC_BASE 를 띄워둔 주소로 지정하세요)");
    process.exit(1);
  }
}
await 서버살았나();
export // ★ 「오늘」은 **한국시간** 입니다. 앱이 KST 로 판단하기 때문에,
//   UTC 로 계산하면 저녁(한국 자정 이후)에 **하루 어긋나** 전부 엉뚱한 날을 봅니다.
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const 지난달 = (() => { const d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
export const state = { n: 0, fail: 0, bad: [], 시나리오: "" };

export function 시작(name) { state.시나리오 = name; console.log(`\n── ${name} ──`); }
export function ck(name, ok, d) {
  state.n++;
  if (!ok) { state.fail++; state.bad.push(`[${state.시나리오}] ${name}  → ${JSON.stringify(d)}`); console.log("  FAIL  " + name + "  → " + JSON.stringify(d)); }
  else console.log("  ok  " + name);
  return ok;
}
export const get = async (p, q) => { const r = await fetch(`${B}${p}?${q}`); return { s: r.status, d: await r.json().catch(() => ({})) }; };
export const post = async (p, b) => { const r = await fetch(`${B}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { s: r.status, d: await r.json().catch(() => ({})) }; };
export function 끝() {
  console.log(`\n점검 ${state.n}개 · 실패 ${state.fail}개`);
  if (state.bad.length) { console.log("\n실패:"); state.bad.forEach(x => console.log("  ❌ " + x)); }
  process.exit(state.fail ? 1 : 0);
}
// 응답 모양을 먼저 찍어 보고 쓰기 — 짐작으로 쓰다 여러 번 틀렸습니다.
export function 모양(label, o) { console.log(`     (${label} 키: ${Object.keys(o || {}).join(", ")})`); }
