// 수동 모드 러너: 사람이 VS Code + 대화형 Claude Code CLI로 직접 바이브 코딩하는 걸 측정한다.
// runner.ts의 runBenchmark()(헤드리스 자동 실행, --print --output-format stream-json)와는 완전히
// 다른 실행 경로다 — 이 모듈은 대화형 세션(생성된 워크스페이스의 VS Code 통합 터미널)을 띄우고 그
// 프로세스를 "관찰"만 한다(한도 초과 시 강제 종료 제외). CLAUDE.md 원칙(측정 대상 오염 금지, 러너는
// 멍청하게, 실행은 항상 격리)은 이 모드에서도 동일하게 적용된다.
//
// claude.exe는 별도 Windows Terminal 창이 아니라 VS Code의 자동 태스크(.vscode/tasks.json,
// runOptions.runOn: "folderOpen")로 통합 터미널 안에서 뜬다(writeVsCodeAutoRunTask 참고). 처음 여는
// 워크스페이스 폴더라면 VS Code가 "이 폴더 작성자를 신뢰합니까?" 창을 띄우고, 사람이 그걸 눌러야
// 태스크가 실행된다 — vibecheck-runs 상위 폴더를 한 번 "부모 폴더 전체 신뢰"로 신뢰해두면 이후
// 모든 run에서 다시 뜨지 않는다(일회성 로컬 설정). 이 지연 때문에 claude.exe PID를 찾는 데
// 예전(wt.exe 즉시 실행)보다 오래(사람이 창을 알아채고 클릭할 때까지) 걸릴 수 있어서, PID 탐색은
// startManualRun()의 반환을 막지 않고 백그라운드에서 계속 재시도한다(아래 findClaudePidBySessionId
// 호출부 참고) — 시간/토큰 집계 자체는 startedAtMs 기준으로 이미 정상 진행되고, PID를 못 찾은
// 동안만 하드컷 강제 종료가 불가능하다.
//
// 토큰 추정치는 세션 트랜스크립트를 폴링해서 집계한다(message.id 기준 dedup, 아래 참고). **파일
// 하나가 아니라 워크스페이스에 대응하는 프로젝트 디렉터리 전체(그 안의 .jsonl 전부)를 매번 다시
// 나열해서 합산한다** — 사람이 세션 중 `/clear`를 쓰면 Claude Code CLI가 원래 --session-id로 지정한
// runId와 무관한 새 sessionId로 새 .jsonl 파일을 만들어버리기 때문이다(실측으로 발견: 같은
// 워크스페이스 프로젝트 디렉터리 안에 서로 다른 sessionId의 .jsonl이 여러 개 쌓여 있었음, 아래
// sumWorkspaceTokenUsage 참고). 파일 하나만 폴링하던 이전 구현은 `/clear` 이후 토큰 집계가 그
// 자리에서 멈춰버렸다 — 단순 부정확함이 아니라 `/clear`로 토큰 하드컷을 우회할 수 있었던 버그다.
//
// 기존 완료된 auto 모드 run 여러 건(예: 88003/106791/77366 토큰)으로 교차검증한 결과 이 방식으로
// 재계산한 합계가 CLI 공식 usage 합계와 **정확히 일치**했다 — 처음엔 "37% 적게 나온다"는 의심이
// 있었지만, 그건 별개로 존재하던 runner.ts 실시간 진행률 표시 쪽 값과 비교한 착오였고 최종 저장된
// 공식 값과는 일치했다. 그래도 대화형 세션은 애초에 `--output-format json`류 공식 구조화 결과 자체가
// 없으므로(비대화형 전용 기능), 화면/DB에서는 여전히 "하네스 추정치"로 표시한다 — CLI 공식 값이
// 아니라는 사실 자체는 변하지 않는다.
//
// --- 다음 사람(dashboard-engineer, API 라우트 구현 담당)을 위한 사용 계약(contract) ---
//
// 1) 사람이 "시작" 버튼을 누르면:
//      const runId = randomUUID(); // 응답을 먼저 내려줘야 하면 API 라우트가 미리 생성
//      const problem = loadProblem(problemId);
//      const { workspacePath, claudePid } = await startManualRun(problem, {
//        runId,
//        onProgress: (p) => { ... },       // 선택: SSE 등으로 실시간 push하고 싶을 때만
//        onDisqualified: (info) => { ... }, // 선택: 한도 초과로 강제 종료된 순간 알림 받고 싶을 때만
//        onProcessExited: () => { ... },    // 선택: 사람이 스스로 세션을 끝냈을 때(터미널 닫음 등) 알림
//      });
//    콜백 없이도 getManualRunStatus(runId)로 폴링(GET) 방식으로 진행 상황을 조회할 수 있다 —
//    Next.js dev 서버는 단일 장수 Node 프로세스이므로 activeRuns 맵이 요청 간에 유지된다.
//
// 2) 사람이 "완료" 버튼을 누르면:
//      const final = completeManualRun(runId, workspacePath);
//      // final = { runId, status: "completed" | "disqualified", disqualifyReason, harnessEstimate }
//    이 함수는 claude.exe 프로세스를 죽이지 않는다 — 추적만 멈춘다(사람이 터미널을 계속 보고 싶을 수 있음).
//    그 다음 saveManualRun(...)(db.ts)으로 DB에 저장한다. status가 "completed"인 경우에만
//    evaluator.ts로 평가를 이어서 돌린다(docs/evaluation.md — disqualified는 평가 생략).
//
// 3) 상태 조회(선택, 폴링 GET용): getManualRunStatus(runId) — 없으면 null.
//
// 4) 단계형 문제(problem.stages가 있는 경우)에서 사람이 "이 단계 제출" 버튼을 누르면:
//      const result = await submitStage(runId);
//      // 통과: { passed: true, completedStageIndex, nextStage: {...} | null(마지막 단계였음) }
//      // 실패: { passed: false, stageIndex }  — 어떤 검증에서 떨어졌는지 세부사항은 안 준다(트랩 유지)
//    통과하면 다음 단계 리소스가 워크스페이스에 자동으로 풀린다(unlockPath 복사) — 사람은 대시보드에
//    새로 보여지는 nextStage.promptAddition을 보고 계속 이어서 작업하면 된다. 단계형이 아닌 문제에서
//    호출하면 에러를 던진다.
//
// 5) 실격/완료 후 사람이 "다시 하기"를 누르면(같은 문제를 새 workspace로 다시 풀고 싶을 때):
//      await killClaudeProcessForRun(oldRunId); // best-effort, 실패해도 무시하고 계속 진행
//      const newRunId = randomUUID();
//      const { workspacePath } = await startManualRun(problem, { runId: newRunId, reuseWindow: true });
//    reuseWindow:true면 새 VS Code 창을 또 띄우는 대신 "code -r"로 마지막 활성 창을 재사용한다 —
//    VS Code 창 자체를 프로세스로 찾아 강제 종료하지 않는다(파일 상단 tryOpenVsCode 주석 참고: 이
//    컴퓨터에서 VS Code는 대개 싱글 인스턴스라 이름/커맨드라인 매칭으로 죽이면 사람의 다른 무관한
//    VS Code 창까지 같이 죽을 위험이 있다). killClaudeProcessForRun은 이전 run의 claude.exe만
//    정확한 PID로 죽인다(완료 시점엔 안 죽이지만, "다시 하기"는 사람이 명시적으로 "이건 이제 필요
//    없다"고 표시한 것이므로 여기서는 죽인다).
//
// 이 모듈은 DB를 전혀 모른다(runner.ts와 동일한 설계 — "러너는 멍청하게"). 저장은 호출자(API 라우트)가
// db.ts의 saveManualRun()으로 한다.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyIntoWorkspace,
  createWorkspace,
  getWorkspacesBaseDir,
  type DisqualifyReason,
} from "./runner";
import { runTests } from "./evaluator";
import { resolveProjectPath, type Problem, type ProblemStage } from "./problems";
import {
  addModelTokenUsage,
  emptyModelTokenUsage,
  estimateCostUsd,
  usageKeyFor,
  type CostEstimate,
  type UsageByModel,
} from "./pricing";
import { clearTelemetry, getTelemetryUsage, RUN_ID_RESOURCE_KEY } from "./telemetry";

// 수동 모드 전용 도구 범위 — runner.ts의 ALLOWED_TOOLS(헤드리스 auto 모드, 4개로 좁힘)와는 별개 상수다.
// auto 모드는 그대로 두고(레거시, 웹 플로우에서 안 씀 — CLAUDE.md 참고) 수동 모드만 Agent(서브에이전트
// 호출)/Skill을 추가로 연다 — 참가자가 CLAUDE.md/스킬/서브에이전트를 실제로 활용하는 것 자체가 이제
// 측정 대상이기 때문이다(아래 "--safe-mode 완화" 섹션, docs/problem-set.md의 "워크스페이스에 CLAUDE.md를
// 써서 방향을 잡아주기, 스킬/훅을 구성하기" 참고). Workflow/SendMessage 등 오케스트레이션급 도구는
// 여전히 뺀다 — 범위를 넓히면 측정 대상 자체가 무의미하게 흐려진다(사람이 승인한 범위, 2026-08-05).
const MANUAL_ALLOWED_TOOLS = "Read,Edit,Write,Bash,Agent,Skill";

