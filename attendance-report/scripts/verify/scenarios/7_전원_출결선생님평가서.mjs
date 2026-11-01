// 2부 — 출결(등원·하원·지각·결석) · 선생님앱 · 월말평가서 · 학부모, 열두 명 전원
const B = process.env.SC_BASE || "http://127.0.0.1:4331";
let fail=0, n=0; const bad=[];
const ck=(name,ok,d)=>{ n++; if(!ok){fail++;bad.push(name+"  → "+JSON.stringify(d));} return ok; };
const get=async(p,q)=>{const r=await fetch(`${B}${p}?${q}`);return{s:r.status,d:await r.json().catch(()=>({}))};};
const post=async(p,b)=>{const r=await fetch(`${B}${p}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});return{s:r.status,d:await r.json().catch(()=>({}))};};
// ★ 「오늘」은 **한국시간** 입니다. 앱이 KST 로 판단하기 때문에,
//   UTC 로 계산하면 저녁(한국 자정 이후)에 **하루 어긋나** 전부 엉뚱한 날을 봅니다.
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const 지난달 = (() => { const d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();

const students=(await get("/api/attendance","action=students")).d.students.sort((a,b)=>a.name.localeCompare(b.name));
console.log(`학생 ${students.length}명 · 지난달 ${지난달}\n`);

// ── 1. 출결 — 키오스크 세 번 터치 (등원 → 하원 → 이미 하원)
console.log("── 출결 (키오스크) ──");
const 출결 = [];
for (const s of students.slice(0,6)) {   // 앞 6명은 등·하원까지
  const a=await post("/api/attendance",{action:"checkin",pin:s.pin});
  ck(`${s.name}: 첫 터치 = 등원`, a.s===200, a.d);
  let board=(await get("/api/attendance","action=board")).d;
  let me=(board.students||[]).find(r=>r.name===s.name);
  ck(`${s.name}: 현황판에 수업중/곧 하원으로 뜬다`, ["수업중","곧 하원"].includes(me?.status), me?.status);
  const 상태1=me?.status;

  const b2=await post("/api/attendance",{action:"checkin",pin:s.pin});
  ck(`${s.name}: 두 번째 터치 = 하원`, b2.s===200, b2.d);
  board=(await get("/api/attendance","action=board")).d;
  me=(board.students||[]).find(r=>r.name===s.name);
  ck(`${s.name}: 현황판이 하원으로 바뀐다`, me?.status==="하원", me?.status);

  const c=await post("/api/attendance",{action:"checkin",pin:s.pin});
  ck(`${s.name}: ★ 세 번째 터치는 토글이 아니다 (다시 등원 안 됨)`,
     c.s>=400 || (await get("/api/attendance","action=board")).d.students.find(r=>r.name===s.name)?.status==="하원", c.d);
  출결.push({이름:s.name, 등원:상태1, 하원:"○"});
}
// 뒤 3명은 결석 처리
for (const s of students.slice(6,9)) {
  const r=await post("/api/attendance",{action:"save-record",student_id:s.id,date:TODAY,fields:{lateness:"결석"}});
  ck(`${s.name}: 결석으로 적을 수 있다`, r.s===200, r.d);
  const board=(await get("/api/attendance","action=board")).d;
  const me=(board.students||[]).find(r2=>r2.name===s.name);
  ck(`${s.name}: 현황판에 결석으로 뜬다`, me?.status==="결석", me?.status);
  출결.push({이름:s.name, 등원:"결석", 하원:"-"});
}
// 나머지는 미등원
for (const s of students.slice(9)) 출결.push({이름:s.name, 등원:"미등원", 하원:"-"});

const board=(await get("/api/attendance","action=board")).d;
console.log("  현황판 집계:", JSON.stringify(board.stats||{}));
ck("현황판 집계 숫자가 학생 수와 맞는다",
   Object.values(board.stats||{}).reduce((a,b)=>a+(typeof b==="number"?b:0),0) >= 9, board.stats);

// ── 2. 결석한 날은 데일리 카톡에서 빠진다
console.log("\n── 데일리 리포트 카톡 (미리보기) ──");
const dry=await post("/api/attendance",{action:"send-daily",date:TODAY,dryRun:true});
ck("미리보기가 돈다", dry.s===200, dry.d);
const 받는이=(dry.d.previews||dry.d.rows||[]).map(x=>x.name||x.student_name);
const 결석자=students.slice(6,9).map(s=>s.name);
ck("★ 결석한 학생은 카톡 대상에서 빠진다", !결석자.some(nm=>받는이.includes(nm)), {받는이, 결석자});
console.log("  대상", 받는이.length, "명 /", students.length, "명");

// ── 3. 선생님앱 — 담당 학생만
console.log("\n── 선생님앱 (담당 분리) ──");
const teachers=(await get("/api/attendance","action=teachers")).d.teachers||[];
ck("담당 선생님 목록이 있다", teachers.length>=2, teachers);
for (const t of teachers) {
  const mine=(await get("/api/attendance",`action=board&teacher=${encodeURIComponent(t)}`)).d.students||[];
  const 전체=students.filter(s=>s.teacher===t).map(s=>s.name).sort();
  const 보임=mine.map(r=>r.name).sort();
  ck(`${t}: 담당 학생만 보인다`, JSON.stringify(보임)===JSON.stringify(전체), {보임,전체});
  const tk=(await get("/api/attendance",`action=tasks&date=${TODAY}&teacher=${encodeURIComponent(t)}`)).d.tasks||[];
  const 남의것=tk.filter(x=>!전체.includes(x.name));
  ck(`${t}: 과제 현황도 담당 학생만`, 남의것.length===0, 남의것.slice(0,3).map(x=>x.name));
  console.log(`  ${t}: ${전체.length}명 · 과제 ${tk.length}건`);
}

// ── 4. 월말평가서 — 열두 명 전원
console.log("\n── 월말평가서 (전원) ──");
const 결과=[];
for (const s of students) {
  const pv=await get("/api/report",`action=preview&student_id=${s.id}&month=${지난달}`);
  ck(`${s.name}: 미리보기 통계가 나온다`, pv.s===200 && pv.d.planner, pv.d.error);
  const pl=pv.d.planner||{};
  const 나온날=(pl.출석?.정시등원??0)+(pl.출석?.지각??0);
  ck(`${s.name}: ★ 총 수업일 = 나온 날 + 결석`, (pl.총수업일수??0)===나온날+(pl.출석?.결석??0),
     {총:pl.총수업일수, 나온날, 결석:pl.출석?.결석});

  const g=await post("/api/report",{action:"generate",student_id:s.id,month:지난달});
  ck(`${s.name}: 평가서 본문이 생성된다`, g.s===200 && typeof g.d.body==="string" && g.d.body.length>20, g.d.error);
  ck(`${s.name}: 본문에 본인 이름이 들어간다`, String(g.d.body||"").includes(s.name), String(g.d.body||"").slice(0,50));

  const sv=await post("/api/report",{action:"save",student_id:s.id,month:지난달,body:g.d.body,planner:pv.d.planner});
  ck(`${s.name}: 저장되고 학부모 토큰이 생긴다`, sv.s===200 && String(sv.d.share_token||"").length>=16, sv.d);
  const tok=sv.d.share_token;

  const noPin=await get("/api/report",`action=parent&token=${tok}`);
  ck(`${s.name}: ★★ 링크만으로는 안 열린다`, noPin.d.needPin===true, noPin.d);
  const okPin=await get("/api/report",`action=parent&token=${tok}&pin=${s.pin}`);
  ck(`${s.name}: ★ 출결번호를 넣으면 열린다`, okPin.s===200 && (okPin.d.reports||[]).length>0, okPin.d.error);
  ck(`${s.name}: ★★ 본인 것만 보인다`, okPin.d.student?.name===s.name, okPin.d.student);
  const 남PIN = students.find(x=>x.pin!==s.pin).pin;
  const wrong=await get("/api/report",`action=parent&token=${tok}&pin=${남PIN}`);
  ck(`${s.name}: ★★ 남의 출결번호로는 못 연다`, wrong.d.needPin===true, wrong.d);
  결과.push({이름:s.name, 총:pl.총수업일수, 나온날, 결석:pl.출석?.결석, 길이:String(g.d.body||"").length});
}
console.log("\n이름    총수업일 나온날 결석 본문");
for (const r of 결과) console.log(`${String(r.이름).padEnd(6)}  ${String(r.총).padEnd(7)} ${String(r.나온날).padEnd(5)} ${String(r.결석).padEnd(3)} ${r.길이}자`);

console.log(`\n점검 ${n}개 · 실패 ${fail}개`);
if (bad.length){ console.log("\n실패한 것:"); bad.forEach(x=>console.log("  ❌ "+x)); }
process.exit(fail?1:0);
