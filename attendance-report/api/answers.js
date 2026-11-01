// 📖 답지 관리 API — 답지 관리 화면(answers.html)의 뒷단.
//
// 교재의 **유닛마다 답지 파일 1개**(PDF 또는 사진)를 올려둡니다.
// 파일은 Supabase 의 **비공개 보관함(answers)** 에 있고, 여기엔 위치만 적습니다(answer_keys 표).
//
// ★ 답지를 **여는 것**(view)은 학원 와이파이에서만 됩니다 — lib/wifi.js
//   (학생앱에서 여는 길은 api/student.js 의 action "answer")
//
// 액션 (전부 POST):
//   {action:"wifi"}                                         → 지금 이 기기 IP · 학원 와이파이인지 · 등록 개수
//   {action:"list", textbook_id}                            → 그 교재의 유닛별 답지 유무
//   {action:"upload-url", textbook_id, unit_code, file_name, content_type}
//                                                           → 브라우저가 파일을 직접 올릴 일회용 주소
//   {action:"confirm", textbook_id, unit_code, path, file_name, content_type}
//                                                           → 올리기가 끝났다고 기록 (같은 유닛 옛 답지는 지움)
//   {action:"delete", textbook_id, unit_code}               → 답지 지우기
//   {action:"view", textbook_id, unit_code}                 → (학원 와이파이만) 2분짜리 열람 링크

import crypto from "node:crypto";
import { select, insert, patch, remove, dbConfigured, DbInputError } from "../lib/db.js";
import { ensureBucket, signUpload, signDownload, removeObject } from "../lib/storage.js";
import { clientIp, academyIps, onAcademyWifi, wifiBlockedMessage } from "../lib/wifi.js";
import { normUnit } from "../lib/progress.js";

// 받는 파일 종류 — 브라우저에서 바로 열리는 것만
const TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

const SAFE_ID = /^[0-9a-f-]{36}$/i;
class BadRequest extends Error { constructor(m) { super(m); this.status = 400; } }

async function textbookOf(id) {
  if (!SAFE_ID.test(String(id || ""))) throw new BadRequest("교재를 먼저 골라주세요.");
  const t = (await select("textbooks", `id=eq.${id}&limit=1`))[0];
  if (!t) throw new BadRequest("그 교재를 찾을 수 없어요. 새로고침해 주세요.");
  return t;
}
// 유닛코드가 그 교재 목차에 있는지 (엉뚱한 코드로 파일이 쌓이지 않게)
function unitOf(t, code) {
  const c = String(code || "").trim();
  const u = (t.units || []).map(normUnit).find((x) => x && x.code === c);
  if (!u) throw new BadRequest(`목차에 없는 유닛이에요: ${c || "(빈칸)"}`);
  return u;
}
const keyOf = (textbookId, unitCode) =>
  select("answer_keys", `textbook_id=eq.${textbookId}&unit_code=eq.${encodeURIComponent(unitCode)}&limit=1`)
    .then((r) => r[0] || null);

export default async function handler(req, res) {
  if (!dbConfigured()) return res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 없어요." });
  if (req.method !== "POST") return res.status(405).json({ error: "POST 로 보내주세요." });
  const b = req.body || {};
  try {
    // ── 지금 이 기기가 학원 와이파이인가 (등록 안내용) ──
    if (b.action === "wifi") {
      return res.status(200).json({
        ip: clientIp(req),
        on_wifi: onAcademyWifi(req),
        registered: academyIps().length,
      });
    }

    // ── 교재 유닛별 답지 유무 ──
    if (b.action === "list") {
      const t = await textbookOf(b.textbook_id);
      const keys = await select("answer_keys", `textbook_id=eq.${t.id}`);
      const by = Object.fromEntries(keys.map((k) => [k.unit_code, k]));
      return res.status(200).json({
        textbook: { id: t.id, name: t.name, subject: t.subject },
        on_wifi: onAcademyWifi(req),
        units: (t.units || []).map(normUnit).filter(Boolean).map((u) => ({
          code: u.code, title: u.title,
          answer: by[u.code] ? { file_name: by[u.code].file_name, content_type: by[u.code].content_type, created_at: by[u.code].created_at } : null,
        })),
      });
    }

    // ── 올릴 주소 받기 ──
    if (b.action === "upload-url") {
      const t = await textbookOf(b.textbook_id);
      const u = unitOf(t, b.unit_code);
      const ext = TYPES[String(b.content_type || "").toLowerCase()];
      if (!ext) throw new BadRequest("PDF 또는 사진(JPG·PNG)만 올릴 수 있어요.");
      // 보관함 안 위치는 **영문·숫자로만** (한글 파일명은 보관함이 거절합니다)
      const path = `${t.id}/${crypto.randomUUID()}.${ext}`;
      await ensureBucket();
      const url = await signUpload(path);
      return res.status(200).json({ path, url, unit_code: u.code });
    }

    // ── 올리기 끝 → 기록 ──
    if (b.action === "confirm") {
      const t = await textbookOf(b.textbook_id);
      const u = unitOf(t, b.unit_code);
      const path = String(b.path || "");
      // 위에서 우리가 만들어 준 꼴인지 (남의 파일 위치를 적어 넣지 못하게)
      if (!new RegExp(`^${t.id}/[0-9a-f-]{36}\\.(pdf|jpg|png|webp|heic)$`, "i").test(path))
        throw new BadRequest("파일 위치가 올바르지 않아요. 다시 올려주세요.");
      const row = {
        path,
        file_name: String(b.file_name || "").slice(0, 200) || null,
        content_type: String(b.content_type || "").slice(0, 100) || null,
      };
      const old = await keyOf(t.id, u.code);
      if (old) {
        await patch("answer_keys", `id=eq.${old.id}`, { ...row, created_at: new Date().toISOString() });
        if (old.path !== path) await removeObject(old.path).catch(() => {}); // 옛 파일 정리 (실패해도 진행)
      } else {
        await insert("answer_keys", { textbook_id: t.id, unit_code: u.code, ...row });
      }
      return res.status(200).json({ ok: true });
    }

    // ── 지우기 ──
    if (b.action === "delete") {
      const t = await textbookOf(b.textbook_id);
      const k = await keyOf(t.id, String(b.unit_code || "").trim());
      if (!k) return res.status(200).json({ ok: true });
      await remove("answer_keys", `id=eq.${k.id}`);
      await removeObject(k.path).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    // ── 열기 (★ 학원 와이파이에서만) ──
    if (b.action === "view") {
      if (!onAcademyWifi(req)) return res.status(403).json({ error: wifiBlockedMessage(), ip: clientIp(req) });
      const t = await textbookOf(b.textbook_id);
      const k = await keyOf(t.id, String(b.unit_code || "").trim());
      if (!k) return res.status(404).json({ error: "이 유닛은 아직 답지가 없어요." });
      return res.status(200).json({ url: await signDownload(k.path) });
    }

    return res.status(400).json({ error: `알 수 없는 action: ${b.action}` });
  } catch (e) {
    if (e instanceof BadRequest || e instanceof DbInputError) return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
