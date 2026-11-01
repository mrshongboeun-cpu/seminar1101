// 모든 화면을 실제 브라우저로 열어 JS 오류·빈 화면을 잡는다.
// (미니 원서 앱 때처럼 "열어보니 에러" 를 세미나 당일이 아니라 지금 잡으려고)
import { chromium } from "playwright";
const B = "http://localhost:4330";
const EXE = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const b = await chromium.launch({ executablePath: EXE });
let fail = 0;
const ck = (l, c, d) => { console.log(`${c ? "  ok " : "FAIL "} ${l}${c ? "" : "  → " + String(JSON.stringify(d ?? null)).slice(0, 200)}`); if (!c) fail++; };

// 각 화면: 경로, 로딩 끝났다고 볼 조건, 비어 있으면 안 되는 곳
const PAGES = [
  { p: "/", wait: ".card", must: "a[href='/daily.html']" },
  { p: "/board.html", wait: "body", must: null },
  { p: "/daily.html", wait: "body", must: null },
  { p: "/students.html", wait: "body", must: null },
  { p: "/student_card.html", wait: "body", must: null },
  { p: "/books.html", wait: "body", must: null },
  { p: "/kiosk.html", wait: "body", must: null },
  { p: "/report.html", wait: "body", must: null },
  { p: "/teacher.html", wait: "body", must: null },
  { p: "/student.html", wait: "body", must: null },
  { p: "/import.html", wait: "body", must: null },
  { p: "/handout.html", wait: "body", must: "#pq" },   // 프롬프트 찾기 상자
  { p: "/parent.html", wait: "body", must: null },
];

for (const page of PAGES) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  pg.on("pageerror", (e) => errs.push("JS: " + e.message));
  pg.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|favicon/i.test(m.text())) errs.push("콘솔: " + m.text()); });
  pg.on("requestfailed", (r) => { const u = r.url(); if (u.startsWith(B) && !/favicon/.test(u)) errs.push("요청실패: " + u.replace(B, "")); });

  let ok = true, detail = null;
  try {
    const res = await pg.goto(B + page.p, { waitUntil: "networkidle", timeout: 20000 });
    if (!res || res.status() >= 400) { ok = false; detail = "HTTP " + (res && res.status()); }
    await pg.waitForTimeout(900); // 초기 fetch 가 끝날 시간
    const txt = (await pg.locator("body").innerText()).trim();
    if (ok && txt.length < 10) { ok = false; detail = "화면이 비어 있음"; }
    if (ok && page.must && (await pg.locator(page.must).count()) === 0) { ok = false; detail = "필수 요소 없음: " + page.must; }
  } catch (e) { ok = false; detail = e.message.slice(0, 120); }

  ck(`${page.p.padEnd(18)} 로드`, ok, detail);
  ck(`${page.p.padEnd(18)} JS 오류 없음`, errs.length === 0, errs.slice(0, 3));
  await pg.close();
}

// ── 실제 조작 한 바퀴 ──
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push("JS: " + e.message));

// 데일리 리포트: 학생이 보이고 진도 칸이 채워져 있나
await pg.goto(B + "/daily.html", { waitUntil: "networkidle" });
await pg.waitForTimeout(1200);
const cards = await pg.locator(".card").count();
ck("daily.html 학생 카드가 보임", cards >= 1, { cards });
const selects = await pg.locator("select[data-sub]").count();
ck("★ daily.html 진도 드롭다운(목차 연결됨)", selects >= 1, { selects });
const firstVal = selects ? await pg.locator("select[data-sub]").first().inputValue() : "";
ck("★ 진도가 비어 있지 않음(자동으로 채워짐)", !!firstVal, { firstVal });
// 지난 수업 3회 요약 — 진도·단어테스트 흐름이 보여야 함
{
  const rec = await pg.locator(".hist").first().innerText().catch(() => "");
  ck("★ 최근 수업 표가 보임", /최근 수업/.test(rec), rec.slice(0, 140));
  ck("★ 단어 TEST 칸이 있음", /단어 TEST/.test(rec), rec.slice(0, 140));
  ck("날짜가 MM/DD 로 나옴 (ISO 가 새지 않음)", !/T\d\d:/.test(rec), rec.slice(0, 140));
  ck("요일이 같이 나옴", /\d\d\/\d\d\s*[일월화수목금토]/.test(rec), rec.slice(0, 140));
  // 빈 칸은 '-' 로 채웁니다(student_card.html). 샘플에 값이 다 차 있으면 '-' 가
  // 아예 안 나오므로, 여기서는 **null·undefined 가 화면에 새지 않는지**를 봅니다.
  ck("빈 칸에 null/undefined 가 새지 않음", !/\b(null|undefined)\b/.test(rec), rec.slice(0, 140));
  // 「더 보기」 를 누르면 줄이 늘어나야 한다
  const before = await pg.locator(".hist tbody tr").count();
  const more = pg.locator(".hist .more").first();
  if (await more.count()) {
    await more.click(); await pg.waitForTimeout(600);
    const after = await pg.locator(".hist tbody tr").count();
    ck("★ 「더 보기」로 줄이 늘어남", after > before, { before, after });
  }
  const prev = await pg.locator(".prev").first().innerText().catch(() => "");
  ck("과목 줄에 지난 진도가 보임", /지난|직전/.test(prev), prev.slice(0, 100));
}

