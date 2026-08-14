// 3단계 [CS팀] 환불/교환 요청 후기 추출
// 판정은 기계적으로 확정된다: 별점 2점 이하 AND 본문에 "환불" 또는 "교환" 포함.
// 오답 유도는 경계로만 준다 — 별점만 보면 143건,
// 단어만 보면 41건이 나온다(정답 23건).
// 누락/오검출은 각각 2건까지 허용한다(_helpers.js의 assertIdSet 주석 참고).
const { test } = require("node:test");
const { readJson, assertIdSet } = require("./_helpers.js");

const EXPECTED = [
  "R004",
  "R015",
  "R023",
  "R089",
  "R096",
  "R114",
  "R117",
  "R146",
  "R151",
  "R156",
  "R182",
  "R228",
  "R230",
  "R235",
  "R303",
  "R313",
  "R314",
  "R328",
  "R341",
  "R372",
  "R373",
  "R391",
  "R394"
];

test("refund-requests.json — 두 조건을 모두 만족하는 id만", () => {
  assertIdSet(readJson("refund-requests.json"), EXPECTED, "refund-requests.json");
});
