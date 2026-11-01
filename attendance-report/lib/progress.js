// 진도 자동 진행 — 교재 목차(TOC)를 순서대로 읽어 다음 진도로 넘긴다.
// 교재 유닛은 { code(유닛 코드/번호), title(실제 제목) } 구조.
//   예: { code:"Unit 12", title:"관계대명사" }  ·  { code:"Day 38", title:"환경 오염" }
//   · 지난 진도가 목차에 있으면  → step 만큼 다음 목차로 자동 전환
//   · 지난 진도가 없으면(첫날)   → 목차 1번
//   · 목차에 없거나 목차가 없으면 → 지난 값 유지(캐리포워드, 커스텀 진도 존중)

import { select } from "./db.js";

// 유닛을 {code,title} 로 정규화 (예전 문자열 데이터도 흡수).
export function normUnit(u) {
  if (u == null || u === "") return null;
  if (typeof u === "string") return { code: u, title: "" };
  return { code: u.code || "", title: u.title || "" };
}

// ── 직전 진도 — **결석한 날은 건너뜁니다** ───────────────────────────
// 왜: 결석한 날 행에도 진도가 적혀 있습니다 (새벽에 미리 깔리니까요).
//   그걸 「직전 진도」로 쓰면 **아이가 안 배운 과가 소비되어** 한 과를 건너뜁니다.
//   운영(앱스크립트)은 결석 학생을 그날 목록에서 아예 빼기 때문에 이 문제가 없습니다.
//   연속 결석도 거슬러 올라가 **마지막으로 나온 날**을 찾습니다 (최대 10회).
//
// 이 함수를 **세 곳이 같이 씁니다** — 새벽 cron(`api/cron.js`),
//   데일리 리포트 행 생성(`daily-rows`·`add-row`), 진도 일괄 전진(`advance-today`).
//   한 곳만 고치면 규칙이 어긋나서 여기 한 군데에 모아뒀습니다.
export async function lastAttendedProgress(studentId, date) {
  const rows = await select(
    "daily_records",
    `student_id=eq.${studentId}&date=lt.${date}&order=date.desc&limit=10&select=date,progress,lateness`
  );
  return rows.find((r) => r.lateness !== "결석")?.progress;
}

// 교재명 → { units:[{code,title}...], step } 맵. (여러 학생이 같은 교재를 써도 한 번만 조회)
export async function tocByBook() {
  const books = await select("textbooks", "select=name,units,step");
  const map = {};
  for (const b of books) {
    const raw = Array.isArray(b.units) ? b.units : [];
    map[b.name] = {
      units: raw.map(normUnit).filter(Boolean),
      step: Number(b.step) > 0 ? Number(b.step) : 1,
      // 유닛에 적어둔 과제. normUnit 이 code·title 만 남기므로 여기 따로 담습니다
      // (진도 기록에는 과제를 넣지 않습니다 — 교재 과제를 고쳐도 지난 기록이 안 바뀌게)
      hwByCode: hwIndex(raw),
    };
  }
  return map;
}

// 「쉼표로 여러 개」를 배열로. 운영(code.gs)의 집과제 파싱과 같은 규칙입니다.
function toList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
}

// 유닛코드 → { 집과제: [...], 학원과제: "..." }
function hwIndex(units) {
  const out = {};
  for (const u of units) {
    if (!u || typeof u !== "object" || !u.code) continue;
    const 집 = toList(u.집과제);
    const 학원 = String(u.학원과제 || "").trim();
    if (집.length || 학원) out[String(u.code)] = { 집과제: 집, 학원과제: 학원 };
  }
  return out;
}

// 그날 진도에 맞는 **자동 과제**를 만듭니다.
//   진도가 Unit 5 면 교재 목차의 Unit 5 칸에 적힌 과제가 그 학생에게 들어갑니다.
//   유닛에 과제를 안 적어둔 교재는 아무것도 안 나옵니다 (지금까지와 똑같이 동작).
export function tasksForProgress({ progress, books, toc, student_id, date }) {
  const rows = [];
  for (const [subject, unit] of Object.entries(progress || {})) {
    const bookName = (books || {})[subject];
    const hw = bookName && toc?.[bookName]?.hwByCode?.[String(unit?.code ?? unit ?? "")];
    if (!hw) continue;
    for (const title of hw.집과제) rows.push({ student_id, date, kind: "집", subject, title, auto: true });
    if (hw.학원과제) rows.push({ student_id, date, kind: "학원", subject, title: hw.학원과제, auto: true });
  }
  return rows;
}

// 비교용 키 — 공백·대소문자·구두점을 지운다.
// (수기로 쓰던 진도가 "Unit 5", "unit5", "Unit 5." 처럼 제각각이라 글자 그대로 비교하면 거의 안 맞는다)
function keyOf(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "").replace(/[.\-–—:·,/()]/g, "");
}
function numOf(s) {
  const m = String(s || "").match(/\d+/);
  return m ? m[0] : "";
}

// 「숫자 + 단위어」로만 된 진도 표기인가.
//   붙습니다  : 5 · 5과 · 제5과 · unit5 · u5 · day38 · ch3 · lesson5 · 3장 · 3주차 · 3차시
//   안 붙습니다: 특강3회차 · 보충2일차 · 레벨테스트1차 — 교재와 상관없는 수기 메모라서,
//               숫자 하나로 목차에 끌어다 붙이면 다음 날 진도가 엉뚱하게 넘어갑니다.
const 단위어 = /^(unit|lesson|chapter|week|day|part|test|u|l|c|d|p|w|ch|wk|제|과|장|강|권|단원|주차|차시|회차|회|차|일|번)*$/;
function 숫자표기만(code) {
  const k = keyOf(code);
  if (!/\d/.test(k)) return false;
  return 단위어.test(k.replace(/\d+/g, ""));
}

