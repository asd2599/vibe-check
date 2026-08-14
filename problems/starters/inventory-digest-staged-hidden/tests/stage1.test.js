// 1단계 [물류팀] 전체 재고 합계
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runReport } = require("./_helpers.js");

test("전체 수량/금액 합계", () => {
  const out = runReport();
  assert.equal(out.totalQuantity, 762);
  assert.equal(out.totalValue, 7560500);
});
