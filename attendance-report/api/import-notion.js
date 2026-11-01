// 노션 → Supabase 이관 (Vercel serverless).
// 기존 노션 DB(전체학생 / 데일리리포트 / 교재)를 읽어 우리 테이블로 옮긴다.
// ★ 속성명이 학원마다 달라도 되도록: 타입 + 키워드로 자동 매칭 ★
//
// 환경변수: NOTION_TOKEN, NOTION_STUDENTS_DB, NOTION_DAILY_DB, NOTION_TEXTBOOKS_DB(선택)
// 액션:
//   GET  ?action=check   → 설정/연결 + 각 DB 건수
//   GET  ?action=props   → 각 DB의 실제 속성명·타입 + "무엇으로 매칭됐는지" (진단용)
//   POST {action:"run", parts:[...]} → 실제 이관 (기본: textbooks→students→daily)

import { select, insert, patch, upsert, dbConfigured } from "../lib/db.js";
import { notionConfigured, queryDatabase, retrieveDatabase, prop, retrievePageTitle } from "../lib/notion.js";
import { tocByBook, normUnit } from "../lib/progress.js";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

// 스키마(name→type)에서 조건에 맞는 속성명 하나를 찾는다.
//   exact(정확한 이름) → type+includes(모든 키워드 포함) → includes → type만
function resolve(schema, spec) {
  const names = Object.keys(schema || {});
  const ex = (n) => !(spec.excludes || []).some((k) => n.includes(k));
  const all = (n) => (spec.includes || []).every((k) => n.includes(k));
  for (const e of (spec.exact || [])) if (schema[e] !== undefined && ex(e)) return e;
  if (spec.type && spec.includes) {
    const c = names.find((n) => schema[n] === spec.type && all(n) && ex(n));
    if (c) return c;
  }
  if (spec.includes) {
    const c = names.find((n) => all(n) && ex(n));
    if (c) return c;
  }
  if (spec.type) {
    const c = names.find((n) => schema[n] === spec.type && ex(n));
    if (c) return c;
  }
  return null;
}

