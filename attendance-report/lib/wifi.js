// 📶 학원 와이파이 판정 — 답지는 **학원 인터넷에서만** 열립니다.
//
// 어떻게 아나:
//   학원 와이파이에 붙은 기기는 모두 **같은 공인 IP**(학원 인터넷 회선의 주소)로 나갑니다.
//   서버가 요청이 온 IP 를 보고, 등록해 둔 학원 IP 와 같을 때만 답지를 내줍니다.
//   (휴대폰 데이터·집 와이파이로 열면 IP 가 달라서 안 열립니다)
//
// 학원 IP 등록:
//   Vercel 환경변수 **ACADEMY_IPS** 에 넣습니다. 여러 개면 쉼표로.
//     예) ACADEMY_IPS = 121.134.0.10
//     예) ACADEMY_IPS = 121.134.0.10, 2001:db8:1234:5678:*     ← IPv6 는 앞부분 + * 로
//   학원에서 /answers.html 을 열면 「지금 이 기기의 IP」 가 나오니 그걸 그대로 넣으시면 됩니다.
//   ⚠️ 넣거나 바꾼 뒤에는 Vercel 에서 **Redeploy** 를 눌러야 적용됩니다.
//
// 왜 화면에서 「이 와이파이 등록」 버튼으로 안 했나:
//   이 앱의 관리자 화면은 따로 비밀번호가 없습니다. 버튼으로 등록하게 하면
//   **집에서도 누구나 자기 IP 를 등록해서** 답지를 열 수 있게 됩니다.
//   Vercel 환경변수는 원장님만 바꿀 수 있어서 그쪽에 둡니다.
//
// 비워두면? → **아무 데서도 안 열립니다** (안전한 쪽으로 막음).

// 요청을 보낸 기기의 공인 IP.
//   Vercel 은 x-real-ip / x-forwarded-for 를 **직접 채워서** 넘겨줍니다
//   (요청에 같은 헤더를 넣어 와도 Vercel 이 덮어써서 속일 수 없습니다).
export function clientIp(req) {
  const h = req?.headers || {};
  const real = String(h["x-real-ip"] || "").trim();
  if (real) return normIp(real);
  const fwd = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  if (fwd) return normIp(fwd);
  return normIp(req?.socket?.remoteAddress || "");
}

// "::ffff:1.2.3.4" (IPv6 꼴로 감싼 IPv4) → "1.2.3.4", 대소문자 통일
function normIp(ip) {
  return String(ip || "").trim().toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
}

// 등록된 학원 IP 목록 (환경변수에서)
export function academyIps() {
  return String(process.env.ACADEMY_IPS || "")
    .split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// IP 하나가 등록값 하나와 맞나
//   "1.2.3.4"         → 똑같아야 맞음
//   "1.2.3.*"         → 1.2.3. 으로 시작하면 맞음 (회선 IP 가 끝자리만 바뀌는 경우)
//   "2001:db8:1:2:*"  → IPv6 앞부분이 같으면 맞음 (IPv6 는 기기마다 뒷부분이 다릅니다)
export function ipMatches(ip, rule) {
  const a = normIp(ip), r = String(rule || "").trim().toLowerCase();
  if (!a || !r) return false;
  if (r.endsWith("*")) {
    const head = r.slice(0, -1);
    return head.length > 0 && a.startsWith(head);
  }
  return a === r;
}

// 이 요청이 학원 와이파이에서 왔나
export function onAcademyWifi(req) {
  const ip = clientIp(req);
  return academyIps().some((rule) => ipMatches(ip, rule));
}

// 막혔을 때 보여줄 말
export function wifiBlockedMessage() {
  return academyIps().length
    ? "답지는 학원 와이파이에서만 열 수 있어요. 학원에서 와이파이에 연결한 뒤 다시 눌러주세요 (휴대폰 데이터는 꺼주세요)."
    : "아직 학원 와이파이가 등록되지 않아 답지를 열 수 없어요. 선생님께 말씀해 주세요.";
}
