// 수강생이 당일에 실제로 걷는 길을 **처음부터 끝까지** 한 번에.
//
// 왜 따로 생겼나: 전면 검수가 화면·API 를 넓게 훑긴 하는데,
//   · 학생 한 명씩 등록(save-student)
//   · 붙여넣기 일괄등록(bulk-students)
// 이 둘이 아예 빠져 있었습니다. 당일 PART TWO 의 첫 단추라 여기서 막히면
// 그 뒤(출결·리포트·평가서)가 전부 안 돌아갑니다.
//
// 그리고 「손으로 고친 진도가 다음 수업일로 이어지나」도 여기서 봅니다.
// 샘플이 아니라 **방금 만든 학생**으로 처음부터 끝까지 돌려야 진짜 확인이 됩니다.
//
//   node scripts/verify/student-flow-check.mjs   (app-server 가 4330 에 떠 있어야 함)

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
// 샘플이 들어 있는 달 = **지난달**. setup.sql 이 설치한 날 기준으로 넣으므로
// 달을 박아두면 다음 달에 검수가 깨집니다.
const 지난달 = (() => { const n = new Date(Date.now() + 9 * 3600e3);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); })();

const weekday = "일월화수목금토"[new Date(today + "T00:00:00Z").getUTCDay()];
const nextDay = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400e3).toISOString().slice(0, 10);

// ── 1. 학생 한 명씩 등록 ──────────────────────────────────
console.log("── 1. 학생 한 명씩 등록 ──");
let newId = null;
{
  const books = (await get("/api/attendance", "action=textbooks")).d.textbooks || [];
  const pick = (subj) => books.find((b) => b.subject === subj && (b.units || []).length > 2)?.name;
  const myBooks = { 문법: pick("문법"), 리딩: pick("리딩"), 단어: pick("단어") };
  ck("교재DB에서 과목별 교재를 고를 수 있다", Object.values(myBooks).every(Boolean), myBooks);

  const r = await post("/api/attendance", {
    action: "save-student",
    student: {
      name: "검수학생", student_code: "chk01", pin: "9911",
      phone: "01000009911", grade: "중1", teacher: "이선생",   // 가짜 번호 (검수용)
      class_minutes: 120,
      schedule: { [weekday]: "15:00" },   // 오늘 수업 있는 걸로
      books: myBooks,
    },
  });
  ck("★ 한 명 등록된다", r.s === 200 && r.d.student?.id, { s: r.s, e: r.d.error });
  newId = r.d.student?.id;

  const list = await get("/api/attendance", "action=students");
  ck("학생 목록에 보인다", (list.d.students || []).some((x) => x.id === newId), list.d.students?.length);

  // 등록하자마자 오늘 데일리 리포트에 떠야 합니다 (요일을 오늘로 넣었으므로)
  const rows = await get("/api/attendance", `action=daily-rows&date=${today}`);
  const mine = (rows.d.rows || []).find((x) => x.student_id === newId);
  ck("★ 오늘 데일리 리포트에 바로 뜬다", Boolean(mine), rows.d.rows?.map((x) => x.name));
  ck("★ 교재 목차의 첫 유닛이 채워져 있다",
     Boolean(mine?.record?.progress?.문법?.code), mine?.record?.progress);
}

// ── 2. 붙여넣기 일괄등록 ──────────────────────────────────
console.log("\n── 2. 붙여넣기 일괄등록 ──");
{
  const before = (await get("/api/attendance", "action=students")).d.students.length;
  const r = await post("/api/attendance", {
    action: "bulk-students",
    rows: [
      // 아래 두 줄의 연락처는 전부 가짜 샘플입니다
      { name: "일괄가", student_code: "bk01", pin: "8801", phone: "01000008801", grade: "초6", teacher: "박선생", schedule: { [weekday]: "16:00" } },   // 가짜
      { name: "일괄나", student_code: "bk02", pin: "8802", phone: "01000008802", grade: "중2", teacher: "박선생", schedule: { [weekday]: "16:00" } },  // 가짜
      { name: "",       student_code: "bk03" },  // 이름 없는 줄 — 걸러져야 합니다
    ],
  });
  ck("★ 여러 명이 한 번에 등록된다", r.s === 200 && r.d.count === 2, r.d);
  const after = (await get("/api/attendance", "action=students")).d.students.length;
  ck("이름 없는 줄은 걸러진다 (2명만 늘어남)", after - before === 2, { before, after });

  const empty = await post("/api/attendance", { action: "bulk-students", rows: [] });
  ck("빈 목록은 400 으로 막힌다", empty.s === 400, empty.d);
}

// ── 3. 키오스크 → 현황판 ──────────────────────────────────
console.log("\n── 3. 방금 등록한 학생으로 키오스크 ──");
{
  const inR = await post("/api/attendance", { action: "checkin", pin: "9911" });
  ck("★ 새 학생의 PIN 으로 등원된다", inR.s === 200 && inR.d.mode === "in" && inR.d.name === "검수학생", inR.d);
  const board = await get("/api/attendance", "action=board");
  const onBoard = (board.d.students || []).find((x) => x.name === "검수학생");
  ck("현황판에 뜬다", Boolean(onBoard), board.d.stats);
  const outR = await post("/api/attendance", { action: "checkin", pin: "9911" });
  ck("한 번 더 누르면 하원 처리된다", outR.d.mode === "out", outR.d);
}

