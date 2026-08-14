import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// docs/problem-set.md — 단계형 문제(stages)일 때만 쓰는 필드.
//
// 단계형 문제의 워크스페이스 생성 시(createWorkspace)에는 starterFiles만 복사된다 — 즉 1단계에
// 필요한 리소스(데이터/문서/게이트 테스트)까지 전부 starterFiles 안에 있어야 한다. 2단계부터는
// 사람이 이전 단계 게이트 테스트를 통과해야만(POST /api/runs/[id]/stage, manualRun.ts의
// submitStage()) unlockPath 디렉터리의 내용물이 워크스페이스로 복사되어 "풀린다".
export type ProblemStage = {
  index: number; // 1부터 시작. stages 배열 순서와 일치해야 한다(검증됨, loadProblem 참고).
  title: string; // 대시보드에 보여줄 짧은 라벨(예: "2단계: 구분자 확장")
  promptAddition: string; // 이전 단계 게이트를 통과했을 때 추가로 공개하는 대화 톤 텍스트
  unlockPath: string | null; // PROJECT_ROOT 기준 경로 — 이 단계가 열릴 때 워크스페이스로 복사할 디렉터리(데이터/문서 등).
  // 마지막 단계는 통과해도 더 풀어줄 게 없으므로 null이어도 된다(다음 단계가 없다는 뜻은
  // stages 배열에 다음 원소가 없다는 것 자체로 이미 표현됨 — submitStage 참고).
  gateTestCommand: string; // 이 단계를 통과했는지 판정하는 명령. 앞 단계 요구가 소급 무효화됐는지도
  // 같이 잡아내려면 누적(이전 단계 테스트 포함)으로 짜는 걸 권장한다 — docs/problem-set.md 참고.
};

