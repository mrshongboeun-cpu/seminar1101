// 시나리오 2 — 과제. 자동/수기가 섞였을 때가 제일 위험합니다.
import { ck, get, post, 시작, 끝, TODAY } from "./lib.mjs";
const 치울것={학생:[],교재:[]};
const 교재=async(name,units)=> (await post("/api/attendance",{action:"save-textbook",textbook:{name,subject:"문법",units,step:1}})).d.textbook;
const 학생=async(name,books)=> (await post("/api/attendance",{action:"save-student",student:{name,student_code:name,pin:String(2000+Math.floor(Math.random()*7999)),
  teacher:"검수선생",schedule:{월:"10:00",화:"10:00",수:"10:00",목:"10:00",금:"10:00",토:"10:00",일:"10:00"},books}})).d.student;
const 내과제=async(sid)=> ((await get("/api/attendance",`action=tasks&date=${TODAY}`)).d.tasks||[]).filter(x=>x.student_id===sid);
const 진도=(sid,p)=>post("/api/attendance",{action:"save-record",student_id:sid,date:TODAY,fields:{progress:p}});

const UNITS=[
  {code:"U1",title:"1과",집과제:["워크북 U1","단어 30개"],학원과제:"본문 2회"},
  {code:"U2",title:"2과",집과제:["워크북 U2"]},
  {code:"U3",title:"3과",학원과제:"받아쓰기"},
  {code:"U4",title:"4과"},
];

시작("2-1. 유닛마다 다른 과제가 그대로 나온다");
const t=await 교재("검수_과제교재",UNITS); 치울것.교재.push(t.id);
const s=await 학생("검수_과제학생",{문법:"검수_과제교재"}); 치울것.학생.push(s.id);
await post("/api/attendance",{action:"add-row",student_id:s.id,date:TODAY});
{
  await 진도(s.id,{문법:{code:"U1",title:"1과"}});
  const a=(await 내과제(s.id)).filter(x=>x.auto);
  ck("U1 → 집 2개 + 학원 1개", a.length===3, a.map(x=>`${x.kind}:${x.title}`));
  ck("집과제가 쉼표대로 쪼개진다", a.filter(x=>x.kind==="집").length===2, a.filter(x=>x.kind==="집").map(x=>x.title));
}
시작("2-2. 집과제만 적은 유닛");
{
  await 진도(s.id,{문법:{code:"U2",title:"2과"}});
  const a=(await 내과제(s.id)).filter(x=>x.auto);
  ck("U2 → 집 1개만, 학원 없음", a.length===1 && a[0].kind==="집", a.map(x=>`${x.kind}:${x.title}`));
}
시작("2-3. 학원과제만 적은 유닛");
{
  await 진도(s.id,{문법:{code:"U3",title:"3과"}});
  const a=(await 내과제(s.id)).filter(x=>x.auto);
  ck("U3 → 학원 1개만", a.length===1 && a[0].kind==="학원", a.map(x=>`${x.kind}:${x.title}`));
}
시작("2-4. 과제를 안 적은 유닛은 아무 일도 없다");
{
  await 진도(s.id,{문법:{code:"U4",title:"4과"}});
  const a=(await 내과제(s.id)).filter(x=>x.auto);
  ck("★ U4 → 자동 과제 0개", a.length===0, a.map(x=>x.title));
}
시작("2-5. 손으로 낸 과제는 진도를 아무리 바꿔도 안 지워진다");
{
  await post("/api/attendance",{action:"save-tasks",date:TODAY,student_ids:[s.id],
    items:[{kind:"집",subject:"문법",title:"선생님이 직접 낸 것"}]});
  for (const u of ["U1","U2","U3","U4","U1"]) await 진도(s.id,{문법:{code:u,title:""}});
  const all=await 내과제(s.id);
  ck("★★ 진도를 다섯 번 바꿔도 수기 과제가 살아 있다", all.some(x=>x.title==="선생님이 직접 낸 것"), all.map(x=>x.title));
  ck("수기 과제는 auto=false", all.find(x=>x.title==="선생님이 직접 낸 것")?.auto===false, null);
}
시작("2-6. 같은 진도를 여러 번 저장해도 과제가 불어나지 않는다");
{
  for (let i=0;i<4;i++) await 진도(s.id,{문법:{code:"U1",title:"1과"}});
  const a=(await 내과제(s.id)).filter(x=>x.auto);
  ck("★ 네 번 저장해도 자동 과제는 3개 그대로", a.length===3, a.length);
}
시작("2-7. 학생이 체크한 것은 진도를 바꿔도 사라지지 않아야 한다");
{
  await 진도(s.id,{문법:{code:"U1",title:"1과"}});
  const 수기=(await 내과제(s.id)).find(x=>!x.auto);
  await post("/api/student",{action:"toggle-task",code:s.student_code,pin:s.pin,task_id:수기.id,done:true});
  await 진도(s.id,{문법:{code:"U2",title:"2과"}});
  const after=(await 내과제(s.id)).find(x=>x.id===수기.id);
  ck("★ 체크해 둔 수기 과제가 체크된 채로 남는다", after?.done===true, after);
}
시작("2-8. 과제 삭제");
{
  const one=(await 내과제(s.id))[0];
  const d=await post("/api/attendance",{action:"delete-task",id:one.id});
  ck("과제를 지울 수 있다", d.s===200, d.d);
  ck("지운 과제는 목록에 없다", !(await 내과제(s.id)).some(x=>x.id===one.id), null);
}
시작("2-9. 치우기");
{
  let ok=0;
  for(const id of 치울것.학생) if((await post("/api/attendance",{action:"delete-student",id})).s===200) ok++;
  for(const id of 치울것.교재) if((await post("/api/attendance",{action:"delete-textbook",id})).s===200) ok++;
  ck("치워진다", ok===치울것.학생.length+치울것.교재.length, ok);
}
끝();