// --- OpenTelemetry(측정 대상 CLI가 스스로 보고하는 사용량) 설정 ---
//
// 트랜스크립트 폴링은 .jsonl에 usage가 안 남는 호출(제목 생성용 Haiku 배경 호출, away_summary 등)을
// 원천적으로 못 잡는다. Claude Code는 OTel로 자기가 계산한 토큰/비용을 내보내므로 그걸 받는다
// (telemetry.ts 상단에 실측 근거와 프로토콜 세부사항 정리).
//
// 엔드포인트는 대시보드 서버 자신이다 — 별도 포트를 열지 않고 Next 라우트(/api/otel/v1/metrics)로 받는다.
// http/json 익스포터가 "/v1/metrics"를 스스로 붙이므로 여기서는 ".../api/otel"까지만 준다.
// 포트가 3000이 아니면 VIBECHECK_OTEL_ENDPOINT로 통째로 덮어쓸 수 있다.
function otelEndpoint(): string {
  const override = process.env.VIBECHECK_OTEL_ENDPOINT;
  if (override) return override;
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}/api/otel`;
}

// 기본 export 주기는 60초인데, 그러면 하드컷이 최대 1분 늦게 발동한다(그 사이 예산을 크게 넘길 수 있다).
// 5초로 줄인다 — 로컬 루프백으로 작은 JSON을 보내는 것뿐이라 측정 대상에 주는 부담은 무시할 수준이다.
const OTEL_EXPORT_INTERVAL_MS = 5000;

function telemetryEnv(runId: string): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: otelEndpoint(),
    OTEL_METRIC_EXPORT_INTERVAL: String(OTEL_EXPORT_INTERVAL_MS),
    // run 귀속용. --session-id와 별개로 실어 보내므로 사람이 세션 중 /clear를 해도 귀속이 안 깨진다
    // (트랜스크립트 폴링이 /clear로 겪었던 함정을 여기서는 구조적으로 피한다).
    OTEL_RESOURCE_ATTRIBUTES: `${RUN_ID_RESOURCE_KEY}=${runId}`,
    // 로그/이벤트는 안 받는다 — 프롬프트 본문까지 흘러들어올 수 있고, 우리가 필요한 건 메트릭뿐이다.
    OTEL_LOGS_EXPORTER: "none",
  };
}

const POLL_INTERVAL_MS = 2500;
// claude.exe가 이미 신뢰된 워크스페이스라면 VS Code 자동 태스크가 곧바로 뜨므로 몇 초면 찾아진다.
const FIND_PID_INTERVAL_MS = 500;
// 처음 여는 워크스페이스는 VS Code 워크스페이스 신뢰 창을 사람이 직접 클릭해야 태스크가 실행되므로
// 훨씬 오래 걸릴 수 있다 — startManualRun()을 그동안 블로킹하지 않고 이 시간 동안 백그라운드에서
// 계속 재시도한다(위 파일 상단 주석 참고).
const PID_SEARCH_TIMEOUT_MS = 5 * 60_000;
const PID_SEARCH_INTERVAL_MS = 2000;
// 추적하던 claude.exe가 사라진 뒤 "정말 끝난 것"으로 확정하기까지 기다리는 유예. 사람이 컨텍스트를
// 나누려고 세션을 끝내고 새 터미널을 여는 데 걸리는 시간을 덮는다(pollOnce 주석). 이 시간이 소요
// 시간에 더해지지는 않는다 — 얼릴 때 사라진 시점의 스냅샷을 쓴다.
const EXIT_GRACE_MS = 3 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- 트랜스크립트 경로 계산 ---
//
// ~/.claude/projects/<슬러그>/<session_id>.jsonl (docs/cli-spec.md).
// 슬러그 규칙은 이 컴퓨터의 실제 ~/.claude/projects/ 디렉터리를 실측해서 확인함: 절대 경로 문자열에서
// 영숫자가 아닌 문자(드라이브 콜론 ":", 경로 구분자 "\") 하나하나를 각각 "-"로 치환한다(합치지 않음 —
// 예: "C:\Users\..." -> "C--Users-..." 처럼 ":"와 "\"가 연속이면 대시도 두 개 연속으로 나온다).
// 기존 하이픈은 그대로 유지된다(하이픈도 비영숫자라 "-"로 치환되지만 결과가 원래와 동일해 무해함).
export function computeClaudeProjectSlug(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, "-");
}

// 워크스페이스 하나(=run 하나)에 대응하는 프로젝트 디렉터리. 실측으로 발견한 함정(아래 sumWorkspaceTokenUsage
// 참고) 때문에 "파일 하나"가 아니라 "이 디렉터리 전체"를 폴링 단위로 삼는다.
//
// homeDir을 반드시 인자로 받는다(os.homedir() 고정 금지) — --safe-mode를 빼면서 claude.exe 자식
// 프로세스의 USERPROFILE/HOME을 run마다 격리된 "가짜 홈"으로 오버라이드하게 됐기 때문에(아래
// createIsolatedHomeDir 참고), 트랜스크립트도 이 서버 프로세스의 진짜 홈이 아니라 그 가짜 홈 밑
// <fakeHome>/.claude/projects/<slug>/에 쌓인다. 여기서 os.homedir()을 계속 쓰면 폴링이 엉뚱한(항상
// 비어있는) 디렉터리를 보게 되어 토큰 집계가 조용히 0으로 멈춘다 — 예전 --safe-mode 시절엔 진짜 홈과
// 가짜 홈이 같아서 이 버그가 드러나지 않았을 뿐이다.
function computeClaudeProjectDir(workspacePath: string, homeDir: string): string {
  const slug = computeClaudeProjectSlug(path.resolve(workspacePath));
  return path.join(homeDir, ".claude", "projects", slug);
}

// --- 트랜스크립트 토큰 집계 (runner.ts의 실시간 stdout 집계 로직과 동일한 합산식, 입력만 다르다) ---
//
// 세션 트랜스크립트 JSONL은 raw stdout stream-json과 형태가 다르다(docs/cli-spec.md) — 한 턴이
// 콘텐츠 블록마다 여러 줄로 쪼개져 나오고 그 각 줄에 같은 turn의 usage가 반복해서 찍힌다. 그래서
// runner.ts처럼 "assistant 줄마다 무조건 더하기"를 하면 안 되고, message.id 기준으로 그 turn을
// 딱 한 번만 집계해야 한다(실측 확인, docs/cli-spec.md의 경고 참고).
// 파일이 쓰이는 도중이라 마지막 줄이 불완전(JSON.parse 실패)할 수 있다 — 그 경우는 조용히 무시한다.
//
// --- /compact 비용 근사치 가산 (2026-08-06, 의도적 예외) ---
//
// CLAUDE.md의 "러너는 멍청하게 — 휴리스틱 넣지 마라" 원칙에서 벗어나는 예외를 의도적으로 하나 둔다.
// 실측 결과: 사람이 세션 중 `/compact`를 실행하면 트랜스크립트에
//   1) {"type":"user","message":{"content":"/compact"}}
//   2) {"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger":"manual",
//      "preTokens":41690,"postTokens":5686,"cumulativeDroppedTokens":36004,...}}
//   3) {"type":"user","isCompactSummary":true,"message":{"content":"<요약문>"}} (usage 없음)
// 순서로 기록되는데, 이 셋 중 어디에도 message.usage가 있는 "assistant" 줄이 없다 — 즉 압축 자체가
// 실제로 소비한 API 호출 비용(입력/출력/캐시 토큰)이 위 assistant 집계 로직으로는 전혀 안 잡힌다.
//
// 별도의 통제된 라이브 실험(claude -p "/compact" --resume <sessionId> --output-format stream-json,
// 헤드리스 모드)으로 공식 값의 존재 자체는 확인했다 — 최종 result 줄의 modelUsage에 실제 API 호출
// 결과(inputTokens+outputTokens+cacheReadInputTokens+cacheCreationInputTokens 합계 32,730)가 찍힌다.
// 하지만 이 값은 --print 모드에서만 stdout에 한 번 찍히고 사라지며, **온디스크 세션 트랜스크립트
// 파일(.jsonl)에는 전혀 저장되지 않는다**(grep으로 직접 확인, 0건). 우리 하네스는 대화형(--print
// 아님) 세션의 온디스크 트랜스크립트만 폴링하므로, 공식 값 자체에는 원천적으로 접근할 방법이 없다.
//
// 같은 헤드리스 실험에서 compact_boundary 이벤트도 같이 관찰됐는데(단 그쪽은 stream-json 변환을
// 거쳐 필드명이 snake_case: compact_metadata.pre_tokens=30468), 그 값을 실제 modelUsage 합계
// (32,730)와 비교하면 약 7% 낮게(93% 수준으로) 근사한다 — 완벽하진 않지만 근거 있는 근사치임을
// 확인했다. 사용자에게 "이 갭을 문서화만 하고 둘지, preTokens를 근사치로 추정 합계에 더할지" 확인한
// 결과 후자를 선택했다(완전히 안 잡는 것보단 근사치라도 반영하는 게 낫다는 판단, docs/manual-mode.md
// 참고).
//
// 그래서 온디스크 트랜스크립트(camelCase — --print 모드의 snake_case 변환형과 다름에 주의)의
// event.compactMetadata?.preTokens를 assistant usage 합계에 그대로 가산한다. compact_boundary는
// "system" 타입이라 위 message.id dedup과 겹치지 않으므로 별도로 그냥 더한다 — 같은 파일에 /compact가
// 여러 번 있으면 그때마다 발생한 preTokens를 전부 더한다(각 압축 시점의 실제 컨텍스트 크기이므로 중복이
// 아니다). 값이 없거나 숫자가 아니면 방어적으로 0으로 취급한다.
// --- 모델별/토큰종류별 분해 (2026-08-07 추가) ---
//
// 예전엔 이 함수가 숫자 하나(네 종류를 1:1로 더한 합계)만 돌려줬다. 그 값은 어떤 모델로 쓴 토큰인지도,
// 어떤 종류의 토큰인지도 구분하지 않는다 — 그런데 실제 단가는 모델 간 최대 10배, 토큰 종류 간 최대
// 20배까지 차이가 난다(pricing.ts 참고). 즉 "토큰 90만"이 실제로는 몇 배씩 다른 소비를 가리킬 수
// 있었다. 그래서 이제 분해까지 같이 돌려준다.
//
// 다행히 필요한 정보가 트랜스크립트에 전부 들어있다(실측 확인):
//   - message.model            — 이 turn을 처리한 모델 ("claude-opus-5", "claude-sonnet-5" ...)
//   - usage.speed              — "fast"면 fast mode 프리미엄 단가 적용 대상
//   - usage.cache_creation     — { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }로 TTL별 분리.
//                                캐시 쓰기 단가가 5분 1.25배 / 1시간 2배로 다르므로 뭉뚱그리면 안 된다
//                                (실측상 Claude Code CLI는 1시간 TTL을 쓴다 — 뭉뚱그렸으면 60% 과소평가).
//
// totalTokens는 **예전 계산식을 그대로** 유지한다. 토큰 하드컷(maxTokens)의 기준값이라 여기서 정의가
// 바뀌면 문제별 예산(problems/*.json의 실측으로 잡은 값)이 전부 무의미해지기 때문이다 — 비용은 별도
// 축으로 병기한다(CLAUDE.md "효율성과 품질은 다른 축" 원칙과 같은 맥락, 2026-08-07 사용자 결정).
export type TranscriptUsage = {
  totalTokens: number; // 종류/모델 무관 단순 합계 — 하드컷 판정용(예전 값과 완전히 동일)
  byModel: UsageByModel; // usageKey -> 종류별 토큰 (pricing.ts가 여기에 단가를 곱한다)
  // 아래 compact 근사치가 byModel에 얼마나 섞여 들어갔는지 — 추정의 신뢰도를 UI에서 밝히기 위한 값.
  compactApproxTokens: number;
};

export function emptyTranscriptUsage(): TranscriptUsage {
  return { totalTokens: 0, byModel: {}, compactApproxTokens: 0 };
}

function accumulate(byModel: UsageByModel, usageKey: string): ReturnType<typeof emptyModelTokenUsage> {
  const existing = byModel[usageKey];
  if (existing) return existing;
  const fresh = emptyModelTokenUsage();
  byModel[usageKey] = fresh;
  return fresh;
}

export function parseTranscriptUsage(transcriptFilePath: string): TranscriptUsage {
  const result = emptyTranscriptUsage();

  let content: string;
  try {
    content = readFileSync(transcriptFilePath, "utf8");
  } catch {
    return result; // 세션이 막 시작해서 트랜스크립트 파일이 아직 없을 수 있다 — 0으로 취급
  }

  const lines = content.split("\n");
  const seenMessageIds = new Set<string>();
  // compact_boundary 이벤트에는 모델 정보가 없다 — 직전 assistant turn이 쓰던 모델에 귀속시킨다(아래).
  let lastUsageKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      // 파일 쓰기 도중의 불완전한 줄(대부분 마지막 줄) — 무시하고 계속
      continue;
    }

    if (event.type === "system" && event.subtype === "compact_boundary") {
      // /compact 실제 API 호출 비용의 근사치 — 공식 값(modelUsage)이 아니다, 위 주석 참고.
      const compactMetadata = event.compactMetadata as { preTokens?: unknown } | undefined;
      const preTokens = compactMetadata?.preTokens;
      if (typeof preTokens === "number" && Number.isFinite(preTokens)) {
        result.totalTokens += preTokens;
        result.compactApproxTokens += preTokens;
        // 비용 환산 시 이 토큰들을 **캐시 읽기**(input 단가의 0.1배)로 취급한다. 근거: /compact 호출은
        // 직전까지의 대화를 다시 읽어 요약하는 것이고, 그 대화는 방금 전 turn에서 이미 캐시에 올라가
        // 있다(실측상 이 세션들의 cache_read가 cache_creation을 압도한다). 이걸 정가 input으로 치면
        // 비용이 10배 부풀어서, 하필 "컨텍스트 관리를 잘 하면 이득"을 측정하려는 inventory-digest-staged
        // 문제에서 /compact를 쓰는 게 손해처럼 보이는 정반대 왜곡이 생긴다. 추정 위에 얹은 또 하나의
        // 가정이므로 compactApproxTokens로 따로 노출해서 UI가 밝힐 수 있게 해뒀다.
        if (lastUsageKey) {
          accumulate(result.byModel, lastUsageKey).cacheReadTokens += preTokens;
        }
      }
      continue;
    }

    if (event.type !== "assistant") continue;
    const message = event.message as
      | { id?: string; model?: string; usage?: Record<string, unknown> }
      | undefined;
    if (!message?.usage) continue;

    if (message.id) {
      if (seenMessageIds.has(message.id)) continue; // 같은 turn이 블록별로 반복되는 걸 중복 집계 방지
      seenMessageIds.add(message.id);
    }

    const u = message.usage;
    const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

    const inputTokens = num(u.input_tokens);
    const outputTokens = num(u.output_tokens);
    const cacheCreationTotal = num(u.cache_creation_input_tokens);
    const cacheReadTokens = num(u.cache_read_input_tokens);

    // 예전 계산식 그대로 — 하드컷 기준값은 절대 바꾸지 않는다(위 주석).
    result.totalTokens += inputTokens + outputTokens + cacheCreationTotal + cacheReadTokens;

    // model이 없는 줄은 이론상 없어야 하지만, 있어도 조용히 0원 처리하지 않도록 "unknown"으로 남겨서
    // pricing.ts의 unpricedModels에 잡히게 한다(싸게 나온 것처럼 보이는 게 최악).
    const usageKey = usageKeyFor(message.model ?? "unknown", typeof u.speed === "string" ? u.speed : null);
    lastUsageKey = usageKey;

    const cacheCreation = u.cache_creation as Record<string, unknown> | undefined;
    const cacheWrite5m = num(cacheCreation?.ephemeral_5m_input_tokens);
    let cacheWrite1h = num(cacheCreation?.ephemeral_1h_input_tokens);
    // cache_creation 객체가 아예 없거나(구버전 트랜스크립트) TTL 합이 총계와 안 맞으면, 남는 만큼을
    // **1시간 버킷(비싼 쪽, 2배)**에 넣는다 — 총 토큰 수는 항상 보존한다.
    //
    // 2026-08-12 수정: 예전엔 남는 만큼을 5분 버킷(1.25배)에 넣으면서 "비용을 과대평가하지 않는다"고
    // 적어놨는데, 이 값은 하드컷(maxCostUsd)의 입력이라 **위험한 방향은 과대평가가 아니라 과소평가**다.
    // 게다가 실측상 Claude Code CLI는 1시간 TTL을 쓰므로(pricing.ts) 5분으로 치는 건 근거도 없이
    // 37.5% 싸게 잡는 것이었다 — 하드컷을 그만큼 느슨하게 만든다. TTL을 모를 때는 비싼 쪽으로
    // 가정하는 게 하드컷 원칙에 맞고, 실측 기준으로도 그쪽이 정확하다.
    const remainder = cacheCreationTotal - (cacheWrite5m + cacheWrite1h);
    if (remainder > 0) cacheWrite1h += remainder;

    addModelTokenUsage(accumulate(result.byModel, usageKey), {
      inputTokens,
      outputTokens,
      cacheWrite5mTokens: cacheWrite5m,
      cacheWrite1hTokens: cacheWrite1h,
      cacheReadTokens,
    });
  }

  return result;
}

// 실측으로 발견한 함정: 사람이 세션 중에 `/clear`를 입력하면, Claude Code CLI는 기존 세션 파일에
// 이어쓰지 않고 **같은 프로젝트 디렉터리 안에 완전히 새 sessionId로 새 .jsonl 파일을 만든다**
// (--session-id로 지정한 원래 runId와 무관한 랜덤 uuid). 그래서 시작 시점에 계산해둔 파일 하나만
// 계속 폴링하면(예전 구현 — computeTranscriptPath), 사람이 `/clear`를 한 번이라도 쓰는 순간부터는
// 실제로는 계속 토큰을 쓰고 있어도 집계값이 그 자리에서 완전히 멈춰버린다. 실사용 중 실측으로 확인:
// 같은 워크스페이스의 프로젝트 디렉터리 안에 서로 다른 sessionId의 .jsonl 3개가 순서대로 쌓여
// 있었다(최초 세션 1개 + `/clear` 2번). CLAUDE.md의 "토큰/시간 한도는 하드컷이다" 원칙상 이건 단순
// 부정확함이 아니라 `/clear`로 하드컷 자체를 우회할 수 있다는 뜻이라 반드시 고쳐야 하는 버그였다.
//
// 고친 방법: 파일 하나가 아니라 **워크스페이스에 대응하는 프로젝트 디렉터리 전체**(그 안의 .jsonl
// 전부)를 폴링마다 다시 나열해서 합산한다. 워크스페이스 경로 자체가 실행마다 새로 생성되는 고유
// 디렉터리이므로(CLAUDE.md "실행은 항상 격리한다"), 그 프로젝트 디렉터리에 생기는 .jsonl은 몇 번을
// `/clear`로 새로 시작해도 전부 이 run에 속한다고 안전하게 볼 수 있다(cwd가 같으면 슬러그도 같다).
// 파일마다 message.id 집합이 독립적이라(랜덤 uuid, 파일 간 충돌 가능성 없음) 파일별 합계를 그냥
// 더하면 된다 — 굳이 파일을 가로질러 중복 제거할 필요가 없다.
export function sumWorkspaceUsage(workspacePath: string, homeDir: string): TranscriptUsage {
  const dir = computeClaudeProjectDir(workspacePath, homeDir);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return emptyTranscriptUsage(); // 세션이 막 시작해서 프로젝트 디렉터리가 아직 없을 수 있다 — 0으로 취급
  }

  const merged = emptyTranscriptUsage();
  for (const file of entries) {
    if (!file.endsWith(".jsonl")) continue;
    const usage = parseTranscriptUsage(path.join(dir, file));
    merged.totalTokens += usage.totalTokens;
    merged.compactApproxTokens += usage.compactApproxTokens;
    for (const [usageKey, modelUsage] of Object.entries(usage.byModel)) {
      addModelTokenUsage(accumulate(merged.byModel, usageKey), modelUsage);
    }
  }
  return merged;
}

// --- claude.exe 프로세스 찾기/종료 (CommandLine의 runId 매칭 — 이름만으로 절대 매칭하지 않는다) ---

type ClaudeProcessInfo = { pid: number; commandLine: string };

const PS_QUERY_CLAUDE_PROCESSES =
  "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | " +
  "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";

function queryClaudeProcesses(): Promise<ClaudeProcessInfo[]> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PS_QUERY_CLAUDE_PROCESSES],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    ps.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    ps.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    ps.on("error", reject);
    ps.on("close", (code) => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        // claude.exe가 하나도 없으면 Get-CimInstance는 빈 출력을 낸다 — 에러가 아니라 "0개"로 취급
        if (code !== 0 && stderr.trim()) {
          reject(new Error(`[manualRun] claude.exe 프로세스 조회 실패(exit ${code}): ${stderr.slice(-500)}`));
          return;
        }
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as
          | { ProcessId?: number; CommandLine?: string }
          | { ProcessId?: number; CommandLine?: string }[];
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        resolve(
          arr
            .filter((p): p is { ProcessId: number; CommandLine?: string } => typeof p.ProcessId === "number")
            .map((p) => ({ pid: p.ProcessId, commandLine: p.CommandLine ?? "" })),
        );
      } catch (err) {
        reject(new Error(`[manualRun] claude.exe 프로세스 조회 결과 파싱 실패: ${(err as Error).message}`));
      }
    });
  });
}

// runId가 CommandLine에 포함된 claude.exe 프로세스만 정확히 찾는다 — 이 컴퓨터엔 사람의 다른 진짜
// claude.exe가 항상 떠 있으므로 절대 이름만으로 매칭하지 않는다(CLAUDE.md 안전 수칙).
//
// 자동 태스크 세션은 --session-id로, 사람이 수동으로 연 터미널 세션은 심이 붙이는 --name
// vibecheck-<runId>로 runId가 CommandLine에 들어간다(createClaudeShimDir 주석) — 그래서 한 run에
// 속한 claude.exe가 여러 개일 수 있고(세션 분리), 여기서는 전부 돌려준다.
async function findClaudePidsForRun(runId: string): Promise<number[]> {
  let processes: ClaudeProcessInfo[] = [];
  try {
    processes = await queryClaudeProcesses();
  } catch (err) {
    console.warn(`[manualRun] claude.exe 프로세스 조회 중 에러: ${(err as Error).message}`);
    return [];
  }
  return processes.filter((p) => p.commandLine.includes(runId)).map((p) => p.pid);
}

// VS Code 자동 태스크가 claude.exe를 실제로 띄우는 데 시간이 걸릴 수 있어(워크스페이스 신뢰 창
// 포함, 파일 상단 주석 참고) 짧은 간격으로 재시도한다.
async function findClaudePidBySessionId(
  runId: string,
  { timeoutMs = PID_SEARCH_TIMEOUT_MS, intervalMs = FIND_PID_INTERVAL_MS } = {},
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = await findClaudePidsForRun(runId);
    if (pids.length > 0) return pids[0];
    await sleep(intervalMs);
  }
  return null;
}

// Node 문서에 나온 방식: signal 0은 실제로 죽이지 않고 프로세스 존재 여부만 확인한다.
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 이 run에 속한 claude.exe를 **전부** 강제 종료한다. 세션을 나눈 사람은 같은 run 안에 살아있는
// 프로세스가 여러 개일 수 있는데(findClaudePidsForRun 주석), 추적 중인 하나만 죽이면 하드컷이
// 발동해도 나머지 세션이 계속 돌아 예산을 더 태운다 — "한도는 하드컷" 원칙이 새는 구멍이다.
// 매칭은 여전히 CommandLine의 runId 기준이라 사람의 다른 claude.exe는 절대 건드리지 않는다.
async function killAllClaudeProcessesForRun(runId: string, trackedPid: number | null): Promise<number> {
  const pids = new Set(await findClaudePidsForRun(runId));
  if (trackedPid != null) pids.add(trackedPid);

  let killed = 0;
  for (const pid of pids) {
    if (!isProcessAlive(pid)) continue;
    await killProcessForcibly(pid);
    killed += 1;
  }
  return killed;
}

// 정확한 PID만 강제 종료한다 — 절대 이름만으로 매칭하지 않는다(안전 수칙).
function killProcessForcibly(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const tk = spawn("taskkill", ["/PID", String(pid), "/F"], { windowsHide: true });
    tk.on("close", () => resolve());
    tk.on("error", () => resolve()); // 이미 죽어있어도(가장 흔한 실패 사유) 여기서 막지 않는다
  });
}

// --- 런타임 상태 추적 ---

// 토큰(하드컷 기준값)과 비용(모델 단가 반영)을 한 묶음으로 나른다. 둘 다 하네스 추정치다 —
// 토큰은 트랜스크립트 파싱 기반이고, 비용은 거기에 정가 테이블(pricing.ts)을 곱한 환산치다.
// 구독 로그인이라 실제 청구는 발생하지 않으므로 비용은 "API 종량제였다면" 기준의 비교용 척도다.
// 이 수치가 어디서 왔는지 — 화면에서 반드시 밝힌다(둘의 신뢰도가 다르다).
//   "telemetry"  = 측정 대상 CLI가 OpenTelemetry로 직접 보고한 값. CLI 공식 값 그 자체이고,
//                  트랜스크립트에 안 남는 배경 호출(제목 생성 Haiku, away_summary)과 /compact의
//                  실제 비용까지 포함한다. 비용도 CLI가 계산한 값이라 우리 단가표를 곱하지 않는다.
//   "transcript" = 예전 방식(세션 .jsonl 폴링 + 정가 테이블 환산). 텔레메트리가 안 붙었을 때의 폴백.
export type UsageSource = "telemetry" | "transcript";

export type ManualUsageEstimate = {
  tokens: number;
  byModel: UsageByModel;
  compactApproxTokens: number; // source가 telemetry면 항상 0 — 근사할 필요 없이 실제 비용이 잡히기 때문
  cost: CostEstimate;
  source: UsageSource;
};

function toUsageEstimate(usage: TranscriptUsage): ManualUsageEstimate {
  return {
    tokens: usage.totalTokens,
    byModel: usage.byModel,
    compactApproxTokens: usage.compactApproxTokens,
    cost: estimateCostUsd(usage.byModel),
    source: "transcript",
  };
}

// 텔레메트리와 트랜스크립트를 둘 다 계산해서 **비용이 큰 쪽을 통째로** 쓴다.
//
// 왜 "큰 쪽"인가: 텔레메트리는 배경 호출까지 포함하므로 정상 동작하면 항상 트랜스크립트보다 크거나
// 같다. 트랜스크립트 쪽이 더 크게 나오는 경우는 (a) 텔레메트리 export 주기(5초) 만큼 뒤처졌거나
// (b) 텔레메트리가 도중에 끊긴 것뿐이다. 그때 작은 쪽을 쓰면 하드컷이 느슨해진다 —
// CLAUDE.md "토큰/시간 한도는 하드컷이다" 원칙상 한도를 우회할 여지를 만들면 안 된다.
// (`/clear`로 토큰 집계를 멈출 수 있었던 예전 버그와 같은 종류의 실수를 반복하지 않기 위한 방어다.)
//
// **비교 축은 반드시 하드컷 축과 같아야 한다(2026-08-12 수정).** 예전엔 여기서 totalTokens를 비교했는데,
// 하드컷은 pollOnce()에서 비용(maxCostUsd)으로 건다. 이 둘은 같은 축이 아니다 — 캐시 읽기는 토큰 1개당
// 비용이 input의 0.1배라, 캐시 히트가 많은 쪽은 **토큰이 더 큰데 비용은 더 작을 수 있다**. 그래서 옛
// 코드는 "토큰이 큰 쪽"을 고르면서 실제로는 "비용이 작은 쪽"을 집어들 수 있었고, 그 순간 하드컷이
// 느슨해진다 — 위 주석이 막으려던 바로 그 상황이다. 실제로 성립하는 조합:
//   - 텔레메트리가 export 주기만큼 뒤처진 순간(트랜스크립트 토큰 > 텔레메트리 토큰)
//   - 트랜스크립트 쪽에만 /compact 근사치(preTokens)가 토큰으로 더해지는데, 그 근사치는 비용 환산 시
//     캐시 읽기 단가(0.1배)로 계산된다 — 토큰은 크게 밀어올리고 비용은 거의 안 올리는 항목이다
//   - Sonnet 5처럼 CLI가 인트로 단가를 쓰는 모델에서 두 경로의 단가 자체가 다른 경우
// 동점이면 텔레메트리를 쓴다(CLI 공식 값이라 신뢰도가 높고, 배경 호출까지 포함한다).
//
// 왜 항목별 max가 아니라 "통째로"인가: 토큰은 텔레메트리, 비용은 트랜스크립트 식으로 섞으면
// 화면에 서로 앞뒤가 안 맞는 숫자 조합이 나온다. 한 소스 안에서 일관되게 유지한다.
function collectUsage(state: TrackingState): ManualUsageEstimate {
  const fromTranscript = toUsageEstimate(sumWorkspaceUsage(state.workspacePath, state.fakeHomeDir));

  const tel = getTelemetryUsage(state.runId);
  if (!tel) return fromTranscript;

  const fromTelemetry: ManualUsageEstimate = {
    tokens: tel.totalTokens,
    byModel: tel.byModel,
    compactApproxTokens: 0,
    cost: {
      costUsd: tel.costUsd,
      // 텔레메트리 경로에는 "단가를 모르는 모델" 개념이 없다 — 비용을 CLI가 계산해서 보내주므로
      // 우리 단가표에 없는 신모델이 나와도 0원으로 새어나가지 않는다.
      unpricedModels: [],
      unpricedTokens: 0,
    },
    source: "telemetry",
  };

  return fromTelemetry.cost.costUsd >= fromTranscript.cost.costUsd ? fromTelemetry : fromTranscript;
}

export type ManualRunProgress = {
  tokensUsedEstimate: number;
  costUsdEstimate: number;
  usageSource: UsageSource; // telemetry면 CLI 공식 값, transcript면 예전 폴백 추정치(UsageSource 주석)
  elapsedMs: number;
};

export type ManualDisqualifyInfo = {
  reason: DisqualifyReason;
  tokensUsedEstimate: number;
  costUsdEstimate: number;
  usageSource: UsageSource;
  elapsedMs: number;
};

export type StartManualRunOptions = {
  runId: string; // --session-id로 그대로 넘긴다(UUID). 워크스페이스 경로로 프로젝트 디렉터리를 계산해서
  // 그 안의 .jsonl 전부를 폴링한다(sumWorkspaceTokenUsage 참고) — runId 자체를 파일명으로 다시 쓰진
  // 않는다(사람이 세션 중 `/clear`를 쓰면 Claude Code가 이 runId와 무관한 새 세션 파일을 만들기 때문).
  onProgress?: (p: ManualRunProgress) => void;
  onDisqualified?: (info: ManualDisqualifyInfo) => void; // 한도 초과로 강제 종료된 순간 1회 호출
  onProcessExited?: () => void; // 사람이 스스로 세션을 끝내서(터미널 닫음 등) claude.exe가 사라진 걸 감지했을 때 1회 호출
  // "다시 하기"(재시도) 흐름에서만 true — 새 VS Code 창을 또 띄우지 않고 "code -r"로 마지막 활성
  // 창을 재사용한다(runner.ts의 createWorkspace/tryOpenVsCode 참고). 실패한 이전 run의 claude.exe
  // 프로세스를 죽이는 건 이 옵션과 무관하게 호출자(API 라우트)가 killClaudeProcessForRun()으로
  // 먼저 해야 한다 — startManualRun()은 새 run만 신경 쓴다.
  reuseWindow?: boolean;
};

type TrackingState = {
  runId: string;
  problemId: string;
  workspacePath: string;
  fakeHomeDir: string; // 이 run의 claude.exe가 USERPROFILE/HOME으로 쓰는 격리된 홈 — 트랜스크립트도 여기 밑에 쌓인다
  problem: Problem;
  claudePid: number | null;
  startedAtMs: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  disqualifyReason: DisqualifyReason | null;
  // 진행 중에는 계속 갱신되다가, 강제종료/프로세스자연종료/completeManualRun 중 가장 먼저
  // 일어난 시점에 값이 얼려진다(freeze) — completeManualRun을 누르기 전까지 UI를 보고 있던
  // 유휴 시간이 "실행 시간"에 섞여 들어가는 걸 막기 위함.
  frozen: boolean;
  finalUsage: ManualUsageEstimate;
  finalElapsedMs: number;
  // 추적하던 claude.exe가 사라졌지만 아직 "세션 종료"로 확정하지 않은 상태(pollOnce 주석 참고).
  // 사람이 세션을 나누는 중일 수 있어서 유예를 두고, 유예가 끝나면 **사라진 그 시점의 값으로**
  // 얼린다 — 유예 시간이 소요 시간에 섞이면 안 되므로 스냅샷을 여기 들고 있는다.
  pendingExit: { atMs: number; usage: ManualUsageEstimate; elapsedMs: number } | null;
  // 단계형 문제가 아니면 null. 단계형이면 "사람이 지금 풀고 있는 단계"(1부터 시작) — submitStage()가
  // 통과시킬 때마다 1씩 증가한다. 마지막 단계까지 통과하면 stages.length를 넘어서는 값이 된다
  // (더 이상 제출할 단계가 없다는 뜻으로 쓰인다, submitStage 참고).
  currentStageIndex: number | null;
  onProgress?: (p: ManualRunProgress) => void;
  onDisqualified?: (info: ManualDisqualifyInfo) => void;
  onProcessExited?: () => void;
};

// Next.js dev 서버는 단일 장수 Node 프로세스이므로 이 모듈 레벨 Map이 API 요청 간에 유지된다.
// 서버가 재시작되면 진행 중이던 추적 상태는 사라진다(재시작 자체가 드문 로컬 개발 도구이므로
// 허용 가능한 한계로 판단 — "러너는 멍청하게" 원칙상 영속화까지 하지 않는다).
const activeRuns = new Map<string, TrackingState>();

function stopPolling(state: TrackingState): void {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function freeze(state: TrackingState, usage: ManualUsageEstimate, elapsedMs: number): void {
  if (state.frozen) return;
  state.frozen = true;
  state.finalUsage = usage;
  state.finalElapsedMs = elapsedMs;
}

async function pollOnce(state: TrackingState): Promise<void> {
  if (state.frozen) return; // 이미 종료 처리된 상태에서 타이머가 한 번 더 튀는 경우에 대한 방어

  const elapsedMs = Date.now() - state.startedAtMs;
  const usage = collectUsage(state);
  state.onProgress?.({
    tokensUsedEstimate: usage.tokens,
    costUsdEstimate: usage.cost.costUsd,
    usageSource: usage.source,
    elapsedMs,
  });

  // 추적하던 claude.exe가 사라졌다고 곧바로 "세션 종료"로 확정하면 안 된다 — 사람이 컨텍스트를
  // 나누려고 세션을 끝내고 새 터미널에서 다시 여는 게 이 벤치마크가 측정하려는 숙련 행동 자체이기
  // 때문이다(handover-relay-staged). 그 사이 몇십 초의 공백이 생기는데, 예전엔 그 순간 추적을 멈춰서
  // 이후 세션의 사용량이 진행률/하드컷에서 통째로 빠졌다.
  //
  // 그래서 (1) 같은 run의 다른 claude.exe가 살아있으면 그쪽으로 추적을 넘기고, (2) 아무것도 없으면
  // EXIT_GRACE_MS 동안 새 세션이 뜨는지 기다린다. 유예가 끝나면 **프로세스가 사라진 그 시점의
  // 스냅샷으로** 얼린다 — 기다린 시간이 소요 시간에 섞이지 않게 하기 위함이다.
  if (state.claudePid != null && !isProcessAlive(state.claudePid)) {
    const alive = (await findClaudePidsForRun(state.runId)).filter(isProcessAlive);
    if (alive.length > 0) {
      state.claudePid = alive[0];
      state.pendingExit = null;
    } else {
      if (!state.pendingExit) {
        state.pendingExit = { atMs: Date.now(), usage, elapsedMs };
      }
      if (Date.now() - state.pendingExit.atMs < EXIT_GRACE_MS) {
        // 아직 유예 중 — 세션이 없으니 새 사용량도 안 쌓인다. 하드컷 판정은 건너뛴다(멈춰 있는
        // 시간으로 시간 한도에 걸리게 하면 안 된다).
        return;
      }
      const pending = state.pendingExit;
      stopPolling(state);
      freeze(state, pending.usage, pending.elapsedMs);
      state.onProcessExited?.();
      return;
    }
  }
  state.pendingExit = null;

  // 사용량 하드컷은 **비용(=가중 토큰) 하나**다(2026-08-10 통합). 구독 플랜의 사용 한도가 토큰
  // 1:1 합이 아니라 모델·토큰 종류로 가중된 값으로 소모되기 때문이다 — raw 토큰으로 자르면 "구독을
  // 얼마나 깎아먹었나"와 다른 걸 재게 된다(problems.ts의 maxCostUsd 주석에 실측 근거).
  // 화면에는 이 값을 가중 토큰으로 환산해서 보여주므로, 사람이 보는 축과 러너가 자르는 축이 같다.
  //
  // maxTokens는 폭주 백스톱일 뿐이다 — 텔레메트리가 끊겨 트랜스크립트로 폴백했는데 거기에 단가
  // 테이블에 없는 신모델이 섞여 비용이 낮게 잡히는 경우에만 의미가 있다. 정상 동작에서는 먼저
  // 걸리지 않도록 넉넉히 잡혀 있다.
  let reason: DisqualifyReason | null = null;
  if (usage.cost.costUsd > state.problem.maxCostUsd) reason = "cost_limit";
  else if (state.problem.maxTokens != null && usage.tokens > state.problem.maxTokens)
    reason = "token_limit";
  else if (elapsedMs > state.problem.maxDurationMs) reason = "time_limit";

  if (reason) {
    state.disqualifyReason = reason;
    stopPolling(state);
    freeze(state, usage, elapsedMs);
    // 추적 중인 하나가 아니라 이 run에 속한 claude.exe를 전부 죽인다(세션을 나눴을 수 있다).
    await killAllClaudeProcessesForRun(state.runId, state.claudePid);
    state.onDisqualified?.({
      reason,
      tokensUsedEstimate: usage.tokens,
      costUsdEstimate: usage.cost.costUsd,
      usageSource: usage.source,
      elapsedMs,
    });
  }
}

// --- --safe-mode 완화: run마다 격리된 "가짜 홈" ---
//
// 원래는 claude.exe를 --safe-mode로 띄워서 CLAUDE.md/skills/plugins/hooks/MCP/커스텀 명령·에이전트를
// 전부 꺼서 측정 대상 오염을 막았다. 그런데 이 프로젝트가 실제로 측정하고 싶은 건 "사람이 CLAUDE.md/
// 스킬/서브에이전트 같은 하네스 엔지니어링을 실제로 활용했을 때 결과가 더 잘 나오는가"라(docs/
// problem-set.md), --safe-mode를 켜두면 그 기법 자체를 애초에 못 쓰게 막아버려서 측정할 수가 없다는
// 모순이 있었다(2026-08-05 논의).
//
// 대안: --safe-mode를 빼고 --tools/--allowedTools만 넓히면, claude.exe가 이 컴퓨터의 진짜
// ~/.claude(전역 CLAUDE.md, 전역 hooks, 전역 MCP, 전역 skills/agents)를 그대로 읽어버려서 run마다
// 재현성이 깨지고 "참가자가 이 워크스페이스 안에서 한 일"이 아니라 "이 컴퓨터에 이미 깔려있던 개인
// 설정"을 측정하게 된다 — 이것도 원래 막고 싶었던 오염이다.
//
// 그래서 claude.exe 자식 프로세스의 USERPROFILE(Windows)/HOME 환경변수를 run마다 새로 만드는 격리된
// 빈 디렉터리로 오버라이드한다. 실측으로 확인함: `USERPROFILE=<가짜경로> claude doctor`를 돌려보면
// claude.exe가 실제로 그 가짜 경로 밑에서 설치/로그인 상태를 찾으려고 시도한다(진짜 ~/.claude를
// 참조하지 않음) — 즉 이 방식으로 ~/.claude 전체(CLAUDE.md/hooks/MCP/skills/agents 포함)를 통째로
// 격리할 수 있다는 뜻이다. 그 가짜 홈 안에는 구독 로그인(OAuth) 자격증명만 진짜 걸 복사해 넣어서
// 인증은 유지하고, 나머지(전역 CLAUDE.md/hooks/MCP/skills/agents)는 아예 없는 채로 시작한다.
//
// 반면 워크스페이스 루트에 참가자가 직접 쓰는 CLAUDE.md/.claude/skills/.claude/agents는 여전히
// 정상 동작한다 — 그건 CWD(작업 디렉터리) 기준으로 탐색되지 홈 디렉터리와 무관하기 때문이다. 즉
// "참가자가 이 문제를 풀면서 직접 구성한 하네스"는 그대로 살리고, "이 컴퓨터에 원래 깔려있던 개인
// 전역 설정"만 격리하는 것이 이 메커니즘의 목적이다.
//
// 가짜 홈은 워크스페이스(참가자 눈에 보이는 파일 트리) 밖, RUN_WORKSPACES_DIR 옆의 별도 디렉터리에
// 만든다 — 워크스페이스 안에 두면 참가자의 diff/파일 탐색기에 섞여 보이게 된다.
function isolatedHomesBaseDir(): string {
  return path.join(getWorkspacesBaseDir(), "..", "vibecheck-run-homes");
}

function createIsolatedHomeDir(runId: string): string {
  const homeDir = path.join(isolatedHomesBaseDir(), runId);
  const claudeDir = path.join(homeDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });

  // 구독 로그인(OAuth) 자격증명만 진짜 홈에서 복사한다 — 인증은 유지하되 CLAUDE.md/hooks/MCP/
  // skills/agents 등 나머지 전역 커스터마이징은 아예 안 넣는다(격리 목적 자체).
  const realCredentials = path.join(os.homedir(), ".claude", ".credentials.json");
  if (existsSync(realCredentials)) {
    copyFileSync(realCredentials, path.join(claudeDir, ".credentials.json"));
  } else {
    console.warn(
      `[manualRun] 진짜 ~/.claude/.credentials.json이 없다(${realCredentials}) — 가짜 홈에서 재로그인이 필요할 수 있다`,
    );
  }

  // ~/.claude.json(주의: .claude/ 디렉터리 "안"이 아니라 홈 바로 밑의 별도 파일)에 oauthAccount/
  // hasCompletedOnboarding 등 로그인 상태가 들어있다. 이게 없으면 --safe-mode 시절과 달리(그때는
  // 진짜 홈=가짜 홈이라 이 문제가 안 드러났다) claude.exe가 대화형 세션에서 재로그인을 요구한다
  // (실사용 중 발견: -p 비대화형 테스트에선 자격증명만으로 API 호출이 됐지만, 대화형 시작 시엔 이
  // 파일로 계정/온보딩 상태를 확인하는 것으로 보인다). 통째로 복사한다 — .credentials.json과 같은
  // 이유로 특정 필드만 골라내지 않는다(어떤 필드가 필요한지 전부 파악하지 않아도 안전하게 동작).
  const realClaudeJson = path.join(os.homedir(), ".claude.json");
  if (existsSync(realClaudeJson)) {
    copyFileSync(realClaudeJson, path.join(homeDir, ".claude.json"));
  } else {
    console.warn(
      `[manualRun] 진짜 ~/.claude.json이 없다(${realClaudeJson}) — 가짜 홈에서 재로그인이 필요할 수 있다`,
    );
  }

  // hooks 없는 빈 settings.json — 파일이 아예 없으면 claude.exe가 없는 것 자체를 이상하게 취급할
  // 가능성을 배제하기 위해 최소 형태로 명시해둔다.
  writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({}, null, 2), "utf8");

  return homeDir;
}

// --- 사람이 직접 연 터미널도 같은 도구 세트로 맞추는 PATH 심(shim) ---
//
// 실측으로 발견한 함정(2026-08-14): 자동 태스크로 뜨는 세션은 tasks.json이 --tools/--allowedTools/
// --strict-mcp-config를 붙여주므로 도구 레지스트리가 MANUAL_ALLOWED_TOOLS로 좁혀지는데, 사람이 VS
// Code에서 새 터미널을 열어 `claude`를 그냥 치면 그 플래그가 하나도 안 붙어서 **기본 도구 세트 전체**가
// 실린다. 같은 빈 프롬프트로 실측한 결과 제한 세트 16,326토큰 vs 기본 세트 29,504토큰 — 같은 문제를
// 푸는데 세션마다 시작 컨텍스트가 1.8배 차이 난다. 세션을 나누는 것 자체는(handover-relay-staged처럼)
// 우리가 측정하려는 숙련 행동이므로, "나누면 도구 세트가 바뀐다"는 건 측정값을 그대로 오염시킨다.
//
// 그래서 run 전용 디렉터리에 `claude` 셸 심을 만들어 PATH 맨 앞에 얹는다 — 이 워크스페이스에서 뜨는
// 모든 터미널이 `claude`를 치면 심이 먼저 잡히고, 심이 진짜 claude.exe를 자동 태스크와 **완전히 같은
// 플래그로** 대신 실행한다. 실측 검증: 심으로 띄운 세션의 프롬프트 프리픽스가 제한 세트 세션과 캐시
// 히트로 정확히 일치했다(cache_read 16,326 = 제한 세트 쪽 cache_creation과 동일 = 바이트 단위로 같은
// 프리픽스). cmd/PowerShell은 PATHEXT로 claude.cmd를 찾고, Git Bash는 PATHEXT를 안 쓰므로 확장자 없는
// sh 스크립트를 같이 둔다.
//
// --session-id는 일부러 안 넘긴다 — 자동 태스크 세션이 이미 그 UUID를 점유하고 있어서 충돌한다.
// 대신 --name에 runId를 실어 CommandLine에 남긴다: 프로세스 매칭은 원래 "CommandLine에 runId가 들어
// 있는 claude.exe만"이라(findClaudePidsForRun) 이걸로 수동 터미널 세션도 똑같이 잡힌다(실측 확인).
// 심 디렉터리는 가짜 홈 밑(워크스페이스 밖)에 둔다 — 워크스페이스 안에 두면 참가자 파일 트리와
// 채점 diff에 섞인다.
function shimSessionName(runId: string): string {
  return `vibecheck-${runId}`;
}

let cachedRealClaudeExe: string | null = null;

// 심이 호출할 진짜 claude.exe 경로. 반드시 **진짜 홈 기준**으로 찾는다(가짜 홈에는 CLI가 없다).
function resolveRealClaudeExe(): string {
  if (cachedRealClaudeExe) return cachedRealClaudeExe;
  try {
    const out = execFileSync("where.exe", ["claude"], { encoding: "utf8" });
    const hit = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().endsWith(".exe") && existsSync(line));
    if (hit) {
      cachedRealClaudeExe = hit;
      return hit;
    }
  } catch {
    // PATH에 없으면 아래 기본 설치 경로로 폴백한다(설치 위치가 바뀌면 심이 깨지므로 경고를 남긴다).
  }
  const fallback = path.join(os.homedir(), ".local", "bin", "claude.exe");
  if (!existsSync(fallback)) {
    console.warn(`[manualRun] 진짜 claude.exe를 못 찾았다 — 심이 동작하지 않을 수 있다(${fallback})`);
  }
  cachedRealClaudeExe = fallback;
  return fallback;
}

function createClaudeShimDir(fakeHomeDir: string, runId: string): string {
  const shimDir = path.join(fakeHomeDir, "bin");
  mkdirSync(shimDir, { recursive: true });

  const exe = resolveRealClaudeExe();
  const flags = [
    "--tools",
    MANUAL_ALLOWED_TOOLS,
    "--allowedTools",
    MANUAL_ALLOWED_TOOLS,
    "--strict-mcp-config",
    "--name",
    shimSessionName(runId),
  ].join(" ");

  // %*로 사람이 친 인자를 뒤에 그대로 붙인다 — 뒤에 오는 값이 이기므로 참가자가 굳이 --tools를 다시
  // 지정하면 우리 값을 덮을 수 있지만, 그건 명백한 우회라 러너가 방어할 영역이 아니다("러너는 멍청하게").
  writeFileSync(path.join(shimDir, "claude.cmd"), `@echo off\r\n"${exe}" ${flags} %*\r\n`, "utf8");
  // Git Bash용(확장자 없음, LF 줄바꿈). 역슬래시는 sh에서 이스케이프로 먹히므로 정방향 슬래시로 쓴다.
  writeFileSync(
    path.join(shimDir, "claude"),
    `#!/bin/sh\nexec "${exe.replace(/\\/g, "/")}" ${flags} "$@"\n`,
    "utf8",
  );

  return shimDir;
}

