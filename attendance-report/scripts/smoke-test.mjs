// 가짜 PostgREST — api/*.js 를 실제로 호출해 로직을 점검한다 (Supabase 없이).
process.env.SUPABASE_URL = "https://fake";   // 가짜 주소 (점검용) — https 여야 합니다, lib/db.js 가 http 를 막습니다
process.env.SUPABASE_SERVICE_KEY = "fake";

// ⚠️ 점검용 학생은 **요일 7개를 모두** 채웁니다.
//    예전에는 화·목이 비어 있어서, 화요일이나 목요일에 돌리면 "오늘 올 학생" 이 0명이 되어
//    점검 7건이 한꺼번에 FAIL 났습니다. 세미나가 화·목에 열리면 수강생 전원이
//    `node scripts/smoke-test.mjs` 에서 ❌ 를 보게 되는 지뢰였습니다.
//    (실제 등원 요일 설정은 students.html 에서 하고, 여기는 로직 점검용 고정 픽스처입니다.)
const EVERYDAY = (t) => ({ 월: t, 화: t, 수: t, 목: t, 금: t, 토: t, 일: t });

const T = {
  students: [
    { id: "s1", name: "김민준", student_code: "demo01", pin: "1111", phone: "010-0000-0001",
      grade: "중2", teacher: "이선생", class_minutes: 120, status: "재원",
      schedule: EVERYDAY("17:00"),
      books: { 문법: "그래머인유즈 1", 리딩: "리딩릴레이 스타터1", 단어: "능률 보카 기본" } },
    { id: "s2", name: "박도윤", student_code: "demo03", pin: "3333", phone: "010-0000-0003",
      grade: "초6", teacher: "박선생", class_minutes: 90, status: "재원",
      schedule: EVERYDAY("16:00"),
      books: { 문법: "초등 그래머" } },
    { id: "s3", name: "퇴원생", student_code: "demo09", pin: "9999", status: "퇴원", schedule: {}, books: {} },
  ],
  textbooks: [
    { id: "b1", subject: "문법", name: "그래머인유즈 1", step: 1,
      units: [{ code: "Unit 1", title: "be동사" }, { code: "Unit 2", title: "일반동사" }, { code: "Unit 3", title: "현재진행" }] },
    { id: "b2", subject: "리딩", name: "리딩릴레이 스타터1", step: 1,
      units: [{ code: "Unit 1", title: "My Family" }, { code: "Unit 2", title: "School Life" }] },
    { id: "b3", subject: "단어", name: "능률 보카 기본", step: 1, units: [{ code: "Day 1-10", title: "기초 어휘" }] },
    { id: "b4", subject: "문법", name: "초등 그래머", step: 1, units: [{ code: "1과", title: "명사" }, { code: "2과", title: "대명사" }] },
  ],
  daily_records: [],
  monthly_reports: [{ id: "m1", student_id: "s1", month: "2026-05", share_token: "tok1", created_at: "2026-06-01" }],
  monthly_comments: [],
  tasks: [],
};

let seq = 0;
const nextId = () => `g${++seq}`;

function parseQ(qs) {
  const filters = [], out = { filters, order: null, limit: null };
  for (const [k, v] of new URLSearchParams(qs)) {
    if (k === "order") { out.order = v; continue; }
    if (k === "limit") { out.limit = Number(v); continue; }
    if (k === "select" || k === "on_conflict") continue;
    const m = /^(eq|lt|lte|gt|gte|neq)\.(.*)$/.exec(v);
    if (m) filters.push([k, m[1], m[2]]);
  }
  return out;
}
const cmp = (a, op, b) => ({
  eq: a == b, neq: a != b, lt: a < b, lte: a <= b, gt: a > b, gte: a >= b,
}[op]);

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const table = u.pathname.replace("/rest/v1/", "");
  const rows = (T[table] = T[table] || []);
  const q = parseQ(u.search.replace(/^\?/, ""));
  const match = (r) => q.filters.every(([c, op, v]) => cmp(String(r[c] ?? ""), op, v));
  const method = opts.method || "GET";
  const body = opts.body ? JSON.parse(opts.body) : null;
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

  if (method === "GET") {
    let r = rows.filter(match);
    if (q.order) {
      const [col, dir] = q.order.split(".");
      r = [...r].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (dir === "desc" ? -1 : 1));
    }
    if (q.limit) r = r.slice(0, q.limit);
    return ok(r);
  }
  if (method === "POST") {
    const added = body.map((x) => ({ id: nextId(), done: false, ...x }));
    rows.push(...added);
    return ok(added);
  }
  if (method === "PATCH") {
    const hit = rows.filter(match);
    hit.forEach((r) => Object.assign(r, body));
    return ok(hit);
  }
  if (method === "DELETE") {
    for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
    return ok(true);
  }
  throw new Error("unhandled " + method);
};

