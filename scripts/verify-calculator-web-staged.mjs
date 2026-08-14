// calculator-web-staged 검증 — docs/example/calculator-web-staged.md §8 체크리스트.
//
// 이 문제는 다른 문제들과 성격이 반대다: **게이트가 아무것도 안 잡아주고**, 완료 시점 히든 테스트가
// 1~6단계 요구사항을 한 번에 검사한다("안전망 없는 스펙 누적"). 그래서 검증도 두 축이다.
//   1) 게이트가 정말로 무조건 통과시키는가 (빈 워크스페이스로도 끝까지 진행되는가)
//   2) 히든이 정말로 회귀를 잡는가 (한 군데만 깬 구현이 정확히 그 항목만 실패하는가)
//
// 실행: node scripts/verify-calculator-web-staged.mjs
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const PROBLEM = JSON.parse(readFileSync(path.join(ROOT, "problems/calculator-web-staged.json"), "utf8"));
const STARTER = path.join(ROOT, PROBLEM.starterFiles);
const HIDDEN = path.join(ROOT, PROBLEM.hiddenTestsPath);

const checks = [];
const check = (label, ok, detail = "") => checks.push({ label, ok, detail });

// --- 정석 구현: 재귀 하강 파서 + 표시용 숫자 정리 ---
const REFERENCE_CALC = `
export function evaluate(expr) {
  try {
    const tokens = tokenize(String(expr));
    const value = parse(tokens);
    if (!Number.isFinite(value)) return "Error";
    return format(value);
  } catch {
    return "Error";
  }
}

function format(n) {
  return String(Number(n.toPrecision(12)));
}

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\\t") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error("number");
      out.push(num); i = j; continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      out.push(src.slice(i, j).toLowerCase()); i = j; continue;
    }
    if ("+-*/%()".includes(c)) { out.push(c); i++; continue; }
    throw new Error("char");
  }
  return out;
}

function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t) => { if (tokens[i] !== t) throw new Error("expected " + t); i++; };

  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = tokens[i++];
      const r = unary();
      if ((op === "/" || op === "%") && r === 0) throw new Error("div0");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function unary() {
    if (peek() === "-") { i++; return -unary(); }
    if (peek() === "+") { i++; return unary(); }
    return atom();
  }
  function atom() {
    const t = peek();
    if (t === undefined) throw new Error("eof");
    if (t === "(") { i++; const v = expr(); eat(")"); return v; }
    if (t === "sqrt" || t === "log") {
      i++; eat("("); const v = expr(); eat(")");
      if (t === "sqrt") { if (v < 0) throw new Error("domain"); return Math.sqrt(v); }
      if (v <= 0) throw new Error("domain");
      return Math.log10(v);
    }
    if (typeof t === "number") { i++; return t; }
    throw new Error("token");
  }

  const value = expr();
  if (i !== tokens.length) throw new Error("trailing");
  return value;
}
`;

// 정석 화면 — 채팅으로 못박은 규약(`#result` + 모든 버튼에 `data-key`)을 지키고, 리스너를
// **모든** data-key 버튼에 건다. 마크업 구조는 자유이므로 여기서는 최소 형태만 쓴다.
const REFERENCE_PAGE = `<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8" /><title>계산기</title></head>
  <body>
    <div id="expr"></div>
    <div id="result"></div>
    <div id="basic">
      <button data-key="7">7</button><button data-key="8">8</button><button data-key="9">9</button>
      <button data-key="4">4</button><button data-key="5">5</button><button data-key="6">6</button>
      <button data-key="1">1</button><button data-key="2">2</button><button data-key="3">3</button>
      <button data-key="0">0</button><button data-key=".">.</button>
      <button data-key="+">+</button><button data-key="-">−</button>
      <button data-key="*">×</button><button data-key="/">÷</button>
      <button data-key="=">=</button><button data-key="clear">C</button>
    </div>
    <div id="sci">
      <button data-key="(">(</button><button data-key=")">)</button><button data-key="%">%</button>
    </div>
    <script type="module">
      import { evaluate } from "./calc.js";
      const exprEl = document.getElementById("expr");
      const resultEl = document.getElementById("result");
      let expr = "";
      const press = (key) => {
        if (key === "clear") { expr = ""; resultEl.textContent = ""; }
        else if (key === "=") { resultEl.textContent = evaluate(expr); return; }
        else { expr += key; }
        exprEl.textContent = expr;
      };
      for (const btn of document.querySelectorAll("SELECTOR")) {
        btn.addEventListener("click", () => press(btn.dataset.key));
      }
      document.addEventListener("keydown", (e) => {
        if (e.key === "Enter") press("=");
        else if (e.key === "Escape") press("clear");
        else if ("0123456789.+-*/%()".includes(e.key)) press(e.key);
      });
    </script>
  </body>
</html>
`;

