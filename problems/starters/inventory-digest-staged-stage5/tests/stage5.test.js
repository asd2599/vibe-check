// 5단계 [회계팀] 경비 규정 위반 검출 — **게이트(통과용) 판정**
//
// 이 파일은 "다음 단계로 넘어가도 되는가"만 본다. 정확도 채점이 아니다.
// 경계값 함정(식대는 1인당 / 교통비는 20,000원 이하 영수증 면제 / 접대비는 총액 / 비품은 예외)이
// 맞았는지는 완료 시점에 hiddenTestsPath가 이 파일을 덮어쓰면서 채점된다.
//
// 게이트/채점을 나눈 이유는 stage3.test.js 상단 주석 참고(2026-08-12).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

test("expense-violations.json — 결과물이 존재하고 경비 id 목록 형태인가", () => {
  // 파일이 없으면 readJson이 던진다 = "결과물이 아무것도 없다" → 막는다.
  // 한 겹 감싸여 있어도(예: {"violations": [...]}) 벗겨서 본다 — 실사용에서 이것 때문에 막혔다.
  const ids = unwrapSingleKey(readJson("expense-violations.json"));

  assert.ok(Array.isArray(ids), "expense-violations.json은 id 문자열 배열이어야 한다");
  assert.ok(ids.length > 0, "expense-violations.json이 비어 있다 — 규정 위반 항목을 골라 담아라");
  assert.ok(
    ids.every((id) => typeof id === "string"),
    "expense-violations.json의 원소는 전부 문자열 id여야 한다",
  );
  // 경비 id 형식(E + 숫자)만 확인한다. 어떤 id가 위반인지는 여기서 보지 않는다.
  const bad = ids.filter((id) => !/^E\d+$/.test(id));
  assert.equal(
    bad.length,
    0,
    `경비 id 형식이 아닌 값이 섞여 있다: ${bad.slice(0, 5).join(", ")} (예상 형식: E0001)`,
  );
});