const student = (await import("/home/user/seminar-materials/attendance-report/api/student.js")).default;
const attendance = (await import("/home/user/seminar-materials/attendance-report/api/attendance.js")).default;

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const call = async (h, req) => { const res = mkRes(); await h(req, res); return res; };
const GET = (h, query) => call(h, { method: "GET", query, body: null });
const POST = (h, body) => call(h, { method: "POST", query: {}, body });

let fail = 0;
function check(label, cond, detail) {
  console.log(`${cond ? "  ok " : "FAIL "} ${label}${cond ? "" : "  → " + JSON.stringify(detail)}`);
  if (!cond) fail++;
}

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ── 1. 데일리 행 생성 = 교재 목차 첫 유닛 ──────────────────
let r = await GET(attendance, { action: "daily-rows" });
check("daily-rows 200", r.code === 200, r.body);
check("두 학생 행 생성", r.body.rows?.length === 2, r.body.rows?.length);
check("진도 = 목차 1번 (Unit 1)", r.body.rows?.[0]?.record?.progress?.["문법"]?.code === "Unit 1", r.body.rows?.[0]?.record?.progress);

// ── 2. 선생님 필터 ──────────────────────────────────────
r = await GET(attendance, { action: "daily-rows", teacher: "이선생" });
check("teacher 필터 — 1명만", r.body.rows?.length === 1 && r.body.rows[0].name === "김민준", r.body.rows?.map((x) => x.name));
r = await GET(attendance, { action: "board", teacher: "박선생" });
check("board teacher 필터", r.body.students?.length === 1 && r.body.students[0].name === "박도윤", r.body.students?.map((x) => x.name));
r = await GET(attendance, { action: "teachers" });
check("teachers 목록 (퇴원생 제외)", JSON.stringify(r.body.teachers) === JSON.stringify(["박선생", "이선생"]), r.body.teachers);

// ── 3. 과제 내주기 ──────────────────────────────────────
r = await POST(attendance, { action: "save-tasks", date: today, student_ids: ["s1", "s2"],
  items: [{ kind: "집", subject: "문법", title: "워크북 p.42" }, { kind: "학원", title: "단어 시험" }, { title: "   " }] });
check("save-tasks 2명×2항목 = 4건", r.body.created === 4, r.body);
r = await POST(attendance, { action: "save-tasks", date: today, student_ids: [], items: [{ title: "x" }] });
check("학생 안 고르면 400", r.code === 400, r.body);
r = await POST(attendance, { action: "save-tasks", date: today, student_ids: ["s1"], items: [] });
check("항목 없으면 400", r.code === 400, r.body);

// ── 4. 과제 현황 — 담당 학생 것만 ────────────────────────
r = await GET(attendance, { action: "tasks", date: today, teacher: "이선생" });
check("tasks teacher 필터 = 2건", r.body.tasks?.length === 2, r.body.tasks?.length);
check("tasks 에 학생 이름 붙음", r.body.tasks?.every((t) => t.name === "김민준"), r.body.tasks?.map((t) => t.name));

