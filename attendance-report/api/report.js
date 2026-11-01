// 월말평가서 API (Vercel serverless).
// 화면(report.html / parent.html)이 이 파일 하나로 다 통신한다.
//
// 액션:
//   GET  ?action=students&month=YYYY-MM   → 학생 목록 + 이번 달 통계 + 평가서 유무
//   POST {action:"generate", student_id, month} → 통계 집계 + Claude로 본문 생성(저장 X)
//   POST {action:"save", student_id, month, body, stats, progress} → 저장 → share_token 반환
//   GET  ?action=parent&token=xxx         → 학부모 열람 (해당 학생 월별 이력)
//   POST {action:"send", month}           → 저장된 평가서들의 학부모 열람 링크 목록

import { select, upsert, patch, remove, dbConfigured, DbInputError } from "../lib/db.js";
import { normUnit } from "../lib/progress.js";
import { generateReport, claudeConfigured } from "../lib/claude.js";
import { sendAlimtalk, solapiConfigured, TPL } from "../lib/solapi.js";

// ── 한 달 날짜 범위 ★ ───────────────────────────────────
// "YYYY-MM" → `date=gte.YYYY-MM-01&date=lt.(다음달)-01`
//
// ⚠️ 예전에는 `date=lte.${month}-31` 로 썼는데, **30일까지인 달과 2월에서 터집니다.**
//    2026-09-31 같은 날짜는 없으므로 PostgreSQL 이
//    `date/time field value out of range` (400) 를 돌려줍니다.
//    → 4·6·9·11·2월 평가서에서 학부모 화면·선생님 화면이 전부 깨졌습니다.
//    마지막 날을 계산하는 대신 **다음 달 1일 미만(lt)** 으로 두면 어떤 달이든 안전합니다.
// 「2026-09」 형식인지. 아니면 그대로 DB 로 가서 PostgreSQL 원문이 화면에 뜹니다.
export function okMonth(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || ""));
  return Boolean(m) && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function monthFilter(month) {
  // DbInputError 로 던지면 아래 catch 가 **400** 으로 돌려줍니다 (500 이면 화면에 DB 원문이 뜸).
  if (!okMonth(month)) throw new DbInputError(`연월이 올바르지 않아요: ${month} (예: 2026-09)`);
  const [y, m] = String(month).split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const next = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return `date=gte.${month}-01&date=lt.${next}`;
}

