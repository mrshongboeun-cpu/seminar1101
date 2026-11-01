// 솔라피 카카오 알림톡 (선택 모듈). 미설정이면 조용히 건너뛴다 — 나머지 기능엔 영향 없음.
// 필요한 환경변수:
//   SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER(발신번호), SOLAPI_PFID(=2차의 SOLAPI_PF_ID도 인정)
//   TPL_CHECKIN / TPL_CHECKOUT / TPL_LATE / TPL_DAILY / TPL_REPORT / TPL_RETEST (검수 통과한 템플릿 ID)
//
// 템플릿 변수는 세미나2와 동일:
//   등원 #{학생이름}#{등원시간}#{하원시간} · 하원 #{학생이름}#{하원시간}
//   미등원 #{학생이름}#{예정시간}
//   데일리리포트 #{학생이름}#{날짜}#{진도}#{태도}#{과제}#{단어테스트}#{추가사항}
//   월말 #{학생이름}#{연월}#{링크}
//   재시 안내 #{학생이름}#{날짜}#{단어교재}#{단어테스트}#{점수}   ← 6차에서 추가(운영과 같은 변수)

import crypto from "node:crypto";

const API = "https://api.solapi.com/messages/v4/send-many";

// 카카오 채널 pfId — 6차 이름(SOLAPI_PFID)이 기본, 2차 세미나 때 쓰던 이름(SOLAPI_PF_ID)도 그대로 인정.
// (2·3차 수강생이 예전 메모를 그대로 붙여넣어도 동작하게. 둘 다 없을 때만 미설정으로 본다)
export function solapiPfId() {
  return process.env.SOLAPI_PFID || process.env.SOLAPI_PF_ID || "";
}

export function solapiConfigured() {
  return Boolean(
    process.env.SOLAPI_API_KEY &&
    process.env.SOLAPI_API_SECRET &&
    process.env.SOLAPI_SENDER &&
    solapiPfId()
  );
}

export const TPL = {
  checkin: process.env.TPL_CHECKIN,
  checkout: process.env.TPL_CHECKOUT,
  late: process.env.TPL_LATE,
  daily: process.env.TPL_DAILY,   // 데일리 리포트 (학부모 발송)
  report: process.env.TPL_REPORT, // 월말평가서
  // 재시 안내 — 단어테스트 불통과한 학생만. 미등록이면 조용히 skip 되고
  // 다른 기능엔 영향이 없으니, 템플릿 검수를 기다리는 동안 그냥 비워두셔도 됩니다.
  retest: process.env.TPL_RETEST,
};

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto
    .createHmac("sha256", (process.env.SOLAPI_API_SECRET || "").trim())
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${(process.env.SOLAPI_API_KEY || "").trim()}, date=${date}, salt=${salt}, signature=${signature}`;
}

// 성공/실패와 무관하게 절대 throw 하지 않는다 (알림톡 실패가 출결을 막으면 안 됨).
// 솔라피가 영어·코드로 주는 사유를, 수강생이 **무엇을 고쳐야 하는지** 알 수 있는 말로.
//   세미나 당일 알림톡이 안 나갈 때 「발송 실패」 넉 자만 보면 아무도 못 고칩니다.
function 읽기쉽게(reason) {
  const r = String(reason || "");
  const 보태기 = (말) => `${말}\n(솔라피가 알려준 것: ${r})`;
  if (/ValidationError|InvalidTemplate|template.*not.*found|TemplateNotFound/i.test(r))
    return 보태기("템플릿 ID가 틀렸거나 **아직 검수 승인이 안 난** 템플릿입니다. 솔라피 콘솔에서 승인 상태를 보세요.");
  if (/variable|변수/i.test(r))
    return 보태기("템플릿의 **변수 이름과 안 맞습니다.** 템플릿에 적은 #{...} 과 글자까지 똑같아야 해요 (띄어쓰기도).");
  if (/pfId|channel|채널/i.test(r))
    return 보태기("카카오 채널(pfId)이 안 맞습니다. SOLAPI_PFID 가 **그 템플릿을 등록한 채널**의 것인지 보세요.");
  if (/sender|발신|from/i.test(r))
    return 보태기("발신번호가 솔라피에 **등록돼 있지 않습니다.** SOLAPI_SENDER 를 등록된 번호로.");
  // ★ 새로 만든 키는 IP 제한이 걸린 채로 생깁니다. Vercel 은 요청마다 IP 가 바뀌어서
  //   그 IP 하나만 추가하면 오늘 되고 내일 안 됩니다 — 「모든 IP 허용」이 맞습니다.
  if (/허용되지 않은 IP|Forbidden|not allowed ip|ip.*not.*allow/i.test(r))
    return 보태기(
      "솔라피 API Key 에 **IP 제한**이 걸려 있습니다. 솔라피 → API Key → 그 키의 ⋮ → " +
      "**허용 IP 설정 → 모든 IP 허용** 으로 바꿔주세요.\n" +
      "(위에 적힌 IP 는 원장님 컴퓨터가 아니라 **앱이 올라간 서버**의 것이고, 요청마다 바뀝니다. " +
      "그 IP 하나만 추가하면 오늘 되고 내일 안 됩니다.)"
    );
  if (/Unauthorized|401|signature|apiKey|인증/i.test(r))
    return 보태기("솔라피 API 키·시크릿이 틀렸습니다. 넣은 뒤 **Redeploy** 를 눌렀는지도 보세요.");
  if (/balance|잔액|point/i.test(r))
    return 보태기("솔라피 **잔액이 부족**합니다. 충전 후 다시 보내세요.");
  if (/phone|수신|recipient|number/i.test(r))
    return 보태기("받는 번호가 올바르지 않습니다. 학생 관리의 학부모 연락처를 보세요.");
  return r || "발송 실패";
}

export async function sendAlimtalk(to, templateId, variables) {
  if (!solapiConfigured()) return { skipped: true, reason: "미설정" };
  if (!templateId) return { skipped: true, reason: "템플릿ID 없음" };
  const phone = String(to || "").replace(/[^0-9]/g, "");
  if (phone.length < 10) return { skipped: true, reason: "연락처 없음" };

  const body = {
    messages: [
      {
        to: phone,
        from: String(process.env.SOLAPI_SENDER).replace(/[^0-9]/g, ""),
        kakaoOptions: {
          pfId: solapiPfId(),
          templateId,
          variables: variables || {},
          disableSms: false, // 실패 시 문자 대체
        },
      },
    ],
  };
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    // 솔라피가 "이 건은 못 보냈다" 고 알려준 경우 — 사유가 제일 정확합니다
    if (data.failedMessageList && data.failedMessageList.length > 0) {
      const f = data.failedMessageList[0];
      return { success: false, reason: 읽기쉽게(f.reason || f.statusMessage || "발송 실패") };
    }

    // ★ 요청 자체가 거절된 경우(401·400 …). 예전에는 여기서 사유 없이 그냥 실패만
    //   돌려줘서, 화면에 「발송 실패」 넉 자만 뜨고 왜인지 알 길이 없었습니다.
    if (!res.ok) {
      const 코드 = data.errorCode || "";
      const 말 = data.errorMessage || data.message || "";
      return { success: false, reason: 읽기쉽게(`${코드} ${말}`.trim() || `솔라피가 거절했어요 (HTTP ${res.status})`) };
    }
    return { success: true, detail: data };
  } catch (e) {
    return { success: false, reason: `솔라피에 못 닿았어요: ${String(e.message || e)}` };
  }
}