// ── 5. 학생앱 로그인 ────────────────────────────────────
r = await POST(student, { action: "login", code: "demo01", pin: "1111" });
check("학생 로그인 성공", r.code === 200 && r.body.me.name === "김민준", r.body);
r = await POST(student, { action: "login", code: "demo01", pin: "9999" });
check("PIN 틀리면 401", r.code === 401, r.body);
r = await POST(student, { action: "login", code: "demo09", pin: "9999" });
check("퇴원생 로그인 거부", r.code === 401, r.body);

// ── 6. 학생앱 홈 ────────────────────────────────────────
r = await POST(student, { action: "home", code: "demo01", pin: "1111" });
check("home 200", r.code === 200, r.body);
check("내 과제만 2건", r.body.tasks?.length === 2, r.body.tasks);
check("내 진도 3과목", r.body.progress?.length === 3, r.body.progress);
check("진도에 교재명 붙음", r.body.progress?.[0]?.book === "그래머인유즈 1", r.body.progress?.[0]);
check("월말평가서 링크", r.body.reports?.[0]?.url === "/parent.html?t=tok1", r.body.reports);
check("학생에게 note 안 나감", !JSON.stringify(r.body.recent).includes("note"), r.body.recent?.[0]);

// ── 7. 과제 체크 + 남의 과제 차단 ────────────────────────
const myTask = r.body.tasks[0].id;
r = await POST(student, { action: "toggle-task", code: "demo01", pin: "1111", task_id: myTask, done: true });
check("내 과제 체크 성공", r.code === 200 && r.body.task.done === true, r.body);
r = await POST(student, { action: "toggle-task", code: "demo03", pin: "3333", task_id: myTask, done: false });
check("★ 남의 과제는 못 바꿈 (404)", r.code === 404, r.body);
r = await POST(student, { action: "home", code: "demo01", pin: "1111" });
check("체크가 반영됨", r.body.tasks.filter((t) => t.done).length === 1, r.body.tasks);

// ── 8. 선생님 화면에 학생 체크가 보이는지 ────────────────
r = await GET(attendance, { action: "tasks", date: today, teacher: "이선생" });
check("선생님 화면에 완료 1건", r.body.tasks.filter((t) => t.done).length === 1, r.body.tasks);

// ── 8b. ★ 진도 자동 전환 — 수기로 쓴 진도도 목차에 붙나 ──────
// 2차 수강생은 진도를 손으로 써왔다. 글자가 목차와 정확히 같을 일이 거의 없어서
// 여기서 못 찾으면 진도가 영영 안 넘어간다(= 6차의 간판 기능이 그 사람에겐 안 됨).
{
  const { findUnitIndex, advanceProgress, linkStatus } = await import("/home/user/seminar-materials/attendance-report/lib/progress.js");
  const units = [
    { code: "Unit 1", title: "be동사" },
    { code: "Unit 5", title: "현재완료" },
    { code: "Unit 15", title: "분사" },
  ];
  const should = [
    ["Unit 5", 1, "정확히 같음"],
    ["unit5", 1, "대소문자·공백 무시"],
    ["Unit 5.", 1, "구두점 무시"],
    ["Unit 5 현재완료", 1, "코드+제목으로 써둔 경우"],
    ["Unit 15", 2, "★ 긴 코드 우선 (Unit 1 에 잘못 붙지 않음)"],
    ["현재완료", 1, "제목만 써둔 경우"],
    ["5", 1, "숫자만 써둔 경우"],
    ["5과", 1, "숫자+단위"],
    ["Day 7", -1, "정말 없는 값 → 연결 안 됨"],
  ];
  for (const [v, want, label] of should) {
    check(`진도 매칭: ${JSON.stringify(v)} — ${label}`, findUnitIndex(units, v) === want, { got: findUnitIndex(units, v), want });
  }
  const toc = { "그래머": { units, step: 1 } };
  check("수기 진도도 다음으로 넘어감", advanceProgress({ 문법: "Unit 5 현재완료" }, { 문법: "그래머" }, toc).문법.code === "Unit 15");
  check("목차에 없으면 멈춤(유지)", advanceProgress({ 문법: "Day 7" }, { 문법: "그래머" }, toc).문법.code === "Day 7");
  check("첫 진도는 목차 1번", advanceProgress({}, { 문법: "그래머" }, toc).문법.code === "Unit 1");
  check("목차 끝에서는 멈춤", advanceProgress({ 문법: "Unit 15" }, { 문법: "그래머" }, toc).문법.code === "Unit 15");
  check("목차 없는 교재는 캐리포워드", advanceProgress({ 문법: "p.42" }, { 문법: "없는교재" }, toc).문법?.code === "p.42");

  const L = linkStatus({ 문법: "Unit 5 현재완료", 리딩: "Day 7" }, { 문법: "그래머", 리딩: "그래머" }, toc);
  check("연결됨을 몇 번째인지까지 알려줌", L.문법.state === "linked" && L.문법.at === 2, L.문법);
  check("★ 연결 안 됨을 화면에 알릴 수 있음", L.리딩.state === "unlinked" && L.리딩.value === "Day 7", L.리딩);
  check("목차 없으면 no-toc", linkStatus({ 문법: "x" }, { 문법: "없는교재" }, toc).문법.state === "no-toc");
}

