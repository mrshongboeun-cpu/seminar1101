// attendance-report 를 **진짜 PostgreSQL** 위에서 띄운다.
// fetch 로 Supabase REST 를 부르는 걸 가로채 pgrest.mjs(실제 SQL)로 보낸다.
import http from "http";
import fs from "fs";
import path from "path";
import { handle } from "./pgrest.mjs";
import { notionRespond, WRITES as NOTION_WRITES } from "./notion-mock.mjs";

const APP = path.resolve(import.meta.dirname, "../..");
process.env.SUPABASE_URL = "https://fake-supabase";
process.env.SUPABASE_SERVICE_KEY = "fake";
// 알림톡·AI 는 키 없음 = 세미나 당일 "아직 승인 안 난" 수강생과 같은 상태로 검사
delete process.env.SOLAPI_API_KEY;
// AI 키도 지웁니다 — 검수가 진짜 Anthropic 으로 나가면 돈이 듭니다.
// 다만 **가짜 서버(localhost)를 가리킬 때만** 남겨둡니다. 그래야 월말평가서
// 생성까지 끝까지 돌려볼 수 있습니다 (scripts/verify/anthropic-mock.mjs).
if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(process.env.ANTHROPIC_BASE_URL || "")) {
  delete process.env.ANTHROPIC_API_KEY;
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://fake-supabase")) {
    const m = /\/rest\/v1\/([a-z_]+)\?([\s\S]*)$/.exec(u) || /\/rest\/v1\/([a-z_]+)$/.exec(u);
    const table = m[1], search = m[2] || "";
    const body = opts.body ? JSON.parse(opts.body) : null;
    const prefer = (opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || "";
    try {
      const data = await handle(opts.method || "GET", table, search, body, prefer);
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      // 쿼리가 실제 SQL 에서 깨지면 여기로 — 이게 잡고 싶은 것
      return new Response(JSON.stringify({ message: String(e.message) }), { status: 400 });
    }
  }
  // 가짜 노션 (MOCK_NOTION=1 일 때만) — 실제 노션 키 없이 이관 전 구간을 검사하려고.
  if (process.env.MOCK_NOTION === "1" && u.startsWith("https://api.notion.com")) {
    return notionRespond(u, opts);
  }
  return realFetch(url, opts);
};

const handlers = {
  "/api/attendance": (await import(path.join(APP, "api/attendance.js"))).default,
  "/api/report": (await import(path.join(APP, "api/report.js"))).default,
  "/api/student": (await import(path.join(APP, "api/student.js"))).default,
  "/api/cron": (await import(path.join(APP, "api/cron.js"))).default,
  "/api/config": (await import(path.join(APP, "api/config.js"))).default,
  "/api/import-notion": (await import(path.join(APP, "api/import-notion.js"))).default,
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };

export function start(port = 4330) {
  return new Promise((ok) => {
    const srv = http.createServer(async (req, res) => {
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (b) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); return res; };
      // 이상한 경로("//" 같은 것)에도 검수 서버가 죽지 않게 한다.
      // 죽으면 그 뒤 검사가 통째로 못 돌아서, 진짜 문제를 못 보게 됩니다.
      let u;
      try { u = new URL(req.url, "http://x"); }
      catch { res.statusCode = 400; return res.end("bad request"); }
      // 검수용: 노션에 쓰기가 일어났는지 확인하는 창구
      if (u.pathname === "/__notion-writes") { return res.json({ writes: NOTION_WRITES }); }
      const h = handlers[u.pathname];
      if (h) {
        let raw = ""; for await (const c of req) raw += c;
        req.body = raw ? JSON.parse(raw) : {};
        req.query = Object.fromEntries(u.searchParams);
        req.headers = req.headers || {};
        try { await h(req, res); } catch (e) { res.status(500).json({ error: String(e.stack || e) }); }
        return;
      }
      const f = path.join(APP, u.pathname === "/" ? "index.html" : u.pathname.slice(1));
      if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("404"); }
      res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream");
      res.end(fs.readFileSync(f));
    });
    srv.listen(port, () => ok(srv));
  });
}

if (process.argv[1].endsWith("app-server.mjs")) {
  await start(Number(process.env.PORT || 4330));
  console.log("listening");
}