// 자동 태스크 세션과 사람이 수동으로 연 터미널 세션이 같은 조건에서 뜨도록 tasks.json(options.env)과
// settings.json(terminal.integrated.env.windows)에 공통으로 넣는 환경변수.
//
// **PATH는 여기 넣지 않는다 — 터미널 쪽에만 따로 얹는다(실측으로 깨진 것, 2026-08-14).** VS Code의
// `${env:PATH}` 치환은 두 자리에서 동작이 다르다: `terminal.integrated.env.windows`에서는 실제 PATH로
// 정상 치환되지만(실제 창에서 확인), tasks.json의 `options.env`에서는 치환되지 않아 PATH가 리터럴
// "...;${env:PATH}"로 굳어버린다. 그러면 태스크의 `command: "claude.exe"`를 PATH에서 못 찾아 워크스페이스
// 상대경로로 떨어지고 "Path to shell executable ...\<workspace>\claude.exe does not exist"로 실행 자체가
// 실패한다. 애초에 태스크는 심이 필요 없다(플래그를 직접 다 붙여서 실행하므로) — 그래서 태스크에는
// PATH를 안 주고, 대신 command를 진짜 exe **절대경로**로 박아 PATH에 아예 의존하지 않게 한다.
function workspaceSessionEnv(fakeHomeDir: string, runId: string): Record<string, string> {
  return {
    USERPROFILE: fakeHomeDir,
    HOME: fakeHomeDir,
    ...telemetryEnv(runId),
  };
}

