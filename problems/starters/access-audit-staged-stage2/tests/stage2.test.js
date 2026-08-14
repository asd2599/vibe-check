// 2단계 게이트 테스트. 실행: node --test tests/stage2.test.js
// 대상 명령: node audit.js data  (워크스페이스 루트 기준, data 디렉터리 안의 모든 .log를 처리)
// 기대 출력: stdout 마지막 줄에 JSON 한 줄.
const { run, test, assert } = require("./_runner.js");

test("2단계 - 세션 수", () => {
  const out = run();
  assert.equal(out.sessionCount, 360);
});

test("2단계 - 1단계 결과가 새 로그 파일까지 반영돼야 한다", () => {
  const out = run();
  assert.equal(out.totalRequests, 1128);
  assert.equal(out.successRate, 70.5);
});
