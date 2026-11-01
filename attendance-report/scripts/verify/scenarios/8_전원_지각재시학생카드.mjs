// 3부 — 지각 판정 · 단어 불통과→재시 · 학생 카드 · 과제 이력 · 평가서 다시 열기/삭제
const B = process.env.SC_BASE || "http://127.0.0.1:4331";
let fail=0,n=0; const bad=[];
const ck=(name,ok,d)=>{n++; if(!ok){fail++;bad.push(name+"  → "+JSON.stringify(d));} return ok;};
const get=async(p,q)=>{const r=await fetch(`${B}${p}?${q}`);return{s:r.status,d:await r.json().catch(()=>({}))};};
const post=async(p,b)=>{const r=await fetch(`${B}${p}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});return{s:r.status,d:await r.json().catch(()=>({}))};};
// ★ 「오늘」은 **한국시간** 입니다. 앱이 KST 로 판단하기 때문에,
//   UTC 로 계산하면 저녁(한국 자정 이후)에 **하루 어긋나** 전부 엉뚱한 날을 봅니다.
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const 지난달 = (() => { const d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const students=(await get("/api/attendance","action=students")).d.students.sort((a,b)=>a.name.localeCompare(b.name));

// ── 1. 지각 판정
console.log("── 지각 판정 ──");
const rows=(await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows||[];
const GRACE = 10;   // api/attendance.js 의 지각 유예와 같은 값
let 지각수=0, 정시수=0;
for (const r of rows) {
  const ci=r.record?.check_in, lt=r.record?.lateness;
  if (!ci) continue;
  if (lt==="결석") continue;   // 결석으로 적어둔 행은 지각/정시 대상이 아닙니다
  if (lt==="지각") 지각수++; else 정시수++;
  const 예정=r.scheduled;
  console.log(`  ${r.name.padEnd(5)} 예정 ${예정||"-"} 등원 ${ci} → ${lt||"정시"}`);
  ck(`${r.name}: 등원했으면 지각/정시가 정해진다`, lt==="지각"||lt==="정시", lt);
  if (!r.scheduled) ck(`${r.name}: 예정 시간이 없으면(보강) 지각이 아니다`, lt==="정시", lt);

  // ★ 시계에 기대지 않고 **규칙 자체**를 봅니다.
  //   예전에는 "지각이 한 명은 나와야 한다" 로 적었는데, 한국시간 자정에 돌리면
  //   16~19시 수업에 지각일 수가 없어 **멀쩡한데도 실패**했습니다.
  const 분 = (t) => { const [h,m]=String(t).split(":").map(Number); return h*60+m; };
  if (r.scheduled) {
    const 늦었나 = 분(ci) > 분(r.scheduled) + GRACE;
    ck(`${r.name}: 예정 ${r.scheduled} + 유예 ${GRACE}분 기준으로 ${늦었나?"지각":"정시"} 가 맞다`,
       lt === (늦었나 ? "지각" : "정시"), { 예정:r.scheduled, 등원:ci, 판정:lt });
  }
}

// ── 2. 단어 불통과 → 재시 큐 → 발송
console.log("\n── 단어 테스트 불통과 → 재시 안내 ──");
const 대상=students[0];
await post("/api/attendance",{action:"save-record",student_id:대상.id,date:TODAY,fields:{voca_test:"불통과",voca_score:"12/20"}});
let rr=(await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows.find(x=>x.student_id===대상.id);
ck(`${대상.name}: 불통과로 적으면 재시 큐에 올라간다`, rr?.record?.retest_sent==="미전송", rr?.record?.retest_sent);
const sr=await post("/api/attendance",{action:"send-retest",date:TODAY,dryRun:true});
console.log("  재시 대상:", sr.d.total ?? "(모름)", "명 · 응답키:", Object.keys(sr.d).join(","));
ck("재시 안내 미리보기가 돈다", sr.s===200, sr.d);
await post("/api/attendance",{action:"save-record",student_id:대상.id,date:TODAY,fields:{voca_test:"통과",voca_score:"19/20"}});
rr=(await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows.find(x=>x.student_id===대상.id);
ck(`${대상.name}: ★ 통과로 고치면 큐에서 내려온다`, !rr?.record?.retest_sent, rr?.record?.retest_sent);

// ── 2-B. ★ 점수만 적었을 때 (선생님이 통과/불통과를 안 누르는 게 실제로 더 흔합니다)
//    예전에는 점수만 적으면 **조용히** 재시 안내가 안 나갔습니다.
console.log("\n── 점수만 적어도 재시 안내가 올라가나 ──");
const 점수만 = students[1];
const 저장 = async (f) => (await post("/api/attendance",{action:"save-record",student_id:점수만.id,date:TODAY,fields:f})).d;
const 행 = async () => (await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows.find(x=>x.student_id===점수만.id)?.record || {};

let d = await 저장({voca_test:null, voca_score:"12/20"});
console.log("  save-record 응답키:", Object.keys(d).join(","), "· 안내:", d.retest_hint);
ck("점수 12/20 만 적어도 큐에 올라간다", (await 행()).retest_sent==="미전송", await 행());
ck("서버가 화면용 판정을 같이 준다 (needs_retest)", d.needs_retest===true, d);
ck("서버가 점수칸 안내 한 줄을 준다", /재시 안내 대상/.test(d.retest_hint||""), d.retest_hint);
ck("daily-rows 도 같은 판정을 준다", (await 행()).needs_retest===true, await 행());

// 발송 대상에 **실제로** 들어가나 — 큐만 차고 미리보기에서 빠지면 아무 의미가 없습니다
const 미리보기 = await post("/api/attendance",{action:"send-retest",date:TODAY,dryRun:true});
ck("점수만 적은 학생이 재시 발송 대상에 들어간다",
   (미리보기.d.results||[]).some(x=>x.student_id===점수만.id), (미리보기.d.results||[]).map(x=>x.name));
ck("미리보기가 기준(%)을 같이 알려준다", 미리보기.d.pass>0, 미리보기.d.pass);

d = await 저장({voca_score:"18/20"});
ck("점수를 고쳐 기준을 넘기면 큐에서 내려온다", !(await 행()).retest_sent, await 행());
ck("그때 안내도 「통과」 로 바뀐다", /통과/.test(d.retest_hint||""), d.retest_hint);

// 선생님 판단이 점수보다 우선 — 「통과」를 눌러두면 점수가 낮아도 안 보냅니다
d = await 저장({voca_test:"통과", voca_score:"3/20"});
ck("★ 「통과」 를 눌러두면 점수가 낮아도 재시가 아니다", !(await 행()).retest_sent, await 행());
ck("그 이유를 화면에 적어준다", /우선/.test(d.retest_hint||""), d.retest_hint);

// 만점을 모르는 숫자는 **잘못 보내지 않는다** (18 이 18점인지 18/20 인지 알 수 없음)
d = await 저장({voca_test:null, voca_score:"18"});
ck("★ 숫자만 적으면 짐작해서 보내지 않는다", !(await 행()).retest_sent, await 행());
ck("대신 왜 판정 못 했는지 화면에 적어준다", /판정 못/.test(d.retest_hint||""), d.retest_hint);
await 저장({voca_test:null, voca_score:null});

// ── 3. 학생 카드 — 열두 명 전원
console.log("\n── 학생 카드 (지난 진도) ──");
for (const s of students) {
  const h=await get("/api/attendance",`action=student-history&student_id=${s.id}&days=90`);
  ck(`${s.name}: 학생 카드가 열린다`, h.s===200 && h.d.student?.name===s.name, h.d.error);
  ck(`${s.name}: 지난 수업 기록이 있다`, (h.d.rows||[]).length>0, (h.d.rows||[]).length);
  ck(`${s.name}: 과목별 흐름이 있다`, (h.d.subjects||[]).length>0, h.d.subjects);
  ck(`${s.name}: ★ 날짜가 ISO 로 안 샌다`, !(h.d.rows||[]).some(r=>/T\d\d:/.test(String(r.date))), (h.d.rows||[])[0]?.date);
  ck(`${s.name}: ★★ 남의 기록이 안 섞인다`, h.d.student?.id===s.id, h.d.student?.id);
}
console.log(`  열두 명 전원 열림`);

// ── 4. 과제 이력 (기간 조회)
console.log("\n── 과제 이력 (기간) ──");
for (const s of students.slice(0,4)) {
  const t=await get("/api/attendance",`action=tasks&from=${지난달}-01&to=${TODAY}&student_id=${s.id}`);
  ck(`${s.name}: 과제 이력이 조회된다`, t.s===200 && Array.isArray(t.d.tasks), t.d.error);
  ck(`${s.name}: 완료율이 같이 온다`, t.d.summary && typeof t.d.summary.total==="number", t.d.summary);
  ck(`${s.name}: ★★ 본인 것만 온다`, (t.d.tasks||[]).every(x=>x.student_id===s.id), "남의 것 섞임");
  console.log(`  ${s.name}: ${t.d.summary?.total}건 · 완료 ${t.d.summary?.done} · ${t.d.summary?.rate}%`);
}

// ── 5. 평가서 다시 열기 / 삭제
console.log("\n── 평가서 다시 열기·삭제 ──");
const wl=await get("/api/report",`action=students-with-reports&month=${지난달}`);
ck("저장된 평가서가 있는 학생 목록이 온다", wl.s===200 && (wl.d.students||[]).length===12, (wl.d.students||[]).length);
const 하나=students[11];
const sr2=await get("/api/report",`action=student-reports&student_id=${하나.id}`);
ck(`${하나.name}: 이 학생의 평가서 목록이 온다`, sr2.s===200 && (sr2.d.reports||[]).length>0, sr2.d);
const g2=await get("/api/report",`action=get&student_id=${하나.id}&month=${지난달}`);
ck(`${하나.name}: 본문·통계·진도가 그대로 있다`, g2.d.report?.body && g2.d.report?.stats && g2.d.report?.progress, Object.keys(g2.d.report||{}));
const del=await post("/api/report",{action:"delete",student_id:하나.id,month:지난달});
ck(`${하나.name}: 삭제된다`, del.s===200, del.d);
const after=await get("/api/report",`action=get&student_id=${하나.id}&month=${지난달}`);
ck(`${하나.name}: ★ 삭제 뒤에는 안 나온다`, !after.d.report?.body, after.d.report);

console.log(`\n점검 ${n}개 · 실패 ${fail}개`);
if(bad.length){console.log("\n실패한 것:");bad.forEach(x=>console.log("  ❌ "+x));}
process.exit(fail?1:0);
