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
//   {action:"answer",      code, pin, subject}        → 📖 그 과목 **지금 진도 유닛**의 답지 (학원 와이파이에서만)
//
// ⚠️ 학생은 '자기 것'만 볼 수 있어야 한다. 아래 모든 조회에 student_id=eq.<본인> 이 붙어 있다.
//    이 조건을 빼면 다른 학생 기록이 보인다 — 수정할 때 꼭 유지할 것.

import { select, patch, dbConfigured, DbInputError } from "../lib/db.js";
import { kstNow } from "../lib/time.js";
import { normUnit } from "../lib/progress.js";
import { onAcademyWifi, wifiBlockedMessage } from "../lib/wifi.js";
import { signDownload } from "../lib/storage.js";

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

// 학생의 **지금 진도** (오늘 행이 있으면 오늘, 없으면 가장 최근 수업) — 홈과 답지가 같은 기준을 씁니다
async function currentBase(stu, date) {
  const [today, recent] = await Promise.all([
    select("daily_records", `student_id=eq.${stu.id}&date=eq.${date}`),
    select("daily_records", `student_id=eq.${stu.id}&date=lte.${date}&order=date.desc&limit=1`),
  ]);
  return today[0] || recent[0] || null;
}

// 과목별 [교재명, 유닛코드] → 답지 행 (없는 건 빠짐).
//   ⚠️ 답지 표(answer_keys)가 아직 없는 DB 에서도 학생앱 홈이 깨지면 안 돼서, 실패하면 빈 값.
async function answersFor(base, stu) {
  const pairs = Object.entries(base?.progress || {}).map(([subject, u]) => ({
    subject,
    book: (base?.books || {})[subject] || (stu.books || {})[subject] || "",
    code: normUnit(u)?.code || "",
  })).filter((p) => p.book && p.code);
  if (!pairs.length) return {};
  try {
    // 교재 표는 작아서(수십 권) 통째로 이름·id 만 가져옵니다
    const books = await select("textbooks", "select=id,name");
    const idOf = Object.fromEntries(books.map((t) => [t.name, t.id]));
    const ids = [...new Set(pairs.map((p) => idOf[p.book]).filter(Boolean))];
    if (!ids.length) return {};
    const keys = await select("answer_keys", `textbook_id=in.(${ids.join(",")})&select=textbook_id,unit_code,path`);
    const out = {};
    for (const p of pairs) {
      const k = keys.find((x) => x.textbook_id === idOf[p.book] && x.unit_code === p.code);
      if (k) out[p.subject] = k;
    }
    return out;
  } catch {
    return {};
  }
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

    // ── 📖 답지 열기 — ★ 학원 와이파이에서만, ★ 내 **지금 진도** 유닛 것만 ──
    //   어떤 유닛인지는 화면이 보낸 값을 믿지 않고 서버가 진도에서 직접 찾습니다
    //   (그래야 다음 유닛 답지를 미리 열어보지 못합니다).
    if (action === "answer") {
      if (!onAcademyWifi(req)) return res.status(403).json({ error: wifiBlockedMessage() });
      const subject = String(req.body?.subject || "");
      const base = await currentBase(stu, now.date);
      const k = (await answersFor(base, stu))[subject];
      if (!k) return res.status(404).json({ error: "지금 진도의 답지가 아직 없어요." });
      return res.status(200).json({ url: await signDownload(k.path) });
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
      const 답지 = await answersFor(base, stu);
      const progress = Object.entries(base?.progress || {}).map(([subject, u]) => ({
        subject,
        book: (base?.books || {})[subject] || (stu.books || {})[subject] || "",
        unit: unitLabel(u),
        has_answer: Boolean(답지[subject]),   // 📖 지금 진도에 답지가 올라가 있나 (파일 위치는 안 보냄)
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
        on_wifi: onAcademyWifi(req),   // 학원 와이파이인가 — 답지 버튼 안내용
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
