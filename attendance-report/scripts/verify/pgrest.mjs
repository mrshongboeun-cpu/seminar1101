// 아주 작은 PostgREST 흉내 — 진짜 PostgreSQL 앞에 세워서
// api/*.js 가 보내는 쿼리 문자열을 **실제 SQL 로** 돌려본다.
// (가짜 메모리 DB로는 못 잡는 '쿼리 문법·타입' 오류를 여기서 잡는다)
import pg from "pg";

// ★ 진짜 Supabase(PostgREST)는 date 컬럼을 "2026-10-27" **문자열**로 돌려줍니다.
//   node-postgres 는 기본값이 JS Date 라 JSON 으로 나갈 때 "2026-10-27T00:00:00.000Z" 가 됩니다.
//   그대로 두면 **검수 환경과 실제가 달라져서**, 화면이 날짜를 어떻게 다루는지 제대로 못 봅니다
//   (실제로 학생앱에서 날짜가 ISO 로 새는 걸 이것 때문에 놓칠 뻔했습니다).
pg.types.setTypeParser(1082, (v) => v);   // 1082 = date

const pool = new pg.Pool({ host: process.env.PGSOCK || "/var/run/postgresql", port: 5433, user: "postgres", database: process.env.TESTDB || "tapp" });

const OPS = { eq: "=", neq: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" };

function buildWhere(params, vals) {
  const parts = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const m = /^([a-z]+)\.([\s\S]*)$/.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    if (op === "in") {
      const list = raw.replace(/^\(|\)$/g, "").split(",").filter(Boolean);
      if (!list.length) { parts.push("false"); continue; }
      const ph = list.map((x) => { vals.push(x); return `$${vals.length}`; });
      parts.push(`"${k}" in (${ph.join(",")})`);
      continue;
    }
    // is.true / is.false / is.null — 진짜 PostgREST 가 지원하는 형태라 검수 서버도 받습니다.
    //   (없으면 "검수에서만 안 되는" 상황이 생겨서 실제와 어긋납니다)
    if (op === "is") {
      const t = String(raw).toLowerCase();
      if (t === "true" || t === "false" || t === "null") { parts.push(`"${k}" is ${t}`); continue; }
      throw new Error(`is 뒤에는 true/false/null 만 옵니다 (${k}=${v})`);
    }
    if (!OPS[op]) throw new Error(`지원 안 하는 연산자: ${op} (${k}=${v})`);
    if (raw === "null") { parts.push(`"${k}" is ${op === "eq" ? "" : "not "}null`); continue; }
    vals.push(raw);
    parts.push(`"${k}" ${OPS[op]} $${vals.length}`);
  }
  return parts.length ? "where " + parts.join(" and ") : "";
}

function tail(params) {
  let s = "";
  const order = params.get("order");
  if (order) {
    const cols = order.split(",").map((o) => {
      const [c, d] = o.split(".");
      return `"${c}" ${String(d || "asc").toLowerCase() === "desc" ? "desc" : "asc"}`;
    });
    s += ` order by ${cols.join(", ")}`;
  }
  const limit = params.get("limit");
  if (limit) s += ` limit ${parseInt(limit, 10)}`;
  return s;
}

function cols(params) {
  const sel = params.get("select");
  if (!sel || sel === "*") return "*";
  return sel.split(",").filter(Boolean).map((c) => `"${c.trim()}"`).join(", ");
}

export async function handle(method, table, search, body, prefer) {
  const params = new URLSearchParams(search);
  const vals = [];
  const where = buildWhere([...params], vals);

  if (method === "GET") {
    const q = `select ${cols(params)} from "${table}" ${where}${tail(params)}`;
    return (await pool.query(q, vals)).rows;
  }

  if (method === "POST") {
    const rows = Array.isArray(body) ? body : [body];
    if (!rows.length) return [];
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const out = [];
    for (const r of rows) {
      const v = keys.map((k) => (r[k] === undefined ? null : (r[k] !== null && typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])));
      const ph = keys.map((_, i) => `$${i + 1}`);
      let q = `insert into "${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${ph.join(",")})`;
      const conflict = params.get("on_conflict");
      if (prefer.includes("merge-duplicates") && conflict) {
        const cc = conflict.split(",").map((c) => `"${c.trim()}"`).join(",");
        const upd = keys.filter((k) => !conflict.split(",").includes(k)).map((k) => `"${k}"=excluded."${k}"`);
        q += ` on conflict (${cc}) do update set ${upd.join(",")}`;
      }
      q += " returning *";
      out.push((await pool.query(q, v)).rows[0]);
    }
    return out;
  }

  if (method === "PATCH") {
    const keys = Object.keys(body);
    const sets = keys.map((k) => {
      const val = body[k];
      vals.push(val !== null && typeof val === "object" ? JSON.stringify(val) : val);
      return `"${k}"=$${vals.length}`;
    });
    const q = `update "${table}" set ${sets.join(",")} ${where} returning *`;
    return (await pool.query(q, vals)).rows;
  }

  if (method === "DELETE") {
    await pool.query(`delete from "${table}" ${where}`, vals);
    return true;
  }
  throw new Error("unsupported " + method);
}

export async function close() { await pool.end(); }