// 워크스페이스에 .vscode/tasks.json + settings.json을 심어서, VS Code가 이 폴더를 열 때
// (runOptions.runOn: "folderOpen") 통합 터미널에서 claude.exe가 자동으로 뜨게 만든다.
// createWorkspace()의 beforeOpenVsCode 훅으로 호출되므로 반드시 VS Code가 열리기 전에 파일이
// 준비된다.
//
// 프롬프트를 인자로 넘기지 않는다 — 넘기면 CLI가 그걸 첫 메시지로 자동 제출해버려서, 도구 호출이
// 필요한 동안은 사람 입력 없이도 계속 스스로 진행해 문제를 혼자 다 풀어버릴 수 있다(실측 확인:
// 아무도 안 건드렸는데 82초 만에 코드 작성+테스트 통과까지 끝남). "사람이 직접 바이브 코딩한
// 효율성을 측정한다"는 목적상, 세션은 빈 채로 열고 사람이 대시보드에 표시된 문제를 보고 직접
// 타이핑해서 시작해야 한다.
//
// type: "process"로 claude.exe를 셸 없이 직접 실행한다(인자에 콤마 외 특수문자가 없어 셸 이스케이프가
// 필요 없고, wt.exe 때처럼 직접 실행에 가깝게 유지). "task.allowAutomaticTasks": "on"이 없으면 VS
// Code가 신뢰된 워크스페이스에서도 "자동 태스크를 허용하시겠습니까?" 확인을 한 번 더 물어보므로
// settings.json에 명시해서 그 확인창은 건너뛴다(워크스페이스 신뢰 창 자체는 건너뛸 수 없다 — 새
// 폴더라 처음 여는 경우 사람이 직접 눌러야 한다).
//
// settings.json에 "terminal.integrated.env.windows"도 같이 심는다 — 실측으로 발견한 버그: 사람이
// 세션 도중 자동 태스크 터미널 말고 VS Code에서 새 터미널을 하나 더 열어 거기서 claude를 실행하면,
// 그 터미널은 태스크의 options.env(가짜 홈)를 상속받지 않고 이 컴퓨터의 진짜 USERPROFILE/HOME으로
// 뜬다. 그러면 (1) 그 세션의 트랜스크립트가 진짜 홈 밑에 쌓여 sumWorkspaceTokenUsage(가짜 홈 기준)가
// 못 찾아서 토큰 집계가 누락되고, (2) 진짜 전역 CLAUDE.md/hooks/MCP/skills/agents를 그대로 읽어버려서
// 격리가 우회된다. 워크스페이스 설정으로 심어두면 이 폴더 안에서 뜨는 모든 터미널(자동 태스크든
// 사람이 수동으로 연 터미널이든)이 같은 가짜 홈을 상속받는다 — cwd가 같으므로 slug도 같아 두 세션의
// .jsonl이 전부 같은 프로젝트 디렉터리에 쌓이고, sumWorkspaceTokenUsage가 그대로 합산한다(여러
// 파일의 message.id는 파일마다 독립적이라 그냥 더하면 된다는 근거는 위 sumWorkspaceTokenUsage 참고).
// 태스크의 options.env와 공통 부분(가짜 홈/텔레메트리)은 값이 완전히 동일하므로 두 설정이 동시에
// 적용돼도 충돌 없다(process 태스크는 spawn에 options.env를 그대로 넘기고, terminal.integrated.env.windows는
// VS Code가 새 터미널 프로세스를 만들 때 적용하는 별개 경로다 — 같은 키에 같은 값을 두 번 주는 것뿐).
// 유일하게 다른 키가 PATH(심)인데, 태스크는 심이 필요 없고 거기 넣으면 오히려 깨진다 —
// workspaceSessionEnv 주석 참고.
//
// problem.autoStartCommand가 있으면 두 번째 자동 태스크로 같이 띄운다(웹 문제에서 "열자마자 페이지가
// 이미 떠 있는" 상태를 만들기 위한 것 — problems.ts의 필드 주석 참고). 이 태스크는 조용히 뜨고
// 포커스를 안 가져간다(reveal: "silent", focus: false) — 사람이 타이핑해야 하는 곳은 어디까지나
// claude 세션 터미널이라, 서버 로그 터미널이 포커스를 뺏으면 엉뚱한 데 문제를 타이핑하게 된다.
function writeVsCodeAutoRunTask(
  workspacePath: string,
  runId: string,
  fakeHomeDir: string,
  shimDir: string,
  autoStartCommand?: string | null,
): void {
  const vscodeDir = path.join(workspacePath, ".vscode");
  mkdirSync(vscodeDir, { recursive: true });

  const sessionEnv = workspaceSessionEnv(fakeHomeDir, runId);

  const autoStartTasks = autoStartCommand
    ? [
        {
          label: "VibeCheck: 워크스페이스 자동 실행",
          type: "shell",
          command: autoStartCommand,
          options: { env: sessionEnv },
          presentation: {
            reveal: "silent",
            panel: "dedicated",
            focus: false,
            clear: true,
          },
          runOptions: { runOn: "folderOpen" },
          problemMatcher: [],
        },
      ]
    : [];

  const tasksJson = {
    version: "2.0.0",
    tasks: [
      {
        label: "VibeCheck: Claude Code 세션 시작",
        type: "process",
        // 진짜 exe 절대경로 — PATH에 의존하지 않는다(workspaceSessionEnv 주석의 실행 실패 사례).
        command: resolveRealClaudeExe(),
        args: [
          "--tools",
          MANUAL_ALLOWED_TOOLS,
          "--allowedTools",
          MANUAL_ALLOWED_TOOLS,
          "--strict-mcp-config",
          "--session-id",
          runId,
        ],
        // USERPROFILE/HOME을 run 전용 가짜 홈으로 오버라이드해서 --safe-mode 없이도 이 컴퓨터의
        // 진짜 전역 CLAUDE.md/hooks/MCP/skills/agents가 새어 들어오지 않게 한다(위 createIsolatedHomeDir
        // 주석 참고). 워크스페이스 루트의 프로젝트 로컬 CLAUDE.md/.claude는 CWD 기준 탐색이라 영향 없음.
        // OTEL_* 는 측정 대상 CLI가 자기 사용량을 대시보드로 보고하게 하는 설정이다(telemetryEnv 참고).
        // PATH는 일부러 안 넣는다 — 여기선 ${env:PATH}가 치환되지 않아 PATH가 통째로 깨진다
        // (workspaceSessionEnv 주석의 실측 실패 사례). 태스크는 심이 필요 없다(플래그를 직접 붙인다).
        options: {
          env: sessionEnv,
        },
        presentation: {
          reveal: "always",
          panel: "dedicated",
          focus: true,
          clear: true,
        },
        runOptions: {
          runOn: "folderOpen",
        },
        problemMatcher: [],
      },
      ...autoStartTasks,
    ],
  };
  const settingsJson = {
    "task.allowAutomaticTasks": "on",
    // win32 고정(이 프로젝트는 Windows 전용) — 위 함수 주석 참고. 사람이 자동 태스크 터미널 말고
    // 새 터미널을 열어도 같은 가짜 홈/텔레메트리 설정과 **같은 도구 세트**(PATH 심)를 상속받게 한다.
    // 안 그러면 그 세션의 사용량이 통째로 집계에서 빠지거나(가짜 홈 누락) 도구 레지스트리가 통째로
    // 달라진다(심 누락, createClaudeShimDir 주석의 실측 수치) — 둘 다 같은 종류의 함정이다.
    // PATH는 터미널 쪽에만 얹는다 — 여기서는 ${env:PATH}가 정상 치환되는 것을 실제 창에서 확인했다.
    "terminal.integrated.env.windows": {
      ...sessionEnv,
      PATH: `${shimDir};\${env:PATH}`,
    },
  };

  writeFileSync(path.join(vscodeDir, "tasks.json"), JSON.stringify(tasksJson, null, 2), "utf8");
  writeFileSync(path.join(vscodeDir, "settings.json"), JSON.stringify(settingsJson, null, 2), "utf8");
}

