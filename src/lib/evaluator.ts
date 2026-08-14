// 완료(completed)된 run에 대한 평가 로직.
// CLAUDE.md/docs/evaluation.md 원칙:
//   - "완료" 상태인 run만 평가한다. 실격/실패 run은 evaluateRun을 호출하지 않는다(미완성 코드라 무의미).
//   - 자동 테스트(runTests)와 LLM 채점(judgeWithOpenAI)은 서로 독립된 함수다 — 하나가 실패해도
//     (예: OpenAI 호출 에러) 다른 하나의 결과는 그대로 저장된다.
//   - LLM 채점은 OpenAI API를 쓴다(Claude API 아님) — 벤치마크 대상(Claude Code CLI)과 같은 벤더를
//     채점자로 쓰면 self-preferencing bias 우려가 있어 의도적으로 분리했다(docs/evaluation.md).
//   - 효율성(시간/토큰/비용, Run에 이미 저장됨)과 품질(테스트/채점)은 하나의 점수로 합치지 않는다.
//   - 채점자에게는 diff/최종 코드만 보여주고 어떤 모델이 만들었는지는 알려주지 않는다(편향 방지).

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import OpenAI from "openai";
import { copyIntoWorkspace } from "./runner";
import type { RunResult } from "./runner";
import { resolveProjectPath } from "./problems";
import type { Problem } from "./problems";

const TEST_TIMEOUT_MS = 120_000; // 테스트 명령 자체가 걸리는 시간 상한(하드컷은 러너의 몫이 아니라 여기서 독립적으로 건다)
const TEST_OUTPUT_MAX_CHARS = 4_000; // stdout+stderr truncate

// 워크스페이스에서 채점자에게 보여줄 파일을 모을 때 제외하는 디렉터리(빌드 산출물/의존성/캐시).
//
// **`.claude`를 여기 넣으면 안 된다(2026-08-11 실측으로 배운 것).** 잠깐 넣었다가 되돌렸다 —
// "참가자 하네스는 채점 대상이 아니다"는 취지였는데, 실제 run을 보니 참가자의 **산출물 자체가 거기
// 들어있었다**: 공식 xlsx 스킬을 `npx skills add` 로 설치하면 `.claude/skills/xlsx/` 가 만들어지고,
// 에이전트가 리포트 생성 스크립트(`build_report_step1~4.py`)를 그 스킬의 `scripts/` 옆에 썼다.
// 제외해버리니 채점자가 "xlsx를 생성하는 실제 로직이 없고 결과물만 있습니다"라며 6항목 중 4개에
// 1점을 줬다(테스트는 전부 통과한 run인데도). 참가자가 산출물을 **어디에 두는지는 방법마다 다르므로
// 경로로 넘겨짚지 않는다** — 대신 아래 "작은 파일부터 채우기"로 노이즈를 밀어낸다.
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  "dist",
  "build",
  ".next",
  "coverage",
  "out",
]);
// 어떤 문제에서도 "참가자가 작성한 산출물"일 수 없는 확장자 — 라이브러리/스킬을 설치하면 딸려오는
// 스키마·잠금·컴파일 산출물이다. 아래 "작은 파일부터" 규칙만으로도 큰 건 밀려나지만, OOXML 스키마는
// 작은 것도 수십 개라(실측: 워크스페이스 하나에 `.xsd` 25개) 개수로 예산을 갉아먹어서 따로 뺀다.
// 목록은 실측으로 확인된 것만 최소한으로 유지한다 — 넓게 잡으면 산출물을 가려버릴 위험이 있다.
const EXCLUDED_EXTENSIONS = new Set([".xsd", ".dtd", ".pyc", ".pyo", ".map", ".lock"]);
// 프롬프트에 넣는 소스 총량 상한(문자 기준). 넘으면 뒷부분은 자른다.
// TODO(불확실): 루브릭 항목 수가 많은 문제(예: 5개 이상)와 결합하면 프롬프트가 길어져
// 채점 품질/비용에 영향을 줄 수 있다 — 실제 문제들로 몇 번 더 돌려보고 조정 필요.
const MAX_SOURCE_CHARS_FOR_JUDGE = 60_000;
// 파일 하나가 위 총량을 독차지하지 못하게 하는 상한.
const MAX_CHARS_PER_FILE_FOR_JUDGE = 12_000;

