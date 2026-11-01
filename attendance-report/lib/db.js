// Supabase REST(PostgREST) 최소 헬퍼.
// service_role 키로 "서버(api 폴더)에서만" 호출한다. 브라우저로 절대 내보내지 말 것.
// 노션 SDK·rate limit 없이 fetch 한 방으로 테이블을 읽고 쓴다.

// SUPABASE_URL 을 **쓸 수 있는 꼴로 다듬는다.**
//
// 왜: 설치 단계에서 제일 많이 틀리는 칸입니다. Supabase 화면이 바뀌면서
//   Settings → General 에는 **프로젝트 ID 만**(khji… 같은 글자) 나오는데,
//   그걸 그대로 넣으면 화면에 영어 날코드가 그대로 떴습니다 —
//     Failed to parse URL from khji…/rest/v1/students?status=eq.재원
//   당일에 이게 뜨면 뭘 틀렸는지 알 길이 없습니다.
//
//   · 끝의 `/` 는 떼어냅니다 (`//rest/v1` 이 되는 걸 막음)
//   · 실수로 `/rest/v1` 까지 붙여 넣은 것도 떼어냅니다 (앱이 붙이니 두 번이 됨)
//   · 주소 꼴이 아니면 **한국어로** 무엇을 넣어야 하는지 알려줍니다
function 주소다듬기(v) {
  return String(v || "").trim()
    .replace(/\/+$/, "")           // 끝의 /
    .replace(/\/rest\/v1$/i, "");  // 실수로 붙인 /rest/v1
}
const URL = 주소다듬기(process.env.SUPABASE_URL);
const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();

// 주소 꼴인가 — https://무엇.supabase.co 같은 모양이어야 합니다.
const 주소꼴 = /^https?:\/\/[^/\s]+/i.test(URL);

export function dbConfigured() {
  return Boolean(URL && KEY);
}

// 주소가 주소 꼴이 아닐 때 띄울 말. 괜찮으면 null.
export function urlProblem() {
  if (!URL) return null;          // 아예 없는 건 "환경변수가 없어요" 쪽에서 안내합니다
  // ★ http:// — Supabase 주소는 **항상 https** 입니다.
  //   http 로 넣으면 Supabase 가 https 로 넘기는데, 그때 브라우저·Node 규칙상
  //   **인증 헤더(apikey)가 떨어져 나갑니다.** 그래서 「키가 틀렸다」 나
  //   「학생이 한 명도 없다」 처럼 엉뚱한 모습으로 나타나고, 원인을 찾기가 아주 어렵습니다.
  //   (주소를 손으로 치거나 앞의 s 를 빠뜨리면 이렇게 됩니다)
  //   ⚠️ 단, **내 컴퓨터에서 돌리는 Supabase** 는 http 가 정상입니다
  //      (Supabase CLI 는 http://127.0.0.1:54321 을 줍니다). 그건 막지 않습니다.
  const 내컴퓨터 = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(URL);
  if (/^http:\/\//i.test(URL) && !내컴퓨터) {
    return (
      `Vercel 환경변수 SUPABASE_URL 이 **http://** 로 시작합니다 — Supabase 주소는 항상 **https://** 입니다.\n` +
      `지금 들어 있는 값: "${URL}"\n` +
      `이렇게 두면 인증 정보가 중간에 떨어져서, 학생이 한 명도 없는 것처럼 보이거나 키가 틀렸다고 나옵니다.\n` +
      `맨 앞에 s 하나만 붙여 "https://${URL.replace(/^http:\/\//i, "")}" 로 고치고, ` +
      `Vercel 에서 **Redeploy** 를 꼭 눌러주세요.`
    );
  }
  if (주소꼴) return null;
  const 보인것 = URL.length > 24 ? URL.slice(0, 24) + "…" : URL;
  return (
    `Vercel 환경변수 SUPABASE_URL 에 **주소 전체**를 넣어주세요 — ` +
    `https://내프로젝트ID.supabase.co 꼴입니다.\n` +
    `지금 들어 있는 값: "${보인것}"\n` +
    `프로젝트 ID만 넣으신 것 같아요 (Settings → General 의 Reference ID 는 ID만 나옵니다). ` +
    `Supabase 의 Settings → Data API(예전 API) 맨 위 **Project URL** 을 통째로 복사해 넣고, ` +
    `Vercel 에서 **Redeploy** 를 꼭 눌러주세요.`
  );
}

