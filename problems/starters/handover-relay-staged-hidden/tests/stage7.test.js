// 7단계 [인프라팀 복귀] 배포 체크리스트 — **채점**
// 앞 블록에서 확정한 값을 교차 참조해야 한다: 스테이징 설정(1·2단계), 운영 스키마(2단계),
// 최다 원인 코드(3단계). rollbackTag만 handover.md에서 새로 찾는다(이것도 3번 나온다).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("deploy-checklist.json — 확정값 교차 참조 + 롤백 태그", () => {
  const r = readJson("deploy-checklist.json");
  assert.equal(
    r.healthCheckUrl,
    "http://stg-edge-07.internal:7443/__alive",
    "healthCheckUrl",
  );
  assert.equal(r.dbSchema, "stg_core_v3", "dbSchema");
  assert.equal(r.retryLimit, 2, "retryLimit");
  assert.equal(r.cacheTtlSeconds, 45, "cacheTtlSeconds");
  assert.equal(r.rollbackTag, "hotfix-0217", "rollbackTag");
  assert.equal(r.prodDbSchema, "prod_core_r2", "prodDbSchema");
  assert.equal(r.topCause, "NETWORK_ERR", "topCause");
});
