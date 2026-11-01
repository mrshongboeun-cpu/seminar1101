// ★★ 우리 학원에 맞게 — 여기 두 줄만 바꾸면 모든 화면에 반영됩니다 ★★
// 바이브 코딩: 클로드에게 "학원 이름을 ○○로 바꿔줘" / "대표 색을 분홍색으로 바꿔줘"
// 라고 하면 아래 두 값이 바뀌고, 전 화면(현황판·키오스크·학생관리·월말평가서)에 적용됩니다.
window.APP_CONFIG = {
  academy: "우리 학원",   // 화면·리포트 제목에 표시될 학원 이름
  brand: "#1f7a70",       // 대표 색 (기본 teal)
};

// 참고: Vercel 환경변수 ACADEMY_NAME / BRAND_COLOR 를 넣으면 위 두 값보다 **그게 이깁니다.**
// 코드에 학원 이름을 넣지 않고도 내 학원 이름으로 띄울 수 있어요(배포본에 개인정보 안 남음).
// 환경변수를 안 쓰면 위 두 줄이 그대로 쓰이니 신경 쓰지 않으셔도 됩니다.
(function () {
  var c = window.APP_CONFIG || {};
  var baseTitle = null; // 원래 제목을 기억해 둔다 (제목에 " · "가 들어 있어도 안 잘리게)
  function paint() {
    if (baseTitle === null) baseTitle = document.title;
    if (c.brand) document.documentElement.style.setProperty("--green", c.brand);
    document.querySelectorAll("[data-academy]").forEach(function (el) {
      el.textContent = c.academy || "";
    });
    if (c.academy) document.title = c.academy + " · " + baseTitle;
  }
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(paint);

  // 환경변수(ACADEMY_NAME/BRAND_COLOR)가 있으면 덮어쓰고 다시 그린다.
  // 실패하면(로컬에서 열었을 때 등) 위 기본값으로 그냥 돕니다.
  fetch("/api/config")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      if (d.academy) c.academy = d.academy;
      if (d.brand) c.brand = d.brand;
      if (d.academy || d.brand) ready(paint);
    })
    .catch(function () {});
})();
