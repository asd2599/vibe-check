// 4단계 게이트 테스트. 실행: node --test tests/stage4.test.js
// 대상 명령: node audit.js data  (워크스페이스 루트 기준, data 디렉터리 안의 모든 .log를 처리)
// 기대 출력: stdout 마지막 줄에 JSON 한 줄.
const { run, test, assert } = require("./_runner.js");

test("4단계 - 이상 사용자 목록", () => {
  const out = run();
  assert.deepEqual([...out.anomalousUsers].sort(), ["u_00402","u_00404","u_00407","u_00410","u_00412","u_00413","u_00420","u_00422","u_00423","u_00426","u_00430","u_00431","u_00432"]);
});
