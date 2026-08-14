// 모델별 토큰 단가 테이블 + 비용 추정.
//
// 왜 필요한가: manualRun.ts는 원래 input/output/cache_creation/cache_read 네 종류를 1:1로 더한
// 단일 숫자 하나만 집계했다. 그 값은 (1) 모델이 뭐였는지, (2) 토큰 종류가 뭐였는지를 전혀 구분하지
// 않는다. 그런데 실제 단가는 모델 간 최대 10배(Fable 5 output $50 vs Haiku 4.5 output $5), 토큰
// 종류 간 최대 20배(1시간 캐시 쓰기 = input×2 vs 캐시 읽기 = input×0.1) 차이가 난다. 즉 "토큰
// 90만"이라는 같은 숫자가 실제로는 몇 배씩 다른 소비를 가리킬 수 있었다(2026-08-07 사용자 지적).
//
// 중요: 토큰 "개수"는 모델을 바꿔도 크게 안 변한다. Fable 5 / Opus 5 / Sonnet 5는 전부 Opus 4.7에서
// 도입된 같은 토크나이저 계열이라 같은 텍스트면 토큰 수가 거의 같다. 5배니 3배니 하는 차이는 전부
// "토큰당 단가" 차이다 — 이 파일이 다루는 게 정확히 그 부분이다.
//
// 이 값들은 Anthropic 1st-party API 정가(공식 문서 기준)다. 다만 이 프로젝트는 구독 로그인(OAuth)
// 으로 claude.exe를 돌리므로 **실제 청구는 발생하지 않는다** — 여기서 계산하는 USD는 "같은 작업을
// API 종량제로 돌렸다면 얼마였을까"라는 환산치이며, 모델 간 소비를 공정하게 비교하기 위한 척도다.
// 그래서 화면에는 항상 "추정치"로 표시한다(CLAUDE.md의 "토큰/시간 수치는 항상 하네스 추정치라고
// 밝혀라" 원칙의 연장선).

// $/1M 토큰. 캐시/특수 단가는 아래 배수로 유도한다(Anthropic 가격 체계가 그렇게 정의돼 있다).
export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
};

// 캐시 토큰 단가 배수 — input 단가에 곱한다.
//   - 캐시 읽기: 0.1배
//   - 캐시 쓰기: TTL에 따라 5분 1.25배 / 1시간 2배
// 트랜스크립트의 usage.cache_creation이 TTL별로 쪼개져 나오므로(실측 확인: ephemeral_5m_input_tokens /
// ephemeral_1h_input_tokens) 뭉뚱그리지 않고 각각 정확히 곱한다. Claude Code CLI는 실측상 1시간 TTL을
// 쓰고 있었다 — 1.25배로 뭉뚱그렸으면 캐시 쓰기 비용을 60% 과소평가했을 것이다.
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2;

// 키는 트랜스크립트의 message.model 값 그대로. fast mode(usage.speed === "fast")는 같은 모델이라도
// 단가가 다르므로 ":fast" 접미사를 붙인 별도 키로 관리한다(usageKeyFor 참고).
//
// Sonnet 5는 2026-08-31까지 인트로 단가($2/$10)가 적용되지만 여기서는 정가($3/$15)를 쓴다:
// 날짜에 따라 단가가 바뀌면 러너가 시계를 보고 분기해야 하는데, 그건 "러너는 멍청하게" 원칙에
// 어긋나고 같은 run을 나중에 다시 렌더할 때 값이 달라지는 문제도 생긴다. 정가 기준으로 Fable 5는
// Sonnet 5의 3.33배다(인트로 단가 기준으로는 5배).
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-mythos-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  // fast mode는 같은 Opus 5를 더 빠르게 돌리는 대신 프리미엄 단가($10/$50)가 붙는다.
  "claude-opus-5:fast": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8:fast": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

