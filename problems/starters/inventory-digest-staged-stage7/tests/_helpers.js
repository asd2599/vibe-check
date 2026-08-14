const { execFileSync } = require("node:child_process");
const path = require("node:path");
const WS = path.join(__dirname, "..");

// Windows에서 PowerShell 리다이렉션(`> file`)이나 Out-File/Set-Content로 텍스트를 쓰면 기본적으로
// **UTF-8 BOM(EF BB BF)**이 앞에 붙는다. JSON.parse는 BOM이 남아 있으면 내용이 완벽해도
// `SyntaxError: Unexpected token '\uFEFF'`로 죽는다.
//
// 실사용에서 이것 때문에 5단계 게이트가 막혔다(2026-08-12): expense-violations.json은 내용이
// 멀쩡했는데 BOM 하나로 파싱 단계에서 터졌고, 게이트를 "결과물만 있으면 통과"로 완화해둔 것도
// 무의미했다 — 완화된 검사에 도달하기 전에 readJson이 던져버리기 때문이다. 산출물 인코딩은
// 이 문제가 재려는 축(컨텍스트 관리)과 아무 상관이 없으므로 여기서 벗겨낸다.
function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

function runReport() {
  const out = execFileSync("node", ["report.js", "data/inventory.csv"], { cwd: WS, encoding: "utf8" });
  const lines = stripBom(out).trim().split(/\r?\n/);
  return JSON.parse(stripBom(lines[lines.length - 1]));
}
function readJson(name) {
  const fs = require("node:fs");
  const p = path.join(WS, name);
  if (!fs.existsSync(p)) throw new Error(name + " 파일이 워크스페이스 루트에 없다");
  return JSON.parse(stripBom(fs.readFileSync(p, "utf8")));
}

// 산출물이 한 겹 감싸여 있어도 벗겨낸다 — **게이트에서만 쓴다**(채점 히든은 규격대로 본다).
//
// 실사용에서 5단계가 이것 때문에 막혔다(2026-08-12): 프롬프트는 "id 배열로 주세요"였는데 산출물이
// `{"violations": ["E0003", ...]}`로 한 겹 감싸여 나왔다. **id 목록 자체는 정답과 완전히 일치**했는데
// 껍데기 하나 때문에 "배열이 아니다"로 차단됐다. JSON 껍데기 모양은 이 문제가 재려는 축(컨텍스트
// 관리)과 무관하므로, 게이트에서는 키가 하나뿐인 객체면 그 안을 들여다본다.
//
// 규격 위반 자체는 없던 일이 되지 않는다 — 완료 시점 히든 테스트가 규격대로 검사하고, LLM 채점의
// "요구사항 반영" 항목도 그대로 본다. 게이트는 "진행해도 되는가"만 판정한다.
function unwrapSingleKey(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1) return value[keys[0]];
  }
  return value;
}

// id 목록 비교 — 완전 일치가 아니라 **소량의 오차를 허용**한다(2026-08-11).
//
// 이 함수는 이제 **채점(히든 테스트)에서만** 쓰인다 — 단계 게이트는 정확도를 보지 않는다
// (2026-08-12, docs/problem-set.md의 "게이트는 진행해도 되는가만 판정하고" 절).
//
// 왜 완전 일치가 아닌가: 400건/260건짜리 원본에서 해당 id를 손으로 추려내다 보면 한두 개를 흘리는
// 일이 생긴다. 그건 "규칙을 잘못 이해했다"가 아니라 단순 누락이다. 반면 규칙 자체를 잘못 잡으면
// 오차가 두 자릿수로 벌어지므로(별점 조건만 쓰면 143건 vs 정답 23건 등) 이 정도 허용치로는 절대
// 통과하지 못한다 — 판별력은 그대로다.
const ID_TOLERANCE = 2;
function assertIdSet(actual, expected, label) {
  const assert = require("node:assert/strict");
  assert.ok(Array.isArray(actual), label + "은 문자열 배열이어야 한다");
  const A = new Set(actual);
  const E = new Set(expected);
  const missing = expected.filter((id) => !A.has(id));
  const extra = [...A].filter((id) => !E.has(id));
  assert.ok(
    missing.length <= ID_TOLERANCE && extra.length <= ID_TOLERANCE,
    label + ": 정답 " + expected.length + "건 기준 누락 " + missing.length + "건 / 오검출 " +
      extra.length + "건 (각각 " + ID_TOLERANCE + "건까지만 허용). 규칙을 다시 확인할 것.",
  );
}
module.exports = { runReport, readJson, assertIdSet, ID_TOLERANCE, stripBom, unwrapSingleKey };
