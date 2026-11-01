// 한국시간(KST, UTC+9) 기준 날짜/시각 헬퍼. Vercel 서버는 UTC로 도니 여기서 보정.

export function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const iso = d.toISOString();
  return {
    date: iso.slice(0, 10),          // YYYY-MM-DD
    hhmm: iso.slice(11, 16),         // HH:MM
    weekday: "일월화수목금토"[d.getUTCDay()], // 월,화,...
  };
}

export function toMinutes(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function addMinutes(hhmm, mins) {
  const base = toMinutes(hhmm);
  if (base === null) return "";
  const t = base + mins;
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
