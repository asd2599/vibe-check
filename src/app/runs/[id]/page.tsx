import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunWithEvaluation } from "@/lib/db";
import { loadProblem } from "@/lib/problems";
import { getWorkspaceDiff } from "@/lib/workspaceDiff";
import { clampPercent, formatCostUsdEstimate, formatDateTime, formatDuration, formatTokens } from "@/lib/format";
import {
  averageJudgeScore,
  computeOverallScore,
  getEfficiencyDisplay,
  modelBreakdownRows,
  parseJudgeScores,
  toWeightedTokens,
} from "@/lib/runDisplay";
import { DifficultyBadge, StatusBadge } from "@/app/_components/StatusBadge";
import { DiffView } from "@/app/_components/DiffView";

// 상세 페이지는 서버 컴포넌트다: db.ts를 직접 호출해서 렌더한다(CLAUDE.md: 데이터 페칭은
// db.ts를 통해서만, UI 컴포넌트에서 직접 Prisma 호출 금지 — db.ts를 거치는 한 서버 컴포넌트에서
// 바로 호출하는 것도 허용된다). GET /api/runs/[id]는 메인 페이지가 진행 종료 직후 요약을
// 보여줄 때 쓰는 별도 경로다.
export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getRunWithEvaluation(id);
  if (!data) notFound();

  const { run, evaluation } = data;

  let problem: ReturnType<typeof loadProblem> | null = null;
  try {
    problem = loadProblem(run.problemId);
  } catch {
    // 문제 파일이 없어졌어도 run 상세는 그대로 보여준다.
  }

  const efficiency = getEfficiencyDisplay(run);
  const judgeScores = parseJudgeScores(evaluation?.judgeScores);
  const diffs = getWorkspaceDiff(run.workspacePath, problem?.starterFiles ?? null);
  const overallScore = computeOverallScore({
    status: run.status,
    evaluation: evaluation ? { testPassed: evaluation.testPassed, judgeScores: evaluation.judgeScores } : null,
    // 점수도 하드컷과 같은 축(가중 토큰)을 쓴다 — "실격은 토큰, 점수는 비용" 식의 축 불일치 제거(2026-08-10).
    referenceWeightedTokens: problem?.referenceWeightedTokens,
    weightedTokens: efficiency.weightedTokens,
    // 기준선 초과 시 토큰효율 점수가 0에 도달하는 배율(2026-08-12). 문제에 없으면 기본값 2로
    // 예전과 동일하게 동작한다 — problems.ts의 tokenScoreZeroAtRatio 주석 참고.
    tokenScoreZeroAtRatio: problem?.tokenScoreZeroAtRatio,
    // 시간 감점(2026-08-11): 적정 시간을 넘긴 만큼 본점수에서 차감한다. 문제에
    // targetDurationMs가 없으면 감점 0으로 예전과 동일하게 동작한다.
    durationMs: run.durationMs,
    targetDurationMs: problem?.targetDurationMs,
    maxDurationMs: problem?.maxDurationMs,
  });
  const modelRows = modelBreakdownRows(efficiency.byModel);
  // 하드컷을 화면과 같은 눈금으로 — 러너는 maxCostUsd로 자르고, 사람은 가중 토큰으로 본다(같은 값).
  const maxWeightedTokens = problem ? toWeightedTokens(problem.maxCostUsd) : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← 목록으로
        </Link>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{problem?.title ?? run.problemId}</h1>
          <p className="mt-1 text-xs text-zinc-500">
            {formatDateTime(run.startedAt)} · runId {run.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600">
            {run.mode === "manual" ? "수동 모드" : "자동 모드"}
          </span>
          <DifficultyBadge difficulty={problem?.difficulty ?? null} />
          <StatusBadge status={run.status} disqualifyReason={run.disqualifyReason} abandoned={run.abandoned} />
        </div>
      </header>

      {/* 종합 점수: 사용자가 명시적으로 요청한 CLAUDE.md 예외 조항(효율성/품질 분리 원칙을 이번만
          합산) — 100점 만점, 80점 통과. 계산식은 src/lib/runDisplay.ts의 computeOverallScore. */}
      {overallScore && (
        <section
          className={`rounded-lg border p-5 ${
            overallScore.passed ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"
          }`}
        >
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">종합 점수</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-3xl font-bold ${overallScore.passed ? "text-emerald-700" : "text-rose-700"}`}>
              {overallScore.score} / 100
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                overallScore.passed ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
              }`}
            >
              {overallScore.passed ? "통과" : "미달"} (기준 80)
            </span>
          </div>
          {!overallScore.passed && overallScore.reasons.length > 0 && (
            <p className="mt-2 text-sm text-rose-800">미달 — {overallScore.reasons.join(", ")}</p>
          )}
          {overallScore.timePenalty > 0 && (
            <p className="mt-2 text-sm text-amber-800">
              적정 시간({formatDuration(problem?.targetDurationMs ?? 0)}) 초과 —{" "}
              {formatDuration(run.durationMs)} 걸려서{" "}
              <strong>-{Math.round(overallScore.timePenalty)}점</strong> 감점됨
            </p>
          )}
          <p className="mt-2 text-[11px] text-zinc-500">
            품질(테스트 40%+LLM채점 60% 가중 평균)과 토큰효율(기준 이하면 만점,{" "}
            {problem?.tokenScoreZeroAtRatio ?? 2}배 이상이면 0점으로 선형 감점)을 7:3으로 가중
            평균한다(있는 항목만). 테스트가 있었는데 실패하면
            80점 미만으로 강제 캡한다. 여기서 <strong>적정 시간을 넘긴 만큼 감점</strong>한다 —
            적정 시간 안에 끝내면 0점 감점이고, 하드컷(실격선)에 가까울수록 최대 20점까지 선형으로
            깎인다. 빨리 끝냈다고 가산점을 주지는 않는다(품질을 희생해 서두르는 게 이득이 되면
            안 되므로). 아래 효율성/품질 지표는 여전히 분리해서 그대로 확인할 수 있다.
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            토큰효율은 <strong>가중 토큰</strong>으로 계산한다 — 하드컷과 완전히 같은 축이라
            &ldquo;실격은 토큰, 점수는 비용&rdquo; 같은 축 불일치가 없다. 가중 토큰은 모델과 토큰
            종류(캐시 읽기는 할인 요율)가 반영된 값이라, 같은 raw 토큰이라도 비싼 모델을 쓰면
            늘어나고 캐시를 잘 태우면 줄어든다.
          </p>
        </section>
      )}

      {run.mode === "manual" && (
        <section className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-medium">수동 모드로 측정된 실행이다 — 사람이 VS Code + 대화형 Claude Code CLI로 직접 풀었다.</p>
          {efficiency.usageSource === "telemetry" ? (
            <p className="mt-1 text-xs text-blue-800">
              아래 토큰/비용은 측정 대상 CLI가 <strong>OpenTelemetry로 직접 보고한 값</strong>이다 —
              세션 트랜스크립트를 파싱한 추정치가 아니라 CLI가 스스로 계산한 수치이며, 트랜스크립트에
              흔적이 안 남는 배경 호출(대화 제목 생성용 Haiku 등)과 <code>/compact</code>의 실제 비용까지
              포함한다. 헤드리스 세션으로 교차검증했을 때 <code>--output-format json</code>의
              공식 <code>modelUsage</code>와 모델별 토큰·비용이 완전히 일치했다.
            </p>
          ) : (
            <p className="mt-1 text-xs text-blue-800">
              아래 효율성 지표(시간/토큰)는 CLI 공식 usage가 아니라 세션 트랜스크립트를 폴링해 집계한
              하네스 추정치다(텔레메트리가 붙지 않은 run) — 여러 run으로 교차검증한 결과 CLI 공식
              합계와 일치했지만, 트랜스크립트에 usage가 안 남는 배경 호출은 원천적으로 빠져 있어
              실제보다 <strong>약간 적게</strong> 잡힌다(실측 약 0.2%).
            </p>
          )}
        </section>
      )}

      {run.status !== "completed" && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            {run.status === "disqualified" ? "실격 — 평가를 수행하지 않았다." : "실패 — 평가를 수행하지 않았다."}
          </p>
          {run.status === "disqualified" && (
            <p className="mt-1">
              사유:{" "}
              {run.disqualifyReason === "token_limit"
                ? "토큰 한도 초과"
                : run.disqualifyReason === "cost_limit"
                  ? "구독 한도 소모 초과"
                  : "시간 한도 초과"}{" "}
              — 문제별 maxTokens/maxCostUsd/maxDurationMs 중 하나를 실행 도중 초과해서 러너가 강제
              종료했다(유예/부분 채점 없음).
            </p>
          )}
          {run.status === "failed" && (
            <>
              <p className="mt-1">
                exitCode: {run.exitCode ?? "—"} / signal: {run.signal ?? "—"}
              </p>
              {run.stderrTail && (
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-xs text-zinc-700">
                  {run.stderrTail}
                </pre>
              )}
            </>
          )}
        </section>
      )}

      {/* 효율성: 시간/토큰/비용. 품질과 절대 하나의 점수로 합치지 않는다(CLAUDE.md). */}
      <section className="rounded-lg border border-zinc-200 p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">효율성</h2>
        {run.mode === "manual" ? (
          <dl className="grid grid-cols-2 gap-4">
            <Metric
              label="소요 시간"
              value={
                problem
                  ? `${formatDuration(efficiency.durationMs)} / ${formatDuration(problem.maxDurationMs)} (${Math.round(
                      clampPercent(efficiency.durationMs, problem.maxDurationMs),
                    )}%)`
                  : formatDuration(efficiency.durationMs)
              }
              note={
                [
                  efficiency.isHarnessEstimate ? "하네스 추정치" : null,
                  problem ? "문제 한도 대비" : null,
                  problem?.targetDurationMs
                    ? `적정 ${formatDuration(problem.targetDurationMs)}${
                        efficiency.durationMs > problem.targetDurationMs ? " 초과" : " 이내"
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
            {/* 주 지표: 가중 토큰 하나. 하드컷·점수·표시가 전부 이 축이다(2026-08-10 통합).
                raw 토큰과 원본 비용은 아래 보조 줄로 내렸다. */}
            <div>
              <dt className="text-xs text-zinc-500">
                가중 토큰
                <span className="ml-1 text-[10px] text-zinc-400">
                  {efficiency.usageSource === "telemetry"
                    ? "(CLI가 직접 보고한 값 기준)"
                    : "(모델 단가 환산 추정치 기준)"}
                </span>
              </dt>
              <dd className="text-lg font-semibold text-zinc-900">
                {efficiency.weightedTokens === null ? "—" : formatTokens(efficiency.weightedTokens)}
                {efficiency.weightedTokensApproximated && (
                  <span className="ml-1 text-[10px] font-normal text-amber-600">
                    (근사 — 비용 데이터가 없는 옛 run이라 실제 토큰 수를 그대로 썼다)
                  </span>
                )}
              </dd>
              {maxWeightedTokens !== null && efficiency.weightedTokens !== null && (
                <>
                  <p className="mt-1 text-xs text-zinc-500">
                    상한(하드컷) {formatTokens(maxWeightedTokens)} 대비{" "}
                    {Math.round(clampPercent(efficiency.weightedTokens, maxWeightedTokens))}%
                    <span className="ml-1 text-[10px] text-zinc-400">
                      — 넘으면 실격(유예 없음)
                    </span>
                  </p>
                  {problem?.referenceWeightedTokens != null && (
                    <p
                      className={`mt-1 text-xs font-medium ${
                        efficiency.weightedTokens > problem.referenceWeightedTokens
                          ? "text-amber-700"
                          : "text-teal-700"
                      }`}
                    >
                      {efficiency.weightedTokens > problem.referenceWeightedTokens
                        ? `기준(참고) ${formatTokens(problem.referenceWeightedTokens)} 초과`
                        : `기준(참고) ${formatTokens(problem.referenceWeightedTokens)} 이내`}
                      <span className="ml-1 text-[10px] font-normal text-zinc-400">
                        (하드컷과 별개인 효율성 참고선 — 실격 여부와 무관)
                      </span>
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="col-span-2">
              {/* 보조 지표. raw 토큰은 컨텍스트 크기를 가늠할 때만 의미가 있고 구독 한도 소모와는
                  비례하지 않는다(캐시 읽기가 대부분이면 raw는 커도 소모는 작다). 원본 비용은 가중
                  토큰과 같은 값을 달러로 표시한 것뿐이다. */}
              <dt className="text-xs text-zinc-500">참고 — 실제 토큰 수 / 달러 환산</dt>
              <dd className="text-sm text-zinc-700">
                실제 오간 토큰 {efficiency.tokens === null ? "—" : formatTokens(efficiency.tokens)}
                <span className="mx-1.5 text-zinc-300">|</span>
                {formatCostUsdEstimate(efficiency.costUsd)}
                {efficiency.tokens !== null && efficiency.weightedTokens !== null && efficiency.tokens > 0 && (
                  <span className="ml-1.5 text-xs text-zinc-400">
                    (가중 토큰 / 실제 토큰 = {(efficiency.weightedTokens / efficiency.tokens).toFixed(2)}배)
                  </span>
                )}
              </dd>
              <p className="mt-1 text-[11px] text-zinc-500">
                <strong>가중 토큰 = 비용 × 100만</strong>(100만 가중 토큰 = $1). 구독 플랜의 사용 한도는
                토큰 개수를 1:1로 세지 않고 모델과 토큰 종류(캐시 읽기는 할인 요율)로 가중해 소모되므로,
                실제 토큰 수보다 이 축이 한도 소모에 가깝다. 눈금은 실측 run 17건의 중앙값에 맞춰서
                <strong> 전형적인 run이면 가중 토큰 ≈ 실제 토큰</strong>이 되게 잡았다 — 위 배율이 1보다
                크면 비싼 모델을 썼다는 뜻이고, 작으면 캐시를 잘 태웠다는 뜻이다. 구독 로그인이라 실제
                청구는 발생하지 않으며, &ldquo;내 주간 한도의 몇 %&rdquo;라는 수치 자체는 API로 공개되지
                않아 비율까지는 알 수 없다.
              </p>
              {/* 토큰 수는 모델을 바꿔도 비슷하게 나온다(Fable 5/Opus 5/Sonnet 5는 같은 토크나이저
                  계열). 실제로 벌어지는 건 토큰당 단가이므로, 토큰만 보면 전혀 다른 소비가 같은
                  숫자로 보인다 — 그래서 모델별 분해를 항상 같이 펼쳐 보여준다. */}
              {modelRows.length > 0 ? (
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-zinc-400">
                      <th className="py-1 text-left font-normal">모델</th>
                      <th className="py-1 text-right font-normal">입력</th>
                      <th className="py-1 text-right font-normal">출력</th>
                      <th className="py-1 text-right font-normal">캐시 쓰기</th>
                      <th className="py-1 text-right font-normal">캐시 읽기</th>
                      <th className="py-1 text-right font-normal">합계</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-600">
                    {modelRows.map((row) => {
                      const usage = efficiency.byModel?.[row.usageKey];
                      if (!usage) return null;
                      return (
                        <tr key={row.usageKey} className="border-t border-zinc-100">
                          <td className="py-1 text-left font-medium text-zinc-800">{row.label}</td>
                          <td className="py-1 text-right">{formatTokens(usage.inputTokens)}</td>
                          <td className="py-1 text-right">{formatTokens(usage.outputTokens)}</td>
                          <td className="py-1 text-right">
                            {formatTokens(usage.cacheWrite5mTokens + usage.cacheWrite1hTokens)}
                          </td>
                          <td className="py-1 text-right">{formatTokens(usage.cacheReadTokens)}</td>
                          <td className="py-1 text-right font-medium">{formatTokens(row.tokens)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">
                  모델별 분해 없음 — 비용 집계 기능(2026-08-07) 이전에 기록된 run이다.
                </p>
              )}
              {efficiency.unpricedModels.length > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  단가 테이블에 없는 모델이 섞여 있다({efficiency.unpricedModels.join(", ")}) — 위
                  비용은 그만큼 빠진 <strong>하한값</strong>이다. src/lib/pricing.ts에 단가를 추가하면
                  이 run도 소급해서 다시 계산된다.
                </p>
              )}
              <p className="mt-2 text-[11px] text-zinc-400">
                구독 로그인(OAuth)으로 돌리므로 <strong>실제 청구는 발생하지 않는다</strong> — 이
                금액은 &ldquo;같은 작업을 API 종량제로 돌렸다면&rdquo;을 Anthropic 정가로 환산한
                값이며, 모델 간 소비를 공정하게 비교하기 위한 척도다. 캐시 토큰은 종류별 배수를
                반영한다(읽기 0.1배, 5분 쓰기 1.25배, 1시간 쓰기 2배).
                {efficiency.compactApproxTokens != null && efficiency.compactApproxTokens > 0 && (
                  <>
                    {" "}이 중 {formatTokens(efficiency.compactApproxTokens)} 토큰은 /compact 근사치이며
                    캐시 읽기 단가로 환산했다(추정 위에 얹은 가정 — manualRun.ts 주석 참고).
                  </>
                )}
              </p>
            </div>
          </dl>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric
              label="소요 시간"
              value={formatDuration(efficiency.durationMs)}
              note={efficiency.isHarnessEstimate ? "하네스 추정치" : undefined}
            />
            <Metric
              label="토큰"
              value={efficiency.tokens === null ? "—" : formatTokens(efficiency.tokens)}
              note={efficiency.isHarnessEstimate ? "하네스 추정치" : undefined}
            />
            <Metric label="비용" value={formatCostUsdEstimate(efficiency.costUsd)} note="추정치" />
            <Metric label="턴 수" value={run.numTurns !== null ? String(run.numTurns) : "—"} />
          </dl>
        )}
        {run.status === "completed" && (
          <p className="mt-3 text-xs text-zinc-400">
            입력 {formatTokens(run.usageInputTokens ?? 0)} · 출력 {formatTokens(run.usageOutputTokens ?? 0)} · 캐시
            생성 {formatTokens(run.usageCacheCreationInputTokens ?? 0)} · 캐시 읽기{" "}
            {formatTokens(run.usageCacheReadInputTokens ?? 0)}
          </p>
        )}
      </section>

      {/* 품질: 자동 테스트 + LLM 채점(OpenAI, 별도 벤더). */}
      <section className="rounded-lg border border-zinc-200 p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">품질</h2>
        {run.status !== "completed" ? (
          <p className="text-sm text-zinc-500">
            평가 없음 — {run.status === "disqualified" ? "실격" : "실패"} run은 자동 테스트/LLM 채점을 생략한다
            (docs/evaluation.md).
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-xs font-medium text-zinc-500">자동 테스트</h3>
              {evaluation?.testPassed === null || evaluation?.testPassed === undefined ? (
                <p className="mt-1 text-sm text-zinc-500">해당 없음 (문제에 testCommand가 정의되어 있지 않음)</p>
              ) : (
                <>
                  <p className={`mt-1 text-sm font-medium ${evaluation.testPassed ? "text-green-700" : "text-red-600"}`}>
                    {evaluation.testPassed ? "통과" : "실패"} (exitCode {evaluation.testExitCode ?? "—"})
                  </p>
                  {evaluation.testOutput && (
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-200">
                      {evaluation.testOutput}
                    </pre>
                  )}
                </>
              )}
            </div>

            <div>
              <h3 className="text-xs font-medium text-zinc-500">
                LLM 채점 (OpenAI{evaluation?.judgeModel ? ` · ${evaluation.judgeModel}` : ""})
              </h3>
              {!evaluation?.judgeModel ? (
                <p className="mt-1 text-sm text-zinc-500">
                  채점 호출이 실패해 LLM 점수가 없다(위 자동 테스트 결과는 그대로 유지된다).
                </p>
              ) : (
                <>
                  {averageJudgeScore(evaluation?.judgeScores) !== null && (
                    <p className="mt-2 flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-zinc-900">
                        평균 {averageJudgeScore(evaluation?.judgeScores)!.toFixed(1)} / 5
                      </span>
                      <span className="text-xs text-zinc-400">(항목 {judgeScores.length}개)</span>
                    </p>
                  )}
                  <ul className="mt-2 space-y-2">
                    {judgeScores.map((item) => (
                      <li key={item.criterion} className="rounded-md border border-zinc-200 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-zinc-800">{item.criterion}</span>
                          <span className="shrink-0 font-semibold text-zinc-900">{item.score} / 5</span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">{item.reasoning}</p>
                      </li>
                    ))}
                  </ul>
                  {evaluation.judgeOverallComment && (
                    <p className="mt-2 text-sm text-zinc-600">{evaluation.judgeOverallComment}</p>
                  )}
                  <p className="mt-2 text-xs text-zinc-400">
                    채점 비용 {formatCostUsdEstimate(evaluation.judgeCostUsd)}(벤치마크 대상 CLI 비용과는 별개로 집계)
                    · 입력 {formatTokens(evaluation.judgeInputTokens ?? 0)} · 출력{" "}
                    {formatTokens(evaluation.judgeOutputTokens ?? 0)}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* diff: 채점 근거를 사용자가 직접 확인할 수 있어야 한다. */}
      <section className="rounded-lg border border-zinc-200 p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">변경된 코드</h2>
        {diffs === null ? (
          <p className="text-sm text-zinc-500">
            워크스페이스 디렉터리를 찾을 수 없다(정리되었거나 이동됨): {run.workspacePath}
          </p>
        ) : (
          <DiffView diffs={diffs} />
        )}
      </section>

      <details className="rounded-lg border border-zinc-200 p-5 text-xs text-zinc-500">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-700">원본 필드 (디버깅용)</summary>
        <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>workspacePath: {run.workspacePath}</div>
          <div>sessionId: {run.sessionId ?? "—"}</div>
          <div>exitCode: {run.exitCode ?? "—"}</div>
          <div>rateLimitStatus: {run.rateLimitStatus ?? "—"}</div>
          <div>cliReportedDurationMs: {run.cliReportedDurationMs ?? "—"}</div>
        </dl>
      </details>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-lg font-semibold text-zinc-900">
        {value}
        {note && <span className="ml-1 text-[10px] font-normal text-zinc-400">({note})</span>}
      </dd>
    </div>
  );
}
