// Claude(Anthropic) Messages API — 월말평가서 생성.
//   바꾸고 싶으면: 모델 = MODEL 한 줄 / 지침 = reportGuideline() / 데이터형식 = buildDataSummary()
//
// ★ 아래 지침은 **어느 학원에나 무난한 기본값**입니다. 그대로도 쓸 만하게 나옵니다.
//   다만 평가서 말투는 학원마다 달라야 하는 것이고, 그걸 바꾸는 게 이 시스템의 핵심입니다.
//   클로드에게 이렇게 말하면 됩니다:
//      "월말평가서 말투를 우리 학원 스타일로 바꿔줘. lib/claude.js 의 reportGuideline() 이야."
//   세미나 자료실의 「클로드에게 말하기」에 바로 붙여 쓸 수 있는 지침 예시가 있습니다.

const MODEL = "claude-sonnet-5"; // 품질↑ "claude-opus-5" / 저렴 "claude-haiku-4-5"
// 검수용으로만 주소를 바꿔 끼웁니다(ANTHROPIC_BASE_URL). 안 넣으면 진짜 Anthropic.
// 월말평가서는 이 세미나의 간판인데, 진짜 키로 돌리면 돈이 들어서 검수에서 빠져 있었습니다.
const API = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages";

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function periodLabelOf(month) {
  const [y, m] = String(month).split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

// 월말평가서 작성 지침 — **무난한 기본값**. 학원 말투는 각자 바꿔 쓰는 것이 전제입니다.
export function reportGuideline() {
  return [
    "당신은 학원 선생님으로서 학부모에게 보내는 학생의 월간 학습 리포트를 작성합니다.",
    "",
    "[형식 — 꼭 지킬 것]",
    "마크다운·서식 기호 일체 금지: #, ##, **, *, - 등 모두 쓰지 마세요.",
    "순수 텍스트(plain text)로만 쓰고, 단락 구분은 빈 줄로만 하세요.",
    "첫 줄에 제목을 기호 없이 텍스트로 쓰고, 본문은 자연스러운 문단으로 이어 쓰세요.",
    "섹션 제목·구분선·표를 넣지 마세요. 담당교사 정보나 데이터 표도 넣지 마세요.",
    "",
    "[분량·어조]",
    "800~1000자. 선생님 1인칭으로 자연스럽게.",
    "긍정적으로 쓰되 개선점은 분명히. 과한 칭찬이나 상투적인 격려 문구는 지양하세요.",
    "",
    "[본문에 담을 것]",
    "영역별(리딩·문법·단어)로 이번 달 무엇을 어떻게 학습했는지 서술하세요.",
    "출석·수업 태도·과제 수행에 대한 전반적인 모습을 한 문단으로 담으세요.",
    "다음 달 학습 방향(교재 진행 방향, 복습/심화, 개선 목표)을 덧붙이세요.",
    "마지막에 가정에서 도움이 될 실천 사항을 한두 가지 안내하세요.",
    "",
    "[주의]",
    "주어진 데이터에 없는 사실을 지어내지 마세요.",
    "학생을 다른 학생과 비교하지 마세요.",
  ].join("\n");
}

// AI에 주는 데이터 요약 (2차 배포본 buildDataSummaryText 형식 이식)
export function buildDataSummary({ studentName, periodLabel, planner, comment, dailyNotes }) {
  const p = planner;
  const L = [];
  L.push("【학생명】" + studentName);
  L.push("【평가기간】" + periodLabel);
  L.push("");
  L.push(`【출석】총 ${p.총수업일수}일 중 정시 ${p.출석.정시등원}회, 지각 ${p.출석.지각}회, 결석 ${p.출석.결석}회`);
  L.push(`【태도】상 ${p.태도.상}회, 중 ${p.태도.중}회, 하 ${p.태도.하}회`);
  L.push("");
  if (p.단어테스트.총횟수 > 0) {
    const rate = Math.round((p.단어테스트.통과 / p.단어테스트.총횟수) * 100);
    L.push(`【단어테스트】${p.단어테스트.총횟수}회 중 통과 ${p.단어테스트.통과}회 (${rate}%)`);
  } else {
    L.push("【단어테스트】기록 없음");
  }
  L.push("");
  L.push("【진도 현황 - 월초 → 최종】");
  for (const 영역 of ["문법", "리딩", "단어"]) {
    const 월초 = p.월초진도[영역];
    const 최종 = p.최종진도[영역];
    if (!최종) continue;
    const 최종유닛 = [최종.유닛코드, 최종.제목].filter(Boolean).join(" ");
    let line = 영역 + ": ";
    if (월초 && 월초.교재명 !== 최종.교재명) {
      line += `${월초.교재명} → ${최종.교재명} ${최종유닛}`;
    } else {
      line += `${최종.교재명} ${최종유닛}`;
    }
    L.push(line);
  }
  L.push("");
  if (p.교재전환 && p.교재전환.length > 0) {
    L.push("【교재 전환 내역】(이전 교재 완료 후 새 교재 시작)");
    p.교재전환.forEach((t) => L.push(`- ${t.영역}: "${t.이전교재}" 마무리 → "${t.새교재}" 시작`));
    L.push("");
  }
  const hw = p.과제 || { 상: 0, 중: 0, 하: 0 };
  const hwTotal = hw.상 + hw.중 + hw.하;
  if (hwTotal > 0) {
    const hwPct = Math.round((hw.상 / hwTotal) * 100);
    L.push(`【과제 수행도】상 ${hw.상}회, 중 ${hw.중}회, 하 ${hw.하}회 (상 비율 ${hwPct}%)`);
  } else {
    L.push("【과제 수행도】기록 없음");
  }
  // 학생이 앱에서 직접 체크한 과제 — 선생님이 매긴 등급과 별개 자료입니다.
  // 과제를 안 내준 달이면 아예 넣지 않습니다(없는 걸 지어내지 않게).
  const tc = p.과제체크;
  if (tc && tc.총건수 > 0) {
    const parts = [`받은 과제 ${tc.총건수}개 중 ${tc.완료}개 완료 (${tc.완료율}%)`];
    if (tc.집과제) parts.push(`집과제 ${tc.집과제.완료}/${tc.집과제.총건수}`);
    if (tc.학원과제) parts.push(`학원과제 ${tc.학원과제.완료}/${tc.학원과제.총건수}`);
    L.push(`【과제 체크(학생 앱)】${parts.join(" · ")}`);
  }
  if (dailyNotes && dailyNotes.length > 0) {
    L.push("");
    L.push("【데일리 지적사항 모음】(그 달 매일 기록된 특이사항 — 반복되는 패턴만 자연스럽게 반영, 일회성은 제외)");
    dailyNotes.forEach((n) => L.push(`- ${n}`));
  }
  if (comment) {
    L.push("");
    L.push("【선생님 참고사항】");
    L.push(comment);
  }
  return L.join("\n");
}

export async function generateReport({ student, month, planner, comment, dailyNotes }) {
  const periodLabel = periodLabelOf(month);
  const system = reportGuideline();
  const data = buildDataSummary({ studentName: student.name, periodLabel, planner, comment, dailyNotes });
  const user = `${student.name} 학생의 ${periodLabel} Daily report 데이터입니다. 학습 리포트를 작성해주세요.\n\n${data}`;

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(await friendlyClaudeError(res));
  const d = await res.json();
  return (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

// Claude API 가 거절했을 때 **사람이 읽을 수 있는 말**로 바꿔 줍니다.
//   예전에는 응답 JSON 을 그대로 화면에 뿌려서
//   `401 {"type":"error","error":{"type":"authentication_error",...}}` 이 떴습니다.
//   수강생은 이걸 보면 앱이 고장난 줄 압니다. 무엇을 하면 되는지까지 적어 줍니다.
async function friendlyClaudeError(res) {
  const raw = await res.text().catch(() => "");
  let kind = "";
  try { kind = JSON.parse(raw)?.error?.type || ""; } catch { /* JSON 이 아니면 그냥 넘어갑니다 */ }

  const 환경변수안내 =
    "Vercel → Settings → Environment Variables 에서 ANTHROPIC_API_KEY 를 고친 뒤 " +
    "**Redeploy** 하셔야 적용됩니다.";

  if (res.status === 401 || kind === "authentication_error")
    return "월말평가서 AI 키가 올바르지 않습니다 (401). " +
      "console.anthropic.com → API Keys 에서 키를 새로 만들어 넣어 주세요. " +
      "`sk-ant-` 로 시작해야 하고, 앞뒤에 공백이나 줄바꿈이 들어가면 안 됩니다. " + 환경변수안내;

  if (res.status === 400 && kind === "invalid_request_error" && /credit|balance/i.test(raw))
    return "Anthropic 크레딧이 부족합니다. console.anthropic.com → Billing 에서 충전해 주세요. " +
      "(평가서 한 장에 수십 원 수준입니다)";

  if (res.status === 403 || kind === "permission_error")
    return "이 키로는 월말평가서 모델을 쓸 수 없습니다 (403). " +
      "console.anthropic.com 에서 결제수단이 등록돼 있는지 보세요. " + 환경변수안내;

  if (res.status === 429 || kind === "rate_limit_error")
    return "요청이 몰렸습니다 (429). 1~2분 뒤에 다시 눌러 주세요. " +
      "여러 명을 한꺼번에 돌리셨다면 나눠서 돌리시면 됩니다.";

  if (res.status >= 500)
    return `Anthropic 쪽이 잠시 불안정합니다 (${res.status}). 잠시 뒤 다시 눌러 주세요. ` +
      "평가서 통계·저장·학부모 열람은 그대로 됩니다.";

  return `월말평가서 생성에 실패했습니다 (${res.status}). ${String(raw).slice(0, 200)}`;
}