const GOOD_PAGE = REFERENCE_PAGE.replace("SELECTOR", "[data-key]");

// `data-key`를 하나도 안 달고 키패드를 스크립트로 그려낸 화면(실사용에서 실제로 나온 형태).
// 계산기는 멀쩡히 동작하므로 **화면 테스트도 통과해야 한다** — 측정 대상은 화면이 동작하는가지
// 속성 이름을 지켰는가가 아니다(2026-08-14 실사용 실패 후 추가한 라벨 폴백 검증).
const LABEL_ONLY_PAGE = `<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8" /><title>계산기</title></head>
  <body>
    <div id="expr"></div>
    <div id="result"></div>
    <div id="keys"></div>
    <script type="module">
      import { evaluate } from "./calc.js";
      const KEYS = [
        { label: "AC", action: "clear" },
        { label: "(", insert: "(" }, { label: ")", insert: ")" }, { label: "%", insert: "%" },
        { label: "7", insert: "7" }, { label: "8", insert: "8" }, { label: "9", insert: "9" },
        { label: "÷", insert: "/" },
        { label: "4", insert: "4" }, { label: "5", insert: "5" }, { label: "6", insert: "6" },
        { label: "×", insert: "*" },
        { label: "1", insert: "1" }, { label: "2", insert: "2" }, { label: "3", insert: "3" },
        { label: "−", insert: "-" },
        { label: "0", insert: "0" }, { label: ".", insert: "." }, { label: "+", insert: "+" },
        { label: "=", action: "equals" },
      ];
      const exprEl = document.getElementById("expr");
      const resultEl = document.getElementById("result");
      let expr = "";
      const keysEl = document.getElementById("keys");
      for (const key of KEYS) {
        const btn = document.createElement("button");
        btn.textContent = key.label;
        btn.addEventListener("click", () => {
          if (key.action === "clear") { expr = ""; resultEl.textContent = ""; }
          else if (key.action === "equals") { resultEl.textContent = evaluate(expr); return; }
          else { expr += key.insert; }
          exprEl.textContent = expr;
        });
        keysEl.append(btn);
      }
    </script>
  </body>
</html>
`;
// 실사용 사고(run c3f5bfff) 재현 — 리스너 셀렉터가 한쪽 컨테이너만 덮어서 괄호·나머지 버튼이
// **화면에 보이는데 클릭해도 아무 일이 없다.** calc.js 는 완벽하므로 calc 테스트는 전부 통과한다.
const DEAD_BUTTON_PAGE = REFERENCE_PAGE.replace("SELECTOR", "#basic [data-key]");