// 📨 카톡 미리보기 — 원장님이 매일 쓰는 화면인데 검사에서 빠져 있었습니다.
//    여기서 과목별 교재·진도가 보여야 "보내기 전에" 빈칸을 잡을 수 있습니다.
{
  const btn = pg.locator("button", { hasText: "리포트 카톡" }).first();
  if (await btn.count()) {
    await btn.click();
    await pg.waitForTimeout(1200);
    const open = await pg.locator("#overlay.on").count();
    ck("★ 카톡 미리보기가 열림", open === 1, { open });
    const txt = open ? await pg.locator("#sendList").innerText() : "";
    ck("★ 미리보기에 과목별 교재·진도가 보임", /카톡에 들어갈 과목/.test(txt), txt.slice(0, 160));
    ck("★ 교재명이 '-' 가 아님", /그래머|리딩|보카/.test(txt), txt.slice(0, 160));
    // 변수 이름 조각이 화면으로 새지 않아야 한다.
    // 실제로 `#{문법유닛}` 을 추가했더니 파서가 `문법유닛}` 을 과목으로 잡아
    // 「문법유닛} - -」 가 미리보기에 그대로 찍혔습니다 (문구 존재만 보던 검사는 통과했음).
    ck("★ 변수 이름 조각(`}`)이 새지 않음", !/[가-힣]\}/.test(txt), (txt.match(/.{0,30}[가-힣]\}.{0,20}/) || [""])[0]);
    ck("진도에 유닛 제목까지 보임", /CH\d|Unit \d|Day \d/.test(txt) && /\d\s*[가-힣]/.test(txt), txt.slice(0, 200));
  } else {
    ck("★ 카톡 미리보기 버튼 있음", false, "버튼을 찾지 못함");
  }
}

