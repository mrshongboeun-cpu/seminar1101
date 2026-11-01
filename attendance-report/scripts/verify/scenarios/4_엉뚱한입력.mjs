// 시나리오 4 — 수강생이 실제로 저지르는 실수. 500(내부 에러)이 뜨면 안 됩니다.
import { ck, get, post, 시작, 끝, TODAY } from "./lib.mjs";
const ss=(await get("/api/attendance","action=students")).d.students;
const A=ss[0];
const 치울것={학생:[],교재:[]};
const 사람말 = (d) => typeof d?.error==="string" && !/ at |undefined|PGRST|\{"code"/.test(d.error);

시작("4-1. 날짜를 이상하게 넣었을 때");
for (const bad of ["2026-13-01","어제","2026/10/28","","20261028","2026-10-99"]) {
  const r=await get("/api/attendance",`action=daily-rows&date=${encodeURIComponent(bad)}`);
  ck(`날짜 "${bad}" → 500 이 아니다`, r.s!==500, {s:r.s,e:r.d.error});
  if (r.s>=400) ck(`날짜 "${bad}" → 사람 말로 안내`, 사람말(r.d), r.d.error);
}
시작("4-2. 없는 학생/교재 id");
{
  for (const [act,body] of [
    ["save-record",{student_id:"없는아이디",date:TODAY,fields:{attitude:"상"}}],
    ["add-row",{student_id:"00000000-0000-0000-0000-000000000000",date:TODAY}],
    ["delete-student",{id:"없는아이디"}],
    ["delete-task",{id:"없는아이디"}],
  ]) {
    const r=await post("/api/attendance",{action:act,...body});
    ck(`${act} + 없는 id → 500 이 아니다`, r.s!==500, {s:r.s,e:r.d.error});
  }
}
시작("4-3. 빈 요청 · 모르는 action");
{
  const r1=await post("/api/attendance",{});
  ck("action 없음 → 400 과 안내", r1.s>=400 && 사람말(r1.d), r1.d);
  const r2=await post("/api/attendance",{action:"없는기능"});
  ck("모르는 action → 400 과 안내", r2.s>=400 && 사람말(r2.d), r2.d);
  const r3=await post("/api/student",{});
  ck("학생앱 빈 요청 → 401", r3.s===401, r3.d);
}
시작("4-4. 이름·교재에 특수문자·따옴표가 들어갈 때");
{
  const 괴상한 = `오'마리아 "A" & <b>태그</b> 100%`;
  const st=await post("/api/attendance",{action:"save-student",student:{
    name:괴상한, student_code:"검수_특수", pin:"4321", teacher:"검수선생",
    schedule:{수:"10:00",월:"10:00",화:"10:00",목:"10:00",금:"10:00",토:"10:00",일:"10:00"}, books:{문법:"검수'교재"}}});
  ck("특수문자 이름으로 저장된다", st.s===200 && st.d.student?.id, st.d);
  if (st.d.student) {
    치울것.학생.push(st.d.student.id);
    const list=(await get("/api/attendance","action=students")).d.students;
    ck("★ 목록에서 그 이름이 그대로 보인다", list.some(x=>x.name===괴상한), null);
    const tb=await post("/api/attendance",{action:"save-textbook",textbook:{name:"검수'교재",subject:"문법",units:[{code:"U1",title:`1과 "특수" & <i>`}],step:1}});
    ck("따옴표 들어간 교재명도 저장된다", tb.s===200, tb.d);
    if (tb.d.textbook) 치울것.교재.push(tb.d.textbook.id);
    const row=await post("/api/attendance",{action:"add-row",student_id:st.d.student.id,date:TODAY});
    ck("★ 따옴표 교재명으로도 진도가 붙는다", row.d.record?.progress?.문법?.code==="U1", row.d.record?.progress);
  }
}
시작("4-5. 아주 긴 입력");
{
  const 긴=("가".repeat(3000));
  const r=await post("/api/attendance",{action:"save-record",student_id:A.id,date:TODAY,fields:{note:긴}});
  ck("긴 메모 → 500 이 아니다", r.s!==500, {s:r.s,e:r.d.error});
}
시작("4-6. 키오스크 PIN");
{
  for (const [pin,why] of [["0000","없는 번호"],["","빈 값"],["abcd","글자"],["99999999","너무 긴 번호"]]) {
    const r=await post("/api/attendance",{action:"checkin",pin});
    ck(`PIN "${pin}" (${why}) → 500 이 아니고 안내가 뜬다`, r.s!==500 && (r.s<400 || 사람말(r.d)), {s:r.s,e:r.d.error});
  }
}
시작("4-7. 월말평가서 — 기록이 없는 달");
{
  const pv=await get("/api/report",`action=preview&student_id=${A.id}&month=2020-01`);
  ck("기록 없는 달도 500 이 아니다", pv.s!==500, {s:pv.s,e:pv.d.error});
  ck("★ 0 으로 채워져 온다 (화면이 안 깨짐)", pv.s!==200 || pv.d.planner, Object.keys(pv.d||{}));
  const bad=await get("/api/report",`action=preview&student_id=${A.id}&month=이상한달`);
  ck("이상한 월 → 500 이 아니다", bad.s!==500, {s:bad.s,e:bad.d.error});
}
시작("4-8. 치우기");
{
  let ok=0;
  for(const id of 치울것.학생) if((await post("/api/attendance",{action:"delete-student",id})).s===200) ok++;
  for(const id of 치울것.교재) if((await post("/api/attendance",{action:"delete-textbook",id})).s===200) ok++;
  ck("치워진다", ok===치울것.학생.length+치울것.교재.length, ok);
}
끝();