// --- 가중 토큰(weighted tokens): 토큰 축과 비용 축을 하나로 합친 단위 (2026-08-10) ---
//
// 배경: 지금까지 "토큰"과 "비용"을 두 축으로 나란히 보여줬는데, 사실 사람이 알고 싶은 건 하나다 —
// **"이 run이 내 구독 한도를 얼마나 깎아먹었나"**. 그리고 그 답은 raw 토큰 수가 아니다. 구독 플랜의
// 사용 한도는 토큰 1:1 합이 아니라 모델과 토큰 종류로 가중돼서 소모되기 때문이다(캐시 읽기는 캐시
// 요율로 잡히고, Opus는 Sonnet보다 비싸게 — docs/evaluation.md의 "비용 하드컷 추가" 절).
//
// 그래서 **제한은 비용으로 걸고, 표시는 그 비용에 가중치가 반영된 "토큰"으로 한다**(사용자 결정).
// 가중 토큰은 비용을 토큰처럼 읽히는 눈금으로 바꾼 것뿐이다:
//
//     1 가중 토큰 = $0.000001   (즉 100만 가중 토큰 = $1)
//
// 왜 하필 이 눈금인가: 저장된 실제 run 17건에서 **raw 토큰 1M당 비용의 중앙값이 $1.001**이었다.
// 즉 이 눈금에서는 "전형적인 run이면 가중 토큰 ≈ raw 토큰"이 성립해서, 기존에 쓰던 예산 숫자
// (하드컷 2,000,000 / 기준선 900,000·1,100,000)의 감각과 크기가 그대로 유지된다. 동시에 가중치는
// 온전히 살아있다 — 같은 raw 토큰이라도 Opus로 쓰면 가중 토큰이 늘고(실측 최대 1.58배), 캐시를
// 잘 태운 Sonnet 세션은 줄어든다(실측 최소 0.62배).
//
// 정직하게: 이건 "구독 한도의 몇 %"가 아니다. 그 진짜 수치는 `/usage`가 읽는 서버 엔드포인트에만
// 있고 공개 API가 없다(docs/evaluation.md). 가중 토큰은 한도 소모에 **비례하는** 양이다.
export const USD_PER_WEIGHTED_TOKEN = 0.000001;

/** 비용(USD) → 가중 토큰. 화면·하드컷 비교에 쓰는 정수값. */
export function toWeightedTokens(costUsd: number): number {
  return Math.round(costUsd / USD_PER_WEIGHTED_TOKEN);
}

/** 가중 토큰 → 비용(USD). 문제 파일의 maxCostUsd를 화면에 가중 토큰으로 보여줄 때의 역변환. */
export function fromWeightedTokens(weightedTokens: number): number {
  return weightedTokens * USD_PER_WEIGHTED_TOKEN;
}

// 비용 정규화 점수(runDisplay.ts의 computeOverallScore)의 기준 모델. "이 run이 실제로 쓴 비용이,
// 같은 토큰 구성을 기준 모델로 돌렸을 때 대비 몇 배인가"를 계산하는 데 쓴다 — 그 배율만큼 토큰
// 효율 점수를 깎는다. Sonnet 5를 기준으로 두면 기존 referenceTokens 값들을 손대지 않아도 되고
// (Sonnet 5로 돈 run은 배율 1.0이라 점수가 예전과 동일), 더 비싼 모델을 쓴 run만 정확히 단가
// 비율만큼 불리해진다.
export const BASELINE_MODEL = "claude-sonnet-5";

export function usageKeyFor(model: string, speed?: string | null): string {
  return speed === "fast" ? `${model}:fast` : model;
}

// usageKey에서 사람이 읽을 모델명만 떼어낸다(":fast"는 라벨로 따로 표시).
export function describeUsageKey(usageKey: string): { model: string; fast: boolean } {
  return usageKey.endsWith(":fast")
    ? { model: usageKey.slice(0, -":fast".length), fast: true }
    : { model: usageKey, fast: false };
}

export function getModelPricing(usageKey: string): ModelPricing | null {
  return MODEL_PRICING[usageKey] ?? null;
}

