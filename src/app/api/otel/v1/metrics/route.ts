// POST /api/otel/v1/metrics — 측정 대상 claude.exe가 보내는 OpenTelemetry 메트릭 수신구.
//
// 경로가 왜 이 모양인가: OTLP http/json 익스포터는 OTEL_EXPORTER_OTLP_ENDPOINT 뒤에 "/v1/metrics"를
// 스스로 붙여서 POST한다(실측 확인). 그래서 manualRun.ts는 엔드포인트로 ".../api/otel"만 주고,
// 라우트는 그 아래 /v1/metrics 에 둔다.
//
// 이 라우트는 대시보드 UI가 아니라 **측정 대상 프로세스**가 호출한다. 그래서 두 가지를 지킨다:
//  1) 무슨 일이 있어도 200을 돌려준다 — 여기서 4xx/5xx를 내면 claude.exe의 익스포터가 재시도/에러
//     로깅을 하며 측정 대상의 동작(터미널 출력, 지연)에 영향을 줄 수 있다. 파싱 실패는 우리 문제지
//     측정 대상이 알 바가 아니다(CLAUDE.md "측정 대상을 오염시키지 마라").
//  2) 아무 계산도 하지 않는다 — 받아서 telemetry.ts에 넘기기만 한다.
//
// 인증은 없다. 로컬 개발 도구이고 127.0.0.1로만 붙는 엔드포인트라 그대로 둔다 — 대신 귀속되지 않은
// 페이로드는 telemetry.ts가 버리고 카운트만 하므로, 엉뚱한 데이터가 특정 run에 섞여 들어가지 않는다.

import { NextRequest, NextResponse } from "next/server";
import { ingestOtlpMetrics, type OtlpMetricsBody } from "@/lib/telemetry";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as OtlpMetricsBody;
    ingestOtlpMetrics(body);
  } catch (err) {
    // gzip 등 우리가 안 다루는 인코딩이거나 형식이 바뀐 경우 — 조용히 삼키되 서버 로그에는 남긴다.
    console.error("[otel] 메트릭 페이로드 처리 실패(무시하고 200 반환):", err);
  }
  // OTLP/HTTP 성공 응답은 빈 ExportMetricsServiceResponse다.
  return NextResponse.json({});
}
