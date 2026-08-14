import {
  BASELINE_MODEL,
  describeUsageKey,
  estimateCostUsd,
  fromWeightedTokens,
  sumModelTokenUsage,
  toWeightedTokens,
  type UsageByModel,
} from "./pricing";

// Run/Evaluation 레코드를 화면에 뿌리기 위한 순수 표시 로직.
// db.ts(조회)나 runner.ts/evaluator.ts(측정/평가) 로직은 건드리지 않고, 이미 가져온 데이터를
// 어떻게 나눠 보여줄지만 다룬다 — CLAUDE.md: 효율성과 품질은 하나의 점수로 합치지 않는다.

export type RunEfficiencyFields = {
  status: "completed" | "disqualified" | "failed";
  mode: "auto" | "manual";
  durationMs: number;
  totalCostUsdEstimate: number | null;
  usageInputTokens: number | null;
  usageOutputTokens: number | null;
  usageCacheCreationInputTokens: number | null;
  usageCacheReadInputTokens: number | null;
  harnessEstimateTokens: number | null;
  harnessEstimateElapsedMs: number | null;
  // 비용 축(2026-08-07). 기존 run에는 없으므로(마이그레이션 이전 데이터) 전부 optional이다 —
  // 없으면 예전처럼 비용 없이 토큰만 보여준다.
  harnessEstimateCostUsd?: number | null;
  harnessEstimateUsageByModel?: unknown; // Prisma Json 컬럼 — 방어적으로 파싱한다(parseUsageByModel)
  harnessEstimateCompactTokens?: number | null;
  // "telemetry" | "transcript" | null(2026-08-10 이전 run — 전부 transcript 방식이었다).
  harnessEstimateSource?: string | null;
};

// 수치의 출처. telemetry면 측정 대상 CLI가 OpenTelemetry로 직접 보고한 값이라 "추정치"가 아니라
// CLI 공식 값이다 — 화면에서 이 둘을 같은 라벨로 뭉뚱그리면 안 된다(신뢰도가 다르다).
export type UsageSource = "telemetry" | "transcript";

export type EfficiencyDisplay = {
  durationMs: number;
  // **주 지표**(2026-08-10 통합): 비용을 토큰처럼 읽히는 눈금으로 바꾼 값(100만 가중 토큰 = $1,
  // pricing.ts). 하드컷·점수·화면이 전부 이 축 하나를 쓴다.
  weightedTokens: number | null;
  // 위 값이 실제 비용에서 나온 게 아니라 **raw 토큰을 그대로 갖다 쓴 근사치**인지. 비용 데이터가
  // 없는 옛 run(2026-08-07 이전에 저장돼 모델별 분해가 아예 없는 경우)에서만 true다 — 그때는
  // 가중치를 계산할 방법이 없다. 눈금 자체가 "전형적 run이면 가중 토큰 ≈ raw 토큰"이 되도록
  // 잡혀 있어서(pricing.ts) 근사로 쓸 만하지만, 모델·캐시 구성이 반영되지 않은 값이므로
  // 화면에서 반드시 근사임을 밝힌다.
  weightedTokensApproximated: boolean;
  // 보조 지표: 실제로 오간 raw 토큰 수. 컨텍스트 크기를 가늠할 때만 의미가 있고, 구독 한도 소모와는
  // 비례하지 않는다(캐시 읽기가 대부분이면 raw는 커도 소모는 작다).
  tokens: number | null;
  costUsd: number | null; // 추정치. auto=CLI의 total_cost_usd, manual=CLI 텔레메트리 값 또는 단가 환산치
  isHarnessEstimate: boolean; // true면 tokens/durationMs가 CLI 공식 값이 아니라 러너가 직접 집계한 값(docs/evaluation.md)
  // 아래는 mode=manual + 비용 데이터가 있는 run에서만 채워진다.
  byModel: UsageByModel | null; // 모델별(fast mode 포함) 토큰 분해
  unpricedModels: string[]; // 단가 테이블에 없는 모델 — 있으면 costUsd는 하한값이다
  compactApproxTokens: number | null; // /compact 근사치가 집계에 섞인 양(추정 신뢰도 표시용)
  // mode=manual일 때만 채워진다. null이면 이 필드가 생기기 전(2026-08-10 이전)에 저장된 run이며
  // 전부 transcript 방식이다 — 화면에서는 "출처 불명"이 아니라 transcript로 취급해도 된다.
  usageSource: UsageSource | null;
};