// ★ 목차에서 '지금 진도'가 몇 번째인지 찾는다. 못 찾으면 -1.
//   2차 세미나 수강생은 진도를 **수기로** 써왔기 때문에 글자가 목차와 정확히 같을 일이 거의 없다.
//   ("Unit 5 현재완료", "unit5", "5과", "5" …) 그래서 단계적으로 느슨하게 찾는다.
//   못 찾으면 진도가 영영 안 넘어가므로(캐리포워드), 이 함수가 이 기능의 핵심이다.
export function findUnitIndex(units, last) {
  const list = Array.isArray(units) ? units : [];
  const u = normUnit(last);
  if (!list.length || !u || !u.code) return -1;
  const lc = keyOf(u.code), lt = keyOf(u.title);

  // 1) 코드가 같다 (공백·대소문자·구두점 무시)
  //    ★ 같은 코드가 **여럿**일 때는 제목으로 가립니다.
  //      「복습」·「리뷰」를 챕터마다 같은 코드로 쓰는 분이 많은데, 그때 늘 첫 번째를
  //      찾아버리면 진도가 거기로 되돌아가 **그 자리에서 맴돕니다** (CH3 에 영영 못 감).
  //      제목(「CH2 리뷰 문제풀이」)까지 보면 제 자리를 찾습니다.
  const 코드같은것 = [];
  list.forEach((x, idx) => { if (keyOf(x.code) === lc) 코드같은것.push(idx); });
  if (코드같은것.length === 1) return 코드같은것[0];
  if (코드같은것.length > 1) {
    const 제목까지 = lt ? 코드같은것.filter((idx) => keyOf(list[idx].title) === lt) : [];
    return 제목까지.length ? 제목까지[0] : 코드같은것[0];
  }
  let i = -1;

  // 2) 수기 진도가 "코드 + 제목" 형태 → 코드로 시작하는 것.
  //    "Unit 15" 가 "Unit 1" 에 잘못 붙지 않도록 **가장 긴 코드**를 고른다.
  let best = -1, bestLen = 0;
  list.forEach((x, idx) => {
    const k = keyOf(x.code);
    if (k && lc.startsWith(k) && k.length > bestLen) { best = idx; bestLen = k.length; }
  });
  if (best >= 0) return best;

  // 3) 제목만 쓴 경우 ("현재완료")
  if (lc) { i = list.findIndex((x) => keyOf(x.title) && keyOf(x.title) === lc); if (i >= 0) return i; }
  if (lt) { i = list.findIndex((x) => keyOf(x.title) === lt); if (i >= 0) return i; }

  // 4) 숫자만 같은 경우 ("5", "5과" ↔ "Unit 5").
  //    같은 숫자를 가진 유닛이 **하나뿐일 때만** — 여럿이면 어느 것인지 알 수 없으니 포기.
  //    ★ 그리고 「숫자 + 단위어」 로만 된 표기일 때만 봅니다.
  //      예전에는 숫자 하나만 보고 붙여서, 교재와 상관없는 수기 메모
  //      (「특강 3회차」·「보충 2일차」)까지 목차 유닛으로 끌려가 다음 날 진도가
  //      엉뚱하게 넘어갔습니다. 자료에 적힌 「손으로 쓴 진도는 그대로 둡니다」와 어긋났습니다.
  const n = 숫자표기만(u.code) ? numOf(u.code) : "";
  if (n) {
    const hits = list.map((x, idx) => ({ idx, n: numOf(x.code) })).filter((x) => x.n === n);
    if (hits.length === 1) return hits[0].idx;
  }
  return -1;
}

// 진도가 목차와 연결됐는지 알려준다 (화면에서 "왜 안 넘어가지?" 를 바로 보여주려고).
//   no-book   교재 미지정 / no-toc 목차 없음 / first 첫 진도 / linked 연결됨 / unlinked 목차에 없음
export function linkStatus(lastProgress, books, toc) {
  const out = {};
  for (const [subject, bookName] of Object.entries(books || {})) {
    if (!bookName) { out[subject] = { state: "no-book" }; continue; }
    const entry = (toc || {})[bookName];
    const units = entry?.units || [];
    const last = normUnit((lastProgress || {})[subject]);
    if (!units.length) { out[subject] = { state: "no-toc", book: bookName }; continue; }
    if (!last || !last.code) { out[subject] = { state: "first", book: bookName, total: units.length }; continue; }
    const i = findUnitIndex(units, last);
    out[subject] = i >= 0
      ? { state: "linked", book: bookName, at: i + 1, total: units.length }
      : { state: "unlinked", book: bookName, total: units.length, value: last.code };
  }
  return out;
}

// 다음 진도 계산. lastProgress={과목:{code,title}}, books={과목:교재명}, toc={교재명:{units,step}}
export function advanceProgress(lastProgress, books, toc) {
  const out = {};
  for (const [subject, bookName] of Object.entries(books || {})) {
    const entry = (toc || {})[bookName];
    const units = entry?.units;
    const step = entry?.step || 1;
    const last = normUnit((lastProgress || {})[subject]);
    if (Array.isArray(units) && units.length) {
      if (!last || !last.code) {
        out[subject] = units[0]; // 첫 진도는 목차 1번
      } else {
        const i = findUnitIndex(units, last); // 수기로 쓴 진도도 찾아낸다
        if (i >= 0) out[subject] = units[Math.min(i + step, units.length - 1)]; // step 만큼(끝이면 유지)
        else out[subject] = last; // 목차에서 못 찾음 → 유지 (화면에 '목차와 연결 안 됨'으로 표시됨)
      }
    } else if (last && last.code) {
      out[subject] = last; // 목차 없음 → 캐리포워드
    }
  }
  return out;
}
