// 7단계 [물류팀 복귀] 재주문 리포트 — **게이트(통과용) 판정**
//
// 이 파일은 "제출할 수 있는가"만 본다. 정확도 채점이 아니다.
// 1·2단계에서 채팅으로만 받았던 규칙(카테고리 코드, 카테고리별 재고 부족 기준)을 다시 써서
// 재주문 수량을 맞게 냈는지는 완료 시점에 hiddenTestsPath가 이 파일을 덮어쓰면서 채점된다.
// **이 문제의 측정 목적(컨텍스트를 정리한 뒤에도 앞 규칙을 챙겼는가)이 걸리는 지점이 바로 거기다.**
//
// 게이트/채점을 나눈 이유는 stage3.test.js 상단 주석 참고(2026-08-12).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

test("reorder.json — 결과물이 존재하고 품목별 재주문 수량 형태인가", () => {
  const r = unwrapSingleKey(readJson("reorder.json"));

  assert.ok(
    r && typeof r === "object" && !Array.isArray(r),
    "reorder.json은 품목명을 키로 하는 객체여야 한다",
  );
  const entries = Object.entries(r);
  assert.ok(entries.length > 0, "reorder.json이 비어 있다 — 재고 부족 품목의 재주문 수량을 담아라");
  for (const [item, qty] of entries) {
    assert.ok(
      typeof qty === "number" && qty > 0,
      `${item}의 재주문 수량은 0보다 큰 숫자여야 한다`,
    );
  }
});
