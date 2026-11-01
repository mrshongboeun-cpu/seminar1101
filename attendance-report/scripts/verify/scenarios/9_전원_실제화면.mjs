// 4부 — 실제 화면. 상태가 다른 학생 넷을 골라 눈으로 보이는 것까지 확인합니다.
import { chromium } from "playwright";
const B = process.env.SC_BASE || "http://127.0.0.1:4331";
const OUT = process.env.SC_SHOTS || "/tmp/verify-shots";
let fail=0,n=0; const bad=[]; const errs=[];
const ck=(name,ok,d)=>{n++; if(!ok){fail++;bad.push(name+"  → "+JSON.stringify(d));} return ok;};

const stu=await (await fetch(`${B}/api/attendance?action=students`)).json();
const byName=Object.fromEntries(stu.students.map(s=>[s.name,s]));
const board=await (await fetch(`${B}/api/attendance?action=board`)).json();
const 상태=Object.fromEntries(board.students.map(s=>[s.name,s.status]));
console.log("현황판 상태:", JSON.stringify(상태));

const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const ctx=await b.newContext();
const pg=await ctx.newPage({viewport:{width:1280,height:1000}});
pg.on("pageerror",e=>errs.push("JS: "+e.message));
pg.on("response",r=>{ if(r.status()>=400 && !r.url().endsWith("favicon.ico")) errs.push(r.status()+" "+r.url()); });

// ── 현황판에 상태가 섞여 보이나
await pg.goto(B+"/board.html",{waitUntil:"networkidle"}); await pg.waitForTimeout(2000);
const bodyTxt=await pg.textContent("body");
for (const st of ["하원","결석","미등원"]) ck(`현황판에 「${st}」 가 보인다`, bodyTxt.includes(st), null);
await pg.screenshot({path:OUT+"/F1_현황판.png", animations:"disabled"});

// ── 데일리 리포트: 결석 학생과 등원 학생이 같이 보이나
await pg.goto(B+"/daily.html",{waitUntil:"networkidle"}); await pg.waitForTimeout(2500);
const d=await pg.textContent("body");
ck("데일리에 열두 명이 다 보인다", stu.students.every(s=>d.includes(s.name)), stu.students.filter(s=>!d.includes(s.name)).map(s=>s.name));
await pg.screenshot({path:OUT+"/F2_데일리.png", animations:"disabled"});

// ── 선생님앱: 두 선생님 각각
for (const t of ["이선생","박선생"]) {
  await pg.goto(B+"/teacher.html",{waitUntil:"networkidle"}); await pg.waitForTimeout(1200);
  await pg.locator("select").first().selectOption({label:t}).catch(()=>{});
  await pg.waitForTimeout(2000);
  const txt=await pg.textContent("body");
  const 내담당=stu.students.filter(s=>s.teacher===t).map(s=>s.name);
  const 남=stu.students.filter(s=>s.teacher!==t).map(s=>s.name);
  ck(`${t} 화면에 담당 학생이 다 보인다`, 내담당.every(nm=>txt.includes(nm)), 내담당.filter(nm=>!txt.includes(nm)));
  ck(`★★ ${t} 화면에 남의 담당이 안 보인다`, !남.some(nm=>txt.includes(nm)), 남.filter(nm=>txt.includes(nm)));
  ck(`${t} 화면에 「자동」 배지가 보인다`, (await pg.locator("span.tag.auto").count())>0, null);
  await pg.screenshot({path:OUT+`/F3_선생님앱_${t}.png`, animations:"disabled"});
}

// ── 학생앱: 상태가 다른 네 명
const 고를이=["김민준","윤아린","박도윤","정하윤"];   // 등원 / 결석 / 보강 / 결석
for (const nm of 고를이) {
  const s=byName[nm]; if(!s) continue;
  // 학생앱은 **그 기기에 로그인을 기억**합니다(설계). 그래서 학생마다 새 창으로 엽니다 —
  //   한 창에서 이어 하면 앞 학생이 그대로 떠 있어 다음 학생이 로그인 칸을 못 봅니다.
  const sctx=await b.newContext({viewport:{width:414,height:896}});
  const ph=await sctx.newPage();
  ph.on("pageerror",e=>errs.push(`JS(${nm}): `+e.message));
  await ph.goto(B+"/student.html",{waitUntil:"networkidle"});
  await ph.fill("#code",s.student_code); await ph.fill("#pin",s.pin); await ph.keyboard.press("Enter");
  await ph.waitForTimeout(2200);
  ck(`${nm}: 학생앱 로그인`, await ph.locator("#home").isVisible(), await ph.textContent("#err"));
  const who=await ph.textContent("#who");
  ck(`${nm}: ★★ 본인 이름이 뜬다`, (who||"").includes(nm), who);
  const 과제수=await ph.locator(".task").count();
  ck(`${nm}: 오늘 과제가 보인다`, 과제수>0, 과제수);
  // 체크 → 선생님 화면 반영
  const 안한=ph.locator(".task:not(.done)").first();
  if (await 안한.count()) {
    // 제목이 겹칠 수 있어(자동 집과제 "단어 30개" 가 과목마다 생김) **id** 로 맞춥니다.
    const onclick=(await 안한.getAttribute("onclick"))||"";
    const 아이디=(onclick.match(/'([0-9a-f-]{36})'/)||[])[1];
    const 제목=((await 안한.locator(".title").textContent())||"").trim();
    await 안한.click(); await ph.waitForTimeout(1200);
    const t=await (await fetch(`${B}/api/attendance?action=tasks&date=${new Date(Date.now()+9*3600*1000).toISOString().slice(0,10)}`)).json();
    const 그것=(t.tasks||[]).find(x=>x.id===아이디);
    ck(`${nm}: ★ 체크가 선생님 화면에 반영된다`, 그것?.done===true, {제목, 아이디, 그것});
  }
  const bodyT=await ph.textContent("body");
  ck(`${nm}: ★★ 남의 이름이 안 보인다`, !stu.students.filter(x=>x.name!==nm).some(x=>bodyT.includes(x.name)), null);
  ck(`${nm}: 날짜에 ISO 가 안 샌다`, !/T\d\d:\d\d/.test(bodyT), null);
  await ph.screenshot({path:OUT+`/F4_학생앱_${nm}.png`, fullPage:true, animations:"disabled"});
  await ph.close(); await sctx.close();
}

// ── 키오스크
await pg.goto(B+"/kiosk.html",{waitUntil:"networkidle"}); await pg.waitForTimeout(1200);
ck("키오스크가 열린다", (await pg.textContent("body")).length>50, null);
await pg.screenshot({path:OUT+"/F5_키오스크.png", animations:"disabled"});

await ctx.close(); await b.close();
console.log(`\n점검 ${n}개 · 실패 ${fail}개`);
if(bad.length){console.log("실패:");bad.forEach(x=>console.log("  ❌ "+x));}
console.log("브라우저 오류:", errs.length?errs.slice(0,5):"없음");
process.exit(fail||errs.length?1:0);