// 대화형 claude 세션을 워크스페이스의 VS Code 통합 터미널에서 자동 태스크로 띄우고 추적을 시작한다.
// workspacePath 생성 + VS Code 오픈은 runner.ts의 createWorkspace()를 그대로 재사용한다(중복 구현 금지).
export async function startManualRun(
  problem: Problem,
  opts: StartManualRunOptions,
): Promise<{ workspacePath: string; claudePid: number | null }> {
  const { runId, onProgress, onDisqualified, onProcessExited, reuseWindow } = opts;

  // createWorkspace()보다 먼저 만든다 — beforeOpenVsCode 훅(VS Code가 열리기 전)이 이 경로를
  // tasks.json에 박아 넣어야 하기 때문이다.
  const fakeHomeDir = createIsolatedHomeDir(runId);
  const shimDir = createClaudeShimDir(fakeHomeDir, runId);

  const workspacePath = createWorkspace(runId, problem, new Date(), {
    beforeOpenVsCode: (wsPath) =>
      writeVsCodeAutoRunTask(wsPath, runId, fakeHomeDir, shimDir, problem.autoStartCommand),
    reuseWindow,
  });
  const startedAtMs = Date.now();

  const state: TrackingState = {
    runId,
    problemId: problem.id,
    workspacePath,
    fakeHomeDir,
    problem,
    claudePid: null,
    startedAtMs,
    pollTimer: null,
    disqualifyReason: null,
    frozen: false,
    finalUsage: toUsageEstimate(emptyTranscriptUsage()),
    finalElapsedMs: 0,
    pendingExit: null,
    currentStageIndex: problem.stages && problem.stages.length > 0 ? 1 : null,
    onProgress,
    onDisqualified,
    onProcessExited,
  };
  activeRuns.set(runId, state);

  // PID 탐색은 여기서 await하지 않는다 — 처음 여는 워크스페이스는 VS Code 워크스페이스 신뢰 창을
  // 사람이 클릭할 때까지 자동 태스크가 실행되지 않아 몇 초를 훌쩍 넘길 수 있고, 그동안 API 응답(대시보드
  // "시작" 버튼)을 붙잡아둘 이유가 없다(파일 상단 주석 참고). 찾아지는 대로 state.claudePid를 채워서
  // 그 시점부터 하드컷 강제 종료가 가능해진다 — 시간/토큰 집계 자체는 startedAtMs 기준으로 이미
  // 진행 중이므로 늦게 찾아져도 누락되는 시간은 없다.
  findClaudePidBySessionId(runId, { timeoutMs: PID_SEARCH_TIMEOUT_MS, intervalMs: PID_SEARCH_INTERVAL_MS })
    .then((pid) => {
      if (activeRuns.get(runId) !== state) return; // 그 사이 completeManualRun 등으로 이미 정리됨
      if (pid == null) {
        console.warn(
          `[manualRun] runId=${runId}의 claude.exe PID를 ${PID_SEARCH_TIMEOUT_MS / 1000}초 안에 못 찾았다 — ` +
            `한도 초과 시 강제 종료가 동작하지 않을 수 있다(추적/집계 자체는 계속됨)`,
        );
        return;
      }
      state.claudePid = pid;
    })
    .catch((err) => {
      console.error(`[manualRun] runId=${runId} claude.exe PID 탐색 중 에러:`, err);
    });

  state.pollTimer = setInterval(() => {
    pollOnce(state).catch((err) => {
      console.error(`[manualRun] runId=${runId} 폴링 중 에러:`, err);
    });
  }, POLL_INTERVAL_MS);

  // 이 시점엔 백그라운드 탐색이 아직 안 끝났을 가능성이 높아 claudePid는 보통 null이다 — 호출자
  // (API 라우트)는 현재 workspacePath만 쓰고 claudePid는 참고용이라 문제 없다.
  return { workspacePath, claudePid: state.claudePid };
}