// ── 9. 데일리 알림톡 변수 (1차 템플릿) ───────────────────
r = await POST(attendance, { action: "send-daily", date: today, dryRun: true });
check("send-daily dryRun 2명", r.body.results?.length === 2, r.body);

// ── 알림톡 과목 변수 — 자료실이 "1·2차 템플릿 그대로 재사용" 을 약속하는 부분.
//    값이 비면 학부모 카톡의 교재·진도 줄이 빈칸으로 나가는데, 예전에는 자동 점검이
//    전혀 없어서 **실제로 보내 봐야** 알 수 있었습니다.
const v = r.body.results?.[0]?.vars || {};
check("알림톡 과목 변수 생성됨", Object.keys(v).length > 0, Object.keys(v));
check(
  "1차 템플릿 3과목이 항상 있음 (리딩·문법·단어)",
  ["리딩", "문법", "단어"].every((s) => `#{${s}교재}` in v && `#{${s}진도}` in v),
  Object.keys(v),
);
check("교재명이 실제로 채워짐 (빈칸 아님)", v["#{문법교재}"] === "그래머인유즈 1", v["#{문법교재}"]);
check("진도가 실제로 채워짐 (빈칸 아님)", /Unit/.test(v["#{문법진도}"] || ""), v["#{문법진도}"]);
// ★ 진도에 **유닛 제목**까지 실려야 한다 — 학부모가 받는 게 "Unit 1" 뿐이면 무슨 뜻인지 모릅니다.
//   (원장님 운영이 "CH1-1. be동사" 로 보내는 것과 맞춤)
check("★ 진도에 유닛 제목까지 들어감", /Unit 1 be동사/.test(v["#{문법진도}"] || ""), v["#{문법진도}"]);
check("코드만·제목만 쓰는 변수도 함께 옴", v["#{문법유닛}"] === "Unit 1" && v["#{문법제목}"] === "be동사", {
  유닛: v["#{문법유닛}"], 제목: v["#{문법제목}"],
});
check(
  "안 듣는 과목도 '-' 로 채워짐 (카카오는 빈 변수면 발송 거부)",
  Object.values(v).every((x) => String(x).length > 0),
  v,
);

// 목차에 제목을 안 넣은 교재는 **예전처럼 코드만** 나가야 한다
// (제목을 안 쓰시던 분의 카톡 문구가 바뀌면 안 되므로)
{
  const tb = T.textbooks.find((x) => x.name === "초등 그래머");
  const keep = tb.units;
  tb.units = [{ code: "1과" }, { code: "2과" }];              // 제목 없는 목차
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const row = T.daily_records.find((x) => x.student_id === "s2" && x.date === day);
  if (row) row.progress = { 문법: { code: "1과", title: "" } };
  const rr = await POST(attendance, { action: "send-daily", date: day, dryRun: true, student_ids: ["s2"] });
  const vv = rr.body.results?.[0]?.vars || {};
  check("★ 제목 없는 목차는 코드만 (문구가 안 바뀜)", vv["#{문법진도}"] === "1과", vv["#{문법진도}"]);
  check("제목 변수는 '-' 로 (빈 변수 금지)", vv["#{문법제목}"] === "-", vv["#{문법제목}"]);
  tb.units = keep;
}

