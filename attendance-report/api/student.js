// 학생앱 API — 학생이 직접 쓰는 유일한 화면(student.html)의 뒷단.
//
// 로그인은 학생DB의 **학생ID(student_code) + 출결PIN(pin)** 으로 한다.
// 2차 세미나 때부터 쓰던 값이라 수강생이 새로 만들 게 없다 (키오스크 PIN과 같은 번호).
// 세션·쿠키를 쓰지 않고 매 요청에 code/pin 을 같이 보내 서버에서 확인한다 — 구조가 단순해서
// "학생이 비밀번호를 바꾸게 해줘" 같은 수정도 클로드에게 말로 시키기 쉽다.
//
// 액션 (전부 POST):
//   {action:"login",       code, pin}                 → 학생 확인
//   {action:"home",        code, pin}                 → 오늘 과제 + 내 진도 + 최근 리포트 + 월말평가서 링크
//   {action:"toggle-task", code, pin, task_id, done}  → 과제 체크/해제
//
// ⚠️ 학생은 '자기 것'만 볼 수 있어야 한다. 아래 모든 조회에 student_id=eq.<본인> 이 붙어 있다.
//    이 조건을 빼면 다른 학생 기록이 보인다 — 수정할 때 꼭 유지할 것.

import { select, patch, dbConfigured, DbInputError } from "../lib/db.js";
import { kstNow } from "../lib/time.js";
import { normUnit } from "../lib/progress.js";

const RECENT_DAYS = 14; // 학생앱에 보여줄 최근 리포트 기간

function unitLabel(u) {
  const n = normUnit(u);
  if (!n) return "";
  return [n.code, n.title].filter(Boolean).join(" ");
}

// code + pin 으로 학생 1명 확인. 못 찾으면 null.
async function auth(body) {
  const code = String(body?.code || "").trim();
  const pin = String(body?.pin || "").trim();
  if (!code || !pin) return null;
  const rows = await select(
    "students",
    `student_code=eq.${encodeURIComponent(code)}&pin=eq.${encodeURIComponent(pin)}&limit=1`
  );
  const s = rows[0];
  if (!s || s.status === "퇴원") return null;
  return s;
}

export default async function handler(req, res) {
  if (!dbConfigured()) {
    return res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 없어요." });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST 로 보내주세요." });

  try {
    const action = req.body?.action || "";
    const stu = await auth(req.body);
    if (!stu) return res.status(401).json({ error: "학생ID 또는 출결번호가 맞지 않아요." });

    const now = kstNow();
    const me = { id: stu.id, name: stu.name, grade: stu.grade, teacher: stu.teacher };

    if (action === "login") {
      return res.status(200).json({ ok: true, me });
    }

    // ── 과제 체크/해제 ──
    if (action === "toggle-task") {
      const taskId = String(req.body?.task_id || "");
      const done = Boolean(req.body?.done);
      if (!taskId) return res.status(400).json({ error: "task_id 필요" });
      // ★ student_id 조건이 있어서 남의 과제는 못 바꾼다
      const updated = await patch(
        "tasks",
        `id=eq.${encodeURIComponent(taskId)}&student_id=eq.${stu.id}`,
        { done, done_at: done ? new Date().toISOString() : null }
      );
      if (!updated.length) return res.status(404).json({ error: "내 과제가 아니거나 없는 과제예요." });
      return res.status(200).json({ ok: true, task: updated[0] });
    }

    // ── 홈: 오늘 과제 + 내 진도 + 최근 리포트 + 월말평가서 ──
    if (action === "home") {
      const date = String(req.body?.date || now.date);
      const from = new Date(`${date}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - RECENT_DAYS);
      const fromDate = from.toISOString().slice(0, 10);

      const [tasks, today, recent, reports] = await Promise.all([
        // 오늘 과제 + 아직 안 한 지난 과제(밀린 것)
        select("tasks", `student_id=eq.${stu.id}&date=lte.${date}&date=gte.${fromDate}&order=date.asc,kind.asc`),
        select("daily_records", `student_id=eq.${stu.id}&date=eq.${date}`),
        select("daily_records", `student_id=eq.${stu.id}&date=lte.${date}&order=date.desc&limit=10`),
        select("monthly_reports", `student_id=eq.${stu.id}&order=month.desc&limit=6&select=month,share_token,created_at`),
      ]);

      // 진도는 오늘 행이 있으면 오늘, 없으면 가장 최근 수업 기준
      const base = today[0] || recent[0] || null;
      const progress = Object.entries(base?.progress || {}).map(([subject, u]) => ({
        subject,
        book: (base?.books || {})[subject] || (stu.books || {})[subject] || "",
        unit: unitLabel(u),
      }));

      return res.status(200).json({
        me,
        date,
        tasks: tasks.map((t) => ({
          id: t.id, date: t.date, kind: t.kind, subject: t.subject,
          title: t.title, done: t.done,
          overdue: t.date < date && !t.done, // 지난 과제인데 아직 안 한 것
        })),
        progress,
        // 학생이 보는 리포트에는 '지적사항(note)'을 넣지 않는다 — 내부 기록이다.
        recent: recent.map((r) => ({
          date: r.date, lateness: r.lateness, attitude: r.attitude, homework: r.homework,
          voca_test: r.voca_test, voca_score: r.voca_score,
          progress: Object.entries(r.progress || {}).map(([s, u]) => `${s} ${unitLabel(u)}`).join(" · "),
        })),
        reports: reports.map((r) => ({ month: r.month, url: `/parent.html?t=${r.share_token}` })),
      });
    }

    return res.status(400).json({ error: `알 수 없는 action: ${action}` });
  } catch (e) {
    // 입력·설정 때문에 난 것은 400 — 500 이면 화면에 영어 날코드가 그대로 뜹니다
    if (e instanceof DbInputError) return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
