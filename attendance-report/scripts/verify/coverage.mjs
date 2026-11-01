// 코드에서 기능 목록을 뽑아 검수가 건드리는지 대조합니다.
//   node scripts/verify/coverage.mjs   (attendance-report 에서 실행)
import { readFileSync, readdirSync } from "node:fs";
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// 1) 코드가 가진 action 전부
const apis = readdirSync("api").filter((f) => f.endsWith(".js"));
const defined = new Map();           // action → 파일
for (const f of apis) {
  const src = read(`api/${f}`);
  for (const m of src.matchAll(/action === "([a-z-]+)"/g)) defined.set(m[1], f);
}

// 2) 검수가 건드리는 action 전부
const vdir = "scripts/verify";
const testFiles = [
  ...readdirSync(vdir).filter((f) => f.endsWith(".mjs")).map((f) => `${vdir}/${f}`),
  "scripts/smoke-test.mjs",
];
const touched = new Set();
let allTests = "";
for (const f of testFiles) allTests += read(f) + "\n";
for (const a of defined.keys()) {
  // "action=x" (쿼리) 또는 action: "x" (본문) 어느 쪽이든
  if (new RegExp(`action[=:]\\s*["']?${a}\\b`).test(allTests)) touched.add(a);
}

// 3) 화면 목록 vs 브라우저 검수
const screens = readdirSync(".").filter((f) => f.endsWith(".html"));
const browser = read(`${vdir}/browser-check.mjs`);
// 홈 화면은 목록에 "/" 로 적혀 있습니다.
const openedScreens = screens.filter((s) => browser.includes(s) || (s === "index.html" && /\{\s*p:\s*"\/"/.test(browser)));

const miss = [...defined.keys()].filter((a) => !touched.has(a)).sort();
const missScreens = screens.filter((s) => !openedScreens.includes(s));

console.log(`API 동작  ${defined.size}개 중 ${touched.size}개 검수됨`);
console.log(`화면      ${screens.length}개 중 ${openedScreens.length}개 열어봄\n`);
if (miss.length) { console.log("🔴 검수가 안 건드리는 동작:"); for (const a of miss) console.log(`   ${a.padEnd(18)} (${defined.get(a)})`); }
else console.log("✅ 모든 동작이 검수에 들어 있습니다");
if (missScreens.length) console.log("\n🔴 안 열어보는 화면: " + missScreens.join(", "));