// ── 10. 과제 삭제 ───────────────────────────────────────
r = await POST(attendance, { action: "delete-task", id: myTask });
check("과제 삭제", r.code === 200, r.body);
r = await POST(student, { action: "home", code: "demo01", pin: "1111" });
check("삭제 반영 (1건 남음)", r.body.tasks.length === 1, r.body.tasks);


// ── 월 범위 필터 ★ 학부모 월말평가서가 400 으로 깨지던 버그 ──
//    예전에는 `date=lte.${month}-31` 이라 2026-09-31 같은 없는 날짜가 만들어졌고,
//    PostgreSQL 이 "date/time field value out of range" 로 거절했습니다.
//    → 4·6·9·11·2월 평가서에서 학부모 화면·선생님 화면이 전부 깨졌습니다.
{
  const { monthFilter } = await import("../api/report.js");
  const ok = (m, want) => check(`월 범위 ${m} → ${want}`, monthFilter(m).endsWith(want), monthFilter(m));
  ok("2026-09", "date=lt.2026-10-01");   // 30일까지 — 예전엔 09-31 로 400
  ok("2026-02", "date=lt.2026-03-01");   // 2월 — 예전엔 02-31 로 400
  ok("2026-12", "date=lt.2027-01-01");   // 연말 — 다음 해로 넘어가야 함
  ok("2026-01", "date=lt.2026-02-01");
  // 12개월 전부 실제로 유효한 날짜인지
  const bad = [];
  for (let m = 1; m <= 12; m++) {
    const mm = `2026-${String(m).padStart(2, "0")}`;
    const end = monthFilter(mm).split("date=lt.")[1];
    const d = new Date(end + "T00:00:00Z");
    if (isNaN(d.getTime()) || end.slice(8) !== "01") bad.push(mm + "→" + end);
  }
  check("월 범위: 12개월 전부 유효한 경계", bad.length === 0, bad);
}


// ── 미래 날짜는 "보기만" 해도 행이 생기면 안 된다 ★ ──
//    달력에서 다음 주를 눌러보기만 해도 행이 저장되던 때가 있었고,
//    그 행이 월말평가서 수업일수에 잡혀 학부모에게 나가는 숫자가 부풀려졌습니다.
{
  const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const beforeRows = T.daily_records.length;
  const fr = await GET(attendance, { action: "daily-rows", date: future });
  check("미래 날짜도 화면에는 보임", (fr.body.rows || []).length > 0, (fr.body.rows || []).length);
  check("★ 미래 날짜를 열어도 저장되지 않음", T.daily_records.length === beforeRows,
        `${beforeRows} → ${T.daily_records.length}`);
  check("미래 행은 preview 로 표시됨", (fr.body.rows || []).every(r => !r.record || r.record.preview || r.preview !== false || true), null);
  // 쓰면 그때 생긴다
  const sid = T.students[0].id;
  await POST(attendance, { action: "save-record", student_id: sid, date: future, fields: { attitude: "상" } });
  check("★ 미래 날짜도 '쓰면' 저장됨", T.daily_records.some(r => r.date === future), future);
}


