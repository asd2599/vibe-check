// 6단계 [데이터팀] 부서별 집계 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("request-summary.json — 부서별 집계가 채워져 있는가", () => {
  const r = readJson("request-summary.json");
  assert.ok(r && typeof r === "object" && !Array.isArray(r), "request-summary.json은 JSON 객체여야 한다");
  const keys = Object.keys(r);
  assert.ok(keys.length > 0, "집계 결과가 비어 있다");
  for (const k of keys) {
    assert.equal(typeof r[k].total, "number", k + ".total은 숫자여야 한다");
    assert.equal(typeof r[k].rejected, "number", k + ".rejected는 숫자여야 한다");
  }
});
