import Link from "next/link";
import { formatCostUsdEstimate, formatDateTime, formatDuration, formatTokens } from "@/lib/format";
import { averageJudgeScore, getEfficiencyDisplay, summarizeModels } from "@/lib/runDisplay";
import { DifficultyBadge, StatusBadge } from "./StatusBadge";
import type { RunListItem } from "./types";

// 효율성(시간/토큰/비용)과 품질(테스트/LLM 점수)을 헤더 그룹으로 시각적으로 분리해서 보여준다
// (CLAUDE.md: 하나의 숫자로 뭉뚱그리지 않는다). 실격/실패 run은 "평가 없음"이 한눈에 보이게
// 테스트/LLM 칼럼에 상태 문구를 넣는다(docs/evaluation.md).
//
// 비용(USD) 칼럼은 한때 뺐다가 2026-08-07에 되살렸다. 뺐던 이유는 "수동 모드는 구독 로그인이라
// 비용을 알 수 없다"였는데, 그 결과 Fable 5로 돈 run과 Sonnet 5로 돈 run이 토큰 수만 같으면 표에서
// 완전히 동일해 보이는 문제가 생겼다 — 실제 소비는 단가 차이만큼(최대 3.3배) 벌어지는데도. 지금은
// 모델별 토큰 분해에 정가 테이블(src/lib/pricing.ts)을 곱한 환산 추정치를 보여준다. 실청구액이
// 아니라 "API 종량제로 돌렸다면" 기준의 비교용 척도라 항상 "추정"을 붙인다.
export function RunHistoryTable({ runs }: { runs: RunListItem[] }) {
  if (runs.length === 0) {
    return <p className="rounded-xl bg-white px-5 py-8 text-center text-sm text-zinc-400 shadow-sm ring-1 ring-zinc-200/70">아직 실행 이력이 없다.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-zinc-200/70">
      <table className="w-full min-w-[860px] border-collapse text-left text-sm [&_td]:border [&_td]:border-zinc-200/70 [&_th]:border [&_th]:border-zinc-200/70">
        <thead>
          <tr className="bg-zinc-50/70 text-[11px] uppercase tracking-wider text-zinc-400">
            <th className="px-3 py-2 font-medium" rowSpan={2}>
              문제
            </th>
            <th className="w-px px-3 py-2 font-medium whitespace-nowrap" rowSpan={2}>
              난이도
            </th>
            <th className="w-px px-3 py-2 font-medium whitespace-nowrap" rowSpan={2}>
              상태
            </th>
            <th className="px-3 py-1 text-center font-medium" colSpan={3}>
              효율성
            </th>
            <th className="px-3 py-1 text-center font-medium" colSpan={2}>
              품질
            </th>
            <th className="px-3 py-2 font-medium" rowSpan={2}></th>
          </tr>
          <tr className="bg-zinc-50/70 text-xs text-zinc-500">
            <th className="px-3 py-1 font-normal">시간</th>
            <th className="px-3 py-1 font-normal">가중 토큰</th>
            <th className="px-3 py-1 font-normal">실제 토큰 / 비용</th>
            <th className="px-3 py-1 font-normal">테스트</th>
            <th className="px-3 py-1 font-normal">LLM 채점</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const efficiency = getEfficiencyDisplay(run);
            const modelSummary = summarizeModels(efficiency.byModel);
            const avgScore = averageJudgeScore(run.evaluation?.judgeScores);
            const evaluated = run.status === "completed";

            return (
              <tr key={run.id} className="transition hover:bg-zinc-50/70">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-zinc-900">{run.problemTitle ?? run.problemId}</div>
                  <div className="text-xs text-zinc-400">{formatDateTime(run.startedAt)}</div>
                </td>
                <td className="w-px px-3 py-2.5 whitespace-nowrap">
                  <DifficultyBadge difficulty={run.difficulty} />
                </td>
                {/* 사유는 배지에서 빼고 title(마우스 오버)로만 남긴다 — 붙여두면 이 칼럼만
                    다른 칼럼의 두세 배로 벌어진다. 사유는 상세 페이지에서 항상 펼쳐 보여준다. */}
                <td className="w-px px-3 py-2.5 whitespace-nowrap">
                  <StatusBadge status={run.status} disqualifyReason={run.disqualifyReason} abandoned={run.abandoned} showReason={false} />
                </td>
                <td className="tabular px-3 py-2.5 whitespace-nowrap text-zinc-600">
                  {formatDuration(efficiency.durationMs)}
                </td>
                {/* 주 지표: 가중 토큰(= 비용 × 100만). 하드컷·점수와 같은 축이다(src/lib/pricing.ts). */}
                <td className="tabular px-3 py-2.5 font-semibold whitespace-nowrap text-zinc-900">
                  {efficiency.weightedTokens === null ? "—" : formatTokens(efficiency.weightedTokens)}
                  {efficiency.weightedTokensApproximated && (
                    <span className="ml-1 text-[10px] font-normal text-amber-600" title="비용 데이터가 없는 옛 run이라 실제 토큰 수를 근사로 썼다">
                      근사
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div className="tabular text-zinc-500">
                    {efficiency.tokens === null ? "—" : formatTokens(efficiency.tokens)}
                    <span className="mx-1 text-zinc-300">/</span>
                    {formatCostUsdEstimate(efficiency.costUsd)}
                  </div>
                  {/* 같은 토큰 수라도 어떤 모델로 썼는지에 따라 비용이 몇 배 달라지므로, 비용 옆에
                      항상 모델을 같이 보여준다(그게 없으면 숫자 차이가 어디서 왔는지 알 수 없다). */}
                  {modelSummary && <div className="text-[11px] text-zinc-400">{modelSummary}</div>}
                  {efficiency.unpricedModels.length > 0 && (
                    <div className="text-[11px] text-amber-600">단가 미등록 모델 포함 — 하한값</div>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {!evaluated ? (
                    <span className="text-xs text-zinc-400">평가 없음</span>
                  ) : run.evaluation?.testPassed === null || run.evaluation?.testPassed === undefined ? (
                    <span className="text-xs text-zinc-400">해당 없음</span>
                  ) : run.evaluation.testPassed ? (
                    <span className="text-green-700">통과</span>
                  ) : (
                    <span className="text-red-600">실패</span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {!evaluated ? (
                    <span className="text-xs text-zinc-400">평가 없음</span>
                  ) : avgScore === null ? (
                    <span className="text-xs text-zinc-400">—</span>
                  ) : (
                    `${avgScore.toFixed(1)} / 5`
                  )}
                </td>
                {/* whitespace-nowrap 없으면 칼럼이 좁을 때 "상세 보기"의 "기"만 다음 줄로 떨어진다. */}
                <td className="w-px px-3 py-2.5 text-right whitespace-nowrap">
                  <Link
                    href={`/runs/${run.id}`}
                    className="text-xs font-medium whitespace-nowrap text-blue-600 transition hover:text-blue-800 hover:underline"
                  >
                    상세 보기
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-zinc-200/70 bg-zinc-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-400">
        수동 모드 run(현재 실행 대부분)과 실격 run의 시간/토큰은 CLI 공식 값이 아니라 러너가 직접
        집계한 하네스 추정치다 — 자동 모드로 완료된 run만 CLI 공식 값이다(행마다 따로 표시하지
        않는다, 상세 보기에서는 계속 구분해서 보여준다). 비용은 모델별 토큰 분해에 Anthropic 정가를
        곱한 환산치다: 구독 로그인이라 실제 청구는 발생하지 않으므로 &ldquo;API 종량제로 돌렸다면&rdquo;
        기준의 모델 간 비교용 척도로만 읽어라. 비용 칼럼이 비어 있는 run은 이 기능(2026-08-07) 이전에
        기록돼 모델 분해 자체가 없는 경우다.
      </p>
    </div>
  );
}
