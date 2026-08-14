// 2단계 게이트 테스트. 실행: node --test tests/stage1.test.js tests/stage2.test.js (누적)
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

test("sales_dept_a.tsv - 탭 구분자 + amount가 3번째 컬럼(헤더로 찾아야 함)", () => {
  const out = run("sales_dept_a.tsv");
  assert.equal(out.total, 1665);
  assert.equal(out.counted, 3);
  assert.equal(out.skipped, 0);
});

test("sales_dept_b.psv - 파이프 구분자 + amount가 2번째 컬럼(헤더로 찾아야 함)", () => {
  const out = run("sales_dept_b.psv");
  assert.equal(out.total, 1400);
  assert.equal(out.counted, 3);
  assert.equal(out.skipped, 0);
});