const NO_COST_DETAIL = {
  byModel: null,
  unpricedModels: [] as string[],
  compactApproxTokens: null,
  usageSource: null,
};

// 비용이 있으면 가중 토큰으로 환산하고, 없으면 raw 토큰을 근사치로 쓴다.
//
// 비용이 없는 경우는 딱 하나 — 2026-08-07 이전에 저장돼 모델별 분해가 아예 없는 옛 run이다. 그때는
// 가중치를 계산할 방법이 없는데, 그렇다고 주 지표를 통째로 "—"로 비워버리면 과거 run의 종합 점수가
// 전부 품질 점수만으로 재계산돼 이력 비교가 무너진다. 가중 토큰 눈금 자체가 "전형적 run이면 가중
// 토큰 ≈ raw 토큰"이 되도록 실측 중앙값에 맞춰져 있으므로(pricing.ts), raw 토큰을 근사로 쓰는 게
// 가장 덜 왜곡된 선택이다 — 대신 근사라는 사실을 플래그로 같이 돌려줘서 화면에 밝힌다.
function weightedFrom(
  costUsd: number | null,
  rawTokens: number | null,
): { weightedTokens: number | null; weightedTokensApproximated: boolean } {
  if (costUsd != null) return { weightedTokens: toWeightedTokens(costUsd), weightedTokensApproximated: false };
  return { weightedTokens: rawTokens, weightedTokensApproximated: rawTokens != null };
}