// OpenAI 채점에 쓰는 모델. gpt-5.4-mini: 이 환경에서 확인된 최신 세대(2026-03) 라인업 중
// cost-effective한 tier — 구조화된 항목별 채점처럼 정형화된 작업에는 충분하다고 판단해 선택했다.
// (docs/evaluation.md: "채점자는 벤치마크 대상과 다른 벤더" 요구사항만 있고 특정 모델을 못박지는 않음)
const JUDGE_MODEL = "gpt-5.4-mini";

// 로컬 정가 추정치(1M 토큰당 USD) — 실제 OpenAI 청구서와 다를 수 있다(CLAUDE.md: "비용은 추정치다").
// TODO(불확실): 이 프로젝트가 가정하는 시점 기준 gpt-5.4-mini의 공식 단가를 따로 확인해서 갱신할 것.
const JUDGE_PRICE_PER_M_INPUT_TOKENS_USD = 0.15;
const JUDGE_PRICE_PER_M_OUTPUT_TOKENS_USD = 0.6;

export type TestResult = {
  ran: boolean; // testCommand가 없으면 false — 실패가 아니라 "해당 없음"
  passed: boolean | null;
  exitCode: number | null;
  output: string | null; // stdout+stderr 일부 (truncate)
};

export type JudgeItemScore = {
  criterion: string;
  score: number; // 1~5, 5가 최고
  reasoning: string;
};

export type JudgeResult = {
  scores: JudgeItemScore[];
  overallComment: string;
  model: string; // 실제로 응답한 모델명(response.model)
  inputTokens: number;
  outputTokens: number;
  costUsd: number; // 추정치 — 채점 호출 전용, 벤치마크 대상 CLI 비용과 절대 합산하지 않는다
};

export type EvaluationResult = {
  runId: string;
  test: TestResult;
  judge: JudgeResult | null; // OpenAI 호출이 실패하면 null (테스트 결과는 그대로 유지됨)
  evaluatedAt: string;
};

// 워크스페이스 안에서만 테스트 명령을 실행한다(CLAUDE.md: "실행은 항상 격리한다",
// 원본 problems/ 디렉터리는 건드리지 않는다 — cwd가 워크스페이스이므로 자동으로 보장됨).
export function runTests(
  workspacePath: string,
  testCommand: string | null,
): Promise<TestResult> {
  if (!testCommand) {
    // problem-set.md: testCommand가 없으면 자동 테스트는 건너뛴다. 실패로 취급하지 않는다.
    return Promise.resolve({ ran: false, passed: null, exitCode: null, output: null });
  }

  return new Promise((resolve) => {
    // shell: true — Windows에서 npm 등은 .cmd이고, testCommand는 "npm test"처럼 공백 포함
    // 문자열로 주어지므로 셸을 통해 그대로 실행한다.
    const child = spawn(testCommand, { cwd: workspacePath, shell: true });

    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        ran: true,
        passed: false,
        exitCode: null,
        output: (output + "\n[evaluator] 테스트 실행이 시간 초과로 강제 종료됨").slice(
          -TEST_OUTPUT_MAX_CHARS,
        ),
      });
    }, TEST_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ran: true,
        passed: code === 0,
        exitCode: code,
        output: output.slice(-TEST_OUTPUT_MAX_CHARS),
      });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ran: true,
        passed: false,
        exitCode: null,
        output: `[evaluator] spawn 에러: ${err.message}`.slice(-TEST_OUTPUT_MAX_CHARS),
      });
    });
  });
}

