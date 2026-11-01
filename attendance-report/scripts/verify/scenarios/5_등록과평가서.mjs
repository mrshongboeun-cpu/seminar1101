// 시나리오 5 — 출결 경계값 · 일괄등록 · 평가서 재생성/덮어쓰기
import { ck, get, post, 시작, 끝, TODAY, 지난달 } from "./lib.mjs";
const 치울것={학생:[]};

시작("5-1. 붙여넣기 일괄등록 — 빠진 칸이 있어도 넘어간다");
{
  const rows=[
    {name:"검수_일괄A", student_code:"일괄A", pin:"7001", schedule:{수:"10:00"}, books:{문법:"없는교재"}},
    {name:"검수_일괄B", student_code:"일괄B", pin:"7002"},               // 요일·교재 없음
    {name:"검수_일괄C"},                                                  // 학생ID·PIN 없음
    {name:"", student_code:"일괄D", pin:"7004"},                          // 이름 없음 → 걸러져야
  ];
  const r=await post("/api/attendance",{action:"bulk-students",rows});
  ck("일괄등록이 돈다", r.s===200, r.d);
  const list=(await get("/api/attendance","action=students")).d.students;
  const 들어간=list.filter(x=>x.name?.startsWith("검수_일괄"));
  들어간.forEach(x=>치울것.학생.push(x.id));
  ck("★ 이름 없는 줄은 안 들어간다", 들어간.length===3, 들어간.map(x=>x.name));
  ck("요일이 없어도 등록은 된다", 들어간.some(x=>x.name==="검수_일괄B"), null);
  const C=들어간.find(x=>x.name==="검수_일괄C");
  ck("★ 학생ID·PIN 이 비면 학생앱에 못 들어간다 (자료에 적힌 대로)",
     !C?.student_code || !C?.pin, {code:C?.student_code,pin:C?.pin});
}

시작("5-2. 같은 PIN 을 두 명에게 주면");
{
  const a=await post("/api/attendance",{action:"save-student",student:{name:"검수_중복1",student_code:"중복1",pin:"7777",schedule:{수:"10:00"}}});
  const b=await post("/api/attendance",{action:"save-student",student:{name:"검수_중복2",student_code:"중복2",pin:"7777",schedule:{수:"10:00"}}});
  if(a.d.student) 치울것.학생.push(a.d.student.id);
  if(b.d.student) 치울것.학생.push(b.d.student.id);
  ck("둘 다 500 으로 터지지 않는다", a.s!==500 && b.s!==500, {a:a.s,b:b.s});
  const k=await post("/api/attendance",{action:"checkin",pin:"7777"});
  ck("★ 같은 PIN 으로 키오스크를 눌러도 안 터진다", k.s!==500, {s:k.s,e:k.d.error});
  console.log("     (PIN 이 겹치면 먼저 찾힌 학생이 등원됩니다 — 겹치지 않게 넣어야 합니다)");
}

시작("5-3. 퇴원 학생");
{
  const r=await post("/api/attendance",{action:"save-student",student:{name:"검수_퇴원",student_code:"퇴원",pin:"7009",status:"퇴원",schedule:{수:"10:00"}}});
  const id=r.d.student?.id; if(id) 치울것.학생.push(id);
  const list=(await get("/api/attendance","action=students")).d.students;
  // 학생관리 화면은 퇴원도 보여줘야 합니다(복원·수정해야 하니까) — 일부러 전부 옵니다.
  ck("학생관리 명단에는 퇴원도 보인다 (복원하려면 보여야 함)", list.some(x=>x.name==="검수_퇴원"), null);
  ck("★ 퇴원 표시가 붙는다", list.find(x=>x.name==="검수_퇴원")?.status==="퇴원", list.find(x=>x.name==="검수_퇴원")?.status);
  const lg=await post("/api/student",{action:"login",code:"퇴원",pin:"7009"});
  ck("★★ 퇴원 학생은 학생앱에 못 들어간다", lg.s===401, lg.d);
  const rows=(await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows||[];
  ck("★ 퇴원 학생은 데일리에도 안 뜬다", !rows.some(x=>x.name==="검수_퇴원"), null);
}

시작("5-4. 현황판 하원은 카톡을 안 보낸다 (키오스크만 보냄)");
{
  const ss=(await get("/api/attendance","action=students")).d.students;
  const one=ss.find(x=>x.name==="이서연");
  const r=await post("/api/attendance",{action:"checkout",student_id:one.id});
  ck("현황판 하원이 된다", r.s===200 && r.d.record?.check_out, r.d);
  console.log("     (발송 여부는 코드 주석과 solapi 미설정으로 확인 — 여기선 터지지 않는지만)");
}

시작("5-5. 평가서를 두 번 만들면 덮어써진다 (두 줄로 안 생긴다)");
{
  const ss=(await get("/api/attendance","action=students")).d.students;
  const one=ss.find(x=>x.name==="박도윤");
  const pv=await get("/api/report",`action=preview&student_id=${one.id}&month=${지난달}`);
  for (let i=0;i<2;i++){
    const g=await post("/api/report",{action:"generate",student_id:one.id,month:지난달});
    await post("/api/report",{action:"save",student_id:one.id,month:지난달,body:g.d.body+` (${i}회차)`,planner:pv.d.planner});
  }
  const sr=await get("/api/report",`action=student-reports&student_id=${one.id}`);
  const 그달=(sr.d.reports||[]).filter(x=>x.month===지난달);
  ck("★ 같은 달 평가서가 한 줄만 남는다", 그달.length===1, 그달.length);
  // 목록(student-reports)은 본문을 안 싣습니다 — 본문은 action=get 으로 읽습니다.
  const got=await get("/api/report",`action=get&student_id=${one.id}&month=${지난달}`);
  ck("★ 나중에 저장한 내용으로 바뀐다", String(got.d.report?.body||"").includes("(1회차)"), String(got.d.report?.body||"").slice(-30));
}

시작("5-6. 중학생 체크하면 프롬프트가 달라진다");
{
  const ss=(await get("/api/attendance","action=students")).d.students;
  const 중=ss.find(x=>String(x.grade||"").startsWith("중"));
  const a=await post("/api/report",{action:"generate",student_id:중.id,month:지난달});
  const b=await post("/api/report",{action:"generate",student_id:중.id,month:지난달,middleSchool:true});
  ck("중학생 체크해도 생성된다", b.s===200 && b.d.body, b.d.error);
  ck("둘 다 본인 이름이 들어간다", String(a.d.body||"").includes(중.name) && String(b.d.body||"").includes(중.name), null);
}

시작("5-7. 치우기");
{
  let ok=0;
  for(const id of 치울것.학생) if((await post("/api/attendance",{action:"delete-student",id})).s===200) ok++;
  ck("치워진다", ok===치울것.학생.length, `${ok}/${치울것.학생.length}`);
}
끝();
