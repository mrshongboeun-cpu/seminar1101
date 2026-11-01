// 출결 API (Vercel serverless) — 학생관리 · PIN 등하원 · 현황판 · 데일리 리포트.
// 실사용 시스템의 3기능 중 ①데일리 리포트(작성·보내기) ②출석 현황판 을 이 파일 하나로.
// (③월말평가서는 api/report.js)
//
// 액션:
//   GET  ?action=students                    → 학생 전체 (students.html)
//   GET  ?action=textbooks                   → 교재·목차 전체 (books.html)
//   GET  ?action=board&date=YYYY-MM-DD        → 출석 현황판 (board.html, 기본 오늘)
//   GET  ?action=daily-rows&date=YYYY-MM-DD   → 데일리 리포트 작성용 행 + 직전 진도 (daily.html)
//   POST {action:"send-daily", date, dryRun, student_ids} → 데일리 리포트 학부모 카톡 발송
//   POST {action:"save-student", student}     → 학생 추가/수정
//   POST {action:"delete-student", id}        → 학생 삭제
//   POST {action:"bulk-students", rows:[...]} → 붙여넣기 일괄 등록
//   POST {action:"checkin", pin}              → PIN 등원/하원 토글 (키오스크)
//   POST {action:"checkout", student_id}      → 하원 처리 (현황판, 카톡 안 보냄)
//   POST {action:"save-record", student_id, date, fields} → 데일리 리포트 한 줄 저장
//   POST {action:"advance-today"}             → 오늘 진도를 목차 다음으로 일괄 채우기
//   POST {action:"notify-absent"}             → 미등원 학부모 알림톡 (수동)
//   POST {action:"save-textbook"|"delete-textbook"} → 교재·목차 관리
//   GET  ?action=student-history&student_id=&days= → 학생 카드(진도·테스트·과제 이력)
//   POST {action:"send-retest", date, dryRun, student_ids} → 재시 안내 학부모 카톡
//   GET  ?action=teachers                     → 담당 선생님 목록 (선생님앱 teacher.html)
//   GET  ?action=tasks&date=...                → 그날 과제 현황 (선생님앱)
//   POST {action:"save-tasks", date, student_ids, items} → 과제 내주기 (여러 학생 × 여러 항목)
//   POST {action:"delete-task", id}            → 과제 1건 삭제
//
// ※ students · board · daily-rows · tasks 는 `&teacher=이선생` 을 붙이면 그 선생님 담당 학생만.
//    선생님앱(teacher.html)이 이 필터를 쓴다. 안 붙이면 전체(원장님 화면과 동일).

import { select, insert, patch, remove, dbConfigured, DbInputError } from "../lib/db.js";
import { kstNow, toMinutes, addMinutes } from "../lib/time.js";
import { sendAlimtalk, TPL } from "../lib/solapi.js";
import { tocByBook, advanceProgress, normUnit, linkStatus, tasksForProgress, lastAttendedProgress } from "../lib/progress.js";
import { isFail, retestQueueValue, needsRetest, retestHint, RETEST_PASS } from "../lib/retest.js";

const GRACE = 10;       // 지각 유예(분)
const LEAVE_SOON = 15;  // "곧 하원" 판단(예상 하원시간 15분 전부터)
const SUBJECTS = ["문법", "리딩", "단어"];

// 유닛 {code,title} → "코드 제목" 라벨
function unitLabel(u) {
  const n = normUnit(u);
  if (!n) return "";
  return [n.code, n.title].filter(Boolean).join(" ");
}
// 진도 jsonb → 한 줄 문자열 (데일리 리포트 카톡·미리보기용)
function progressText(progress) {
  const p = progress || {};
  return SUBJECTS.filter((s) => p[s]).map((s) => `${s} ${unitLabel(p[s])}`).join(" · ");
}

// 단어테스트 표기 (결과 + 점수)
function vocaText(rec) {
  if (!rec?.voca_test) return "";
  return rec.voca_score ? `${rec.voca_test} (${rec.voca_score})` : rec.voca_test;
}

// 단어테스트 판정·재시 큐 규칙은 lib/retest.js 한 곳에 모여 있습니다
// (「불통과」 버튼 + 점수칸 둘 다 봅니다 — 기준 %·만점도 거기 맨 위 두 줄).

// 오늘 행 없으면 만들어 반환 (진도는 교재 목차의 다음 유닛으로 자동 전환)
// 학생 한 명의 그날 데일리리포트 행을 찾고, 없으면 다음 진도로 만들어 돌려준다.
//
// ⚠️ studentId/date 가 비어 있으면 `student_id=eq.undefined` 같은 질의가 나가서
//    PostgREST 가 400 을 주고, 그게 500 으로 올라가 화면에 내부 에러가 그대로 뜹니다.
//    (화면에서는 늘 채워 보내지만, 저장 중 행이 아직 없거나 통신이 꼬이면 생길 수 있음)
//    여기서 한 번 막으면 이 함수를 쓰는 네 곳이 전부 보호됩니다.
// 막으려는 건 `undefined`·빈값이 그대로 질의에 실려 나가는 것입니다.
// id 형식(uuid)을 강제하지는 않습니다 — 형식을 박아두면 점검용 데이터나
// 나중에 id 체계를 바꿀 때 멀쩡한 호출까지 막히기 때문입니다.
const BAD_ID = /^(undefined|null|NaN|)$/i;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;         // 필터에 그대로 들어가므로 이상한 문자는 거른다
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 형식만 보면 "2026-13-99" 도 통과합니다. 실제로 있는 날짜인지까지 봅니다.
const okDate = (v) => DATE_RE.test(String(v)) && !isNaN(new Date(`${v}T00:00:00Z`).getTime());
class BadRequest extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}
// ── 출결PIN 이 겹치나 ─────────────────────────────────────────────
// 왜 막나: 키오스크(`checkin`)는 **PIN 만으로** 학생을 찾습니다. 아이가 등원할 때
//   학생ID 까지 누르게 하면 번거로워서 그렇게 돼 있습니다. 그래서 PIN 이 겹치면
//   **엉뚱한 아이로 등원되고 그 집에 등원 카톡이 갑니다** — 아무 표시도 없이.
//   겹치는 걸 알아챌 방법이 없으니 넣는 자리에서 막습니다.
async function 핀겹치나(row, 내id) {
  const pin = String(row.pin || "").trim();
  if (!pin || row.status === "퇴원") return;   // 퇴원생은 키오스크가 안 찾습니다
  const 같은핀 = await select("students", `pin=eq.${encodeURIComponent(pin)}&status=eq.재원&select=id,name`);
  const 남 = 같은핀.filter((x) => String(x.id) !== String(내id || ""));
  if (남.length) {
    throw new BadRequest(
      `출결PIN ${pin} 은 이미 ${남.map((x) => x.name).join("·")} 학생이 쓰고 있어요. ` +
      `키오스크는 PIN 만으로 학생을 찾기 때문에 겹치면 엉뚱한 학생으로 등원되고 ` +
      `그 집에 등원 카톡이 갑니다. 다른 번호로 바꿔주세요.`
    );
  }
}

