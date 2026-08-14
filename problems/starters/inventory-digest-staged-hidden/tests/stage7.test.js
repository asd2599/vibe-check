// 7단계 [물류팀 복귀] 재주문 리포트
// 1·2단계에서 채팅으로만 받았던 규칙(카테고리 코드, 카테고리별 재고 부족 기준)을 다시 써야 한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("reorder.json — 재고 부족 품목별 재주문 수량", () => {
  const r = readJson("reorder.json");
  assert.deepEqual(r, {
      "보조배터리": 12,
      "USB허브": 11,
      "담요": 42,
      "슬리퍼": 45,
      "클리어파일": 65,
      "스테이플러": 62,
      "접이식의자": 7
  });
});
