// 4단계 [결제팀] 담당팀별 집계 — **채점**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("payment-teams.json — 팀별 건수와 금액 합계", () => {
  assert.deepEqual(readJson("payment-teams.json"), {
    "결제2팀": {
      "count": 67,
      "totalAmount": 30742000
    },
    "결제1팀": {
      "count": 82,
      "totalAmount": 36249000
    },
    "리스크팀": {
      "count": 75,
      "totalAmount": 32431000
    },
    "가맹점지원팀": {
      "count": 99,
      "totalAmount": 49977000
    }
  });
});