// ── 「왜 비었나」 ────────────────────────────────────────────────
// 화면은 「한 명도 없다」만 압니다. **왜** 없는지는 서버만 아는데,
// 그 셋이 전혀 다른 문제입니다 —
//   ① 학생이 아예 0명      → setup.sql 을 안 돌렸거나 **다른 프로젝트**를 보고 있음
//   ② 있는데 재원이 0명     → 전부 퇴원으로 들어갔음 (이관·붙여넣기에서 자주)
//   ③ 재원은 있는데 그 요일  → 요일별 등원시간이 비었음
// 이걸 안 갈라주면 「고장났나?」 하고 설치를 처음부터 다시 하게 됩니다.
async function 왜비었나(weekday) {
  const all = await select("students", "select=id,status,schedule");
  const 재원 = all.filter((s) => s.status === "재원");
  if (!all.length) {
    return {
      kind: "학생없음",
      message: "학생이 한 명도 없습니다. Supabase 의 SQL Editor 에서 sql/setup.sql 을 끝까지 Run 했는지, " +
        "그리고 Vercel 의 SUPABASE_URL 이 그 프로젝트 주소인지 확인해 주세요 (setup.sql 을 돌리면 샘플 학생 12명이 같이 깔립니다).",
    };
  }
  if (!재원.length) {
    return {
      kind: "재원없음",
      message: `학생 ${all.length}명이 있는데 재원 상태인 학생이 없습니다. 학생 관리에서 재원상태를 「재원」 으로 바꿔주세요.`,
    };
  }
  const 요일있는 = 재원.filter((s) => (s.schedule || {})[weekday]);
  if (!요일있는.length) {
    const 아무요일도 = 재원.filter((s) => !Object.values(s.schedule || {}).some((v) => String(v || "").trim())).length;
    return {
      kind: "요일없음",
      message: `재원 학생 ${재원.length}명 중 ${weekday}요일에 수업이 있는 학생이 없습니다. 고장난 게 아닙니다.` +
        (아무요일도
          ? ` 다만 ${아무요일도}명은 **어느 요일에도** 등원시간이 비어 있어서 어떤 날짜에도 안 나옵니다 — 학생 관리에서 요일별 등원시간을 채워주세요.`
          : " 다른 날짜를 골라보세요."),
    };
  }
  return null;   // 요일에 학생이 있는데 비었다면 그건 다른 문제입니다
}

async function ensureTodayRow(studentId, date) {
  const sid = String(studentId ?? "").trim();
  if (BAD_ID.test(sid) || !SAFE_ID.test(sid)) {
    throw new BadRequest("학생을 찾을 수 없어요. 화면을 새로고침한 뒤 다시 해주세요.");
  }
  if (!okDate(date)) {
    throw new BadRequest(`날짜가 올바르지 않아요: ${date}`);
  }
  const rows = await select(
    "daily_records",
    `student_id=eq.${studentId}&date=eq.${date}`
  );
  if (rows[0]) return rows[0];
  const [prev, students, toc] = await Promise.all([
    lastAttendedProgress(studentId, date),
    select("students", `id=eq.${studentId}&select=books`),
    tocByBook(),
  ]);
  const bk = students[0]?.books || {};
  const created = await insert("daily_records", {
    student_id: studentId,
    date,
    progress: advanceProgress(prev, bk, toc),
    books: bk, // 그날 교재 스냅샷 (교재 전환 감지용)
  });
  return created[0];
}

// 담당 선생님 필터 — 선생님앱에서 `?teacher=이선생` 으로 쓴다. 없으면 빈 문자열(전체).
function teacherFilter(req) {
  const t = String((req.method === "GET" ? req.query.teacher : req.body?.teacher) || "").trim();
  return t ? `&teacher=eq.${encodeURIComponent(t)}` : "";
}

function lateness(scheduled, actual) {
  const s = toMinutes(scheduled);
  const a = toMinutes(actual);
  if (s === null || a === null) return "정시"; // 예정시간 없으면 정시 처리
  return a > s + GRACE ? "지각" : "정시";
}

// 그날 진도에 맞는 **자동 과제**를 다시 깝니다.
//   · auto=true (진도에서 나온 것) 만 지우고 새로 만듭니다.
//   · 선생님이 손으로 낸 과제(auto=false)는 **절대 건드리지 않습니다.**
//   · 유닛에 과제를 안 적어둔 교재는 아무것도 안 생깁니다 (기존 설치와 동일).
async function syncAutoTasks(student, date, progress, toc) {
  const rows = tasksForProgress({
    progress, books: student.books, toc, student_id: student.id, date,
  });
  await remove("tasks", `student_id=eq.${student.id}&date=eq.${date}&auto=is.true`);
  if (rows.length) await insert("tasks", rows);
  return rows.length;
}