// ★ 붙여넣기 일괄등록 → 그 학생이 학생앱에 로그인되나
//   예전에는 일괄등록 파서가 student_code(학생ID) 를 아예 읽지 않아서,
//   일괄등록으로 넣은 학생은 전부 학생앱 로그인이 안 됐습니다(로그인 = 학생ID + PIN).
//   조용히 비는 값이라 세미나 당일에야 "학생앱이 안 돼요" 로 드러날 자리였습니다.
//   ⚠️ 로그인 상태가 뒤의 점검에 새지 않도록 **별도 컨텍스트**에서 돌립니다.
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
  const p2 = await ctx.newPage();
  const dl = [];
  p2.on("dialog", async (d) => { dl.push(d.message()); await d.accept().catch(() => {}); });
  await p2.goto(B + "/students.html", { waitUntil: "networkidle" });
  await p2.waitForTimeout(1000);
  const code = "vfy" + String(Date.now()).slice(-5);
  // ★ PIN 을 **박아두면 안 됩니다.** 4242·7777 을 박아뒀다가 샘플 교재를 바꾸면서
  //   샘플 PIN 과 겹쳤고, 앱이 올바르게 「PIN 이 겹친다」고 막는데 검수가 실패했습니다.
  //   지금 안 쓰는 번호를 찾아서 씁니다.
  const [빈핀, 빈핀2] = await (async () => {
    const d = await (await fetch(`${B}/api/attendance?action=students`)).json();
    const 쓰는중 = new Set((d.students || []).map((x) => String(x.pin || "").trim()));
    const 빈것 = [];
    for (let n = 1000; n <= 9999 && 빈것.length < 2; n++) {
      const p = String(n); if (!쓰는중.has(p)) 빈것.push(p);
    }
    return 빈것;
  })();
  if (await p2.locator("#bulkBtn").count()) {
    await p2.locator("#bulkBtn").click();
    await p2.waitForTimeout(400);
    await p2.locator("#bulkText").fill(`검수학생\t${code}\t${빈핀}\t중1\t이선생\t010-4242-4242`);
    await p2.locator("#bulkSave").click();
    await p2.waitForTimeout(2200);
    ck("★ 일괄등록에 학생ID가 들어감", (await p2.locator("body").innerText()).includes(code), dl.slice(0, 2));
    await p2.goto(B + "/student.html", { waitUntil: "networkidle" });
    await p2.waitForTimeout(800);
    const ii = await p2.locator("input:visible").all();
    if (ii.length >= 2) {
      await ii[0].fill(code); await ii[1].fill(빈핀);
      await p2.locator("button:visible").first().click();
      await p2.waitForTimeout(2000);
    }
    ck("★★ 일괄등록한 학생이 학생앱에 로그인됨", (await p2.locator("body").innerText()).includes("검수학생"), null);

    // ★ 제목 줄이 있는 시트(구글시트에서 그대로 복사)도 읽어야 한다 — 요일·교재까지.
    //   요일이 안 들어가면 그 학생은 데일리 리포트에 아예 안 뜨고,
    //   교재가 안 들어가면 진도 자동 전환이 안 됩니다. 둘 다 조용히 비는 값이라 검사로 못 박습니다.
    const code2 = "sht" + String(Date.now()).slice(-5);
    await p2.goto(B + "/students.html", { waitUntil: "networkidle" });
    await p2.waitForTimeout(900);
    await p2.locator("#bulkBtn").click(); await p2.waitForTimeout(300);
    await p2.locator("#bulkText").fill(
      "이름\t학생ID\t출결PIN\t학년\t담당\t연락처\t월\t화\t수\t목\t금\t문법교재\t리딩교재\t단어교재\n" +
      `시트학생\t${code2}\t${빈핀2}\t중1\t이선생\t010-7777-7777\t17:00\t\t17:00\t\t17:00\t그래머 인사이드 1\t리딩튜터 주니어 1\t능률 VOCA 입문`
    );
    await p2.waitForTimeout(500);
    const prev = await p2.locator("#bulkPreview").innerText();
    ck("★ 제목 줄을 알아봄", /제목 줄 인식됨/.test(prev), prev);
    ck("요일·교재가 잡힘", /요일 들어간 학생 1명/.test(prev) && /교재 들어간 학생 1명/.test(prev), prev);
    await p2.locator("#bulkSave").click(); await p2.waitForTimeout(2200);
    const made = await (await fetch(`${B}/api/attendance?action=students`)).json();
    const row = (made.students || []).find((x) => x.student_code === code2);
    ck("★★ 시트 한 장으로 등록됨", !!row, null);
    ck("★★ 요일별 등원시간이 들어감", row && Object.values(row.schedule || {}).filter(Boolean).length >= 1, row && row.schedule);
    ck("★★ 과목별 교재가 들어감", row && (row.books || {}).문법 === "그래머 인사이드 1", row && row.books);
    ck("담당·PIN·학년도 들어감", row && row.teacher === "이선생" && row.pin === 빈핀2 && row.grade === "중1", row);

    // ★★ 출결PIN 이 겹치면 — 키오스크는 PIN 만으로 학생을 찾습니다. 겹치면 엉뚱한 아이로
    //   등원되고 **그 집에 등원 카톡이** 갑니다. 아무 표시도 없어서 당일 아침에야 드러나던 자리.
    {
      const code3 = "dup" + String(Date.now()).slice(-5);
      await p2.goto(B + "/students.html", { waitUntil: "networkidle" });
      await p2.waitForTimeout(900);
      await p2.locator("#bulkBtn").click(); await p2.waitForTimeout(300);
      dl.length = 0;
      // 이미 등록된 「시트학생」의 PIN 을 그대로 쓴다
      await p2.locator("#bulkText").fill(`겹침학생\t${code3}\t${빈핀2}\t중1\t이선생\t010-4242-4242`);
      await p2.locator("#bulkSave").click(); await p2.waitForTimeout(2000);
      const 재조회 = await (await fetch(`${B}/api/attendance?action=students`)).json();
      ck("★★ PIN 이 겹치는 학생은 등록을 막는다",
         !(재조회.students || []).some((x) => x.student_code === code3), dl.slice(0, 2));
      ck("★★ 막는 말이 한국어로 뜬다", dl.some((m) => /겹|PIN/.test(m) && /[가-힣]/.test(m)), dl.slice(0, 2));
      // 겹친 걸 **명단 화면이 알려주나** — 노션 이관처럼 다른 길로 들어온 중복까지 잡는 장치.
      //   ★ 「배너가 안 뜬다」를 박으면 안 됩니다. 앞 단계(노션 이관)가 남긴 학생 때문에
      //     진짜 중복이 있을 수 있고, 그때는 배너가 뜨는 게 **맞습니다.**
      //     그래서 「서버가 말하는 중복과 화면이 일치하나」를 봅니다.
      await p2.goto(B + "/students.html", { waitUntil: "networkidle" });
      await p2.waitForTimeout(1200);
      const 서버중복 = ((await (await fetch(`${B}/api/attendance?action=students`)).json()).pin_dups) || [];
      const 배너보임 = await p2.locator("#pinDup").isVisible().catch(() => false);
      ck("★ 겹친 PIN 유무가 화면과 서버에서 같다", 배너보임 === (서버중복.length > 0),
         { 서버: 서버중복, 배너: 배너보임 });
      if (서버중복.length) {
        const 글 = await p2.locator("#pinDup").innerText();
        ck("★ 배너가 겹친 학생 이름을 짚어준다",
           서버중복.every((x) => x.names.every((n) => 글.includes(n))), 글);
      }
    }

    // 📄 시트 양식(CSV) 내려받기가 실제로 되는지 (등록하면 모달이 닫히므로 다시 연다)
    await p2.goto(B + "/students.html", { waitUntil: "networkidle" }); await p2.waitForTimeout(800);
    await p2.locator("#bulkBtn").click(); await p2.waitForTimeout(400);
    const [dlFile] = await Promise.all([
      p2.waitForEvent("download", { timeout: 8000 }).catch(() => null),
      p2.locator("#tplCsv").click(),
    ]);
    // 파일 **내용**을 봅니다. headless 브라우저는 blob 다운로드의 파일 이름을 "download" 로
    // 돌려줘서 이름으로는 판정할 수 없고, 정작 중요한 건 제목 줄이 붙여넣기 파서와 맞는지입니다.
    let csvHead = "";
    if (dlFile) {
      const to = "/tmp/_tpl_check.csv";
      await dlFile.saveAs(to).catch(() => {});
      csvHead = (await import("fs")).readFileSync(to, "utf8").split("\n")[0] || "";
    }
    ck("★ 시트 양식(CSV) 받아짐", !!dlFile, null);
    ck("★★ 양식의 제목 줄이 붙여넣기 파서와 맞음",
       ["이름", "학생ID", "출결PIN", "담당", "연락처", "월", "금", "문법교재", "단어교재"].every((h) => csvHead.includes(h)),
       csvHead.slice(0, 160));
  } else {
    ck("★ 일괄등록 버튼 있음", false, "없음");
  }
  await ctx.close();
}

