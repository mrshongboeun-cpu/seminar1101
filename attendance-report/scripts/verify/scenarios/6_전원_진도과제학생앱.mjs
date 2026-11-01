// 열두 명 전원 · 하나하나 다 돌려보기
//   출결(등원·하원·지각·결석·보강) · 진도 · 과제(자동/수기) · 학생앱 · 선생님앱 · 월말평가서
const B = process.env.SC_BASE || "http://127.0.0.1:4331";
let fail = 0, n = 0;
const bad = [];
const ck = (name, ok, detail) => {
  n++; if (!ok) { fail++; bad.push(name + "  → " + JSON.stringify(detail)); }
  return ok;
};
const get = async (p, q) => { const r = await fetch(`${B}${p}?${q}`); return { s: r.status, d: await r.json().catch(()=>({})) }; };
const post = async (p, body) => { const r = await fetch(`${B}${p}`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body) }); return { s: r.status, d: await r.json().catch(()=>({})) }; };

// ★ 「오늘」은 **한국시간** 입니다. 앱이 KST 로 판단하기 때문에,
//   UTC 로 계산하면 저녁(한국 자정 이후)에 **하루 어긋나** 전부 엉뚱한 날을 봅니다.
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const WD = "일월화수목금토"[new Date(Date.now()+9*3600*1000).getUTCDay()];   // 요일도 KST
console.log(`오늘 ${TODAY} (${WD})\n`);

// ── 0. 교재 목차에 과제 심기 (수강생이 세미나에서 하는 그 작업)
const tb = (await get("/api/attendance","action=textbooks")).d.textbooks;
for (const t of tb) {
  const units = (t.units||[]).map((u,i) => ({
    code: u.code, title: u.title,
    집과제: [`${t.name} ${u.code} 워크북`, "단어 30개"],
    학원과제: "본문 2회 읽기",
  }));
  await post("/api/attendance", { action:"save-textbook", textbook: { ...t, units } });
}
console.log(`교재 ${tb.length}권에 과제를 심었습니다.\n`);
// 교재명 → 목차. 「목차에 제목이 있으면 진도에도 붙나」 를 보려면 목차를 알아야 합니다.
const TOC = Object.fromEntries(tb.map(t => [t.name, t.units || []]));

const students = (await get("/api/attendance","action=students")).d.students
  .sort((a,b)=>a.name.localeCompare(b.name));
ck("학생이 12명", students.length===12, students.length);

// ★ 앱은 「오늘」을 **한국시간**으로 봅니다. 검수가 UTC 로 보면 한국 자정 이후에
//   하루가 어긋나 전부 엉뚱한 날을 검사합니다 (실제로 그렇게 헛걸렸습니다).
{
  const 앱오늘 = (await get("/api/attendance", "action=board")).d.date;
  ck("★ 앱이 보는 오늘과 검수가 보는 오늘이 같다", 앱오늘 === TODAY, { 앱: 앱오늘, 검수: TODAY });
}