export default async function handler(req, res) {
  if (!dbConfigured()) {
    return res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 없어요." });
  }
  try {
    const action = req.method === "GET" ? req.query.action : (req.body?.action ?? "");
    const now = kstNow();

    // ── 학생 목록 ──
    if (action === "students") {
      const students = await select("students", `order=name.asc${teacherFilter(req)}`);
      // ★ 같은 출결PIN 을 쓰는 학생이 있나 — **키오스크가 PIN 만으로 학생을 찾기** 때문에
      //   겹치면 엉뚱한 아이로 등원되고 그 집에 카톡이 갑니다.
      //   넣는 자리(save-student·bulk-students)에서도 막지만, **노션 이관**처럼
      //   다른 길로 들어온 중복은 그걸로 안 걸립니다. 그래서 명단 화면이 띄워줍니다.
      //   (1·2차 수강생의 노션 PIN 이 샘플 12명의 PIN 과 겹치는 일이 실제로 있습니다)
      const 핀묶음 = {};
      for (const s of students) {
        const p = String(s.pin || "").trim();
        if (!p || s.status === "퇴원") continue;   // 퇴원생은 키오스크가 안 찾습니다
        (핀묶음[p] ||= []).push(s.name);
      }
      const pin_dups = Object.entries(핀묶음)
        .filter(([, names]) => names.length > 1)
        .map(([pin, names]) => ({ pin, names }));
      return res.status(200).json({ students, pin_dups });
    }

    // ── 교재(목차) 목록 ──
    if (action === "textbooks") {
      const textbooks = await select("textbooks", "order=subject.asc,name.asc");
      return res.status(200).json({ textbooks });
    }

    // ── 현황판 ──
    if (action === "board") {
      const date = req.query.date || now.date;
      const weekday = date === now.date ? now.weekday : "일월화수목금토"[new Date(date + "T00:00:00Z").getUTCDay()];
      const students = await select("students", `status=eq.재원&order=name.asc${teacherFilter(req)}`);
      const records = await select("daily_records", `date=eq.${date}`);
      const recBy = Object.fromEntries(records.map((r) => [r.student_id, r]));

      const isToday = date === now.date;
      const nowMin = toMinutes(now.hhmm);
      const list = [];
      for (const s of students) {
        const scheduled = (s.schedule || {})[weekday] || "";
        const rec = recBy[s.id];
        if (!scheduled && !rec) continue; // 오늘 수업 없고 기록도 없으면 숨김
        const expectedEnd = rec?.check_in
          ? addMinutes(rec.check_in, s.class_minutes)
          : addMinutes(scheduled, s.class_minutes);
        // 실사용 현황판과 동일한 상태 구분
        let status;
        if (rec?.check_out) status = "하원";
        else if (rec?.lateness === "결석") status = "결석";
        else if (rec?.check_in) {
          const endMin = toMinutes(expectedEnd);
          status = isToday && endMin !== null && nowMin >= endMin - LEAVE_SOON ? "곧 하원" : "수업중";
        } else {
          // 아직 등원 전 — 예정시간+유예 지났으면 '지각 미등원', 아니면 '미등원'
          const overdue = scheduled && isToday && nowMin > toMinutes(scheduled) + GRACE;
          status = overdue ? "지각 미등원" : "미등원";
        }
        list.push({
          student_id: s.id,
          name: s.name,
          grade: s.grade,
          teacher: s.teacher,
          class_minutes: s.class_minutes,
          scheduled,
          expected_end: expectedEnd,
          status,
          record: rec
            ? {
                check_in: rec.check_in, check_out: rec.check_out, lateness: rec.lateness,
                attitude: rec.attitude, homework: rec.homework, voca_test: rec.voca_test,
                progress: rec.progress, note: rec.note,
              }
            : null,
          books: s.books || {},
        });
      }
      const count = (st) => list.filter((x) => x.status === st).length;
      const stats = {
        오늘예정: list.length,
        수업중: count("수업중"),
        미등원: count("미등원"),
        지각미등원: count("지각 미등원"),
        곧하원: count("곧 하원"),
        결석: count("결석"),
        하원완료: count("하원"),
      };
      const empty = list.length ? null : await 왜비었나(weekday);
      return res.status(200).json({ date, weekday, students: list, stats, empty });
    }

    // ── 데일리 리포트 작성용: 그날 학생별 행 + 직전 진도 ──────────
    // 오늘 등원을 판단해 행이 없으면 다음 진도를 적용해 새로 만든다.
    if (action === "daily-rows") {
      const date = req.query.date || now.date;
      // 날짜를 먼저 막습니다. 안 막으면 그대로 DB 로 가서 PostgreSQL 원문이 화면에 뜹니다.
      if (!okDate(date)) throw new BadRequest(`날짜가 올바르지 않아요: ${date}`);
      const weekday = date === now.date ? now.weekday : "일월화수목금토"[new Date(date + "T00:00:00Z").getUTCDay()];
      const students = await select("students", `status=eq.재원&order=name.asc${teacherFilter(req)}`);
      let records = await select("daily_records", `date=eq.${date}`);
      let recBy = Object.fromEntries(records.map((r) => [r.student_id, r]));
      const toc = await tocByBook();

      // 그날 수업 예정인데 행이 없는 학생 → 직전 진도의 '다음 목차'로 채워 보여준다.
      //
      // ⚠️ **앞으로 올 날짜는 보여주기만 하고 저장하지 않습니다.**
      //    예전에는 달력에서 다음 주를 한 번 눌러보기만 해도 그 날짜 행이 DB에 만들어졌고,
      //    그 행이 **월말평가서의 수업일수에 그대로 잡혔습니다**
      //    (실제로 1일 수업했는데 미리 눌러본 3일이 더해져 4일로 집계).
      //    학부모에게 나가는 숫자라 그냥 두면 안 됩니다.
      //    → 미래 날짜는 미리보기(가짜 id 없이)만, 저장은 선생님이 실제로 쓸 때
      //      save-record 가 만들어 줍니다. 오늘·지난 날짜는 종전대로 생성합니다.
      const isFuture = date > now.date;
      const missing = students.filter((s) => (s.schedule || {})[weekday] && !recBy[s.id]);
      if (missing.length) {
        const toCreate = [];
        for (const s of missing) {
          // 결석한 날은 건너뛰고 **마지막으로 나온 날**의 진도에서 이어갑니다 (lastAttendedProgress 주석 참고)
          const prev = await lastAttendedProgress(s.id, date);
          toCreate.push({ student_id: s.id, date, progress: advanceProgress(prev, s.books, toc), books: s.books || {} });
        }
        // 미래면 저장하지 않고 화면에만 (preview: true 로 표시)
        const created = isFuture
          ? toCreate.map((r) => ({ ...r, preview: true }))
          : await insert("daily_records", toCreate);
        // 진도가 정해지는 바로 이 지점에서 **그 유닛의 과제**를 깔아줍니다.
        //   미래 날짜는 행을 저장하지 않으므로 과제도 만들지 않습니다.
        if (!isFuture) {
          for (const r of toCreate) {
            const stu = missing.find((x) => x.id === r.student_id);
            if (stu) await syncAutoTasks(stu, date, r.progress, toc);
          }
        }
        records = records.concat(created);
        recBy = Object.fromEntries(records.map((r) => [r.student_id, r]));
      }

      // 각 행에 **지난 수업 3회**(진도 + 단어테스트 + 태도·과제)를 붙인다.
      //   직전 1회만 보면 "오늘 제대로 전진했나" 는 알아도
      //   "요즘 이 아이가 계속 멈춰 있나 / 단어를 계속 안 보나" 는 안 보입니다.
      //   화면은 **표**로 3회를 먼저 보여주고 「더 보기」로 8회까지 폅니다.
      // 학생 수만큼 조회하지 않도록 **한 번에** 가져와 학생별로 묶습니다.
      const PREV_N = 8;   // 화면은 3회만 먼저 보여주고 「더 보기」로 8회까지
      const histAll = await select(
        "daily_records",
        `date=lt.${date}&order=date.desc&select=student_id,date,progress,voca_test,voca_score,attitude,homework,lateness,note`
      );
      const histBy = {};
      for (const h of histAll) {
        const arr = (histBy[h.student_id] ||= []);
        if (arr.length < PREV_N) arr.push(h);
      }

      const rows = [];
      for (const s of students) {
        const rec = recBy[s.id];
        if (!rec) continue; // 오늘 수업 없고 행도 없으면 데일리 리포트 대상 아님
        const prev = histBy[s.id] || [];
        rows.push({
          record_id: rec.id,
          student_id: s.id,
          name: s.name,
          grade: s.grade,
          teacher: s.teacher,
          phone: s.phone,
          scheduled: (s.schedule || {})[weekday] || "",
          books: s.books || {},
          record: {
            check_in: rec.check_in, check_out: rec.check_out, lateness: rec.lateness,
            attitude: rec.attitude, homework: rec.homework,
            voca_test: rec.voca_test, voca_score: rec.voca_score,
            progress: rec.progress || {}, note: rec.note, parent_note: rec.parent_note,
            // 그날 행이 들고 있는 교재. 학생DB의 교재(위 books)와 다를 수 있습니다 —
            // 학생 관리에서 교재를 바꿔도 **이미 만들어진 행**은 옛 교재를 들고 있기 때문입니다.
            books: rec.books || {},
            report_sent: rec.report_sent,
            // 재시 안내 카톡 상태 — 화면의 「🔁 재시 안내」 개수를 이걸로 셉니다
            retest_sent: rec.retest_sent || null,
            // 판정은 **서버에서만** 합니다 (화면이 규칙을 따로 들고 있으면 둘이 어긋납니다).
            //   needs_retest = 재시 안내 대상인가 / retest_hint = 점수칸 밑에 띄울 한 줄
            needs_retest: needsRetest(rec),
            retest_hint: retestHint(rec.voca_test, rec.voca_score),
          },
          prev: prev[0] ? { date: prev[0].date, progress: prev[0].progress || {} } : null,
          // 지난 수업 (최근 것이 앞) — 진도·단어테스트·태도·과제·지적
          recent: prev.map((h) => ({
            date: h.date,
            progress: h.progress || {},
            voca_test: h.voca_test || null,
            voca_score: h.voca_score || null,
            attitude: h.attitude || null,
            homework: h.homework || null,
            lateness: h.lateness || null,
            note: h.note || null,
          })),
          // 진도가 교재 목차와 연결됐는지 — 화면에서 "왜 안 넘어가지?" 를 바로 보여주려고.
          link: linkStatus(rec.progress, s.books, toc),
        });
      }
      // 비었으면 **왜** 비었는지 같이 보냅니다 (화면은 그걸 그대로 띄웁니다)
      const empty = rows.length ? null : await 왜비었나(weekday);
      return res.status(200).json({ date, weekday, rows, empty });
    }

    // ── 보강/누락: 특정 학생의 그날 행을 수동 생성 (정규 수업일이 아니어도) ──
    if (action === "add-row") {
      const { student_id, date } = req.body;
      if (!student_id) return res.status(400).json({ error: "student_id 필요" });
      const row = await ensureTodayRow(student_id, date || now.date); // 없으면 다음 진도로 생성
      return res.status(200).json({ record: row });
    }

    // ── 데일리 리포트 학부모 카톡 발송 (미리보기 dryRun / 실제 발송) ──
    // body: { date, dryRun?, student_ids?[] }  student_ids 없으면 그날 기록 전체
    if (action === "send-daily") {
      const date = req.body.date || now.date;
      const only = Array.isArray(req.body.student_ids) ? new Set(req.body.student_ids) : null;
      const dryRun = Boolean(req.body.dryRun);

      const students = await select("students", `status=eq.재원${teacherFilter(req)}`);
      const stuBy = Object.fromEntries(students.map((s) => [s.id, s]));
      let records = await select("daily_records", `date=eq.${date}`);
      records = records.filter((r) => (only ? only.has(r.student_id) : true) && r.lateness !== "결석");

      const results = [];
      let sent = 0;
      for (const r of records) {
        const stu = stuBy[r.student_id];
        if (!stu) continue;
        const phone = String(stu.phone || "").replace(/[^0-9]/g, "");
        const preview = {
          student_id: stu.id,
          name: stu.name,
          phone: stu.phone || "",
          progress: progressText(r.progress),
          attitude: r.attitude || "-",
          homework: r.homework || "-",
          voca: vocaText(r) || "-",
          parent_note: r.parent_note || "",
          already: r.report_sent === "전송",
        };
        if (phone.length < 10) { results.push({ ...preview, ok: false, reason: "연락처 없음" }); continue; }

        // 알림톡 변수 — 1차(노션 알림톡) 세미나 템플릿을 그대로 쓰실 수 있게 과목별 교재·진도도 함께 보낸다.
        // 과목명은 고정하지 않고 books/progress(jsonb)에 실제로 들어 있는 키를 쓴다.
        // → 영어(문법·리딩·단어)든 수학(연산·교과)이든 과목 키만 바꾸면 템플릿이 그대로 동작.
        // 솔라피는 템플릿에 없는 변수는 무시하므로, 어떤 템플릿을 쓰시든 안전하다.
        //
        // ★ 미리보기(dryRun)에서도 이 변수를 만들어 돌려줍니다.
        //   예전에는 dryRun 이 여기 위에서 빠져나가서, 교재·진도가 제대로 채워지는지
        //   **실제로 학부모에게 보내 봐야** 알 수 있었습니다. 제일 나쁜 곳에서 알게 되는 구조라
        //   미리보기 단계에서 값을 볼 수 있게 바꿨습니다.
        const rBooks = r.books || {}, sBooks = stu.books || {}, rProg = r.progress || {};
        // 1차 템플릿이 쓰는 3과목은 학생이 안 듣더라도 변수를 비워두지 않는다.
        // (카카오는 치환 안 된 변수가 있으면 발송을 거부한다 — 그래서 없으면 "-")
        const subjects = [...new Set([
          "리딩", "문법", "단어",
          ...Object.keys(sBooks), ...Object.keys(rBooks), ...Object.keys(rProg),
        ])];
        // ★ 진도에는 **유닛 제목까지** 싣습니다 — "CH1-1" 이 아니라 "CH1-1 be동사".
        //   학부모가 받는 게 코드뿐이면 무슨 뜻인지 모릅니다.
        //   교재 목차에 제목을 안 넣으셨으면 예전처럼 코드만 나가므로, 쓰시던 템플릿은
        //   그대로 두셔도 됩니다(변수 이름이 바뀌지 않으니 재승인도 필요 없습니다).
        //   코드와 제목을 **줄을 나눠** 쓰고 싶은 분을 위해 `#{과목제목}` 도 함께 보냅니다
        //   (솔라피는 템플릿에 없는 변수를 무시하므로 더 보내도 안전합니다).
        const subjVars = {};
        for (const s of subjects) {
          const p = rProg[s] || {};
          const u = normUnit(p) || {};
          const code = typeof p === "string" ? p : (u.code || p.유닛코드 || "");
          const title = typeof p === "string" ? "" : (u.title || p.제목 || "");
          subjVars[`#{${s}교재}`] = String(rBooks[s] || sBooks[s] || "-");
          subjVars[`#{${s}진도}`] = [code, title].filter(Boolean).join(" ") || "-";
          subjVars[`#{${s}유닛}`] = String(code || "-");   // 코드만
          subjVars[`#{${s}제목}`] = String(title || "-");  // 제목만
        }
        // 미리보기면 "무엇이 나갈지" 를 돌려주고 끝. (발송하지 않음)
        if (dryRun) { results.push({ ...preview, vars: subjVars, ok: true }); continue; }

        const send = await sendAlimtalk(stu.phone, TPL.daily, {
          "#{학생이름}": stu.name,
          "#{날짜}": date,
          "#{진도}": preview.progress || "-",
          "#{태도}": preview.attitude,
          "#{과제}": preview.homework,
          "#{지각}": r.lateness || "정시",
          "#{단어테스트}": preview.voca,
          "#{추가사항}": preview.parent_note || "-",
          ...subjVars,
        });
        if (send.success) {
          await patch("daily_records", `id=eq.${r.id}`, { report_sent: "전송" });
          sent++;
          results.push({ ...preview, ok: true });
        } else {
          results.push({ ...preview, ok: false, reason: send.reason || (send.skipped ? "솔라피 미설정" : "발송 실패") });
        }
      }
      return res.status(200).json({ date, total: results.length, sent, dryRun, results, solapi: Boolean(TPL.daily) });
    }

    // ── 🔁 재시 안내 학부모 카톡 (단어테스트 불통과 → 다음 수업에 재시) ──────
    // body: { date, dryRun?, student_ids?[] }
    //
    // 왜 따로 있나: 데일리 리포트 카톡은 **그날 전원**에게 나가는 요약이고,
    // 이건 **불통과한 아이만** 받는 "다음 시간 재시" 안내입니다. 문구가 달라서
    // 카카오 템플릿도 따로 등록해야 합니다 (`TPL_RETEST`).
    // 큐는 save-record 가 자동으로 올려줍니다 — 선생님은 보내기만 누르면 됩니다.
    if (action === "send-retest") {
      const date = req.body.date || now.date;
      if (!okDate(date)) throw new BadRequest(`날짜가 올바르지 않아요: ${date}`);
      const only = Array.isArray(req.body.student_ids) ? new Set(req.body.student_ids) : null;
      const dryRun = Boolean(req.body.dryRun);

      const students = await select("students", `status=eq.재원${teacherFilter(req)}`);
      const stuBy = Object.fromEntries(students.map((s) => [s.id, s]));
      const records = (await select("daily_records", `date=eq.${date}`))
        .filter((r) => stuBy[r.student_id] && (only ? only.has(r.student_id) : true))
        .filter((r) => needsRetest(r) && r.lateness !== "결석");

      const results = [];
      let sent = 0;
      for (const r of records) {
        const stu = stuBy[r.student_id];
        const rBooks = r.books || {}, sBooks = stu.books || {};
        const book = String(rBooks["단어"] || sBooks["단어"] || "-");
        const unit = unitLabel((r.progress || {})["단어"]) || "-";
        const preview = {
          student_id: stu.id, name: stu.name, phone: stu.phone || "",
          book, unit, score: r.voca_score || "-",
          already: r.retest_sent === "전송",
        };
        const phone = String(stu.phone || "").replace(/[^0-9]/g, "");
        if (phone.length < 10) { results.push({ ...preview, ok: false, reason: "연락처 없음" }); continue; }
        if (dryRun) { results.push({ ...preview, ok: true }); continue; }

        const send = await sendAlimtalk(stu.phone, TPL.retest, {
          "#{학생이름}": stu.name,
          "#{날짜}": date,
          "#{단어교재}": book,
          "#{단어테스트}": unit,
          "#{점수}": preview.score,
        });
        if (send.success) {
          await patch("daily_records", `id=eq.${r.id}`, { retest_sent: "전송" });
          sent++;
          results.push({ ...preview, ok: true });
        } else {
          results.push({ ...preview, ok: false, reason: send.reason || (send.skipped ? "솔라피/TPL_RETEST 미설정" : "발송 실패") });
        }
      }
      // pass = 통과 기준(%) — 미리보기 모달이 "무슨 기준으로 고른 건지" 를 적어줍니다
      return res.status(200).json({ date, total: results.length, sent, dryRun, results, pass: RETEST_PASS, solapi: Boolean(TPL.retest) });
    }

    // ── 학생 저장(추가/수정) ──
    if (action === "save-student") {
      const s = req.body.student || {};
      if (!s.name) return res.status(400).json({ error: "이름은 필수예요." });
      const row = {
        name: s.name, student_code: s.student_code || null,
        pin: s.pin || null, phone: s.phone || null,
        grade: s.grade || null, school: s.school || null, teacher: s.teacher || null,
        class_minutes: Number(s.class_minutes) || 120,
        status: s.status || "재원",
        schedule: s.schedule || {}, books: s.books || {},
      };
      await 핀겹치나(row, s.id);
      let saved;
      if (s.id) saved = (await patch("students", `id=eq.${s.id}`, row))[0];
      else saved = (await insert("students", row))[0];
      return res.status(200).json({ student: saved });
    }

    // ── 학생 삭제 ──
    if (action === "delete-student") {
      if (!req.body.id) return res.status(400).json({ error: "id 필요" });
      await remove("students", `id=eq.${req.body.id}`);
      return res.status(200).json({ ok: true });
    }

    // ── 붙여넣기 일괄 등록 (name, pin, phone, grade 순 탭 구분) ──
    if (action === "bulk-students") {
      const rows = (req.body.rows || [])
        .filter((r) => r.name)
        .map((r) => ({
          name: r.name, student_code: r.student_code || null,
          pin: r.pin || null, phone: r.phone || null,
          grade: r.grade || null, school: r.school || null, teacher: r.teacher || null,
          class_minutes: Number(r.class_minutes) || 120,
          schedule: r.schedule || {}, books: r.books || {},
        }));
      if (!rows.length) return res.status(400).json({ error: "등록할 학생이 없어요." });
      // ★ 붙여넣은 것들끼리 PIN 이 겹치나 (시트에서 복사하면 흔히 생깁니다)
      const 핀들 = rows.map((r) => String(r.pin || "").trim()).filter(Boolean);
      const 겹친 = [...new Set(핀들.filter((p, i) => 핀들.indexOf(p) !== i))];
      if (겹친.length) {
        return res.status(400).json({ error:
          `붙여넣은 명단 안에서 출결PIN 이 겹칩니다: ${겹친.join(", ")}. ` +
          `키오스크는 PIN 만으로 학생을 찾기 때문에 겹치면 엉뚱한 학생으로 등원됩니다 — 시트에서 고쳐 다시 붙여넣어 주세요.` });
      }
      // ★ 이미 있는 학생과 겹치나
      for (const r of rows) await 핀겹치나(r, null);
      const saved = await insert("students", rows);
      return res.status(200).json({ count: saved.length });
    }

    // ── 키오스크: PIN 등원/하원 토글 ──
    if (action === "checkin") {
      const pin = String(req.body.pin || "").trim();
      if (!pin) return res.status(400).json({ error: "PIN을 입력하세요." });
      const found = await select("students", `pin=eq.${encodeURIComponent(pin)}&status=eq.재원`);
      const student = found[0];
      if (!student) return res.status(404).json({ error: "PIN을 찾을 수 없어요." });
      // ★ 같은 PIN 을 쓰는 학생이 둘 이상이면 **누가 눌렀는지 알 수 없습니다.**
      //   아무 쪽으로 처리하면 엉뚱한 집에 등원 카톡이 갑니다 — 멈추고 알립니다.
      if (found.length > 1) {
        return res.status(409).json({ error:
          `이 PIN 을 ${found.map((x) => x.name).join("·")} 학생이 같이 쓰고 있어서 누구인지 알 수 없어요. ` +
          `학생 관리에서 한 명의 PIN 을 다른 번호로 바꿔주세요.` });
      }

      const row = await ensureTodayRow(student.id, now.date);
      if (row.check_in && !row.check_out) {
        // 이미 등원 → 하원 처리
        const upd = (await patch("daily_records", `id=eq.${row.id}`, { check_out: now.hhmm }))[0];
        // 학부모 하원 알림톡 (미설정이면 조용히 skip) — 키오스크 하원에서만 발송.
        // 현황판 하원(action=checkout)은 실사용과 동일하게 카톡을 보내지 않는다.
        await sendAlimtalk(student.phone, TPL.checkout, {
          "#{학생이름}": student.name, "#{하원시간}": upd.check_out,
        });
        return res.status(200).json({ mode: "out", name: student.name, grade: student.grade, time: upd.check_out, check_in: row.check_in });
      }
      if (row.check_out) {
        return res.status(200).json({ mode: "done", name: student.name, grade: student.grade, time: row.check_out });
      }
      // 등원 처리
      const scheduled = (student.schedule || {})[now.weekday] || "";
      const late = lateness(scheduled, now.hhmm);
      const expectedEnd = addMinutes(now.hhmm, student.class_minutes);
      const upd = (await patch("daily_records", `id=eq.${row.id}`, {
        check_in: now.hhmm, lateness: late,
      }))[0];
      // 학부모 등원 알림톡 (미설정이면 조용히 skip)
      const sent = await sendAlimtalk(student.phone, TPL.checkin, {
        "#{학생이름}": student.name, "#{등원시간}": now.hhmm, "#{하원시간}": expectedEnd,
      });
      await patch("daily_records", `id=eq.${row.id}`, {
        kakao_sent: sent.success ? "전송" : sent.skipped ? "미전송" : "실패",
      });
      return res.status(200).json({
        mode: "in", name: student.name, grade: student.grade, time: upd.check_in,
        lateness: late, expected_end: expectedEnd,
      });
    }

    // ── 현황판: 하원 처리 (실사용 현황판과 동일 — 카톡 안 보내고 시간만 기록) ──
    if (action === "checkout") {
      const { student_id } = req.body;
      const row = await ensureTodayRow(student_id, now.date);
      const upd = (await patch("daily_records", `id=eq.${row.id}`, {
        check_out: now.hhmm,
        check_in: row.check_in || now.hhmm,
        lateness: row.lateness || "정시",
      }))[0];
      return res.status(200).json({ record: upd });
    }

    // ── 미등원 학부모 알림톡 (현황판 버튼에서 호출) ──
    if (action === "notify-absent") {
      const students = await select("students", "status=eq.재원");
      const records = await select("daily_records", `date=eq.${now.date}`);
      const recBy = Object.fromEntries(records.map((r) => [r.student_id, r]));
      let sent = 0;
      for (const s of students) {
        const scheduled = (s.schedule || {})[now.weekday] || "";
        if (!scheduled) continue;
        if (toMinutes(now.hhmm) <= toMinutes(scheduled) + GRACE) continue; // 아직 유예 안 지남
        const rec = recBy[s.id];
        if (rec?.check_in) continue; // 이미 등원
        const r = await sendAlimtalk(s.phone, TPL.late, {
          "#{학생이름}": s.name, "#{예정시간}": scheduled,
        });
        if (r.success) sent++;
      }
      return res.status(200).json({ sent });
    }

    // ── 오늘 한 줄 기록 저장 (진도·태도·과제·단어테스트·메모) ──
    if (action === "save-record") {
      const { student_id, date, fields } = req.body;
      const d = date || now.date;
      const row = await ensureTodayRow(student_id, d);
      const allow = ["attitude", "homework", "voca_test", "voca_score", "progress",
                     "note", "parent_note", "lateness", "check_out"];
      const body = {};
      for (const k of allow) if (k in (fields || {})) body[k] = fields[k];
      // ★ 단어테스트를 「불통과」로 누르거나 **점수가 기준 미달**이면 재시 안내 카톡 큐에
      //   자동으로 올린다. (운영과 같은 방식 — 선생님이 따로 "재시 보내기" 를 기억하지
      //   않아도 되게. retest_sent 는 선생님이 직접 고치는 칸이 아니라서 allow 에 없습니다)
      //   점수만 적고 통과/불통과를 안 누르는 게 흔해서 점수까지 같이 봅니다.
      const 새결과 = "voca_test" in (fields || {}) ? fields.voca_test : row.voca_test;
      const 새점수 = "voca_score" in (fields || {}) ? fields.voca_score : row.voca_score;
      const q = retestQueueValue(row.retest_sent, 새결과, 새점수);
      if (q !== undefined) body.retest_sent = q;
      const upd = (await patch("daily_records", `id=eq.${row.id}`, body))[0];
      // 진도를 고쳤으면 그 유닛의 자동 과제도 따라 바뀌어야 합니다.
      //   (선생님이 손으로 낸 과제는 syncAutoTasks 가 건드리지 않습니다)
      if ("progress" in body) {
        const stu = (await select("students", `id=eq.${student_id}&limit=1`))[0];
        if (stu) await syncAutoTasks(stu, d, body.progress, await tocByBook());
      }
      // 화면이 바로 「🔁 재시 안내」 개수와 점수칸 안내를 고칠 수 있게 같이 돌려줍니다
      return res.status(200).json({
        record: upd,
        needs_retest: needsRetest(upd),
        retest_hint: retestHint(upd.voca_test, upd.voca_score),
      });
    }

    // ── 교재 바꾸기 (그 과목 교재를 다음 권으로) ──
    // body: { student_id, date, subject, book }
    //
    // 왜 여기 있나: 교재는 학생 정보라 원래 /students.html 에서 바꿉니다. 그런데
    //   **교재를 다 끝낸 날**은 데일리 리포트를 쓰다가 알게 돼요. 그때 학생 관리로
    //   건너갔다 오는 게 번거로워서, 그 자리에서 바꿀 수 있게 했습니다.
    //
    // 세 가지를 같이 합니다 (하나라도 빠지면 어긋납니다):
    //   ① 학생DB의 교재 → 다음 수업부터 새 교재로 진도가 나갑니다
    //   ② 그날 행의 교재 → 이미 만들어진 행은 옛 교재를 들고 있습니다
    //   ③ 그날 진도를 **새 교재 목차 1번**으로 → 옛 유닛은 새 목차에 없어서 멈춰버립니다
    if (action === "change-book") {
      const { student_id, subject } = req.body;
      const d = req.body.date || now.date;
      const book = String(req.body.book || "").trim();
      if (!student_id || !subject) throw new BadRequest("학생과 과목이 필요해요.");
      if (!okDate(d)) throw new BadRequest(`날짜가 올바르지 않아요: ${d}`);

      const stu = (await select("students", `id=eq.${student_id}&limit=1`))[0];
      if (!stu) throw new BadRequest("그 학생을 찾을 수 없어요. 화면을 새로고침한 뒤 다시 해주세요.");

      const toc = await tocByBook();
      if (book && !toc[book]) {
        // 막지는 않지만, 목차가 없으면 진도가 안 넘어가니 미리 말해줍니다
        //   (교재DB에 없는 이름이면 아예 고를 수 없게 화면에서 막아두었습니다)
      }

      // ① 학생DB
      const books = { ...(stu.books || {}) };
      if (book) books[subject] = book; else delete books[subject];
      await patch("students", `id=eq.${student_id}`, { books });

      // ② 그날 행
      const row = await ensureTodayRow(student_id, d);
      const rBooks = { ...(row.books || {}) };
      if (book) rBooks[subject] = book; else delete rBooks[subject];

      // ③ 진도를 새 교재 1번으로
      const progress = { ...(row.progress || {}) };
      const units = book ? (toc[book]?.units || []) : [];
      if (units.length) progress[subject] = units[0];
      else delete progress[subject];

      const upd = (await patch("daily_records", `id=eq.${row.id}`, { books: rBooks, progress }))[0];
      await syncAutoTasks({ ...stu, books }, d, progress, toc);
      return res.status(200).json({ record: upd, books });
    }

    // ── 교재(목차) 저장/삭제 ──
    if (action === "save-textbook") {
      const t = req.body.textbook || {};
      if (!t.name) return res.status(400).json({ error: "교재명은 필수예요." });
      const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
      const row = {
        subject: t.subject || null,
        name: t.name,
        price: num(t.price),
        stock_total: num(t.stock_total),
        distributed: num(t.distributed) ?? 0,
        units: Array.isArray(t.units) ? t.units : [],
        step: Number(t.step) > 0 ? Number(t.step) : 1,
      };
      const saved = t.id
        ? (await patch("textbooks", `id=eq.${t.id}`, row))[0]
        : (await insert("textbooks", row))[0];
      return res.status(200).json({ textbook: saved });
    }
    if (action === "delete-textbook") {
      if (!req.body.id) return res.status(400).json({ error: "id 필요" });
      await remove("textbooks", `id=eq.${req.body.id}`);
      return res.status(200).json({ ok: true });
    }

    // ── 오늘 진도 자동 채우기 (목차의 다음 유닛으로) ──
    if (action === "advance-today") {
      const today = now.date;
      const students = await select("students", "status=eq.재원");
      const toc = await tocByBook();
      let updated = 0;
      for (const s of students) {
        const rows = await select("daily_records", `student_id=eq.${s.id}&date=eq.${today}&select=id`);
        if (!rows[0]) continue; // 오늘 행 없으면 skip
        // 결석한 날은 건너뛰고 마지막으로 나온 날에서 이어갑니다 (lastAttendedProgress 주석 참고)
        const prev = await lastAttendedProgress(s.id, today);
        await patch("daily_records", `id=eq.${rows[0].id}`, {
          progress: advanceProgress(prev, s.books, toc),
        });
        updated++;
      }
      return res.status(200).json({ updated });
    }

    // ── 📋 학생 카드: 한 학생의 이전 진도·테스트·과제를 기간으로 쭉 ────────
    //   ?action=student-history&student_id=...&days=30   (days = 7 / 30 / 90)
    //
    // 왜 따로 있나: daily.html 의 📜 최근 수업은 **오늘 행 안에서 8회**까지입니다.
    // "이 아이가 지난 3달 동안 어디서 멈췄나 / 단어를 계속 못 넘기나" 는 그걸로
    // 안 보여서, 운영(studyplanner `student_card.html`)처럼 한 명짜리 화면을 뒀습니다.
    if (action === "student-history") {
      const sid = String(req.query.student_id ?? "").trim();
      if (BAD_ID.test(sid) || !SAFE_ID.test(sid)) throw new BadRequest("학생을 골라주세요.");
      const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
      const from = new Date(new Date(`${now.date}T00:00:00Z`).getTime() - days * 86400000)
        .toISOString().slice(0, 10);

      const [stu, records, tasks] = await Promise.all([
        select("students", `id=eq.${sid}`),
        select("daily_records", `student_id=eq.${sid}&date=gte.${from}&order=date.desc`),
        // 과제 표가 아직 없는 분(migrate_tasks.sql 미실행)도 화면이 열리게
        select("tasks", `student_id=eq.${sid}&date=gte.${from}&order=date.desc`).catch(() => []),
      ]);
      if (!stu[0]) return res.status(404).json({ error: "학생을 찾을 수 없어요." });
      const s = stu[0];

      // 날짜별 과제 집계 (✓완료 / ✗미완료) — 표 한 칸에 넣으려고 서버에서 세어 준다
      const taskBy = {};
      for (const t of tasks) {
        const o = (taskBy[t.date] ||= { done: 0, undone: 0, items: [] });
        if (t.done) o.done++; else o.undone++;
        o.items.push({ kind: t.kind, subject: t.subject, title: t.title, done: t.done });
      }

      // 과목은 고정하지 않는다 — 교재·진도(jsonb)에 실제로 들어 있는 키를 쓴다.
      // (영어 문법·리딩·단어든 수학 연산·교과든 그대로 돌아가게)
      const subjects = [...new Set([
        ...SUBJECTS.filter((x) => (s.books || {})[x] || records.some((r) => (r.progress || {})[x])),
        ...Object.keys(s.books || {}),
        ...records.flatMap((r) => Object.keys(r.progress || {})),
      ])];

      return res.status(200).json({
        days, from, to: now.date,
        student: {
          id: s.id, name: s.name, grade: s.grade, school: s.school || null, teacher: s.teacher,
          student_code: s.student_code, books: s.books || {}, schedule: s.schedule || {},
        },
        subjects,
        rows: records.map((r) => ({
          date: r.date,
          progress: r.progress || {},
          books: r.books || {},
          voca_test: r.voca_test || null,
          voca_score: r.voca_score || null,
          attitude: r.attitude || null,
          homework: r.homework || null,
          lateness: r.lateness || null,
          check_in: r.check_in || null,
          check_out: r.check_out || null,
          note: r.note || null,
          parent_note: r.parent_note || null,
          report_sent: r.report_sent || null,
          retest_sent: r.retest_sent || null,
          needs_retest: needsRetest(r),
          tasks: taskBy[r.date] || null,
        })),
        // 수업이 없던 날 낸 과제도 빠뜨리지 않게 날짜별 과제를 통째로 같이 보낸다
        tasks: taskBy,
      });
    }

    // ── 담당 선생님 목록 (선생님앱 첫 화면에서 고른다) ──
    if (action === "teachers") {
      // 담당 선생님 · 학교 · 학년 — **지금 쓰고 있는 값**들을 모아서 돌려줍니다.
      //   학생 추가 화면의 고르는 칸(select)을 이걸로 채웁니다. 손으로 칠 때마다
      //   「이선생 / 이 선생 / 이선생님」 처럼 조금씩 달라지면 담당별 보기가 갈라집니다.
      //   목록에 없는 건 그 화면에서 「+ 직접 입력」 으로 새로 넣을 수 있습니다.
      //   학교 칸이 아직 없는 DB(쓰던 DB)에서도 화면이 열려야 하므로 따로 물어봅니다.
      const rows = await select("students", "status=eq.재원&select=teacher,grade");
      const 모으기 = (키) => [...new Set(rows.map((r) => String(r[키] || "").trim()).filter(Boolean))].sort();
      const schools = await select("students", "status=eq.재원&select=school")
        .then((r) => [...new Set(r.map((x) => String(x.school || "").trim()).filter(Boolean))].sort())
        .catch(() => []);   // migrate_school.sql 을 아직 안 돌린 분
      return res.status(200).json({ teachers: 모으기("teacher"), grades: 모으기("grade"), schools });
    }

    // ── 과제 현황 (선생님앱) — 그날 낸 과제와 학생 체크 여부 ──
    // 하루치(기본) 또는 기간 조회.
    //   ?date=2026-10-13                  → 그날 하루 (선생님앱 기본 화면)
    //   ?from=2026-10-01&to=2026-10-31     → 기간 (학생별 과제 이력)
    //   ?student_id=...                    → 그 학생만
    // 기간 조회를 넣은 이유: 예전에는 '오늘' 밖에 못 봐서
    // "이 아이가 지난달에 과제를 몇 번 빼먹었나" 를 볼 데가 없었습니다.
    if (action === "tasks") {
      const { from, to, student_id } = req.query;
      const date = req.query.date || now.date;
      const ranged = Boolean(from || to);
      const f = from || to || date;
      const t2 = to || from || date;
      if (ranged && (!okDate(f) || !okDate(t2))) {
        return res.status(400).json({ error: `날짜가 올바르지 않아요: ${f} ~ ${t2}` });
      }
      const students = await select("students", `status=eq.재원&order=name.asc${teacherFilter(req)}`);
      const ids = new Set(students.map((s) => s.id));
      const where = ranged
        ? `date=gte.${f}&date=lte.${t2}&order=date.desc,kind.asc`
        : `date=eq.${date}&order=kind.asc`;
      const all = await select("tasks", where);
      let tasks = all.filter((t) => ids.has(t.student_id)); // 담당 학생 것만
      if (student_id) tasks = tasks.filter((t) => t.student_id === student_id);
      const nameBy = Object.fromEntries(students.map((s) => [s.id, s.name]));
      // 같은 학생 과제가 **한 덩어리로** 보이게 묶어 줍니다.
      //   예전에는 집/학원 으로만 줄을 세워서, 한 아이 과제가 목록 여기저기에
      //   흩어졌습니다(12명 42줄이면 민준이 것이 네 군데에 떨어집니다).
      //   학생 순서는 위 명단(name.asc)을 그대로 따릅니다 — 화면의 학생 드롭다운과 같은 순서.
      const rank = Object.fromEntries(students.map((s, i) => [s.id, i]));
      tasks.sort((a, b) =>
        // 기간 조회(과제 이력)는 날짜를 먼저 봅니다 — 최근 것부터 읽는 화면이라서
        (ranged ? String(b.date).localeCompare(String(a.date)) : 0) ||
        (rank[a.student_id] ?? 0) - (rank[b.student_id] ?? 0) ||
        String(a.kind || "").localeCompare(String(b.kind || "")) ||   // 집 → 학원
        String(a.title || "").localeCompare(String(b.title || ""))
      );
      // 기간 조회면 완료율을 같이 계산해 준다 (화면에서 다시 세지 않게)
      const summary = ranged
        ? (() => {
            const total = tasks.length, done = tasks.filter((t) => t.done).length;
            return { total, done, rate: total ? Math.round((done / total) * 100) : null };
          })()
        : null;
      return res.status(200).json({
        date, from: ranged ? f : null, to: ranged ? t2 : null, summary,
        students: students.map((s) => ({ id: s.id, name: s.name, grade: s.grade, books: s.books || {} })),
        tasks: tasks.map((t) => ({
          id: t.id, student_id: t.student_id, name: nameBy[t.student_id] || "",
          date: t.date, kind: t.kind, subject: t.subject, title: t.title,
          done: t.done, done_at: t.done_at,
          auto: t.auto === true,   // 진도에서 저절로 생긴 과제인지 (화면에 표시)
        })),
      });
    }

    // ── 과제 내주기 — 고른 학생들에게 같은 항목을 한 번에 ──
    // body: { date, student_ids:[...], items:[{kind,subject,title}, ...] }
    if (action === "save-tasks") {
      const date = req.body.date || now.date;
      const ids = Array.isArray(req.body.student_ids) ? req.body.student_ids : [];
      const items = (Array.isArray(req.body.items) ? req.body.items : [])
        .filter((it) => String(it?.title || "").trim());
      if (!ids.length) return res.status(400).json({ error: "학생을 한 명 이상 골라주세요." });
      if (!items.length) return res.status(400).json({ error: "과제 내용을 한 줄 이상 적어주세요." });

      const rows = [];
      for (const sid of ids) {
        for (const it of items) {
          rows.push({
            student_id: sid,
            date,
            kind: it.kind === "학원" ? "학원" : "집",
            subject: String(it.subject || "").trim() || null,
            title: String(it.title).trim(),
          });
        }
      }
      const created = await insert("tasks", rows);
      return res.status(200).json({ created: created.length });
    }

    if (action === "delete-task") {
      if (!req.body.id) return res.status(400).json({ error: "id 필요" });
      await remove("tasks", `id=eq.${req.body.id}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `알 수 없는 action: ${action}` });
  } catch (e) {
    // 입력이 잘못된 것(BadRequest)은 400 으로, 진짜 서버 사고만 500 으로.
    // 500 에는 PostgREST 원문이 그대로 실려 화면에 내부 메시지가 노출되므로 구분합니다.
    if (e instanceof BadRequest || e instanceof DbInputError)
      return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