// docs/problem-set.md
export type Problem = {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  // 대시보드 문제 목록의 정렬 순서(선택, 작을수록 위). 없으면 DEFAULT_LIST_ORDER로 취급되고,
  // 동점이면 id 사전순이다 — 즉 이 필드를 안 쓰는 문제들끼리는 예전과 같은 순서를 유지한다.
  // 목록의 첫 문제가 대시보드의 기본 선택값이라(src/app/page.tsx), 처음 온 사람이 밟았으면 하는
  // 워밍업 문제를 맨 위에 두는 데 쓴다.
  listOrder?: number | null;
  prompt: string;
  starterFiles: string | null;
  // 워크스페이스를 열 때 자동으로 같이 실행할 명령(선택). VS Code 자동 태스크로 뜬다
  // (manualRun.ts의 writeVsCodeAutoRunTask). 웹 문제에서 "열자마자 페이지가 이미 떠 있는" 상태를
  // 만들기 위한 것이다 — 참가자가 서버 띄우는 절차부터 배우게 하는 건 이 벤치마크의 측정 대상이
  // 아니다. 대화형 claude 세션 터미널과는 별개 터미널에서 조용히 뜬다(포커스를 뺏지 않는다).
  autoStartCommand?: string | null;
  testCommand: string | null;
  // "완료" 시점에 워크스페이스에서 실행해서, **참가자가 만든 산출물을 텍스트로 도식화**하는 명령(선택).
  // stdout이 LLM 채점 프롬프트에 "산출물 요약" 블록으로 그대로 들어간다.
  //
  // 왜 필요한가(2026-08-14, 실측 사고): 채점자는 소스만 읽는다. 산출물이 `.xlsx`처럼 바이너리면
  // 아예 못 보고, 자동 테스트는 체크리스트라 통과/실패만 갈린다. 그래서 `report-xlsx-staged`에서
  // **엑셀이 객관적으로 더 깔끔한 산출물이 점수는 더 낮게** 나왔다 — 제목/머리글 굵기, 열 너비를
  // 챙긴 쪽(스킬 사용)이 rubric 2.25~3.50, 테스트가 검사하는 열 하나만 넓힌 쪽이 4.00이었다.
  // rubric 항목이 전부 코드 위생이라 "결과물이 보기 좋은가"에 점수를 줄 경로 자체가 없었다.
  //
  // calculator-web-staged에서 화면을 실제 브라우저로 열어 잰 것과 같은 처방이다 — **결과물을
  // 실행/열어서 보여준다.** 코드가 아니라 산출물을 읽으므로 어떤 도구로 만들었는지에 중립적이다.
  // 명령은 워크스페이스 루트에서 실행되고, stdout만 쓰며, 실패해도 채점 자체는 계속된다.
  artifactSummaryCommand?: string | null;
  rubric: string[];
  // --- 사용량 하드컷 (2026-08-10 통합) ---
  //
  // **실질 하드컷은 maxCostUsd 하나다.** 화면에는 이 값을 "가중 토큰"으로 환산해서 보여준다
  // (100만 가중 토큰 = $1, pricing.ts의 USD_PER_WEIGHTED_TOKEN 참고) — 즉 사람이 보는 축과
  // 러너가 자르는 축이 같은 하나의 숫자다.
  //
  // 왜 raw 토큰이 아닌가: 구독(Max) 플랜의 사용 한도는 "토큰 개수 1:1 합"이 아니라 모델·토큰 종류로
  // 가중된 값으로 소모된다(공식 문서: 캐시 읽기는 "캐시 토큰 요율"로 한도에 잡히고, 어떤 모델인지와
  // effort 레벨이 사용량에 영향을 준다). 실측으로도 괴리가 크다 — 저장된 run 17건에서 raw 토큰
  // 1M당 비용이 $0.62~$1.58로 2.5배까지 벌어졌고, **raw 토큰이 30% 적은 run이 한도는 49% 더 많이
  // 소모한** 순위 역전까지 있었다(inventory-digest: 1,510,852토큰 $0.9362 vs 1,060,992토큰 $1.3941).
  // raw 토큰으로 자르면 "구독을 얼마나 깎아먹었나"와 다른 걸 재게 된다.
  //
  // 모델을 바꾸면 같은 작업이라도 값이 달라진다 — 버그가 아니라 의도다. 실제로 Opus로 풀면 플랜
  // 한도를 그만큼 더 쓰기 때문이다.
  maxCostUsd: number;
  maxDurationMs: number;
  // "적정 시간"(선택). 이 시간을 넘는 순간부터 종합 점수를 깎기 시작하고, maxDurationMs 에
  // 도달하면 감점이 최대가 된다(runDisplay.ts 의 computeTimePenalty). 하드컷/실격에는 전혀
  // 관여하지 않는다 — 자르는 건 여전히 maxDurationMs 하나뿐이다.
  //
  // 2026-08-11 사용자 요청으로 도입. 그전까지는 "시간은 점수에 0%"였는데(하드컷이 이미 자르니
  // 이중 벌점이라는 이유), 실측을 보니 완료된 run 23건이 전부 1~14분이라 40~120분짜리 하드컷은
  // 사실상 한 번도 작동하지 않는 장식이었다 — 즉 시간이 "무제한"과 다름없었다. 넘으면 0점(실격),
  // 그 아래는 아무 차이 없음이라는 계단식 대신, 적정선부터 완만히 깎는 방식으로 바꾼 것이다.
  // 없으면(null/undefined) 예전처럼 시간이 점수에 반영되지 않는다.
  targetDurationMs?: number | null;
  // **폭주 백스톱**(선택). 실질 하드컷은 위 maxCostUsd이고 이건 그게 무력화된 경우에만 걸리는
  // 안전장치다 — 구체적으로: 텔레메트리가 안 붙어 트랜스크립트 폴백으로 돌아갔고, 거기에 단가
  // 테이블(pricing.ts)에 없는 신모델이 섞여서 비용이 실제보다 낮게 잡히는 경우. 그때도 raw 토큰은
  // 정상 집계되므로 이 값이 마지막 방어선이 된다. 정상 동작에서는 절대 먼저 걸리지 않도록 넉넉하게
  // (실질 예산의 2배쯤) 잡는다. 없으면 백스톱 없이 비용/시간만으로 판정한다.
  maxTokens?: number | null;
  // 참고용 "합리적 기준선" — **가중 토큰 단위**다(위 maxCostUsd와 같은 눈금). 하드컷과는 별개로,
  // 결과 화면에서 "이 정도면 비효율적으로 썼다"를 가늠하고 종합 점수의 토큰효율 항목을 계산하는 데
  // 쓰이며 강제 종료나 실격에는 전혀 관여하지 않는다. 없으면 기준선 비교를 표시하지 않는다.
  //
  // 2026-08-10 이전엔 같은 값이 raw 토큰 기준이었는데, 눈금을 "전형적 run이면 가중 토큰 ≈ raw 토큰"이
  // 되도록 잡았기 때문에(pricing.ts) 기존 값을 그대로 옮겨도 의미가 거의 보존된다.
  referenceWeightedTokens?: number | null;
  // 기준선(referenceWeightedTokens)을 넘겼을 때 토큰효율 점수가 **0점에 도달하는 배율**(선택).
  // 기본값 2 = 기준선의 2배를 쓰면 0점(2026-08-12 이전의 유일한 동작). 1보다 커야 한다.
  //
  // 왜 문제별 knob인가: 문제마다 "기준선을 넘긴다"의 의미가 다르다. 어떤 문제는 기준선이 넉넉한
  // 참고선이라 2배까지 완만히 깎는 게 맞고, 어떤 문제는 **기준선을 넘겼다는 사실 자체가 측정
  // 대상의 실패**라 조금만 넘겨도 크게 깎여야 한다. 후자의 예가 inventory-digest-staged다 —
  // 그 문제가 재려는 게 정확히 "컨텍스트를 정리했는가"이고, 정리를 안 하면 기준선을 조금 넘는
  // 형태로 나타난다. 완만한 기본 곡선에서는 그 실패가 점수에 거의 안 드러났다(실측: 기준선을
  // 10% 넘긴 run이 92점). 곡선을 전역으로 가파르게 만들면 기준선이 사실상 통과 요건이 돼버려서
  // 다른 문제들의 기존 점수 체계가 통째로 흔들리므로, 문제별로 연다.
  tokenScoreZeroAtRatio?: number | null;
  // LLM 채점 평균이 품질 0%에 닿는 **하한선**(선택). 없으면 전역 기본값 3.5(runDisplay.ts의
  // JUDGE_SCORE_FLOOR).
  //
  // 왜 문제별인가 (2026-08-14, 실측): **채점자의 후함이 문제마다 다르다.** 같은 gpt-5.4-mini인데
  //   - calculator-web-staged: 한 번에 만든 평범한 구현에 4.67
  //   - report-xlsx-staged:    히든 20/20을 통과한 구현들에 3.00~3.80
  // 로 분포가 통째로 어긋난다. 루브릭 문구가 요구하는 수준이 다르기 때문이지 산출물 수준의 차이가
  // 아니다. 그래서 계산기에 맞춰 잡은 전역 3.5를 그대로 쓰면 xlsx 문제는 정상 산출물이 전부 0%가
  // 된다. 하한선은 "그 문제의 채점자가 실제로 주는 점수 분포"에 맞춰야 한다.
  judgeScoreFloor?: number | null;
  // 단계형 문제(staged)일 때만 채운다. 없으면(null/undefined) 기존처럼 prompt 하나로 끝나는
  // 단일 문제로 취급된다 — 기존 문제 포맷과 완전히 호환된다.
  stages?: ProblemStage[] | null;
  // "완료" 시점(evaluator.ts의 evaluateRun, testCommand 실행 직전)에 워크스페이스로 덮어써 넣을
  // 전체 히든 테스트 디렉터리(PROJECT_ROOT 기준 경로). 단계형 문제가 아니어도 쓸 수 있는 범용
  // 필드다 — 사람이 나중 단계를 안 풀고 중간에 "완료"를 눌러도, 못 푼 나중 단계의 테스트까지
  // 전부 포함된 완전한 스펙 기준으로 채점되게 하기 위함(그래야 일부러 쉬운 단계에서 멈추는 게
  // 이득이 안 된다). 없으면(null) 워크스페이스에 이미 있는 tests/ 그대로 채점한다(기존 동작).
  hiddenTestsPath?: string | null;
};

