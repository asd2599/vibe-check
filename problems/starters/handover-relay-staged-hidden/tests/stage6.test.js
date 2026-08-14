// 6단계 [데이터팀] 부서별 집계 — **채점**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("request-summary.json — 부서별 신청/반려 건수", () => {
  assert.deepEqual(readJson("request-summary.json"), {
    "영업팀": {
      "total": 56,
      "rejected": 37
    },
    "상품팀": {
      "total": 71,
      "rejected": 47
    },
    "마케팅팀": {
      "total": 53,
      "rejected": 40
    },
    "재무팀": {
      "total": 48,
      "rejected": 34
    },
    "고객지원팀": {
      "total": 50,
      "rejected": 29
    }
  });
});
