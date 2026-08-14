// 클라이언트 컴포넌트가 API 라우트(JSON) 응답을 받을 때 쓰는 타입.
// Prisma 모델(src/lib/db.ts)의 Date 필드는 JSON 직렬화되면서 string(ISO)이 된다는 점만 다르다.

export type RunStatus = "completed" | "disqualified" | "failed";
// cost_limit은 수동 모드 전용(2026-08-10) — 구독 플랜의 사용 한도가 토큰 1:1 합이 아니라
// 모델·토큰 종류로 가중된 값으로 소모되기 때문에 둔 두 번째 하드컷이다(src/lib/problems.ts 참고).
export type DisqualifyReason = "token_limit" | "time_limit" | "cost_limit";

// 하네스가 보고하는 사용량 수치의 출처. "telemetry"면 측정 대상 CLI가 OpenTelemetry로 직접 보고한
// 공식 값(배경 호출·/compact 실제 비용 포함), "transcript"면 세션 .jsonl을 폴링해 환산한 예전 추정치다.
export type UsageSource = "telemetry" | "transcript";

export type EvaluationDTO = {
  id: string;
  runId: string;
  testPassed: boolean | null;
  testOutput: string | null;
  testExitCode: number | null;
  judgeScores: unknown;
  judgeOverallComment: string | null;
  judgeModel: string | null;
  judgeCostUsd: number | null;
  judgeInputTokens: number | null;
  judgeOutputTokens: number | null;
  evaluatedAt: string;
};

export type RunMode = "auto" | "manual";

export type RunDTO = {
  id: string;
  status: RunStatus;
  mode: RunMode;
  problemId: string;
  workspacePath: string;
  startedAt: string;
  durationMs: number;
  rateLimitStatus: string | null;

  exitCode: number | null;
  sessionId: string | null;
  resultText: string | null;
  numTurns: number | null;
  totalCostUsdEstimate: number | null;
  usageInputTokens: number | null;
  usageOutputTokens: number | null;
  usageCacheCreationInputTokens: number | null;
  usageCacheReadInputTokens: number | null;
  cliReportedDurationMs: number | null;

  // 사람이 단계를 다 통과하지 못한 채 "포기"로 끝낸 run인지(2026-08-12). status는 completed이고
  // 채점도 정상 수행되지만, 이력에서 "끝까지 풀고 자동 완료된 run"과 구분해 보여준다.
  abandoned: boolean;
  disqualifyReason: DisqualifyReason | null;
  harnessEstimateTokens: number | null;
  harnessEstimateElapsedMs: number | null;
  // 비용 축(2026-08-07, mode=manual 전용). 마이그레이션 이전 run에는 없으므로 전부 nullable이다.
  // harnessEstimateUsageByModel이 원자료(모델별 × 토큰종류별 사용량)이고, 화면에서는 여기에
  // 현재 단가 테이블(src/lib/pricing.ts)을 다시 곱해서 보여준다.
  harnessEstimateCostUsd: number | null;
  harnessEstimateUsageByModel: unknown;
  harnessEstimateCompactTokens: number | null;

  signal: string | null;
  stderrTail: string | null;
};

// GET /api/runs 목록 한 줄 항목: Run + evaluation(join) + 문제 표시용 메타.
export type RunListItem = RunDTO & {
  evaluation: EvaluationDTO | null;
  problemTitle: string | null;
  difficulty: string | null;
};

// GET /api/runs/[id] 상세 응답.
export type RunDetail = {
  run: RunDTO;
  evaluation: EvaluationDTO | null;
  problemTitle: string | null;
  difficulty: string | null;
};

export type ProblemSummary = {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  // 사용량 하드컷을 화면 단위(가중 토큰 = 비용 × 100만)로 환산한 값. 러너가 실제로 자르는
  // 기준(Problem.maxCostUsd)과 같은 값을 눈금만 바꾼 것이다(src/lib/pricing.ts).
  maxWeightedTokens: number;
  maxDurationMs: number;
};

// 모델별 토큰 분해(src/lib/pricing.ts의 ModelTokenUsage와 동일한 모양). 키는 모델 id이며,
// fast mode로 돈 구간은 "<model>:fast"라는 별도 키로 잡힌다(단가가 다르므로).
export type ModelTokenUsageDTO = {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
};

