// Claude Code OpenTelemetry 메트릭 수집기 (2026-08-10 추가).
//
// 왜 필요한가: 지금까지 토큰/비용은 세션 트랜스크립트(.jsonl)를 폴링해서 재계산한 "하네스 추정치"였다.
// 그 값 자체는 정확했지만(교차검증: CLI 공식 usage와 토큰 0 차이, 비용 소수점 7자리 일치) **트랜스크립트에
// usage가 안 남는 호출은 원천적으로 못 잡는다**. 실측으로 확인한 누락분:
//   - 대화 제목 생성(ai-title) 등 Haiku 배경 호출 — CLI의 modelUsage엔 588 in/15 out, $0.000663으로
//     잡히는데 .jsonl에는 결과 텍스트만 남고 usage가 없다
//   - system:away_summary(자리 비움 리캡) — 같은 이유로 크기조차 알 수 없다
//   - /compact 의 실제 API 비용 — compactMetadata.preTokens로 근사만 하고 있었다(manualRun.ts 참고)
//
// Claude Code는 OpenTelemetry로 **CLI 자신이 계산한 값**을 내보낸다(code.claude.com/docs/en/monitoring-usage).
// 이걸 받으면 위 누락이 전부 사라지고, 추정이 아니라 CLI 공식 값이 된다. 실측 검증(2026-08-10):
// 헤드리스 세션 하나에서 OTel 합계와 `--output-format json`의 result.modelUsage가 **모델별로 토큰 0 차이,
// 비용 0 차이**로 일치했고, 트랜스크립트가 놓치던 haiku 배경 호출(603토큰/$0.000663)도 그대로 잡혔다.
//
// --- 실측으로 확인한 프로토콜 세부사항 (여기 구현이 의존하는 전제들) ---
//
// 1) 전송: OTEL_EXPORTER_OTLP_PROTOCOL=http/json 이면 OTEL_EXPORTER_OTLP_ENDPOINT 뒤에 "/v1/metrics"를
//    붙여 POST한다. 그래서 라우트를 src/app/api/otel/v1/metrics 에 두고 엔드포인트로는 .../api/otel 을 준다.
// 2) **aggregationTemporality = 1 (DELTA)**. 각 페이로드는 직전 export 이후의 증분만 담는다 —
//    마지막 페이로드만 보면 안 되고 **전부 더해야** 총합이 된다. (실측: 7개 페이로드를 다 더해야
//    CLI 공식 총합과 일치했다. 마지막 것만 쓰면 87,838 / 실제 253,746.)
// 3) run 귀속: OTEL_RESOURCE_ATTRIBUTES=vibecheck.run_id=<runId> 로 넘긴 커스텀 속성이 리소스 속성에
//    그대로 실려온다. --session-id 와 무관하게 동작하므로 사람이 세션 중 /clear를 해도 귀속이 안 깨진다
//    (트랜스크립트 폴링이 /clear 때문에 겪었던 문제와 같은 함정을 여기서는 구조적으로 피한다).
// 4) 모델 ID는 날짜가 붙은 형태로 올 수 있다(실측: "claude-haiku-4-5-20251001"). 비용은 CLI가 계산해서
//    보내주므로 우리 단가 테이블을 다시 곱하지 않는다 — 단가표에 없는 모델이라고 0원 처리되는 사고가
//    구조적으로 불가능해진다.
// 5) 토큰 종류는 input/output/cacheRead/cacheCreation 네 가지다. **cacheCreation은 5분/1시간 TTL로
//    쪼개져 오지 않는다** — 하지만 비용을 우리가 곱하지 않으므로 이 정보 손실은 비용에 영향이 없다.
//    화면의 모델별 분해 표시를 위해서만 1시간 버킷에 넣는다(실측상 CLI는 1시간 TTL을 쓴다, pricing.ts 참고).
//
// 설계 원칙: 이 모듈은 "받아서 더한다"만 한다(CLAUDE.md "러너는 멍청하게"). 하드컷 판정이나 폴백
// 결정은 manualRun.ts가 한다.

import {
  addModelTokenUsage,
  emptyModelTokenUsage,
  type UsageByModel,
} from "./pricing";

// OTLP http/json 최소 타입 — 우리가 읽는 필드만 정의한다(전체 스키마를 옮겨오지 않는다).
type OtlpAnyValue = { stringValue?: string; intValue?: string | number; doubleValue?: number };
type OtlpKeyValue = { key?: string; value?: OtlpAnyValue };
type OtlpDataPoint = {
  attributes?: OtlpKeyValue[];
  asDouble?: number;
  asInt?: string | number;
};
type OtlpMetric = { name?: string; sum?: { dataPoints?: OtlpDataPoint[] } };
type OtlpScopeMetrics = { metrics?: OtlpMetric[] };
type OtlpResourceMetrics = {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeMetrics?: OtlpScopeMetrics[];
};
export type OtlpMetricsBody = { resourceMetrics?: OtlpResourceMetrics[] };

// runId를 실어 보내는 리소스 속성 키. manualRun.ts가 OTEL_RESOURCE_ATTRIBUTES로 주입하는 값과 반드시 같아야 한다.
export const RUN_ID_RESOURCE_KEY = "vibecheck.run_id";