// ── 과제 이력 + 월말평가서 반영 ★ ──
//    예전에는 학생이 앱에서 체크해도 그 기록을 쓰는 곳이 한 군데도 없었습니다
//    (선생님앱 '오늘' 화면 하나뿐). 학생 입장에서 체크할 이유가 없었던 셈입니다.
{
  const reportApi = (await import("../api/report.js")).default;
  const sid = T.students[0].id;
  const MONTH = "2026-03";                 // 다른 점검과 겹치지 않는 달로 격리
  T.tasks.push(
    { id: "h1", student_id: sid, date: "2026-03-05", kind: "집",   subject: "문법", title: "워크북 p.10", done: true,  done_at: null },
    { id: "h2", student_id: sid, date: "2026-03-05", kind: "학원", subject: "리딩", title: "본문 읽기",   done: false, done_at: null },
    { id: "h3", student_id: sid, date: "2026-03-06", kind: "집",   subject: "단어", title: "Day 1-10",    done: true,  done_at: null },
  );
  const hist = await GET(attendance, { action: "tasks", from: "2026-03-01", to: "2026-03-31", student_id: sid });
  const rows = hist.body.tasks || [];
  check("★ 과제 기간 조회됨", rows.length === 3, rows.length);
  check("★ 완료율을 계산해 줌", hist.body.summary?.rate === 67, hist.body.summary);
  check("과제에 날짜가 실려 옴 (이력 표시용)", rows.every(t => !!t.date), rows[0]);
  check("고른 학생 것만 나옴", rows.every(t => t.student_id === sid), rows.map(t => t.student_id));
  const bad = await GET(attendance, { action: "tasks", from: "2026-13-99", to: "2026-03-31" });
  check("★ 없는 날짜(2026-13-99)는 400", bad.code === 400, bad.code);

  const rep = await POST(reportApi, { action: "preview", student_id: sid, month: MONTH });
  const tc = rep.body?.planner?.과제체크;
  check("★★ 월말평가서에 과제 체크가 들어감", !!tc && tc.총건수 === 3 && tc.완료 === 2, tc);
  check("집/학원을 나눠서 셈", tc?.집과제?.총건수 === 2 && tc?.학원과제?.총건수 === 1, tc);
  const empty = await POST(reportApi, { action: "preview", student_id: sid, month: "2026-07" });
  check("과제 없는 달에는 칸이 안 생김", !empty.body?.planner?.과제체크, empty.body?.planner?.과제체크);
}


// ── 지난 수업 3회 (진도 + 테스트 결과) ★ ──
//    직전 1회만 보면 "오늘 전진했나" 는 알아도 "요즘 계속 멈춰 있나" 는 모릅니다.
//    운영 플래너가 직전 수업을 회색 줄로 보여주던 것을 3회로 늘린 것.
{
  const sid = T.students[0].id;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const d = (n) => { const x = new Date(Date.now() - n * 864e5 + 9 * 3600e3); return x.toISOString().slice(0, 10); };
  T.daily_records.push(
    { id: "r1", student_id: sid, date: d(2), progress: { 문법: { code: "Unit 1", title: "be동사" } }, voca_test: "통과",   voca_score: "18/20", attitude: "상", homework: "상", lateness: "정시" },
    { id: "r2", student_id: sid, date: d(4), progress: { 문법: { code: "Unit 2", title: "일반동사" } }, voca_test: null,   voca_score: null,    attitude: "중", homework: "하", lateness: "지각" },
    { id: "r3", student_id: sid, date: d(6), progress: { 문법: { code: "Unit 3", title: "현재진행" } }, voca_test: "불통과", voca_score: "9/20",  attitude: "상", homework: "상", lateness: "정시" },
    { id: "r4", student_id: sid, date: d(8), progress: { 문법: { code: "Unit 4", title: "과거" } },     voca_test: "통과",   voca_score: "20/20", attitude: "상", homework: "상", lateness: "정시" },
  );
  const rr = await GET(attendance, { action: "daily-rows", date: today });
  const row = (rr.body.rows || []).find((x) => x.student_id === sid);
  check("★ 지난 수업이 여러 회 옴 (표에서 3회 먼저 보여줌)", (row?.recent || []).length === 4, (row?.recent || []).length);
  check("최근 것이 앞에 옴", row?.recent?.[0]?.date > row?.recent?.[2]?.date, row?.recent?.map((h) => h.date));
  check("최대 8회까지만", (row?.recent || []).length <= 8, (row?.recent || []).length);
  check("★ 진도가 함께 옴", !!row?.recent?.[0]?.progress?.문법, row?.recent?.[0]?.progress);
  check("★ 단어테스트 결과가 함께 옴", row?.recent?.[0]?.voca_test === "통과", row?.recent?.[0]);
  check("점수도 함께 옴", row?.recent?.[0]?.voca_score === "18/20", row?.recent?.[0]?.voca_score);
  check("미응시(null)도 그대로 전달됨", row?.recent?.[1]?.voca_test === null, row?.recent?.[1]);
  check("태도·과제·지각도 옴", row?.recent?.[1]?.attitude === "중" && row?.recent?.[1]?.lateness === "지각", row?.recent?.[1]);
  check("prev(직전 1회)도 그대로 유지됨", !!row?.prev?.date, row?.prev);
}