// 학생DB 속성 매핑
function studentMap(schema) {
  const m = {
    name: resolve(schema, { exact: ["학생이름", "이름", "성명", "Name"], type: "title" }),
    code: resolve(schema, { exact: ["학생ID", "학생 ID", "studentId"], includes: ["학생", "ID"] }),
    status: resolve(schema, { exact: ["재원상태", "상태"], includes: ["재원"] }),
    // 「강사」도 담당으로 읽습니다 — 0차(노션 왕기초) 템플릿이 강사 DB 를 그 이름으로 만듭니다.
    // 관계형이면 연결된 페이지 제목(강사 이름)을 그대로 씁니다.
    teacher: resolve(schema, { exact: ["담당선생님", "담당 선생님", "담당강사", "담당", "선생님", "강사"], includes: ["담당"] })
          || resolve(schema, { includes: ["강사"] })
          || resolve(schema, { includes: ["선생"] }),
    minutes: resolve(schema, { exact: ["수업시간", "수업시간(분)", "수업 시간"], type: "number", includes: ["수업"] }),
    grade: resolve(schema, { exact: ["학년"], includes: ["학년"] }),
    pin: resolve(schema, { exact: ["출결PIN", "출결 PIN", "출결번호", "PIN", "핀"], includes: ["PIN"] })
      || resolve(schema, { includes: ["출결"] }),
    phone: resolve(schema, { exact: ["전화번호", "연락처", "학부모연락처", "학부모 연락처", "휴대폰"], includes: ["전화"] })
        || resolve(schema, { includes: ["연락"] }),
    book: {}, day: {},
  };
  // 교재는 관계형(교재DB)이 기본이지만, 교재명을 **글자로** 적어둔 분도 많아서 그것도 읽습니다.
  for (const s of ["문법", "리딩", "단어"]) {
    m.book[s] = resolve(schema, { exact: [`${s}교재`, `${s} 교재`], includes: [s, "교재"], type: "relation" })
             || resolve(schema, { exact: [`${s}교재`, `${s} 교재`, s], includes: [s, "교재"] });
  }
  // 요일: 「월-등원시간」이 기본. 「월요일」·「월」처럼 짧게 쓴 시트도 읽습니다.
  for (const d of DAYS) {
    m.day[d] = resolve(schema, { exact: [`${d}-등원시간`, `${d} 등원시간`, `${d}등원시간`], includes: [d, "등원"] })
            || resolve(schema, { exact: [`${d}요일`, d] });
  }
  return m;
}
// 데일리리포트DB 속성 매핑
function dailyMap(schema) {
  const m = {
    student: resolve(schema, { exact: ["학생이름", "학생", "이름"], includes: ["학생"], type: "relation" }),
    date: resolve(schema, { exact: ["날짜", "수업일", "Date"], type: "date" }),
    check_in: resolve(schema, { exact: ["실제등원시간", "등원시간"], includes: ["등원"] }),
    check_out: resolve(schema, { exact: ["실제하원시간", "하원시간"], includes: ["하원"] }),
    lateness: resolve(schema, { exact: ["지각", "출석"], includes: ["지각"] }),
    attitude: resolve(schema, { exact: ["태도"], includes: ["태도"] }),
    homework: resolve(schema, { exact: ["과제"], includes: ["과제"], excludes: ["추가", "학원", "집"] }),
    voca_test: resolve(schema, { exact: ["단어테스트_결과", "단어테스트결과", "단어테스트"], includes: ["단어", "테스트"] }),
    kakao: resolve(schema, { exact: ["카톡전송", "카톡"], includes: ["카톡"] }),
    prog: {}, book: {},
  };
  for (const s of ["문법", "리딩", "단어"]) {
    m.prog[s] = resolve(schema, { exact: [`${s}진도`, `${s} 진도`], includes: [s, "진도"] });
    m.book[s] = resolve(schema, { exact: [`${s}교재`, `${s} 교재`], includes: [s, "교재"], type: "relation" });
  }
  return m;
}
// 교재DB 속성 매핑
function textbookMap(schema) {
  return {
    name: resolve(schema, { exact: ["교재명", "교재", "이름", "Name"], type: "title" }),
    subject: resolve(schema, { exact: ["종류", "과목"], includes: ["종류"] }),
    price: resolve(schema, { exact: ["가격", "교재비"], type: "number", includes: ["가격"] }),
    stock: resolve(schema, { exact: ["누적교재수량", "누적수량", "수량"], type: "number", includes: ["수량"] }),
    dist: resolve(schema, { exact: ["배포된 수량", "배포수량", "배포된수량", "배부수량"], type: "number", includes: ["배포"] }),
  };
}
// 월말평가서DB 속성 매핑 (이미 생성한 평가서 보존용)
function reportMap(schema) {
  const m = {
    student: resolve(schema, { exact: ["학생", "학생이름"], includes: ["학생"], type: "relation" }),
    studentName: resolve(schema, { exact: ["학생이름", "이름"], includes: ["학생"] }),
    code: resolve(schema, { exact: ["학생ID", "학생 ID"], includes: ["학생", "ID"] }),
    month: resolve(schema, { exact: ["연월", "기간", "월"], includes: ["연월"] }),
    body: resolve(schema, { exact: ["평가서본문", "본문", "평가서", "리포트본문"], includes: ["본문"] }),
    classDays: resolve(schema, { exact: ["수업일수"], type: "number", includes: ["수업"] }),
    vocaRate: resolve(schema, { exact: ["단어통과율"], type: "number", includes: ["단어"] }),
    hwRate: resolve(schema, { exact: ["과제상비율", "과제비율"], type: "number", includes: ["과제"] }),
    kakao: resolve(schema, { exact: ["카톡전송", "카톡"], includes: ["카톡"] }),
    prog: {},
  };
  if (!m.month) m.month = resolve(schema, { type: "date" });
  for (const s of ["문법", "리딩", "단어"]) m.prog[s] = resolve(schema, { exact: [`${s}진도`], includes: [s, "진도"] });
  return m;
}
// 월말참고사항DB 속성 매핑
// (2차 addon 처럼 속성명을 자유롭게 쓰신 분이 많아 타입·키워드로 찾는다)
function commentMap(schema) {
  const m = {
    student: resolve(schema, { exact: ["학생", "학생이름", "이름"], includes: ["학생"], type: "relation" }),
    studentName: resolve(schema, { exact: ["학생이름", "이름"], includes: ["학생"] }),
    code: resolve(schema, { exact: ["학생ID", "학생 ID"], includes: ["학생", "ID"] }),
    month: resolve(schema, { exact: ["연월", "기간", "월"], includes: ["연월"] }),
    comment: resolve(schema, { exact: ["참고사항", "코멘트", "메모", "comment"], includes: ["참고"] }),
    middle: resolve(schema, { exact: ["중학생", "내신"], type: "checkbox" }),
  };
  if (!m.month) m.month = resolve(schema, { type: "date" });
  // 참고사항을 못 찾으면: 연월이 아닌 첫 긴 텍스트 속성 (2차 addon 폴백과 동일한 발상)
  if (!m.comment) {
    const names = Object.keys(schema || {});
    m.comment = names.find((n) => schema[n] === "rich_text" && n !== m.month) || null;
  }
  return m;
}

