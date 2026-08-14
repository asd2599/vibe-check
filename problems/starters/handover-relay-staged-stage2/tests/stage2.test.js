// 2단계 [인프라팀] 스테이징 나머지 + 운영 설정 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("config.json — 호스트/헬스 경로/캐시 만료가 채워져 있는가", () => {
  const c = readJson("config.json");
  assert.equal(typeof c.stagingHost, "string", "stagingHost는 문자열이어야 한다");
  assert.ok(c.stagingHost.trim().length > 0, "stagingHost가 비어 있다");
  assert.equal(typeof c.healthPath, "string", "healthPath는 문자열이어야 한다");
  assert.ok(c.healthPath.startsWith("/"), "healthPath는 /로 시작해야 한다");
  assert.equal(typeof c.cacheTtlSeconds, "number", "cacheTtlSeconds는 숫자여야 한다");
  assert.ok(c.cacheTtlSeconds > 0, "cacheTtlSeconds는 0보다 커야 한다");
});

test("prod-config.json — 운영 설정 6개가 채워져 있는가", () => {
  const p = readJson("prod-config.json");
  assert.ok(p && typeof p === "object" && !Array.isArray(p), "prod-config.json은 JSON 객체여야 한다");
  assert.equal(typeof p.port, "number", "port는 숫자여야 한다");
  assert.equal(typeof p.dbSchema, "string", "dbSchema는 문자열이어야 한다");
  assert.equal(typeof p.retryLimit, "number", "retryLimit는 숫자여야 한다");
  assert.equal(typeof p.host, "string", "host는 문자열이어야 한다");
  assert.equal(typeof p.healthPath, "string", "healthPath는 문자열이어야 한다");
  assert.equal(typeof p.cacheTtlSeconds, "number", "cacheTtlSeconds는 숫자여야 한다");
});
