"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProgressBar } from "./_components/ProgressBar";
import { RunHistoryTable } from "./_components/RunHistoryTable";
import { DifficultyBadge, StatusBadge } from "./_components/StatusBadge";
import { formatCostUsdEstimate, formatDuration, formatTokens } from "@/lib/format";
import { averageJudgeScore, getEfficiencyDisplay, summarizeModels } from "@/lib/runDisplay";
import type {
  LiveProgressDTO,
  ProblemDetail,
  ProblemStagePublic,
  ProblemSummary,
  RunDetail,
  RunListItem,
  StageSubmitResponse,
  StartManualRunResponse,
} from "./_components/types";

const POLL_INTERVAL_MS = 1500;

export default function Home() {
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [problemsError, setProblemsError] = useState<string | null>(null);
  const [selectedProblemId, setSelectedProblemId] = useState<string>(""); // "" = 아직 선택 전(문제 목록 로드 후 첫 항목으로 자동 선택됨)

  // OPENAI_API_KEY 미설정 시 사전 안내 배너용. null = 아직 서버에서 확인 전(배너를 띄우지 않음 —
  // 깜빡임으로 잘못된 경고를 잠깐 보여주지 않기 위함). 실제 키 값은 절대 내려오지 않는다(boolean만).
  const [openaiKeyConfigured, setOpenaiKeyConfigured] = useState<boolean | null>(null);

  const [history, setHistory] = useState<RunListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // 수동 모드: "시작"을 누르면 VS Code + 대화형 CLI 세션이 열리고, 사람이 직접 문제를 푼다.
  const [activeRun, setActiveRun] = useState<StartManualRunResponse | null>(null);
  const [progress, setProgress] = useState<LiveProgressDTO | null>(null);

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [finishedRun, setFinishedRun] = useState<RunDetail | null>(null);

  // 단계형 문제(activeRun.problem.stageCount != null) 진행 상태. 각 단계의 실제 텍스트는 통과할
  // 때마다 POST .../stage 응답으로만 내려오므로(미리 안 보여줌), 통과한 단계들의 텍스트를 여기 계속
  // 누적해서 화면에 이어붙인다 — 1단계 원문은 activeRun.problem.prompt에 이미 있으므로 포함 안 함.
  const [revealedStages, setRevealedStages] = useState<ProblemStagePublic[]>([]);
  const [currentStageIndex, setCurrentStageIndex] = useState(1);
  const [allStagesPassed, setAllStagesPassed] = useState(false);
  // 게이트를 통과한 게 아니라 "건너뛰기"로 넘어간 단계들(1-based). 탭에서 구분해 보여주기 위한 것이고,
  // 채점에는 영향이 없다 — 완료 시점 히든 테스트가 산출물만 보고 그대로 판정한다.
  const [skippedStages, setSkippedStages] = useState<number[]>([]);
  const [stageSubmitting, setStageSubmitting] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  // 폴링이 실격/자연 종료를 감지했을 때 완료 처리를 딱 한 번만 자동으로 트리거하기 위한 가드.
  const autoCompleteTriggeredRef = useRef(false);

  const loadProblems = useCallback(async () => {
    try {
      const res = await fetch("/api/problems", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { problems: ProblemSummary[] };
      setProblems(data.problems);
    } catch (err) {
      setProblemsError(`문제 목록을 불러오지 못했다: ${(err as Error).message}`);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { runs: RunListItem[] };
      setHistory(data.runs);
    } catch {
      // 이력 로딩 실패는 조용히 무시 — 다음 새로고침/폴링 성공 시 갱신된다.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { openaiKeyConfigured: boolean };
      setOpenaiKeyConfigured(data.openaiKeyConfigured);
    } catch {
      // 설정 확인 실패는 조용히 무시한다(배너를 못 띄울 뿐, 실제 채점 동작 자체엔 영향 없음).
    }
  }, []);

  useEffect(() => {
    // 마운트 시 1회성 초기 데이터 페칭(문제 목록/이력/서버 설정) — React 공식 문서에서도 표준
    // 패턴으로 안내하는 "effect에서 fetch" 형태다. 아래 함수들은 await 이후에만 setState를 호출하므로
    // 실제로 effect 본문에서 동기적으로 setState하지 않는다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회성 데이터 페칭, 위 설명 참고
    loadProblems();
    loadHistory();
    loadConfig();
  }, [loadProblems, loadHistory, loadConfig]);


  // 사람이 "완료" 버튼을 누르거나(수동), 폴링이 실격/자연 종료를 감지했을 때(자동) 호출된다.
  // POST /api/runs/[id]/complete는 멱등이라 중복 호출돼도 안전하다.
  const handleComplete = useCallback(
    // abandoned=true는 사람이 "포기"를 눌러 끝낸 경우다. status/채점 경로는 동일하고, 이력에서
    // "끝까지 풀고 자동 완료된 run"과 구분해 보여주기 위한 표시일 뿐이다(schema.prisma 주석).
    async (run: StartManualRunResponse, abandoned = false) => {
      setCompleting(true);
      setCompleteError(null);
      try {
        const res = await fetch(`/api/runs/${run.runId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspacePath: run.workspacePath,
            problemId: run.problem.id,
            startedAt: run.startedAt,
            abandoned,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const detailRes = await fetch(`/api/runs/${run.runId}`, { cache: "no-store" });
        if (detailRes.ok) {
          setFinishedRun((await detailRes.json()) as RunDetail);
        }
        loadHistory();
      } catch (err) {
        setCompleteError(`완료 처리 실패: ${(err as Error).message}`);
      } finally {
        setCompleting(false);
      }
    },
    [loadHistory],
  );

  // 진행 상황 폴링: activeRun이 있고 아직 최종 결과가 없는 동안 실행. 상태가 running이 아니게 되면
  // (한도 초과로 자동 종료됐거나, 사람이 터미널을 스스로 닫은 경우) 자동으로 완료 처리를 트리거한다.
  useEffect(() => {
    if (!activeRun || finishedRun) return;

    let cancelled = false;

    async function poll() {
      if (!activeRun) return;
      try {
        const res = await fetch(`/api/runs/${activeRun.runId}/progress`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as LiveProgressDTO;
        if (cancelled) return;
        setProgress(data);

        if (data.status !== "running" && !autoCompleteTriggeredRef.current) {
          autoCompleteTriggeredRef.current = true;
          clearInterval(timer);
          handleComplete(activeRun);
        }
      } catch {
        // 네트워크 순간 에러는 무시하고 다음 폴링에서 재시도한다.
      }
    }

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeRun, finishedRun, handleComplete]);

  // retryFromRunId가 있으면 "다시 하기"다 — problemIdOverride(직전 run의 문제, 드롭다운을 그 사이
  // 사람이 바꿨어도 무시하고 같은 문제로 다시 연다)로 새 run을 시작하기 전에, 서버가 이전 run의
  // claude.exe를 정리하고 VS Code는 새 창 대신 마지막 활성 창을 재사용한다(API 라우트 참고).
  async function startRun(problemIdOverride?: string, retryFromRunId?: string) {
    setStarting(true);
    setStartError(null);
    setCompleteError(null);
    setFinishedRun(null);
    setProgress(null);
    setActiveRun(null);
    autoCompleteTriggeredRef.current = false;
    setRevealedStages([]);
    setCurrentStageIndex(1);
    setAllStagesPassed(false);
    setSkippedStages([]);
    setStageError(null);

    const problemIdToStart = problemIdOverride || selectedProblemId || problems[0]?.id;
    if (!problemIdToStart) {
      setStartError("풀 문제를 먼저 선택해라");
      setStarting(false);
      return;
    }

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemId: problemIdToStart, retryFromRunId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as StartManualRunResponse;
      setActiveRun(data);
    } catch (err) {
      setStartError(`실행 시작 실패: ${(err as Error).message}`);
    } finally {
      setStarting(false);
    }
  }

  // "다시 하기" 버튼 — 방금 끝난(실격/완료) run과 같은 문제를 새 workspace로 다시 연다. finishedRun이
  // 세팅된 시점에도 activeRun은 그대로 남아있으므로(handleComplete가 activeRun을 지우지 않음) 여기서
  // 이전 runId/problemId를 그대로 꺼내 쓸 수 있다.
  function retryRun() {
    if (!activeRun || starting) return;
    startRun(activeRun.problem.id, activeRun.runId);
  }

  // 단계형 문제의 "포기", 비단계형 문제의 "완료" 둘 다 여기로 온다 — 차이는 abandoned 플래그뿐이다.
  // (단계형을 끝까지 푼 경우는 사람이 버튼을 누르지 않는다: handleSubmitStage가 자동으로 끝낸다.)
  async function handleManualStopClick(abandoned: boolean) {
    if (!activeRun || completing) return;
    autoCompleteTriggeredRef.current = true; // 폴링이 중복으로 또 트리거하지 않도록
    await handleComplete(activeRun, abandoned);
  }

  // 단계형 문제에서 "이 단계 제출" 버튼을 누르면 호출된다. 통과하면 다음 단계 텍스트가 공개되고
  // (nextStage), 그게 마지막 단계였으면(nextStage === null) allStagesPassed를 세워 "이제 완료를
  // 눌러라"로 안내를 바꾼다. 실패해도 무슨 검증이 깨졌는지는 절대 안 알려준다(서버가 그렇게 응답함).
  async function handleSubmitStage(skip = false) {
    if (!activeRun || stageSubmitting) return;
    setStageSubmitting(true);
    setStageError(null);
    try {
      const res = await fetch(`/api/runs/${activeRun.runId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as StageSubmitResponse;
      if (data.passed) {
        if (skip) setSkippedStages((prev) => [...prev, data.completedStageIndex]);
        setCurrentStageIndex(data.completedStageIndex + 1);
        if (data.nextStage) {
          setRevealedStages((prev) => [...prev, data.nextStage as ProblemStagePublic]);
        } else {
          // 마지막 단계까지 통과 = 이 문제에서 사람이 할 일이 끝났다. 예전엔 여기서 "이제 완료를
          // 눌러라"라고 안내만 하고 사람이 한 번 더 눌러야 했는데, 그 사이에도 세션은 계속 돌아
          // 토큰/시간이 쌓였다(그리고 안 누르면 한도에 걸려 실격까지 갈 수 있었다). 통과 즉시
          // 자동으로 마무리한다(2026-08-12 사용자 요청).
          setAllStagesPassed(true);
          autoCompleteTriggeredRef.current = true; // 폴링이 중복 트리거하지 않도록
          await handleComplete(activeRun, false);
        }
      } else {
        setStageError("아직 통과하지 못했다 — 코드를 고쳐서 다시 제출해라.");
      }
    } catch (err) {
      setStageError(`제출 실패: ${(err as Error).message}`);
    } finally {
      setStageSubmitting(false);
    }
  }

  const isActive = Boolean(activeRun) && !finishedRun;
  const isStagedProblem = activeRun?.problem.stageCount != null;
  // 단계형에서 마지막 단계를 통과하면 자동 완료가 즉시 돌아가므로, 그 순간부터는 버튼을 감춘다.
  const showCompleteButton =
    isActive && (!progress || progress.status === "running") && !allStagesPassed;
  // 실시간 비용 옆에 붙일 모델 요약("opus-5 + sonnet-5") — 어떤 모델을 쓰고 있는지가 곧 비용의
  // 절반이므로 숫자 옆에 항상 같이 보여준다.
  const progressModels = summarizeModels(progress?.byModel ?? null);
  // 랜덤 선택 기능을 뺐으므로, 사람이 아직 드롭다운을 안 건드렸으면 목록의 첫 문제를 기본 선택값으로
  // 보여준다(state를 별도로 동기화하지 않고 렌더 시점에 파생시킨다 — 문제 목록 로드 타이밍에 의존하는
  // effect+setState보다 단순하다).
  const effectiveProblemId = selectedProblemId || problems[0]?.id || "";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">VibeCheck</h1>
        {isActive && (
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-600" />
            </span>
            세션 진행 중
          </span>
        )}
      </header>

      {openaiKeyConfigured === false && (
        <section className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-medium">OpenAI API 키가 설정되지 않았다.</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            자동 테스트 통과율과 효율성(시간·토큰)은 그대로 측정되지만, LLM 채점(품질 축)은 기록되지
            않는다 — 두 축은 서로 다른 지표라 하나가 안 된다고 다른 하나도 못 믿을 이유는 없다.{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">.env</code>에{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">OPENAI_API_KEY</code>를
            넣고 서버를 재시작하면 반영된다.
          </p>
        </section>
      )}

      {/* 런처 — 실행 중에는 한 줄로 접힌다(그때 주인공은 아래 문제 카드다). */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-zinc-200/70">
        {problemsError && <p className="mb-3 text-sm text-red-600">{problemsError}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel className="mr-1">문제 선택</SectionLabel>
          <select
            value={effectiveProblemId}
            onChange={(e) => setSelectedProblemId(e.target.value)}
            disabled={isActive || starting}
            className="min-w-56 flex-1 rounded-lg border-0 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 transition focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
          >
            {problems.length === 0 && <option value="">문제 목록 불러오는 중…</option>}
            {problems.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <button
            onClick={() => startRun()}
            disabled={isActive || starting || !effectiveProblemId}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-900"
          >
            {starting ? "시작하는 중…" : isActive ? "실행 중…" : "시작"}
          </button>
        </div>

        {starting && (
          <p className="mt-2 text-xs text-zinc-500">VS Code와 터미널을 여는 중이다…</p>
        )}
        {startError && <p className="mt-3 text-sm text-red-600">{startError}</p>}
      </section>

      {/* 실행 중 화면: **문제가 주 컬럼(3/5), 상태는 좁은 sticky 사이드바(2/5)**다.
          예전엔 둘 다 전체 폭으로 세로로 쌓여서, 정작 사람이 계속 읽어야 하는 문제 텍스트는
          좁고 짧게 보이는 반면 진행 막대가 큰 자리를 먹었다(사용자 지적). 단계형 문제는 단계가
          쌓일수록 문제 쪽이 계속 길어지므로 주 컬럼이어야 맞고, 상태는 스크롤을 따라다니게 한다. */}
      {activeRun && (
        <section className="grid gap-5 lg:grid-cols-5 lg:items-start">
          <div className="lg:col-span-3">
            <ActiveProblemCard
              problem={activeRun.problem}
              revealedStages={revealedStages}
              currentStageIndex={currentStageIndex}
              allStagesPassed={allStagesPassed}
              stageSubmitting={stageSubmitting}
              stageError={stageError}
              skippedStages={skippedStages}
              onSubmitStage={handleSubmitStage}
              canSubmitStage={isActive && (!progress || progress.status === "running")}
            />
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:col-span-2">
            {progress && (
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-zinc-200/70">
                <div className="flex items-center justify-between gap-2">
                  <SectionLabel>진행 상황</SectionLabel>
                  <StatusBadge status={progress.status} disqualifyReason={progress.disqualifyReason} />
                </div>

                {/* 하드컷·점수·표시가 전부 이 축 하나다(2026-08-10 통합). 가중 토큰 = 비용 × 100만 —
                    구독 플랜의 사용 한도가 토큰 1:1 합이 아니라 모델·토큰 종류로 가중돼 소모되기
                    때문이다(src/lib/problems.ts의 maxCostUsd 주석에 실측 근거). */}
                <div className="mt-4 space-y-4">
                  <ProgressBar
                    label="가중 토큰"
                    hint="구독 한도 소모"
                    value={progress.weightedTokensUsed ?? 0}
                    max={progress.maxWeightedTokens}
                    colorClassName="bg-violet-500"
                    valueLabel={`${formatTokens(progress.weightedTokensUsed ?? 0)} / ${formatTokens(progress.maxWeightedTokens)}`}
                  />
                  <ProgressBar
                    label="시간"
                    hint={
                      progress.targetDurationMs
                        ? `적정 ${formatDuration(progress.targetDurationMs)}`
                        : undefined
                    }
                    value={progress.elapsedMs}
                    max={progress.maxDurationMs}
                    colorClassName="bg-emerald-500"
                    markerValue={progress.targetDurationMs}
                    valueLabel={`${formatDuration(progress.elapsedMs)} / ${formatDuration(progress.maxDurationMs)}`}
                  />
                </div>

                {progress.targetDurationMs != null &&
                  progress.elapsedMs > progress.targetDurationMs && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
                      적정 시간({formatDuration(progress.targetDurationMs)})을 넘겼습니다 — 실격은
                      아니지만 지금부터 종합 점수가 깎입니다(하드컷까지 최대 -20점).
                    </p>
                  )}

                <dl className="mt-4 space-y-1.5 border-t border-zinc-100 pt-3 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-zinc-400">실제 토큰</dt>
                    <dd className="tabular text-zinc-600">{formatTokens(progress.tokensUsed)}</dd>
                  </div>
                  {progress.costUsd != null && (
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-zinc-400">비용(환산 추정)</dt>
                      <dd className="tabular text-zinc-600">{formatCostUsdEstimate(progress.costUsd)}</dd>
                    </div>
                  )}
                  {progressModels && (
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-zinc-400">모델</dt>
                      <dd className="text-right text-zinc-600">{progressModels}</dd>
                    </div>
                  )}
                </dl>

                {progress.unpricedModels && progress.unpricedModels.length > 0 && (
                  <p className="mt-2 text-[11px] text-amber-600">
                    단가 미등록({progress.unpricedModels.join(", ")}) — 표시된 비용은 하한값이다.
                  </p>
                )}

                <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
                  {progress.usageSource === "telemetry"
                    ? "측정 대상 CLI가 OpenTelemetry로 직접 보고한 값이다(추정치 아님). 배경 호출과 /compact 실제 비용까지 포함된다."
                    : "CLI 공식 값이 아니라 세션 트랜스크립트를 폴링해 집계한 하네스 추정치다 — 텔레메트리가 아직 안 붙어서 배경 호출은 빠져 있다."}
                </p>
              </div>
            )}

            {/* 단계형 문제는 마지막 단계 통과 시 자동으로 끝나므로, 사람이 누르는 버튼은
                "포기" 하나다. 단계가 없는 문제는 완료를 판정할 게이트가 없으므로 "완료"를 남긴다. */}
            {showCompleteButton &&
              (isStagedProblem ? (
                <div>
                  <button
                    onClick={() => handleManualStopClick(true)}
                    disabled={completing}
                    className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-300 transition hover:bg-red-50 hover:text-red-700 hover:ring-red-300 disabled:opacity-50"
                  >
                    {completing ? "기록하는 중…" : "포기하기"}
                  </button>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
                    지금까지 한 작업 그대로 채점하고 끝낸다 — 못 푼 단계는 점수에 그대로 반영된다.
                    마지막 단계를 통과하면 누르지 않아도 자동으로 마무리된다.
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => handleManualStopClick(false)}
                  disabled={completing}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {completing ? "완료 처리 중…" : "완료하고 채점하기"}
                </button>
              ))}

            {progress && progress.status !== "running" && !finishedRun && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                {progress.status === "disqualified"
                  ? "한도를 초과해 세션이 자동 종료됐다 — 실격으로 기록하는 중…"
                  : "세션이 종료됐다 — 결과를 기록하는 중…"}
              </p>
            )}

            {completeError && <p className="text-sm text-red-600">{completeError}</p>}
          </aside>
        </section>
      )}

      {finishedRun && <FinishedSummary detail={finishedRun} onRetry={retryRun} retrying={starting} />}

      <section>
        <SectionLabel className="mb-3 block">실행 이력</SectionLabel>
        {historyLoading ? (
          <p className="text-sm text-zinc-500">불러오는 중…</p>
        ) : (
          <RunHistoryTable runs={history} />
        )}
      </section>
    </div>
  );
}

// "3단계 [CS팀]: 환불/교환 요청 후기 추출" -> "[CS팀]: 환불/교환 요청 후기 추출"
// 단계 번호는 탭과 제목에서 이미 따로 보여주므로 본문 제목에서는 중복을 걷어낸다.
function stripStagePrefix(title: string): string {
  return title.replace(/^\s*\d+\s*단계\s*[:·\-]?\s*/, "");
}

// 화면 전체에서 반복되는 섹션 제목 스타일 — 작은 대문자 느낌의 라벨로 통일해서, 제목이 본문
// (특히 문제 프롬프트)보다 시각적으로 앞서지 않게 한다.
function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-wider text-zinc-400 ${className}`}>
      {children}
    </span>
  );
}

// 사람이 직접 읽고 풀어야 하는 문제 프롬프트/루브릭을 눈에 띄게 보여준다(CLAUDE.md: 수동 모드는
// 화면에서 이 정보를 확실히 보여줘야 한다).
//
// 단계형 문제(problem.stageCount != null)는 1단계 요구사항(problem.prompt)만 처음부터 보여주고,
// 그다음 단계 텍스트는 각 단계를 통과할 때마다 하나씩 내려온다(revealedStages) — 미리 다 안 보여줘야
// "한 마디로 스펙 다 지어서 한 번에 풀기"가 다시 통하지 않는다.
//
// 화면에는 **지금 보고 있는 단계 하나만** 띄우고, 좌측 책갈피 탭으로 지나간 단계를 되돌아본다
// (2026-08-12). 예전에는 공개된 단계를 아래로 계속 이어붙여서 단계가 쌓일수록 카드가 한없이
// 길어졌고, 정작 지금 할 일을 보려면 스크롤을 끝까지 내려야 했다.
function ActiveProblemCard({
  problem,
  revealedStages,
  currentStageIndex,
  allStagesPassed,
  skippedStages,
  stageSubmitting,
  stageError,
  onSubmitStage,
  canSubmitStage,
}: {
  problem: ProblemDetail;
  revealedStages: ProblemStagePublic[];
  currentStageIndex: number;
  allStagesPassed: boolean;
  skippedStages: number[];
  stageSubmitting: boolean;
  stageError: string | null;
  onSubmitStage: (skip?: boolean) => void;
  canSubmitStage: boolean;
}) {
  const isStaged = problem.stageCount != null;
  const stageCount = problem.stageCount ?? 0;

  // 좌측 책갈피에서 지금 보고 있는 단계(1-based). 기본값은 "지금 풀어야 하는 단계"이고, 단계를
  // 통과해 currentStageIndex가 올라가면 자동으로 새 단계로 따라간다 — 통과 직후에 옛 단계를 계속
  // 보고 있으면 안 되기 때문이다. 지나간 단계는 언제든 눌러서 다시 볼 수 있다.
  //
  // effect 없이 "prop이 바뀌면 state를 맞추는" React 표준 패턴(렌더 중 조정)을 쓴다 — 이 저장소는
  // react-hooks/set-state-in-effect 규칙을 켜두고 있다.
  const [viewedStage, setViewedStage] = useState(currentStageIndex);
  const [seenStageIndex, setSeenStageIndex] = useState(currentStageIndex);
  // 건너뛰기 확인 중인지. 단계가 바뀌면 같이 닫는다(아래) — 다음 단계에 확인창이 열린 채로 남으면
  // 사람이 무엇에 동의하는 건지 헷갈린다.
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  if (seenStageIndex !== currentStageIndex) {
    setSeenStageIndex(currentStageIndex);
    setViewedStage(currentStageIndex);
    setConfirmingSkip(false);
  }

  // 1단계 본문은 problem.prompt이고, 2단계부터는 통과할 때마다 내려온 revealedStages에 들어있다.
  const bodyFor = (index: number): string =>
    index === 1
      ? problem.prompt
      : (revealedStages.find((s) => s.index === index)?.promptAddition ?? "");
  const titleFor = (index: number): string =>
    index === 1 ? "시작 요청" : stripStagePrefix(revealedStages.find((s) => s.index === index)?.title ?? "");

  const viewingPast = isStaged && viewedStage !== currentStageIndex;

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-zinc-200/70">
      {/* 헤더: 흰 카드 위에 얇은 상단 강조선만 둔다. 예전엔 카드 전체가 bg-blue-50이라
          면적이 큰 만큼 시각적으로 시끄럽고 본문 대비도 낮았다. */}
      <div className="border-b border-zinc-100 bg-gradient-to-r from-blue-50/80 to-transparent px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <SectionLabel>지금 풀 문제</SectionLabel>
            <h3 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">{problem.title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isStaged && (
              <span className="tabular rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200">
                {allStagesPassed ? `${stageCount}/${stageCount} 단계 통과` : `${currentStageIndex}/${stageCount} 단계`}
              </span>
            )}
            <DifficultyBadge difficulty={problem.difficulty} />
          </div>
        </div>
      </div>

      {/* 본문. 단계형이면 **왼쪽 책갈피 + 지금 보는 단계 하나**만 보여준다 — 예전엔 통과한 단계
          텍스트를 아래로 계속 이어붙여서, 단계가 쌓일수록 카드가 한없이 길어지고 지금 할 일을 보려면
          스크롤을 내려야 했다(사용자 지적). 지나간 단계는 탭으로 언제든 되돌아가 볼 수 있다. */}
      <div className={isStaged ? "flex" : ""}>
        {isStaged && (
          <nav className="w-36 shrink-0 border-r border-zinc-100 bg-zinc-50/60 py-2" aria-label="단계">
            {Array.from({ length: stageCount }, (_, i) => i + 1).map((n) => {
              const done = n < currentStageIndex;
              const current = n === currentStageIndex;
              const locked = n > currentStageIndex;
              const selected = n === viewedStage;
              const skipped = skippedStages.includes(n);
              return (
                <button
                  key={n}
                  onClick={() => !locked && setViewedStage(n)}
                  disabled={locked}
                  aria-current={selected ? "step" : undefined}
                  className={`group relative flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                    selected ? "bg-white font-semibold text-zinc-900" : "text-zinc-500"
                  } ${locked ? "cursor-default opacity-40" : "hover:bg-white hover:text-zinc-900"}`}
                >
                  {/* 선택된 탭의 왼쪽 표식 — 책갈피처럼 보이게 한다. */}
                  <span
                    className={`absolute top-1 bottom-1 left-0 w-0.5 rounded-full ${selected ? "bg-blue-500" : "bg-transparent"}`}
                    aria-hidden
                  />
                  <span
                    title={skipped ? "건너뛴 단계" : undefined}
                    className={`tabular inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                      skipped
                        ? "bg-amber-100 text-amber-700"
                        : done
                          ? "bg-emerald-100 text-emerald-700"
                          : current
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-200 text-zinc-500"
                    }`}
                  >
                    {skipped ? "!" : done ? "✓" : n}
                  </span>
                  <span className="truncate">{n}단계</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* 지금 보는 단계 하나만. 아주 긴 요구사항일 때만 카드 안에서 스크롤되게 상한을 둔다. */}
        <div className="min-w-0 flex-1 px-5 py-5">
          {isStaged && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-zinc-900">
                {viewedStage}단계 · {titleFor(viewedStage)}
              </h4>
              {viewingPast && (
                <button
                  onClick={() => setViewedStage(currentStageIndex)}
                  className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100"
                >
                  지나간 단계를 보는 중 · 현재({currentStageIndex}단계)로
                </button>
              )}
            </div>
          )}
          <p className="max-h-[46vh] overflow-y-auto whitespace-pre-wrap text-[15px] leading-7 text-zinc-800">
            {isStaged ? bodyFor(viewedStage) : problem.prompt}
          </p>
        </div>
      </div>

      {/* 보조 정보는 접어둔다 — 열어두면 본문(문제)과 자리를 다툰다. */}
      <div className="space-y-px border-t border-zinc-100 bg-zinc-50/60">
        {problem.rubric.length > 0 && (
          <details className="group px-5 py-3">
            <summary className="cursor-pointer list-none text-xs font-medium text-zinc-500 transition hover:text-zinc-800">
              <span className="inline-block transition group-open:rotate-90">▸</span> 채점 루브릭 ({problem.rubric.length})
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-xs leading-relaxed text-zinc-600">
              {problem.rubric.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </details>
        )}

        <details className="group px-5 py-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-zinc-500 transition hover:text-zinc-800">
            <span className="inline-block transition group-open:rotate-90">▸</span> 진행 방법 / 주의사항
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-zinc-600">
            VS Code가 열리고 통합 터미널에서 대화형 Claude Code CLI 세션이 자동으로 시작됐을 것이다(처음
            여는 워크스페이스라면 VS Code의 &quot;이 폴더 작성자를 신뢰합니까?&quot; 창을 먼저 눌러야
            시작된다 — 자동으로 안 열렸다면 워크스페이스를 직접 열어 진행해도 된다). {isStaged
              ? "왼쪽 탭에서 지금 단계를 확인하고, 요구사항을 반영해 코드를 고친 뒤 아래 제출 버튼으로 채점받아라 — 통과해야 다음 단계 요구사항이 공개된다. 지나간 단계는 탭을 눌러 다시 볼 수 있다."
              : "위 프롬프트대로 작업을 마치면 오른쪽 \"완료\" 버튼을 눌러라."} 토큰/시간 한도를 넘기면
            세션은 자동으로 강제 종료되고 실격으로 기록된다.
          </p>
        </details>
      </div>

      {isStaged && !allStagesPassed && (
        <div className="border-t border-zinc-100 px-5 py-4">
          {/* 제출/건너뛰기는 항상 **현재 단계**에 대해서만 일어난다 — 지나간 단계를 보고 있어도
              마찬가지라, 버튼 문구로 대상 단계를 분명히 밝힌다(오해로 잘못 누르는 걸 막는다). */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onSubmitStage(false)}
              disabled={!canSubmitStage || stageSubmitting}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600"
            >
              {stageSubmitting ? "채점 중…" : `${currentStageIndex}단계 제출 (${currentStageIndex}/${stageCount})`}
            </button>

            {!confirmingSkip && (
              <button
                onClick={() => setConfirmingSkip(true)}
                disabled={!canSubmitStage || stageSubmitting}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-500 ring-1 ring-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-40"
              >
                이 단계 건너뛰기
              </button>
            )}
          </div>

          {/* 확인 단계 — 브라우저 기본 confirm 대신 페이지 안에서 묻는다(창을 띄우면 세션 화면을
              가리고, 자동화/포커스 문제도 생긴다). 되돌릴 수 없는 동작이라 결과를 분명히 적는다. */}
          {confirmingSkip && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
              <p className="text-sm font-medium text-amber-900">
                {currentStageIndex}단계를 건너뛸까요?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                채점을 거치지 않고 다음 단계로 넘어갑니다. <strong>되돌릴 수 없습니다.</strong> 건너뛴
                단계의 산출물은 완료 시점 채점에 그대로 반영되므로, 만들지 않았거나 틀린 채로 넘어가면
                점수가 그만큼 내려갑니다.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setConfirmingSkip(false);
                    onSubmitStage(true);
                  }}
                  disabled={stageSubmitting}
                  className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-amber-500 disabled:opacity-50"
                >
                  건너뛰기
                </button>
                <button
                  onClick={() => setConfirmingSkip(false)}
                  className="rounded-lg px-3.5 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-300 transition hover:bg-amber-100"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          {stageError && <p className="mt-2 text-sm text-red-600">{stageError}</p>}
        </div>
      )}

      {isStaged && allStagesPassed && (
        <p className="border-t border-zinc-100 bg-emerald-50/70 px-5 py-4 text-sm font-medium text-emerald-800">
          모든 단계를 통과했다 — 자동으로 마무리하고 채점하는 중이다.
        </p>
      )}
    </div>
  );
}

function FinishedSummary({
  detail,
  onRetry,
  retrying,
}: {
  detail: RunDetail;
  onRetry: () => void;
  retrying: boolean;
}) {
  const efficiency = getEfficiencyDisplay(detail.run);
  const avgScore = averageJudgeScore(detail.evaluation?.judgeScores);

  const modelSummary = summarizeModels(efficiency.byModel);

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-zinc-200/70">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <SectionLabel>결과</SectionLabel>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
            {detail.problemTitle ?? detail.run.problemId}
          </h2>
        </div>
        <StatusBadge status={detail.run.status} disqualifyReason={detail.run.disqualifyReason} abandoned={detail.run.abandoned} />
      </div>

      {/* 지표를 문장처럼 나열하지 않고 타일로 나눈다 — 값이 세로로 정렬돼 비교가 쉽다.
          주 지표는 가중 토큰 하나다(= 비용 × 100만, 하드컷·점수와 같은 축). 실제 토큰과 달러는
          아래에 참고로만 붙인다(src/lib/pricing.ts의 가중 토큰 주석 참고). */}
      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-zinc-200/70 ring-1 ring-zinc-200/70 sm:grid-cols-4">
        <Stat label="시간" value={formatDuration(efficiency.durationMs)} note={efficiency.isHarnessEstimate ? "하네스 추정치" : undefined} />
        <Stat
          label="가중 토큰"
          value={efficiency.weightedTokens === null ? "—" : formatTokens(efficiency.weightedTokens)}
          note="구독 한도 소모"
          emphasis
        />
        <Stat
          label="테스트"
          value={
            detail.run.status !== "completed"
              ? "평가 없음"
              : detail.evaluation?.testPassed
                ? "통과"
                : detail.evaluation?.testPassed === false
                  ? "실패"
                  : "해당 없음"
          }
          tone={
            detail.run.status !== "completed"
              ? "muted"
              : detail.evaluation?.testPassed
                ? "good"
                : detail.evaluation?.testPassed === false
                  ? "bad"
                  : "muted"
          }
        />
        <Stat label="LLM 채점" value={avgScore === null ? "—" : `${avgScore.toFixed(1)} / 5`} />
      </dl>

      <p className="mt-2 text-xs text-zinc-400">
        실제 토큰 {efficiency.tokens === null ? "—" : formatTokens(efficiency.tokens)}
        <span className="mx-1.5 text-zinc-300">·</span>
        {formatCostUsdEstimate(efficiency.costUsd)}
        {modelSummary && <span className="ml-1.5">({modelSummary})</span>}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
        <Link
          href={`/runs/${detail.run.id}`}
          className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700"
        >
          상세 보기 →
        </Link>
        <button
          onClick={onRetry}
          disabled={retrying}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50"
        >
          {retrying ? "다시 시작하는 중…" : "다시 하기"}
        </button>
        <p className="text-xs text-zinc-400">
          같은 문제를 새 워크스페이스로 연다 — 직전 세션의 claude.exe는 종료하고, VS Code는 새 창 대신
          지금 창을 재사용한다.
        </p>
      </div>
    </section>
  );
}

// 결과 요약의 지표 타일 하나.
function Stat({
  label,
  value,
  note,
  emphasis = false,
  tone = "normal",
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
  tone?: "normal" | "good" | "bad" | "muted";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-600"
        : tone === "muted"
          ? "text-zinc-400"
          : "text-zinc-900";
  return (
    <div className="bg-white px-3 py-2.5">
      <dt className="text-[11px] text-zinc-400">{label}</dt>
      <dd className={`tabular mt-0.5 ${emphasis ? "text-base font-semibold" : "text-sm font-medium"} ${toneClass}`}>
        {value}
      </dd>
      {note && <p className="mt-0.5 text-[10px] text-zinc-400">{note}</p>}
    </div>
  );
}
