// 5단계 [데이터팀] 반려 대상 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

test("rejected-requests.json — 반려 목록이 채워져 있는가", () => {
  const r = unwrapSingleKey(readJson("rejected-requests.json"));
  assert.ok(Array.isArray(r), "rejected-requests.json은 문자열 배열이어야 한다");
  assert.ok(r.length > 0, "반려 건이 하나도 없다");
  assert.ok(r.every((v) => typeof v === "string"), "배열 원소는 신청서 id 문자열이어야 한다");
});
