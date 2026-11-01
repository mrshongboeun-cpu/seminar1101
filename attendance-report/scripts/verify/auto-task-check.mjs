// 유닛에 적어둔 과제가 **그 학생 진도에 맞춰** 저절로 나가는지.
//
// 왜 중요한가: 「아이마다 다른 진도」가 이 시스템의 간판인데, 과제가 전원 같은
// 내용으로 나가면 그 간판이 무너집니다. 그리고 선생님이 손으로 낸 과제를
// 자동 과제가 지워버리면 **수업이 틀어집니다** — 그게 제일 위험합니다.
//
//   node scripts/verify/auto-task-check.mjs   (app-server 가 4330 에 떠 있어야 함)

const B = "http://localhost:4330";
let fail = 0;
const ck = (l, c, d) => {
  console.log(`${c ? "  ok " : "FAIL "} ${l}${c ? "" : "  → " + String(JSON.stringify(d ?? null)).slice(0, 260)}`);
  if (!c) fail++;
};
const get = async (p, q) => { const r = await fetch(`${B}${p}?${q}`); return { s: r.status, d: await r.json() }; };
const post = async (p, b) => {
  const r = await fetch(`${B}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { s: r.status, d: await r.json() };
};
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const weekday = "일월화수목금토"[new Date(today + "T00:00:00Z").getUTCDay()];
const 치울것 = { 학생: [], 교재: [] };

// ── 1. 과제가 적힌 교재를 만든다 ──────────────────────────
console.log("── 1. 유닛에 과제를 적어둔 교재 ──");
const 유닛 = [
  { code: "U1", title: "첫 과", 집과제: ["U1 워크북", "U1 단어"], 학원과제: "U1 본문 읽기" },
  { code: "U2", title: "둘째 과", 집과제: ["U2 워크북"] },
  { code: "U3", title: "셋째 과" },               // 과제를 안 적은 유닛
  { code: "U4", title: "넷째 과", 집과제: ["U4 워크북"] },
];
let 교재명 = "자동과제검수교재";
{
  const r = await post("/api/attendance", {
    action: "save-textbook",
    textbook: { subject: "문법", name: 교재명, units: 유닛 },
  });
  const id = r.d.textbook?.id ?? r.d.id;
  if (id) 치울것.교재.push(id);
  ck("과제가 적힌 교재가 저장된다", r.s === 200 && Boolean(id), r.d);

  const back = (await get("/api/attendance", "action=textbooks")).d.textbooks.find((b) => b.name === 교재명);
  ck("★ 집과제가 그대로 돌아온다", JSON.stringify(back?.units?.[0]?.집과제) === JSON.stringify(["U1 워크북", "U1 단어"]), back?.units?.[0]);
  ck("★ 학원과제도 돌아온다", back?.units?.[0]?.학원과제 === "U1 본문 읽기", back?.units?.[0]);
}

// ── 2. 학생을 만들면 오늘 과제가 저절로 ───────────────────
console.log("\n── 2. 진도가 닿으면 저절로 나가나 ──");
let 학생 = null;
{
  const r = await post("/api/attendance", {
    action: "save-student",
    student: {
      name: "자동과제학생", student_code: "auto01", pin: "7701",
      phone: "01000007701", grade: "중1", teacher: "이선생",   // 가짜 번호 (검수용)
      class_minutes: 120, schedule: { [weekday]: "15:00" }, books: { 문법: 교재명 },
    },
  });
  학생 = r.d.student;
  if (학생?.id) 치울것.학생.push(학생.id);
  ck("학생이 등록된다", Boolean(학생?.id), r.d);

  // 데일리 리포트를 열면 오늘 행이 만들어지고 — 그때 과제도 같이 깔립니다
  const rows = await get("/api/attendance", `action=daily-rows&date=${today}`);
  const mine = (rows.d.rows || []).find((x) => x.student_id === 학생.id);
  ck("오늘 진도가 U1 이다", mine?.record?.progress?.문법?.code === "U1", mine?.record?.progress);

  const t = await get("/api/attendance", `action=tasks&date=${today}`);
  const 내것 = (t.d.tasks || []).filter((x) => x.student_id === 학생.id);
  ck("★ U1 집과제 2개가 저절로 생긴다", 내것.filter((x) => x.kind === "집").length === 2, 내것.map((x) => x.title));
  ck("★ U1 학원과제도 생긴다", 내것.some((x) => x.kind === "학원" && x.title === "U1 본문 읽기"), 내것.map((x) => x.kind + ":" + x.title));
  ck("자동으로 생긴 것이라고 표시된다", 내것.every((x) => x.auto === true), 내것.map((x) => x.auto));
}

// ── 3. 진도를 고치면 과제도 따라온다 ──────────────────────
console.log("\n── 3. 진도를 고치면 과제도 따라오나 ──");
{
  await post("/api/attendance", {
    action: "save-record", student_id: 학생.id, date: today,
    fields: { progress: { 문법: { code: "U2", title: "둘째 과" } } },
  });
  const t = await get("/api/attendance", `action=tasks&date=${today}`);
  const 내것 = (t.d.tasks || []).filter((x) => x.student_id === 학생.id);
  ck("★ U2 과제로 바뀐다", 내것.length === 1 && 내것[0].title === "U2 워크북", 내것.map((x) => x.title));
  ck("U1 과제는 사라진다", !내것.some((x) => x.title.startsWith("U1")), 내것.map((x) => x.title));
}

// ── 4. ★★ 손으로 낸 과제는 안 지워진다 ───────────────────
console.log("\n── 4. ★★ 선생님이 손으로 낸 과제는 지켜지나 ──");
{
  await post("/api/attendance", {
    action: "save-tasks", date: today, student_ids: [학생.id],
    items: [{ kind: "집", subject: "문법", title: "선생님이 직접 낸 과제" }],
  });
  // 진도를 또 바꿔 자동 과제를 다시 깔게 만든다
  await post("/api/attendance", {
    action: "save-record", student_id: 학생.id, date: today,
    fields: { progress: { 문법: { code: "U4", title: "넷째 과" } } },
  });
  const t = await get("/api/attendance", `action=tasks&date=${today}`);
  const 내것 = (t.d.tasks || []).filter((x) => x.student_id === 학생.id);
  ck("★★ 손으로 낸 과제가 그대로 있다", 내것.some((x) => x.title === "선생님이 직접 낸 과제"), 내것.map((x) => x.title));
  ck("★ 자동 과제는 U4 로 바뀌었다", 내것.some((x) => x.title === "U4 워크북"), 내것.map((x) => x.title));
  ck("U2 자동 과제는 사라졌다", !내것.some((x) => x.title === "U2 워크북"), 내것.map((x) => x.title));
}

// ── 5. 과제를 안 적은 유닛은 아무것도 안 나온다 ───────────
console.log("\n── 5. 과제를 안 적은 유닛 (기존 교재와 같은 상황) ──");
{
  await post("/api/attendance", {
    action: "save-record", student_id: 학생.id, date: today,
    fields: { progress: { 문법: { code: "U3", title: "셋째 과" } } },
  });
  const t = await get("/api/attendance", `action=tasks&date=${today}`);
  const 내것 = (t.d.tasks || []).filter((x) => x.student_id === 학생.id);
  ck("★ 자동 과제가 하나도 안 생긴다", !내것.some((x) => x.auto), 내것.map((x) => x.title + "(auto=" + x.auto + ")"));
  ck("손으로 낸 과제는 여전히 남아 있다", 내것.some((x) => x.title === "선생님이 직접 낸 과제"), 내것.map((x) => x.title));
}

// ── 6. 치우기 ─────────────────────────────────────────────
console.log("\n── 6. 검수용 자료 치우기 ──");
{
  let n = 0;
  for (const id of 치울것.학생) if ((await post("/api/attendance", { action: "delete-student", id })).s === 200) n++;
  for (const id of 치울것.교재) if ((await post("/api/attendance", { action: "delete-textbook", id })).s === 200) n++;
  ck("검수용 학생·교재가 지워진다", n === 치울것.학생.length + 치울것.교재.length, n);
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