// --- 단계형 문제(stages) 제출/게이트 ---

// 대시보드/다른 run의 프롬프트에 노출해도 되는 단계 정보만 담는다 — gateTestCommand/unlockPath
// (파일시스템 절대경로, 게이트 판정 명령)는 절대 내보내지 않는다(트랩이 그대로 노출돼버림).
export type ProblemStagePublic = {
  index: number;
  title: string;
  promptAddition: string;
};

function toPublicStage(stage: ProblemStage): ProblemStagePublic {
  return { index: stage.index, title: stage.title, promptAddition: stage.promptAddition };
}

export type StageSubmitResult =
  | { passed: true; completedStageIndex: number; nextStage: ProblemStagePublic | null }
  | { passed: false; stageIndex: number };

// 사람이 대시보드에서 "이 단계 제출" 버튼을 눌렀을 때 호출된다. 현재 단계의 게이트 테스트를
// 워크스페이스에 대고 그대로 돌려서(evaluator.ts의 runTests 재사용 — 완료 평가와 동일한 메커니즘)
// 통과 여부만 판정한다. 실패 이유(어떤 assert가 깨졌는지)는 절대 반환하지 않는다 — SPEC을 안 읽고도
// 실패 메시지로 역산하는 우회를 막기 위함(docs/problem-set.md의 "스펙 대신 써줘" 우회 방지 원칙과
// 동일한 맥락). 통과하면 다음 단계 리소스(unlockPath)를 워크스페이스에 풀고 currentStageIndex를 올린다.
export async function submitStage(runId: string): Promise<StageSubmitResult> {
  const state = activeRuns.get(runId);
  if (!state) {
    throw new Error(`[manualRun] runId=${runId}에 대한 추적 상태가 없다`);
  }
  const stages = state.problem.stages;
  if (!stages || stages.length === 0 || state.currentStageIndex == null) {
    throw new Error(`[manualRun] runId=${runId}의 문제(${state.problem.id})는 단계형이 아니다`);
  }
  if (state.currentStageIndex > stages.length) {
    throw new Error(`[manualRun] runId=${runId}는 이미 모든 단계를 통과했다 — 더 제출할 단계가 없다`);
  }

  const stageIdx = state.currentStageIndex; // 1-based
  const stage = stages[stageIdx - 1];

  const result = await runTests(state.workspacePath, stage.gateTestCommand);
  if (!result.passed) {
    return { passed: false, stageIndex: stageIdx };
  }

  return advanceStage(state, stages, stageIdx);
}