// readFileSync(f, "utf8")는 바이너리에도 예외를 던지지 않고 깨진 문자열을 그대로 돌려준다 —
// 실측 사고: 산출물 `output/report.xlsx`(zip 바이너리)가 깨진 텍스트로 프롬프트에 통째로 실려서
// 예산을 먹고, 채점자가 "결과 파일은 바이너리로만 첨부되어 있어 검증이 불가능합니다"라고 판단했다.
// NUL 바이트만 봐도 zip/이미지/.pyc 는 전부 걸러진다(텍스트 소스에는 NUL이 없다).
function isProbablyBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8_000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// 문제가 **제공한** 파일들의 내용 해시를 모은다(워크스페이스 기준 상대경로 → sha256).
//
// 왜 필요한가 (2026-08-13 실측 사고): 채점기가 참가자가 **손도 안 댄 입력 파일**을 읽고 그
// 지저분함을 참가자 탓으로 감점했다. `handover-relay-staged` 두 run 모두 `handover.md`(일부러
// 뒤죽박죽으로 만든 인수인계 문서) 앞부분 12,000자가 채점 프롬프트에 실렸고, 저장된 감점 사유가
// 그대로 남아 있다 — "handover.md 자체가 여러 직무 문구를 뒤섞어 서술하고 있어…"(직무 분리 2점),
// "handover.md는 매우 장황하고 반복이 많아…"(가독성 3점). 입력의 성격이 참가자 점수가 되면 품질
// 축이 오염되고, 그 위에서 돌린 A/B는 믿을 수 없는 값이 된다.
//
// **경로로 넘겨짚지 않는다**(report-xlsx 교훈: 참가자 산출물이 어디 있을지는 방법마다 다르다).
// "우리가 준 그대로 바이트가 하나도 안 바뀐 파일"만 뺀다 — 참가자가 한 글자라도 고쳤으면 그건
// 작업물이므로 그대로 채점 대상이다. 이 규칙은 방법에 중립적이고, 입력 파일을 주는 **모든 문제**의
// 채점 정확도를 같이 올린다.
function collectProvidedInputHashes(problem: Problem): Map<string, string> {
  const map = new Map<string, string>();

  // 실제 워크스페이스에 복사되는 순서 그대로 — 뒤에 복사된 것이 앞을 덮어쓴다
  // (createWorkspace: starterFiles → submitStage: unlockPath → evaluateRun: hiddenTestsPath).
  const roots: string[] = [];
  if (problem.starterFiles) roots.push(problem.starterFiles);
  for (const stage of problem.stages ?? []) {
    if (stage.unlockPath) roots.push(stage.unlockPath);
  }
  // 히든 테스트도 "우리가 준 파일"이다 — 채점 직전에 워크스페이스를 덮어쓰므로 여기 있는 tests/는
  // 참가자가 쓴 게 아니라 우리 파일이고, 채점기에 실어봐야 기대값만 새어나가고 예산만 먹는다.
  if (problem.hiddenTestsPath) roots.push(problem.hiddenTestsPath);

  for (const root of roots) {
    const abs = resolveProjectPath(root);
    if (!existsSync(abs)) continue;
    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            const rel = path.relative(abs, full).split(path.sep).join("/");
            map.set(rel, createHash("sha256").update(readFileSync(full)).digest("hex"));
          } catch {
            /* 못 읽는 파일은 그냥 후보로 남긴다 — 빼는 쪽이 아니라 넣는 쪽이 안전하다 */
          }
        }
      }
    };
    walk(abs);
  }

  return map;
}