// ── 집계: 그 달 daily_records → planner (2차 getMonthlyPlannerData 형식) ──
// 이 planner가 AI 지침(reportGuideline)의 재료가 된다.
function computePlanner(records, books, taskStats) {
  const attended = records.filter((r) => r.lateness !== "결석");
  const cnt = (arr, f) => arr.filter(f).length;
  // 노션 이관 데이터 값 흡수: 정시등원=정시, 과제 100%완료=상
  const isOnTime = (v) => v === "정시" || v === "정시등원";
  const isTopHw = (v) => v === "상" || v === "100%완료";

  const 출석 = {
    정시등원: cnt(records, (r) => isOnTime(r.lateness)),
    지각: cnt(records, (r) => r.lateness === "지각"),
    결석: cnt(records, (r) => r.lateness === "결석"),
  };
  const 태도 = {
    상: cnt(attended, (r) => r.attitude === "상"),
    중: cnt(attended, (r) => r.attitude === "중"),
    하: cnt(attended, (r) => r.attitude === "하"),
  };
  const 과제 = {
    상: cnt(attended, (r) => isTopHw(r.homework)),
    중: cnt(attended, (r) => r.homework === "중"),
    하: cnt(attended, (r) => r.homework === "하"),
  };
  const vocaGraded = attended.filter((r) => r.voca_test === "통과" || r.voca_test === "불통과");
  const 단어테스트 = {
    총횟수: vocaGraded.length,
    통과: cnt(vocaGraded, (r) => r.voca_test === "통과"),
    미통과: cnt(vocaGraded, (r) => r.voca_test === "불통과"),
  };

  const sorted = [...records].sort((a, b) => (a.date < b.date ? -1 : 1));
  const firstRec = sorted[0] || {};
  const lastRec = sorted[sorted.length - 1] || {};
  const cur = books || {};
  // 그날 교재 스냅샷(daily_records.books) 우선, 없으면 학생 현재 교재
  const bookOf = (rec, 영역) => (rec.books && rec.books[영역]) || cur[영역] || "";
  const progOf = (rec) => {
    const out = {};
    const prog = rec.progress || {};
    for (const 영역 of ["문법", "리딩", "단어"]) {
      const 교재 = bookOf(rec, 영역);
      const u = normUnit(prog[영역]); // {code,title} (예전 문자열도 흡수)
      if (!교재 && !u) continue;
      out[영역] = { 교재명: 교재, 유닛코드: u?.code || "", 제목: u?.title || "" };
    }
    return out;
  };

  // 교재 전환: 그 달 첫 기록 교재 vs 마지막 기록 교재가 다르면 전환으로 기록
  const 교재전환 = [];
  for (const 영역 of ["문법", "리딩", "단어"]) {
    const b1 = bookOf(firstRec, 영역), b2 = bookOf(lastRec, 영역);
    if (b1 && b2 && b1 !== b2) 교재전환.push({ 영역, 이전교재: b1, 새교재: b2 });
  }

  return {
    총수업일수: records.length,
    출석,
    태도,
    과제,
    // 학생이 **앱에서 직접 체크한** 과제 실적. 위의 `과제` 는 선생님이 매긴 등급이고
    // 이건 학생이 실제로 한 것이라 서로 다릅니다. 둘 다 있어야 평가서가 공정해집니다.
    // (예전에는 학생이 체크해도 어디에도 안 쓰여서, 체크할 이유가 없었습니다)
    ...(taskStats ? { 과제체크: taskStats } : {}),
    단어테스트,
    월초진도: progOf(firstRec),
    최종진도: progOf(lastRec),
    교재전환,
  };
}

// 그 달 학생이 받은 과제와 체크한 개수 → {총건수, 완료, 완료율}
// 과제가 하나도 없으면 null 을 돌려줘서 평가서에 빈 줄이 안 생기게 합니다.
async function taskStatsFor(studentId, month) {
  const rows = await select("tasks", `student_id=eq.${studentId}&${monthFilter(month)}&select=done,kind`);
  if (!rows.length) return null;
  const 완료 = rows.filter((t) => t.done).length;
  const byKind = (k) => {
    const sub = rows.filter((t) => t.kind === k);
    return sub.length ? { 총건수: sub.length, 완료: sub.filter((t) => t.done).length } : null;
  };
  return {
    총건수: rows.length,
    완료,
    완료율: Math.round((완료 / rows.length) * 100),
    ...(byKind("집") ? { 집과제: byKind("집") } : {}),
    ...(byKind("학원") ? { 학원과제: byKind("학원") } : {}),
  };
}

// 화면(선생님 목록·학부모)용 요약 통계
function displayStats(p) {
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const hwTotal = p.과제.상 + p.과제.중 + p.과제.하;
  const atTotal = p.태도.상 + p.태도.중 + p.태도.하;
  return {
    classDays: p.출석.정시등원 + p.출석.지각,
    late: p.출석.지각,
    absent: p.출석.결석,
    vocaRate: pct(p.단어테스트.통과, p.단어테스트.총횟수),
    hwRate: pct(p.과제.상, hwTotal),
    atRate: pct(p.태도.상, atTotal), // 태도 상 비율 (부모님 화면 바 그래프)
    // 학생이 앱에서 체크한 과제 완료율 (과제를 안 내준 달이면 null → 화면에서 숨김)
    taskRate: p.과제체크 ? p.과제체크.완료율 : null,
    taskDone: p.과제체크 ? p.과제체크.완료 : null,
    taskTotal: p.과제체크 ? p.과제체크.총건수 : null,
  };
}