// 사람이 "이 단계 건너뛰기"를 눌렀을 때. 게이트 테스트를 **돌리지 않고** 그대로 다음 단계를 연다
// (2026-08-12 사용자 요청).
//
// 왜 필요한가: 게이트를 "결과물이 있으면 통과"까지 완화했는데도 예상 못 한 형태 차이로 막히는 일이
// 반복됐다(BOM, JSON 껍데기). 그때마다 사람이 세션에 갇혀 뒤 단계를 못 밟으면 이 문제가 재려는
// 컨텍스트 관리는 측정 자체가 안 된다. 막히면 건너뛰고 계속 가게 하는 게 낫다.
//
// **점수를 우회하는 길이 아니다.** 완료 시점에 hiddenTestsPath가 워크스페이스의 tests/를 전부
// 히든(정확도 검사)으로 덮어쓰고 그걸로 채점하므로, 건너뛴 단계의 산출물이 없거나 틀리면 그대로
// testPassed=false가 되어 종합 점수가 79점 이하로 캡된다. 건너뛰기는 "진행"만 열어준다.
export async function skipStage(runId: string): Promise<StageSubmitResult> {
  const state = activeRuns.get(runId);
  if (!state) {
    throw new Error(`[manualRun] runId=${runId}에 대한 추적 상태가 없다`);
  }
  const stages = state.problem.stages;
  if (!stages || stages.length === 0 || state.currentStageIndex == null) {
    throw new Error(`[manualRun] runId=${runId}의 문제(${state.problem.id})는 단계형이 아니다`);
  }
  if (state.currentStageIndex > stages.length) {
    throw new Error(`[manualRun] runId=${runId}는 이미 모든 단계를 지났다 — 건너뛸 단계가 없다`);
  }

  return advanceStage(state, stages, state.currentStageIndex);
}

