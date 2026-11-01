// 시나리오 1 — 진도 자동 전환. 운영에서 제일 자주 깨지는 자리.
import { ck, get, post, 시작, 끝, TODAY } from "./lib.mjs";

// 「어제」도 KST 기준 — TODAY 와 같은 시계를 써야 하루가 안 어긋납니다.
const 어제 = (n=1)=>{const d=new Date(Date.now()+9*3600*1000);d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);};
const 교재 = async (name, units, step=1) =>
  (await post("/api/attendance", { action:"save-textbook", textbook:{ name, subject:"문법", units, step } })).d.textbook;
const 학생 = async (name, books) =>
  (await post("/api/attendance", { action:"save-student", student:{ name, student_code:name, pin:String(1000+Math.floor(Math.random()*8999)),
    teacher:"검수선생", schedule:{월:"10:00",화:"10:00",수:"10:00",목:"10:00",금:"10:00",토:"10:00",일:"10:00"}, books } })).d.student;
const 행 = async (sid, date) => {
  const r = await get("/api/attendance", `action=daily-rows&date=${date}`);
  return (r.d.rows||[]).find(x=>x.student_id===sid);
};
const 진도적기 = (sid, date, p) => post("/api/attendance", { action:"save-record", student_id:sid, date, fields:{ progress:p } });
const 치울것 = { 학생:[], 교재:[] };

const U = (n) => Array.from({length:n},(_,i)=>({ code:`U${i+1}`, title:`${i+1}과` }));

시작("1-1. 첫 수업이면 목차 1번부터");
{
  const t = await 교재("검수_기본", U(5));           치울것.교재.push(t.id);
  const s = await 학생("검수_첫수업", {문법:"검수_기본"}); 치울것.학생.push(s.id);
  const r = await 행(s.id, TODAY);
  ck("첫 수업은 목차 1번", r?.record?.progress?.문법?.code === "U1", r?.record?.progress);
  ck("제목도 같이 붙는다", r?.record?.progress?.문법?.title === "1과", r?.record?.progress?.문법);
}

시작("1-2. 다음 수업이면 한 칸 다음");
{
  const t = await 교재("검수_한칸", U(5));            치울것.교재.push(t.id);
  const s = await 학생("검수_한칸학생", {문법:"검수_한칸"}); 치울것.학생.push(s.id);
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:어제(1) });
  await 진도적기(s.id, 어제(1), { 문법:{code:"U2",title:"2과"} });
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:TODAY });
  const r = await 행(s.id, TODAY);
  ck("어제 U2 → 오늘 U3", r?.record?.progress?.문법?.code === "U3", r?.record?.progress?.문법);
}

시작("1-3. 하루 진도 2면 두 칸");
{
  const t = await 교재("검수_두칸", U(8), 2);          치울것.교재.push(t.id);
  const s = await 학생("검수_두칸학생", {문법:"검수_두칸"}); 치울것.학생.push(s.id);
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:어제(1) });
  await 진도적기(s.id, 어제(1), { 문법:{code:"U2",title:"2과"} });
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:TODAY });
  const r = await 행(s.id, TODAY);
  ck("★ 어제 U2 → 오늘 U4 (두 칸)", r?.record?.progress?.문법?.code === "U4", r?.record?.progress?.문법);
}

시작("1-4. 목차 끝에 닿으면 마지막에서 멈춘다");
{
  const t = await 교재("검수_끝", U(3));              치울것.교재.push(t.id);
  const s = await 학생("검수_끝학생", {문법:"검수_끝"});  치울것.학생.push(s.id);
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:어제(1) });
  await 진도적기(s.id, 어제(1), { 문법:{code:"U3",title:"3과"} });
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:TODAY });
  const r = await 행(s.id, TODAY);
  ck("★ 끝에서 멈춘다 (없는 유닛을 지어내지 않는다)", r?.record?.progress?.문법?.code === "U3", r?.record?.progress?.문법);
}

시작("1-5. 목차에 없는 진도(손으로 쓴 것)는 그대로 둔다");
{
  const t = await 교재("검수_수기", U(5));            치울것.교재.push(t.id);
  const s = await 학생("검수_수기학생", {문법:"검수_수기"}); 치울것.학생.push(s.id);
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:어제(1) });
  await 진도적기(s.id, 어제(1), { 문법:{code:"특강 3회차",title:""} });
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:TODAY });
  const r = await 행(s.id, TODAY);
  ck("★★ 손으로 쓴 진도를 덮어쓰지 않는다", r?.record?.progress?.문법?.code === "특강 3회차", r?.record?.progress?.문법);
}

시작("1-6. 교재에 목차가 없으면 전날 값 그대로");
{
  const t = await 교재("검수_목차없음", []);           치울것.교재.push(t.id);
  const s = await 학생("검수_목차없음학생", {문법:"검수_목차없음"}); 치울것.학생.push(s.id);
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:어제(1) });
  await 진도적기(s.id, 어제(1), { 문법:{code:"아무거나",title:""} });
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:TODAY });
  const r = await 행(s.id, TODAY);
  ck("전날 값이 그대로 온다", r?.record?.progress?.문법?.code === "아무거나", r?.record?.progress?.문법);
}

시작("1-7. 교재명이 한 글자라도 다르면 연결이 안 된다");
{
  const t = await 교재("검수_띄어쓰기", U(5));          치울것.교재.push(t.id);
  const s = await 학생("검수_띄어쓰기학생", {문법:"검수_띄어 쓰기"}); 치울것.학생.push(s.id);  // 공백 하나 다름
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:TODAY });
  const r = await 행(s.id, TODAY);
  const p = r?.record?.progress?.문법;
  ck("★ 교재명이 다르면 진도가 안 채워진다 (틀린 교재로 나가지 않는다)", !p?.code, p);
}

시작("1-8. 복습 줄도 한 칸으로 센다");
{
  const t = await 교재("검수_복습", [
    {code:"U1",title:"1과"},{code:"U2",title:"2과"},
    {code:"복습",title:"U1~U2 다시"},{code:"U3",title:"3과"}]);  치울것.교재.push(t.id);
  const s = await 학생("검수_복습학생", {문법:"검수_복습"});        치울것.학생.push(s.id);
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:어제(1) });
  await 진도적기(s.id, 어제(1), { 문법:{code:"U2",title:"2과"} });
  await post("/api/attendance", { action:"add-row", student_id:s.id, date:TODAY });
  const r = await 행(s.id, TODAY);
  ck("★ U2 다음은 복습 줄", r?.record?.progress?.문법?.code === "복습", r?.record?.progress?.문법);
  ck("복습 줄 제목도 따라온다", r?.record?.progress?.문법?.title === "U1~U2 다시", r?.record?.progress?.문법);
}

시작("1-9. 치우기");
{
  let ok = 0;
  for (const id of 치울것.학생) if ((await post("/api/attendance",{action:"delete-student",id})).s===200) ok++;
  for (const id of 치울것.교재) if ((await post("/api/attendance",{action:"delete-textbook",id})).s===200) ok++;
  ck("검수용 학생·교재가 지워진다", ok === 치울것.학생.length + 치울것.교재.length, ok);
}
끝();