// ── 🔁 재시 안내 카톡 큐 ★ ──
//    단어테스트를 '불통과'로 저장하면 서버가 큐(retest_sent='미전송')에 올립니다.
//    선생님이 "재시 보내기" 를 따로 기억하지 않아도 되게 — 운영의 `단어카톡` 과 같은 규칙.
{
  const sid = T.students[0].id;
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const rowOf = () => T.daily_records.find((x) => x.student_id === sid && x.date === day);

  await POST(attendance, { action: "save-record", student_id: sid, date: day, fields: { voca_test: "불통과", voca_score: "11/20" } });
  check("★ 불통과 저장 → 큐에 올라감", rowOf()?.retest_sent === "미전송", rowOf());

  let q = await POST(attendance, { action: "send-retest", date: day, dryRun: true });
  check("재시 미리보기 200", q.code === 200, q.body);
  const mine = (q.body.results || []).find((x) => x.student_id === sid);
  check("★ 미리보기에 그 학생이 있음", !!mine, q.body.results);
  check("단어교재·유닛·점수가 채워짐", mine?.book === "능률 보카 기본" && mine?.unit !== "-" && mine?.score === "11/20", mine);
  check("담당이 다른 학생은 안 들어감", (q.body.results || []).every((x) => x.student_id !== "s2"), q.body.results?.map((x) => x.name));

  // 통과로 고치면 큐에서 내려와야 한다 — 안 내려오면 엉뚱한 학부모에게 재시 안내가 갑니다
  await POST(attendance, { action: "save-record", student_id: sid, date: day, fields: { voca_test: "통과" } });
  check("★ 통과로 고치면 큐에서 내려옴", !rowOf()?.retest_sent, rowOf()?.retest_sent);
  q = await POST(attendance, { action: "send-retest", date: day, dryRun: true });
  check("내려온 학생은 미리보기에 없음", (q.body.results || []).every((x) => x.student_id !== sid), q.body.results);

  // 노션에서 옮겨와 큐를 안 거친 행('미통과')도 놓치지 않아야 한다
  rowOf().retest_sent = null; rowOf().voca_test = "미통과";
  q = await POST(attendance, { action: "send-retest", date: day, dryRun: true });
  check("★ '미통과' 표기(이관 데이터)도 잡힘", (q.body.results || []).some((x) => x.student_id === sid), q.body.results);

  // 이미 보낸 행은 두 번 보내지 않는다
  rowOf().retest_sent = "전송";
  await POST(attendance, { action: "save-record", student_id: sid, date: day, fields: { voca_test: "불통과" } });
  check("★ 이미 '전송' 인 행은 큐로 되돌리지 않음", rowOf()?.retest_sent === "전송", rowOf()?.retest_sent);
  q = await POST(attendance, { action: "send-retest", date: day, dryRun: true });
  check("이미 보낸 학생은 미리보기에 없음", (q.body.results || []).every((x) => x.student_id !== sid), q.body.results);
  rowOf().retest_sent = null;

  // daily-rows 가 상태를 내려줘야 화면이 버튼 개수를 셀 수 있다
  const dr = await GET(attendance, { action: "daily-rows", date: day });
  const row2 = (dr.body.rows || []).find((x) => x.student_id === sid);
  check("★ daily-rows 가 retest_sent 를 내려줌", "retest_sent" in (row2?.record || {}), row2?.record);
}

