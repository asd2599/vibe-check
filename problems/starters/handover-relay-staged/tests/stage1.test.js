// 1단계 [인프라팀] 스테이징 설정값 — **게이트(진행 판정)**
// 값이 맞는지는 보지 않는다. 정확한 값은 완료 시점 히든 테스트가 채점한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("config.json — 설정값 3개가 채워져 있는가", () => {
  const c = readJson("config.json");
  assert.ok(c && typeof c === "object" && !Array.isArray(c), "config.json은 JSON 객체여야 한다");
  assert.equal(typeof c.stagingPort, "number", "stagingPort는 숫자여야 한다");
  assert.ok(c.stagingPort > 0 && c.stagingPort < 65536, "stagingPort는 포트 번호 범위여야 한다");
  assert.equal(typeof c.dbSchema, "string", "dbSchema는 문자열이어야 한다");
  assert.ok(c.dbSchema.trim().length > 0, "dbSchema가 비어 있다");
  assert.equal(typeof c.retryLimit, "number", "retryLimit는 숫자여야 한다");
  assert.ok(Number.isInteger(c.retryLimit) && c.retryLimit >= 0, "retryLimit는 0 이상의 정수여야 한다");
});