// 통과/건너뛰기 공통: 다음 단계 리소스를 풀고 currentStageIndex를 올린다.
function advanceStage(
  state: TrackingState,
  stages: ProblemStage[],
  stageIdx: number,
): StageSubmitResult {
  const nextStage = stages[stageIdx] ?? null; // 배열은 0-based라 stageIdx가 곧 "다음" 원소 인덱스
  if (nextStage?.unlockPath) {
    copyIntoWorkspace(state.workspacePath, resolveProjectPath(nextStage.unlockPath));
  }
  state.currentStageIndex = stageIdx + 1;

  return {
    passed: true,
    completedStageIndex: stageIdx,
    nextStage: nextStage ? toPublicStage(nextStage) : null,
  };
}

export type ManualRunFinalEstimate = {
  runId: string;
  // "process_exited"는 내부 상태일 뿐 여기 노출하지 않는다 — 사람이 스스로 세션을 끝낸 것도
  // 한도 초과가 아니므로 DB 저장 관점에서는 "completed"와 동일하게 취급한다(docs/evaluation.md의
  // completed/disqualified/failed 3-way 상태 중 disqualified가 아니면 completed로 본다. 수동 모드는
  // CLI가 비정상 크래시하는 경로가 없으므로 "failed"는 없다).
  status: "completed" | "disqualified";
  disqualifyReason: DisqualifyReason | null;
  // 하네스 추정치 — CLI 공식 값이 아니다. 수동 모드는 애초에 -p/--output-format json 결과 자체가
  // 없으므로(대화형 세션) 이게 유일한 수치다. 부정확할 수 있음(파일 상단 경고 참고).
  harnessEstimate: {
    tokens: number;
    elapsedMs: number;
    // 비용 축(2026-08-07 추가, 2026-08-10부터 텔레메트리 경로에서는 CLI가 직접 계산한 값).
    // 구독 로그인이라 실제 청구는 없다 — "API 종량제로 돌렸다면" 기준이며, 동시에 **구독 플랜의
    // 사용 한도 소모에 비례하는 값**이다(토큰 1:1 합보다 이쪽이 한도에 가깝다, problems.ts 참고).
    costUsd: number;
    byModel: UsageByModel;
    unpricedModels: string[];
    compactApproxTokens: number;
    usageSource: UsageSource;
  };
};

// 사람이 "완료" 버튼을 눌렀을 때 호출된다. claude.exe 프로세스는 죽이지 않는다(사람이 계속
// 터미널을 보고 싶을 수 있다) — 추적(폴러)만 멈추고 그 시점까지의 최종 추정치를 반환한다.
export function completeManualRun(runId: string, workspacePath: string): ManualRunFinalEstimate {
  const state = activeRuns.get(runId);
  if (!state) {
    throw new Error(
      `[manualRun] runId=${runId}에 대한 추적 상태가 없다 — startManualRun을 먼저 호출했는지, ` +
        `서버가 그 사이에 재시작되지 않았는지 확인해라.`,
    );
  }
  if (state.workspacePath !== workspacePath) {
    console.warn(
      `[manualRun] completeManualRun에 전달된 workspacePath가 기록된 값과 다르다: ` +
        `expected=${state.workspacePath} got=${workspacePath} (기록된 값을 기준으로 계속 진행)`,
    );
  }

  stopPolling(state);
  if (!state.frozen) {
    const elapsedMs = Date.now() - state.startedAtMs;
    freeze(state, collectUsage(state), elapsedMs);
  }

  const final: ManualRunFinalEstimate = {
    runId: state.runId,
    status: state.disqualifyReason ? "disqualified" : "completed",
    disqualifyReason: state.disqualifyReason,
    harnessEstimate: {
      tokens: state.finalUsage.tokens,
      elapsedMs: state.finalElapsedMs,
      costUsd: state.finalUsage.cost.costUsd,
      byModel: state.finalUsage.byModel,
      unpricedModels: state.finalUsage.cost.unpricedModels,
      compactApproxTokens: state.finalUsage.compactApproxTokens,
      usageSource: state.finalUsage.source,
    },
  };

  // 값을 이미 얼려서(freeze) 위 객체에 담았으므로 수신 버퍼는 비운다 — 서버가 장수 프로세스라
  // 안 비우면 run마다 계속 쌓인다. 이 시점 이후 늦게 도착하는 페이로드는 귀속 대상이 없어
  // telemetry.ts가 orphan으로 세고 버린다(다음 run에 섞이지 않는다).
  clearTelemetry(state.runId);

  return final;
}

// "다시 하기"(재시도) 흐름에서 호출된다 — 실패(실격/완료 후 재시도 요청)한 이전 run의 claude.exe를
// 새 run을 시작하기 전에 꺼준다. completeManualRun()은 원래 claude.exe를 안 죽인다(사람이 터미널을
// 계속 보고 싶을 수 있어서, 위 completeManualRun 주석 참고) — 그래서 "다시 하기"처럼 사람이 명시적으로
// "이건 이제 필요 없다"고 표시한 경우에만 여기서 별도로 죽인다. 항상 정확한 PID만 죽인다(안전 수칙,
// 파일 상단 주석과 동일). state가 없거나 PID를 못 찾았거나 이미 죽어있으면 조용히 false를 반환한다
// (재시도 자체를 막을 이유는 아니다 — best-effort).
export async function killClaudeProcessForRun(runId: string): Promise<boolean> {
  // 추적 상태가 이미 정리됐어도(서버 재시작 등) CommandLine의 runId로 찾아서 죽인다 — 남아 도는
  // 이전 run의 세션이 새 run과 같은 화면에서 계속 돌면 사람이 어느 쪽에 타이핑하는지 헷갈린다.
  const state = activeRuns.get(runId);
  const killed = await killAllClaudeProcessesForRun(runId, state?.claudePid ?? null);
  return killed > 0;
}

export type ManualRunSnapshot = {
  runId: string;
  problemId: string;
  workspacePath: string;
  claudePid: number | null;
  tokensUsedEstimate: number; // 진행 중이면 실시간 값, 종료됐으면 최종(freeze된) 값
  costUsdEstimate: number; // 위 토큰을 모델별 단가로 환산한 값(pricing.ts) — 토큰과 동일하게 실시간/최종
  byModel: UsageByModel; // 모델별(그리고 fast mode 여부별) 토큰 분해 — UI가 "어떤 모델로 얼마나 썼나"를 보여준다
  unpricedModels: string[]; // 단가 테이블에 없는 모델이 섞였으면 여기 — 있으면 costUsdEstimate는 하한이다
  usageSource: UsageSource; // 위 수치의 출처(UsageSource 주석) — 화면에서 반드시 밝힌다
  elapsedMs: number;
  disqualifyReason: DisqualifyReason | null;
  isTracking: boolean; // false면 이미 강제종료/프로세스자연종료/completeManualRun 중 하나로 폴러가 멈춘 상태
};

// 콜백 없이 폴링(GET)만으로 진행 상황을 보고 싶은 API 라우트를 위한 조회 함수. 없으면 null.
export function getManualRunStatus(runId: string): ManualRunSnapshot | null {
  const state = activeRuns.get(runId);
  if (!state) return null;

  const usage = state.frozen ? state.finalUsage : collectUsage(state);
  const elapsedMs = state.frozen ? state.finalElapsedMs : Date.now() - state.startedAtMs;

  return {
    runId: state.runId,
    problemId: state.problemId,
    workspacePath: state.workspacePath,
    claudePid: state.claudePid,
    tokensUsedEstimate: usage.tokens,
    costUsdEstimate: usage.cost.costUsd,
    byModel: usage.byModel,
    unpricedModels: usage.cost.unpricedModels,
    usageSource: usage.source,
    elapsedMs,
    disqualifyReason: state.disqualifyReason,
    isTracking: state.pollTimer !== null,
  };
}