// ★ 🔁 재시 안내 — 불통과를 저장하면 버튼이 나타나고, 미리보기에 그 학생이 보여야 한다
//   (예전에는 재시를 보낼 자리가 없어서, 미통과한 아이가 같은 유닛에 그냥 멈춰 있었습니다)
{
  await pg.goto(B + "/daily.html", { waitUntil: "networkidle" });
  await pg.waitForTimeout(1200);
  const seg = pg.locator('.seg[data-field="voca_test"] button:has-text("불통과")').first();
  if (await seg.count()) {
    await seg.click();
    await pg.waitForTimeout(1600);           // 자동 저장(700ms 디바운스) 기다림
    await pg.reload({ waitUntil: "networkidle" });
    await pg.waitForTimeout(1400);
    const btn = pg.locator("#retest");
    ck("★ 「🔁 재시 안내」 버튼이 나타남", await btn.isVisible(), await btn.textContent().catch(() => null));
    ck("버튼에 대상 인원수가 적힘", /\(\d+\)/.test((await btn.textContent()) || ""), await btn.textContent().catch(() => null));
    ck("카드에 「재시 안내 대기」 표시", (await pg.locator("body").innerText()).includes("재시 안내 대기"), null);
    await btn.click();
    await pg.waitForTimeout(1400);
    ck("★ 재시 미리보기가 열림", (await pg.locator("#rOverlay.on").count()) === 1, null);
    const rt = await pg.locator("#rList").innerText().catch(() => "");
    ck("미리보기에 단어교재·점수가 보임", /단어\s|점수/.test(rt), rt.slice(0, 160));
    await pg.locator("#rCancel").click();
    await pg.waitForTimeout(300);
  } else {
    ck("★ 단어테스트 불통과 버튼 있음", false, "버튼을 찾지 못함");
  }
}

