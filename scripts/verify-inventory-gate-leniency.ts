// inventory-digest-staged: **전 단계** 게이트 완화(2026-08-12)의 판별력 검증.
//
// 확인하려는 것:
//   1. 정석 산출물은 1→7단계 게이트를 전부 통과하고 히든 테스트도 통과한다(회귀 없음).
//   2. 어느 단계든 산출물이 **미흡해도** 게이트는 통과한다 — 끝까지 밟을 수 있어야 측정이 시작된다.
//   3. 그 미흡함은 **히든 테스트(=채점)에서는 그대로 잡힌다** — 통과시키되 점수는 깎는 구조.
//   4. 산출물이 **아예 없거나 형태가 아니면** 게이트가 막는다.
//   5. 모든 트랩은 게이트가 아니라 **채점(히든)**에서 걸린다 — 게이트는 형태만 본다.
//
// 방식: 임시 워크스페이스에 기본 + stage2~7 unlock 디렉터리를 전부 깔아 "7단계까지 도달한 참가자"
// 상태를 만들고, 산출물만 시나리오별로 바꿔가며 각 단계의 gateTestCommand를 실제로 실행한다.
// report.js는 정답 JSON을 그대로 출력하는 스텁을 쓴다 — 여기서 검증하려는 건 재고 계산 로직이
// 아니라 **게이트의 통과/차단 판정**이기 때문이다.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProblem, resolveProjectPath } from "../src/lib/problems";

const problem = loadProblem("inventory-digest-staged");
const stages = problem.stages!;

// --- 정석 산출물(히든 테스트의 기대값 그대로) ---
const CORRECT_REPORT = {
  totalQuantity: 762,
  totalValue: 7560500,
  byCategory: {
    ELEC: { quantity: 76, value: 2673000 },
    HHLD: { quantity: 198, value: 2019000 },
    OFSP: { quantity: 463, value: 1240500 },
    FURN: { quantity: 25, value: 1628000 },
  },
  lowStock: ["보조배터리", "USB허브", "담요", "슬리퍼", "클리어파일", "스테이플러", "접이식의자"],
};

const CORRECT_REFUND = [
  "R004", "R015", "R023", "R089", "R096", "R114", "R117", "R146", "R151", "R156",
  "R182", "R228", "R230", "R235", "R303", "R313", "R314", "R328", "R341", "R372",
  "R373", "R391", "R394",
];

const CORRECT_STATS = {
  count: 400,
  byRating: { "1": 38, "2": 105, "3": 40, "4": 111, "5": 106 },
  avgRating: 3.35,
  refundMentionCount: 41,
};

const CORRECT_VIOLATIONS = [
  "E0003", "E0005", "E0007", "E0009", "E0015", "E0017", "E0020", "E0026", "E0041",
  "E0042", "E0059", "E0064", "E0070", "E0073", "E0084", "E0098", "E0108", "E0129",
  "E0132", "E0133", "E0134", "E0143", "E0149", "E0157", "E0160", "E0176", "E0178",
  "E0179", "E0194", "E0196", "E0199", "E0208", "E0212", "E0228", "E0233",
];

const CORRECT_SUMMARY = {
  디자인팀: { total: 3879584, violationCount: 7 },
  개발팀: { total: 3113579, violationCount: 8 },
  영업2팀: { total: 2311267, violationCount: 7 },
  영업1팀: { total: 3425810, violationCount: 5 },
  경영지원팀: { total: 4315111, violationCount: 8 },
};

const CORRECT_REORDER = {
  보조배터리: 12, USB허브: 11, 담요: 42, 슬리퍼: 45,
  클리어파일: 65, 스테이플러: 62, 접이식의자: 7,
};

type Artifacts = {
  report?: unknown;
  "refund-requests.json"?: unknown;
  "review-stats.json"?: unknown;
  "expense-violations.json"?: unknown;
  "expense-summary.json"?: unknown;
  "reorder.json"?: unknown;
};

