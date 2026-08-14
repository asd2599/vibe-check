// 3단계 게이트 테스트. 실행: node --test tests/stage1.test.js tests/stage2.test.js tests/stage3.test.js (누적)
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

test("sales_quoted.csv - 따옴표 안 구분자/이스케이프 처리 (RFC 4180)", () => {
  const out = run("sales_quoted.csv");
  // "1,250"과 "2,000.5"는 따옴표로 감싸진 칸 안에 쉼표가 들어있다.
  // split(',')로 그냥 자르면 컬럼이 밀려서 amount가 깨진다.
  assert.equal(out.total, 3626);
  assert.equal(out.counted, 4);
  assert.equal(out.skipped, 0);
});
