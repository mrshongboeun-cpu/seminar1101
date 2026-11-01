// 나머지 동작들 — 코드에는 있는데 검수가 한 번도 안 건드리던 것들.
//
// 어떻게 찾았나: 감으로 고르지 않고 api/*.js 에서 `action === "x"` 를 전부 뽑아
// 검수 스크립트들과 대조했습니다(scripts/verify/coverage.mjs). 그래서 남은 게 이 다섯.
//
//   checkout               현황판에서 카드 터치로 하원 (카톡 안 보냄)
//   delete-textbook        교재 삭제
//   get                    저장한 평가서를 다시 열기 (고치려고)
//   student-reports        한 학생의 지난 평가서 목록
//   students-with-reports  평가서가 있는 학생만 추리기
//
//   node scripts/verify/rest-actions-check.mjs

const B = "http://localhost:4330";
let fail = 0;
const ck = (l, c, d) => {
  console.log(`${c ? "  ok " : "FAIL "} ${l}${c ? "" : "  → " + String(JSON.stringify(d ?? null)).slice(0, 240)}`);
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

// ── 1. 현황판에서 하원 처리 ───────────────────────────────
console.log("── 1. 현황판 하원 처리 (checkout) ──");
//  샘플 학생을 빌려 쓰면 앞 단계(3-1·3-1-B)가 이미 등·하원시켜 놓은 상태에 걸립니다.
//  키오스크는 토글이 아니라 **세 단계**(등원 → 하원 → 「이미 하원했습니다」)라서,
//  한 번 하원한 학생은 다시 등원이 안 됩니다. 그래서 검수용 학생을 새로 만들어 씁니다.
const 치울학생 = [];
{
  const mk = async (name, pin) => {
    const r = await post("/api/attendance", {
      action: "save-student",
      student: {
        name, student_code: pin, pin, phone: "0100000" + pin, grade: "중1",   // 가짜 번호 (검수용)
        teacher: "이선생", class_minutes: 120, schedule: { [weekday]: "15:00" },
      },
    });
    if (r.d.student?.id) 치울학생.push(r.d.student.id);
    return r.d.student;
  };
  const stu = await mk("하원검수가", "9921");
  ck("검수용 학생이 만들어진다", Boolean(stu?.id), stu);

  // 등원 시각은 **키오스크로만** 찍힙니다 (save-record 는 check_in 을 안 받습니다 —
  // 손으로 고칠 수 없게 한 설계). 그래서 실제 순서 그대로 PIN 으로 등원시킵니다.
  const inR = await post("/api/attendance", { action: "checkin", pin: "9921" });
  ck("키오스크로 등원된다", inR.s === 200 && inR.d.mode === "in", inR.d);
  const 등원시각 = inR.d.time;

  const r = await post("/api/attendance", { action: "checkout", student_id: stu.id });
  ck("★ 하원 시각이 찍힌다", r.s === 200 && /^\d{1,2}:\d{2}$/.test(r.d.record?.check_out || ""), r.d.record);
  ck("★ 등원 시각이 덮어써지지 않는다", r.d.record?.check_in === 등원시각,
     { 키오스크: 등원시각, 하원후: r.d.record?.check_in });

  // 한 번 하원한 뒤 PIN 을 또 누르면 「이미 하원했습니다」가 떠야 합니다 (중복 발송 방지)
  const again = await post("/api/attendance", { action: "checkin", pin: "9921" });
  ck("★ 하원한 학생이 PIN 을 또 누르면 '이미 하원'", again.d.mode === "done", again.d);

  // 등원을 안 찍은 학생을 현황판에서 바로 하원시키면 등원도 같이 채워져야 합니다
  const stu2 = await mk("하원검수나", "9922");
  const r2 = await post("/api/attendance", { action: "checkout", student_id: stu2.id });
  ck("★ 등원 기록이 없어도 하원이 된다 (등원도 같이 채움)",
     Boolean(r2.d.record?.check_in) && Boolean(r2.d.record?.check_out), r2.d.record);
  ck("지각 여부가 비지 않는다", Boolean(r2.d.record?.lateness), r2.d.record?.lateness);

  const bad = await post("/api/attendance", { action: "checkout" });
  ck("학생을 안 고르면 400", bad.s === 400, bad.d);
}

// ── 2. 교재 삭제 ─────────────────────────────────────────
console.log("\n── 2. 교재 삭제 (delete-textbook) ──");
{
  const made = await post("/api/attendance", {
    action: "save-textbook",
    textbook: { subject: "문법", name: "검수용교재", units: [{ code: "U1", title: "하나" }] },
  });
  const id = made.d.textbook?.id ?? made.d.id;
  ck("검수용 교재가 만들어진다", made.s === 200 && Boolean(id), made.d);

  const before = (await get("/api/attendance", "action=textbooks")).d.textbooks.length;
  const del = await post("/api/attendance", { action: "delete-textbook", id });
  ck("★ 교재가 지워진다", del.s === 200 && del.d.ok, del.d);
  const after = (await get("/api/attendance", "action=textbooks")).d.textbooks.length;
  ck("목록에서 하나 줄어든다", before - after === 1, { before, after });

  const bad = await post("/api/attendance", { action: "delete-textbook" });
  ck("id 없이 부르면 400", bad.s === 400, bad.d);
}

// ── 3. 저장한 평가서를 다시 열기 ──────────────────────────
console.log("\n── 3. 저장한 평가서 다시 열기 (get) ──");
{
  const month = 지난달;
  const list = (await get("/api/report", `action=students&month=${month}`)).d.students || [];
  const target = list[0];

  // 먼저 하나 저장해 둡니다 (AI 없이도 본문을 직접 넣어 저장 가능)
  const body = "검수용 평가서 본문입니다.";
  const saved = await post("/api/report", {
    action: "save", student_id: target.id, month, body,
    stats: { 수업일수: 10 }, progress: {},
  });
  ck("평가서가 저장된다", saved.s === 200 && Boolean(saved.d.share_token), saved.d);

  const got = await get("/api/report", `action=get&student_id=${target.id}&month=${month}`);
  ck("★ 저장한 본문이 그대로 돌아온다", got.s === 200 && got.d.report?.body === body,
     { 넣은값: body, 읽은값: got.d.report?.body });
  ck("학부모 토큰도 같이 온다", Boolean(got.d.report?.share_token), Object.keys(got.d.report || {}));

  const none = await get("/api/report", `action=get&student_id=${target.id}&month=1999-01`);
  ck("없는 달은 404 + 친절한 문구", none.s === 404 && /없어요/.test(none.d.error || ""), none.d);

  const bad = await get("/api/report", "action=get&student_id=");
  ck("학생을 안 고르면 400", bad.s === 400, bad.d);
}

// ── 4. 한 학생의 지난 평가서 목록 ─────────────────────────
console.log("\n── 4. 한 학생의 지난 평가서 (student-reports) ──");
{
  const list = (await get("/api/report", `action=students&month=${지난달}`)).d.students || [];
  const target = list[0];
  const r = await get("/api/report", `action=student-reports&student_id=${target.id}`);
  ck("★ 그 학생의 평가서 목록이 온다", r.s === 200 && Array.isArray(r.d.reports) && r.d.reports.length > 0, r.d.reports?.length);
  ck("월·토큰이 함께 온다", Boolean(r.d.reports?.[0]?.month) && Boolean(r.d.reports?.[0]?.share_token), r.d.reports?.[0]);
  const bad = await get("/api/report", "action=student-reports");
  ck("학생을 안 고르면 400", bad.s === 400, bad.d);
}

// ── 5. 평가서가 있는 학생만 ───────────────────────────────
console.log("\n── 5. 평가서가 있는 학생만 (students-with-reports) ──");
{
  const r = await get("/api/report", "action=students-with-reports");
  ck("★ 목록이 온다", r.s === 200 && Array.isArray(r.d.students), r.d);
  ck("이름·학년이 함께 온다", r.d.students.length === 0 || (r.d.students[0].name && "grade" in r.d.students[0]), r.d.students?.[0]);
  // 평가서를 한 장 저장해 뒀으니 최소 1명은 있어야 합니다
  ck("아까 저장한 학생이 들어 있다", r.d.students.length >= 1, r.d.students?.length);
}

// ── 6. 치우기 ─────────────────────────────────────────────
console.log("\n── 6. 검수용 학생 치우기 ──");
{
  let gone = 0;
  for (const id of 치울학생) {
    const r = await post("/api/attendance", { action: "delete-student", id });
    if (r.s === 200) gone++;
  }
  ck("검수용 학생이 지워진다", gone === 치울학생.length, { 만든것: 치울학생.length, 지운것: gone });
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
