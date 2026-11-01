// 가짜 노션 API — 1·2차 수강생의 노션 데이터를 흉내 낸다.
// 여기 나오는 이름·번호는 전부 **가짜 샘플**입니다 (실제 학생 아님).
// (실제 노션 키 없이 import.html 전 구간을 검사하려고. 배포 코드는 안 건드림)
const PROPS = {
  students: { "학생이름":"title","학생ID":"rich_text","출결PIN":"rich_text","학부모연락처":"phone_number",
              "학년":"select","담당":"select","수업시간":"number","재원상태":"status",
              "월-등원시간":"rich_text","화-등원시간":"rich_text","수-등원시간":"rich_text",
              "목-등원시간":"rich_text","금-등원시간":"rich_text",
              "문법교재":"relation","리딩교재":"relation","단어교재":"relation" },
  daily:    { "학생이름":"relation","제목":"title","날짜":"date","등원시간":"rich_text","하원시간":"rich_text","지각":"select",
              "수업태도":"select","과제":"select","단어테스트_결과":"select","단어테스트":"rich_text",
              "문법진도":"rich_text","리딩진도":"rich_text","단어진도":"rich_text","추가사항":"rich_text" },
  books:    { "교재명":"title","과목":"select","유닛":"rich_text" },
  reports:  { "학생":"title","연월":"rich_text","본문":"rich_text" },
  comments: { "학생":"title","연월":"rich_text","참고사항":"rich_text" },
};
const T = (s) => [{ plain_text: s, text: { content: s } }];
const page = (props, id) => ({ id: id || ("pg-" + Math.random().toString(36).slice(2, 10)), properties: props });
const SA = "stu-page-A", SB = "stu-page-B";
const REL = (id) => ({ type: "relation", relation: [{ id }] });

const ROWS = {
  students: [
    page({ "학생이름":{type:"title",title:T("노션학생A")}, "학생ID":{type:"rich_text",rich_text:T("nt01")},
           "출결PIN":{type:"rich_text",rich_text:T("1217")}, "학부모연락처":{type:"phone_number",phone_number:"010-0000-1212"},  // 가짜 번호(검수용 샘플)
           // ★ PIN 은 setup.sql 샘플(1111·1212·2222…)과 **겹치지 않는** 값이어야 합니다.
           //   겹치면 앱이 「PIN 이 겹친다」고 막는 게 맞고, 그러면 이 검수가 헛걸립니다.
           "학년":{type:"select",select:{name:"중1"}}, "담당":{type:"select",select:{name:"이선생"}},
           "수업시간":{type:"number",number:120}, "재원상태":{type:"status",status:{name:"재원"}},
           "월-등원시간":{type:"rich_text",rich_text:T("17:00")}, "수-등원시간":{type:"rich_text",rich_text:T("17:00")},
           "문법교재":{type:"relation",relation:[]} }, SA),
    page({ "학생이름":{type:"title",title:T("노션학생B")}, "학생ID":{type:"rich_text",rich_text:T("nt02")},
           "출결PIN":{type:"rich_text",rich_text:T("3437")}, "학부모연락처":{type:"phone_number",phone_number:"010-0000-3434"},  // 가짜 번호(검수용 샘플)
           "학년":{type:"select",select:{name:"중3"}}, "담당":{type:"select",select:{name:"박선생"}},
           "재원상태":{type:"status",status:{name:"재원"}}, "화-등원시간":{type:"rich_text",rich_text:T("18:00")} }, SB),
    // 가장자리: 이름만 있고 나머지가 비어 있는 줄
    page({ "학생이름":{type:"title",title:T("빈칸많은학생")} }),
  ],
  daily: [
    page({ "학생이름":REL(SA), "날짜":{type:"date",date:{start:"2026-09-07"}},
           "등원시간":{type:"rich_text",rich_text:T("17:02")}, "지각":{type:"select",select:{name:"정시등원"}},
           "수업태도":{type:"select",select:{name:"상"}}, "과제":{type:"select",select:{name:"100%완료"}},
           "단어테스트_결과":{type:"select",select:{name:"통과"}},
           "문법진도":{type:"rich_text",rich_text:T("Unit 5 현재완료")},
           "리딩진도":{type:"rich_text",rich_text:T("Unit 3")},
           "추가사항":{type:"rich_text",rich_text:T("발표를 잘했어요")} }),
    page({ "학생이름":REL(SA), "날짜":{type:"date",date:{start:"2026-09-09"}},
           "수업태도":{type:"select",select:{name:"중"}}, "과제":{type:"select",select:{name:"하"}} }),
    // 가장자리: 날짜 없음 / 이름 없음
    page({ "학생이름":REL(SB) }),
    page({ "날짜":{type:"date",date:{start:"2026-09-10"}} }),
  ],
  books: [
    page({ "교재명":{type:"title",title:T("노션교재 그래머")}, "과목":{type:"select",select:{name:"문법"}},
           "유닛":{type:"rich_text",rich_text:T("Unit 1 | be동사\nUnit 2 | 일반동사")} }),
  ],
  reports: [
    page({ "학생":{type:"title",title:T("노션학생A")}, "연월":{type:"rich_text",rich_text:T("2026-09")},
           "본문":{type:"rich_text",rich_text:T("9월 평가서 본문입니다.")} }),
  ],
  comments: [
    page({ "학생":{type:"title",title:T("노션학생A")}, "연월":{type:"rich_text",rich_text:T("2026-09")},
           "참고사항":{type:"rich_text",rich_text:T("단어를 더 봐주세요")} }),
  ],
};
const WHICH = (id) => (id||"").includes("stu") ? "students" : (id||"").includes("daily") ? "daily"
  : (id||"").includes("book") ? "books" : (id||"").includes("report") ? "reports" : "comments";

// ★ 노션에 '쓰기' 가 일어나면 기록해 둔다.
//   이관 가이드가 "노션은 읽기만 합니다 / 원본은 그대로 남습니다" 를 약속하므로,
//   쓰기 호출이 한 번이라도 있으면 그 약속이 깨진 것입니다.
export const WRITES = [];
export function notionRespond(url, opts) {
  const method = String((opts && opts.method) || "GET").toUpperCase();
  const isQuery = /\/query$/.test(String(url).split("?")[0]);
  // 노션은 DB 조회도 POST /query 를 씁니다 — 그것만 읽기로 인정합니다.
  if (method !== "GET" && !isQuery) WRITES.push(`${method} ${url}`);

  const m = /\/v1\/databases\/([^/?]+)(\/query)?/.exec(url);
  if (!m) return new Response(JSON.stringify({ message: "mock: 모르는 경로 " + url }), { status: 404 });
  const which = WHICH(m[1]);
  if (!m[2]) return new Response(JSON.stringify({
    properties: Object.fromEntries(Object.entries(PROPS[which]).map(([k, v]) => [k, { type: v }])),
  }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ results: ROWS[which], has_more: false, next_cursor: null }),
    { status: 200, headers: { "content-type": "application/json" } });
}
