// 1단계 [물류팀] 전체 재고 합계 — **게이트(통과용) 판정**
//
// 이 파일은 "다음 단계로 넘어가도 되는가"만 본다. 정확도 채점이 아니다.
// 정확한 값(totalQuantity 762 / totalValue 7,560,500)은 완료 시점에 hiddenTestsPath가 이 파일을
// 덮어쓰면서 채점된다 — 여기서는 보지 않는다.
//
// 게이트/채점을 나눈 이유는 stage3.test.js 상단 주석 참고(2026-08-12).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runReport } = require("./_helpers.js");

test("report.js — 실행되고 전체 합계를 내놓는가", () => {
  // report.js가 없거나 죽으면 runReport가 던진다 = "결과물이 아무것도 없다" → 막는다.
  const out = runReport();

  assert.ok(out && typeof out === "object" && !Array.isArray(out), "report.js는 JSON 객체 한 줄을 출력해야 한다");
  assert.ok(
    typeof out.totalQuantity === "number" && out.totalQuantity > 0,
    "totalQuantity는 0보다 큰 숫자여야 한다(재고를 한 건도 못 셌다면 csv를 안 읽은 것이다)",
  );
  assert.ok(
    typeof out.totalValue === "number" && out.totalValue > 0,
    "totalValue는 0보다 큰 숫자여야 한다",
  );
});