// 호출 직전에 한 번 확인 — 주소가 엉뚱하면 fetch 가 영어로 터지기 전에 막습니다.
function 주소확인() {
  const p = urlProblem();
  if (p) throw new DbInputError(p);
}

// PostgREST 가 주는 날코드를, 수강생이 **읽고 바로 고칠 수 있는 말**로 바꾼다.
//
// 왜 필요한가: 화면에 이런 게 그대로 떴습니다 —
//   select tasks 실패: 404 {"code":"PGRST205","message":"Could not find the table
//   'public.tasks' in the schema cache"}
// 세미나 당일에 이게 뜨면 아무도 못 고칩니다. 원인별로 할 일을 한 줄로 알려줍니다.
// 입력이 잘못돼서 DB가 거절한 것. 서버 사고(500)가 아니라 **400** 으로 돌려줘야 합니다.
//   예전에는 이것도 500 으로 나가서, 화면에 PostgreSQL 원문이 그대로 떴습니다
//   ("invalid input syntax for type uuid …"). 원장님이 보기엔 그냥 고장입니다.
export class DbInputError extends Error {
  constructor(message) { super(message); this.name = "DbInputError"; }
}

// 입력 때문에 난 오류인지 (그렇다면 안내문과 함께 400). 아니면 null.
function 입력오류(text) {
  const t = String(text || "");
  if (/invalid input syntax for type uuid/i.test(t))
    return "그 학생·과제를 찾을 수 없어요. 화면을 새로고침한 뒤 다시 해주세요.";
  if (/invalid input syntax for type date|date\/time field value out of range/i.test(t))
    return "날짜가 올바르지 않아요. 달력에서 다시 골라주세요.";
  if (/invalid input syntax/i.test(t))
    return "입력한 값의 형식이 맞지 않아요. 다시 확인해 주세요.";
  if (/foreign key constraint/i.test(t))
    return "이미 지워졌거나 없는 학생·교재예요. 화면을 새로고침한 뒤 다시 해주세요.";
  if (/duplicate key value|unique constraint/i.test(t))
    return "같은 값이 이미 있어요 (출결번호·학생ID가 겹치지 않는지 보세요).";
  return null;
}

// 「칸이 없습니다」 에 **그대로 붙여넣을 SQL** 을 붙여주기 위한 표.
//   이 앱이 나중에 더한 칸들입니다. 1·2차 수강생이 쓰던 DB 에 설치하면 꼭 하나는 걸립니다.
//   예전에는 "서버 로그의 칸 이름을 보고 alter table 하세요" 라고만 해서,
//   수강생이 그 문장을 보고도 아무것도 못 했습니다 (원장님이 리허설에서 겪은 자리).
const 칸고치기 = {
  retest_sent:   { sql: "alter table daily_records add column if not exists retest_sent text;", file: "migrate_retest.sql" },
  auto:          { sql: "alter table tasks add column if not exists auto boolean not null default false;", file: "migrate_auto_tasks.sql" },
  voca_score:    { sql: "alter table daily_records add column if not exists voca_score text;", file: "migrate_daily_report.sql" },
  parent_note:   { sql: "alter table daily_records add column if not exists parent_note text;", file: "migrate_daily_report.sql" },
  report_sent:   { sql: "alter table daily_records add column if not exists report_sent text not null default '미전송';", file: "migrate_daily_report.sql" },
  books:         { sql: "alter table daily_records add column if not exists books jsonb not null default '{}'::jsonb;", file: "migrate_daily_report.sql" },
  student_code:  { sql: "alter table students add column if not exists student_code text;", file: "migrate_daily_report.sql" },
  middle_school: { sql: "alter table students add column if not exists middle_school boolean not null default false;", file: "migrate_daily_report.sql" },
  school:        { sql: "alter table students add column if not exists school text;", file: "migrate_school.sql" },
  step:          { sql: "alter table textbooks add column if not exists step int not null default 1;", file: "migrate_daily_report.sql" },
  price:         { sql: "alter table textbooks add column if not exists price int;", file: "migrate_daily_report.sql" },
  stock_total:   { sql: "alter table textbooks add column if not exists stock_total int;", file: "migrate_daily_report.sql" },
  distributed:   { sql: "alter table textbooks add column if not exists distributed int not null default 0;", file: "migrate_daily_report.sql" },
};
// 표가 통째로 없을 때 돌릴 파일
const 표고치기 = { tasks: "migrate_tasks.sql" };

