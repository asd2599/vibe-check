// 4단계 [결제팀] 담당팀별 집계 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("payment-teams.json — 팀별 집계가 채워져 있는가", () => {
  const r = readJson("payment-teams.json");
  assert.ok(r && typeof r === "object" && !Array.isArray(r), "payment-teams.json은 JSON 객체여야 한다");
  const keys = Object.keys(r);
  assert.ok(keys.length > 0, "집계 결과가 비어 있다");
  for (const k of keys) {
    assert.equal(typeof r[k].count, "number", k + ".count는 숫자여야 한다");
    assert.equal(typeof r[k].totalAmount, "number", k + ".totalAmount는 숫자여야 한다");
  }
});
