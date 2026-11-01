// 노션 이관 전 구간 — 가짜 노션(notion-mock.mjs)으로 실제 키 없이 검사.
// 1·2차 수강생의 "쓰던 기록을 그대로 가져온다" 약속을 지키는지 보는 곳.
const B = "http://localhost:4330";
let fail = 0;
const ck = (l, c, d) => { console.log(`${c ? "  ok " : "FAIL "} ${l}${c ? "" : "  → " + String(JSON.stringify(d ?? null)).slice(0, 200)}`); if (!c) fail++; };
const P = async (a, b) => { const r = await fetch(`${B}/api/${a}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); let j = null, t = ""; try { t = await r.text(); j = JSON.parse(t); } catch {} return { code: r.status, body: j, raw: t }; };

const chk = await P("import-notion", { action: "check" });
ck("연결 확인 200", chk.code === 200, chk.raw.slice(0, 120));
ck("DB별 건수가 보임", (chk.body?.counts?.students ?? 0) > 0, chk.body?.counts);

const pr = await P("import-notion", { action: "props" });
ck("속성 매칭 200", pr.code === 200, pr.raw.slice(0, 120));
const m = pr.body?.students?.matched || {};
ck("★ 학생ID 속성을 찾아냄", !!m.code, m);
ck("★ 출결PIN 속성을 찾아냄", !!m.pin, m);
ck("요일별 등원시간 속성을 찾아냄", !!(m.day && m.day["월"]), m.day);

const before = (await P("attendance", { action: "students" })).body;
const nBefore = (before?.students || before || []).length;

const im = await P("import-notion", { action: "import", what: ["textbooks", "students", "daily", "reports", "comments"] });
ck("이관 200", im.code === 200, im.raw.slice(0, 160));
ck("학생이 들어옴", (im.body?.students ?? 0) > 0, im.body);
ck("데일리가 들어옴", (im.body?.daily ?? 0) > 0, im.body);
ck("★ 못 가져온 줄을 경고로 알려줌", (im.body?.warnings || []).some((w) => /못 가져왔어요/.test(w)), im.body?.warnings);

const after = (await P("attendance", { action: "students" })).body;
const list = after?.students || after || [];
ck("★★ 기존 학생이 사라지지 않음", list.length >= nBefore, `${nBefore} → ${list.length}`);
const A = list.find((s) => s.name === "노션학생A");
ck("노션 학생이 들어옴", !!A, list.map((s) => s.name));
if (A) {
  ck("★ 학생ID 보존 (학생앱 로그인에 필요)", A.student_code === "nt01", A.student_code);
  ck("★ 출결PIN 보존", A.pin === "1217", A.pin);
  ck("담당 선생님 보존", A.teacher === "이선생", A.teacher);
  ck("요일별 등원시간 보존", !!(A.schedule || {})["월"], A.schedule);
}
// 데일리 기록 내용 보존
// 화면(daily.html)과 똑같이 GET 으로 부른다 — POST 면 action 을 body 에서 읽는다
const rows = await (await fetch(`${B}/api/attendance?action=daily-rows&date=2026-09-07`)).json();
const rowA = (rows.rows || []).find((r) => r.name === "노션학생A");
ck("9/7 기록이 들어옴", !!rowA, (rows.rows || []).map((r) => r.name));
if (rowA) {
  const rec = rowA.record || rowA;
  ck("태도 보존", rec.attitude === "상", rec.attitude);
  ck("과제 보존", rec.homework === "100%완료", rec.homework);
  ck("단어테스트 보존", rec.voca_test === "통과", rec.voca_test);
  ck("★ 진도 보존 (수기로 쓴 값까지)", /Unit 5/.test(JSON.stringify(rec.progress || {})), rec.progress);
}
// 두 번 돌려도 안전
await P("import-notion", { action: "import", what: ["students", "daily"] });
const after2 = (await P("attendance", { action: "students" })).body;
const l2 = (after2?.students || after2 || []).map((s) => s.name);
ck("★ 두 번 이관해도 학생이 중복되지 않음", new Set(l2).size === l2.length, l2);

// ★ 이관 가이드가 수강생에게 한 약속을 코드로 지킨다
{
  const w = await (await fetch(`${B}/__notion-writes`)).json().catch(() => ({}));
  ck("★ 노션에 쓰기가 한 번도 없었음 (원본은 그대로)", (w.writes || []).length === 0, w.writes);
  // 기존 학생ID·출결PIN 으로 실제 로그인·등원이 되나 = "다시 안내할 게 없다"
  const ci = await P("attendance", { action: "checkin", code: "nt01", pin: "1217" });
  ck("★ 기존 출결PIN 으로 키오스크 등원됨", ci.code === 200, ci.raw.slice(0, 140));
  const lg = await P("student", { action: "home", code: "nt01", pin: "1217" });
  ck("★★ 기존 학생ID 로 학생앱 로그인됨", lg.code === 200 && /노션학생A/.test(JSON.stringify(lg.body)), lg.raw.slice(0, 140));
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
