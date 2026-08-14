// 3단계 [결제팀] 원인별 집계 — **채점**
// 같은 원인이 공백/하이픈/밑줄/대소문자만 다른 표기로 흩어져 있다. 구분자를 없애고 대소문자를
// 무시하면 정확히 5개 코드로 합쳐진다. 소문자화만 하면 20가지로 갈라져서 걸린다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("payment-causes.json — 정식 코드 5개로 합친 건수", () => {
  assert.deepEqual(readJson("payment-causes.json"), {
    "CARD_LIMIT": 55,
    "EXPIRED_CARD": 60,
    "NETWORK_ERR": 116,
    "AUTH_FAIL": 49,
    "NO_FUNDS": 43
  });
});