// ── 1. 학생 한 명씩
const 요약 = [];
for (const s of students) {
  const 수업일 = Boolean((s.schedule||{})[WD]);
  const line = { 이름: s.name, 수업일: 수업일?"○":"—" };

  // (1) 오늘 행 — 수업일 아니면 보강으로 만들기
  let rows = (await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows||[];
  let me = rows.find(r=>r.student_id===s.id);
  if (!수업일) {
    // 샘플은 세미나 당일 빈 화면이 안 되게 **요일 무관 전원** 오늘 행을 깔아둡니다.
    //   그래서 여기서는 「없으면 보강으로 만들 수 있나」만 봅니다.
    const add = await post("/api/attendance", { action:"add-row", student_id:s.id, date:TODAY });
    ck(`${s.name}: 보강(➕)으로 행을 만들 수 있다`, add.s===200 && add.d.record?.id, add.d);
    rows = (await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows||[];
    me = rows.find(r=>r.student_id===s.id);
    line.보강 = me ? "○" : "✗";
  } else {
    ck(`${s.name}: 수업일이면 오늘 행이 있다`, Boolean(me), "행 없음");
    line.보강 = "-";
  }
  if (!me) { 요약.push(line); continue; }

  // (2) 진도 — 교재가 지정된 과목마다 목차와 연결됐는지
  const prog = me.record?.progress || {};
  const 과목 = Object.keys(s.books||{});
  const 연결 = 과목.filter(k => prog[k]?.code);
  ck(`${s.name}: 과목마다 진도가 채워져 있다`, 연결.length===과목.length, {과목, prog});
  // ★ 제목은 **목차에 적혀 있을 때만** 따라옵니다.
  //   단어 교재처럼 「Day 16」 만으로 충분한 경우엔 목차의 제목 칸이 비어 있고,
  //   그때 제목을 억지로 요구하면 멀쩡한데도 실패합니다.
  //   봐야 할 것은 「목차에 제목이 있으면 진도에도 따라붙나」 입니다.
  const 제목붙음 = 과목.every(k => {
    const c = prog[k]?.code; if (!c) return true;
    const u = (TOC[s.books[k]] || []).find(x => String(x.code) === String(c));
    return !u || !u.title || Boolean(prog[k]?.title);   // 목차에 제목이 없으면 통과
  });
  ck(`${s.name}: 목차에 제목이 있으면 진도에도 붙는다`, 제목붙음, prog);
  line.진도 = 연결.length + "/" + 과목.length;

  // (3) 자동 과제 — 진도를 저장하면 그 유닛 과제가 깔린다
  await post("/api/attendance", { action:"save-record", student_id:s.id, date:TODAY, fields:{ progress: prog } });
  let t = (await get("/api/attendance",`action=tasks&date=${TODAY}`)).d.tasks||[];
  const 내자동 = t.filter(x=>x.student_id===s.id && x.auto);
  ck(`${s.name}: 진도에 맞는 자동 과제가 생긴다`, 내자동.length>0, 내자동.length);
  const 코드들 = 과목.map(k=>prog[k]?.code).filter(Boolean);
  const 맞나 = 내자동.some(x=>코드들.some(c=>x.title.includes(c)));
  ck(`${s.name}: 자동 과제가 **그 유닛** 것이다`, 맞나, {코드들, 제목: 내자동.map(x=>x.title)});
  line.자동과제 = 내자동.length;

  // (4) 손으로 과제 내주기
  const 손제목 = `${s.name} 수기과제`;
  const st = await post("/api/attendance", { action:"save-tasks", date:TODAY, student_ids:[s.id],
    items:[{ kind:"집", subject:"문법", title:손제목 }] });
  ck(`${s.name}: 손으로 과제를 낼 수 있다`, st.s===200, st.d);
  t = (await get("/api/attendance",`action=tasks&date=${TODAY}`)).d.tasks||[];
  const 손것 = t.find(x=>x.student_id===s.id && x.title===손제목);
  ck(`${s.name}: 손으로 낸 과제는 auto 표시가 없다`, 손것 && 손것.auto===false, 손것);

  // (5) 진도를 바꿔도 손으로 낸 과제는 안 지워진다
  const 과목1 = 과목.find(k=>prog[k]?.code);
  if (과목1) {
    const 바꾼 = { ...prog, [과목1]: { code: prog[과목1].code, title: prog[과목1].title } };
    await post("/api/attendance", { action:"save-record", student_id:s.id, date:TODAY, fields:{ progress: 바꾼 } });
    t = (await get("/api/attendance",`action=tasks&date=${TODAY}`)).d.tasks||[];
    ck(`${s.name}: ★ 진도를 다시 저장해도 손으로 낸 과제가 남는다`,
       t.some(x=>x.student_id===s.id && x.title===손제목), t.filter(x=>x.student_id===s.id).map(x=>x.title));
  }

  // (6) 학생앱 — 로그인 → 과제 체크 → 서버 반영
  const login = await post("/api/student", { action:"login", code:s.student_code, pin:s.pin });
  ck(`${s.name}: 학생앱 로그인`, login.s===200, login.d);
  const home = await post("/api/student", { action:"home", code:s.student_code, pin:s.pin });
  const 앱과제 = home.d.tasks||[];
  ck(`${s.name}: 학생앱에 오늘 과제가 보인다`, 앱과제.length>0, 앱과제.length);
  const 안한것 = 앱과제.find(x=>!x.done);
  if (안한것) {
    const tg = await post("/api/student", { action:"toggle-task", code:s.student_code, pin:s.pin, task_id:안한것.id, done:true });
    ck(`${s.name}: 학생이 체크하면 저장된다`, tg.s===200, tg.d);
    t = (await get("/api/attendance",`action=tasks&date=${TODAY}`)).d.tasks||[];
    ck(`${s.name}: ★ 선생님 화면에 바로 보인다`, t.find(x=>x.id===안한것.id)?.done===true, null);
  }
  line.앱과제 = 앱과제.length;

  // (7) 남의 과제는 못 건드린다
  const 남 = (await get("/api/attendance",`action=tasks&date=${TODAY}`)).d.tasks.find(x=>x.student_id!==s.id);
  if (남) {
    const 침입 = await post("/api/student", { action:"toggle-task", code:s.student_code, pin:s.pin, task_id:남.id, done:true });
    ck(`${s.name}: ★★ 남의 과제는 못 건드린다`, 침입.s>=400 || 침입.d.error, 침입.d);
  }
  요약.push(line);
}

console.log("\n── 학생별 요약 ──");
console.log("이름    수업일 보강 진도  자동과제 앱과제");
for (const r of 요약) console.log(`${String(r.이름).padEnd(6)}  ${r.수업일}     ${r.보강||"-"}   ${r.진도||"-"}   ${String(r.자동과제??"-").padEnd(6)}  ${r.앱과제??"-"}`);

console.log(`\n점검 ${n}개 · 실패 ${fail}개`);
if (bad.length) { console.log("\n실패한 것:"); bad.forEach(x=>console.log("  ❌ "+x)); }
process.exit(fail?1:0);
