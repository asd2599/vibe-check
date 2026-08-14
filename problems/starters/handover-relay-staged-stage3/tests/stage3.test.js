// 3단계 [결제팀] 원인별 집계 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("payment-causes.json — 원인별 건수가 채워져 있는가", () => {
  const r = readJson("payment-causes.json");
  assert.ok(r && typeof r === "object" && !Array.isArray(r), "payment-causes.json은 JSON 객체여야 한다");
  const keys = Object.keys(r);
  assert.ok(keys.length > 0, "집계 결과가 비어 있다");
  assert.ok(
    keys.every((k) => typeof r[k] === "number"),
    "각 원인의 값은 건수(숫자)여야 한다",
  );
});
