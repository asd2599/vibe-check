// GET /api/runs/[id]/progress — 메인 페이지가 폴링하는 실시간 진행 상황.
// 수동 모드로 바뀌면서 우선순위도 바뀐다: 먼저 manualRun.ts의 getManualRunStatus()(메모리 추적
// 상태)를 본다. 한도 초과로 이미 강제 종료됐다면(onDisqualified가 이미 발동한 상태) isTracking이
// false + disqualifyReason이 채워진 채로 그대로 반영된다 — 프론트가 "완료" 버튼을 누르기 전에도
// 폴링만으로 실격 사실을 알 수 있다. 메모리에 없으면(이미 /complete로 저장 완료됐거나 서버 재시작)
// DB로 폴백한다.

import { NextResponse } from "next/server";
import { getManualRunStatus } from "@/lib/manualRun";
import { getRun } from "@/lib/db";
import { loadProblem } from "@/lib/problems";
import { parseUsageByModel } from "@/lib/runDisplay";
import { estimateCostUsd, toWeightedTokens } from "@/lib/pricing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const manual = getManualRunStatus(id);
  if (manual) {
    let maxWeightedTokens = 0;
    let maxDurationMs = 0;
    let targetDurationMs: number | null = null;
    try {
      const problem = loadProblem(manual.problemId);
      maxWeightedTokens = toWeightedTokens(problem.maxCostUsd);
      maxDurationMs = problem.maxDurationMs;
      targetDurationMs = problem.targetDurationMs ?? null;
    } catch {
      // 문제 파일이 없어졌어도 진행 상황 자체는 보여줄 수 있어야 한다.
    }

    // isTracking=false면 폴러가 멈춘 상태다 — 한도 초과로 강제종료됐으면(disqualifyReason 있음)
    // "disqualified", 사람이 스스로 세션을 끝냈거나(터미널 닫기 등) completeManualRun이 이미
    // 호출된 상태면 "completed"로 본다(manualRun.ts 상단 주석 — 한도 초과가 아니면 completed 취급).
    const status = !manual.isTracking ? (manual.disqualifyReason ? "disqualified" : "completed") : "running";

    return NextResponse.json({
      status,
      problemId: manual.problemId,
      // 주 지표: 가중 토큰(= 비용을 토큰 눈금으로 환산, 100만 = $1). 하드컷과 같은 축이다.
      weightedTokensUsed: toWeightedTokens(manual.costUsdEstimate),
      maxWeightedTokens,
      // 보조: 실제 raw 토큰과 원본 비용(둘 다 참고용으로만 보여준다).
      tokensUsed: manual.tokensUsedEstimate,
      costUsd: manual.costUsdEstimate,
      byModel: manual.byModel,
      unpricedModels: manual.unpricedModels,
      // 이 수치가 CLI 텔레메트리 공식 값인지 트랜스크립트 폴백 추정치인지(2026-08-10).
      usageSource: manual.usageSource,
      elapsedMs: manual.elapsedMs,
      maxDurationMs,
      targetDurationMs,
      mode: "manual",
      disqualifyReason: manual.disqualifyReason,
    });
  }

  // 메모리에 추적 상태가 없다 — 이미 /complete로 DB에 저장됐거나(activeRuns 맵은 completeManualRun
  // 이후에도 남아있으므로 사실 이 분기는 서버 재시작 시에만 주로 탄다), 애초에 이 runId가 없는 경우.
  const run = await getRun(id);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  let maxWeightedTokens = 0;
  let maxDurationMs = 0;
  let targetDurationMs: number | null = null;
  try {
    const problem = loadProblem(run.problemId);
    maxWeightedTokens = toWeightedTokens(problem.maxCostUsd);
    maxDurationMs = problem.maxDurationMs;
    targetDurationMs = problem.targetDurationMs ?? null;
  } catch {
    // 문제 파일이 없어졌어도 진행 상황 자체(이미 끝난 run)는 보여줄 수 있어야 한다.
  }

  // mode=manual은 completed든 disqualified든 항상 harnessEstimate*가 유일한 수치다(CLI 공식 usage
  // 자체가 없음, docs/evaluation.md). mode=auto는 기존 로직 그대로.
  const tokensUsed =
    run.mode === "manual"
      ? (run.harnessEstimateTokens ?? 0)
      : run.status === "completed"
        ? (run.usageInputTokens ?? 0) +
          (run.usageOutputTokens ?? 0) +
          (run.usageCacheCreationInputTokens ?? 0) +
          (run.usageCacheReadInputTokens ?? 0)
        : (run.harnessEstimateTokens ?? 0);

  const elapsedMs =
    run.mode === "manual"
      ? (run.harnessEstimateElapsedMs ?? run.durationMs)
      : run.status === "disqualified"
        ? (run.harnessEstimateElapsedMs ?? run.durationMs)
        : run.durationMs;

  // DB 폴백 경로: 저장된 byModel 원자료에 현재 단가 테이블을 다시 곱한다(getEfficiencyDisplay와
  // 동일한 규칙 — 단가 테이블에 모델이 추가되면 과거 run도 소급 반영된다).
  // 단, 텔레메트리로 저장된 run은 costUsd가 CLI가 직접 계산한 값이므로 다시 곱하지 않는다
  // (runDisplay.getEfficiencyDisplay와 같은 규칙 — 이유는 거기 주석 참고).
  const byModel = parseUsageByModel(run.harnessEstimateUsageByModel);
  const usageSource = run.harnessEstimateSource === "telemetry" ? "telemetry" : "transcript";
  const cost = usageSource === "transcript" && byModel ? estimateCostUsd(byModel) : null;

  const costUsd = cost ? cost.costUsd : (run.harnessEstimateCostUsd ?? null);

  return NextResponse.json({
    status: run.status,
    problemId: run.problemId,
    weightedTokensUsed: costUsd == null ? null : toWeightedTokens(costUsd),
    maxWeightedTokens,
    tokensUsed,
    costUsd,
    byModel,
    unpricedModels: cost?.unpricedModels ?? [],
    usageSource,
    elapsedMs,
    maxDurationMs,
    targetDurationMs,
    startedAt: run.startedAt.toISOString(),
    mode: run.mode,
    disqualifyReason: run.disqualifyReason,
  });
}