const CORRECT_ALL: Artifacts = {
  report: CORRECT_REPORT,
  "refund-requests.json": CORRECT_REFUND,
  "review-stats.json": CORRECT_STATS,
  "expense-violations.json": CORRECT_VIOLATIONS,
  "expense-summary.json": CORRECT_SUMMARY,
  "reorder.json": CORRECT_REORDER,
};

const JSON_FILES = [
  "refund-requests.json",
  "review-stats.json",
  "expense-violations.json",
  "expense-summary.json",
  "reorder.json",
] as const;

function makeWorkspace(): string {
  const ws = mkdtempSync(path.join(os.tmpdir(), "vibecheck-gate-"));
  cpSync(resolveProjectPath("problems/starters/inventory-digest-staged"), ws, { recursive: true });
  for (const stage of stages) {
    if (stage.unlockPath) cpSync(resolveProjectPath(stage.unlockPath), ws, { recursive: true });
  }
  return ws;
}

function writeArtifacts(ws: string, a: Artifacts, bomMode = false): void {
  // report.js 스텁 — 마지막 줄에 JSON 한 줄을 뱉으면 _helpers.runReport가 그걸 읽는다.
  const report = a.report === undefined ? CORRECT_REPORT : a.report;
  writeFileSync(
    path.join(ws, "report.js"),
    `console.log(JSON.stringify(${JSON.stringify(report)}));\n`,
    "utf8",
  );
  for (const name of JSON_FILES) {
    const p = path.join(ws, name);
    const value = a[name];
    if (value === undefined) {
      if (existsSync(p)) unlinkSync(p); // "산출물 없음" 시나리오
      continue;
    }
    // 일부 시나리오는 일부러 UTF-8 BOM을 붙여서 쓴다 — Windows에서 PowerShell로 파일을 쓰면
    // 기본으로 붙고, 실사용에서 이것 때문에 5단계 게이트가 막혔다(_helpers.js의 stripBom 주석).
    const text = JSON.stringify(value, null, 2);
    writeFileSync(p, bomMode ? "﻿" + text : text, "utf8");
  }
}

function runCommand(ws: string, command: string): boolean {
  try {
    execFileSync(command.split(" ")[0], command.split(" ").slice(1), {
      cwd: ws,
      stdio: "pipe",
      shell: true,
    });
    return true;
  } catch {
    return false;
  }
}

function runGate(ws: string, stageIndex: number): boolean {
  return runCommand(ws, stages[stageIndex - 1].gateTestCommand!);
}

// 완료 시점 재현: hiddenTestsPath로 tests/를 덮어쓴 뒤 문제의 testCommand를 그대로 돌린다
// (evaluator.ts가 채점 직전에 하는 것과 같은 순서).
function runHidden(ws: string): boolean {
  cpSync(resolveProjectPath(problem.hiddenTestsPath!), ws, { recursive: true });
  return runCommand(ws, problem.testCommand!);
}

let pass = 0;
let fail = 0;

function check(label: string, actual: boolean, expected: boolean): void {
  const ok = actual === expected;
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    `${ok ? "  OK  " : "  실패"}  ${label.padEnd(58)} → ${actual ? "통과" : "차단"} (기대: ${expected ? "통과" : "차단"})`,
  );
}

