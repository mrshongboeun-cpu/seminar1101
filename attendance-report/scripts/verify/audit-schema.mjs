// 코드가 쓰는 테이블·컬럼이 실제 DB 스키마에 다 있는지 대조.
// (미니 원서 앱 때처럼 "포팅했는데 컬럼이 없어서" 터지는 걸 막는 검수)
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const APP = path.resolve(import.meta.dirname, "../..");
// DB 이름은 verify.sh 가 만드는 것과 같아야 합니다(기본 tapp).
// 예전에 여기만 't1' 으로 박혀 있어서 이 검사가 매번 죽었고, verify.sh 가 그걸 무시했습니다.
const DB = process.env.TESTDB || "tapp";
const PSQL = `psql -h ${process.env.PGSOCK || '/var/run/postgresql'} -p 5433 -U postgres -d ${DB} -tAc`;

// 실제 스키마
const rows = execSync(`${PSQL} "select table_name||'.'||column_name from information_schema.columns where table_schema='public' order by 1;"`)
  .toString().trim().split("\n");
const SCHEMA = new Set(rows);
const TABLES = new Set(rows.map((r) => r.split(".")[0]));

const files = [];
for (const d of ["api", "lib"]) {
  for (const f of fs.readdirSync(path.join(APP, d))) {
    if (f.endsWith(".js")) files.push(path.join(d, f));
  }
}

const problems = [];
const seen = new Set();

function note(file, table, col, ctx) {
  const key = `${file}|${table}.${col}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (!TABLES.has(table)) { problems.push({ file, kind: "없는 표", what: table, ctx }); return; }
  if (!SCHEMA.has(`${table}.${col}`)) problems.push({ file, kind: "없는 컬럼", what: `${table}.${col}`, ctx });
}

for (const rel of files) {
  const src = fs.readFileSync(path.join(APP, rel), "utf8");

  // select("tbl", "...a=eq.x&select=c1,c2&order=c3.asc...")
  for (const m of src.matchAll(/\b(?:select|patch|remove)\(\s*"([a-z_]+)"\s*,\s*(`[^`]*`|"[^"]*")/g)) {
    const [, table, qRaw] = m;
    if (!TABLES.has(table)) { note(rel, table, "", m[0].slice(0, 60)); continue; }
    const q = qRaw.slice(1, -1);
    // 필터: col=eq.값 / col=lt.값 …
    for (const f of q.matchAll(/(?:^|&)([a-z_]+)=(?:eq|neq|lt|lte|gt|gte|like|ilike|in)\./g)) note(rel, table, f[1], q);
    // select=
    const sel = q.match(/select=([a-z_,]+)/);
    if (sel) for (const c of sel[1].split(",")) if (c) note(rel, table, c, q);
    // order=
    for (const o of q.matchAll(/order=([a-z_]+)/g)) note(rel, table, o[1], q);
    for (const o of q.matchAll(/,\s*([a-z_]+)\.(?:asc|desc)/g)) note(rel, table, o[1], q);
  }

  // insert("tbl", {a:…, b:…}) / upsert("tbl", {…}) — 객체 리터럴 한 겹만
  for (const m of src.matchAll(/\b(?:insert|upsert)\(\s*"([a-z_]+)"\s*,\s*\{([\s\S]{0,700}?)\}\s*[,)]/g)) {
    const [, table, body] = m;
    if (!TABLES.has(table)) { note(rel, table, "", m[0].slice(0, 60)); continue; }
    for (const k of body.matchAll(/(?:^|[\s,{])([a-z_]+)\s*:/g)) note(rel, table, k[1], "insert/upsert");
  }
  // patch("tbl", "query", { a: … })
  for (const m of src.matchAll(/\bpatch\(\s*"([a-z_]+)"\s*,[^,]*,\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
    const [, table, body] = m;
    if (!TABLES.has(table)) continue;
    for (const k of body.matchAll(/(?:^|[\s,{])([a-z_]+)\s*:/g)) note(rel, table, k[1], "patch");
  }
  // on_conflict="a,b"
  for (const m of src.matchAll(/\bupsert\(\s*"([a-z_]+)"\s*,[^,]*,\s*"([a-z_,]+)"\s*\)/g)) {
    const [, table, cols] = m;
    for (const c of cols.split(",")) note(rel, table, c, "on_conflict");
  }
}

// 자바스크립트 예약어/오탐 제거
const IGNORE = new Set(["select", "order", "limit", "offset", "and", "or", "not"]);
const real = problems.filter((p) => !IGNORE.has(p.what.split(".")[1]));

console.log(`실제 스키마: 표 ${TABLES.size}개 / 컬럼 ${SCHEMA.size}개`);
console.log(`검사한 파일: ${files.length}개\n`);
if (!real.length) {
  console.log("✅ 코드가 쓰는 표·컬럼이 전부 스키마에 있습니다.");
} else {
  console.log(`❌ 문제 ${real.length}건`);
  for (const p of real) console.log(`  ${p.file}  [${p.kind}] ${p.what}\n      ${String(p.ctx).slice(0, 110)}`);
}
process.exit(real.length ? 1 : 0);