// ★ 📋 학생 카드 — 데일리 리포트에서 학생 이름을 누르면 지난 진도가 쭉 보여야 한다
{
  await pg.goto(B + "/daily.html", { waitUntil: "networkidle" });
  await pg.waitForTimeout(1200);
  const link = pg.locator("a.nm").first();
  ck("★ daily.html 학생 이름이 학생 카드 링크", await link.count() > 0, null);
  const href = (await link.getAttribute("href")) || "";
  ck("링크에 student_id 가 붙음", /student_card\.html\?student_id=.+/.test(href), href);

  await pg.goto(B + href, { waitUntil: "networkidle" });
  await pg.waitForTimeout(1600);
  const body2 = await pg.locator("body").innerText();
  ck("★ 학생 카드가 열림 (학생 이름 나옴)", /김민준|이서연|박도윤/.test(body2), body2.slice(0, 160));
  ck("★ 📊 과목별 진도 흐름이 보임", /과목별 진도/.test(body2), body2.slice(0, 200));
  ck("★ 📅 진도 표가 보임", (await pg.locator("table.pt").count()) >= 1, null);
  ck("표에 단어 TEST 칸이 있음", /단어 TEST/.test(body2), null);
  ck("날짜가 MM/DD 요일 로 나옴 (ISO 가 새지 않음)", !/T\d\d:/.test(body2) && /\d\d\/\d\d\s*[일월화수목금토]/.test(body2), body2.slice(0, 200));
  const trs = await pg.locator("table.pt tbody tr").count();
  ck("표에 수업 줄이 들어 있음", trs >= 1, { trs });
  // 설치 직후에도 지난 두 달치가 들어 있어 줄이 여럿 나옵니다.
  // 그래도 기록이 적을 때는 "고장난 게 아니다" 안내가 떠야 합니다.
  if (trs <= 1) ck("★ 기록이 적을 때 해결법을 알려 줌", /test_3_month\.sql/.test(body2), body2.slice(0, 400));
  // 기간을 바꿔도 화면이 깨지지 않아야 한다
  await pg.locator('#seg button[data-d="7"]').click();
  await pg.waitForTimeout(1500);
  const n7 = await pg.locator("table.pt tbody tr").count();
  ck("1주로 좁혀도 화면이 안 깨짐", (await pg.locator("body").innerText()).length > 50, { n7 });
  await pg.locator('#seg button[data-d="90"]').click();
  await pg.waitForTimeout(1800);
  const n90 = await pg.locator("table.pt tbody tr").count();
  ck("★ 기간(1주/3달)을 바꾸면 줄 수가 늘거나 같음", n90 >= n7, { n7, n90 });
  ck("기간을 바꾸면 주소에도 남음 (새로고침해도 유지)", /days=90/.test(pg.url()), pg.url());
  // 학생을 바꾸면 그 학생 것으로 바뀌어야 한다
  const opts = await pg.locator("#stu option").count();
  ck("학생 고르기 드롭다운", opts >= 3, { opts });
  ck("날짜별 자세히가 보임", /날짜별 자세히/.test(await pg.locator("body").innerText()), null);
}

// 교재·목차
await pg.goto(B + "/books.html", { waitUntil: "networkidle" });
await pg.waitForTimeout(900);
ck("books.html 교재 목록 보임", (await pg.locator("body").innerText()).includes("그래머"), null);

