// 3단계 게이트 테스트. 실행: node --test tests/stage3.test.js
// 대상 명령: node audit.js data  (워크스페이스 루트 기준, data 디렉터리 안의 모든 .log를 처리)
// 기대 출력: stdout 마지막 줄에 JSON 한 줄.
const { run, test, assert } = require("./_runner.js");

test("3단계 - 엔드포인트별 p90 응답시간", () => {
  const out = run();
  assert.deepEqual(out.p90ByEndpoint, {
    "DELETE /api/orders/{id}": 1617,
    "GET /api/inventory": 1602,
    "GET /api/orders": 1681,
    "GET /api/orders/{id}": 1602,
    "GET /api/reports/daily": 1637,
    "POST /api/auth/login": 1592,
    "POST /api/orders": 1563,
    "PUT /api/inventory/{sku}": 1599
  });
});