// 정석에서 딱 한 군데씩만 깬 구현들. 각각 "정확히 그 테스트만" 실패해야 한다.
const BROKEN = {
  // 6단계 기능을 얹으면서 우선순위를 왼쪽부터 계산하도록 되돌린 회귀(브리프 §8-3).
  precedenceRegression: REFERENCE_CALC.replace(
    'while (peek() === "*" || peek() === "/" || peek() === "%") {',
    'while (false) {',
  ).replace(
    'while (peek() === "+" || peek() === "-") {\n      const op = tokens[i++];\n      const r = term();\n      v = op === "+" ? v + r : v - r;\n    }',
    `while (peek() === "+" || peek() === "-" || peek() === "*" || peek() === "/" || peek() === "%") {
      const op = tokens[i++];
      const r = term();
      if ((op === "/" || op === "%") && r === 0) throw new Error("div0");
      v = op === "+" ? v + r : op === "-" ? v - r : op === "*" ? v * r : op === "/" ? v / r : v % r;
    }`,
  ),
  // 부동소수점 정리를 안 함 → 0.1+0.2 가 그대로 새어나온다.
  noFloatCleanup: REFERENCE_CALC.replace(
    "  return String(Number(n.toPrecision(12)));",
    "  return String(n);",
  ),
  // 0으로 나눌 때 Infinity 를 그대로 표시(에러 처리 누락). 파서가 던지는 예외는 그대로 두므로
  // 잘못된 식은 여전히 "Error" 다 — 4단계 테스트에서 ÷0 한 항목만 걸린다.
  noDivZeroGuard: REFERENCE_CALC.replaceAll(
    'if ((op === "/" || op === "%") && r === 0) throw new Error("div0");',
    "",
  ).replace("    if (!Number.isFinite(value)) return \"Error\";\n", ""),
  // 상용로그 대신 자연로그(흔한 실수).
  naturalLog: REFERENCE_CALC.replace("return Math.log10(v);", "return Math.log(v);"),
};

const EXPECTED_FAILURES = {
  precedenceRegression: ["3단계: 괄호와 연산 우선순위"],
  noFloatCleanup: ["5단계: 표시용 숫자 정리"],
  noDivZeroGuard: ["4단계: 0으로 나누기와 잘못된 식은 Error"],
  naturalLog: ["6단계: 상용로그"],
};

const UI_TEST = "화면: 버튼을 눌러서 실제로 계산이 되는가";

// 화면 테스트는 calc.js 를 거쳐 결과를 읽으므로, 계산 자체가 깨진 변형은 화면에서도 같이 걸린다
// (같이 걸리는 게 맞다 — 사람이 화면에서 실제로 보는 게 그 값이다).
EXPECTED_FAILURES.noFloatCleanup.push(UI_TEST);
EXPECTED_FAILURES.noDivZeroGuard.push(UI_TEST);

// 임시 워크스페이스 정리. 서버를 띄웠던 디렉터리는 프로세스가 완전히 죽기 전이면 Windows에서
// EPERM이 나므로, 실패해도 검증 결과에 영향을 주지 않게 삼킨다(어차피 임시 디렉터리다).
function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* 임시 디렉터리 정리 실패는 무시 */
  }
}

function makeWorkspace(calcSource, pageSource = GOOD_PAGE) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "calcverify-"));
  cpSync(STARTER, dir, { recursive: true });
  cpSync(HIDDEN, dir, { recursive: true }); // "완료" 시점에 히든이 덮어써지는 것과 동일
  if (calcSource != null) writeFileSync(path.join(dir, "calc.js"), calcSource, "utf8");
  if (pageSource != null) writeFileSync(path.join(dir, "index.html"), pageSource, "utf8");
  return dir;
}

// testCommand 를 TAP 리포터로 돌려서 "어떤 test 가 실패했는지" 이름으로 받아온다.
function runHiddenTests(dir) {
  const args = PROBLEM.testCommand.split(" ").slice(1); // "node" 제거
  // 리포터 플래그는 파일 경로 **앞**에 와야 먹는다(뒤에 두면 조용히 기본 리포터로 돌아간다 — 실측).
  const withTap = [args[0], "--test-reporter=tap", ...args.slice(1)];
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, withTap, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    stdout = (err.stdout ?? "") + (err.stderr ?? "");
  }
  const failed = [];
  const passed = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(not ok|ok) \d+ - (.+?)\s*$/.exec(line.trim());
    if (!m) continue;
    (m[1] === "ok" ? passed : failed).push(m[2]);
  }
  return { failed, passed, stdout };
}

