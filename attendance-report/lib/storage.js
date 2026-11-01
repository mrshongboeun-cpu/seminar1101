// Supabase Storage(파일 보관함) 최소 헬퍼 — 답지 파일용.
// service_role 키로 "서버(api 폴더)에서만" 호출한다. 브라우저로 키를 절대 내보내지 말 것.
//
// 답지는 **비공개 보관함(answers)** 에 둡니다. 주소를 알아도 그냥은 안 열리고,
// 서버가 학원 와이파이인지 확인한 뒤에만 **잠깐(2분) 열리는 링크**를 만들어 줍니다.
//
// 올리기는 브라우저 → Supabase 로 **직접** 보냅니다 (서버를 거치면 Vercel 이 4.5MB 넘는
// 파일을 막습니다). 서버는 「이 자리에 한 번 올려도 된다」 는 일회용 주소만 만들어 줍니다.

export const BUCKET = "answers";

function base() {
  return String(process.env.SUPABASE_URL || "").trim()
    .replace(/\/+$/, "").replace(/\/rest\/v1$/i, "") + "/storage/v1";
}
function headers(extra = {}) {
  const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra };
}
// 경로의 각 조각을 주소에 넣을 수 있게 (경로는 우리가 만든 영문·숫자라 사실상 그대로)
const enc = (path) => String(path).split("/").map(encodeURIComponent).join("/");

async function fail(what, res) {
  const t = await res.text().catch(() => "");
  if (/bucket not found/i.test(t))
    return new Error(`답지 보관함(${BUCKET})이 없습니다. Supabase SQL Editor 에서 sql/migrate_answer_keys.sql 을 Run 해주세요.`);
  return new Error(`답지 ${what} 실패 (${res.status}) ${t.slice(0, 200)}`);
}

// 보관함이 없으면 만든다 (이미 있으면 조용히 넘어감).
//   SQL(migrate_answer_keys.sql)로도 만들지만, 그걸 빼먹어도 첫 업로드 때 생기게.
let 보관함확인됨 = false;
export async function ensureBucket() {
  if (보관함확인됨) return;
  const res = await fetch(`${base()}/bucket`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }).catch(() => null);
  // 200 = 새로 만듦 / 400·409 = 이미 있음 → 둘 다 괜찮음
  if (res && (res.ok || res.status === 400 || res.status === 409)) 보관함확인됨 = true;
}

// 브라우저가 파일을 **한 번** 올릴 수 있는 주소 (2시간 유효, Supabase 기본값)
export async function signUpload(path) {
  const res = await fetch(`${base()}/object/upload/sign/${BUCKET}/${enc(path)}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw await fail("올릴 주소 만들기", res);
  const d = await res.json();
  return `${base()}${d.url}`;
}

// 잠깐만 열리는 열람 링크 (기본 120초)
export async function signDownload(path, seconds = 120) {
  const res = await fetch(`${base()}/object/sign/${BUCKET}/${enc(path)}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!res.ok) throw await fail("열람 링크 만들기", res);
  const d = await res.json();
  return `${base()}${d.signedURL || d.signedUrl}`;
}

// 파일 지우기 (없어도 오류 아님)
export async function removeObject(path) {
  const res = await fetch(`${base()}/object/${BUCKET}`, {
    method: "DELETE",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: [path] }),
  });
  if (!res.ok && res.status !== 404) throw await fail("지우기", res);
}
