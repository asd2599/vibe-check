// 2단계 [인프라팀] 스테이징 나머지 + 운영 설정 — **채점**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("config.json — 스테이징 호스트/헬스 경로/캐시 만료", () => {
  const c = readJson("config.json");
  assert.equal(c.stagingHost, "stg-edge-07.internal", "stagingHost");
  assert.equal(c.healthPath, "/__alive", "healthPath");
  assert.equal(c.cacheTtlSeconds, 45, "cacheTtlSeconds");
});

test("prod-config.json — 운영 설정 6개", () => {
  const p = readJson("prod-config.json");
  assert.equal(p.port, 443, "port");
  assert.equal(p.dbSchema, "prod_core_r2", "dbSchema");
  assert.equal(p.retryLimit, 6, "retryLimit");
  assert.equal(p.host, "prod-edge-01.internal", "host");
  assert.equal(p.healthPath, "/health-check", "healthPath");
  assert.equal(p.cacheTtlSeconds, 1800, "cacheTtlSeconds");
});
