// 6단계 [회계팀] 부서별 경비 집계
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("expense-summary.json — 부서별 총액과 위반 건수", () => {
  const s = readJson("expense-summary.json");
  assert.deepEqual(s, {
      "디자인팀": {
          "total": 3879584,
          "violationCount": 7
      },
      "개발팀": {
          "total": 3113579,
          "violationCount": 8
      },
      "영업2팀": {
          "total": 2311267,
          "violationCount": 7
      },
      "영업1팀": {
          "total": 3425810,
          "violationCount": 5
      },
      "경영지원팀": {
          "total": 4315111,
          "violationCount": 8
      }
  });
});
