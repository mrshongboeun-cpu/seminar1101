// 알림톡이 안 나갈 때, 화면이 **무엇을 고쳐야 하는지** 말해주나 — lib/solapi.js 단위 점검.
//
// 왜 생겼나: 원장님이 당신 번호로 바꿔 보내봤는데 안 나갔습니다. 그런데 화면에는
//   「발송 실패」 넉 자뿐이라 왜인지 알 길이 없었습니다. 솔라피가 401·400 으로 거절하면
//   예전 코드는 사유를 아예 안 담아 보냈거든요.
//   세미나 당일 알림톡은 40명이 동시에 처음 눌러보는 자리입니다.
//
//   node scripts/verify/solapi-unit.mjs
process.env.SOLAPI_API_KEY="k"; process.env.SOLAPI_API_SECRET="s";
process.env.SOLAPI_SENDER="01000000000"; process.env.SOLAPI_PFID="pf";
const { sendAlimtalk } = await import("../../lib/solapi.js");
let n=0,bad=0; const ck=(t,ok,d)=>{n++;if(!ok){bad++;console.log("  FAIL "+t+" → "+JSON.stringify(d));}else console.log("  ok  "+t);};
const 가짜 = (status, body) => { globalThis.fetch = async () => ({ ok: status<400, status, json: async()=>body }); };

for (const [라벨, status, body, 기대] of [
  ["검수 안 난 템플릿", 400, {errorCode:"ValidationError", errorMessage:"template not found"}, "검수 승인"],
  ["변수 안 맞음", 400, {failedMessageList:[{reason:"invalid variable #{단어테스트}"}]}, "변수 이름"],
  ["채널 안 맞음", 400, {errorCode:"InvalidPfId", errorMessage:"pfId mismatch"}, "카카오 채널"],
  ["발신번호 미등록", 400, {errorCode:"E", errorMessage:"sender number not registered"}, "발신번호"],
  ["IP 제한 (원장님이 실제로 겪은 것)", 403, {errorCode:"Forbidden", errorMessage:"허용되지 않은 IP(13.223.235.127)로 접근하고 있습니다."}, "모든 IP 허용"],
  ["키 틀림", 401, {errorCode:"Unauthorized", errorMessage:"invalid signature"}, "Redeploy"],
  ["잔액 부족", 400, {errorCode:"E", errorMessage:"not enough balance"}, "잔액"],
  ["사유를 안 줄 때", 500, {}, "HTTP 500"],
]) {
  가짜(status, body);
  const r = await sendAlimtalk("01012345678","TPL",{});   // 가짜 번호 (검수용)
  ck(`${라벨} → ${기대}`, !r.success && String(r.reason||"").includes(기대), r);
}
가짜(200, {groupInfo:{}});
const ok = await sendAlimtalk("01012345678","TPL",{});   // 가짜 번호 (검수용)
ck("성공하면 success:true", ok.success===true, ok);
console.log(bad?`\n❌ ${bad}/${n} 실패`:`\n✅ ${n}가지 전부 통과`);
process.exit(bad?1:0);