// --- 1. 게이트 무력화: 빈 워크스페이스로도 6단계 전부 통과해야 한다 ---
{
  const empty = mkdtempSync(path.join(os.tmpdir(), "calcgate-"));
  let allPassed = true;
  const failedStages = [];
  for (const stage of PROBLEM.stages) {
    try {
      execFileSync(stage.gateTestCommand, { cwd: empty, shell: true, stdio: "ignore" });
    } catch {
      allPassed = false;
      failedStages.push(stage.index);
    }
  }
  check(
    `게이트 무력화 — 빈 워크스페이스로도 ${PROBLEM.stages.length}단계 전부 통과한다`,
    allPassed,
    failedStages.length ? `막힌 단계: ${failedStages.join(", ")}` : "",
  );
  check("단계가 6개다(확인 질문 5개 + 시작)", PROBLEM.stages.length === 6);
  check(
    "모든 단계가 unlockPath 없이 채팅만으로 진행된다(중간에 풀리는 리소스 없음)",
    PROBLEM.stages.every((s) => s.unlockPath === null),
  );
  rmSync(empty, { recursive: true, force: true });
}

// --- 2. 정답 검증: 정석 구현이 히든 전부 통과 ---
{
  const dir = makeWorkspace(REFERENCE_CALC);
  const { failed, passed } = runHiddenTests(dir);
  check(
    "정석 구현(계산 + 화면)이 히든 테스트 전부 통과",
    failed.length === 0 && passed.length === 8,
    failed.join(" / "),
  );
  cleanup(dir);
}

// --- 3. 스텁 그대로 두면 거의 다 실패 ---
{
  const dir = makeWorkspace(null, null); // 스타터의 calc.js 스텁 + Hello World 페이지 그대로
  const { failed, passed } = runHiddenTests(dir);
  // 스텁이 항상 "Error" 를 돌려주므로 "잘못된 식은 Error" 항목 하나는 공짜로 통과한다 — 나머지
  // 7개(화면 포함)가 전부 떨어지므로 채점이 실제로 산출물을 본다는 건 그대로 확인된다.
  check(
    "스텁 그대로면 히든 8개 중 7개가 실패한다(채점이 실제로 산출물을 본다)",
    failed.length === 7 && passed.length === 1 && passed[0].startsWith("4단계"),
    `실패 ${failed.length}개 / 통과 ${passed.join(", ")}`,
  );
  cleanup(dir);
}

// --- 3-a. data-key 없이 라벨만 있는 화면도 통과해야 한다(방법 중립) ---
{
  const dir = makeWorkspace(REFERENCE_CALC, LABEL_ONLY_PAGE);
  const { failed } = runHiddenTests(dir);
  check(
    "data-key 없이 라벨(×, ÷, AC …)만 있는 화면도 전부 통과한다",
    failed.length === 0,
    `실제 실패: ${failed.join(" / ")}`,
  );
  cleanup(dir);
}

// --- 3-b. 실사용 사고 재현: calc.js 는 완벽한데 버튼이 죽어있는 산출물 ---
{
  const dir = makeWorkspace(REFERENCE_CALC, DEAD_BUTTON_PAGE);
  const { failed } = runHiddenTests(dir);
  check(
    "버튼이 죽어있으면(리스너 셀렉터가 일부 버튼을 빠뜨림) 화면 테스트만 정확히 실패한다",
    failed.length === 1 && failed[0] === UI_TEST,
    `실제 실패: ${failed.join(" / ") || "(없음)"} — 이게 run c3f5bfff에서 90점이 나온 그 상황이다`,
  );
  cleanup(dir);
}