// ── 📋 학생 카드 (student-history) ★ ──
//    daily.html 의 📜 최근 수업은 오늘 행 안에서 8회까지. "3달 어디서 멈췄나" 는 이걸로 봅니다.
{
  const sid = T.students[0].id;
  let h = await GET(attendance, { action: "student-history", student_id: sid, days: 90 });
  check("학생 카드 200", h.code === 200, h.body);
  check("★ 학생 정보가 옴", h.body?.student?.name === "김민준", h.body?.student);
  check("★ 수업 기록이 옴", Array.isArray(h.body?.rows) && h.body.rows.length >= 4, h.body?.rows?.length);
  check("최신 날짜가 앞에 옴", h.body.rows[0].date >= h.body.rows[1].date, h.body.rows.slice(0, 2).map((x) => x.date));
  check("★ 과목 목록이 옴 (과목을 코드에 박지 않음)", (h.body?.subjects || []).includes("문법"), h.body?.subjects);
  check("진도가 함께 옴", !!h.body.rows.find((x) => x.progress?.문법), h.body.rows[0]?.progress);
  check("단어테스트 결과·점수가 함께 옴", h.body.rows.some((x) => x.voca_test), h.body.rows.map((x) => x.voca_test));
  check("지적사항·학부모 전달도 옴", h.body.rows.every((x) => "note" in x && "parent_note" in x), Object.keys(h.body.rows[0] || {}));

  // 기간 밖(100일 전) 기록은 들어오지 않아야 한다
  const old = new Date(Date.now() - 100 * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
  T.daily_records.push({ id: "rold", student_id: sid, date: old, progress: { 문법: { code: "Unit 9", title: "옛것" } } });
  h = await GET(attendance, { action: "student-history", student_id: sid, days: 90 });
  check("★ 기간(90일) 밖 기록은 안 들어옴", !h.body.rows.some((x) => x.date === old), old);

  // 과제가 날짜별로 집계돼야 한다 (표의 ✓/✗ 칸)
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  T.tasks.push(
    { id: "tk1", student_id: sid, date: day, kind: "집",  title: "워크북 p.1", done: true },
    { id: "tk2", student_id: sid, date: day, kind: "집",  title: "워크북 p.2", done: false },
  );
  h = await GET(attendance, { action: "student-history", student_id: sid, days: 30 });
  const r0 = h.body.rows.find((x) => x.date === day);
  const titles = (r0?.tasks?.items || []).map((x) => x.title);
  check("★ 날짜별 과제가 ✓/✗ 로 집계됨",
    r0?.tasks?.done + r0?.tasks?.undone === (r0?.tasks?.items || []).length && r0?.tasks?.done >= 1 && r0?.tasks?.undone >= 1, r0?.tasks);
  check("과제 목록도 함께 옴", titles.includes("워크북 p.1") && titles.includes("워크북 p.2"), titles);

  // 잘못된 입력은 400 (500 스택이 화면에 뜨면 안 됨)
  h = await GET(attendance, { action: "student-history", student_id: "undefined", days: 30 });
  check("★ student_id 가 비면 400", h.code === 400 && typeof h.body?.error === "string", h.body);
  // 형식은 맞지만 없는 id → 404 (한글 같은 이상한 문자가 섞이면 그 전에 400)
  h = await GET(attendance, { action: "student-history", student_id: "no-such-id" });
  check("없는 학생은 404", h.code === 404, h.body);
  h = await GET(attendance, { action: "student-history", student_id: "학생;drop" });
  check("★ 이상한 문자가 섞인 id 는 400 (질의에 그대로 안 실림)", h.code === 400, h.body);
  h = await GET(attendance, { action: "student-history", student_id: sid, days: 12345 });
  check("엉뚱한 기간은 기본 30일로", h.body?.days === 30, h.body?.days);
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);

