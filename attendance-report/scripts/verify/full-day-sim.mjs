// 선생님 하루 전체 — 진짜로 해보기
//
// 왜: 기능 하나하나는 통과하는데, **하루를 이어서** 돌려본 적이 없었습니다.
//   등원 → 진도 → 숙제 내기 → 숙제 취소 → 보강 → 결석 → 기록 → 하원 → 발송
//   → 학생 카드 → 월말평가서 까지 **선생님이 실제로 누르는 순서대로** 갑니다.
//
// 규칙 (오늘 세 번 데인 것): **샘플의 숫자·글자를 박지 않습니다.**
//   학생 수·교재 이름·유닛 코드·과제 개수를 전부 API 에서 읽어와 판단합니다.
//
//   bash scripts/verify/full-day-sim.sh     ← 이걸 쓰세요 (DB·서버까지 띄워줍니다)

// 포트 4333 — 4330(본 검수)·4332(시나리오)와 겹치지 않게 따로 씁니다
const B = process.env.SIM_BASE || "http://127.0.0.1:4333";

let 통과 = 0;
const 실패 = [];
const 소견 = [];   // 깨진 건 아니지만 원장님이 알아야 하는 것

const ck = (이름, ok, 받은것) => {
  if (ok) { 통과++; console.log(`     ✅ ${이름}`); }
  else { 실패.push(이름); console.log(`     ❌ ${이름}`);
         if (받은것 !== undefined) console.log(`        받은 것: ${JSON.stringify(받은것)?.slice(0, 400)}`); }
  return ok;
};
const 짚기 = (말) => { 소견.push(말); console.log(`     ⚠️  ${말}`); };
const 마디 = (제목) => console.log(`\n\x1b[1m${제목}\x1b[0m`);
const 줄 = (말) => console.log(`     · ${말}`);

