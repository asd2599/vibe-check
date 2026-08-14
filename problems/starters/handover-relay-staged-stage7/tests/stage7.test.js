// 7단계 [인프라팀 복귀] 배포 체크리스트 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("deploy-checklist.json — 항목이 채워져 있는가", () => {
  const r = readJson("deploy-checklist.json");
  assert.ok(r && typeof r === "object" && !Array.isArray(r), "deploy-checklist.json은 JSON 객체여야 한다");
  // 스킴(http/https)까지 보지 않는다 — 그건 형태가 아니라 **값** 판단이고, 게이트는 실패 이유를
  // 알려주지 않으므로 마지막 단계에서 이유 없이 막히면 참가자만 헤맨다.
  assert.ok(/^https?:\/\/.+:\d+\/.+/.test(r.healthCheckUrl || ""), "healthCheckUrl은 호스트/포트/경로가 다 들어간 URL이어야 한다");
  assert.equal(typeof r.dbSchema, "string", "dbSchema는 문자열이어야 한다");
  assert.equal(typeof r.retryLimit, "number", "retryLimit는 숫자여야 한다");
  assert.equal(typeof r.cacheTtlSeconds, "number", "cacheTtlSeconds는 숫자여야 한다");
  assert.equal(typeof r.rollbackTag, "string", "rollbackTag는 문자열이어야 한다");
  assert.ok(r.rollbackTag.trim().length > 0, "rollbackTag가 비어 있다");
  assert.equal(typeof r.prodDbSchema, "string", "prodDbSchema는 문자열이어야 한다");
  assert.equal(typeof r.topCause, "string", "topCause는 문자열이어야 한다");
});
