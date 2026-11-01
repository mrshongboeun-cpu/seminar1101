// 노션(Notion) API 최소 헬퍼 — 기존 노션 DB(학생/데일리리포트/교재)를 Supabase로 이관할 때 사용.
// 서버(api/import-notion.js)에서만 호출. 필요한 환경변수:
//   NOTION_TOKEN            (노션 Integration 토큰, secret_...)
//   NOTION_STUDENTS_DB      전체학생DB ID
//   NOTION_DAILY_DB         데일리리포트DB ID
//   NOTION_TEXTBOOKS_DB     교재DB ID (선택)

const BASE = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

export function notionConfigured() {
  return Boolean(process.env.NOTION_TOKEN);
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    "Notion-Version": VERSION,
    "Content-Type": "application/json",
  };
}

// DB 스키마(속성명 → 타입) 조회. 속성명이 학원마다 달라도 자동 매칭하는 데 씀.
export async function retrieveDatabase(dbId) {
  const res = await fetch(`${BASE}/databases/${dbId}`, { headers: headers() });
  if (!res.ok) throw new Error(`Notion DB 조회 실패(${dbId}): ${res.status} ${await res.text()}`);
  const d = await res.json();
  const out = {};
  for (const [name, meta] of Object.entries(d.properties || {})) out[name] = meta.type;
  return out; // { "학생이름":"title", "날짜":"date", ... }
}

// 페이지 하나의 **제목**만 가져온다 (관계형이 가리키는 쪽 이름을 읽을 때).
// 0차(노션 왕기초) 템플릿처럼 담당 강사를 관계형으로 연결해 둔 경우, 값이 페이지ID 라서
// 그대로 쓰면 담당 선생님 칸에 UUID 가 들어갑니다. 그걸 막으려고 제목을 되읽습니다.
// 실패해도 이관 전체를 멈추지 않도록 빈 문자열을 돌려줍니다.
const titleCache = new Map();
export async function retrievePageTitle(pageId) {
  if (!pageId) return "";
  if (titleCache.has(pageId)) return titleCache.get(pageId);
  let title = "";
  try {
    const res = await fetch(`${BASE}/pages/${pageId}`, { headers: headers() });
    if (res.ok) {
      const d = await res.json();
      for (const p of Object.values(d.properties || {})) {
        if (p.type === "title") { title = (p.title || []).map((t) => t.plain_text).join("").trim(); break; }
      }
    }
  } catch (e) { /* 이름을 못 읽어도 나머지는 그대로 옮깁니다 */ }
  titleCache.set(pageId, title);
  return title;
}

// DB 전체 페이지를 페이지네이션으로 모두 가져온다.
export async function queryDatabase(dbId) {
  const out = [];
  let cursor = undefined;
  do {
    const res = await fetch(`${BASE}/databases/${dbId}/query`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
    });
    if (!res.ok) throw new Error(`Notion query 실패(${dbId}): ${res.status} ${await res.text()}`);
    const data = await res.json();
    out.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

// 페이지의 속성값을 타입에 맞게 읽는다. name 여러 후보 중 처음 매칭되는 것.
export function prop(page, ...names) {
  const props = page.properties || {};
  for (const name of names) {
    const p = props[name];
    if (p === undefined) continue;
    switch (p.type) {
      case "title": return (p.title || []).map((t) => t.plain_text).join("").trim();
      case "rich_text": return (p.rich_text || []).map((t) => t.plain_text).join("").trim();
      case "select": return p.select ? p.select.name : "";
      case "multi_select": return (p.multi_select || []).map((s) => s.name).join(", ");
      case "number": return p.number;
      case "phone_number": return p.phone_number || "";
      case "email": return p.email || "";
      case "url": return p.url || "";
      case "checkbox": return !!p.checkbox;
      case "date": return p.date ? p.date.start : "";
      case "relation": return (p.relation || []).map((r) => r.id); // page id 배열
      case "rollup": {
        const r = p.rollup;
        if (!r) return "";
        if (r.type === "number") return r.number;
        if (r.type === "array") return (r.array || []).map((x) => (x[x.type]?.name || x[x.type] || "")).join(", ");
        return "";
      }
      case "formula": {
        const f = p.formula;
        return f ? (f.string ?? f.number ?? f.boolean ?? "") : "";
      }
      default: return "";
    }
  }
  return undefined;
}