// 현황판
// 수업 중에 **옆에 띄워놓고 복사**하는 화면 — 프롬프트가 다 있고 찾기가 되나.
//   예전에는 51개 중 8개만 있었고 나머지는 노션에서 긁어야 했습니다.
{
  await pg.goto(B + "/handout.html", { waitUntil: "networkidle" });
  await pg.waitForTimeout(900);
  const n = await pg.locator(".pitem").count();
  ck("핸드아웃에 프롬프트가 다 있다 (50개 이상)", n >= 50, { n });
  await pg.fill("#pq", "평가서");
  await pg.waitForTimeout(400);
  const hit = await pg.locator(".pitem:not([hidden])").count();
  ck("찾기가 걸러준다", hit > 0 && hit < n, { 전체: n, 걸러진것: hit });
  await pg.fill("#pq", "");
  await pg.waitForTimeout(300);
  const btn = pg.locator(".pitem .copy-btn").first();
  await btn.click();
  await pg.waitForTimeout(500);
  ck("복사 버튼이 눌린다", /복사됨/.test(await btn.innerText()), await btn.innerText());
}

// 🏠 홈 버튼 — 화면끼리 왔다 갔다 되는지.
//   ★ 여기에 화면을 빠뜨리면 그 화면만 홈 버튼 없이 나갑니다. 실제로 선생님앱이
//     목록에 없어서 「홈으로 가는 버튼이 없다」는 말을 들었습니다.
//     원장님이 쓰는 화면은 **전부** 넣으세요.
//     (student.html·parent.html 은 학생·학부모 화면이라 홈으로 보내지 않습니다)
for (const path of ["/board.html", "/daily.html", "/students.html", "/books.html",
                    "/report.html", "/teacher.html", "/student_card.html",
                    "/kiosk.html", "/import.html"]) {
  await pg.goto(B + path, { waitUntil: "networkidle" });
  const home = pg.locator('a[href="/"]').first();
  const 있나 = (await home.count()) > 0;
  ck(`${path} 에 🏠 홈 버튼이 있다`, 있나, null);
  if (있나) {
    await home.click();
    await pg.waitForLoadState("networkidle");
    ck(`${path} → 홈으로 간다`, new URL(pg.url()).pathname === "/", pg.url());
  }
}

await pg.goto(B + "/board.html", { waitUntil: "networkidle" });
await pg.waitForTimeout(900);
ck("board.html 학생 보임", (await pg.locator("body").innerText()).includes("김민준"), null);

// 선생님앱: 담당 선택 → 담당 학생만
await pg.goto(B + "/teacher.html", { waitUntil: "networkidle" });
await pg.waitForTimeout(1200);
const opts = await pg.locator("#teacher option").count();
ck("teacher.html 담당 선생님 목록", opts >= 3, { opts });
await pg.selectOption("#teacher", "박선생");
await pg.waitForTimeout(1200);
const body = await pg.locator("body").innerText();
ck("★ 담당 학생만 보임 (박도윤 O / 김민준 X)", body.includes("박도윤") && !body.includes("김민준"), body.slice(0, 160));
// 과제 이력 드롭다운도 담당 학생만이어야 한다 (선생님을 바꾸면 다시 채워져야 함)
{
  const names = await pg.locator("#hStudent option").allInnerTexts().catch(() => []);
  ck("★ 과제 이력 드롭다운도 담당 학생만", names.length > 0 && !names.includes("김민준"), names);
  // 기간 조회가 실제로 되는지
  await pg.locator("#hFrom").fill("2026-01-01");
  await pg.locator("#hTo").fill("2026-12-31");
  await pg.locator("button:has-text('보기')").first().click();
  await pg.waitForTimeout(1500);
  const h = await pg.locator("#hstats").innerText().catch(() => "");
  ck("★ 학생별 과제 이력이 조회됨", /완료율|받은 과제/.test(h), h.slice(0, 120));
  // 「미완료만」 이 기본으로 켜져 있어야 한다 (운영 과제 현황 화면과 같은 기본값 —
  // 선생님이 이력에서 찾는 건 "누가 안 했나" 이기 때문)
  const pendOn = await pg.locator("#hPending").isChecked().catch(() => null);
  ck("★ 「미완료만」이 기본으로 켜져 있음", pendOn === true, pendOn);
  const onlyPending = await pg.locator("#history .tline .st").allInnerTexts().catch(() => []);
  ck("미완료만 켜면 완료 건이 안 보임", onlyPending.every((x) => x.includes("미완료")), onlyPending.slice(0, 5));
  await pg.locator("#hPending").uncheck();
  await pg.waitForTimeout(600);
  const allRows = await pg.locator("#history .tline").count().catch(() => 0);
  ck("끄면 전부 보임", allRows >= onlyPending.length, { allRows, pending: onlyPending.length });
}