// Prisma Json 컬럼에서 온 값이라 타입이 unknown이다 — 모양이 안 맞으면 조용히 null로 떨어뜨린다.
export function parseUsageByModel(value: unknown): UsageByModel | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: UsageByModel = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const u = raw as Record<string, unknown>;
    const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    out[key] = {
      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      cacheWrite5mTokens: num(u.cacheWrite5mTokens),
      cacheWrite1hTokens: num(u.cacheWrite1hTokens),
      cacheReadTokens: num(u.cacheReadTokens),
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function getEfficiencyDisplay(run: RunEfficiencyFields): EfficiencyDisplay {
  // 수동 모드(mode=manual)는 completed든 disqualified든 애초에 CLI 공식 usage/total_cost_usd 자체가
  // 없다(대화형 세션이라 -p/--output-format json 결과가 없음) — 항상 harnessEstimate* 필드를 쓴다.
  // 이 추정치는 여러 사례로 교차검증한 결과 CLI 공식 합계와 정확히 일치했지만(manualRun.ts 상단 주석
  // 참고), 애초에 공식 구조화 출력이 없는 대화형 세션이라는 사실 자체 때문에 auto 모드의 completed
  // 값과는 시각적으로 구분해서 보여준다.
  //
  // 비용은 2026-08-07부터 모델별 단가 환산치를 보여준다(그 전까지는 항상 null이었다 — CLI가 안
  // 알려준다는 이유였지만, 그 결과 Fable 5로 돈 run과 Sonnet 5로 돈 run이 같은 토큰 수면 완전히
  // 동일해 보이는 문제가 있었다). 저장된 byModel 원자료에 **현재** 단가 테이블을 다시 곱하므로,
  // pricing.ts에 모델을 추가하면 과거 run도 소급해서 제대로 계산된다.
  if (run.mode === "manual") {
    const byModel = parseUsageByModel(run.harnessEstimateUsageByModel);
    const source: UsageSource = run.harnessEstimateSource === "telemetry" ? "telemetry" : "transcript";

    // 텔레메트리 run은 **저장된 costUsd가 CLI가 직접 계산한 값**이다 — byModel에 우리 단가를 다시
    // 곱하면 안 된다. 두 가지 이유로 값이 달라진다: (1) OTel의 cacheCreation은 5분/1시간 TTL 구분이
    // 없어 우리가 1시간 버킷에 넣어두는데, 5분 캐시가 섞여 있었다면 과대평가된다. (2) 애초에 CLI가
    // 계산한 값을 우리 테이블로 덮어쓸 이유가 없다(그게 정답이다).
    // 반대로 트랜스크립트 run은 예전대로 현재 단가 테이블을 다시 곱한다 — 그래야 pricing.ts에
    // 모델을 추가했을 때 과거 run도 소급 반영된다.
    const recomputed = source === "transcript" && byModel ? estimateCostUsd(byModel) : null;
    // byModel이 없는 옛 run은 저장된 스냅샷(그것도 없으면 null)으로 폴백한다.
    const costUsd = recomputed ? recomputed.costUsd : (run.harnessEstimateCostUsd ?? null);
    const weighted = weightedFrom(costUsd, run.harnessEstimateTokens);

    return {
      durationMs: run.harnessEstimateElapsedMs ?? run.durationMs,
      ...weighted,
      tokens: run.harnessEstimateTokens,
      costUsd,
      isHarnessEstimate: true,
      byModel,
      unpricedModels: recomputed?.unpricedModels ?? [],
      compactApproxTokens: run.harnessEstimateCompactTokens ?? null,
      usageSource: source,
    };
  }

  if (run.status === "completed") {
    const tokens =
      (run.usageInputTokens ?? 0) +
      (run.usageOutputTokens ?? 0) +
      (run.usageCacheCreationInputTokens ?? 0) +
      (run.usageCacheReadInputTokens ?? 0);
    return {
      durationMs: run.durationMs,
      ...weightedFrom(run.totalCostUsdEstimate, tokens),
      tokens,
      costUsd: run.totalCostUsdEstimate,
      isHarnessEstimate: false,
      ...NO_COST_DETAIL,
    };
  }

  if (run.status === "disqualified") {
    return {
      durationMs: run.harnessEstimateElapsedMs ?? run.durationMs,
      // auto 모드 실격 run은 비용을 아예 기록하지 않았다 — raw 토큰을 근사로 쓴다.
      ...weightedFrom(null, run.harnessEstimateTokens),
      tokens: run.harnessEstimateTokens,
      costUsd: null,
      isHarnessEstimate: true,
      ...NO_COST_DETAIL,
    };
  }

  // failed: 러너가 subprocess를 죽인 게 아니라 CLI/환경 쪽이 죽었으므로 토큰조차 신뢰성 있게 못 얻는다.
  return {
    durationMs: run.durationMs,
    weightedTokens: null,
    weightedTokensApproximated: false,
    tokens: null,
    costUsd: null,
    isHarnessEstimate: false,
    ...NO_COST_DETAIL,
  };
}

// --- 모델 분해 표시 헬퍼 ---

// "claude-opus-5" -> "opus-5", "claude-opus-5:fast" -> "opus-5 (fast)"
export function shortModelLabel(usageKey: string): string {
  const { model, fast } = describeUsageKey(usageKey);
  const short = model.replace(/^claude-/, "");
  return fast ? `${short} (fast)` : short;
}

// 사용량 많은 순으로 정렬한 모델별 분해 — 표/목록에서 "어떤 모델로 얼마나 썼나"를 보여줄 때 쓴다.
export function modelBreakdownRows(
  byModel: UsageByModel | null,
): { usageKey: string; label: string; tokens: number }[] {
  if (!byModel) return [];
  return Object.entries(byModel)
    .map(([usageKey, usage]) => ({
      usageKey,
      label: shortModelLabel(usageKey),
      tokens: sumModelTokenUsage(usage),
    }))
    .filter((row) => row.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

// 한 줄짜리 요약 라벨: "opus-5 + sonnet-5". 분해 정보가 없으면 null.
export function summarizeModels(byModel: UsageByModel | null): string | null {
  const rows = modelBreakdownRows(byModel);
  return rows.length > 0 ? rows.map((r) => r.label).join(" + ") : null;
}

export type JudgeScoreItem = { criterion: string; score: number; reasoning: string };

// Prisma Json 컬럼에서 온 값이라 타입이 unknown이다 — 방어적으로 파싱한다.
export function parseJudgeScores(judgeScores: unknown): JudgeScoreItem[] {
  if (!Array.isArray(judgeScores)) return [];
  return judgeScores.filter(
    (item): item is JudgeScoreItem =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as JudgeScoreItem).criterion === "string" &&
      typeof (item as JudgeScoreItem).score === "number",
  );
}

// 이력 목록처럼 한 줄로 스캔해야 하는 곳에서 쓰는 평균 점수(5점 만점). 항목이 없으면 null.
export function averageJudgeScore(judgeScores: unknown): number | null {
  const items = parseJudgeScores(judgeScores);
  if (items.length === 0) return null;
  return items.reduce((sum, item) => sum + item.score, 0) / items.length;
}

// --- 종합 점수(100점 만점, 80점 통과) ---
// CLAUDE.md 원칙("효율성과 품질은 다른 축이다 — 사용자가 명시적으로 요청하기 전까지는 합치지
// 않는다")의 예외 조항이 발동된 경우다: 사용자가 명시적으로 "80점 기준 통과, 기준 토큰 초과·테스트
// 실패·품질 저하 시 80점을 못 넘게" 요청해서 만들었다(docs/evaluation.md 참고). run.status ===
// "completed"이고 evaluation이 존재할 때만 계산한다 — disqualified/failed는 애초에 평가를 안 하므로
// 종합 점수도 없다(null). 2026-08-06 사용자 요청으로 품질:토큰효율 = 7:3 가중(시간은 0%, 아래
// QUALITY_WEIGHT/TOKEN_WEIGHT 참고)으로 재조정 — docs/evaluation.md 참고.
export type OverallScoreEvaluationFields = {
  testPassed: boolean | null; // testCommand 없으면 null(테스트 컴포넌트 없음)
  judgeScores: unknown; // Evaluation.judgeScores (Prisma Json) — averageJudgeScore로 파싱
};

export type OverallScoreInput = {
  status: "completed" | "disqualified" | "failed";
  evaluation: OverallScoreEvaluationFields | null;
  referenceWeightedTokens?: number | null; // Problem.referenceWeightedTokens (가중 토큰 단위)
  // getEfficiencyDisplay(run).weightedTokens — 비용을 가중 토큰으로 환산한 값(100만 = $1).
  // 하드컷과 같은 축이라 "점수는 비용, 실격은 토큰" 같은 축 불일치가 더 이상 없다.
  weightedTokens: number | null;
  // Problem.tokenScoreZeroAtRatio — 토큰효율 점수가 0에 도달하는 기준선 대비 배율.
  // 없으면 DEFAULT_TOKEN_SCORE_ZERO_AT_RATIO(=2)로 예전과 동일하게 동작한다.
  tokenScoreZeroAtRatio?: number | null;
  // Problem.judgeScoreFloor — 채점 평균이 품질 0%에 닿는 하한선. 없으면 전역 JUDGE_SCORE_FLOOR.
  judgeScoreFloor?: number | null;
  // 시간 감점용(2026-08-11). 셋 중 하나라도 없으면 시간 감점은 적용되지 않는다.
  durationMs?: number | null; // Run.durationMs — 세션 시작~"완료" 클릭까지의 벽시계 시간
  targetDurationMs?: number | null; // Problem.targetDurationMs — 이 시간을 넘으면 깎기 시작
  maxDurationMs?: number | null; // Problem.maxDurationMs — 여기 도달하면 감점 최대
};

export type OverallScoreResult = {
  score: number; // 0~100, 정수
  passed: boolean; // score >= 80
  reasons: string[]; // 80점 미만 강제 캡이 걸린 이유(없으면 빈 배열)
  timePenalty: number; // 시간 초과로 깎인 점수(0이면 적정 시간 안에 끝냈다는 뜻)
};

// 품질(테스트+채점) : 토큰효율 = 0.7 : 0.3. 이 둘의 가중 평균이 "본점수"이고, 시간은 아래
// computeTimePenalty로 그 위에서 차감하는 별도 축이다(가중치를 나눠 갖지 않는다).
const QUALITY_WEIGHT = 0.7;
const TOKEN_WEIGHT = 0.3;

// 적정 시간(Problem.targetDurationMs)을 넘긴 순간부터 하드컷(maxDurationMs)까지 선형으로 깎는
// 최대 감점 폭. 하드컷에 도달하면 어차피 실격이라 점수 자체가 없으므로, 이 값은 "하드컷 직전까지
// 끌었을 때의 감점"이다.
//
// 20점인 이유: 통과 기준이 80점이라, 다른 게 완벽해도(100점) 하드컷 직전까지 끌면 정확히 통과선에
// 걸치게 된다 — 시간이 결과를 뒤집을 만큼은 무겁고, 품질/토큰을 압도하지는 않는 지점. 조정하려면
// 이 상수만 바꾸면 된다(docs/evaluation.md에 근거를 같이 기록할 것).
const MAX_TIME_PENALTY = 20;

// 2026-08-11 도입. 그전까지 시간 가중치는 0%였다 — "maxDurationMs 하드컷이 이미 시간 초과를
// 실격으로 배제하니 점수에서 또 깎으면 이중 벌점"이라는 이유였다(2026-08-06). 실측이 그 전제를
// 무너뜨렸다: 저장된 완료 run 23건의 소요 시간이 전부 1~14분인데 하드컷은 40~120분이라, 하드컷은
// 단 한 번도 작동한 적이 없다. 즉 "이중 벌점"이 아니라 애초에 벌점이 하나도 없었고, 시간은 사실상
// 무제한이었다. 그래서 계단식(넘으면 실격 / 안 넘으면 무차별) 대신 적정선부터 완만히 깎는다.
function computeTimePenalty(
  durationMs: number | null | undefined,
  targetDurationMs: number | null | undefined,
  maxDurationMs: number | null | undefined,
): number {
  if (durationMs == null || targetDurationMs == null || maxDurationMs == null) return 0;
  if (!(maxDurationMs > targetDurationMs)) return 0; // loadProblem이 막지만 방어적으로
  if (durationMs <= targetDurationMs) return 0;
  const ratio = (durationMs - targetDurationMs) / (maxDurationMs - targetDurationMs);
  return MAX_TIME_PENALTY * Math.min(1, ratio);
}

// 토큰효율 서브점수(0~100), 연속값. 기준선 이하면 만점, **0점 도달 배율**(zeroAtRatio) 이상이면
// 0점, 그 사이는 선형 보간 — 이전 버전의 "기준 초과 시 79점 캡" 이진 방식 대신 사용량에 비례해 깎인다.
//
// 2026-08-10: 입력이 **가중 토큰**으로 통합됐다. 그 전에는 "raw 토큰 × 비용 배율"이라는 부분
// 정규화를 썼는데(2026-08-07), 그건 모델 차이만 반영하고 토큰 종류 차이(캐시 읽기 0.1배 등)는
// 반영하지 못했다. 가중 토큰은 비용 자체를 눈금만 바꾼 값이라 모델·토큰종류 가중이 모두 들어간다.
// 하드컷과 완전히 같은 축이라, 실격 판정과 점수가 서로 다른 걸 재던 문제도 없어진다.
//
// 2026-08-11까지는 0점 도달 배율이 2로 고정이었다. 2026-08-12에 문제별 knob
// (Problem.tokenScoreZeroAtRatio)으로 열었다 — 문제마다 "기준선을 넘겼다"의 의미가 다르기 때문이다
// (problems.ts의 해당 필드 주석에 근거). 기본값은 2라서 지정하지 않은 문제는 동작이 완전히 같다.
export const DEFAULT_TOKEN_SCORE_ZERO_AT_RATIO = 2;

// LLM 채점 평균(1~5)을 품질 서브점수(0~100%)로 옮길 때 쓰는 **하한선**. 이 점수 이하면 0%,
// 5.0이면 100%, 사이는 선형이다.
//
// 왜 그냥 `avg/5`가 아닌가 (2026-08-14, 실사용 실측): 채점자는 실제로 4~5에 몰린다. 저장된 완료
// run 40여 건에서 테스트를 통과한 run의 rubric은 거의 전부 3.4~4.67 구간이었고, `avg/5`로는 이
// 좁은 구간이 68~93%로 눌려서 **변별이 거의 안 생겼다.** 실사용 사례: 소넷으로 공학용 계산기를
// 한 번에 만든 run(ef6e1ffc)이 rubric 4.67 / 723,019 가중 토큰으로 **97점**을 받았는데, 사용자가
// "그 정도면 90점이 적당하다"고 판단했다. `avg/5`에서는 rubric 3.0(평범)조차 83점이 나온다.
//
// 3.5로 잡은 근거: 위 run이 정확히 91점이 되는 지점이다(요청 기준 "70만 토큰 · 채점 4.7 → 90점
// 정도"). 이제 만점(5.0)에 가까울수록 100점에 붙고, 4.3 아래로 내려가면 다른 축이 완벽해도
// 통과선(80점) 밑으로 떨어진다 — docs/evaluation.md의 재보정 절 참고.
export const JUDGE_SCORE_FLOOR = 3.5;

// 채점 평균(1~5) → 품질 서브점수(0~100). 위 JUDGE_SCORE_FLOOR 주석 참고.
//
// floor는 문제별로 덮어쓸 수 있다(Problem.judgeScoreFloor) — 같은 채점 모델이라도 루브릭 문구에
// 따라 후함이 통째로 달라지기 때문이다(problems.ts의 해당 필드 주석에 실측 근거).
export function judgeComponentFromAverage(judgeAvg: number, floor?: number | null): number {
  const f = floor ?? JUDGE_SCORE_FLOOR;
  return Math.max(0, Math.min(1, (judgeAvg - f) / (5 - f))) * 100;
}

function computeTokenComponent(
  weightedTokens: number | null,
  referenceWeightedTokens: number | null | undefined,
  zeroAtRatio: number | null | undefined,
): number | null {
  if (weightedTokens == null || referenceWeightedTokens == null || referenceWeightedTokens <= 0) {
    return null;
  }
  // loadProblem이 1 이하를 막지만, 저장된 옛 데이터/직접 호출에 대비해 방어적으로 기본값으로 되돌린다
  // (1 이하를 그대로 쓰면 0으로 나누거나 기준선 이하에서도 0점이 된다).
  const zero =
    zeroAtRatio != null && zeroAtRatio > 1 ? zeroAtRatio : DEFAULT_TOKEN_SCORE_ZERO_AT_RATIO;
  const ratio = weightedTokens / referenceWeightedTokens;
  if (ratio <= 1) return 100;
  if (ratio >= zero) return 0;
  return 100 * ((zero - ratio) / (zero - 1));
}

export { BASELINE_MODEL, fromWeightedTokens, toWeightedTokens };

export function computeOverallScore(input: OverallScoreInput): OverallScoreResult | null {
  if (input.status !== "completed" || !input.evaluation) return null;

  const { testPassed, judgeScores } = input.evaluation;

  // 품질 서브점수: 있는 컴포넌트만 가중 평균(테스트 0.4 / 채점 0.6). 하나만 있으면 그대로, 둘 다
  // 없으면(이론상 없어야 하지만 방어적으로) 종합 점수 자체를 표시하지 않는다.
  const testComponent = testPassed === null ? null : testPassed ? 100 : 0;
  const judgeAvg = averageJudgeScore(judgeScores);
  const judgeComponent =
    judgeAvg === null ? null : judgeComponentFromAverage(judgeAvg, input.judgeScoreFloor);

  let qualityComponent: number;
  if (testComponent !== null && judgeComponent !== null) {
    qualityComponent = testComponent * 0.4 + judgeComponent * 0.6;
  } else if (testComponent !== null) {
    qualityComponent = testComponent;
  } else if (judgeComponent !== null) {
    qualityComponent = judgeComponent;
  } else {
    return null;
  }

  // 품질/토큰효율을 있는 것만 가중 평균(둘 다 있으면 0.7/0.3, 토큰효율 없으면 품질만).
  const tokenComponent = computeTokenComponent(
    input.weightedTokens,
    input.referenceWeightedTokens,
    input.tokenScoreZeroAtRatio,
  );
  const subscore =
    tokenComponent === null
      ? qualityComponent
      : qualityComponent * QUALITY_WEIGHT + tokenComponent * TOKEN_WEIGHT;

  // 하드 캡: 테스트가 있었는데 실패했으면 80점 미만으로 강제한다 — 효율(토큰)로 정답이 아닌
  // 결과를 상쇄해서 통과시키는 걸 막기 위함. 토큰은 더 이상 하드 캡이 아니라 위 연속 점수로만
  // 반영된다.
  // 시간 감점: 가중 평균으로 나온 본점수에서 차감한다. 가중치를 나눠 갖는 4번째 컴포넌트가 아니라
  // "적정 시간 안에 끝냈으면 0, 넘긴 만큼 깎임"이라는 별도 축이다 — 빨리 끝냈다고 가산점을 주지는
  // 않는다(그러면 품질을 희생해 서두르는 게 이득이 된다).
  const timePenalty = computeTimePenalty(
    input.durationMs,
    input.targetDurationMs,
    input.maxDurationMs,
  );

  const reasons: string[] = [];
  if (testPassed === false) {
    reasons.push("테스트 실패");
  }
  const capped = reasons.length > 0 ? Math.min(subscore, 79) : subscore;

  const score = Math.max(0, Math.min(100, Math.round(capped - timePenalty)));
  if (timePenalty > 0 && score < 80) {
    reasons.push(`적정 시간 초과(-${Math.round(timePenalty)}점)`);
  }
  return { score, passed: score >= 80, reasons, timePenalty };
}
