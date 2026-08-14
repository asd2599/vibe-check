// 1단계 [인프라팀] 스테이징 설정값 — **채점**
// handover.md 안에서 같은 항목이 3번 나오고 **뒤에 적힌 것이 최신**이다.
// 앞 값(8080 / staging_v2 / 3)이나 운영 값(443 / prod_core_r2 / 6)을 쓰면 여기서 걸린다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("config.json — 스테이징 최신 설정값", () => {
  const c = readJson("config.json");
  assert.equal(c.stagingPort, 7443, "stagingPort");
  assert.equal(c.dbSchema, "stg_core_v3", "dbSchema");
  assert.equal(c.retryLimit, 2, "retryLimit");
});
