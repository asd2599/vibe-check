// 6단계 [회계팀] 부서별 경비 집계 — **게이트(통과용) 판정**
//
// 이 파일은 "다음 단계로 넘어가도 되는가"만 본다. 정확도 채점이 아니다.
// 부서별 총액/위반 건수의 정확한 값은 완료 시점에 hiddenTestsPath가 이 파일을 덮어쓰면서 채점된다.
//
// 게이트/채점을 나눈 이유는 stage3.test.js 상단 주석 참고(2026-08-12).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

test("expense-summary.json — 결과물이 존재하고 부서별 집계 형태인가", () => {
  const s = unwrapSingleKey(readJson("expense-summary.json"));

  assert.ok(
    s && typeof s === "object" && !Array.isArray(s),
    "expense-summary.json은 부서명을 키로 하는 객체여야 한다",
  );
  const entries = Object.entries(s);
  assert.ok(entries.length > 0, "expense-summary.json이 비어 있다 — 부서별로 집계해 담아라");
  for (const [dept, v] of entries) {
    assert.ok(
      v && typeof v === "object" && typeof v.total === "number" && typeof v.violationCount === "number",
      `${dept}에는 total과 violationCount가 숫자로 있어야 한다`,
    );
  }
});