// 워크스페이스의 최종 파일들을 "경로 헤더 + 내용" 형태의 단일 문자열로 모은다.
// 진짜 git diff 인프라는 아직 없다(대시보드 페이즈에서 다룰 예정) — 지금은 최종 파일 전체로 충분하다.
//
// providedInputs: collectProvidedInputHashes()의 결과. 바이트가 그대로인 제공 파일은 **내용을 빼고
// 목록에만** 남긴다(위 함수 주석 참고). 안 넘기면 예전처럼 전부 싣는다.
function collectWorkspaceSource(
  workspacePath: string,
  providedInputs?: Map<string, string>,
): string {
  const files: string[] = [];

  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (EXCLUDED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        files.push(path.join(dir, entry.name));
      }
    }
  }

  walk(workspacePath);

  const rel = (f: string) => path.relative(workspacePath, f).split(path.sep).join("/");
  const candidates: { rel: string; content: string }[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    let buf: Buffer;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }
    const relPath = rel(file);
    const provided = providedInputs?.get(relPath);
    if (provided && provided === createHash("sha256").update(buf).digest("hex")) {
      // 우리가 준 그대로다 — 내용은 빼고 존재만 알린다. 목록에서 아예 지우면 채점기가
      // "입력을 안 읽었다"고 넘겨짚을 수 있으므로 이름은 남긴다.
      skipped.push(`${relPath} (제공된 입력, 변경 없음)`);
      continue;
    }
    if (isProbablyBinary(buf)) {
      skipped.push(`${relPath} (바이너리, ${buf.length}바이트)`);
      continue;
    }
    candidates.push({ rel: relPath, content: buf.toString("utf8") });
  }

  // **작은 파일부터** 예산을 채운다. 순회 순서(사실상 경로 알파벳순)대로 채우면 덩치 큰 참고 자료
  // 하나가 예산을 통째로 먹고 정작 산출물이 채점자에게 도달하지 못한다 — 실측: 공식 xlsx 스킬을
  // 설치한 워크스페이스에는 OOXML 스키마가 딸려오는데 `sml.xsd` 하나가 246KB, `dml-main.xsd`가
  // 155KB인 반면 참가자가 실제로 짠 생성 스크립트는 712~1,770바이트였다. 크기순으로 채우면 그런
  // 스키마 파일은 자연히 뒤로 밀리고, 어디에 뒀든 실제 산출물이 먼저 들어간다(경로로 넘겨짚지
  // 않으므로 방법에 중립적이다).
  candidates.sort((a, b) => a.content.length - b.content.length || a.rel.localeCompare(b.rel));

  // 내용이 잘리더라도 **파일 목록 전체**는 먼저 보여준다. 목록이 없으면 채점자가 "생성 로직이 아예
  // 없다"고 단정해버리는 오판이 생긴다(실측 사고 그대로).
  const tree = candidates
    .map((c) => `  ${c.rel} (${c.content.length}자)`)
    .concat(skipped.map((s) => `  ${s} — 내용 생략`))
    .join("\n");

  let combined = `워크스페이스 파일 목록:\n${tree}\n`;
  const omitted: string[] = [];
  for (const c of candidates) {
    if (combined.length > MAX_SOURCE_CHARS_FOR_JUDGE) {
      omitted.push(c.rel);
      continue;
    }
    const content =
      c.content.length > MAX_CHARS_PER_FILE_FOR_JUDGE
        ? c.content.slice(0, MAX_CHARS_PER_FILE_FOR_JUDGE) + "\n... (이하 생략 — 파일이 길어서 잘림)"
        : c.content;
    combined += `\n--- ${c.rel} ---\n${content}\n`;
  }
  if (omitted.length > 0) {
    combined += `\n(분량 제한으로 내용을 싣지 못한 파일: ${omitted.join(", ")})\n`;
  }

  return combined;
}

function estimateJudgeCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * JUDGE_PRICE_PER_M_INPUT_TOKENS_USD +
    (outputTokens / 1_000_000) * JUDGE_PRICE_PER_M_OUTPUT_TOKENS_USD
  );
}

