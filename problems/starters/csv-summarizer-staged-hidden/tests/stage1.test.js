// 1단계 게이트 테스트. 실행: node --test tests/stage1.test.js
// 대상 명령: node summarize.js <파일경로> (워크스페이스 루트 기준)
// 기대 출력: stdout에 JSON 한 줄 -> { "total": <number>, "counted": <number>, "skipped": <number> }

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

test("sales_basic.csv - 기본 합산", () => {
  const out = run("sales_basic.csv");
  assert.equal(out.total, 400);
  assert.equal(out.counted, 3);
  assert.equal(out.skipped, 0);
});

test("출력 필드명이 정확히 total/counted/skipped 이어야 한다", () => {
  const out = run("sales_basic.csv");
  const keys = Object.keys(out).sort();
  assert.deepEqual(keys, ["counted", "skipped", "total"]);
});
