// runner.ts가 만드는 RunResult(completed/disqualified/failed)를 그대로 저장/조회한다.
// CLAUDE.md 원칙: 러너는 멍청하게 — db.ts도 마찬가지로 저장/조회 이상의 로직을 넣지 않는다.
// 페이즈 5(eval-engineer): evaluator.ts가 만드는 EvaluationResult 저장/조회 로직 추가.

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { RunResult, DisqualifyReason } from "./runner";
import type { EvaluationResult } from "./evaluator";
import type { UsageByModel } from "./pricing";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
});

export const prisma = new PrismaClient({ adapter });

// RunResult(discriminated union) -> Prisma의 단일 Run 테이블 row(상태별 필드는 nullable)로 변환.
// runBenchmark()는 항상 mode=auto(헤드리스 벤치마크) — 수동 모드 저장은 saveManualRun()이 따로 담당한다.
function toRunCreateInput(result: RunResult) {
  const base = {
    id: result.runId,
    status: result.status,
    mode: "auto" as const,
    problemId: result.problemId,
    workspacePath: result.workspacePath,
    startedAt: result.startedAt,
    durationMs: result.durationMs,
    rateLimitStatus: result.rateLimitStatus ?? null,
  };

  if (result.status === "completed") {
    return {
      ...base,
      exitCode: result.exitCode,
      sessionId: result.sessionId,
      resultText: result.resultText,
      numTurns: result.numTurns,
      totalCostUsdEstimate: result.totalCostUsd,
      usageInputTokens: result.usage.inputTokens,
      usageOutputTokens: result.usage.outputTokens,
      usageCacheCreationInputTokens: result.usage.cacheCreationInputTokens,
      usageCacheReadInputTokens: result.usage.cacheReadInputTokens,
      cliReportedDurationMs: result.cliReportedDurationMs,
    };
  }

  if (result.status === "disqualified") {
    return {
      ...base,
      sessionId: result.sessionId,
      disqualifyReason: result.disqualifyReason,
      harnessEstimateTokens: result.harnessEstimate.tokens,
      harnessEstimateElapsedMs: result.harnessEstimate.elapsedMs,
    };
  }

  // failed
  return {
    ...base,
    exitCode: result.exitCode,
    signal: result.signal,
    stderrTail: result.stderrTail,
  };
}

export async function saveRun(result: RunResult): Promise<void> {
  await prisma.run.create({ data: toRunCreateInput(result) });
}

// 수동 모드(src/lib/manualRun.ts) run을 저장하기 위한 입력. runner.ts의 RunResult와 구조가 다르다 —
// 수동 모드는 대화형 세션이라 CLI 공식 usage/exitCode/sessionId 같은 필드 자체가 없고(전부 null로
// 저장됨), "failed" 상태도 없다(CLI가 스스로 크래시하는 헤드리스 경로가 아니므로). 호출 예시는
// src/lib/manualRun.ts 상단 주석 참고.
export type SaveManualRunInput = {
  runId: string;
  problemId: string;
  workspacePath: string;
  startedAt: string; // ISO — 세션 시작(startManualRun 호출) 시각
  durationMs: number; // manualRun.ts가 freeze한 최종 경과 시간(하네스 추정치)
  status: "completed" | "disqualified";
  // "포기" 버튼으로 끝냈는지(2026-08-12). status는 completed 그대로이고 채점도 수행한다 —
  // 어디까지 갔는지가 점수로 남아야 하기 때문이다(prisma/schema.prisma의 abandoned 주석 참고).
  abandoned: boolean;
  disqualifyReason: DisqualifyReason | null;
  // 하네스 추정치 — 세션 트랜스크립트를 폴링해서 집계한 값, CLI 공식 값이 아니며 부정확할 수 있다
  // (docs/cli-spec.md, src/lib/manualRun.ts 상단 경고 참고). completed든 disqualified든 항상 채운다.
  harnessEstimateTokens: number;
  harnessEstimateElapsedMs: number;
  // 비용 축(2026-08-07). byModel이 원자료이고 costUsd는 스냅샷이다 — 화면에서는 byModel에 현재 단가
  // 테이블(src/lib/pricing.ts)을 다시 곱해서 보여주므로, 단가 테이블에 모델이 추가되면 과거 run도
  // 소급 반영된다(prisma/schema.prisma의 해당 필드 주석 참고).
  harnessEstimateCostUsd: number;
  harnessEstimateUsageByModel: UsageByModel;
  harnessEstimateCompactTokens: number;
  // 위 수치들의 출처 — "telemetry"(CLI가 OTel로 직접 보고한 공식 값) | "transcript"(예전 폴백 방식).
  // prisma/schema.prisma의 harnessEstimateSource 주석 참고.
  harnessEstimateSource: string;
};

