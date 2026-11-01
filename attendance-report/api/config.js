// 학원 이름·대표 색을 **환경변수로** 내려주는 API.
//
// 왜 있나:
//   `config.js`(브라우저) 두 줄을 고치는 게 기본이고, 그게 세미나 첫 실습입니다.
//   그런데 원장님처럼 **같은 코드를 자기 학원 이름으로 먼저 돌려보고** 싶을 때,
//   코드에 학원 이름을 하드코딩해서 커밋하면 배포본에 개인정보가 섞입니다.
//   그래서 Vercel 환경변수에 넣으면 그게 config.js 값을 **덮어쓰도록** 했습니다.
//   → 코드에는 "우리 학원" placeholder 만 남고, 화면에는 내 학원 이름이 뜹니다.
//
// 환경변수 (둘 다 선택 — 없으면 config.js 값을 그대로 씁니다):
//   ACADEMY_NAME  학원 이름  (예: ○○영어학원)
//   BRAND_COLOR   대표 색    (예: #1f7a70)
//
// ⚠️ 여기서 내려주는 값은 브라우저에 그대로 노출됩니다. 학원 이름·색처럼
//    **공개돼도 되는 값만** 넣으세요. 키·토큰·전화번호는 절대 넣지 말 것.

export default function handler(req, res) {
  const academy = (process.env.ACADEMY_NAME || "").trim();
  const brand = (process.env.BRAND_COLOR || "").trim();

  // 색은 #rgb / #rrggbb 형태만 통과시킨다 (CSS 변수에 그대로 들어가므로)
  const safeBrand = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(brand) ? brand : "";

  res.setHeader("Cache-Control", "public, max-age=60");
  return res.status(200).json({
    academy: academy || null,
    brand: safeBrand || null,
  });
}
