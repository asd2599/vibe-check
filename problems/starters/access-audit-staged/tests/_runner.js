const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const WORKSPACE_ROOT = path.join(__dirname, "..");

function run() {
  const result = spawnSync("node", ["audit.js", "data"], { cwd: WORKSPACE_ROOT, encoding: "utf8" });
  if (result.error) throw new Error("audit.js 실행 실패: " + result.error.message);
  if (result.status !== 0) {
    throw new Error(
      "audit.js가 0이 아닌 코드로 종료됨 (" + result.status + ")\nstdout: " + result.stdout + "\nstderr: " + result.stderr,
    );
  }
  const lines = result.stdout.trim().split("\n").filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last);
  } catch {
    throw new Error("stdout 마지막 줄이 유효한 JSON이 아님: " + JSON.stringify(last));
  }
}

module.exports = { run, test, assert };