// --- 4. 회귀 검출: 한 군데만 깬 구현이 정확히 그 항목만 실패 ---
for (const [name, source] of Object.entries(BROKEN)) {
  const dir = makeWorkspace(source);
  const { failed } = runHiddenTests(dir);
  const want = EXPECTED_FAILURES[name];
  const ok = failed.length === want.length && want.every((w) => failed.includes(w));
  check(`회귀 검출 — ${name} 은 "${want.join(", ")}" 만 실패한다`, ok, `실제 실패: ${failed.join(" / ") || "(없음)"}`);
  cleanup(dir);
}

// --- 5. 시작 상태: 서버가 뜨고 Hello World 페이지가 실제로 응답한다 ---
{
  const dir = makeWorkspace(null, null);
  const port = 5399;
  const server = spawn(process.execPath, ["server.js"], {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let body = "";
  let calcBody = "";
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    try {
      body = await (await fetch(`http://localhost:${port}/`)).text();
      calcBody = await (await fetch(`http://localhost:${port}/calc.js`)).text();
      break;
    } catch {
      /* 아직 안 떴다 */
    }
  }
  server.kill();
  check("워크스페이스를 열면 뜨는 서버가 Hello World 페이지를 응답한다", body.includes("Hello World"));
  check("페이지가 calc.js 를 실제로 import 한다(채점 접점이 화면과 연결돼 있다)", body.includes("./calc.js") && calcBody.includes("export function evaluate"));
  check("문제 파일이 서버 자동 실행을 요청한다(autoStartCommand)", PROBLEM.autoStartCommand === "npm start");
  cleanup(dir);
}

// --- 6. 말끔함: 함정은 채팅에만, 스타터에는 구조만 ---
{
  // 참가자가 읽는 건 계산 접점(calc.js)과 화면(index.html)이다. server.js/package.json은 인프라라
  // console.log 같은 단어가 당연히 들어있어 검사 대상이 아니다.
  const starterText = ["calc.js", "index.html"]
    .map((f) => readFileSync(path.join(STARTER, f), "utf8"))
    .join("\n");
  // 스텁에 못박아도 되는 건 "연산자 표기(ASCII +,-,*,/)"뿐이다 — 1단계 사칙연산의 규약이라 함정이
  // 아니다. 괄호/우선순위/소수점 정리/나머지/루트/로그는 전부 2~6단계 채팅으로만 도착해야 한다.
  const leaks = ["괄호", "우선순위", "소수점", "나머지", "sqrt", "log10", "상용로그", "0.1"].filter((kw) =>
    starterText.includes(kw),
  );
  check("스타터에 2~6단계 함정이 새지 않았다(구조 힌트만)", leaks.length === 0, leaks.join(", "));

  const shownText = [PROBLEM.prompt, ...PROBLEM.stages.map((s) => s.promptAddition)].join("\n");
  check("참가자 노출 텍스트에 히든 테스트 파일명이 안 나온다", !shownText.includes("final.test"));
  check("참가자 노출 텍스트에 '게이트/통과' 같은 내부 용어가 안 나온다", !/게이트|히든|rubric/i.test(shownText));
}

// --- 7. 목록 최상단 ---
{
  const ids = execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import { listProblemsInDisplayOrder } from ${JSON.stringify(
      pathToFileURL(path.join(ROOT, "src/lib/problems.ts")).href,
    )}; console.log(listProblemsInDisplayOrder().map(p => p.id).join(","));`,
  ], { cwd: ROOT, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--experimental-strip-types --no-warnings" } })
    .trim()
    .split(",");
  check("대시보드 문제 목록의 맨 위가 calculator-web-staged 다", ids[0] === "calculator-web-staged", ids.join(" → "));
}

let failedCount = 0;
for (const c of checks) {
  if (!c.ok) failedCount += 1;
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.label}${c.ok || !c.detail ? "" : `\n      → ${c.detail}`}`);
}
console.log(`\n${checks.length - failedCount}/${checks.length} 통과`);
process.exit(failedCount === 0 ? 0 : 1);
