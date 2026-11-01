// 시나리오 3 — 보안·권한. 여기가 뚫리면 세미나가 아니라 사고입니다.
import { ck, get, post, 시작, 끝, B, TODAY, 지난달 } from "./lib.mjs";
const ss=(await get("/api/attendance","action=students")).d.students;
const A=ss.find(x=>x.name==="김민준"), C=ss.find(x=>x.name==="강서준");

시작("3-1. 학생앱 — 남의 것은 못 본다");
{
  const home=await post("/api/student",{action:"home",code:A.student_code,pin:A.pin});
  ck("내 과제만 온다", (home.d.tasks||[]).every(t=>!t.student_id || t.student_id===A.id), null);
  const body=JSON.stringify(home.d);
  const 남이름=ss.filter(x=>x.id!==A.id).map(x=>x.name);
  ck("★★ 응답에 남의 이름이 안 섞인다", !남이름.some(nm=>body.includes(nm)), 남이름.filter(nm=>body.includes(nm)));
  ck("★★ 응답에 전화번호가 안 실린다", !/01[016789]-?\d{3,4}-?\d{4}/.test(body), (body.match(/01[016789]-?\d{3,4}-?\d{4}/g)||[]).slice(0,2));
}
시작("3-2. 학생앱 — 비밀번호 틀리면 막힌다");
{
  for (const [c,p,why] of [[A.student_code,"0000","번호 틀림"],["없는애",A.pin,"없는 학생ID"],["",""," 빈 값"],[A.student_code,"","PIN 빔"]]) {
    const r=await post("/api/student",{action:"home",code:c,pin:p});
    ck(`${why} → 막힌다`, r.s===401||r.s>=400, {s:r.s,d:r.d});
  }
}
시작("3-3. 학생앱 — 남의 과제는 못 건드린다");
{
  const 남과제=((await get("/api/attendance",`action=tasks&date=${TODAY}`)).d.tasks||[]).find(x=>x.student_id===C.id);
  if (남과제) {
    const r=await post("/api/student",{action:"toggle-task",code:A.student_code,pin:A.pin,task_id:남과제.id,done:true});
    ck("★★ 남의 과제 체크 시도 → 거절", r.s>=400||r.d.error, r.d);
    const after=((await get("/api/attendance",`action=tasks&date=${TODAY}`)).d.tasks||[]).find(x=>x.id===남과제.id);
    ck("★★ 실제로 안 바뀐다", after?.done===남과제.done, {전:남과제.done,후:after?.done});
  }
}
시작("3-4. 학부모 링크 — 토큰만으로는 안 열린다");
{
  const pv=await get("/api/report",`action=preview&student_id=${A.id}&month=${지난달}`);
  const g=await post("/api/report",{action:"generate",student_id:A.id,month:지난달});
  const sv=await post("/api/report",{action:"save",student_id:A.id,month:지난달,body:g.d.body,planner:pv.d.planner});
  const tok=sv.d.share_token;
  ck("토큰이 32자 이상", String(tok).length>=32, String(tok).length);
  ck("★★ 토큰만 → 출결번호를 묻는다", (await get("/api/report",`action=parent&token=${tok}`)).d.needPin===true, null);
  ck("★★ 남의 출결번호 → 안 열린다", (await get("/api/report",`action=parent&token=${tok}&pin=${C.pin}`)).d.needPin===true, null);
  ck("★★ 없는 토큰 → 안 열린다", (await get("/api/report",`action=parent&token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&pin=${A.pin}`)).d.reports?.length!==undefined ? false : true, null);
  const okr=await get("/api/report",`action=parent&token=${tok}&pin=${A.pin}`);
  ck("본인 번호면 열린다", (okr.d.reports||[]).length>0, okr.d.error);
  ck("★★ 열어도 남의 이름은 없다", !ss.filter(x=>x.id!==A.id).map(x=>x.name).some(nm=>JSON.stringify(okr.d).includes(nm)), null);
}
시작("3-5. 담당 선생님 필터를 우회할 수 없다");
{
  const 이=(await get("/api/attendance",`action=board&teacher=${encodeURIComponent("이선생")}`)).d.students||[];
  const 박학생=ss.filter(x=>x.teacher==="박선생").map(x=>x.name);
  ck("★★ 이선생 화면에 박선생 학생이 없다", !이.some(r=>박학생.includes(r.name)), 이.filter(r=>박학생.includes(r.name)).map(r=>r.name));
  const 없는=(await get("/api/attendance",`action=board&teacher=${encodeURIComponent("없는선생")}`)).d.students||[];
  ck("없는 선생님으로 조회하면 비어 있다", 없는.length===0, 없는.length);
}
시작("3-6. 비밀값이 화면으로 새지 않는다");
{
  for (const p of ["/","/daily.html","/student.html","/parent.html","/teacher.html","/report.html","/books.html","/board.html"]) {
    const html=await (await fetch(B+p)).text();
    ck(`${p} 에 service_role 키가 없다`, !/service_role|eyJhbGciOiJIUzI1NiIs/.test(html), null);
    ck(`${p} 에 ANTHROPIC 키가 없다`, !/sk-ant-/.test(html), null);
  }
}
끝();
