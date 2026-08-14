// 3단계 [CS팀] 환불/교환 요청 후기 추출 — **게이트(통과용) 판정**
//
// 이 파일은 "다음 단계로 넘어가도 되는가"만 본다. 정확도 채점이 아니다.
//
// 왜 느슨한가(2026-08-12): 원래 이 게이트는 정답 23건과 ±2건까지만 허용하는 정확도 검사였는데,
// 실사용에서 3·4단계에서 막혀 뒤 단계를 아예 못 밟는 일이 잦았다. 이 문제가 재려는 건
// **"직무가 바뀔 때 컨텍스트를 정리했는가"**이고, 그건 7단계까지 실제로 진행해야만 드러난다
// (5단계에서 후기 데이터가 죽고, 7단계에서 1·2단계 규칙을 다시 써야 한다). 3단계에서 막히면
// 측정 자체가 시작도 못 하고 끝난다.
//
// 그래서 판정을 두 곳으로 나눴다:
//   - **게이트(이 파일)**: 결과물이 "있는가"만 본다. 없거나 형태가 아예 아니면 막고, 그게 아니면 통과.
//   - **채점(히든 테스트)**: 완료 시점에 hiddenTestsPath가 이 파일을 정확도 검사 버전으로 덮어쓴다.
//     정확도는 거기서 본다 — 미흡하면 통과는 하되 점수에서 그만큼 깎인다.
//
// 부수 효과 하나: 예전 게이트는 정답 id 23개를 그대로 담고 있었고, 이 파일이 참가자 워크스페이스로
// 복사되므로 **정답이 워크스페이스에 노출돼 있었다.** 형태 검사로 바뀌면서 그 노출이 사라졌다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

test("refund-requests.json — 결과물이 존재하고 후기 id 목록 형태인가", () => {
  // 파일이 없으면 readJson이 던진다 = "결과물이 아무것도 없다" → 막는다.
  // 한 겹 감싸여 있어도(예: {"ids": [...]}) 벗겨서 본다 — _helpers.js의 unwrapSingleKey 주석 참고.
  const ids = unwrapSingleKey(readJson("refund-requests.json"));

  assert.ok(Array.isArray(ids), "refund-requests.json은 id 문자열 배열이어야 한다");
  assert.ok(ids.length > 0, "refund-requests.json이 비어 있다 — 조건에 맞는 후기를 골라 담아라");
  assert.ok(
    ids.every((id) => typeof id === "string"),
    "refund-requests.json의 원소는 전부 문자열 id여야 한다",
  );
  // 후기 id 형식(R + 숫자)만 확인한다. 어떤 id가 정답인지는 여기서 보지 않는다 —
  // 실제 데이터를 안 보고 아무 문자열이나 채워 넣는 것만 걸러내는 최소 검사다.
  const bad = ids.filter((id) => !/^R\d+$/.test(id));
  assert.equal(
    bad.length,
    0,
    `후기 id 형식이 아닌 값이 섞여 있다: ${bad.slice(0, 5).join(", ")} (예상 형식: R001)`,
  );
});
