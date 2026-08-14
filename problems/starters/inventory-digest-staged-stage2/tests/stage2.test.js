// 2단계 [물류팀] 카테고리별 집계 + 재고 부족 — **게이트(통과용) 판정**
//
// 이 파일은 "다음 단계로 넘어가도 되는가"만 본다. 정확도 채점이 아니다.
// 카테고리 코드 매핑(ELEC/HHLD/OFSP/FURN)과 카테고리별 재고 부족 기준이 맞았는지는 완료 시점에
// hiddenTestsPath가 이 파일을 덮어쓰면서 채점된다 — 여기서는 키 이름조차 보지 않는다.
//
// 게이트/채점을 나눈 이유는 stage3.test.js 상단 주석 참고(2026-08-12).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runReport } = require("./_helpers.js");

test("byCategory / lowStock — 결과물이 존재하고 형태가 맞는가", () => {
  const out = runReport();

  assert.ok(
    out.byCategory && typeof out.byCategory === "object" && !Array.isArray(out.byCategory),
    "byCategory는 카테고리를 키로 하는 객체여야 한다",
  );
  const entries = Object.entries(out.byCategory);
  assert.ok(entries.length > 0, "byCategory가 비어 있다 — 카테고리별로 집계해 담아라");
  for (const [key, v] of entries) {
    assert.ok(
      v && typeof v === "object" && typeof v.quantity === "number" && typeof v.value === "number",
      `byCategory.${key}에는 quantity와 value가 숫자로 있어야 한다`,
    );
  }

  assert.ok(Array.isArray(out.lowStock), "lowStock은 품목명 배열이어야 한다");
  assert.ok(out.lowStock.length > 0, "lowStock이 비어 있다 — 재고 부족 품목을 골라 담아라");
  assert.ok(
    out.lowStock.every((name) => typeof name === "string" && name.length > 0),
    "lowStock의 원소는 전부 품목명 문자열이어야 한다",
  );
});
