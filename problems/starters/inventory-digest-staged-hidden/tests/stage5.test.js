// 5단계 [회계팀] 경비 규정 위반 검출
// 경계값이 함정이다: 식대는 1인당 기준(총액 아님), 교통비는 20,000원 이하면 영수증 면제,
// 접대비는 총액 기준(1인당 아님), 비품은 항목 자체가 예외. 전부 "초과/이하"라 등호 위치가 갈린다.
// 누락/오검출은 각각 2건까지 허용한다(_helpers.js의 assertIdSet 주석 참고).
const { test } = require("node:test");
const { readJson, assertIdSet } = require("./_helpers.js");

const EXPECTED = [
  "E0003",
  "E0005",
  "E0007",
  "E0009",
  "E0015",
  "E0017",
  "E0020",
  "E0026",
  "E0041",
  "E0042",
  "E0059",
  "E0064",
  "E0070",
  "E0073",
  "E0084",
  "E0098",
  "E0108",
  "E0129",
  "E0132",
  "E0133",
  "E0134",
  "E0143",
  "E0149",
  "E0157",
  "E0160",
  "E0176",
  "E0178",
  "E0179",
  "E0194",
  "E0196",
  "E0199",
  "E0208",
  "E0212",
  "E0228",
  "E0233"
];

test("expense-violations.json — 위반 항목 id", () => {
  assertIdSet(readJson("expense-violations.json"), EXPECTED, "expense-violations.json");
});
