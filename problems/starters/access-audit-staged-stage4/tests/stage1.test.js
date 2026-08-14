// 1단계 게이트 테스트. 실행: node --test tests/stage1.test.js
// 대상 명령: node audit.js data  (워크스페이스 루트 기준, data 디렉터리 안의 모든 .log를 처리)
// 기대 출력: stdout 마지막 줄에 JSON 한 줄.
const { run, test, assert } = require("./_runner.js");

test("1단계 - 전체 요청 수와 성공률", () => {
  const out = run();
  assert.equal(out.totalRequests, 2120);
  assert.equal(out.successRate, 69.8);
});
