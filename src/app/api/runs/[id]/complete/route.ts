// POST /api/runs/[id]/complete — 세션을 끝내고 기록한다. 호출 경로는 셋이다:
//   1) 단계형 문제에서 마지막 단계를 통과한 순간 프론트가 자동으로 (abandoned=false)
//   2) 사람이 "포기"(단계형) / "완료"(비단계형) 버튼을 눌러서 — 포기면 abandoned=true
//   3) 프론트가 실격/자연 종료를 폴링으로 감지해 자동으로 (abandoned=false)
// abandoned는 표시용 구분일 뿐이고 status/채점 경로는 전혀 바뀌지 않는다(prisma/schema.prisma 주석). completeManualRun()으로 추적을 멈추고 최종 하네스 추정치를
// 받은 뒤, status가 "completed"일 때만 evaluateRun()으로 평가하고(docs/evaluation.md — disqualified는
// 평가 생략), saveManualRun()으로 저장한다.
//
// 이미 저장된 run에 대해 다시 호출돼도 안전하다(멱등) — 실격은 감지 즉시 프론트가 자동으로 이
// 라우트를 부르고, 사람이 뒤늦게 "완료"를 눌러도(버튼은 숨겨지지만 방어적으로) 같은 결과를
// 돌려준다. manualRun.ts/evaluator.ts/db.ts의 기존 함수는 건드리지 않는다.

import { NextRequest, NextResponse } from "next/server";
import { completeManualRun } from "@/lib/manualRun";
import { loadProblem } from "@/lib/problems";
import { getRun, saveManualRun } from "@/lib/db";
import { evaluateRun } from "@/lib/evaluator";
import type { RunResult } from "@/lib/runner";

function existingRunResponse(run: NonNullable<Awaited<ReturnType<typeof getRun>>>) {
  return NextResponse.json({
    runId: run.id,
    status: run.status,
    abandoned: run.abandoned,
    disqualifyReason: run.disqualifyReason,
    harnessEstimate: {
      tokens: run.harnessEstimateTokens ?? 0,
      elapsedMs: run.harnessEstimateElapsedMs ?? run.durationMs,
      costUsd: run.harnessEstimateCostUsd ?? 0,
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 멱등성: 이미 저장된 run이면(자동 트리거 + 사람 클릭이 겹치는 경우 등) 그대로 반환한다.
  const existing = await getRun(id);
  if (existing) {
    return existingRunResponse(existing);
  }

  let body: { workspacePath?: unknown; problemId?: unknown; startedAt?: unknown; abandoned?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "요청 본문이 필요하다(workspacePath, problemId, startedAt)" },
      { status: 400 },
    );
  }

  const workspacePath = typeof body.workspacePath === "string" ? body.workspacePath : undefined;
  const problemId = typeof body.problemId === "string" ? body.problemId : undefined;
  const startedAt = typeof body.startedAt === "string" ? body.startedAt : undefined;
  // 안 보내면 false — 자동 완료/실격 감지 경로는 이 필드를 아예 안 싣는다.
  const abandoned = body.abandoned === true;

  if (!workspacePath || !problemId || !startedAt) {
    return NextResponse.json(
      { error: "workspacePath, problemId, startedAt은 모두 필수다" },
      { status: 400 },
    );
  }

  let problem;
  try {
    problem = loadProblem(problemId);
  } catch (err) {
    return NextResponse.json(
      { error: `문제를 불러오지 못했다: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  let final;
  try {
    final = completeManualRun(id, workspacePath);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }

  try {
    await saveManualRun({
      runId: id,
      problemId,
      workspacePath,
      startedAt,
      durationMs: final.harnessEstimate.elapsedMs,
      status: final.status,
      abandoned,
      disqualifyReason: final.disqualifyReason,
      harnessEstimateTokens: final.harnessEstimate.tokens,
      harnessEstimateElapsedMs: final.harnessEstimate.elapsedMs,
      // 비용 축(2026-08-07) — byModel이 원자료이고 costUsd는 스냅샷이다(prisma/schema.prisma 주석 참고).
      harnessEstimateCostUsd: final.harnessEstimate.costUsd,
      harnessEstimateUsageByModel: final.harnessEstimate.byModel,
      harnessEstimateCompactTokens: final.harnessEstimate.compactApproxTokens,
      // 이 수치가 CLI 텔레메트리에서 온 공식 값인지, 트랜스크립트 폴백 추정치인지(2026-08-10).
      harnessEstimateSource: final.harnessEstimate.usageSource,
    });
  } catch (err) {
    // 거의 항상 동시 호출로 인한 unique constraint 위반(자동 트리거와 사람 클릭이 거의 동시에 온 경우)
    // — 그 사이 다른 요청이 먼저 저장했다면 그 결과를 그대로 돌려준다.
    const already = await getRun(id);
    if (already) return existingRunResponse(already);
    return NextResponse.json({ error: `저장 실패: ${(err as Error).message}` }, { status: 500 });
  }

  if (final.status === "completed") {
    // evaluateRun(runner.ts의 RunResult)은 status/workspacePath/runId만 실제로 사용한다(evaluator.ts
    // 참고) — 수동 모드는 CLI 공식 usage/exitCode/sessionId 자체가 없으므로 그 필드들은 평가 로직이
    // 읽지 않는 자리채움 값이다. DB에는 이 값이 전혀 저장되지 않는다(saveManualRun만 Run 테이블에
    // 쓰고, evaluateRun은 Evaluation 테이블에만 쓴다).
    const placeholderResult: RunResult = {
      status: "completed",
      runId: id,
      problemId,
      workspacePath,
      startedAt,
      durationMs: final.harnessEstimate.elapsedMs,
      exitCode: 0,
      sessionId: null,
      resultText: "",
      numTurns: 0,
      totalCostUsd: 0,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      cliReportedDurationMs: null,
      rateLimitStatus: null,
    };

    try {
      await evaluateRun(placeholderResult, problem);
    } catch (err) {
      console.error(`[api/runs/${id}/complete] 평가 중 에러:`, err);
    }
  }

  return NextResponse.json({
    runId: id,
    status: final.status,
    abandoned,
    disqualifyReason: final.disqualifyReason,
    harnessEstimate: final.harnessEstimate,
  });
}