// 한 모델(정확히는 usageKey) 안에서의 토큰 종류별 사용량.
export type ModelTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
};

export function emptyModelTokenUsage(): ModelTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
  };
}

export function addModelTokenUsage(target: ModelTokenUsage, delta: ModelTokenUsage): void {
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.cacheWrite5mTokens += delta.cacheWrite5mTokens;
  target.cacheWrite1hTokens += delta.cacheWrite1hTokens;
  target.cacheReadTokens += delta.cacheReadTokens;
}

export function sumModelTokenUsage(usage: ModelTokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheWrite5mTokens +
    usage.cacheWrite1hTokens +
    usage.cacheReadTokens
  );
}

// usageKey -> 종류별 토큰. 트랜스크립트에서 모은 원자료 그대로이며 여기서 가격을 곱한다.
export type UsageByModel = Record<string, ModelTokenUsage>;

export type CostEstimate = {
  costUsd: number; // 단가를 아는 모델만 합산한 값 — unpricedTokens가 0이 아니면 "하한"이다
  // 단가 테이블에 없는 모델(신모델 출시 등)이 섞여 있으면 여기에 모아서 UI가 경고할 수 있게 한다.
  // 조용히 0원으로 처리해서 "싸게 나온 것처럼" 보이게 하지 않기 위함.
  unpricedModels: string[];
  unpricedTokens: number;
};

function costForModel(usage: ModelTokenUsage, pricing: ModelPricing): number {
  const inPrice = pricing.inputPerMTok / 1_000_000;
  const outPrice = pricing.outputPerMTok / 1_000_000;
  return (
    usage.inputTokens * inPrice +
    usage.outputTokens * outPrice +
    usage.cacheWrite5mTokens * inPrice * CACHE_WRITE_5M_MULTIPLIER +
    usage.cacheWrite1hTokens * inPrice * CACHE_WRITE_1H_MULTIPLIER +
    usage.cacheReadTokens * inPrice * CACHE_READ_MULTIPLIER
  );
}

export function estimateCostUsd(byModel: UsageByModel): CostEstimate {
  let costUsd = 0;
  const unpricedModels: string[] = [];
  let unpricedTokens = 0;

  for (const [usageKey, usage] of Object.entries(byModel)) {
    const pricing = getModelPricing(usageKey);
    if (!pricing) {
      unpricedModels.push(usageKey);
      unpricedTokens += sumModelTokenUsage(usage);
      continue;
    }
    costUsd += costForModel(usage, pricing);
  }

  return { costUsd, unpricedModels, unpricedTokens };
}

// "같은 토큰 구성을 BASELINE_MODEL로 돌렸다면 얼마였을까" — 비용 정규화 점수의 분모.
// 단가를 모르는 모델의 토큰은 양쪽(실제/기준) 모두에서 빠지므로 배율 계산이 왜곡되진 않는다.
export function estimateBaselineCostUsd(byModel: UsageByModel): number {
  const baseline = getModelPricing(BASELINE_MODEL);
  if (!baseline) return 0;

  let costUsd = 0;
  for (const [usageKey, usage] of Object.entries(byModel)) {
    if (!getModelPricing(usageKey)) continue; // estimateCostUsd에서 unpriced로 잡히는 것과 동일하게 제외
    costUsd += costForModel(usage, baseline);
  }
  return costUsd;
}

// 실제 비용 / 기준 모델 비용. Sonnet 5로만 돈 run은 1.0, Opus 5만 쓴 run은 약 1.67,
// Fable 5만 쓴 run은 약 3.33이 된다(정가 기준). 모델이 섞여 있으면 사용량 가중 평균이 나온다.
// 분모가 0(집계된 토큰이 없거나 전부 단가 미등록)이면 배율을 정의할 수 없으므로 null.
export function costMultiplierVsBaseline(byModel: UsageByModel): number | null {
  const baselineCost = estimateBaselineCostUsd(byModel);
  if (baselineCost <= 0) return null;
  return estimateCostUsd(byModel).costUsd / baselineCost;
}
