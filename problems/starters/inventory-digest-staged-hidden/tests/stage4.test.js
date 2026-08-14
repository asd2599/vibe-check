// 4단계 [CS팀] 후기 통계
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("review-stats.json — 건수/별점 분포", () => {
  const s = readJson("review-stats.json");
  assert.equal(s.count, 400);
  assert.deepEqual(s.byRating, {
      "1": 38,
      "2": 105,
      "3": 40,
      "4": 111,
      "5": 106
  });
});

test("avgRating — 반올림이 아니라 소수 셋째 자리에서 버림", () => {
  const s = readJson("review-stats.json");
  assert.equal(s.avgRating, 3.35);
});

test("refundMentionCount — 별점과 무관하게 단어만 본다(3단계 정답과 다른 수)", () => {
  const s = readJson("review-stats.json");
  assert.equal(s.refundMentionCount, 41);
});