export type TelemetryUsage = {
  totalTokens: number; // 종류/모델 무관 단순 합 — 트랜스크립트 집계의 totalTokens와 같은 정의(비교 가능)
  costUsd: number; // **CLI가 직접 계산해서 보낸 값**. 우리가 단가를 곱한 환산치가 아니다.
  byModel: UsageByModel; // 화면 표시용 분해(cacheCreation은 TTL 구분 없이 1시간 버킷에 들어간다, 위 5번)
  costByModel: Record<string, number>;
  exportCount: number; // 받은 페이로드 수 — 0이면 텔레메트리가 아예 안 붙은 것이다(폴백 판단에 쓴다)
  lastSeenAtMs: number | null;
};

function emptyUsage(): TelemetryUsage {
  return {
    totalTokens: 0,
    costUsd: 0,
    byModel: {},
    costByModel: {},
    exportCount: 0,
    lastSeenAtMs: null,
  };
}

// runId -> 누적 사용량. Next.js dev 서버는 단일 장수 프로세스라 요청 간에 유지된다
// (manualRun.ts의 activeRuns와 같은 전제).
const byRun = new Map<string, TelemetryUsage>();

// 어떤 run에도 귀속되지 않은 페이로드(리소스 속성이 없거나 모르는 runId)를 몇 개나 버렸는지.
// 조용히 사라지면 "텔레메트리가 왜 0이지"를 디버깅할 수 없으므로 카운트만 해둔다.
let orphanPayloads = 0;

function readAttrs(kvs: OtlpKeyValue[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of kvs ?? []) {
    if (!kv.key) continue;
    const v = kv.value;
    if (!v) continue;
    if (typeof v.stringValue === "string") out[kv.key] = v.stringValue;
    else if (v.intValue !== undefined) out[kv.key] = String(v.intValue);
    else if (v.doubleValue !== undefined) out[kv.key] = String(v.doubleValue);
  }
  return out;
}

function pointValue(dp: OtlpDataPoint): number {
  if (typeof dp.asDouble === "number" && Number.isFinite(dp.asDouble)) return dp.asDouble;
  if (dp.asInt !== undefined) {
    const n = Number(dp.asInt);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// OTel의 토큰 종류 이름 -> 우리 ModelTokenUsage 필드.
// cacheCreation은 TTL 구분 없이 오므로 1시간 버킷으로 보낸다(위 5번 — 비용은 CLI 값을 쓰므로 영향 없음).
const TOKEN_TYPE_FIELD: Record<string, keyof ReturnType<typeof emptyModelTokenUsage>> = {
  input: "inputTokens",
  output: "outputTokens",
  cacheRead: "cacheReadTokens",
  cacheCreation: "cacheWrite1hTokens",
};

/**
 * OTLP 메트릭 페이로드 하나를 받아 누적한다. delta temporality라 호출될 때마다 더하기만 하면 된다(위 2번).
 * 파싱할 수 없는 페이로드는 조용히 무시한다 — 측정 대상(claude.exe)에 영향을 주지 않는 게 우선이다.
 */
export function ingestOtlpMetrics(body: OtlpMetricsBody): void {
  for (const rm of body.resourceMetrics ?? []) {
    const runId = readAttrs(rm.resource?.attributes)[RUN_ID_RESOURCE_KEY];
    if (!runId) {
      orphanPayloads += 1;
      continue;
    }

    let acc = byRun.get(runId);
    if (!acc) {
      acc = emptyUsage();
      byRun.set(runId, acc);
    }
    acc.exportCount += 1;
    acc.lastSeenAtMs = Date.now();

    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const points = metric.sum?.dataPoints ?? [];

        if (metric.name === "claude_code.token.usage") {
          for (const dp of points) {
            const attrs = readAttrs(dp.attributes);
            const field = TOKEN_TYPE_FIELD[attrs.type ?? ""];
            if (!field) continue; // 새 토큰 종류가 생기면 분해에서만 빠진다 — totalTokens는 아래에서 그대로 더한다
            const value = pointValue(dp);
            const model = attrs.model || "unknown";
            // fast mode는 같은 모델이라도 단가가 다르므로 usageKey를 분리한다(pricing.ts usageKeyFor와 같은 규칙).
            const usageKey = attrs.speed === "fast" ? `${model}:fast` : model;

            const existing = acc.byModel[usageKey] ?? emptyModelTokenUsage();
            const delta = emptyModelTokenUsage();
            delta[field] = value;
            addModelTokenUsage(existing, delta);
            acc.byModel[usageKey] = existing;

            acc.totalTokens += value;
          }
          continue;
        }

        if (metric.name === "claude_code.cost.usage") {
          for (const dp of points) {
            const attrs = readAttrs(dp.attributes);
            const model = attrs.model || "unknown";
            const usageKey = attrs.speed === "fast" ? `${model}:fast` : model;
            const value = pointValue(dp);
            acc.costUsd += value;
            acc.costByModel[usageKey] = (acc.costByModel[usageKey] ?? 0) + value;
          }
        }
      }
    }
  }
}

/** 이 run에 대해 지금까지 받은 누적치. 페이로드를 한 번도 못 받았으면 null. */
export function getTelemetryUsage(runId: string): TelemetryUsage | null {
  const acc = byRun.get(runId);
  return acc && acc.exportCount > 0 ? acc : null;
}

/** run이 끝나 저장까지 마쳤을 때 호출 — 서버 프로세스에 무한히 쌓이는 걸 막는다. */
export function clearTelemetry(runId: string): void {
  byRun.delete(runId);
}

/** 진단용: 귀속 실패한 페이로드 수. 0이 아니면 OTEL_RESOURCE_ATTRIBUTES 주입이 깨진 것이다. */
export function getOrphanPayloadCount(): number {
  return orphanPayloads;
}