// 데일리 기록이 없을 때, 저장된 통계(stats)로 근사 planner를 만든다 (부모님 화면 그래프용).
// 정확한 상/중/하 카운트는 없으므로 비율을 카운트처럼 근사한다.
function pseudoPlanner(stats, progress) {
  const st = stats || {};
  const classDays = st.classDays ?? 0;      // 정시+지각
  const late = st.late ?? 0, absent = st.absent ?? 0;
  const 정시 = Math.max(0, classDays - late);
  const total = classDays + absent;         // 총수업일수(결석 포함)
  const fromRate = (rate) => {              // 상 비율(%) → {상,중,하} 근사
    const 상 = Math.round(((rate ?? 0) / 100) * total);
    return { 상, 중: Math.max(0, total - 상), 하: 0 };
  };
  const voca통과 = Math.round(((st.vocaRate ?? 0) / 100) * total);
  return {
    총수업일수: total,
    출석: { 정시등원: 정시, 지각: late, 결석: absent },
    태도: fromRate(st.atRate),
    과제: fromRate(st.hwRate),
    단어테스트: { 총횟수: total, 통과: voca통과, 미통과: Math.max(0, total - voca통과) },
    월초진도: {},
    최종진도: progress || {},
    교재전환: [],
  };
}

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${req.headers.host}`;
}

export default async function handler(req, res) {
  if (!dbConfigured()) {
    return res.status(500).json({
      error: "Supabase 환경변수(SUPABASE_URL, SUPABASE_SERVICE_KEY)가 설정되지 않았어요.",
    });
  }

  try {
    const action = req.method === "GET" ? req.query.action : (req.body?.action ?? "");

    // ── 학생 목록 + 통계 + 평가서 유무 ──────────────────
    if (action === "students") {
      const month = req.query.month;
      if (!month) return res.status(400).json({ error: "month(YYYY-MM)가 필요해요." });

      const students = await select("students", "status=eq.재원&order=name.asc");
      const records = await select(
        "daily_records",
        `${monthFilter(month)}&select=student_id,date,lateness,attitude,homework,voca_test,progress`
      );
      const reports = await select(
        "monthly_reports",
        `month=eq.${month}&select=student_id,share_token,kakao_sent`
      );
      const reportBy = Object.fromEntries(reports.map((r) => [r.student_id, r]));

      // 그 달 과제를 **한 번에** 가져와 학생별로 묶는다 (학생 수만큼 조회하지 않게).
      const taskRows = await select("tasks", `${monthFilter(month)}&select=student_id,done,kind`);
      const taskBy = {};
      for (const t of taskRows) (taskBy[t.student_id] ||= []).push(t);
      for (const id of Object.keys(taskBy)) {
        const rows = taskBy[id];
        const 완료 = rows.filter((t) => t.done).length;
        taskBy[id] = { 총건수: rows.length, 완료, 완료율: Math.round((완료 / rows.length) * 100) };
      }

      const list = students.map((s) => {
        const recs = records.filter((r) => r.student_id === s.id);
        const rep = reportBy[s.id];
        return {
          id: s.id,
          name: s.name,
          grade: s.grade,
          stats: displayStats(computePlanner(recs, s.books, taskBy[s.id] || null)),
          hasRecords: recs.length > 0,
          hasReport: Boolean(rep),
          share_token: rep?.share_token || null,
          kakao_sent: rep?.kakao_sent || false,
        };
      });
      return res.status(200).json({ month, students: list });
    }

    // ── 미리보기: 그 달 planner 원본 (선생님 화면 차트용, 2차 previewReportData) ──
    if (action === "preview") {
      const { student_id, month } = req.method === "GET" ? req.query : req.body;
      if (!student_id || !month) return res.status(400).json({ error: "student_id, month 필요" });
      const students = await select("students", `id=eq.${student_id}&select=books,name,grade`);
      const student = students[0];
      if (!student) return res.status(404).json({ error: "학생을 찾을 수 없어요." });
      const records = await select(
        "daily_records",
        `student_id=eq.${student_id}&${monthFilter(month)}`
      );
      const planner = computePlanner(records, student.books, await taskStatsFor(student_id, month));
      return res.status(200).json({ hasRecords: records.length > 0, planner });
    }

    // ── AI 평가서 생성 (저장은 안 함) ────────────────────
    if (action === "generate") {
      if (!claudeConfigured()) {
        return res.status(400).json({
          error: "ANTHROPIC_API_KEY가 없어요. 통계만 보거나, 키를 넣고 다시 시도하세요.",
        });
      }
      const { student_id, month, comment: reqComment, middleSchool } = req.body;
      const students = await select("students", `id=eq.${student_id}`);
      const student = students[0];
      if (!student) return res.status(404).json({ error: "학생을 찾을 수 없어요." });

      const records = await select(
        "daily_records",
        `student_id=eq.${student_id}&${monthFilter(month)}`
      );
      // 참고사항: 화면에서 입력하면 그걸, 없으면 월말참고사항DB에서 읽음
      let comment = (reqComment ?? "").trim();
      if (!comment) {
        const comments = await select(
          "monthly_comments",
          `student_id=eq.${student_id}&month=eq.${month}&select=comment`
        );
        comment = comments[0]?.comment || "";
      }
      if (middleSchool) comment = (comment ? comment + "\n" : "") + "중학생 — 내신·서술형 대비 필요";
      // 그 달 데일리 지적사항(note) 모음 — 날짜순으로 평가서 작성에 반영
      const dailyNotes = [...records]
        .filter((r) => r.note && String(r.note).trim())
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((r) => `${String(r.date).slice(5).replace("-", "/")} ${String(r.note).trim()}`);
      const planner = computePlanner(records, student.books, await taskStatsFor(student_id, month));
      const body = await generateReport({ student, month, planner, comment, dailyNotes });
      const stats = displayStats(planner);
      const progress = planner.최종진도; // {과목:{교재명,유닛코드}}
      return res.status(200).json({ body, stats, progress, planner });
    }

    // ── 저장 ────────────────────────────────────────────
    if (action === "save") {
      const { student_id, month, body, stats, progress } = req.body;
      if (!student_id || !month) return res.status(400).json({ error: "student_id, month 필요" });
      const rows = await upsert(
        "monthly_reports",
        {
          student_id,
          month,
          body: body ?? "",
          stats: stats ?? {},
          progress: progress ?? {},
          updated_at: new Date().toISOString(),
        },
        "student_id,month"
      );
      return res.status(200).json({ ok: true, share_token: rows[0]?.share_token });
    }

    // ── 학부모 열람 (토큰 + 출결번호(PIN) 확인) ───────────────
    if (action === "parent") {
      const token = req.query.token;
      const pin = req.query.pin;
      if (!token) return res.status(400).json({ error: "링크가 올바르지 않아요." });
      const hit = await select("monthly_reports", `share_token=eq.${token}&select=student_id`);
      if (!hit[0]) return res.status(404).json({ error: "평가서를 찾을 수 없어요." });

      const studentId = hit[0].student_id;
      const students = await select("students", `id=eq.${studentId}&select=name,grade,books,pin`);
      const stu = students[0] || {};

      // 출결번호(PIN) 게이트 — 학생에 PIN이 있으면 일치해야 열람 가능
      const hasPin = Boolean(stu.pin);
      if (hasPin) {
        if (!pin) return res.status(200).json({ needPin: true, name: stu.name });
        if (String(stu.pin) !== String(pin).trim())
          return res.status(200).json({ needPin: true, name: stu.name, error: "출결번호가 일치하지 않아요." });
      }

      const saved = await select(
        "monthly_reports",
        `student_id=eq.${studentId}&order=month.desc&select=month,body,stats,progress`
      );

      // 2차 부모님 화면 방식: 저장된 평가서 본문 + 데일리리포트에서 planner 재계산(그래프 4종).
      // 데일리 기록이 없으면 저장 당시 통계로 근사 planner를 구성.
      const reports = [];
      for (const r of saved) {
        const recs = await select(
          "daily_records",
          `student_id=eq.${studentId}&${monthFilter(r.month)}`
        );
        const planner = recs.length
          ? computePlanner(recs, stu.books, await taskStatsFor(studentId, r.month))
          : pseudoPlanner(r.stats, r.progress);
        reports.push({ month: r.month, body: r.body, planner, live: recs.length > 0 });
      }
      return res.status(200).json({ student: { name: stu.name, grade: stu.grade }, reports });
    }

    // ── 선생님: 저장된 평가서 1건 조회 (수정용) ──
    if (action === "get") {
      const { student_id, month } = req.method === "GET" ? req.query : req.body;
      if (!student_id || !month) return res.status(400).json({ error: "student_id, month 필요" });
      const rows = await select(
        "monthly_reports",
        `student_id=eq.${student_id}&month=eq.${month}&select=month,body,stats,progress,share_token`
      );
      if (!rows[0]) return res.status(404).json({ error: "저장된 평가서가 없어요." });
      return res.status(200).json({ report: rows[0] });
    }

    // ── 선생님: 한 학생의 저장된 평가서 전체 목록 (기존 수정 탭) ──
    if (action === "student-reports") {
      const student_id = req.method === "GET" ? req.query.student_id : req.body.student_id;
      if (!student_id) return res.status(400).json({ error: "student_id 필요" });
      const rows = await select(
        "monthly_reports",
        `student_id=eq.${student_id}&order=month.desc&select=month,stats,share_token,kakao_sent,updated_at`
      );
      return res.status(200).json({ reports: rows });
    }

    // ── 선생님: 저장된 평가서가 하나라도 있는 학생만 (기존 수정 탭 드롭다운) ──
    if (action === "students-with-reports") {
      const reps = await select("monthly_reports", "select=student_id");
      const ids = [...new Set(reps.map((r) => r.student_id))];
      if (!ids.length) return res.status(200).json({ students: [] });
      const students = await select(
        "students",
        `id=in.(${ids.join(",")})&order=name.asc&select=id,name,grade`
      );
      return res.status(200).json({ students });
    }

    // ── 선생님: 저장된 평가서 삭제 ──
    if (action === "delete") {
      const { student_id, month } = req.body;
      if (!student_id || !month) return res.status(400).json({ error: "student_id, month 필요" });
      await remove("monthly_reports", `student_id=eq.${student_id}&month=eq.${month}`);
      return res.status(200).json({ ok: true });
    }

    // ── 학부모 열람 링크: 목록 반환 + (솔라피 설정 시) 미전송분 알림톡 발송 ──
    if (action === "send") {
      const { month, student_ids } = req.body;
      const only = Array.isArray(student_ids) ? new Set(student_ids) : null;
      let reports = await select(
        "monthly_reports",
        `month=eq.${month}&select=id,student_id,share_token,kakao_sent`
      );
      if (only) reports = reports.filter((r) => only.has(r.student_id));
      const students = await select("students", "select=id,name,phone,pin");
      const stuBy = Object.fromEntries(students.map((s) => [s.id, s]));
      const links = reports.map((r) => ({
        name: stuBy[r.student_id]?.name || "학생",
        phone: stuBy[r.student_id]?.phone || "",
        url: `${baseUrl(req)}/parent.html?t=${r.share_token}`,
      }));

      let sent = 0;
      if (solapiConfigured() && TPL.report) {
        for (const r of reports) {
          if (r.kakao_sent) continue; // 미전송분만
          const stu = stuBy[r.student_id];
          if (!stu?.phone) continue;
          const result = await sendAlimtalk(stu.phone, TPL.report, {
            "#{학생이름}": stu.name,
            "#{연월}": month,
            // 학부모 화면(parent.html)이 PIN을 묻기 때문에 함께 보낸다 (2차 템플릿과 동일)
            "#{출결번호}": stu.pin || "",
            "#{링크}": `${baseUrl(req)}/parent.html?t=${r.share_token}`,
          });
          if (result.success) {
            await patch("monthly_reports", `id=eq.${r.id}`, { kakao_sent: true });
            sent++;
          }
        }
      }
      return res.status(200).json({ links, sent, solapi: solapiConfigured() });
    }

    return res.status(400).json({ error: `알 수 없는 action: ${action}` });
  } catch (e) {
    // 입력이 잘못된 것은 400 으로. 500 으로 내보내면 화면에 DB 원문이 그대로 뜹니다.
    if (e instanceof DbInputError) return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