export async function saveManualRun(input: SaveManualRunInput): Promise<void> {
  await prisma.run.create({
    data: {
      id: input.runId,
      status: input.status,
      mode: "manual",
      problemId: input.problemId,
      workspacePath: input.workspacePath,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      rateLimitStatus: null, // 수동 모드는 rate_limit_event를 관찰하지 않는다(대화형 CLI stdout을 안 읽음)
      abandoned: input.abandoned,
      disqualifyReason: input.disqualifyReason,
      harnessEstimateTokens: input.harnessEstimateTokens,
      harnessEstimateElapsedMs: input.harnessEstimateElapsedMs,
      harnessEstimateCostUsd: input.harnessEstimateCostUsd,
      harnessEstimateUsageByModel: input.harnessEstimateUsageByModel,
      harnessEstimateCompactTokens: input.harnessEstimateCompactTokens,
      harnessEstimateSource: input.harnessEstimateSource,
    },
  });
}

export async function getRun(runId: string) {
  return prisma.run.findUnique({ where: { id: runId } });
}

export async function listRuns() {
  return prisma.run.findMany({ orderBy: { startedAt: "desc" } });
}

// EvaluationResult(evaluator.ts) -> Evaluation 테이블 row.
// judge가 null(OpenAI 채점 실패)이면 judge* 필드는 전부 null로 저장된다 — 테스트 결과는 그대로 남는다.
function toEvaluationCreateInput(evaluation: EvaluationResult) {
  return {
    runId: evaluation.runId,
    testPassed: evaluation.test.ran ? evaluation.test.passed : null,
    testOutput: evaluation.test.output,
    testExitCode: evaluation.test.exitCode,
    // Prisma의 Json? 필드에 JS null을 그대로 넣으면 "json 값 자체가 null"과 "컬럼이 NULL"이
    // 모호해져 타입 에러가 난다 — judge가 없을 때는 필드를 아예 생략해 컬럼을 NULL로 둔다.
    judgeScores: evaluation.judge ? evaluation.judge.scores : undefined,
    judgeOverallComment: evaluation.judge?.overallComment ?? null,
    judgeModel: evaluation.judge?.model ?? null,
    judgeCostUsd: evaluation.judge?.costUsd ?? null,
    judgeInputTokens: evaluation.judge?.inputTokens ?? null,
    judgeOutputTokens: evaluation.judge?.outputTokens ?? null,
    evaluatedAt: evaluation.evaluatedAt,
  };
}

export async function saveEvaluation(evaluation: EvaluationResult): Promise<void> {
  await prisma.evaluation.create({ data: toEvaluationCreateInput(evaluation) });
}

export async function getEvaluation(runId: string) {
  return prisma.evaluation.findUnique({ where: { runId } });
}

// --- 대시보드(페이즈 6) 전용 조회 함수. 기존 함수는 건드리지 않고 아래에 추가만 한다. ---

// 이력 목록 한 줄에서 효율성(시간/토큰/비용)과 품질(테스트/LLM 채점)을 동시에 스캔할 수 있어야
// 하므로(CLAUDE.md), listRuns()와 별도로 evaluation을 조인해서 가져오는 함수를 둔다.
export async function listRunsWithEvaluations() {
  return prisma.run.findMany({
    orderBy: { startedAt: "desc" },
    include: { evaluation: true },
  });
}

// 상세 페이지(/runs/[id])용: run과 evaluation을 한 번에 묶어서 반환한다. run이 없으면 null.
// evaluation은 completed 상태에서만 존재할 수 있다(docs/evaluation.md) — 없으면 null 그대로 둔다.
export async function getRunWithEvaluation(runId: string) {
  const run = await getRun(runId);
  if (!run) return null;
  const evaluation = await getEvaluation(runId);
  return { run, evaluation };
}
