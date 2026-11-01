// 월말평가서 · 진도 조정 — 이 세미나의 간판 두 가지를 끝까지 돌려봅니다.
//
// 왜 따로 생겼나: 전면 검수(e2e-api)가 조회·저장·학부모 열람까지는 보는데,
//   · **AI 생성**(action=generate) — 진짜 키로 돌리면 돈이 들어서 빠져 있었고
//   · **진도 일괄 조정**(action=advance-today) — 아예 빠져 있었습니다.
// 당일에 이 둘이 안 되면 세미나가 통째로 흔들립니다.
//
// AI 호출은 **가짜 Anthropic 서버**로 받습니다(ANTHROPIC_BASE_URL).
// 그래서 돈이 안 들고, 대신 「무엇을 보내는지」까지 들여다볼 수 있습니다.
//
//   node scripts/verify/report-progress-check.mjs
// (app-server.mjs 가 4330 에 떠 있어야 합니다 — verify.sh 가 띄웁니다)

const B = "http://localhost:4330";
let fail = 0;
const ck = (l, c, d) => {
  console.log(`${c ? "  ok " : "FAIL "} ${l}${c ? "" : "  → " + String(JSON.stringify(d ?? null)).slice(0, 300)}`);
  if (!c) fail++;
};
const get = async (p, q) => { const r = await fetch(`${B}${p}?${q}`); return { s: r.status, d: await r.json() }; };
const post = async (p, b) => {
  const r = await fetch(`${B}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { s: r.status, d: await r.json() };
};

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// 샘플이 들어 있는 달 = **지난달**. setup.sql 이 설치한 날 기준으로 넣으므로
// 달을 박아두면 다음 달에 검수가 깨집니다.
const 지난달 = (() => { const n = new Date(Date.now() + 9 * 3600e3);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); })();


// ── 1. 진도 일괄 조정 ─────────────────────────────────────
// 「오늘 진도를 목차 다음으로 채워줘」 버튼. 선생님이 전날 것을 고친 뒤 누릅니다.
console.log("── 1. 진도 일괄 조정 (advance-today) ──");
{
  const before = await get("/api/attendance", `action=daily-rows&date=${today}`);
  ck("오늘 행이 있다", before.s === 200 && before.d.rows.length > 0, { s: before.s, n: before.d.rows?.length });

  const sid = before.d.rows[0].student_id;
  const name = before.d.rows[0].name;

  // 오늘 진도를 일부러 비워 놓고 → 버튼을 누르면 다시 채워져야 합니다.
  await post("/api/attendance", { action: "save-record", student_id: sid, date: today, fields: { progress: {} } });
  const emptied = await get("/api/attendance", `action=daily-rows&date=${today}`);
  const emptyRow = emptied.d.rows.find((r) => r.student_id === sid);
  ck("진도를 비웠다", Object.keys(emptyRow?.record?.progress || {}).length === 0, emptyRow?.record?.progress);

  const adv = await post("/api/attendance", { action: "advance-today" });
  ck("★ advance-today 가 돈다", adv.s === 200 && typeof adv.d.updated === "number", adv.d);
  ck("한 명 이상 채워졌다", (adv.d.updated ?? 0) >= 1, adv.d);

  const after = await get("/api/attendance", `action=daily-rows&date=${today}`);
  const filled = after.d.rows.find((r) => r.student_id === sid);
  const prog = filled?.record?.progress || {};
  ck(`★ ${name} 진도가 다시 채워졌다`, Object.keys(prog).length > 0, prog);

  // 채워진 값이 **지난 수업의 다음 유닛**인지 — 그냥 아무 값이나 넣으면 안 됩니다.
  const hist = await get("/api/attendance", `action=student-history&student_id=${sid}&days=90`);
  const past = (hist.d.rows || []).filter((r) => r.date < today && r.progress?.문법?.code);
  past.sort((a, b) => (a.date < b.date ? 1 : -1));
  const prevCode = past[0]?.progress?.문법?.code;
  ck("★ 지난 수업보다 뒤로 가지 않았다", !prevCode || !prog.문법 || prog.문법.code !== prevCode || past.length === 0,
     { 지난: prevCode, 오늘: prog.문법?.code });
}

// ── 2. 월말평가서 ────────────────────────────────────────
console.log("\n── 2. 월말평가서 (generate → save → 학부모 열람) ──");
{
  const month = 지난달;
  const list = await get("/api/report", `action=students&month=${month}`);
  ck("그 달 학생 목록", list.s === 200 && (list.d.students?.length ?? 0) > 0, { s: list.s, e: list.d.error });

  const target = list.d.students[0];
  const gen = await post("/api/report", { action: "generate", student_id: target.id, month });

  if (gen.s === 400 && /ANTHROPIC_API_KEY/.test(gen.d.error || "")) {
    // 키 없이 돌린 경우 — 그 문구가 친절한지만 보고 넘어갑니다.
    ck("키가 없으면 「키를 넣으라」고 알려준다", /키를 넣고/.test(gen.d.error), gen.d.error);
    console.log("  (ANTHROPIC_BASE_URL 로 가짜 서버를 안 띄워서 생성은 건너뜀)");
  } else {
    ck("★ 평가서 본문이 나온다", gen.s === 200 && typeof gen.d.body === "string" && gen.d.body.length > 10, { s: gen.s, d: gen.d.error ?? String(gen.d.body).slice(0, 60) });
    ck("★ 통계가 같이 나온다", gen.s === 200 && gen.d.stats && typeof gen.d.stats === "object", gen.d.stats);
    ck("★ 최종 진도가 같이 나온다", gen.s === 200 && gen.d.progress && typeof gen.d.progress === "object", gen.d.progress);

    // 저장 → 학부모 토큰
    const saved = await post("/api/report", {
      action: "save", student_id: target.id, month,
      body: gen.d.body, stats: gen.d.stats, progress: gen.d.progress,
    });
    ck("저장되고 학부모 토큰이 생긴다", saved.s === 200 && typeof saved.d.share_token === "string" && saved.d.share_token.length > 8, saved.d);

    const tok = saved.d.share_token;
    const noPin = await get("/api/report", `action=parent&token=${encodeURIComponent(tok)}`);
    ck("★ 출결번호 없이는 안 열린다", noPin.d.needPin === true, noPin.d);

    // 출결PIN 은 평가서 목록엔 없어서 학생 목록에서 가져옵니다.
    const stuList = await get("/api/attendance", "action=students");
    const pin = (stuList.d.students || []).find((x) => x.id === target.id)?.pin ?? "";
    if (pin) {
      const ok = await get("/api/report", `action=parent&token=${encodeURIComponent(tok)}&pin=${pin}`);
      ck("★ 출결번호를 넣으면 열린다", ok.s === 200 && Array.isArray(ok.d.reports) && ok.d.reports.length > 0, { s: ok.s, n: ok.d.reports?.length });
      ck("★ 본인 평가서만 보인다", ok.s === 200 && ok.d.student?.name === target.name, ok.d.student);

      const wrong = await get("/api/report", `action=parent&token=${encodeURIComponent(tok)}&pin=0000`);
      ck("틀린 출결번호는 막힌다", wrong.d.needPin === true, wrong.d);

      // 학부모 화면에 「수업일」이 두 값으로 보이던 적이 있습니다 —
      //   도넛은 결석까지 포함한 22, 아래 타일은 나온 날 20 인데 **이름이 같았습니다.**
      //   말은 화면에 있지만, 두 숫자가 실제로 다르다는 것부터 여기서 못 박아 둡니다.
      const pl = ok.d.reports?.[0]?.planner;
      if (pl) {
        const 나온날 = (pl.출석?.정시등원 ?? 0) + (pl.출석?.지각 ?? 0);
        const 총일 = pl.총수업일수 ?? 0;
        ck("★ 총 수업일 = 나온 날 + 결석", 총일 === 나온날 + (pl.출석?.결석 ?? 0),
           { 총일, 나온날, 결석: pl.출석?.결석 });
        ck("★ 결석이 있으면 두 값이 다르다 (그래서 이름도 달라야 함)",
           (pl.출석?.결석 ?? 0) === 0 || 총일 !== 나온날, { 총일, 나온날 });
      }
    }

    // 중학생 체크 — 참고사항에 한 줄이 더 붙어 프롬프트가 달라져야 합니다.
    const ms = await post("/api/report", { action: "generate", student_id: target.id, month, middleSchool: true });
    ck("중학생 체크해도 생성된다", ms.s === 200 && typeof ms.d.body === "string", { s: ms.s, e: ms.d.error });
  }
}

// ── 3. 설치 직후 첫 화면 ───────────────────────────────────
// 세미나 당일(11/1)이 일요일입니다. 샘플은 주말 수업까지 깔려 있어서
// 「주말엔 데일리 리포트가 빈 화면으로 뜬다」고 오래 믿고 자료에도 그렇게 적었는데,
// 실제로는 setup.sql 이 **요일과 상관없이 전원 오늘 행**을 만듭니다(sql/setup.sql 의 마지막 insert).
// 그 덕에 설치 직후 바로 화면이 찹니다. 이게 깨지면 세미나 첫 10분이 빈 화면이 됩니다.
console.log("\n── 3. 설치 직후 첫 화면 (요일 무관) ──");
{
  const rows = await get("/api/attendance", `action=daily-rows&date=${today}`);
  ck("★ 오늘 데일리 리포트에 학생이 있다", (rows.d.rows?.length ?? 0) >= 3, rows.d.rows?.length);

  const board = await get("/api/attendance", "action=board");
  ck("★ 현황판에도 학생이 있다", (board.d.students?.length ?? 0) >= 3, board.d.students?.length);

  // 오늘 진도가 지난 수업보다 앞서 있어야 합니다 (뒤로 가면 수강생이 고장으로 봅니다).
  const first = rows.d.rows?.[0];
  const hist = await get("/api/attendance", `action=student-history&student_id=${first?.student_id}&days=365`);
  const past = (hist.d.rows || [])
    .filter((r) => r.date < today && r.progress?.문법?.code)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const prev = past[0]?.progress?.문법?.code;
  const now = first?.record?.progress?.문법?.code;
  ck("★ 오늘 진도가 지난 수업보다 뒤로 가지 않는다", !prev || !now || prev !== now, { 지난: prev, 오늘: now });
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
