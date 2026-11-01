// advanceProgress 의 경계 동작만 직접 확인한다 (DB·서버 없이).
// daily-rows 로는 못 보는 것들: 목차 끝에서 멈추는지, 목차에 없는 값을 지키는지.
import { advanceProgress, findUnitIndex } from "../../lib/progress.js";

const units = [
  { code: "Unit 1", title: "be동사" },
  { code: "Unit 2", title: "일반동사" },
  { code: "Unit 3", title: "현재진행" },
];
const toc = { "그래머1": { units, step: 1 } };
const books = { 문법: "그래머1" };

let fail = 0;
const is = (name, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? "ok " : "❌ "} ${name}${ok ? "" : ` — 기대 "${want}", 받음 "${got}"`}`);
  if (!ok) fail = 1;
};
const code = (r) => (r.문법 && r.문법.code) || String(r.문법 ?? "");

is("첫 진도는 목차 1번", code(advanceProgress(null, books, toc)), "Unit 1");
is("한 칸 전진", code(advanceProgress({ 문법: { code: "Unit 1" } }, books, toc)), "Unit 2");
is("★ 목차 끝에서는 멈춤", code(advanceProgress({ 문법: { code: "Unit 3" } }, books, toc)), "Unit 3");
is("수기로 쓴 '3과' 도 찾아냄", code(advanceProgress({ 문법: { code: "3과" } }, books, toc)), "Unit 3");
is("목차에 없는 값은 그대로 유지",
   code(advanceProgress({ 문법: { code: "특별수업" } }, books, toc)), "특별수업");
is("하루 2유닛(step) 적용",
   code(advanceProgress({ 문법: { code: "Unit 1" } }, books, { "그래머1": { units, step: 2 } })), "Unit 3");
is("목차 없는 교재는 지난 값 유지",
   code(advanceProgress({ 문법: { code: "Unit 9" } }, books, { "그래머1": { units: [], step: 1 } })), "Unit 9");

// ── 수기 진도 표기 ─────────────────────────────────────────
// 1·2차 수강생은 진도를 **손으로** 써왔습니다. 「5과」·「Unit 5 현재완료」는 목차에 붙여줘야
//   진도 자동이 켜지고, 「특강 3회차」 같은 **교재와 무관한 메모**는 붙으면 안 됩니다.
//   예전에는 숫자 하나만 보고 붙여서 「특강 3회차」가 U3 으로 인식돼 다음 날 U4 로 넘어갔습니다.
{
  const u12 = Array.from({ length: 12 }, (_, i) => ({ code: `Unit ${i + 1}`, title: `${i + 1}과` }));
  const 찾기 = (c) => findUnitIndex(u12, { code: c });
  for (const [표기, 기대] of [
    ["Unit 5", 4], ["unit5", 4], ["UNIT 5", 4], ["U5", 4], ["5", 4], ["5과", 4],
    ["제5과", 4], ["5주차", 4], ["5차시", 4], ["Lesson 5", 4], ["Day 5", 4],
    ["Unit 5 현재완료", 4],
  ]) is(`수기 "${표기}" → ${u12[기대].code}`, 찾기(표기), 기대);

  for (const 메모 of ["특강 3회차", "보충 2일차", "레벨테스트 1차", "방학특강 2", "상담 3회", "온라인 보충 4"])
    is(`★ 교재와 무관한 "${메모}" 는 목차에 안 붙는다`, 찾기(메모), -1);

  is("★ 그래서 수기 메모는 다음 날도 그대로",
     code(advanceProgress({ 문법: { code: "특강 3회차" } }, books, toc)), "특강 3회차");
}

console.log(fail ? "\n❌ 경계 동작 실패" : "\n✅ 경계 동작 통과");
process.exit(fail);
