// 📖 답지 — 올리기 → 학생앱에서 열기 → **학원 와이파이에서만** · **지금 진도 유닛만** 점검.
//
//   진짜 PostgreSQL(setup.sql) + 가짜 파일 보관함(app-server.mjs 의 fakeStorage) 위에서 돕니다.
//   TESTDB=tapp node answers-check.mjs
//
// 와이파이 흉내: 검수 서버는 Vercel 이 아니라서 x-real-ip 헤더를 그대로 믿습니다.
//   학원 = 10.0.0.1 (ACADEMY_IPS), 집 = 203.0.113.9 로 보내서 갈라 봅니다.

process.env.ACADEMY_IPS = "10.0.0.1";
const { start, FAKE_STORAGE } = await import("./app-server.mjs");
const { select } = await import("../../lib/db.js");
const PORT = 4397;
const srv = await start(PORT);
const BASE = `http://127.0.0.1:${PORT}`;

const 학원 = "10.0.0.1", 집 = "203.0.113.9";
async function call(path, body, ip = 학원) {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

let fail = 0, n = 0;
function check(name, cond, got) {
  n++;
  if (cond) console.log(`  ✅ ${name}`);
  else { fail++; console.log(`  ❌ ${name}`); if (got !== undefined) console.log(`       받은 것: ${JSON.stringify(got).slice(0, 300)}`); }
}

// ── 준비: 오늘 진도가 있는 학생 1명 + 그 학생 문법 교재 ──
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const recs = await select("daily_records", `date=lte.${today}&order=date.desc`);
const stus = await select("students", "status=eq.재원");
let stu, cur;
for (const s of stus) {
  const r = recs.find((x) => x.student_id === s.id);
  if (r?.progress?.["문법"]?.code && (r.books?.["문법"] || s.books?.["문법"]) && s.student_code && s.pin) { stu = s; cur = r; break; }
}
if (!stu) { console.log("❌ 문법 진도가 있는 샘플 학생이 없습니다 — setup.sql 을 먼저 돌리세요"); process.exit(1); }
const bookName = cur.books?.["문법"] || stu.books["문법"];
const book = (await select("textbooks", `name=eq.${encodeURIComponent(bookName)}`))[0];
const curCode = cur.progress["문법"].code;
const other = book.units.map((u) => u.code).find((c) => c !== curCode);
const login = { code: stu.student_code, pin: stu.pin };
console.log(`학생 ${stu.name} · ${bookName} · 지금 진도 ${curCode}\n`);

// ── 1. 와이파이 판정 ──
let r = await call("/api/answers", { action: "wifi" });
check("학원 IP 면 학원 와이파이로 본다", r.data.on_wifi === true && r.data.ip === 학원, r.data);
r = await call("/api/answers", { action: "wifi" }, 집);
check("집 IP 면 학원 와이파이가 아니다", r.data.on_wifi === false && r.data.registered === 1, r.data);

// ── 2. 올리기 (집에서도 됨) ──
async function upload(code, text, ip = 집) {
  const s = await call("/api/answers", { action: "upload-url", textbook_id: book.id, unit_code: code, file_name: `${code} 답지.pdf`, content_type: "application/pdf" }, ip);
  if (s.status !== 200) return s;
  // 브라우저가 Supabase 로 직접 PUT 하는 자리 → 가짜 보관함
  const rest = s.data.url.replace("https://fake-supabase/storage/v1/", "");
  await fetch(`${BASE}/__fake-storage/${rest}`, { method: "PUT", body: text });
  return call("/api/answers", { action: "confirm", textbook_id: book.id, unit_code: code, path: s.data.path, file_name: `${code} 답지.pdf`, content_type: "application/pdf" }, ip);
}
r = await upload(curCode, "CURRENT-ANSWER");
check("집에서도 답지를 올릴 수 있다", r.status === 200, r);
r = await upload(other, "OTHER-ANSWER");
check("다른 유닛 답지도 올라간다", r.status === 200, r);
check("보관함에 파일 2개", FAKE_STORAGE.size === 2, FAKE_STORAGE.size);

r = await call("/api/answers", { action: "list", textbook_id: book.id });
const listed = r.data.units?.filter((u) => u.answer).map((u) => u.code) || [];
check("목록에 답지 있는 유닛이 표시된다", listed.includes(curCode) && listed.includes(other), listed);

// ── 3. 막아야 하는 것들 ──
r = await call("/api/answers", { action: "upload-url", textbook_id: book.id, unit_code: curCode, file_name: "a.exe", content_type: "application/x-msdownload" });
check("PDF·사진 말고는 거절", r.status === 400, r);
r = await call("/api/answers", { action: "upload-url", textbook_id: book.id, unit_code: "없는유닛", file_name: "a.pdf", content_type: "application/pdf" });
check("목차에 없는 유닛은 거절", r.status === 400, r);
r = await call("/api/answers", { action: "confirm", textbook_id: book.id, unit_code: curCode, path: "../남의/파일.pdf" });
check("엉뚱한 파일 위치는 기록 안 함", r.status === 400, r);

// ── 4. 관리 화면에서 보기 — 학원에서만 ──
r = await call("/api/answers", { action: "view", textbook_id: book.id, unit_code: curCode }, 집);
check("관리 화면도 집에서는 답지가 안 열린다", r.status === 403 && !r.data.url, r);
r = await call("/api/answers", { action: "view", textbook_id: book.id, unit_code: curCode });
check("관리 화면은 학원에서 열린다", r.status === 200 && /token=/.test(r.data.url || ""), r);

// ── 5. 학생앱 ──
r = await call("/api/student", { action: "home", ...login }, 집);
const p = (r.data.progress || []).find((x) => x.subject === "문법");
check("학생앱 홈: 문법 진도에 답지 표시", p?.has_answer === true, r.data.progress);
check("학생앱 홈: 파일 위치는 안 보낸다", !JSON.stringify(r.data).includes(book.id + "/"), "");
check("학생앱 홈: 집이면 on_wifi=false", r.data.on_wifi === false, r.data.on_wifi);

r = await call("/api/student", { action: "answer", subject: "문법", ...login }, 집);
check("★ 학생앱: 집(데이터·집 와이파이)에서는 안 열린다", r.status === 403 && !r.data.url, r);
r = await call("/api/student", { action: "answer", subject: "문법", ...login });
check("★ 학생앱: 학원 와이파이에서는 열린다", r.status === 200 && !!r.data.url, r);
const body = r.data.url ? await (await fetch(`${BASE}/__fake-storage/${r.data.url.replace("https://fake-supabase/storage/v1/", "")}`)).text() : "";
check("★ 열린 건 **지금 진도** 유닛 답지다 (다음 유닛 아님)", body === "CURRENT-ANSWER", body);
r = await call("/api/student", { action: "answer", subject: "문법", unit_code: other, ...login });
const body2 = r.data.url ? await (await fetch(`${BASE}/__fake-storage/${r.data.url.replace("https://fake-supabase/storage/v1/", "")}`)).text() : "";
check("★ 유닛을 바꿔 보내도 다른 유닛 답지는 못 연다", body2 === "CURRENT-ANSWER", body2);
r = await call("/api/student", { action: "answer", subject: "문법", code: stu.student_code, pin: "0000x" });
check("로그인 틀리면 안 열린다", r.status === 401, r);

// ── 6. 바꾸기·지우기 ──
r = await upload(curCode, "NEW-ANSWER");
check("다시 올리면 바뀌고 옛 파일은 지워진다", r.status === 200 && FAKE_STORAGE.size === 2 && [...FAKE_STORAGE.values()].map(String).includes("NEW-ANSWER"), [...FAKE_STORAGE.values()].map(String));
r = await call("/api/answers", { action: "delete", textbook_id: book.id, unit_code: curCode });
check("지우기", r.status === 200 && FAKE_STORAGE.size === 1, FAKE_STORAGE.size);
r = await call("/api/student", { action: "home", ...login });
check("지우면 학생앱 답지 버튼도 사라진다", (r.data.progress || []).find((x) => x.subject === "문법")?.has_answer === false, r.data.progress);
r = await call("/api/student", { action: "answer", subject: "문법", ...login });
check("지운 답지는 학원에서도 안 열린다", r.status === 404, r);

// ── 7. 학원 IP 를 안 넣었으면 → 아무 데서도 안 열린다 ──
await upload(curCode, "CURRENT-ANSWER");
process.env.ACADEMY_IPS = "";
r = await call("/api/student", { action: "answer", subject: "문법", ...login });
check("★ ACADEMY_IPS 가 비면 학원 IP 로도 안 열린다 (안전한 쪽)", r.status === 403 && /등록되지 않아/.test(r.data.error || ""), r);
process.env.ACADEMY_IPS = "10.0.0.*";
r = await call("/api/student", { action: "answer", subject: "문법", ...login });
check("10.0.0.* 처럼 앞부분만 넣어도 맞는다", r.status === 200, r);

srv.close();
console.log(`\n점검 ${n}개 · 실패 ${fail}개`);
console.log(fail ? "❌ 답지 점검 실패" : "✅ 답지 점검 통과");
process.exit(fail ? 1 : 0);
