// GET  /api/runs  — 실행 이력 목록 (효율성 + 품질 필드를 한 번에, CLAUDE.md 이력 목록 요구사항).
// POST /api/runs  — 사람이 직접 VS Code + 대화형 Claude Code CLI로 풀 수동 실행을 시작하고
//                    runId와 함께 문제 프롬프트/루브릭을 즉시 반환한다.
//
// 예전에는 여기서 runBenchmark()(헤드리스 자동 벤치마크)를 트리거했지만, 이제 "시작" 버튼은
// startManualRun()(src/lib/manualRun.ts)으로 워크스페이스의 VS Code 통합 터미널에서 대화형 세션을
// 띄우는 걸로 완전히 교체됐다 — 사람이 직접 풀어야 하므로 응답에 problem.prompt/rubric을 실어서
// 프론트가 바로 보여줄 수 있게 한다. 저장(saveManualRun)과 평가(evaluateRun)는 사람이 "완료"를 누른
// 뒤 POST /api/runs/[id]/complete에서 이어진다 — manualRun.ts/evaluator.ts/db.ts 로직은 건드리지 않는다.
//
// problemId는 필수다 — 랜덤 선택 기능은 뺐다(문제 세트를 "하네스 엔지니어링이 점수를 가른다"는
// 설계 의도로 정성껏 큐레이션한 소수 문제로 유지하는 방향이라, 대시보드에서 사람이 무엇을 풀지
// 직접 고르게 한다).
//
// retryFromRunId(선택): "다시 하기" 버튼 — 실격/완료된 이전 run을 정리하고 같은 문제를 새
// workspace로 다시 시작한다. 이전 run의 claude.exe만 정확한 PID로 죽이고(best-effort,
// killClaudeProcessForRun), VS Code는 새 창을 또 안 띄우고 "code -r"로 마지막 활성 창을
// 재사용한다(manualRun.ts 상단 계약 5번 참고) — VS Code 창 자체를 강제 종료하지 않는 이유도 거기 있다.

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { killClaudeProcessForRun, startManualRun } from "@/lib/manualRun";
import { loadProblem } from "@/lib/problems";
import { toWeightedTokens } from "@/lib/pricing";
import { listRunsWithEvaluations } from "@/lib/db";

export async function GET() {
  const runs = await listRunsWithEvaluations();

  // 문제의 난이도/제목은 Run 테이블에 없다(problemId만 저장) — 이력 목록에서 난이도를 보여주려면
  // 문제 정의를 다시 읽어야 한다. 문제 파일이 나중에 지워지거나 이름이 바뀌어도 이력 자체는
  // 계속 보여야 하므로 못 찾으면 null로 채운다.
  const enriched = runs.map((run) => {
    let problemTitle: string | null = null;
    let difficulty: string | null = null;
    try {
      const problem = loadProblem(run.problemId);
      problemTitle = problem.title;
      difficulty = problem.difficulty;
    } catch {
      // 문제 파일이 없어졌어도 실행 이력은 그대로 노출한다.
    }
    return { ...run, problemTitle, difficulty };
  });

  return NextResponse.json({ runs: enriched });
}

export async function POST(request: NextRequest) {
  let problemId: string | undefined;
  // "다시 하기": 실격/완료된 이전 run을 정리하고 같은 문제를 새 workspace로 다시 시작할 때
  // 프론트가 이전 runId를 실어 보낸다(page.tsx의 retryRun 참고). 없으면 평범한 신규 시작이다.
  let retryFromRunId: string | undefined;
  try {
    const body = (await request.json()) as { problemId?: unknown; retryFromRunId?: unknown };
    problemId = typeof body?.problemId === "string" && body.problemId ? body.problemId : undefined;
    retryFromRunId =
      typeof body?.retryFromRunId === "string" && body.retryFromRunId ? body.retryFromRunId : undefined;
  } catch {
    // body가 없거나 파싱 불가 — 아래에서 problemId 누락으로 400 처리된다.
  }

  if (!problemId) {
    return NextResponse.json({ error: "problemId가 필요하다" }, { status: 400 });
  }

  if (retryFromRunId) {
    // best-effort — 이전 claude.exe를 못 찾거나 이미 죽어있어도 재시도 자체를 막지 않는다.
    try {
      await killClaudeProcessForRun(retryFromRunId);
    } catch (err) {
      console.warn(`[api/runs] 재시도 시 이전 claude.exe 종료 실패(무시하고 계속 진행): ${(err as Error).message}`);
    }
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

  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  // manualRun.ts 상단 주석에 적힌 사용 계약 그대로: await해서 workspacePath를 받는다. VS Code가
  // 열리고 통합 터미널의 자동 태스크로 claude.exe가 뜨기까지 시간이 걸릴 수 있지만(처음 여는
  // 워크스페이스라면 사람이 VS Code 워크스페이스 신뢰 창을 클릭해야 함, docs/manual-mode.md 참고),
  // "시작" 버튼 클릭 자체가 VS Code를 여는 동작이라 이 정도 지연은 자연스럽다.
  let workspacePath: string;
  try {
    const started = await startManualRun(problem, { runId, reuseWindow: Boolean(retryFromRunId) });
    workspacePath = started.workspacePath;
  } catch (err) {
    return NextResponse.json(
      { error: `수동 실행 시작 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      runId,
      workspacePath,
      startedAt,
      problem: {
        id: problem.id,
        title: problem.title,
        difficulty: problem.difficulty,
        category: problem.category,
        prompt: problem.prompt,
        rubric: problem.rubric,
        testCommand: problem.testCommand,
        // 사용량 하드컷을 화면 단위(가중 토큰)로 — 러너가 자르는 기준(maxCostUsd)과 같은 값이다.
        maxWeightedTokens: toWeightedTokens(problem.maxCostUsd),
        maxDurationMs: problem.maxDurationMs,
        targetDurationMs: problem.targetDurationMs ?? null,
        // 단계형 문제가 아니면 null — 프론트는 이 값 유무로 "이 단계 제출" UI를 보여줄지 정한다.
        // 각 단계의 실제 텍스트(promptAddition)는 게이트를 통과할 때마다 POST .../stage 응답으로만
        // 내려간다(미리 다 보여주면 이번에 고치려는 "한 방에 다 풀리는" 문제가 그대로 재발한다).
        stageCount: problem.stages && problem.stages.length > 0 ? problem.stages.length : null,
      },
    },
    { status: 202 },
  );
}
