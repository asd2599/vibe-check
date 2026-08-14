// 화면 채점 — 실제 브라우저를 띄워 **버튼을 진짜로 클릭**하고 `#result` 를 읽는다.
//
// `final.test.js` 가 `calc.js` 의 evaluate() 를 보는 것과 짝을 이룬다. 계산 함수가 아무리 정확해도
// 화면에서 못 쓰면 계산기가 아니다 — 실측 사고(run c3f5bfff)에서 이벤트 리스너 셀렉터가 일부 버튼
// 영역을 빠뜨려 괄호·루트·로그 버튼이 전부 무반응이었는데 calc.js 테스트는 7/7 통과했고 소스를 읽는
// LLM 채점자도 두 번 다 못 잡았다. 그래서 이 축만은 결정론적으로 잰다.
//
// 참가자에게는 화면 규약이 채팅으로 못박혀 있다(문제의 prompt / 3·6단계 promptAddition):
//   - 결과는 `id="result"` 요소 안에 값만 텍스트로
//   - 버튼마다 `data-key` 속성 (숫자 0~9, `.`, `+ - * / %`, `(` `)`, `=`, 전체 지우기 `clear`)
// 마크업 구조·프레임워크·라벨은 자유다 — 규약은 "어디를 눌러 어디를 읽는가"뿐이다.
//
// **버튼을 못 찾으면 라벨 텍스트로 폴백한다(2026-08-14, 실사용 실패 후 추가).** `data-key`를 안 단
// 산출물이 나왔는데(키패드를 배열에서 동적으로 만들며 라벨만 넣었다) **계산기 자체는 멀쩡히 동작**해서,
// 그대로 두면 "화면은 잘 되는데 계속 실패"가 된다 — 측정하려는 건 화면이 동작하는가지 속성 이름을
// 지켰는가가 아니다. 그래서 `data-key`를 먼저 보고, 없으면 사람이 하듯 **버튼에 쓰인 글자로** 찾는다
// (`×`/`*`, `÷`/`/`, `−`/`-`, `AC`/`C`/`clear` 같은 흔한 표기를 전부 받는다).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInPage, serveWorkspace } from "./chrome.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 클릭 순서(등호는 각 시퀀스 뒤에 자동으로 눌린다). 애매함이 없는 것만 화면에서 잰다 —
// 루트/로그는 "9 누르고 √" 인지 "√ 누르고 9" 인지가 구현마다 갈려서 calc.js 쪽에만 남겨뒀다.
const SEQUENCES = {
  "괄호와 우선순위": { keys: ["(", "2", "+", "3", ")", "*", "4"], want: "20" },
  "나머지 연산": { keys: ["7", "%", "3"], want: "1" },
  "0으로 나누기": { keys: ["5", "/", "0"], want: "Error" },
  "소수점 정리": { keys: ["0", ".", "1", "+", "0", ".", "2"], want: "0.3" },
};

// data-key가 없을 때 라벨로 찾기 위한 표기 후보(앞에 있을수록 우선). 계산기에서 관습적으로 쓰는
// 표기만 넣는다 — 여기 없는 아이콘/이모지로만 만든 버튼은 data-key를 달아야 찾을 수 있다.
const LABEL_ALIASES = {
  "0": ["0"], "1": ["1"], "2": ["2"], "3": ["3"], "4": ["4"],
  "5": ["5"], "6": ["6"], "7": ["7"], "8": ["8"], "9": ["9"],
  ".": [".", "·"],
  "+": ["+"],
  "-": ["-", "−", "–"],
  "*": ["*", "×", "✕", "✖"],
  "/": ["/", "÷"],
  "%": ["%", "mod"],
  "(": ["("],
  ")": [")"],
  "=": ["="],
  clear: ["AC", "C", "CE", "clear", "Clear", "전체 지우기", "지우기", "초기화"],
};

// 화면이 준비됐는지 — 결과 표시 자리와 버튼들이 실제로 렌더링됐는지만 본다(키패드를 스크립트로
// 그려내는 구현이 많아서, 마크업에 버튼이 박혀 있는지로 판단하면 안 된다).
const READY =
  `document.readyState === 'complete' && !!document.querySelector('#result') && ` +
  `document.querySelectorAll('button, [role="button"], input[type="button"]').length >= 10`;

const SCRIPT = `(() => {
  const aliases = ${JSON.stringify(LABEL_ALIASES)};

  const clickable = () =>
    Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
  const labelOf = (el) => ((el.textContent || el.value || "").trim());

  const findKey = (k) => {
    const byAttr = document.querySelector('[data-key="' + k + '"]');
    if (byAttr) return byAttr;
    for (const label of (aliases[k] || [k])) {
      const hit = clickable().find((el) => labelOf(el) === label);
      if (hit) return hit;
    }
    return null;
  };

  const press = (k) => {
    const el = findKey(k);
    if (!el) throw new Error('"' + k + '" 버튼을 화면에서 찾을 수 없다 (data-key도 없고 라벨로도 못 찾음)');
    el.click();
  };
  const read = () => {
    const el = document.querySelector("#result");
    if (!el) throw new Error('id="result" 요소를 찾을 수 없다');
    return (el.textContent || "").replace(/\\s+/g, "").replace(/^=/, "");
  };

  const out = {};
  for (const [name, seq] of Object.entries(${JSON.stringify(SEQUENCES)})) {
    press("clear");
    for (const k of seq.keys) press(k);
    press("=");
    out[name] = read();
  }
  return out;
})()`;

test("화면: 버튼을 눌러서 실제로 계산이 되는가", async () => {
  const { server, port } = await serveWorkspace(workspaceRoot);
  let results;
  try {
    results = await runInPage(`http://127.0.0.1:${port}/`, SCRIPT, { readyExpression: READY });
  } finally {
    server.close();
  }

  for (const [name, seq] of Object.entries(SEQUENCES)) {
    assert.equal(
      results[name],
      seq.want,
      `${name}: 버튼 ${seq.keys.join(" ")} = 을 순서대로 클릭했을 때 #result 가 ` +
        `${JSON.stringify(seq.want)} 여야 하는데 ${JSON.stringify(results[name])} 였다`,
    );
  }
});
