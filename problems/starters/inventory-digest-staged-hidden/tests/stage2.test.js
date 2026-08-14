// 2단계 [물류팀] 카테고리별 집계 + 재고 부족
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runReport } = require("./_helpers.js");

test("byCategory — 한글 분류가 아니라 시스템 코드가 키여야 한다", () => {
  const out = runReport();
  assert.deepEqual(out.byCategory, {
      "ELEC": {
          "quantity": 76,
          "value": 2673000
      },
      "HHLD": {
          "quantity": 198,
          "value": 2019000
      },
      "OFSP": {
          "quantity": 463,
          "value": 1240500
      },
      "FURN": {
          "quantity": 25,
          "value": 1628000
      }
  });
});

test("lowStock — 카테고리마다 다른 기준을 적용해야 한다", () => {
  const out = runReport();
  assert.ok(Array.isArray(out.lowStock), "lowStock은 배열이어야 한다");
  assert.deepEqual([...out.lowStock].sort(), [
      "USB허브",
      "담요",
      "보조배터리",
      "스테이플러",
      "슬리퍼",
      "접이식의자",
      "클리어파일"
  ].sort());
});

test("1단계 합계는 그대로 유지돼야 한다", () => {
  const out = runReport();
  assert.equal(out.totalQuantity, 762);
  assert.equal(out.totalValue, 7560500);
});