function friendlyDbError(op, table, status, text) {
  const t = String(text || "");
  const has = (...xs) => xs.some((x) => t.includes(x));

  // ★ SUPABASE_URL 에 **Supabase 가 아닌 주소**(Vercel 등)를 넣은 경우.
  //   앱은 멀쩡히 돌고 그 주소로 요청이 나가서, Vercel 의 영어 404 가 화면에 그대로 떴습니다.
  //   "select students 실패: 404 The deployment could not be found on Vercel…" (실제로 겪은 것)
  if (has("DEPLOYMENT_NOT_FOUND", "could not be found on Vercel", "vercel.app")) {
    return (
      `Vercel 환경변수 SUPABASE_URL 에 **Supabase 주소가 아닌 것**이 들어가 있습니다.\n` +
      `Supabase → Settings → Data API(예전 API) 의 **Project URL** 을 통째로 복사해 넣어주세요 ` +
      `(https://내프로젝트ID.supabase.co 꼴). 고친 뒤 Vercel 에서 **Redeploy** 를 눌러야 적용됩니다.`
    );
  }

  // 표가 아예 없다 — setup.sql 을 안 돌렸거나, 그 표가 생기기 전에 만든 DB
  if (has("PGRST205", "42P01") || /Could not find the table/i.test(t)) {
    const 파일 = 표고치기[table];
    return (
      `DB에 '${table}' 표가 없습니다.\n` +
      `· 처음 설치라면: Supabase → SQL Editor 에서 attendance-report/sql/setup.sql 을 통째로 한 번 돌리세요.\n` +
      (파일
        ? `· 쓰던 DB라면(데이터가 들어 있다면): Supabase → SQL Editor 에 ` +
          `attendance-report/sql/${파일} 을 붙여넣고 Run 하세요.\n`
        : `· 쓰던 DB라면: 그 표만 더하는 스크립트(attendance-report/sql/ 안)를 돌리세요.\n`) +
      `  ⚠️ setup.sql 재실행 금지 — 맨 위 drop table 로 데이터가 지워집니다.`
    );
  }
  // 칸이 없다 — 표는 있는데 setup.sql 이 옛것
  //   ★ **세 가지 꼴**로 옵니다. 하나씩 데면서 알았습니다 —
  //     ① PostgREST 가 걸러낼 때   PGRST204  "Could not find the 'retest_sent' column"
  //     ② 읽다가 걸릴 때(42703)    "column tasks.auto does not exist"
  //     ③ **쓰다가** 걸릴 때(42703) "column \"school\" of relation \"students\" does not exist"
  //   ③ 을 안 잡아서, 학교 칸이 없는 DB 에서 학생을 저장하면 영어 날코드가 그대로 떴습니다.
  //   ⚠️ 원문은 **JSON** 이라 따옴표가 \" 처럼 역슬래시와 함께 옵니다.
  //      "? 로만 받으면 그 역슬래시에 걸려 안 맞습니다 — 여기서 한 번 더 데었습니다.
  if (has("42703") || /column\s+[\\"]*[\w.]+[\\"]*\s+(?:of\s+relation\s+[\\"]*[\w]+[\\"]*\s+)?does not exist/i.test(t)) {
    const m = /column\s+[\\"]*(?:([\w]+)\.)?([\w]+)[\\"]*(?:\s+of\s+relation\s+[\\"]*([\w]+)[\\"]*)?\s+does not exist/i.exec(t);
    const 칸 = m?.[2] || "";
    const 표 = m?.[3] || m?.[1] || table;
    const 고침 = 칸고치기[칸];
    if (고침) {
      return (
        `DB에 '${칸}' 칸이 없습니다 (DB가 코드보다 옛것이에요).\n` +
        `Supabase → SQL Editor 에 **아래 한 줄**을 붙여넣고 Run 하시면 바로 됩니다.\n\n` +
        `  ${고침.sql}\n\n` +
        `(데이터는 지워지지 않습니다. 같은 내용이 attendance-report/sql/${고침.file} 에도 있어요.)`
      );
    }
    return (
      `DB의 '${표}' 표에 '${칸}' 칸이 없습니다 (DB가 코드보다 옛것이에요).\n` +
      `Supabase → SQL Editor 에서:\n` +
      `  alter table ${표} add column if not exists ${칸 || "<칸이름>"} text;\n` +
      `(숫자 칸이면 text 대신 int, 참/거짓이면 boolean 입니다. 데이터는 지워지지 않습니다.)`
    );
  }
  if (has("PGRST204") || /Could not find the .* column/i.test(t)) {
    // 어느 칸인지 메시지에서 뽑아냅니다 — PostgREST 가 'retest_sent' 처럼 따옴표로 알려줍니다
    const m = /Could not find the ['"`]?([a-zA-Z_][a-zA-Z0-9_]*)['"`]?\s+column/i.exec(t);
    const 칸 = m ? m[1] : "";
    const 고침 = 칸고치기[칸];
    if (고침) {
      return (
        `DB에 '${칸}' 칸이 없습니다 (DB가 코드보다 옛것이에요).\n` +
        `Supabase → SQL Editor 에 **아래 한 줄**을 붙여넣고 Run 하시면 바로 됩니다.\n\n` +
        `  ${고침.sql}\n\n` +
        `(데이터는 지워지지 않습니다. 같은 내용이 attendance-report/sql/${고침.file} 에도 있어요.)`
      );
    }
    return (
      `'${table}' 표에 ${칸 ? `'${칸}' ` : ""}칸이 없습니다 (DB가 코드보다 옛것이에요).\n` +
      `Supabase → SQL Editor 에서:\n` +
      `  alter table ${table} add column if not exists ${칸 || "<칸이름>"} text;\n` +
      `(숫자 칸이면 text 대신 int, 참/거짓이면 boolean 입니다. 데이터는 지워지지 않습니다.)`
    );
  }
  // 권한 — setup.sql 아래쪽 grant 가 빠졌을 때. 미니 원서 앱 세미나에서 실제로 난 사고.
  if (has("42501") || /permission denied/i.test(t)) {
    return (
      `'${table}' 에 접근 권한이 없습니다 (service_role 권한 누락).\n` +
      `Supabase SQL Editor 에서:\n` +
      `  grant usage on schema public to service_role;\n` +
      `  grant all privileges on all tables in schema public to service_role;`
    );
  }
  // 키가 틀림 — anon 키를 넣은 경우가 제일 흔합니다
  if (status === 401 || status === 403 || has("PGRST301") || /JWT|Invalid API key/i.test(t)) {
    return (
      `DB 열쇠가 맞지 않습니다.\n` +
      `Vercel 환경변수 SUPABASE_SERVICE_KEY 에 **service_role** 키가 들어갔는지 보세요 ` +
      `(anon 키를 넣는 실수가 제일 흔합니다). 고친 뒤 재배포해야 적용됩니다.`
    );
  }
  return `${op} ${table} 실패: ${status} ${t}`;
}

// 한 곳에서만 던집니다 — 입력 때문이면 DbInputError(→400), 아니면 Error(→500).
async function dbError(op, table, res) {
  const text = await res.text();
  const 안내 = 입력오류(text);
  if (안내) return new DbInputError(안내);
  return new Error(friendlyDbError(op, table, res.status, text));
}

function headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// 예: select("students", "status=eq.재원&order=name.asc")
export async function select(table, query = "") {
  주소확인();
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    headers: headers(),
  });
  if (!res.ok) throw await dbError("select", table, res);
  return res.json();
}

// 있으면 갱신, 없으면 삽입 (onConflict = 유니크 컬럼, 예: "student_id,month")
export async function upsert(table, rows, onConflict) {
  주소확인();
  const q = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw await dbError("upsert", table, res);
  return res.json();
}

// 새로 삽입 (id 자동 생성)
export async function insert(table, rows) {
  주소확인();
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw await dbError("insert", table, res);
  return res.json();
}

// 조건에 맞는 행 수정. 예: patch("daily_records", "id=eq.xxx", {check_out:"19:00"})
export async function patch(table, query, body) {
  주소확인();
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await dbError("patch", table, res);
  return res.json();
}

// 조건에 맞는 행 삭제. 예: remove("students", "id=eq.xxx")
export async function remove(table, query) {
  주소확인();
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw await dbError("delete", table, res);
  return true;
}
