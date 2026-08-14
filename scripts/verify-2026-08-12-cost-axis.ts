// 2026-08-12 수정 2건의 소급 안전성 검증.
//
// 무엇을 고쳤나:
//   ① collectUsage()의 텔레메트리/트랜스크립트 폴백 선택 기준을 totalTokens -> cost.costUsd 로 바꿨다.
//      (하드컷은 비용 축인데 선택은 토큰 축이라, 캐시 읽기가 많은 쪽이 "토큰은 큰데 비용은 작은"
//       경우 하드컷이 느슨해질 수 있었다.)
//   ② parseTranscriptUsage()에서 cache_creation의 TTL 미분류 잔여분을 5분 버킷(1.25배)이 아니라
//      1시간 버킷(2배)에 넣도록 바꿨다. (실측상 CLI는 1h TTL을 쓰고, 하드컷 입력값은 과소평가가
//      위험한 방향이다.)
//
// 이 스크립트가 검증하는 것과 그 한계:
//   - ②는 저장된 byModel 원자료에 직접 소급 적용해서 하드컷 판정이 뒤집히는지 본다. 단, 저장된
//     cacheWrite5mTokens는 **이미 옛 규칙으로 잔여분이 합쳐진 뒤의 값**이라 "진짜 5분 토큰"과
//     "잔여분"을 사후에 구분할 수 없다. 그래서 **최악 가정**(저장된 5분 토큰이 전부 잔여분이었다고
//     보고 통째로 1시간 단가로 재계산)으로 상한을 잡는다. 이 상한에서도 판정이 안 뒤집히면 실제
//     영향은 그보다 작으므로 소급 안전이 보장된다.
//   - ①은 폴백 "선택"이라 저장된 run에는 채택된 한쪽만 남아있다. 사후 재현이 원리상 불가능하다.
//     대신 각 run이 하드컷에서 얼마나 떨어져 있었는지(여유율)를 뽑아, 선택이 달라졌을 때 판정이
//     뒤집힐 수 있었던 run이 있었는지 본다.

import { prisma } from "../src/lib/db";
import { loadProblem, type Problem } from "../src/lib/problems";
import { parseUsageByModel } from "../src/lib/runDisplay";
import {
  estimateCostUsd,
  sumModelTokenUsage,
  toWeightedTokens,
  type UsageByModel,
} from "../src/lib/pricing";

// 저장된 byModel에 ②의 최악 가정을 적용: 5분 캐시 쓰기 토큰을 전부 1시간 버킷으로 옮긴다.
function applyWorstCaseTtlShift(byModel: UsageByModel): UsageByModel {
  const out: UsageByModel = {};
  for (const [key, u] of Object.entries(byModel)) {
    out[key] = {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: u.cacheWrite1hTokens + u.cacheWrite5mTokens,
      cacheReadTokens: u.cacheReadTokens,
    };
  }
  return out;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  const runs = await prisma.run.findMany({
    where: { mode: "manual" },
    orderBy: { startedAt: "asc" },
  });

  const problems = new Map<string, Problem | null>();
  const problemFor = (id: string): Problem | null => {
    if (!problems.has(id)) {
      try {
        problems.set(id, loadProblem(id));
      } catch {
        problems.set(id, null); // 지워진 옛 문제
      }
    }
    return problems.get(id) ?? null;
  };

  let checked = 0;
  let skippedNoByModel = 0;
  let telemetryRuns = 0;
  let transcriptRuns = 0;
  let flipped = 0;
  let has5mTokens = 0;
  let minHeadroom = Number.POSITIVE_INFINITY;
  let minHeadroomRun = "";

  const rows: string[] = [];

  for (const run of runs) {
    const problem = problemFor(run.problemId);
    const byModel = parseUsageByModel(run.harnessEstimateUsageByModel);
    if (!byModel) {
      skippedNoByModel += 1;
      continue;
    }
    checked += 1;

    const source = run.harnessEstimateSource === "telemetry" ? "telemetry" : "transcript";
    if (source === "telemetry") telemetryRuns += 1;
    else transcriptRuns += 1;

    // 화면/하드컷이 실제로 쓰는 비용값과 같은 규칙(runDisplay.getEfficiencyDisplay):
    //   telemetry  -> 저장된 CLI 계산값을 그대로 (우리 단가표를 다시 곱하지 않는다)
    //   transcript -> 저장된 byModel에 현재 단가표를 다시 곱한다
    const oldCost =
      source === "telemetry"
        ? (run.harnessEstimateCostUsd ?? 0)
        : estimateCostUsd(byModel).costUsd;

    // ②의 최악 가정 적용. 텔레메트리 run은 비용을 우리가 곱하지 않으므로 영향이 원천적으로 없다.
    const newCost =
      source === "telemetry" ? oldCost : estimateCostUsd(applyWorstCaseTtlShift(byModel)).costUsd;

    const cacheWrite5m = Object.values(byModel).reduce((s, u) => s + u.cacheWrite5mTokens, 0);
    if (cacheWrite5m > 0) has5mTokens += 1;

    const cap = problem?.maxCostUsd ?? null;
    const oldOver = cap != null ? oldCost > cap : false;
    const newOver = cap != null ? newCost > cap : false;
    const judgmentFlipped = oldOver !== newOver;
    if (judgmentFlipped) flipped += 1;

    if (cap != null && cap > 0) {
      const headroom = 1 - newCost / cap; // 양수면 여유, 0에 가까울수록 아슬아슬
      if (headroom < minHeadroom) {
        minHeadroom = headroom;
        minHeadroomRun = run.id;
      }
    }

    const rawTokens = Object.values(byModel).reduce((s, u) => s + sumModelTokenUsage(u), 0);
    const delta = newCost - oldCost;

    rows.push(
      [
        run.id.slice(0, 8),
        run.problemId.padEnd(24),
        run.status.padEnd(13),
        source.padEnd(10),
        `raw=${String(rawTokens).padStart(9)}`,
        `5m=${String(cacheWrite5m).padStart(8)}`,
        `old=$${oldCost.toFixed(4)}`,
        `new=$${newCost.toFixed(4)}`,
        `Δ=${delta === 0 ? "     0" : `+${(delta / (oldCost || 1) * 100).toFixed(1)}%`}`,
        `가중=${String(toWeightedTokens(newCost)).padStart(9)}`,
        cap != null ? `한도=$${cap.toFixed(2)}` : "한도=?",
        judgmentFlipped ? "  <<< 판정 뒤집힘" : oldOver ? "  (초과)" : "",
      ].join("  "),
    );
  }

  console.log(rows.join("\n"));
  console.log("\n" + "=".repeat(100));
  console.log(`manual run 총 ${runs.length}건 / byModel 원자료 있는 run ${checked}건 검사`);
  console.log(`  - byModel 없어 건너뜀(2026-08-07 이전 옛 run): ${skippedNoByModel}건`);
  console.log(`  - 출처 telemetry: ${telemetryRuns}건 (②의 영향 원천적으로 없음 — 비용이 CLI 계산값)`);
  console.log(`  - 출처 transcript: ${transcriptRuns}건 (②의 영향 대상)`);
  console.log(`  - 5분 캐시 쓰기 토큰이 0이 아닌 run: ${has5mTokens}건`);
  console.log(`\n②(최악 가정) 적용 후 하드컷 판정이 뒤집힌 run: ${flipped}건`);
  if (Number.isFinite(minHeadroom)) {
    console.log(
      `①용 참고 — 하드컷까지 여유가 가장 적었던 run: ${minHeadroomRun.slice(0, 8)} (여유 ${pct(minHeadroom)})`,
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