// 학생앱 로그인
//   ★ 학생을 박아두면 안 됩니다. demo01(김민준) 을 박아뒀는데 그 학생은 토요일 수업이
//     없어서, 「그날 수업 있는 학생에게만 행을 깐다」 로 고친 뒤 과제가 0개로 나왔습니다.
//     **오늘 수업이 있는 학생**을 찾아서 들어갑니다 (무슨 요일에 돌려도 되게).
const 오늘학생 = await (async () => {
  const 요일 = "일월화수목금토"[new Date(Date.now() + 9 * 3600 * 1000).getUTCDay()];
  const d = await (await fetch(`${B}/api/attendance?action=students`)).json();
  return (d.students || []).find((x) => x.status === "재원" && x.student_code && x.pin
    && String((x.schedule || {})[요일] || "").trim());
})();
ck("오늘 수업인 샘플 학생이 있다", Boolean(오늘학생), "없음 — 어느 요일에 돌려도 최소 몇 명은 있어야 합니다");
await pg.goto(B + "/student.html", { waitUntil: "networkidle" });
await pg.fill("#code", 오늘학생?.student_code || "demo01");
await pg.fill("#pin", 오늘학생?.pin || "1111");
await pg.click("button.btn");
await pg.waitForTimeout(1500);
ck("★ 학생앱 로그인 성공", (await pg.locator("#home").isVisible()), await pg.locator("#err").innerText());
ck(`학생앱 과제 보임 (${오늘학생?.name || "?"})`, (await pg.locator(".task").count()) >= 1,
   { 학생: 오늘학생?.name, n: await pg.locator(".task").count() });
  // 날짜가 "10-27T00:00:00.000Z" 처럼 새면 아이가 보는 화면이 망가집니다.
  //   학생카드에는 이 점검이 있었는데 학생앱에는 없어서, 스크린샷 찍다가 발견했습니다.
  {
    const body = await pg.locator("body").innerText();
    ck("학생앱 날짜에 ISO 가 안 샌다", !/T\d\d:\d\d/.test(body), body.slice(0, 200));
  }
  // 알림 말풍선(toast)은 화면 밖으로 밀어두기만 해서, 전체 캡처·녹화에
  //   **글자 없는 까만 알약**으로 찍혔습니다. 평소엔 아예 안 보여야 합니다.
  for (const [page, name] of [[pg, "학생앱"]]) {
    ck(`${name} 알림 말풍선이 평소엔 안 보인다`, !(await page.locator("#toast").isVisible()), null);
    // 말풍선은 **체크할 때만** 뜹니다. 이미 체크된 걸 누르면 해제라 안 떠요 —
    //   그래서 아직 안 한 과제를 골라야 합니다 (처음에 이걸로 헛걸렸습니다).
    await page.locator(".task:not(.done)").first().click();
    await page.waitForTimeout(500);
    ck(`${name} 체크하면 알림 말풍선이 뜬다`, await page.locator("#toast").isVisible(),
       await page.locator("#toast").innerText().catch(() => ""));
    await page.waitForTimeout(2000);
    ck(`${name} 잠시 뒤 다시 숨는다`, !(await page.locator("#toast").isVisible()), null);
  }

// 학부모·선생님 화면에서 **같은 말로 다른 숫자**를 보여주던 자리.
//   도넛은 결석까지 포함한 「총 수업일」(22), 아래 타일은 나온 날(20) 인데
//   둘 다 「수업일」이라고 적혀 있어서 학부모가 보기에 엇갈렸습니다.
for (const [path, 이름] of [["/parent.html", "학부모 화면"], ["/report.html", "월말평가서 화면"]]) {
  const src = await (await fetch(B + path)).text();
  ck(`${이름}: 결석 포함 숫자는 「총 수업일」로 적는다`, src.includes("총 수업일"), null);
  // 「'수업일'」 처럼 라벨로 홀로 쓰인 자리가 남아 있으면 또 엇갈립니다.
  const 홀로 = src.match(/['"]수업일['"]/g) || [];
  ck(`${이름}: 그냥 「수업일」이라고만 적힌 라벨이 없다`, 홀로.length === 0, 홀로);
}

ck("조작 중 JS 오류 없음", errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
