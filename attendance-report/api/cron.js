// 매일 새벽 자동 실행 (Vercel Cron, vercel.json 에 등록).
// 세미나2의 시간 트리거 `createTodayStudentsPlannerRows` 대체:
//   오늘 등원 예정인 학생(요일별 등원시간이 있는 학생)의 데일리리포트 행을 미리 생성.
//   진도는 직전 기록에서 캐리포워드(전날 값 복사) — 바뀐 날만 현황판에서 수정.

import { select, insert, dbConfigured, DbInputError } from "../lib/db.js";
import { kstNow } from "../lib/time.js";
import { tocByBook, advanceProgress, lastAttendedProgress } from "../lib/progress.js";

export default async function handler(req, res) {
  // Vercel Cron 외 호출 차단(선택): CRON_SECRET 설정 시 검사
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!dbConfigured()) return res.status(500).json({ error: "DB env 없음" });

  try {
    const now = kstNow();
    const students = await select("students", "status=eq.재원");
    const todays = await select("daily_records", `date=eq.${now.date}&select=student_id`);
    const has = new Set(todays.map((r) => r.student_id));
    const toc = await tocByBook(); // 교재명 → 목차

    const toCreate = [];
    for (const s of students) {
      const scheduled = (s.schedule || {})[now.weekday] || "";
      if (!scheduled) continue; // 오늘 수업 없는 학생 skip
      if (has.has(s.id)) continue; // 이미 행 있으면 skip
      // 직전 기록 진도 → 교재 목차의 다음 진도로 자동 전환
      //   ★ 결석한 날은 건너뜁니다 (lastAttendedProgress 주석 참고) — 결석한 아이가
      //     안 배운 과를 소비해 한 과를 건너뛰던 문제.
      const prev = await lastAttendedProgress(s.id, now.date);
      toCreate.push({
        student_id: s.id,
        date: now.date,
        progress: advanceProgress(prev, s.books, toc),
        books: s.books || {}, // 그날 교재 스냅샷 (교재 전환 감지용)
      });
    }
    if (toCreate.length) await insert("daily_records", toCreate);

    return res.status(200).json({ date: now.date, created: toCreate.length });
  } catch (e) {
    if (e instanceof DbInputError) return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