function withWorkspace<T>(fn: (ws: string) => T): T {
  const ws = makeWorkspace();
  try {
    return fn(ws);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

console.log("\n[1] 정석 산출물 — 1~7단계 게이트 + 히든 전부 통과해야 한다");
withWorkspace((ws) => {
  writeArtifacts(ws, CORRECT_ALL);
  for (let i = 1; i <= stages.length; i++) check(`${i}단계 게이트`, runGate(ws, i), true);
  check("히든 테스트(완료 시점 채점)", runHidden(ws), true);
});

console.log("\n[2] 3단계가 미흡한 경우 — 게이트는 통과, 히든(채점)은 잡아야 한다");
for (const [label, value] of [
  ["별점 조건만 적용(143건)", Array.from({ length: 143 }, (_, i) => `R${String(i + 1).padStart(3, "0")}`)],
  ["단어 조건만 적용(41건)", Array.from({ length: 41 }, (_, i) => `R${String(i + 1).padStart(3, "0")}`)],
  ["정답에서 5건 누락(허용치 2건 초과)", CORRECT_REFUND.slice(0, 18)],
] as const) {
  withWorkspace((ws) => {
    writeArtifacts(ws, { ...CORRECT_ALL, "refund-requests.json": value });
    check(`3단계 게이트 — ${label}`, runGate(ws, 3), true);
    check(`  └ 히든(채점) — ${label}`, runHidden(ws), false);
  });
}

console.log("\n[3] 4단계가 미흡한 경우 — 게이트는 통과, 히든(채점)은 잡아야 한다");
for (const [label, value] of [
  ["평균 별점을 반올림(3.35 → 3.36)", { ...CORRECT_STATS, avgRating: 3.36 }],
  ["refundMentionCount에 별점 조건 적용(41 → 23)", { ...CORRECT_STATS, refundMentionCount: 23 }],
  ["별점 분포가 통째로 엉망", { ...CORRECT_STATS, byRating: { "1": 1, "2": 1, "3": 1, "4": 1, "5": 1 } }],
] as const) {
  withWorkspace((ws) => {
    writeArtifacts(ws, { ...CORRECT_ALL, "review-stats.json": value });
    check(`4단계 게이트 — ${label}`, runGate(ws, 4), true);
    check(`  └ 히든(채점) — ${label}`, runHidden(ws), false);
  });
}

console.log("\n[4] 산출물이 아예 없거나 형태가 아니면 게이트가 막아야 한다");
const BLOCKED: [string, number, Artifacts][] = [
  ["3단계: refund-requests.json 없음", 3, { ...CORRECT_ALL, "refund-requests.json": undefined }],
  ["3단계: 빈 배열", 3, { ...CORRECT_ALL, "refund-requests.json": [] }],
  ["3단계: id 형식이 아닌 값", 3, { ...CORRECT_ALL, "refund-requests.json": ["아무거나", "x"] }],
  // 키가 하나인 객체로 감싼 형태는 **의도적으로 통과**시킨다(아래 [8] 참고) — 여기서는 그렇게도
  // 해석할 수 없는 형태만 차단 대상이다.
  ["3단계: 배열이 아니고 감싼 것도 아님", 3, { ...CORRECT_ALL, "refund-requests.json": { a: 1, b: 2 } }],
  ["4단계: review-stats.json 없음", 4, { ...CORRECT_ALL, "review-stats.json": undefined }],
  ["4단계: 항목 누락(refundMentionCount 없음)", 4, { ...CORRECT_ALL, "review-stats.json": { count: 400, byRating: { "1": 38 }, avgRating: 3.35 } }],
  ["4단계: byRating이 비어 있음", 4, { ...CORRECT_ALL, "review-stats.json": { ...CORRECT_STATS, byRating: {} } }],
];
for (const [label, stageIndex, artifacts] of BLOCKED) {
  withWorkspace((ws) => {
    writeArtifacts(ws, artifacts);
    check(label, runGate(ws, stageIndex), false);
  });
}

console.log("\n[5] 나머지 단계(1·2·5·6·7)도 미흡하면 게이트는 통과, 채점이 잡아야 한다");
const NOW_GRADED: [string, number, Artifacts][] = [
  ["1단계: 합계가 틀림", 1, { ...CORRECT_ALL, report: { ...CORRECT_REPORT, totalQuantity: 1, totalValue: 1 } }],
  ["2단계: byCategory 키를 한글 분류명으로", 2, { ...CORRECT_ALL, report: { ...CORRECT_REPORT, byCategory: { 전자기기: { quantity: 76, value: 2673000 } } } }],
  ["2단계: 재고 부족 기준을 카테고리 무관 통일", 2, { ...CORRECT_ALL, report: { ...CORRECT_REPORT, lowStock: ["보조배터리", "USB허브"] } }],
  ["5단계: 위반 검출이 규칙 오해(35건 → 84건)", 5, { ...CORRECT_ALL, "expense-violations.json": Array.from({ length: 84 }, (_, i) => `E${String(i + 1).padStart(4, "0")}`) }],
  ["6단계: 부서별 집계 숫자가 틀림", 6, { ...CORRECT_ALL, "expense-summary.json": { ...CORRECT_SUMMARY, 개발팀: { total: 1, violationCount: 1 } } }],
  ["7단계: 재주문 수량이 틀림(앞 규칙을 놓침)", 7, { ...CORRECT_ALL, "reorder.json": { ...CORRECT_REORDER, 담요: 1 } }],
];
for (const [label, stageIndex, artifacts] of NOW_GRADED) {
  withWorkspace((ws) => {
    writeArtifacts(ws, artifacts);
    check(`${label} — 게이트`, runGate(ws, stageIndex), true);
    check("  └ 히든(채점)", runHidden(ws), false);
  });
}

console.log("\n[6] 전 단계: 산출물이 없거나 형태가 아니면 게이트가 막아야 한다");
const BLOCKED_ALL: [string, number, Artifacts][] = [
  ["1단계: report.js가 합계를 안 냄", 1, { ...CORRECT_ALL, report: { hello: 1 } }],
  ["2단계: byCategory 비어 있음", 2, { ...CORRECT_ALL, report: { ...CORRECT_REPORT, byCategory: {} } }],
  ["2단계: lowStock 비어 있음", 2, { ...CORRECT_ALL, report: { ...CORRECT_REPORT, lowStock: [] } }],
  ["5단계: expense-violations.json 없음", 5, { ...CORRECT_ALL, "expense-violations.json": undefined }],
  ["5단계: id 형식이 아님", 5, { ...CORRECT_ALL, "expense-violations.json": ["아무거나"] }],
  ["6단계: expense-summary.json 없음", 6, { ...CORRECT_ALL, "expense-summary.json": undefined }],
  ["6단계: 부서 값에 숫자가 없음", 6, { ...CORRECT_ALL, "expense-summary.json": { 개발팀: { total: "x" } } }],
  ["7단계: reorder.json 없음", 7, { ...CORRECT_ALL, "reorder.json": undefined }],
  ["7단계: 수량이 0", 7, { ...CORRECT_ALL, "reorder.json": { 담요: 0 } }],
];
for (const [label, stageIndex, artifacts] of BLOCKED_ALL) {
  withWorkspace((ws) => {
    writeArtifacts(ws, artifacts);
    check(label, runGate(ws, stageIndex), false);
  });
}

console.log("\n[7] 산출물에 UTF-8 BOM이 붙어도 통과해야 한다 (Windows PowerShell 기본 동작)");
withWorkspace((ws) => {
  writeArtifacts(ws, CORRECT_ALL, true); // 모든 JSON을 BOM 포함으로 기록
  for (let i = 1; i <= stages.length; i++) check(`${i}단계 게이트 (BOM)`, runGate(ws, i), true);
  check("히든 테스트 (BOM)", runHidden(ws), true);
});

console.log("\n[8] 산출물이 한 겹 감싸여 있어도 게이트는 통과해야 한다 (실사용 5단계 차단 사례)");
withWorkspace((ws) => {
  writeArtifacts(ws, {
    ...CORRECT_ALL,
    // 실제로 나왔던 형태: 프롬프트는 "id 배열로"였는데 {"violations": [...]}로 감싸서 나왔다.
    // id 목록 자체는 정답과 일치했다.
    "expense-violations.json": { violations: CORRECT_VIOLATIONS },
    "refund-requests.json": { ids: CORRECT_REFUND },
    "reorder.json": { reorder: CORRECT_REORDER },
  });
  for (let i = 1; i <= stages.length; i++) check(`${i}단계 게이트 (감싼 산출물)`, runGate(ws, i), true);
  // 규격 위반 자체는 없던 일이 되지 않는다 — 채점(히든)은 규격대로 보고 잡아낸다.
  check("히든(채점)은 규격 위반을 잡는다", runHidden(ws), false);
});

console.log("\n" + "=".repeat(90));
console.log(`총 ${pass + fail}개 체크 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
