// 같은 유닛코드가 여럿일 때 진도가 맴돌지 않나 — lib/progress.js 단위 점검.
//
// 왜 생겼나: 원장님이 리딩 교재 목차를 이렇게 넣으셨습니다.
//     CH1-1 … CH1-4
//     리뷰 | CH1 리뷰 문제풀이      ← 「리뷰」 를 챕터마다 **같은 코드**로
//     CH2-1 … CH2-4
//     리뷰 | CH2 리뷰 문제풀이
//   앱은 코드로 위치를 찾는데 「리뷰」가 10개면 늘 **첫 번째**(CH1 리뷰)를 찾아서,
//   그 다음인 CH2-1 로 되돌아갑니다. **CH3 에 영영 못 갑니다.**
//   화면엔 아무 경고도 안 뜨고 진도는 멀쩡해 보입니다 — 한 달 뒤에나 압니다.
//
//   node scripts/verify/toc-dup-unit.mjs

import { advanceProgress, findUnitIndex } from "../../lib/progress.js";

let fail = 0;
function check(name, cond, got) {
  if (cond) console.log(`  ok  ${name}`);
  else { fail++; console.log(`  FAIL ${name}`); console.log(`       받은 것: ${JSON.stringify(got)}`); }
}

// 챕터 10개 × (유닛 4 + 리뷰 1). 리뷰의 **코드를 어떻게 줄지**만 바꿔가며 봅니다.
function 목차(리뷰코드) {
  const units = [];
  for (let ch = 1; ch <= 10; ch++) {
    for (let u = 1; u <= 4; u++) units.push({ code: `CH${ch}-${u}`, title: `Unit ${u}` });
    units.push({ code: 리뷰코드(ch), title: `CH${ch} 리뷰 문제풀이` });
  }
  return units;
}
// 첫 유닛부터 n번 수업한 길 (제목까지 같이 — 코드만 보면 리뷰가 다 같아 보입니다)
function 걸어보기(units, n) {
  const toc = { 책: { units, step: 1 } }, books = { 리딩: "책" };
  let p = { 리딩: units[0] };
  const 길 = [];
  for (let i = 0; i < n; i++) {
    길.push(`${p.리딩.code}|${p.리딩.title}`);
    p = advanceProgress(p, books, toc);
  }
  return 길;
}

for (const [이름, 리뷰코드] of [
  ["코드를 다르게 준 목차 (CH1-리뷰 …)", (ch) => `CH${ch}-리뷰`],
  ["★ 코드가 겹치는 목차 (전부 「리뷰」)", () => "리뷰"],
]) {
  const units = 목차(리뷰코드);
  const 길 = 걸어보기(units, 16);

  // ① 같은 자리를 두 번 밟지 않는다 (= 맴돌지 않는다)
  check(`${이름} — 같은 자리를 다시 밟지 않는다`, new Set(길).size === 길.length,
    길.filter((x, i) => 길.indexOf(x) !== i));

  // ② 목차 순서대로 간다
  const 기대 = units.slice(0, 16).map((u) => `${u.code}|${u.title}`);
  check(`${이름} — 목차 순서 그대로 간다`, 길.join(" → ") === 기대.join(" → "),
    { 간길: 길.slice(0, 12), 기대: 기대.slice(0, 12) });

  // ③ CH3 까지 닿는다 (맴돌면 여기서 걸립니다)
  check(`${이름} — CH3 까지 닿는다`, 길.some((x) => x.startsWith("CH3-")), 길);
}

// ── 제목이 없으면? 옛 기록처럼 코드만 남아 있을 수 있습니다 ──
{
  const units = 목차(() => "리뷰");
  // 제목 없이 코드만 아는 경우 — 첫 번째를 고르는 게 맞습니다(알 길이 없으니)
  check("제목이 없으면 첫 번째를 고른다 (예전과 같게)",
    findUnitIndex(units, { code: "리뷰" }) === 4, findUnitIndex(units, { code: "리뷰" }));
  // 제목이 있으면 제 자리를
  check("제목이 있으면 그 챕터의 리뷰를 찾는다",
    findUnitIndex(units, { code: "리뷰", title: "CH7 리뷰 문제풀이" }) === 34,
    findUnitIndex(units, { code: "리뷰", title: "CH7 리뷰 문제풀이" }));
  // 목차에 없는 제목이면 첫 번째로 (떨어뜨리지 않습니다)
  check("모르는 제목이면 첫 번째로 (진도를 잃지 않는다)",
    findUnitIndex(units, { code: "리뷰", title: "엉뚱한 제목" }) === 4,
    findUnitIndex(units, { code: "리뷰", title: "엉뚱한 제목" }));
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
