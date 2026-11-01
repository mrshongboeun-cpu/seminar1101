// 가짜 Anthropic 서버 — 월말평가서 생성을 **돈 안 쓰고** 끝까지 돌려보기 위한 것.
//
// lib/claude.js 는 ANTHROPIC_BASE_URL 이 있으면 그리로 보냅니다. 검수에서만 씁니다.
// 운영에서는 그 환경변수를 넣지 않으니 진짜 Anthropic 으로 갑니다.
//
// 받은 프롬프트를 들여다보고, 평가서에 꼭 들어가야 할 것들이
// 실제로 담겨 있는지까지 봅니다(학생 이름·기간·진도).
//
//   node scripts/verify/anthropic-mock.mjs   (PORT 기본 4399)

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT || 4399);

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw); } catch { /* 형식이 깨졌으면 아래에서 걸립니다 */ }

    const system = String(body.system ?? "");
    const user = String(body.messages?.[0]?.content ?? "");

    // 보낸 것이 멀쩡한지 — 이게 깨져 있으면 진짜 Claude 도 엉뚱한 평가서를 씁니다.
    const problems = [];
    if (!body.model) problems.push("model 없음");
    if (!system || system.length < 50) problems.push("지침(system)이 비었거나 너무 짧음");
    if (!user || user.length < 50) problems.push("데이터(user)가 비었거나 너무 짧음");
    if (!/Daily report|학습 리포트/.test(user)) problems.push("user 에 요청 문장이 없음");
    if (problems.length) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "보낸 내용이 이상합니다: " + problems.join(" · ") } }));
      return;
    }

    // 학생 이름을 그대로 돌려줘서, 엉뚱한 학생 데이터로 만들어지지 않았는지 확인합니다.
    const name = (user.match(/^(\S+?) 학생의/m) || [])[1] || "학생";
    const text =
      `${name} 학생은 이번 달 수업에 성실히 참여했습니다. ` +
      `(이것은 검수용 가짜 응답입니다 — 실제 평가서는 Claude 가 씁니다.)`;

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text }],
      usage: { input_tokens: 0, output_tokens: 0 },
    }));
  });
});

server.listen(PORT, () => console.log(`가짜 Anthropic 서버 :${PORT}`));