const GET = async (p, q = "") => { const r = await fetch(`${B}${p}?${q}`); return { s: r.status, d: await r.json().catch(() => ({})) }; };
const POST = async (p, body) => {
  const r = await fetch(`${B}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};

// ★ 「오늘」은 한국시간. 앱이 KST 로 판단하므로 검수가 UTC 로 보면 하루 어긋납니다.
const KST = new Date(Date.now() + 9 * 3600 * 1000);
const 오늘 = KST.toISOString().slice(0, 10);
const 요일 = "일월화수목금토"[KST.getUTCDay()];
const 날더하기 = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

console.log(`\x1b[1m선생님 하루 전체 시뮬레이션\x1b[0m   ${오늘} (${요일}요일)`);

// ───────────────────────────────────────────────────────── 0. 아침에 화면을 켠다
마디("0. 아침 — 화면을 켠다");

const 앱오늘 = (await GET("/api/attendance", "action=board")).d.date;
ck("앱이 보는 오늘 = 검수가 보는 오늘", 앱오늘 === 오늘, { 앱: 앱오늘, 검수: 오늘 });

const 명단 = (await GET("/api/attendance", "action=students")).d.students || [];
const 재원 = 명단.filter((s) => s.status === "재원");
ck("학생 명단이 나온다", 재원.length > 0, 재원.length);
줄(`재원 ${재원.length}명`);

const 교재들 = (await GET("/api/attendance", "action=textbooks")).d.textbooks || [];
ck("교재 목록이 나온다", 교재들.length > 0, 교재들.length);
const 목차 = Object.fromEntries(교재들.map((t) => [t.name, t.units || []]));
줄(`교재 ${교재들.length}권 — ${교재들.map((t) => `${t.name}(${(t.units || []).length}과)`).join(", ")}`);

// 목차가 쓸만한가 — 유닛 코드가 겹치면 진도가 그 자리에서 맴돕니다 (실제로 겪음)
for (const t of 교재들) {
  const 코드들 = (t.units || []).map((u) => String(u.code || "").trim());
  const 중복 = 코드들.filter((c, i) => c && 코드들.indexOf(c) !== i);
  if (중복.length) ck(`${t.name}: 유닛 코드가 겹치지 않는다`, false, [...new Set(중복)]);
}
ck("모든 교재의 유닛 코드가 겹치지 않는다",
   교재들.every((t) => { const c = (t.units || []).map((u) => String(u.code || "").trim()).filter(Boolean); return new Set(c).size === c.length; }));

const 행보기 = async (d = 오늘) => (await GET("/api/attendance", `action=daily-rows&date=${d}`)).d.rows || [];
let 행들 = await 행보기();
ck("오늘 데일리 리포트에 행이 있다", 행들.length > 0, 행들.length);
줄(`오늘 행 ${행들.length}개`);

// 오늘 할 일을 맡길 아이들을 고릅니다 (이름을 박지 않고 명단에서 고름)
const 수업일인아이 = 재원.filter((s) => (s.schedule || {})[요일]);
const 수업아닌아이 = 재원.filter((s) => !(s.schedule || {})[요일]);
줄(`오늘 수업 예정 ${수업일인아이.length}명 / 수업일 아님 ${수업아닌아이.length}명`);
if (!수업일인아이.length) { console.log("❌ 오늘 수업 예정 학생이 없어 시뮬레이션을 못 합니다"); process.exit(1); }

const 정시 = 수업일인아이[0];
const 지각할아이 = 수업일인아이[1] || 수업일인아이[0];
const 결석할아이 = 수업일인아이[2] || 수업일인아이[0];
const 보강올아이 = 수업아닌아이[0] || null;
줄(`정시: ${정시.name} / 지각: ${지각할아이.name} / 결석: ${결석할아이.name} / 보강: ${보강올아이?.name || "(수업일 아닌 아이가 없음)"}`);

// ───────────────────────────────────────────────────────── 1. 등원 (키오스크)
마디("1. 등원 — 아이가 키오스크에 PIN 을 누른다");

const 등원 = await POST("/api/attendance", { action: "checkin", code: 정시.student_code, pin: 정시.pin });
ck(`${정시.name}: 키오스크 등원이 된다`, 등원.s === 200 && 등원.d.ok !== false, 등원.d);
줄(`→ ${등원.d.name || ""} ${등원.d.kind || ""} ${등원.d.time || ""} ${등원.d.lateness || ""}`);

const 틀린핀 = await POST("/api/attendance", { action: "checkin", code: 정시.student_code, pin: "0000" });
ck("★ PIN 이 틀리면 등원이 안 된다", 틀린핀.s >= 400 || 틀린핀.d.error || 틀린핀.d.ok === false, 틀린핀.d);

const 판 = (await GET("/api/attendance", "action=board")).d;
const 판에서 = (판.students || []).find((x) => x.name === 정시.name);
ck(`${정시.name}: 현황판에 등원으로 보인다`, 판에서 && 판에서.status !== "미등원", 판에서);
줄(`현황판: ${JSON.stringify(판.stats || {})}`);

// ───────────────────────────────────────────────────────── 2. 지각
마디("2. 지각 — 늦게 온 아이");
const 지각저장 = await POST("/api/attendance", { action: "save-record", student_id: 지각할아이.id, date: 오늘, fields: { lateness: "지각" } });
ck(`${지각할아이.name}: 지각으로 바꿀 수 있다`, 지각저장.s === 200, 지각저장.d);
행들 = await 행보기();
ck(`${지각할아이.name}: 지각이 저장돼 있다`,
   행들.find((r) => r.student_id === 지각할아이.id)?.record?.lateness === "지각",
   행들.find((r) => r.student_id === 지각할아이.id)?.record);

// ───────────────────────────────────────────────────────── 3. 진도 내주기
마디("3. 진도 — 오늘 어디까지 했나");

let 내행 = (await 행보기()).find((r) => r.student_id === 정시.id);
const 과목들 = Object.keys(정시.books || {});
줄(`${정시.name} 교재: ${과목들.map((k) => `${k}=${정시.books[k]}`).join(" / ")}`);
줄(`자동으로 들어온 진도: ${과목들.map((k) => `${k} ${내행?.record?.progress?.[k]?.code || "—"}`).join(" / ")}`);
ck(`${정시.name}: 과목마다 진도가 자동으로 들어와 있다`,
   과목들.every((k) => 내행?.record?.progress?.[k]?.code), 내행?.record?.progress);

// 진도가 **목차에 있는 코드**인가 (목차와 연결이 끊기면 다음으로 안 넘어감)
ck("진도가 목차에 있는 코드다",
   과목들.every((k) => { const c = 내행?.record?.progress?.[k]?.code; const u = 목차[정시.books[k]] || [];
     return !u.length || u.some((x) => String(x.code) === String(c)); }),
   과목들.map((k) => `${k}:${내행?.record?.progress?.[k]?.code}`));
ck("화면이 「목차와 연결됨」으로 표시한다", 내행?.link && !/안 ?됨|끊김/.test(JSON.stringify(내행.link)), 내행?.link);

// 선생님이 손으로 진도를 고친다 — 한 과목을 목차의 다른 줄로
const 손과목 = 과목들.find((k) => (목차[정시.books[k]] || []).length > 3);
if (손과목) {
  const 유닛 = 목차[정시.books[손과목]];
  const 고른 = 유닛[2];
  const 바꾼진도 = { ...내행.record.progress, [손과목]: { code: 고른.code, title: 고른.title || "" } };
  const r = await POST("/api/attendance", { action: "save-record", student_id: 정시.id, date: 오늘, fields: { progress: 바꾼진도 } });
  ck(`${정시.name}: 진도를 손으로 고칠 수 있다 (${손과목} → ${고른.code})`, r.s === 200, r.d);
  내행 = (await 행보기()).find((r2) => r2.student_id === 정시.id);
  ck("고친 진도가 저장돼 있다", 내행?.record?.progress?.[손과목]?.code === 고른.code, 내행?.record?.progress?.[손과목]);
}

// 수기 메모 진도 (「특강 2회차」 처럼 교재와 무관한 것) — 다음 날 목차로 튀면 안 됨
if (손과목) {
  const r = await POST("/api/attendance", { action: "save-record", student_id: 지각할아이.id, date: 오늘,
    fields: { progress: { ...( (await 행보기()).find((x)=>x.student_id===지각할아이.id)?.record?.progress || {} ), [손과목]: { code: "특강 2회차", title: "" } } } });
  ck(`${지각할아이.name}: 교재와 무관한 수기 진도도 적을 수 있다`, r.s === 200, r.d);
}

// 교재 바꾸기 — 중간에 책을 갈아타는 경우
if (손과목) {
  const 다른책 = 교재들.find((t) => t.subject === 손과목 && t.name !== 정시.books[손과목])
            || 교재들.find((t) => t.name !== 정시.books[손과목] && (t.units || []).length);
  if (다른책) {
    const r = await POST("/api/attendance", { action: "change-book", student_id: 정시.id, date: 오늘, subject: 손과목, book: 다른책.name });
    ck(`${정시.name}: 교재를 바꿀 수 있다 (${손과목} → ${다른책.name})`, r.s === 200, r.d);
    내행 = (await 행보기()).find((x) => x.student_id === 정시.id);
    const 첫유닛 = (목차[다른책.name] || [])[0];
    ck("교재를 바꾸면 진도가 새 교재 1과로 간다",
       !첫유닛 || 내행?.record?.progress?.[손과목]?.code === 첫유닛.code,
       { 받은진도: 내행?.record?.progress?.[손과목], 기대: 첫유닛?.code });
    ck("그날 행의 교재도 새 교재로 바뀐다", 내행?.record?.books?.[손과목] === 다른책.name, 내행?.record?.books);
    // 원래 책으로 되돌리기 (뒤 검사에 영향 안 주게)
    await POST("/api/attendance", { action: "change-book", student_id: 정시.id, date: 오늘, subject: 손과목, book: 정시.books[손과목] });
  }
}

// 진도 일괄 전진 (「오늘 다 같이 한 칸」)
{
  const 전 = (await 행보기()).find((x) => x.student_id === 정시.id)?.record?.progress;
  const r = await POST("/api/attendance", { action: "advance-today", date: 오늘, student_ids: [정시.id] });
  ck("진도 일괄 전진이 돌아간다", r.s === 200, r.d);
  const 후 = (await 행보기()).find((x) => x.student_id === 정시.id)?.record?.progress;
  줄(`일괄 전진: ${JSON.stringify(전)} → ${JSON.stringify(후)}`);
}

// ───────────────────────────────────────────────────────── 4. 숙제 내주기 / 취소
마디("4. 숙제 — 내주고, 취소하고, 다시 내준다");

const 과제보기 = async (d = 오늘) => (await GET("/api/attendance", `action=tasks&date=${d}`)).d.tasks || [];
let 과제 = await 과제보기();
const 내자동 = 과제.filter((t) => t.student_id === 정시.id && t.auto);
줄(`오늘 과제 전체 ${과제.length}개 (자동 ${과제.filter((t) => t.auto).length} / 손 ${과제.filter((t) => !t.auto).length})`);
ck(`${정시.name}: 진도에 맞는 자동 과제가 깔려 있다`, 내자동.length > 0, 내자동.map((t) => t.title));
줄(`${정시.name} 자동 과제: ${내자동.map((t) => `[${t.kind}] ${t.title}`).join(" | ") || "—"}`);

// 자동 과제가 **그 유닛** 것인가
{
  const 코드들 = Object.values((await 행보기()).find((x) => x.student_id === 정시.id)?.record?.progress || {}).map((p) => p?.code).filter(Boolean);
  ck("자동 과제가 오늘 그 유닛 것이다", 내자동.some((t) => 코드들.some((c) => String(t.title).includes(c))),
     { 진도: 코드들, 과제: 내자동.map((t) => t.title) });
}

// (1) 손으로 내주기 — 여러 명에게 한 번에, 집/학원 둘 다
const 받을아이들 = 수업일인아이.slice(0, 3).map((s) => s.id);
const 제목집 = "오늘 단어 20개 다시 쓰기(손)";
const 제목학원 = "오답노트 정리(손)";
const 냈다 = await POST("/api/attendance", { action: "save-tasks", date: 오늘, student_ids: 받을아이들,
  items: [{ kind: "집", subject: "문법", title: 제목집 }, { kind: "학원", subject: "리딩", title: 제목학원 }] });
ck("여러 명에게 숙제를 한 번에 낼 수 있다", 냈다.s === 200 && 냈다.d.created === 받을아이들.length * 2, 냈다.d);
줄(`${받을아이들.length}명 × 2줄 = ${냈다.d.created}개 생성`);

과제 = await 과제보기();
const 손것 = 과제.filter((t) => t.title === 제목집 || t.title === 제목학원);
ck("낸 숙제가 과제 현황에 보인다", 손것.length === 받을아이들.length * 2, 손것.length);
ck("★ 손으로 낸 숙제는 auto 표시가 없다 (자동과 구분된다)", 손것.every((t) => t.auto === false), 손것.map((t) => ({ t: t.title, auto: t.auto })));
ck("집/학원 구분이 그대로 저장된다",
   손것.filter((t) => t.kind === "집").length === 받을아이들.length && 손것.filter((t) => t.kind === "학원").length === 받을아이들.length,
   손것.map((t) => t.kind));

// (2) 빈 숙제 / 학생 안 고르고 내기 — 막아야 함
ck("학생을 안 고르면 막는다", (await POST("/api/attendance", { action: "save-tasks", date: 오늘, student_ids: [], items: [{ kind: "집", title: "x" }] })).s === 400);
ck("내용이 비면 막는다", (await POST("/api/attendance", { action: "save-tasks", date: 오늘, student_ids: 받을아이들, items: [{ kind: "집", title: "   " }] })).s === 400);

// (3) ★ 낸 숙제를 취소한다
const 취소할것 = 손것.find((t) => t.student_id === 받을아이들[0] && t.title === 제목집);
ck("취소할 숙제를 찾았다", Boolean(취소할것), 취소할것);
if (취소할것) {
  const 취소 = await POST("/api/attendance", { action: "delete-task", id: 취소할것.id });
  ck("★ 낸 숙제를 취소할 수 있다", 취소.s === 200, 취소.d);
  과제 = await 과제보기();
  ck("★ 취소한 숙제가 과제 현황에서 사라졌다", !과제.some((t) => t.id === 취소할것.id), 과제.filter((t) => t.id === 취소할것.id));
  ck("★ 취소해도 남의 숙제는 그대로다",
     과제.filter((t) => t.title === 제목집).length === 받을아이들.length - 1,
     과제.filter((t) => t.title === 제목집).map((t) => t.name));
  ck("★ 취소해도 그 아이의 다른 숙제(학원)는 그대로다",
     과제.some((t) => t.student_id === 받을아이들[0] && t.title === 제목학원));
  ck("★ 취소해도 자동 과제는 그대로다", 과제.filter((t) => t.student_id === 받을아이들[0] && t.auto).length > 0,
     과제.filter((t) => t.student_id === 받을아이들[0]).map((t) => ({ t: t.title, auto: t.auto })));

  // 학생 폰에서도 사라졌나
  const 아이 = 재원.find((s) => s.id === 받을아이들[0]);
  const 홈 = await POST("/api/student", { action: "home", code: 아이.student_code, pin: 아이.pin });
  ck("★ 학생 폰에서도 취소한 숙제가 사라졌다", !(홈.d.tasks || []).some((t) => t.id === 취소할것.id),
     (홈.d.tasks || []).map((t) => t.title));

  // 다시 내주기
  const 다시 = await POST("/api/attendance", { action: "save-tasks", date: 오늘, student_ids: [받을아이들[0]], items: [{ kind: "집", subject: "문법", title: 제목집 }] });
  ck("취소한 숙제를 다시 낼 수 있다", 다시.s === 200 && 다시.d.created === 1, 다시.d);
  과제 = await 과제보기();
  ck("다시 낸 숙제가 보인다", 과제.some((t) => t.student_id === 받을아이들[0] && t.title === 제목집));
}

// (4) 없는 숙제를 취소 / id 없이 취소
ck("id 없이 취소하면 막는다", (await POST("/api/attendance", { action: "delete-task" })).s === 400);

// (5) ★ 진도를 다시 저장해도 손으로 낸 숙제는 안 지워진다
{
  const 전 = (await 과제보기()).filter((t) => t.student_id === 받을아이들[0]);
  const 행 = (await 행보기()).find((x) => x.student_id === 받을아이들[0]);
  await POST("/api/attendance", { action: "save-record", student_id: 받을아이들[0], date: 오늘, fields: { progress: 행.record.progress } });
  const 후 = (await 과제보기()).filter((t) => t.student_id === 받을아이들[0]);
  ck("★ 진도를 다시 저장해도 손으로 낸 숙제가 남는다",
     후.filter((t) => !t.auto).length === 전.filter((t) => !t.auto).length,
     { 전: 전.filter((t) => !t.auto).map((t) => t.title), 후: 후.filter((t) => !t.auto).map((t) => t.title) });
  ck("진도를 다시 저장하면 자동 과제는 다시 깔린다", 후.filter((t) => t.auto).length > 0, 후.filter((t) => t.auto).map((t) => t.title));
}

// (6) 학생이 폰으로 체크 → 선생님 화면에 바로
{
  const 아이 = 정시;
  const 로그인 = await POST("/api/student", { action: "login", code: 아이.student_code, pin: 아이.pin });
  ck(`${아이.name}: 학생앱 로그인`, 로그인.s === 200, 로그인.d);
  ck("★ PIN 이 틀리면 학생앱에 못 들어간다",
     (await POST("/api/student", { action: "login", code: 아이.student_code, pin: "0000" })).s >= 400);
  const 홈 = await POST("/api/student", { action: "home", code: 아이.student_code, pin: 아이.pin });
  const 앱과제 = 홈.d.tasks || [];
  ck("학생 폰에 오늘 숙제가 보인다", 앱과제.length > 0, 앱과제.length);
  줄(`${아이.name} 폰: 숙제 ${앱과제.length}개 · 진도 ${JSON.stringify(홈.d.progress || 홈.d.today?.progress || {}).slice(0, 120)}`);
  const 안한것 = 앱과제.find((t) => !t.done);
  if (안한것) {
    ck("학생이 체크하면 저장된다",
       (await POST("/api/student", { action: "toggle-task", code: 아이.student_code, pin: 아이.pin, task_id: 안한것.id, done: true })).s === 200);
    ck("★ 선생님 화면에 바로 보인다", (await 과제보기()).find((t) => t.id === 안한것.id)?.done === true);
    ck("체크를 되돌릴 수도 있다",
       (await POST("/api/student", { action: "toggle-task", code: 아이.student_code, pin: 아이.pin, task_id: 안한것.id, done: false })).s === 200
       && (await 과제보기()).find((t) => t.id === 안한것.id)?.done === false);
  }
  const 남의것 = (await 과제보기()).find((t) => t.student_id !== 아이.id);
  if (남의것) ck("★★ 남의 숙제는 못 건드린다",
    (await POST("/api/student", { action: "toggle-task", code: 아이.student_code, pin: 아이.pin, task_id: 남의것.id, done: true })).s >= 400
    || (await 과제보기()).find((t) => t.id === 남의것.id)?.done !== true);
}

// ───────────────────────────────────────────────────────── 5. 보강
마디("5. 보강 — 수업일이 아닌 날 온 아이");

if (!보강올아이) 짚기("모든 아이가 오늘 수업일이라 보강을 시험할 상대가 없습니다 (샘플 요일 구성 문제는 아님)");
else {
  { const 다니는요일 = Object.entries(보강올아이.schedule || {}).filter(([, v]) => String(v || "").trim());
  줄(`${보강올아이.name} 은 ${요일}요일 수업이 아닙니다 (수업: ${다니는요일.map(([d, v]) => `${d} ${v}`).join(" · ") || "없음"})`); }
  // 실제 상황 재현: 수업일이 아니면 새벽 cron 이 행을 안 만듭니다.
  // 샘플은 세미나 당일 빈 화면이 안 되게 전원 행을 깔아두니, 그 행을 지워 실제와 같게 만듭니다.
  //   (SIM_CLEAR 로 지우는 길을 주면 쓰고, 없으면 행이 이미 있는 상태로 검사합니다)
  if (process.env.SIM_CLEAR) {
    const { execSync } = await import("node:child_process");
    // ★ replace 는 **첫 번째만** 바꿉니다. {id}·{date} 가 두 번 나와서 두 번째 문장이
    //   그대로 남아 행 삭제가 안 돌았습니다 — replaceAll 로.
    try { execSync(process.env.SIM_CLEAR.replaceAll("{id}", 보강올아이.id).replaceAll("{date}", 오늘), { stdio: "ignore" }); } catch {}
  }
  if ((await 행보기()).some((r) => r.student_id === 보강올아이.id))
    짚기("수업일 아닌 아이에게도 오늘 행이 이미 있어, 보강(➕)을 「행이 있는 상태」로 검사했습니다");

  const 보강 = await POST("/api/attendance", { action: "add-row", student_id: 보강올아이.id, date: 오늘 });
  ck(`★ ${보강올아이.name}: ➕ 보강으로 오늘 행을 만들 수 있다`, 보강.s === 200 && 보강.d.record?.id, 보강.d);
  const 보강행 = (await 행보기()).find((r) => r.student_id === 보강올아이.id);
  ck("보강 행이 데일리 리포트에 보인다", Boolean(보강행), "행 없음");
  ck("보강 행에도 진도가 들어와 있다",
     Object.keys(보강올아이.books || {}).every((k) => 보강행?.record?.progress?.[k]?.code), 보강행?.record?.progress);
  줄(`보강 진도: ${JSON.stringify(보강행?.record?.progress || {}).slice(0, 200)}`);
  ck("보강 행은 「수업 예정」 표시가 비어 있다 (정규 수업일과 구분된다)", 보강행?.scheduled === "", 보강행?.scheduled);

  // 보강 아이에게도 숙제·기록이 되나
  ck("보강 아이에게도 숙제를 낼 수 있다",
     (await POST("/api/attendance", { action: "save-tasks", date: 오늘, student_ids: [보강올아이.id], items: [{ kind: "집", title: "보강 숙제(손)" }] })).d.created === 1);
  ck("보강 아이 기록을 저장할 수 있다",
     (await POST("/api/attendance", { action: "save-record", student_id: 보강올아이.id, date: 오늘, fields: { attitude: "상", homework: "100%완료" } })).s === 200);
  // 두 번 눌러도 행이 늘지 않아야 함
  const 전개수 = (await 행보기()).length;
  await POST("/api/attendance", { action: "add-row", student_id: 보강올아이.id, date: 오늘 });
  ck("★ 보강 버튼을 두 번 눌러도 행이 두 개 생기지 않는다", (await 행보기()).length === 전개수, { 전: 전개수, 후: (await 행보기()).length });
}

// ───────────────────────────────────────────────────────── 6. 결석
마디("6. 결석 — 안 온 아이");

줄(`${결석할아이.name} 을 결석으로 처리합니다 (데일리 리포트에서 「결석」 버튼)`);
const 결석저장 = await POST("/api/attendance", { action: "save-record", student_id: 결석할아이.id, date: 오늘, fields: { lateness: "결석" } });
ck(`★ ${결석할아이.name}: 결석으로 처리할 수 있다`, 결석저장.s === 200, 결석저장.d);

행들 = await 행보기();
ck("결석이 저장돼 있다", 행들.find((r) => r.student_id === 결석할아이.id)?.record?.lateness === "결석");

const 판2 = (await GET("/api/attendance", "action=board")).d;
const 결석판 = (판2.students || []).find((x) => x.name === 결석할아이.name);
ck("★ 현황판에 결석으로 보인다", 결석판?.status === "결석", 결석판);
ck("현황판 결석 수가 늘었다", (판2.stats?.결석 ?? 0) >= 1, 판2.stats);

// 결석이면 학부모 카톡 대상에서 빠져야 함 (결석 아이에게 「오늘 진도」 카톡이 가면 안 됨)
const 미리 = await POST("/api/attendance", { action: "send-daily", date: 오늘, dryRun: true });
ck("데일리 리포트 미리보기가 돌아간다", 미리.s === 200, 미리.d?.error);
const 미리목록 = 미리.d.preview || 미리.d.messages || 미리.d.list || [];
ck("★ 결석한 아이는 데일리 리포트 발송 대상에서 빠진다",
   !JSON.stringify(미리목록).includes(결석할아이.name),
   미리목록.length ? `대상 ${미리목록.length}명` : 미리.d);
줄(`발송 대상 ${Array.isArray(미리목록) ? 미리목록.length : "?"}명 (결석 제외)`);

// 결석 아이에게 단어테스트 불통과를 넣어도 재시 카톡 대상이 아니어야 함
await POST("/api/attendance", { action: "save-record", student_id: 결석할아이.id, date: 오늘, fields: { voca_test: "불통과" } });
const 재시미리 = await POST("/api/attendance", { action: "send-retest", date: 오늘, dryRun: true });
ck("★ 결석한 아이는 재시 안내 대상에서도 빠진다",
   !JSON.stringify(재시미리.d.preview || 재시미리.d || {}).includes(결석할아이.name), 재시미리.d);

// 미등원 알림톡 (아직 안 온 아이들에게 수동으로)
const 미등원 = await POST("/api/attendance", { action: "notify-absent", date: 오늘, dryRun: true });
ck("미등원 알림톡 미리보기가 돌아간다", 미등원.s === 200, 미등원.d);

// ★ 결석한 다음 수업일에 진도가 어떻게 되나 — 여기가 운영에서 제일 아픈 자리
{
  const 다음 = (() => { for (let i = 1; i <= 14; i++) { const d = 날더하기(오늘, i);
    const w = "일월화수목금토"[new Date(d + "T00:00:00Z").getUTCDay()];
    if ((결석할아이.schedule || {})[w]) return d; } return null; })();
  if (다음) {
    const 결석날진도 = (await 행보기()).find((r) => r.student_id === 결석할아이.id)?.record?.progress || {};
    // 다음 수업일은 **미래**라 저장되지 않습니다 — 미리보기로만 봅니다
    const 다음행 = (await 행보기(다음)).find((r) => r.student_id === 결석할아이.id);
    const 과목 = Object.keys(결석할아이.books || {})[0];
    줄(`${결석할아이.name}: 결석한 오늘 진도 ${과목} ${결석날진도[과목]?.code} → 다음 수업일(${다음}) ${다음행?.record?.progress?.[과목]?.code}`);
    // ★ 결석한 날 진도는 **소비되지 않아야** 합니다. 소비되면 아이가 안 배운 과를
    //   건너뜁니다 (운영은 결석 학생을 그날 목록에서 아예 빼서 이 문제가 없습니다).
    ck(`★★ 결석한 아이가 한 과를 건너뛰지 않는다 (${과목})`,
       String(결석날진도[과목]?.code) === String(다음행?.record?.progress?.[과목]?.code),
       `결석한 날 ${결석날진도[과목]?.code} → 다음 수업일 ${다음행?.record?.progress?.[과목]?.code} (건너뜀)`);
    // 연속 결석도 거슬러 올라가는지 — 지난 수업일도 결석으로 만들어 봅니다
    {
      const 지난 = (() => { for (let i = 1; i <= 14; i++) { const d = 날더하기(오늘, -i);
        const w = "일월화수목금토"[new Date(d + "T00:00:00Z").getUTCDay()];
        if ((결석할아이.schedule || {})[w]) return d; } return null; })();
      if (지난) {
        const 지난행 = (await 행보기(지난)).find((r) => r.student_id === 결석할아이.id);
        const 지난진도 = 지난행?.record?.progress?.[과목]?.code;
        await POST("/api/attendance", { action: "save-record", student_id: 결석할아이.id, date: 지난, fields: { lateness: "결석" } });
        const 다음2 = (await 행보기(다음)).find((r) => r.student_id === 결석할아이.id);
        줄(`연속 결석: ${지난}(결석 ${지난진도}) · ${오늘}(결석 ${결석날진도[과목]?.code}) → 다음 수업일 ${다음2?.record?.progress?.[과목]?.code}`);
        ck("★★ 이틀 연속 결석해도 진도를 두 과 건너뛰지 않는다",
           String(다음2?.record?.progress?.[과목]?.code) === String(지난진도),
           `${지난진도} 에서 이어져야 하는데 ${다음2?.record?.progress?.[과목]?.code} 입니다`);
        await POST("/api/attendance", { action: "save-record", student_id: 결석할아이.id, date: 지난, fields: { lateness: "정시" } });
      }
    }
  }
}

// ───────────────────────────────────────────────────────── 7. 수업 기록 작성
마디("7. 기록 — 태도·과제·단어테스트·지적사항");

const 기록 = await POST("/api/attendance", { action: "save-record", student_id: 정시.id, date: 오늘,
  fields: { attitude: "상", homework: "100%완료", voca_test: "통과", voca_score: "19/20",
            note: "구문분석을 꼼꼼히 했습니다", parent_note: "집에서 단어 복습 부탁드립니다" } });
ck("태도·과제등급·단어테스트·지적사항이 한 번에 저장된다", 기록.s === 200, 기록.d);
내행 = (await 행보기()).find((r) => r.student_id === 정시.id);
ck("저장한 기록이 다시 읽힌다",
   내행?.record?.attitude === "상" && 내행?.record?.homework === "100%완료" && 내행?.record?.voca_score === "19/20",
   내행?.record);
ck("통과면 재시 대상이 아니다", 내행?.record?.needs_retest === false, 내행?.record);

// 불통과 — 버튼으로
await POST("/api/attendance", { action: "save-record", student_id: 정시.id, date: 오늘, fields: { voca_test: "불통과", voca_score: "" } });
내행 = (await 행보기()).find((r) => r.student_id === 정시.id);
ck("★ 「불통과」 를 누르면 재시 대상이 된다", 내행?.record?.needs_retest === true, 내행?.record);
ck("재시 큐에 올라간다 (미전송)", 내행?.record?.retest_sent === "미전송", 내행?.record?.retest_sent);

// 불통과 — 점수만 적었을 때 (버튼 안 누름)
await POST("/api/attendance", { action: "save-record", student_id: 정시.id, date: 오늘, fields: { voca_test: "", voca_score: "9/20" } });
내행 = (await 행보기()).find((r) => r.student_id === 정시.id);
ck("★ 점수만 적어도(9/20) 재시 대상이 된다", 내행?.record?.needs_retest === true, 내행?.record);
줄(`화면 안내: ${내행?.record?.retest_hint || "—"}`);

// 통과 점수면 큐에서 내려와야
await POST("/api/attendance", { action: "save-record", student_id: 정시.id, date: 오늘, fields: { voca_test: "", voca_score: "18/20" } });
내행 = (await 행보기()).find((r) => r.student_id === 정시.id);
ck("★ 점수를 고쳐 통과하면 재시 대상에서 내려온다", 내행?.record?.needs_retest === false, 내행?.record);

// 만점 없이 적은 점수는 판정하지 않는다 (18점인지 18/20인지 모르는 채 카톡 보내면 안 됨)
await POST("/api/attendance", { action: "save-record", student_id: 정시.id, date: 오늘, fields: { voca_test: "", voca_score: "18" } });
내행 = (await 행보기()).find((r) => r.student_id === 정시.id);
ck("★ 만점 없이 「18」 만 적으면 섣불리 재시 판정하지 않는다", 내행?.record?.needs_retest === false, 내행?.record);

// 재시 안내 미리보기
await POST("/api/attendance", { action: "save-record", student_id: 정시.id, date: 오늘, fields: { voca_test: "불통과" } });
const 재시2 = await POST("/api/attendance", { action: "send-retest", date: 오늘, dryRun: true });
ck("★ 재시 안내 미리보기에 그 아이가 들어 있다", JSON.stringify(재시2.d).includes(정시.name), 재시2.d);
ck("재시 안내는 통과 기준(%)을 알려준다", typeof 재시2.d.pass === "number", 재시2.d.pass);
줄(`재시 통과 기준 ${재시2.d.pass}% · 대상 ${(재시2.d.preview || []).length || "?"}명`);

// 지적사항은 학부모 카톡에 들어가고, note 는 안 들어가야 함
{
  const p = await POST("/api/attendance", { action: "send-daily", date: 오늘, dryRun: true, student_ids: [정시.id] });
  const 글 = JSON.stringify(p.d);
  ck("학부모 카톡에 「학부모께」 메모가 들어간다", 글.includes("집에서 단어 복습"), 글.slice(0, 300));
  ck("★ 내부 메모(지적사항)는 학부모 카톡에 안 들어간다", !글.includes("구문분석을 꼼꼼히"), 글.slice(0, 300));
}

// ───────────────────────────────────────────────────────── 8. 하원
마디("8. 하원 — 아이가 집에 간다");

const 하원키오스크 = await POST("/api/attendance", { action: "checkin", code: 정시.student_code, pin: 정시.pin });
ck("★ 키오스크를 두 번째로 누르면 하원이 된다", 하원키오스크.s === 200 && /하원|out/i.test(JSON.stringify(하원키오스크.d)), 하원키오스크.d);
줄(`→ ${하원키오스크.d.kind || ""} ${하원키오스크.d.time || ""}`);
행들 = await 행보기();
ck("하원 시각이 저장돼 있다", Boolean(행들.find((r) => r.student_id === 정시.id)?.record?.check_out));

// 현황판에서 하원 처리 (카톡은 안 감)
const 판하원 = await POST("/api/attendance", { action: "checkout", student_id: 지각할아이.id, date: 오늘 });
ck("현황판에서 하원 처리가 된다", 판하원.s === 200, 판하원.d);
ck("현황판 하원 처리도 시각이 저장된다",
   Boolean((await 행보기()).find((r) => r.student_id === 지각할아이.id)?.record?.check_out));

// ───────────────────────────────────────────────────────── 9. 학생 카드
마디("9. 학생 카드 — 한 아이의 지난 기록");

for (const 범위 of ["1w", "1m", "3m"]) {
  const h = await GET("/api/attendance", `action=student-history&student_id=${정시.id}&range=${범위}`);
  ck(`학생 카드 ${범위} 가 열린다`, h.s === 200 && !h.d.error, h.d?.error);
}
{
  const h = await GET("/api/attendance", `action=student-history&student_id=${정시.id}&range=3m`);
  const 일수 = (h.d.rows || h.d.days || h.d.records || []).length;
  줄(`${정시.name} 3달 기록 ${일수}일`);
  ck("학생 카드에 기록이 있다", 일수 > 0, h.d);
}

// ───────────────────────────────────────────────────────── 10. 학생 관리
마디("10. 학생 관리 — 넣고, 고치고, 붙여넣기 일괄등록, 퇴원");

// 학생ID·출결PIN 은 **선생님이 적는 것**입니다 (앱이 만들어주지 않습니다 —
// 1·2차 노션 명단의 학생ID 를 그대로 쓰려고 그렇게 돼 있습니다).
const 빈PIN = "7731";   // 샘플 PIN 과 겹치지 않는 값
const 새아이 = { name: "시뮬학생", grade: "중2", phone: "010-0000-0000", status: "재원",
  student_code: "sim01", pin: 빈PIN,
  schedule: { 월: "16:00", 화: "16:00", 수: "16:00", 목: "16:00", 금: "16:00", 토: "16:00", 일: "16:00" },
  books: 정시.books, teacher: 정시.teacher || null };
const 넣기 = await POST("/api/attendance", { action: "save-student", student: 새아이 });
ck("학생을 한 명 넣을 수 있다", 넣기.s === 200 && 넣기.d.student?.id, 넣기.d);
const 새id = 넣기.d.student?.id;
if (새id) {
  ck("적어 넣은 학생ID·출결PIN 이 그대로 저장된다",
     넣기.d.student.student_code === "sim01" && 넣기.d.student.pin === 빈PIN, 넣기.d.student);
  줄(`새 학생: ${넣기.d.student.name} / ID ${넣기.d.student.student_code} / PIN ${넣기.d.student.pin}`);
  ck("새 학생도 바로 데일리 리포트에 나온다", (await 행보기()).some((r) => r.student_id === 새id));
  const 그행 = (await 행보기()).find((r) => r.student_id === 새id);
  ck("새 학생도 진도가 자동으로 들어온다",
     Object.keys(새아이.books || {}).every((k) => 그행?.record?.progress?.[k]?.code), 그행?.record?.progress);
  ck("새 학생 진도가 교재 1과로 시작한다",
     Object.keys(새아이.books || {}).every((k) => { const u = (목차[새아이.books[k]] || [])[0];
       return !u || 그행?.record?.progress?.[k]?.code === u.code; }), 그행?.record?.progress);
  ck("새 학생도 키오스크 등원이 된다",
     (await POST("/api/attendance", { action: "checkin", code: 넣기.d.student.student_code, pin: 넣기.d.student.pin })).s === 200);
  ck("학생 정보를 고칠 수 있다",
     (await POST("/api/attendance", { action: "save-student", student: { ...넣기.d.student, grade: "중3" } })).s === 200);
  ck("퇴원 처리(삭제)가 된다", (await POST("/api/attendance", { action: "delete-student", id: 새id })).s === 200);
  ck("퇴원하면 명단에서 빠진다", !((await GET("/api/attendance", "action=students")).d.students || []).some((s) => s.id === 새id && s.status === "재원"));
}

// ★★ PIN 이 겹치면 — 키오스크는 PIN 만으로 아이를 찾습니다.
//    겹치면 엉뚱한 아이로 등원되고 **그 아이 학부모에게** 등원 카톡이 갑니다.
{
  const 겹칠PIN = 정시.pin;
  const r = await POST("/api/attendance", { action: "save-student", student: {
    name: "PIN겹침", grade: "중1", phone: "010-9999-9999", status: "재원",   // 가짜 번호 (검수용)
    student_code: "simdup", pin: 겹칠PIN, schedule: { [요일]: "16:00" }, books: 정시.books } });
  if (r.s === 200) {
    ck(`★★ PIN 이 ${정시.name} 과 겹치는 학생 등록을 막는다`, false,
       `막지 않았습니다 — 등록됨 (PIN ${겹칠PIN})`);
    const 등 = await POST("/api/attendance", { action: "checkin", pin: 겹칠PIN });
    ck("★★ 겹친 PIN 으로 누르면 누구인지 못 가린다고 알려준다",
       등.s >= 400 && /[가-힣]/.test(등.d.error || ""),
       `키오스크가 「${등.d.name}」 로 처리했습니다 — 누른 사람이 누군지 모르는 채 그 집에 카톡이 갑니다`);
    await POST("/api/attendance", { action: "delete-student", id: r.d.student?.id });
  } else {
    ck(`★★ PIN 이 겹치는 학생 등록을 막는다`, true);
    ck("막는 말이 한국어다", /[가-힣]/.test(r.d.error || ""), r.d.error);
  }
}

// 붙여넣기 일괄등록 (A 갈래 — 구글시트에서 복사). PIN 칸을 안 넣은 흔한 실수까지.
const 붙여넣기 = await POST("/api/attendance", { action: "bulk-students", rows: [
  // 아래 연락처는 전부 가짜 번호입니다 (검수용 샘플)
  { name: "일괄1", student_code: "simb01", pin: "7741", grade: "중1", phone: "010-1111-0001", schedule: { 월: "17:00", 수: "17:00" }, books: 정시.books },   // 가짜 번호
  { name: "일괄2", student_code: "simb02", pin: "7742", grade: "중2", phone: "010-1111-0002", schedule: { 화: "17:00", 목: "17:00" }, books: 정시.books },   // 가짜 번호
] });
ck("붙여넣기 일괄등록이 된다", 붙여넣기.s === 200, 붙여넣기.d);
줄(`일괄등록 결과: ${JSON.stringify(붙여넣기.d).slice(0, 200)}`);
{
  const 들 = ((await GET("/api/attendance", "action=students")).d.students || []).filter((s) => /^일괄[12]$/.test(s.name));
  ck("일괄등록한 아이들이 명단에 있다", 들.length === 2, 들.map((s) => s.name));
  ck("일괄등록한 아이들의 학생ID·PIN 이 그대로 들어갔다", 들.every((s) => s.student_code && s.pin), 들.map((s) => ({ n: s.name, c: s.student_code, p: s.pin })));
  ck("일괄등록한 아이도 키오스크 등원이 된다",
     (await POST("/api/attendance", { action: "checkin", pin: "7741" })).s === 200);
  for (const s of 들) await POST("/api/attendance", { action: "delete-student", id: s.id });
}
// PIN 없이 붙여넣으면 — 그 아이는 키오스크·학생앱이 둘 다 안 됩니다
{
  const r = await POST("/api/attendance", { action: "bulk-students", rows: [
    { name: "핀없음", grade: "중1", phone: "010-1111-0003", schedule: { [요일]: "17:00" }, books: 정시.books } ] });   // 가짜 번호
  const 그아이 = ((await GET("/api/attendance", "action=students")).d.students || []).find((s) => s.name === "핀없음");
  if (그아이 && !그아이.pin)
    줄("PIN 없이 붙여넣으면 서버는 받아들입니다 — PIN 을 나중에 적는 원장님도 있어서요. 대신 붙여넣기 화면이 「이 아이는 키오스크·학생앱이 안 됩니다」 라고 묻습니다 (students.html 의 noPin 확인창).");
  if (그아이) await POST("/api/attendance", { action: "delete-student", id: 그아이.id });
}

// ───────────────────────────────────────────────────────── 11. 교재 관리
마디("11. 교재 — 넣고, 목차 고치고, 지운다");

const 새교재 = { name: "시뮬교재 A", subject: "문법", units: [
  { code: "U1", title: "현재시제", 집과제: ["워크북 U1 풀기", "단어 20개"], 학원과제: "본문 2회 읽기" },
  { code: "U2", title: "과거시제", 집과제: ["워크북 U2 풀기"], 학원과제: "오답 정리" },
] };
const 교재넣기 = await POST("/api/attendance", { action: "save-textbook", textbook: 새교재 });
ck("교재를 넣을 수 있다", 교재넣기.s === 200, 교재넣기.d);
ck("넣은 교재가 목록에 있다", ((await GET("/api/attendance", "action=textbooks")).d.textbooks || []).some((t) => t.name === 새교재.name));

// 그 교재로 아이를 옮기고 → 유닛 과제가 그대로 나가나
{
  const r = await POST("/api/attendance", { action: "change-book", student_id: 정시.id, date: 오늘, subject: "문법", book: 새교재.name });
  ck("새로 만든 교재로 아이를 옮길 수 있다", r.s === 200, r.d);
  const 그행 = (await 행보기()).find((x) => x.student_id === 정시.id);
  ck("새 교재의 1과로 진도가 들어온다", 그행?.record?.progress?.문법?.code === "U1", 그행?.record?.progress?.문법);
  const 과제2 = (await 과제보기()).filter((t) => t.student_id === 정시.id && t.auto);
  ck("★ 목차에 적어둔 집과제가 그대로 깔린다", 과제2.some((t) => t.title.includes("워크북 U1")), 과제2.map((t) => t.title));
  ck("★ 목차에 적어둔 학원과제도 깔린다", 과제2.some((t) => t.kind === "학원" && t.title.includes("본문 2회")), 과제2.map((t) => `[${t.kind}]${t.title}`));
  줄(`새 교재 자동 과제: ${과제2.map((t) => `[${t.kind}] ${t.title}`).join(" | ")}`);
  // 원래 교재로 되돌리기
  await POST("/api/attendance", { action: "change-book", student_id: 정시.id, date: 오늘, subject: "문법", book: 정시.books.문법 });
}
{
  const 그것 = ((await GET("/api/attendance", "action=textbooks")).d.textbooks || []).find((t) => t.name === 새교재.name);
  ck("교재를 지울 수 있다", (await POST("/api/attendance", { action: "delete-textbook", id: 그것?.id })).s === 200, 그것?.id);
}
ck("지운 교재가 목록에서 빠진다", !((await GET("/api/attendance", "action=textbooks")).d.textbooks || []).some((t) => t.name === 새교재.name));

// ───────────────────────────────────────────────────────── 12. 선생님별
마디("12. 담당 선생님 — 내 아이들만");

const 쌤들 = (await GET("/api/attendance", "action=teachers")).d.teachers || [];
줄(`선생님 ${쌤들.length}명: ${JSON.stringify(쌤들).slice(0, 150)}`);
const 쌤 = (Array.isArray(쌤들) ? 쌤들 : []).map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean)[0];
if (쌤) {
  const 내아이 = (await GET("/api/attendance", `action=students&teacher=${encodeURIComponent(쌤)}`)).d.students || [];
  ck(`★ ${쌤} 선생님 명단에는 그 선생님 아이들만 있다`, 내아이.length > 0 && 내아이.every((s) => s.teacher === 쌤), 내아이.map((s) => `${s.name}/${s.teacher}`));
  ck("담당 아이만 데일리 리포트에 나온다",
     ((await GET("/api/attendance", `action=daily-rows&date=${오늘}&teacher=${encodeURIComponent(쌤)}`)).d.rows || []).every((r) => r.teacher === 쌤));
  {
    const ids = new Set(내아이.map((s) => s.id));
    const 쌤과제 = (await GET("/api/attendance", `action=tasks&date=${오늘}&teacher=${encodeURIComponent(쌤)}`)).d.tasks || [];
    ck("담당 아이 과제만 나온다", 쌤과제.every((t) => ids.has(t.student_id)),
       쌤과제.filter((t) => !ids.has(t.student_id)).map((t) => t.name));
  }
} else 짚기("담당 선생님이 지정된 아이가 없어 선생님별 분리를 못 봤습니다");

// ───────────────────────────────────────────────────────── 13. 월말평가서
마디("13. 월말평가서 — 뽑고, 저장하고, 학부모가 열어본다");

const 달 = 오늘.slice(0, 7);
const 평가대상 = await GET("/api/report", `action=students&month=${달}`);
ck("월말평가서 대상 명단이 나온다", 평가대상.s === 200, 평가대상.d?.error);
줄(`${달} 대상 ${(평가대상.d.students || []).length}명`);

const 미리보기 = await GET("/api/report", `action=preview&student_id=${정시.id}&month=${달}`);
ck("통계 미리보기가 나온다", 미리보기.s === 200 && !미리보기.d.error, 미리보기.d?.error);
{
  const p = 미리보기.d.planner || 미리보기.d.stats || 미리보기.d;
  줄(`통계: ${JSON.stringify(p).slice(0, 300)}`);
  ck("수업일수·출결이 집계된다", JSON.stringify(p).includes("출석") || JSON.stringify(p).includes("총수업일수"), p);
}

const 뽑기 = await POST("/api/report", { action: "generate", student_id: 정시.id, month: 달 });
if (뽑기.s === 200) {
  ck("평가서 본문이 생성된다", Boolean(뽑기.d.body), Object.keys(뽑기.d));
  const 본문 = 뽑기.d.body || "";
  const 저장 = await POST("/api/report", { action: "save", student_id: 정시.id, month: 달, body: 본문 });
  ck("평가서를 저장할 수 있다", 저장.s === 200, 저장.d);
  const 다시 = await GET("/api/report", `action=get&student_id=${정시.id}&month=${달}`);
  ck("저장한 평가서를 다시 열 수 있다", 다시.s === 200 && (다시.d.report || 다시.d.text), 다시.d);
  const 토큰 = 저장.d.share_token || 다시.d.share_token || 다시.d.report?.share_token;
  if (토큰) {
    const 학부모 = await GET("/api/report", `action=parent&token=${토큰}`);
    ck("★ 학부모가 링크로 열어볼 수 있다", 학부모.s === 200 && !학부모.d.error, 학부모.d?.error);
    ck("★ 가짜 토큰으로는 못 열린다", (await GET("/api/report", "action=parent&token=aaaaaaaaaaaaaaaa")).s >= 400);
    ck("★ 학부모 화면에 학생 내부ID가 노출되지 않는다", !JSON.stringify(학부모.d).includes(정시.id), "id 노출");
  } else 짚기("share_token 을 못 찾아 학부모 링크를 못 봤습니다");
  ck("한 아이의 평가서 이력이 나온다", (await GET("/api/report", `action=student-reports&student_id=${정시.id}`)).s === 200);
  ck("평가서 쓴 아이 목록이 나온다", (await GET("/api/report", `action=students-with-reports&month=${달}`)).s === 200);
  const 보내기 = await POST("/api/report", { action: "send", student_id: 정시.id, month: 달, dryRun: true });
  ck("평가서 카톡 미리보기가 돌아간다", 보내기.s === 200, 보내기.d);
  ck("평가서를 지울 수 있다", (await POST("/api/report", { action: "delete", student_id: 정시.id, month: 달 })).s === 200);
} else {
  짚기(`평가서 생성이 안 돌았습니다 (${JSON.stringify(뽑기.d).slice(0, 200)}) — 가짜 Anthropic 서버가 안 떠 있으면 정상입니다`);
}

// ───────────────────────────────────────────────────────── 14. 실수 상황
마디("14. 실수 — 선생님이 잘못 눌렀을 때");

{
  const r = await GET("/api/attendance", "action=daily-rows&date=2026-13-01");
  ck("없는 날짜(13월)를 넣으면 막는다", r.s === 400, r.d);
  ck("날짜 오류 메시지가 한국어다", /[가-힣]/.test(r.d.error || ""), r.d.error);
}
ck("없는 학생 id 로 저장하면 한국어로 막는다", (await POST("/api/attendance", { action: "save-record", student_id: "없는학생", date: 오늘, fields: {} })).s === 400);
{
  const r = await POST("/api/attendance", { action: "save-record", student_id: "'; drop table students; --", date: 오늘, fields: {} });
  ck("★★ SQL 을 흘려넣어도 막힌다", r.s === 400, r.d);
  ck("★★ 학생 표가 그대로 있다", ((await GET("/api/attendance", "action=students")).d.students || []).length > 0);
}
ck("모르는 action 은 한국어로 막는다", (await GET("/api/attendance", "action=없는기능")).s === 400);
{
  // 미래 날짜를 눌러보기만 해도 행이 생기면 월말 수업일수가 부풀어 학부모에게 틀린 숫자가 나갑니다
  const 앞 = (await GET("/api/attendance", `action=daily-rows&date=${날더하기(오늘, 30)}`)).d.rows || [];
  ck("★ 먼 미래를 열어보면 미리보기로만 보인다", 앞.every((r) => !r.record_id || r.preview || !r.record_id), 앞.slice(0, 2));
}

// ───────────────────────────────────────────────────────── 마무리
console.log(`\n${"═".repeat(60)}`);
console.log(`\x1b[1m점검 ${통과 + 실패.length}개 · 통과 ${통과} · 실패 ${실패.length}\x1b[0m`);
if (실패.length) { console.log("\n\x1b[31m실패한 것:\x1b[0m"); 실패.forEach((x) => console.log(`  ❌ ${x}`)); }
if (소견.length) { console.log("\n\x1b[33m알아두실 것:\x1b[0m"); 소견.forEach((x) => console.log(`  ⚠️  ${x}`)); }
console.log(실패.length ? "\n❌ 하루 시뮬레이션 실패" : "\n✅ 하루 시뮬레이션 통과");
process.exit(실패.length ? 1 : 0);
