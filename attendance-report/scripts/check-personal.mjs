// 개인정보·실키 유출 점검 — **커밋/배포 전에 돌리세요.**
//
// 왜 있나:
//   세미나 자료를 만들 때 "내 학원 것으로 먼저 돌려보고 → 개인정보를 빼서 배포"하는
//   순서로 작업합니다(2차 추출기, 3차 mini-reader 때와 같은 방식).
//   그 과정에서 실제 학생 이름·전화번호·API 키·운영 DB ID가 코드에 남는 사고를 막습니다.
//
// 실행:  node scripts/check-personal.mjs
//        node scripts/check-personal.mjs --staged     (git add 한 것만 검사)
//
// 결과:  위험 0건이면 ✅ 로 끝나고 exit 0. 하나라도 있으면 파일·줄을 찍고 exit 1.

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAGED = process.argv.includes("--staged");

// 검사 대상 확장자 (바이너리·의존성은 제외)
const EXT = new Set([".js", ".mjs", ".html", ".sql", ".json", ".md", ".css"]);
const SKIP_DIR = new Set(["node_modules", ".git", ".vercel"]);
// 이 파일 자신은 패턴을 담고 있으니 제외
const SKIP_FILE = new Set(["scripts/check-personal.mjs"]);

// ── 위험 패턴 ──────────────────────────────────────────────
// level: "danger" = 절대 들어가면 안 됨 / "warn" = 사람이 눈으로 확인
// ok(match): 걸렸지만 무해하면 true (샘플값 걸러내기) — regex 하나로 다 처리하면 취약해서 분리
const RULES = [
  // 실제 키·토큰
  { level: "danger", name: "Anthropic API 키", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { level: "danger", name: "노션 토큰", re: /\b(ntn_|secret_)[A-Za-z0-9]{20,}/ },
  { level: "danger", name: "Supabase service_role JWT", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./ },
  { level: "danger", name: "Supabase 프로젝트 URL", re: /https:\/\/[a-z0-9]{20}\.supabase\.co/ },
  { level: "danger", name: "솔라피 API 키/시크릿(32자+ 대문자+숫자)", re: /\b(?=[A-Z0-9]*[0-9])[A-Z0-9]{32,}\b/ },
  { level: "danger", name: "앱스크립트 웹앱 URL", re: /AKfyc[A-Za-z0-9_-]{20,}/ },

  // 운영 식별자
  {
    level: "danger", name: "노션 DB ID(32자 hex)", re: /\b[0-9a-f]{32}\b/,
    // 전부 같은 글자이거나 0/f 뿐이면 placeholder (예: 000…0, aaa…a)
    ok: (m) => /^(.)\1{31}$/.test(m),
  },
  { level: "danger", name: "솔라피 발신프로필(pfId)", re: /\bKA01PF[0-9A-Za-z]{10,}/ },
  { level: "warn",   name: "카카오 템플릿 ID(TPL)", re: /\bKA01TP[0-9A-Za-z]{10,}/ },

  // 실제 연락처 — 샘플은 010-0000-0000 꼴이라 0 으로만 된 번호는 통과시킨다
  {
    level: "danger", name: "실제 휴대폰 번호",
    re: /\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/,
    // 010-0000-0000 / 01000000001 처럼 뒤가 거의 0 뿐이면 샘플로 본다
    ok: (m) => {
      const body = m.replace(/[^0-9]/g, "").slice(3);
      const zeros = (body.match(/0/g) || []).length;
      return zeros >= body.length - 1;
    },
  },

  // 원장님 학원 고유값 (배포본에 남으면 안 됨)
  { level: "danger", name: "학원 실명(홍보은)", re: /홍보은/ },
  { level: "warn",   name: "브랜드명(HongLab/홍랩)", re: /HongLab|홍랩/ },
];

// 샘플이라고 명시된 줄은 건너뛴다 (가짜 데이터라는 표시)
const ALLOW_LINE = /(가짜|샘플|placeholder|예시|변경 필요|예: |복사용|demo0)/i;

function files() {
  if (STAGED) {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean)
      .map((rel) => path.resolve(ROOT, "..", rel))     // git 경로는 리포 루트 기준
      .filter((f) => f.startsWith(ROOT) && fs.existsSync(f));
  }
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name)); continue; }
      if (EXT.has(path.extname(e.name))) out.push(path.join(dir, e.name));
    }
  })(ROOT);
  return out;
}

const hits = [];
for (const f of files()) {
  const rel = path.relative(ROOT, f);
  if (SKIP_FILE.has(rel)) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (ALLOW_LINE.test(line)) return;
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (!m) continue;
      if (r.ok && r.ok(m[0])) continue;   // 샘플값이면 통과
      hits.push({ rel, line: i + 1, rule: r, match: m[0], text: line.trim().slice(0, 110) });
    }
  });
}

const danger = hits.filter((h) => h.rule.level === "danger");
const warn = hits.filter((h) => h.rule.level === "warn");

function show(list, label) {
  if (!list.length) return;
  console.log(`\n${label}`);
  for (const h of list) {
    console.log(`  ${h.rel}:${h.line}  [${h.rule.name}]  ${h.match}`);
    console.log(`     ${h.text}`);
  }
}

show(danger, "❌ 위험 — 커밋하지 마세요 (실제 키·운영 ID·실명·연락처)");
show(warn, "⚠️  확인 필요 — 의도한 것이면 괜찮습니다");

if (!danger.length && !warn.length) {
  console.log("✅ 개인정보·실키 없음. 커밋해도 안전합니다.");
} else {
  console.log(
    `\n위험 ${danger.length}건 · 확인필요 ${warn.length}건` +
    "\n\n빼는 방법:" +
    "\n  · 키·토큰·DB ID → 코드에서 지우고 Vercel 환경변수로" +
    "\n  · 학원 이름·색   → 코드는 \"우리 학원\" 그대로 두고 환경변수 ACADEMY_NAME / BRAND_COLOR 로" +
    "\n  · 학생 이름·번호 → 코드/SQL 에 넣지 말고 /students.html 붙여넣기 일괄등록으로 (DB에만 남음)" +
    "\n  · 일부러 넣은 샘플이면 그 줄에 \"샘플\"·\"가짜\"·\"예시\" 를 적으면 통과합니다"
  );
}

process.exit(danger.length ? 1 : 0);