// ── 4. 진도를 손으로 고치면 다음 수업일이 이어지나 ──────────
console.log("\n── 4. 손으로 고친 진도가 다음 수업일로 이어지나 ──");
{
  const rows = await get("/api/attendance", `action=daily-rows&date=${today}`);
  const mine = (rows.d.rows || []).find((x) => x.student_id === newId);
  const toc = (await get("/api/attendance", "action=textbooks")).d.textbooks
    .find((b) => b.name === mine.books.문법)?.units || [];
  ck("그 교재의 목차가 3개 이상", toc.length >= 3, toc.length);

  // 선생님이 "오늘 3번째 유닛까지 나갔다"고 손으로 고칩니다.
  const edited = toc[2];
  const save = await post("/api/attendance", {
    action: "save-record", student_id: newId, date: today,
    fields: { progress: { ...(mine.record.progress || {}), 문법: edited } },
  });
  ck("★ 진도를 손으로 고쳐 저장된다", save.s === 200, { s: save.s, e: save.d.error });

  const back = await get("/api/attendance", `action=daily-rows&date=${today}`);
  const now = (back.d.rows || []).find((x) => x.student_id === newId);
  ck("고친 값이 그대로 남아 있다", now?.record?.progress?.문법?.code === edited.code,
     { 넣은값: edited.code, 읽은값: now?.record?.progress?.문법?.code });

  // 다음 수업일(같은 요일 = 7일 뒤)을 열면 그 **다음 유닛**이 와야 합니다.
  const next = nextDay(today, 7);
  const peek = await get("/api/attendance", `action=daily-rows&date=${next}`);
  const future = (peek.d.rows || []).find((x) => x.student_id === newId);
  ck(`★ 다음 수업일(${next})에 그 다음 유닛이 온다`,
     future?.record?.progress?.문법?.code === toc[3]?.code,
     { 오늘: edited.code, 다음기대: toc[3]?.code, 실제: future?.record?.progress?.문법?.code });
}

// ── 5. 월말평가서 → 학부모 ────────────────────────────────
console.log("\n── 5. 월말평가서 → 학부모 ──");
{
  const month = 지난달;
  const list = await get("/api/report", `action=students&month=${month}`);
  const target = (list.d.students || [])[0];
  ck("그 달 학생 목록이 온다", Boolean(target), list.d.students?.length);

  const gen = await post("/api/report", { action: "generate", student_id: target.id, month });
  const haveAi = gen.s === 200 && typeof gen.d.body === "string";
  ck("★ 평가서 본문이 생성된다", haveAi, { s: gen.s, e: gen.d.error });

  if (haveAi) {
    const saved = await post("/api/report", {
      action: "save", student_id: target.id, month,
      body: gen.d.body, stats: gen.d.stats, progress: gen.d.progress,
    });
    const tok = saved.d.share_token;
    ck("저장되고 학부모 토큰이 생긴다", Boolean(tok), saved.d);

    // 학부모에게 보내기 — 알림톡 미설정이면 링크 목록만 돌아옵니다.
    const send = await post("/api/report", { action: "send", month });
    ck("★ 학부모 열람 링크 목록이 나온다", send.s === 200, { s: send.s, e: send.d.error });
    const links = send.d.links || send.d.rows || send.d.sent || [];
    ck("링크에 토큰이 들어 있다",
       JSON.stringify(send.d).includes(tok), String(JSON.stringify(send.d)).slice(0, 200));

    // 학부모 화면 — 토큰 + 출결번호
    const stu = (await get("/api/attendance", "action=students")).d.students.find((x) => x.id === target.id);
    const noPin = await get("/api/report", `action=parent&token=${encodeURIComponent(tok)}`);
    ck("★ 출결번호 없이는 안 열린다", noPin.d.needPin === true, noPin.d);
    const ok = await get("/api/report", `action=parent&token=${encodeURIComponent(tok)}&pin=${stu.pin}`);
    ck("★ 출결번호를 넣으면 열린다", ok.s === 200 && (ok.d.reports || []).length > 0, { s: ok.s, n: ok.d.reports?.length });
    ck("★ 본인 것만 보인다", ok.d.student?.name === target.name, ok.d.student);
    ck("평가서에 그래프 데이터(planner)가 같이 온다", Boolean(ok.d.reports?.[0]?.planner), Object.keys(ok.d.reports?.[0] || {}));
  }
}

// ── 6. 치우기 ─────────────────────────────────────────────
console.log("\n── 6. 검수용 학생 치우기 ──");
{
  const list = (await get("/api/attendance", "action=students")).d.students || [];
  let gone = 0;
  for (const s of list.filter((x) => ["검수학생", "일괄가", "일괄나"].includes(x.name))) {
    const r = await post("/api/attendance", { action: "delete-student", id: s.id });
    if (r.s === 200) gone++;
  }
  ck("검수용 학생 3명이 지워진다", gone === 3, gone);
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