// OpenAI structured output(JSON schema, strict mode)으로 루브릭 항목별 점수를 강제 파싱 가능한
// 형태로 받는다. 채점자에게는 코드 내용만 전달하고, 어떤 모델/도구가 만들었는지는 알려주지 않는다.
export async function judgeWithOpenAI(
  workspacePath: string,
  rubric: string[],
  // 자동 테스트 결과를 채점자에게 알려준다. 안 알려주면 채점자가 **이미 결정론적으로 확정된 사실을
  // 소스만 보고 다시 추측해서 뒤집는다** — 실측 사고: 히든 테스트를 20/20 통과한 run인데 "수식 셀에
  // 캐시값이 들어있는가" 항목에 1점을 줬다("셀 타입 처리가 불완전해 보인다"는 추측). 테스트가 재는
  // 것과 채점자가 재는 것을 겹치게 두면 이런 오판만 늘어난다.
  //
  // ⚠️ 반대 방향의 사고도 실측으로 겪었다(2026-08-14, calculator-web-staged run c3f5bfff). 이 안내가
  // "결과물이 요구 사양대로 나왔다는 건 확정된 사실"이라고 **너무 넓게** 말하고 있어서, 자동 테스트가
  // 산출물의 일부(`calc.js`의 evaluate)만 실행하는 문제에서 채점자가 **테스트가 건드리지도 않은 화면
  // 코드까지 통과한 셈 치고** 후하게 줬다. 실제로는 화면의 과학 계산 버튼 전부가 이벤트 리스너 셀렉터
  // 밖에 있어 클릭해도 아무 일이 없었는데(`#sciPad` vs `#pad`) 그 항목이 4점을 받았고 최종 90점이 나왔다.
  // 그래서 지금은 "테스트가 실행한 부분만 확정"이라고 범위를 좁히고, 테스트가 안 닿는 영역은 오히려
  // 직접 확인하라고 명시한다.
  testOutcome?: { ran: boolean; passed: boolean | null },
  // 문제가 제공한 파일들의 해시. 바이트가 그대로인 입력 파일을 채점 프롬프트에서 빼는 데 쓴다
  // (collectProvidedInputHashes 주석의 실측 사고 참고). 안 넘기면 예전 동작 그대로.
  providedInputs?: Map<string, string>,
): Promise<JudgeResult> {
  const client = new OpenAI(); // OPENAI_API_KEY 환경변수를 그대로 사용

  const code = collectWorkspaceSource(workspacePath, providedInputs);
  // 번호를 붙이면 모델이 criterion에 번호까지 그대로 되돌려주는 경우가 있어(실측 확인),
  // 매칭용 원문이 오염되지 않도록 번호 없이 항목 문구만 나열한다.
  const rubricList = rubric.map((item) => `- ${item}`).join("\n");

  const schema = {
    type: "object",
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            criterion: { type: "string", description: "채점 대상 루브릭 항목(입력받은 문구 그대로)" },
            score: { type: "integer", enum: [1, 2, 3, 4, 5] },
            reasoning: { type: "string" },
          },
          required: ["criterion", "score", "reasoning"],
          additionalProperties: false,
        },
      },
      overallComment: { type: "string" },
    },
    required: ["scores", "overallComment"],
    additionalProperties: false,
  } as const;

  const response = await client.chat.completions.create({
    model: JUDGE_MODEL,
    messages: [
      {
        role: "system",
        content:
          "너는 코드 리뷰어다. 아래 코드를 주어진 루브릭 항목별로 1~5점(5가 최고)으로 채점해라. " +
          "각 항목마다 간단한 근거를 남기고, scores 배열의 criterion에는 주어진 루브릭 문구를 그대로 반복해라. " +
          "이 코드를 어떤 도구나 모델이 작성했는지는 알 수 없고 채점과 무관하다 — 코드 자체의 품질만 보고 판단해라. " +
          // 같은 결과를 내는 길이 여러 개인 문제(예: 어떤 언어/라이브러리로 문서를 생성하든 무방한
          // 경우)에서, 채점자가 특정 스택을 선호해 점수를 갈라놓지 않게 명시한다. 방법의 차이는
          // 품질 축이 아니라 효율 축(시간/가중 토큰)과 사후 관찰로 본다 — docs/evaluation.md.
          "언어/라이브러리/접근 방식 선택 자체는 채점 대상이 아니다 — 루브릭 항목이 요구하는 결과를 " +
          "달성했는지만 보고, 특정 스택을 선호하지 마라." +
          (testOutcome?.ran && testOutcome.passed
            ? " 참고: 이 산출물은 별도의 자동 테스트를 전부 통과했다 — **그 테스트가 실제로 실행한 " +
              "부분**은 확정된 사실이니 소스만 보고 다시 의심하거나 그 이유로 감점하지 마라. " +
              "다만 자동 테스트가 산출물 전체를 덮는다는 뜻은 절대 아니다. 루브릭 항목이 자동 테스트가 " +
              "실행하지 않는 영역(화면/DOM 상호작용, 이벤트 배선, 문서, 재현성 등)을 묻고 있다면, " +
              "그건 '테스트를 통과했으니 괜찮겠지'로 넘기지 말고 **소스에서 직접 확인해서** 판단해라 — " +
              "그 영역이야말로 네가 채점해야 하는 부분이다."
            : "") +
          " 소스가 일부만 주어질 수 있다(분량 제한). 맨 앞의 파일 목록을 먼저 보고, 내용이 안 실린 " +
          "파일이 있다면 '코드가 존재하지 않는다'고 단정하지 마라.",
      },
      {
        role: "user",
        content: `루브릭:\n${rubricList}\n\n코드:\n${code}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "rubric_scores", strict: true, schema },
    },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("[evaluator] OpenAI 응답에 content가 없다");
  }

  const parsed = JSON.parse(raw) as { scores: JudgeItemScore[]; overallComment: string };
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;

  return {
    scores: parsed.scores,
    overallComment: parsed.overallComment,
    model: response.model,
    inputTokens,
    outputTokens,
    costUsd: estimateJudgeCostUsd(inputTokens, outputTokens),
  };
}

// runTests + judgeWithOpenAI를 조합해서 Evaluation 레코드를 만들고 저장까지 하는 함수.
// completed가 아닌 run은 애초에 호출하지 말 것(runner.ts main()에서 상태를 먼저 확인).
export async function evaluateRun(
  result: RunResult,
  problem: Problem,
): Promise<EvaluationResult> {
  if (result.status !== "completed") {
    throw new Error(
      `[evaluator] "완료" 상태인 run만 평가한다 — 받은 상태: ${result.status} (docs/evaluation.md)`,
    );
  }

  // 단계형 문제에서 사람이 뒷 단계를 안 풀고 일찍 "완료"를 눌렀어도, 못 푼 단계의 테스트까지
  // 전부 포함된 완전한 스펙 기준으로 채점되게 워크스페이스의 테스트를 히든 테스트 전체로 덮어쓴다
  // (problem-set.md — 안 그러면 일부러 쉬운 단계에서 멈추는 게 점수상 이득이 돼버린다). 이 필드가
  // 없는 문제(hiddenTestsPath: null/undefined)는 기존 동작 그대로(워크스페이스에 있는 tests/로 채점).
  if (problem.hiddenTestsPath) {
    copyIntoWorkspace(result.workspacePath, resolveProjectPath(problem.hiddenTestsPath));
  }

  const test = await runTests(result.workspacePath, problem.testCommand);

  let judge: JudgeResult | null = null;
  try {
    judge = await judgeWithOpenAI(
      result.workspacePath,
      problem.rubric,
      { ran: test.ran, passed: test.passed },
      collectProvidedInputHashes(problem),
    );
  } catch (err) {
    // LLM 채점 실패가 자동 테스트 결과 저장을 막으면 안 된다 — 두 축은 독립적으로 기록한다.
    console.error("[evaluator] LLM 채점 실패, judge는 null로 기록됨:", err);
  }

  const evaluation: EvaluationResult = {
    runId: result.runId,
    test,
    judge,
    evaluatedAt: new Date().toISOString(),
  };

  const { saveEvaluation } = await import("./db");
  await saveEvaluation(evaluation);

  return evaluation;
}
