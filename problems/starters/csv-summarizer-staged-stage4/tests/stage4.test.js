// 4단계(최종) 게이트 테스트.
// 실행: node --test tests/stage1.test.js tests/stage2.test.js tests/stage3.test.js tests/stage4.test.js (누적)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const WORKSPACE_ROOT = path.join(__dirname, "..");

function run(dataFile) {
  const result = spawnSync("node", ["summarize.js", path.join("data", dataFile)], {
    cwd: WORKSPACE_ROOT,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`summarize.js 실행 실패: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `summarize.js가 0이 아닌 코드로 종료됨 (${result.status})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }

  const lines = result.stdout.trim().split("\n").filter((line) => line.trim().length > 0);
  const lastLine = lines[lines.length - 1];

  let parsed;
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    throw new Error(`stdout 마지막 줄이 유효한 JSON이 아님: ${JSON.stringify(lastLine)}`);
  }
  return parsed;
}

test("sales_dirty.csv - 더러운 값 판정 + 음수 포함 + 반올림", () => {
  const out = run("sales_dirty.csv");
  // 유효: "1,200"(->1200), -500(환불, 포함), 234.005(반올림 경계값) => 934.005 -> 934.01
  // 무효(skip): 빈칸, N/A, "-", TBD, "₩1,200"(통화기호), $50(통화기호) => 6개
  assert.equal(out.total, 934.01);
  assert.equal(out.counted, 3);
  assert.equal(out.skipped, 6);
});
