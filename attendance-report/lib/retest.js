// 재시 안내 대상 판정 — 「불통과」 버튼 **그리고 점수칸** 둘 다 봅니다.
//
// 왜 점수까지 보나:
//   선생님은 보통 점수만 적습니다 (「12/20」). 예전에는 그러면 재시 안내가
//   큐에 안 올라가서, 학부모에게 안내가 안 나갔습니다. 점수를 적어두고도
//   「불통과」 버튼을 따로 눌러야 한다는 걸 기억해야 했거든요.
//
// 누가 이기나:
//   **결과칸(통과/불통과)을 직접 누르면 그게 이깁니다.** 점수는 결과칸이
//   비어 있을 때만 봅니다. 「통과」를 눌러놓고 점수가 낮아도 재시로 올라가지
//   않습니다 — 선생님 판단이 우선입니다.

// ★★ 우리 학원 기준 — 이 두 줄만 바꾸면 됩니다 ★★
//    (Vercel 환경변수 RETEST_PASS_PERCENT / VOCA_FULL_SCORE 를 넣으면 그게 이깁니다)
//
//   PASS  = 몇 % 이상이면 통과인가. 기본 80 (= 20문항에서 16개)
//   FULL  = 「18」 처럼 **숫자만** 적었을 때의 만점.
//           기본 0 = 숫자만 적은 건 **판정하지 않습니다.**
//           만점을 모르면 「18」이 18점인지 18/20(90점)인지 알 수 없어서,
//           잘못 짚고 학부모에게 재시 카톡을 보내는 게 더 나쁩니다.
//           → 점수는 「18/20」 처럼 적어주세요 (그러면 만점을 몰라도 됩니다).
//           → 늘 100점 만점으로 적는 학원이면 아래를 100 으로,
//             20문항이면 20 으로 바꿔두세요.
const PASS_DEFAULT = 80;
const FULL_DEFAULT = 0;

// ⚠️ 빈 문자열을 Number() 에 넣으면 **0** 이 나옵니다. 환경변수를 안 넣었을 때
//    기준이 0% 가 돼서 아무도 재시 대상이 안 되는 사고가 났었습니다 — 빈 값은 기본값으로.
const num = (v, dflt) => {
  const s = String(v ?? "").trim();
  if (!s) return dflt;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};
export const RETEST_PASS = num(process.env.RETEST_PASS_PERCENT, PASS_DEFAULT);
export const VOCA_FULL = num(process.env.VOCA_FULL_SCORE, FULL_DEFAULT);

// 단어테스트 "못 넘어갔다" 판정 — 운영은 '불통과', 노션에서 옮겨오면 '미통과',
// 손으로 '재시' 라고 적어둔 행도 있습니다(운영 isFailResult 와 같은 범위).
// ⚠️ '1차미통과' 도 '통과' 를 품고 있으니 **미/불통과를 먼저** 봐야 합니다.
export function isFailText(v) {
  return /불통과|미통과|재시/.test(String(v || ""));
}

// 점수칸을 **백분율**로 읽습니다. 못 읽으면 null (= 판정 안 함).
//   「12/20」 「12 / 20」 → 60      ← 만점을 같이 적어줘서 가장 확실합니다
//   「60%」              → 60
//   「60」 「60점」       → FULL 기준. FULL 이 0 이면 null
//   「A」 「통과」 「-」   → null
export function scorePercent(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const frac = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(s);
  if (frac) {
    const got = Number(frac[1]), full = Number(frac[2]);
    return full > 0 ? (got / full) * 100 : null;
  }
  const one = /(\d+(?:\.\d+)?)/.exec(s);
  if (!one) return null;
  const n = Number(one[1]);
  if (s.includes("%")) return n;
  return VOCA_FULL > 0 ? (n / VOCA_FULL) * 100 : null;
}

// 이 행이 "단어를 못 넘겼다" 인가 — 결과칸이 비었을 때만 점수로 봅니다.
export function isFail(vocaTest, vocaScore) {
  const t = String(vocaTest || "").trim();
  if (t) return isFailText(t);
  const p = scorePercent(vocaScore);
  return p === null ? false : p < RETEST_PASS;
}

// 화면 점수칸 밑에 띄울 한 줄 — 선생님이 "올라갔나 안 올라갔나" 를 눈으로 봅니다.
// 조용히 안 올라가는 게 제일 나쁘기 때문에, 판정 못 한 경우도 말해줍니다.
export function retestHint(vocaTest, vocaScore) {
  const t = String(vocaTest || "").trim();
  const s = String(vocaScore || "").trim();
  if (t) {
    if (isFailText(t)) return `🔁 「${t}」 — 재시 안내 대상`;
    return s ? `「${t}」 로 눌러두셨어요 (점수보다 이게 우선)` : "";
  }
  if (!s) return "";
  const p = scorePercent(s);
  if (p === null) {
    return VOCA_FULL > 0
      ? "점수를 숫자로 읽지 못했어요 — 「18/20」 처럼 적어주세요"
      : "만점을 몰라 판정 못 했어요 — 「18/20」 처럼 적으시거나, 위 통과/불통과를 눌러주세요";
  }
  const pct = Math.round(p);
  return p < RETEST_PASS
    ? `🔁 ${pct}% (기준 ${RETEST_PASS}%) — 재시 안내 대상`
    : `${pct}% (기준 ${RETEST_PASS}%) — 통과`;
}

// 재시 안내 카톡 큐 — 운영(studyplanner admin-api 의 `단어카톡`)과 같은 규칙.
//   · 못 넘김 → '미전송'(발송 대기)   · 통과로 고쳐지면 → 비움(대기 해제)
//   · 이미 '전송' 인 행은 안 건드림 (두 번 보내지 않게)
// 바꿀 필요가 없으면 undefined 를 돌려줘서 호출하는 쪽이 아무것도 안 하게 합니다.
export function retestQueueValue(cur, vocaTest, vocaScore) {
  if (cur === "전송") return undefined;
  if (isFail(vocaTest, vocaScore)) return cur === "미전송" ? undefined : "미전송";
  return cur === "미전송" ? null : undefined;
}

// "재시 안내를 보내야 하는 행" 판정 (서버·화면이 같은 규칙을 쓰게 여기서 한 번만)
//  · 이미 '전송' 이면 끝 · '미전송'(큐에 올라간 것) 이거나 못 넘긴 행이면 대상
//  (노션에서 옮겨와 큐를 안 거친 행도 놓치지 않으려고 결과·점수까지 같이 봅니다)
export function needsRetest(rec) {
  if (!rec || rec.retest_sent === "전송") return false;
  return rec.retest_sent === "미전송" || isFail(rec.voca_test, rec.voca_score);
}