// "2026-05" / "2026년 5월" / 날짜 → "YYYY-MM"
function monthNorm(v) {
  const s = String(v || "").trim();
  const m = s.match(/(\d{4})\D+(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
  return s.slice(0, 7);
}

function firstId(v) { return Array.isArray(v) && v.length ? v[0] : null; }
// 노션 페이지ID(32자리 hex, 하이픈 유무 무관) 모양인가 — 이름 칸에 UUID 가 새는 걸 막는다.
const looksLikeId = (s) => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(String(s || "").trim());
function timeOf(v) { const s = Array.isArray(v) ? v[0] : v; const m = String(s || "").match(/\d{1,2}:\d{2}/); return m ? m[0] : String(s || "").trim(); }
function numOrNull(v) { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[^0-9.-]/g, "")); return isNaN(n) ? null : n; }

export default async function handler(req, res) {
  if (!dbConfigured()) return res.status(500).json({ error: "Supabase 환경변수가 없어요." });
  if (!notionConfigured()) return res.status(400).json({ error: "NOTION_TOKEN 이 없어요. Vercel 환경변수에 노션 Integration 토큰을 넣어주세요." });

  // 노션 DB ID — 6차 이름이 기본, 2차 세미나 Code.gs에서 쓰던 이름도 그대로 인정 (추가만, 기존 이름 유지)
  const STU = process.env.NOTION_STUDENTS_DB || process.env.STUDENTS_DB_ID,
        DAILY = process.env.NOTION_DAILY_DB || process.env.DAILY_REPORT_DB_ID,
        TB = process.env.NOTION_TEXTBOOKS_DB || process.env.TEXTBOOK_DB_ID;
  const REPORTS = process.env.NOTION_REPORTS_DB || process.env.REPORT_DB_ID;
  // 월말참고사항DB — 1차/다과목은 REPORT_MEMO_DB_ID, 2차 addon은 MONTHLY_COMMENT_DB_ID 였다
  const COMMENTS = process.env.NOTION_COMMENTS_DB || process.env.REPORT_MEMO_DB_ID || process.env.MONTHLY_COMMENT_DB_ID;

  try {
    const action = req.method === "GET" ? (req.query.action || "check") : (req.body?.action || "run");

    if (action === "check") {
      const out = { notion: true, students_db: Boolean(STU), daily_db: Boolean(DAILY), textbooks_db: Boolean(TB), reports_db: Boolean(REPORTS), comments_db: Boolean(COMMENTS), counts: {} };
      if (TB) out.counts.textbooks = (await queryDatabase(TB)).length;
      if (STU) out.counts.students = (await queryDatabase(STU)).length;
      if (DAILY) out.counts.daily = (await queryDatabase(DAILY)).length;
      if (REPORTS) out.counts.reports = (await queryDatabase(REPORTS)).length;
      if (COMMENTS) out.counts.comments = (await queryDatabase(COMMENTS)).length;
      return res.status(200).json(out);
    }

    // 실제 속성명·타입 + 우리가 무엇으로 매칭했는지 (속성명이 달라도 되는지 확인용)
    if (action === "props") {
      const out = {};
      if (STU) { const s = await retrieveDatabase(STU); out.students = { properties: s, matched: studentMap(s) }; }
      if (DAILY) { const s = await retrieveDatabase(DAILY); out.daily = { properties: s, matched: dailyMap(s) }; }
      if (TB) { const s = await retrieveDatabase(TB); out.textbooks = { properties: s, matched: textbookMap(s) }; }
      if (REPORTS) { const s = await retrieveDatabase(REPORTS); out.reports = { properties: s, matched: reportMap(s) }; }
      if (COMMENTS) { const s = await retrieveDatabase(COMMENTS); out.comments = { properties: s, matched: commentMap(s) }; }
      return res.status(200).json(out);
    }

    const parts = Array.isArray(req.body?.parts) ? req.body.parts : ["textbooks", "students", "daily", "reports", "comments"];
    const result = { textbooks: 0, students: 0, daily: 0, reports: 0, comments: 0, warnings: [] };

    // 교재 페이지ID → 교재명
    const tbNameByPage = {};
    if (TB) {
      const schema = await retrieveDatabase(TB); const M = textbookMap(schema);
      if (!M.name) result.warnings.push("교재DB: 교재명(제목) 속성을 못 찾았어요.");
      for (const p of await queryDatabase(TB)) {
        const name = prop(p, M.name);
        if (!name) continue;
        tbNameByPage[p.id] = name;
        if (parts.includes("textbooks")) {
          await upsert("textbooks", {
            name,
            subject: prop(p, M.subject) || null,
            price: numOrNull(prop(p, M.price)),
            stock_total: numOrNull(prop(p, M.stock)),
            distributed: numOrNull(prop(p, M.dist)) ?? 0,
          }, "name");
          result.textbooks++;
        }
      }
    }

    // 학생 페이지ID → 우리 student.id (데일리/평가서 이관에서 학생 연결에 사용)
    const stuIdByPage = {};
    if (STU && (parts.includes("students") || parts.includes("daily") || parts.includes("reports"))) {
      const schema = await retrieveDatabase(STU); const M = studentMap(schema);
      if (!M.name) result.warnings.push("학생DB: 학생이름(제목) 속성을 못 찾았어요.");
      const existing = await select("students", "select=id,name,student_code");
      const byCode = {}, byName = {};
      existing.forEach((s) => { if (s.student_code) byCode[s.student_code] = s.id; byName[s.name] = s.id; });

      for (const p of await queryDatabase(STU)) {
        const name = prop(p, M.name);
        if (!name) continue;
        const code = prop(p, M.code) || null;
        const schedule = {};
        for (const d of DAYS) { const t = timeOf(prop(p, M.day[d])); if (t) schedule[d] = t; }
        // 교재는 관계형(교재DB)일 수도, 교재명을 **글자로** 적어둔 것일 수도 있습니다.
        // 관계형인데 교재DB 를 같이 안 옮겼으면 제목을 되읽어 씁니다 (UUID 가 들어가지 않게).
        const books = {};
        for (const s of ["문법", "리딩", "단어"]) {
          const v = prop(p, M.book[s]);
          const id = firstId(v);
          let b = id ? (tbNameByPage[id] || await retrievePageTitle(id)) : "";
          if (!b) { const t = String((Array.isArray(v) ? v[0] : v) ?? "").trim(); if (t && !looksLikeId(t)) b = t; }
          if (b) books[s] = b;
        }
        // 담당 선생님: 글자면 그대로, 관계형(0차 템플릿의 「강사」)이면 그 페이지 제목으로.
        let teacherName = "";
        {
          const v = prop(p, M.teacher);
          const id = firstId(v);
          if (id) teacherName = await retrievePageTitle(id);
          else { const t = String(v ?? "").trim(); if (t && !looksLikeId(t)) teacherName = t; }
        }
        const row = {
          name,
          student_code: (code ?? "") + "" || null,
          status: prop(p, M.status) || "재원",
          teacher: teacherName || null,
          class_minutes: numOrNull(prop(p, M.minutes)) || 120,
          grade: (prop(p, M.grade) ?? "") + "" || null,
          pin: (prop(p, M.pin) ?? "") + "" || null,
          phone: (prop(p, M.phone) ?? "") + "" || null,
          schedule, books,
        };
        let id = (code && byCode[code]) || byName[name];
        if (parts.includes("students")) {
          if (id) await patch("students", `id=eq.${id}`, row);
          else { id = (await insert("students", row))[0]?.id; byName[name] = id; if (code) byCode[code] = id; }
          result.students++;
        }
        if (id) stuIdByPage[p.id] = id;
      }
    }

    // 데일리리포트
    if (DAILY && parts.includes("daily")) {
      const schema = await retrieveDatabase(DAILY); const M = dailyMap(schema);
      if (!M.student) result.warnings.push("데일리DB: 학생이름(Relation) 속성을 못 찾았어요.");
      if (!M.date) result.warnings.push("데일리DB: 날짜 속성을 못 찾았어요.");
      const toc = await tocByBook();
      const titleOf = (book, code) => { const u = (toc[book]?.units || []).map(normUnit).find((x) => x.code === code); return u ? u.title : ""; };
      const batch = [];
      // 건너뛴 줄을 세어 둔다 ★
      // 학생 연결이나 날짜가 없는 줄은 넣을 수 없는데, 예전에는 조용히 버려서
      // 노션에 300줄이 있어도 "daily: 3" 만 뜨고 왜 그런지 알 수 없었습니다.
      // 이관의 약속이 "쓰시던 기록을 그대로 가져온다" 라서, 못 가져온 줄은 반드시 알려야 합니다.
      let skipNoStudent = 0, skipNoDate = 0, total = 0;
      for (const p of await queryDatabase(DAILY)) {
        total++;
        const sid = stuIdByPage[firstId(prop(p, M.student))];
        const date = String(prop(p, M.date) || "").slice(0, 10);
        if (!sid) { skipNoStudent++; continue; }
        if (!date) { skipNoDate++; continue; }
        const books = {};
        for (const s of ["문법", "리딩", "단어"]) { const b = tbNameByPage[firstId(prop(p, M.book[s]))]; if (b) books[s] = b; }
        const progress = {};
        for (const s of ["문법", "리딩", "단어"]) {
          const code = ((prop(p, M.prog[s]) ?? "") + "").trim();
          if (code) progress[s] = { code, title: titleOf(books[s], code) };
        }
        batch.push({
          student_id: sid, date,
          check_in: (prop(p, M.check_in) ?? "") + "" || null,
          check_out: (prop(p, M.check_out) ?? "") + "" || null,
          lateness: prop(p, M.lateness) || null,
          attitude: prop(p, M.attitude) || "상",
          homework: prop(p, M.homework) || "상",
          voca_test: prop(p, M.voca_test) || null,
          progress, books,
          kakao_sent: prop(p, M.kakao) || "미전송",
        });
      }
      for (let i = 0; i < batch.length; i += 100) {
        const chunk = batch.slice(i, i + 100);
        if (chunk.length) await upsert("daily_records", chunk, "student_id,date");
        result.daily += chunk.length;
      }
      // 못 가져온 줄을 화면에 알린다 (조용히 버리지 않는다)
      result.dailySkipped = { total, noStudent: skipNoStudent, noDate: skipNoDate };
      if (skipNoStudent) {
        result.warnings.push(
          `데일리리포트 ${total}줄 중 ${skipNoStudent}줄은 **학생 연결이 비어** 못 가져왔어요. ` +
          `노션에서 그 줄의 학생(Relation)을 채우고 다시 불러오세요.`
        );
      }
      if (skipNoDate) {
        result.warnings.push(
          `데일리리포트 ${total}줄 중 ${skipNoDate}줄은 **날짜가 비어** 못 가져왔어요. ` +
          `노션에서 날짜를 채우고 다시 불러오세요.`
        );
      }
    }

    // 월말평가서 (이미 생성한 본문 보존)
    if (REPORTS && parts.includes("reports")) {
      const schema = await retrieveDatabase(REPORTS); const M = reportMap(schema);
      if (!M.body) result.warnings.push("월말평가서DB: 평가서본문 속성을 못 찾았어요.");
      if (!M.month) result.warnings.push("월말평가서DB: 연월 속성을 못 찾았어요.");
      // 학생 연결용 이름/학생ID → id 맵 (relation 실패 시 대체)
      const students = await select("students", "select=id,name,student_code");
      const byName = {}, byCode = {};
      students.forEach((s) => { byName[s.name] = s.id; if (s.student_code) byCode[s.student_code] = s.id; });

      for (const p of await queryDatabase(REPORTS)) {
        const sid = stuIdByPage[firstId(prop(p, M.student))]
          || byName[(prop(p, M.studentName) ?? "") + ""]
          || byCode[(prop(p, M.code) ?? "") + ""];
        const month = monthNorm(prop(p, M.month));
        const body = (prop(p, M.body) ?? "") + "";
        if (!sid || !month || !body) continue;
        const progress = {};
        for (const s of ["문법", "리딩", "단어"]) {
          const code = ((prop(p, M.prog[s]) ?? "") + "").trim();
          if (code) progress[s] = { 교재명: "", 유닛코드: code, 제목: "" };
        }
        await upsert("monthly_reports", {
          student_id: sid, month, body,
          stats: {
            classDays: numOrNull(prop(p, M.classDays)) ?? 0,
            vocaRate: numOrNull(prop(p, M.vocaRate)) ?? 0,
            hwRate: numOrNull(prop(p, M.hwRate)) ?? 0,
          },
          progress,
          kakao_sent: ((prop(p, M.kakao) ?? "") + "").includes("전송") && !((prop(p, M.kakao) ?? "") + "").includes("미전송"),
          updated_at: new Date().toISOString(),
        }, "student_id,month");
        result.reports++;
      }
    }

    // 월말참고사항 (선생님이 써 둔 코멘트 — 월말평가서 생성에 쓰인다)
    if (COMMENTS && parts.includes("comments")) {
      const schema = await retrieveDatabase(COMMENTS); const M = commentMap(schema);
      if (!M.comment) result.warnings.push("월말참고사항DB: 참고사항 속성을 못 찾았어요.");
      if (!M.month) result.warnings.push("월말참고사항DB: 연월 속성을 못 찾았어요.");
      const students = await select("students", "select=id,name,student_code");
      const byName = {}, byCode = {};
      students.forEach((s) => { byName[s.name] = s.id; if (s.student_code) byCode[s.student_code] = s.id; });

      for (const p of await queryDatabase(COMMENTS)) {
        const sid = stuIdByPage[firstId(prop(p, M.student))]
          || byName[(prop(p, M.studentName) ?? "") + ""]
          || byCode[(prop(p, M.code) ?? "") + ""];
        const month = monthNorm(prop(p, M.month));
        const comment = ((prop(p, M.comment) ?? "") + "").trim();
        if (!sid || !month || !comment) continue;   // 빈 코멘트는 건너뜀
        await upsert("monthly_comments", {
          student_id: sid, month, comment,
          middle_school: M.middle ? Boolean(prop(p, M.middle)) : false,
        }, "student_id,month");
        result.comments++;
      }
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