export type LiveProgressDTO = {
  status: "running" | RunStatus;
  problemId: string;
  // 주 지표(2026-08-10 통합): 가중 토큰 = 비용 × 100만. 하드컷·점수·표시가 전부 이 축이다.
  weightedTokensUsed: number | null;
  maxWeightedTokens: number;
  // 보조: 실제 오간 raw 토큰과 달러 환산치. 참고용으로만 표시한다.
  tokensUsed: number;
  costUsd?: number | null;
  byModel?: Record<string, ModelTokenUsageDTO> | null;
  unpricedModels?: string[]; // 단가 미등록 모델이 섞였으면 costUsd는 하한값이다
  usageSource?: UsageSource; // 위 수치의 출처(2026-08-10) — telemetry면 CLI 공식 값
  elapsedMs: number;
  maxDurationMs: number;
  // 적정 시간(Problem.targetDurationMs) — 넘겨도 실격은 아니지만 여기서부터 종합 점수가
  // 깎이므로, 진행 중에 사람이 볼 수 있어야 한다(docs/evaluation.md). 없는 문제면 null.
  targetDurationMs?: number | null;
  startedAt?: string;
  // 수동 모드 run 진행 상황을 폴링할 때만 채워진다("running"인 동안에도 이미 mode는 알 수 있다) —
  // 값이 있으면 tokensUsed/elapsedMs가 CLI 공식 값이 아니라 하네스 추정치라는 뜻이다(manual = 항상 추정치).
  mode?: RunMode;
  disqualifyReason?: DisqualifyReason | null;
};

// 문제 전체 정의(프롬프트/루브릭 포함) — 수동 모드는 사람이 직접 읽고 풀어야 하므로 시작 응답에
// 같이 실어 보낸다(runner.ts의 자동 모드와 달리 화면에 노출할 필요가 생겼다).
export type ProblemDetail = {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  prompt: string;
  rubric: string[];
  testCommand: string | null;
  maxWeightedTokens: number; // 위 ProblemSummary와 같은 의미(가중 토큰 단위 하드컷)
  maxDurationMs: number;
  targetDurationMs: number | null; // 적정 시간 — 초과 시 종합 점수 감점 시작(실격 아님)
  // 단계형 문제가 아니면 null. 있으면 총 단계 수만 알려준다("N단계 중 1단계" 진행률 표시용) — 각
  // 단계의 실제 텍스트는 POST /api/runs/[id]/stage 응답으로 통과할 때마다만 내려온다(미리 안 보여줌).
  stageCount: number | null;
};

// manualRun.ts의 ProblemStagePublic과 동일한 모양 — gateTestCommand/unlockPath는 절대 노출 안 됨.
export type ProblemStagePublic = {
  index: number;
  title: string;
  promptAddition: string;
};

// POST /api/runs/[id]/stage 응답.
// skipped=true면 게이트를 돌리지 않고 건너뛴 것이다(사람이 "건너뛰기"를 눌렀을 때). 그때도
// passed=true로 내려온다 — 진행 여부만 나타내는 필드이기 때문이다. 채점은 완료 시점 히든 테스트가
// 그대로 하므로 건너뛴 단계는 점수에 반영된다(src/lib/manualRun.ts의 skipStage 주석).
export type StageSubmitResponse =
  | { passed: true; completedStageIndex: number; nextStage: ProblemStagePublic | null; skipped?: boolean }
  | { passed: false; stageIndex: number; skipped?: boolean };

// POST /api/runs 응답 (수동 모드) — startManualRun()이 즉시 반환하는 workspacePath까지 포함해서
// 프론트가 이후 POST /api/runs/[id]/complete 호출 시 그대로 되돌려줄 수 있게 한다.
export type StartManualRunResponse = {
  runId: string;
  workspacePath: string;
  startedAt: string;
  problem: ProblemDetail;
};

// POST /api/runs/[id]/complete 응답 — manualRun.ts의 ManualRunFinalEstimate와 동일한 모양.
export type CompleteManualRunResponse = {
  runId: string;
  status: "completed" | "disqualified";
  disqualifyReason: DisqualifyReason | null;
  harnessEstimate: {
    tokens: number;
    elapsedMs: number;
    costUsd: number;
    // 아래 둘은 새로 저장된 run에서만 온다(멱등 재호출로 DB에서 되돌려줄 때는 생략될 수 있다).
    byModel?: Record<string, ModelTokenUsageDTO>;
    unpricedModels?: string[];
    compactApproxTokens?: number;
  };
};