// __dirname 기반 계산은 CLI(tsx로 직접 실행)에서는 맞지만, Next.js(Turbopack) 서버 번들에서는
// __dirname이 실제 파일시스템 경로로 보존되지 않아(예: "C:\ROOT"로 치환) ENOENT가 난다(페이즈 6
// 대시보드 API 라우트에서 실측 확인). CLI/Next.js 서버 모두 프로젝트 루트에서 실행된다는 전제
// (package.json scripts, docs/architecture.md)는 동일하므로 process.cwd() 기준으로 바꾼다.
const PROJECT_ROOT = process.cwd();
const PROBLEMS_DIR = path.join(PROJECT_ROOT, "problems");

export function listProblemIds(): string[] {
  return readdirSync(PROBLEMS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

// listOrder를 안 쓴 문제들의 기본 순위. 지정한 문제만 그 앞으로 나오고, 나머지끼리는 예전처럼
// id 사전순을 유지한다.
const DEFAULT_LIST_ORDER = 100;

// 대시보드에 보여줄 순서대로 문제를 전부 읽어서 돌려준다(listOrder 오름차순 → id 사전순).
// 목록의 첫 문제가 곧 기본 선택값이라(src/app/page.tsx), 순서를 여기 한 곳에서만 정한다.
export function listProblemsInDisplayOrder(): Problem[] {
  return listProblemIds()
    .map((id) => loadProblem(id))
    .sort((a, b) => {
      const order = (a.listOrder ?? DEFAULT_LIST_ORDER) - (b.listOrder ?? DEFAULT_LIST_ORDER);
      return order !== 0 ? order : a.id.localeCompare(b.id);
    });
}

export function loadProblem(id: string): Problem {
  const file = path.join(PROBLEMS_DIR, `${id}.json`);
  const problem = JSON.parse(readFileSync(file, "utf8")) as Problem;

  if (problem.id !== id) {
    throw new Error(
      `${file}: id 필드("${problem.id}")가 파일명("${id}")과 일치하지 않는다`,
    );
  }
  if (!(problem.maxCostUsd > 0) || !problem.maxDurationMs) {
    throw new Error(
      `${file}: maxCostUsd(0보다 큰 값)/maxDurationMs는 필수 필드다 (docs/problem-set.md)`,
    );
  }
  if (problem.targetDurationMs != null) {
    if (!(problem.targetDurationMs > 0)) {
      throw new Error(`${file}: targetDurationMs(적정 시간)를 넣을 거면 0보다 큰 값이어야 한다`);
    }
    if (problem.targetDurationMs >= problem.maxDurationMs) {
      // 같거나 크면 감점 구간의 폭이 0 이하가 되어 계산이 의미를 잃는다(0으로 나누기 포함).
      throw new Error(
        `${file}: targetDurationMs(${problem.targetDurationMs})는 maxDurationMs(${problem.maxDurationMs})보다 작아야 한다`,
      );
    }
  }
  if (problem.judgeScoreFloor != null) {
    // 1 미만이면 채점 최저점(1)조차 0%가 안 되고, 5 이상이면 만점도 0%가 된다.
    if (!(problem.judgeScoreFloor >= 1) || !(problem.judgeScoreFloor < 5)) {
      throw new Error(
        `${file}: judgeScoreFloor(${problem.judgeScoreFloor})는 1 이상 5 미만이어야 한다 (빼면 전역 기본값 3.5)`,
      );
    }
  }
  if (problem.listOrder != null && !Number.isFinite(problem.listOrder)) {
    throw new Error(`${file}: listOrder는 숫자여야 한다(작을수록 목록 위) — 빼면 기본 순위로 취급된다`);
  }
  if (problem.maxTokens != null && !(problem.maxTokens > 0)) {
    throw new Error(
      `${file}: maxTokens(폭주 백스톱)를 넣을 거면 0보다 큰 값이어야 한다 (빼면 백스톱 없이 동작)`,
    );
  }
  if (problem.tokenScoreZeroAtRatio != null) {
    // 1 이하면 기준선 이하에서도 0점이 되어(감점 구간의 폭이 0 이하) 계산이 의미를 잃는다.
    if (!(problem.tokenScoreZeroAtRatio > 1)) {
      throw new Error(
        `${file}: tokenScoreZeroAtRatio(${problem.tokenScoreZeroAtRatio})는 1보다 커야 한다 (빼면 기본값 2 = 기준선의 2배에서 0점)`,
      );
    }
    if (problem.referenceWeightedTokens == null) {
      throw new Error(
        `${file}: tokenScoreZeroAtRatio는 referenceWeightedTokens(기준선)가 있어야 의미가 있다 — 배율의 기준이 그 값이다`,
      );
    }
  }
  if (problem.stages) {
    // 단계 수는 문제마다 다르다 — 4단계는 우연히 처음 만든 문제들이 그랬을 뿐 규칙이 아니었다
    // (2026-08-11). 러너/대시보드는 원래 stages.length 기반이라 N단계를 그대로 처리한다.
    //   하한 2: 1단계짜리는 stages를 쓸 이유가 없다. stages[0]의 promptAddition/unlockPath는
    //           애초에 읽히지 않으므로(prompt/starterFiles가 그 역할), 게이트 하나만 있는 셈이라
    //           단계형이 아닌 문제 + gateTestCommand와 다를 바가 없다.
    //   상한 10: 사람이 한 세션에서 실제로 밟을 수 있는 현실적인 상한. 넘겨야 할 이유가 생기면
    //           그때 근거와 함께 올릴 것 — 지금은 오타로 단계가 폭증하는 걸 막는 안전장치다.
    if (problem.stages.length < 2) {
      throw new Error(
        `${file}: stages는 2개 이상이어야 한다(현재 ${problem.stages.length}개). 단계가 하나뿐이면 stages를 빼고 단일 문제로 만들어라 (docs/problem-set.md)`,
      );
    }
    if (problem.stages.length > 10) {
      throw new Error(
        `${file}: stages는 10개 이하여야 한다(현재 ${problem.stages.length}개). 정말 더 필요하면 근거와 함께 상한을 올려라 (docs/problem-set.md)`,
      );
    }
    problem.stages.forEach((stage, i) => {
      if (stage.index !== i + 1) {
        throw new Error(
          `${file}: stages[${i}].index(${stage.index})가 배열 순서(${i + 1})와 일치하지 않는다`,
        );
      }
      if (!stage.gateTestCommand) {
        throw new Error(
          `${file}: stages[${i}](index=${stage.index})에 gateTestCommand가 필요하다`,
        );
      }
    });
  }

  return problem;
}

export function pickRandomProblem(): Problem {
  const ids = listProblemIds();
  if (ids.length === 0) {
    throw new Error("problems/ 에 문제 파일이 하나도 없다");
  }
  const id = ids[Math.floor(Math.random() * ids.length)];
  return loadProblem(id);
}

export function resolveProjectPath(relativePath: string): string {
  // relativePath가 동적이라 Turbopack이 프로젝트 전체를 트레이싱하려고 시도한다(빌드 경고).
  // 로컬 전용 도구라 배포 번들 크기와 무관하므로 명시적으로 무시한다.
  return path.join(/* turbopackIgnore: true */ PROJECT_ROOT, relativePath);
}

export { PROJECT_ROOT };
