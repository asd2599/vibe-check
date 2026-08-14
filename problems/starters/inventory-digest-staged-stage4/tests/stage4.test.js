// 4단계 [CS팀] 후기 통계 — **게이트(통과용) 판정**
//
// 이 파일은 "다음 단계로 넘어가도 되는가"만 본다. 정확도 채점이 아니다.
// 느슨하게 만든 이유와 게이트/채점 분리 구조는 stage3.test.js 상단 주석 참고(2026-08-12).
//
// 정확한 값(count 400, 별점 분포, avgRating 버림 규칙, refundMentionCount 41)은
// 완료 시점에 hiddenTestsPath가 이 파일을 덮어쓰면서 채점된다 — 여기서는 보지 않는다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

test("review-stats.json — 결과물이 존재하고 통계 4개 항목을 담고 있는가", () => {
  // 파일이 없으면 readJson이 던진다 = "결과물이 아무것도 없다" → 막는다.
  const s = unwrapSingleKey(readJson("review-stats.json"));

  assert.ok(s && typeof s === "object" && !Array.isArray(s), "review-stats.json은 객체여야 한다");

  for (const key of ["count", "byRating", "avgRating", "refundMentionCount"]) {
    assert.ok(key in s, `review-stats.json에 ${key} 항목이 없다`);
  }

  assert.ok(
    typeof s.count === "number" && s.count > 0,
    "count는 0보다 큰 숫자여야 한다(후기를 한 건도 못 셌다면 데이터를 안 읽은 것이다)",
  );
  assert.ok(
    s.byRating && typeof s.byRating === "object" && !Array.isArray(s.byRating),
    "byRating은 별점을 키로 하는 객체여야 한다",
  );
  assert.ok(
    Object.values(s.byRating).some((v) => typeof v === "number" && v > 0),
    "byRating이 비어 있다 — 별점 분포를 세어 담아라",
  );
  assert.ok(
    typeof s.avgRating === "number" && s.avgRating >= 1 && s.avgRating <= 5,
    "avgRating은 1~5 사이의 숫자여야 한다",
  );
  assert.ok(
    typeof s.refundMentionCount === "number" && s.refundMentionCount >= 0,
    "refundMentionCount는 0 이상의 숫자여야 한다",
  );
});
