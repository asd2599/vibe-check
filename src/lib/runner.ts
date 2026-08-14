// Claude Code CLI 헤드리스 벤치마크 러너.
// 실행 스펙/필드명은 docs/cli-spec.md(로컬 CLI를 직접 프로브해서 확인한 실측값)를 따른다.
// CLAUDE.md 원칙: 측정 대상 오염 금지(--safe-mode), 실행은 항상 격리, 토큰/시간 한도는 하드컷.
// 인증은 구독 로그인(OAuth)을 그대로 쓴다 — --bare(API 키 전용)가 아니라 --safe-mode를 쓰는 이유.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, cpSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import {
  loadProblem,
  pickRandomProblem,
  resolveProjectPath,
  PROJECT_ROOT,
  type Problem,
} from "./problems";

// export: src/lib/manualRun.ts(수동 모드 러너)가 --safe-mode 등 동일한 도구 제한을 그대로 재사용한다
// (측정 대상 오염 방지 원칙은 auto/manual 두 모드 모두 동일해야 하므로 값을 중복 정의하지 않는다).
export const ALLOWED_TOOLS = "Read,Edit,Write,Bash";
const MAX_TURNS = 30;

// 워크스페이스 생성 위치. env로 오버라이드 가능 — 기본값은 "work" 디렉터리
// (PROJECT_ROOT = .../work/project/VibeCheck 기준 두 단계 위, 즉 .../work/) 아래 vibecheck-runs
// (사람이 눈으로 구경하기 편한, 프로젝트 밖의 위치). 특정 사용자 경로를 코드에 박아넣지 않기 위해
// PROJECT_ROOT 기준 상대 경로로 계산한다 (docs/architecture.md 참고).
// .env 로딩 타이밍(dotenv/config는 db.ts에서 로드됨) 때문에 반드시 호출 시점에 평가해야 한다 —
// 모듈 최상단 상수로 두면 CLI 진입점(main())에서 dotenv가 로드되기 전에 값이 굳어버린다.
// export: manualRun.ts도 동일한 워크스페이스 기본 경로 규칙을 따라야 하므로 재사용한다.
export function getWorkspacesBaseDir(): string {
  const fromEnv = process.env.RUN_WORKSPACES_DIR?.trim();
  return fromEnv ? fromEnv : path.resolve(PROJECT_ROOT, "..", "..", "vibecheck-runs");
}

// export: manualRun.ts가 동일한 "<problemId>_<YYYYMMDD-HHmmss>_<runId 앞 8자리>" 폴더명 규칙을 재사용한다.
export function formatTimestampForDirName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

// export: manualRun.ts가 VS Code 통합 터미널에서 자동 실행되는 claude.exe 태스크에도 동일하게
// 적용한다. Next.js 서버가 Claude Code 세션 안에서 실행 중이면(개발 중 이 세션의 Bash로 `npm run dev`를
// 띄운 경우) 이 프로세스의 env를 그대로 물려받는데, `code` CLI가 새 VS Code 프로세스를 직접 띄우는
// 경우(기존에 떠있는 VS Code 인스턴스가 없을 때) 그 오염된 env가 통합 터미널의 자식 프로세스에까지
// 전달될 수 있다 — 대화형 claude.exe가 "독립된 최상위 세션이 아니다"로 오인해 트랜스크립트를 정상
// 위치에 안 쓰는 버그가 실측으로 확인된 바 있다(docs/manual-mode.md). VS Code 에디터 자체에는
// 영향이 없으므로 auto 모드에서도 항상 적용해도 무해하다.
export function sanitizeClaudeSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const key of Object.keys(sanitized)) {
    if (/^(CLAUDE_CODE_|CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT)/.test(key)) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

// 구경용(auto 모드) 또는 실제 작업 창(manual 모드) VS Code를 best-effort로 띄운다 — 실패해도
// 절대 벤치마크 실행을 막지 않는다. VIBECHECK_OPEN_VSCODE=false로 끌 수 있다(검증 스크립트를
// 반복 실행할 때 창이 계속 뜨는 걸 방지).
//
// reuseWindow=true면 "code -r <path>"로 연다 — VS Code CLI가 공식 지원하는 "마지막 활성 창을
// 재사용" 플래그다(manualRun.ts의 "다시 하기" 재시도 흐름에서 씀). 실행 중인 claude.exe 프로세스는
// PID exact-match로 별도로 죽이지만(manualRun.ts의 killClaudeProcessForRun), VS Code 창 자체는
// OS 프로세스를 직접 찾아 죽이는 방식을 쓰지 않는다 — 이 컴퓨터에서 VS Code는 대개 싱글 인스턴스로
// 여러 창이 하나의 백그라운드 프로세스에 묶여 있어서(docs/manual-mode.md), 이름/커맨드라인 매칭으로
// 강제 종료하면 사람의 다른 무관한 VS Code 창까지 같이 죽일 위험이 있다. `-r`은 VS Code가 자체
// 지원하는 안전한 방법이라 그 창(마지막 활성 창)의 내용만 새 워크스페이스로 바뀐다.
function tryOpenVsCode(workspacePath: string, reuseWindow = false): void {
  if (process.env.VIBECHECK_OPEN_VSCODE === "false") return;
  try {
    const args = reuseWindow ? ["-r", workspacePath] : [workspacePath];
    const child = spawn("code", args, {
      detached: true,
      stdio: "ignore",
      // Windows에서 "code"는 .cmd 셸 스크립트라 shell:true 없이는 spawn이 ENOENT로 실패한다(실측 확인).
      shell: process.platform === "win32",
      env: sanitizeClaudeSessionEnv(process.env),
    });
    child.on("error", (err) => {
      console.warn(`[runner] VS Code 자동 실행 실패(무시하고 계속 진행): ${err.message}`);
    });
    child.unref();
  } catch (err) {
    console.warn(
      `[runner] VS Code 자동 실행 실패(무시하고 계속 진행): ${(err as Error).message}`,
    );
  }
}

// 실행 중 진행 상황을 바깥(웹 대시보드 등)에 알려주는 훅. runBenchmark()는 여전히 DB를 모르는
// 순수 함수다 — 이 콜백도 그냥 관찰자일 뿐, 실행 흐름에 영향을 주지 않는다.
export type RunProgress = {
  tokensUsed: number; // 러너가 실시간으로 누적 집계한 값(하네스 추정치, CLI 공식 값 아님)
  elapsedMs: number;
};

export type RunBenchmarkOptions = {
  runId?: string; // 지정하면 이 값을 runId로 쓴다(예: 웹 API가 응답을 먼저 보내야 할 때). 없으면 자동 생성.
  onProgress?: (progress: RunProgress) => void;
};

// cost_limit은 수동 모드 전용이다(2026-08-10 추가) — 구독 플랜의 사용 한도가 토큰 1:1 합이 아니라
// 모델·토큰 종류로 가중된 값으로 소모되기 때문에, 토큰 하드컷과 별개로 비용 하드컷을 둔다
// (problems.ts의 maxCostUsd 주석 참고). 예전 헤드리스 auto 모드는 이 사유를 내지 않는다.
export type DisqualifyReason = "token_limit" | "time_limit" | "cost_limit";

export type CliUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type RunResult =
  | {
      status: "completed";
      runId: string;
      problemId: string;
      workspacePath: string;
      startedAt: string;
      durationMs: number;
      exitCode: number;
      sessionId: string | null;
      resultText: string;
      numTurns: number;
      totalCostUsd: number; // 추정치 — docs/cli-spec.md 참고
      usage: CliUsage; // CLI가 보고한 공식 값
      cliReportedDurationMs: number | null; // 참고용, 실시간 집행에는 쓰지 않음
      rateLimitStatus: string | null; // 마지막으로 관찰된 rate_limit_event.rate_limit_info.status (정보성, 판단 로직 없음)
    }
  | {
      status: "disqualified";
      runId: string;
      problemId: string;
      workspacePath: string;
      startedAt: string;
      durationMs: number;
      sessionId: string | null;
      disqualifyReason: DisqualifyReason;
      harnessEstimate: {
        tokens: number; // 러너가 직접 집계한 값 — CLI 공식 값 아님
        elapsedMs: number;
      };
      rateLimitStatus: string | null;
    }
  | {
      status: "failed";
      runId: string;
      problemId: string;
      workspacePath: string;
      startedAt: string;
      durationMs: number;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stderrTail: string;
      rateLimitStatus: string | null;
    };

type CliResultLine = {
  is_error: boolean;
  num_turns: number;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  duration_ms: number;
  result: string;
};

function sumUsage(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

export type CreateWorkspaceOptions = {
  // manual 모드가 VS Code를 열기 직전에 .vscode/tasks.json 등을 워크스페이스에 심어 넣을 때 쓴다
  // (manualRun.ts). VS Code 오픈 전에 파일이 있어야 자동 태스크(runOn: folderOpen)가 그 창에서
  // 바로 인식된다. auto 모드는 이 옵션을 쓰지 않는다.
  beforeOpenVsCode?: (workspacePath: string) => void;
  // true면 새 창 대신 "code -r"(마지막 활성 창 재사용)로 연다 — manualRun.ts의 "다시 하기" 재시도
  // 흐름에서, 실패한 이전 run의 VS Code 창을 새 창을 또 띄우지 않고 그 자리에서 새 워크스페이스로
  // 바꿔치기하는 데 쓴다(tryOpenVsCode의 reuseWindow 인자로 그대로 전달됨).
  reuseWindow?: boolean;
};

// export: manualRun.ts(단계 통과 시 다음 단계 리소스 언락)와 evaluator.ts(완료 평가 직전 히든
// 테스트 이식)가 재사용한다. sourceDir(PROJECT_ROOT 기준 절대경로 아님 — 호출자가 이미
// resolveProjectPath로 절대경로화해서 넘긴다)의 내용물을 워크스페이스 루트에 병합해 복사한다 —
// 기존 파일과 이름이 겹치면 덮어쓴다(히든 테스트 이식이 부분적으로 풀린 단계 테스트 파일을 완전한
// 버전으로 교체하는 데 그대로 쓰인다).
export function copyIntoWorkspace(workspacePath: string, sourceDir: string): void {
  if (!existsSync(sourceDir)) {
    throw new Error(`복사할 디렉터리가 없다: ${sourceDir}`);
  }
  cpSync(sourceDir, workspacePath, { recursive: true });
}

// export: manualRun.ts가 그대로 재사용한다(워크스페이스 생성 + starterFiles 복사 + VS Code 오픈,
// 로직은 auto/manual 모드가 완전히 동일해야 한다 — 중복 구현 금지).
export function createWorkspace(
  runId: string,
  problem: Problem,
  nameTimestamp: Date,
  opts?: CreateWorkspaceOptions,
): string {
  // 사람이 탐색기/VS Code 창 제목에서 바로 알아볼 수 있는 이름: <problemId>_<YYYYMMDD-HHmmss>_<runId 앞 8자리>
  const dirName = `${problem.id}_${formatTimestampForDirName(nameTimestamp)}_${runId.slice(0, 8)}`;
  const workspacePath = path.join(getWorkspacesBaseDir(), dirName);
  mkdirSync(workspacePath, { recursive: true });

  if (problem.starterFiles) {
    const starterPath = resolveProjectPath(problem.starterFiles);
    if (!existsSync(starterPath)) {
      throw new Error(`starterFiles 경로가 없다: ${starterPath}`);
    }
    copyIntoWorkspace(workspacePath, starterPath);
  }

  opts?.beforeOpenVsCode?.(workspacePath);
  tryOpenVsCode(workspacePath, opts?.reuseWindow ?? false);

  return workspacePath;
}

export async function runBenchmark(
  problem: Problem,
  opts?: RunBenchmarkOptions,
): Promise<RunResult> {
  const runId = opts?.runId ?? randomUUID();
  // 폴더 이름용 타임스탬프일 뿐 — 벽시계 측정(startedAtMs)과는 무관하다. 측정은 기존과 동일하게
  // 워크스페이스 생성 이후, subprocess 실행 직전 시점에서 시작한다(디렉터리/파일 복사 비용을
  // subprocess 소요 시간에 섞지 않기 위함).
  const workspacePath = createWorkspace(runId, problem, new Date());
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  const args = [
    "-p",
    problem.prompt,
    "--safe-mode", // CLAUDE.md/hooks/skills/plugins/MCP 등 커스터마이징을 끄되, 구독 로그인(OAuth) 인증은 유지 — docs/cli-spec.md 참고
    "--verbose",
    "--output-format",
    "stream-json",
    "--tools",
    ALLOWED_TOOLS, // 도구 레지스트리 자체를 이 크기로 제한 (--safe-mode만으로는 기본 도구 세트가 그대로 노출됨, 실측 확인)
    "--allowedTools",
    ALLOWED_TOOLS, // 그 안에서 대화형 승인 프롬프트 없이 자동 허용
    "--strict-mcp-config",
    "--max-turns",
    String(MAX_TURNS),
  ];

  const child: ChildProcessWithoutNullStreams = spawn("claude", args, {
    cwd: workspacePath,
  });
  child.stdin.end(); // 입력을 안 쓰므로 즉시 EOF — 안 닫으면 CLI가 stdin을 몇 초 기다린다(실측 확인)

  let sessionId: string | null = null;
  let runningTokens = 0;
  let disqualifyReason: DisqualifyReason | null = null;
  let killed = false;
  // 구독 로그인 경로의 5시간 사용량 한도 이벤트 — 마지막으로 본 상태 문자열만 기록(판단 로직 없음)
  let rateLimitStatus: string | null = null;
  // resultLine은 반드시 객체 프로퍼티로 들고 있는다 — TS의 control-flow narrowing이
  // "클로저 안에서만 재할당되는 let 변수"를 바깥 스코프에서 항상 초기값(null)으로만
  // 좁혀버리는 알려진 한계가 있어서, bare let으로 두면 아래 if(resultLine) 분기가
  // 스퓨리어스하게 `never`로 좁혀진다.
  const state: { resultLine: CliResultLine | null } = { resultLine: null };
  let stderrTail = "";

  function killWithReason(reason: DisqualifyReason) {
    if (killed) return;
    killed = true;
    disqualifyReason = reason;
    child.kill(); // SIGTERM(POSIX) — Windows에서는 강제 종료로 동작함(docs/cli-spec.md 참고)
  }

  const timeLimitTimer = setTimeout(() => {
    killWithReason("time_limit");
  }, problem.maxDurationMs);

  // 진행 상황 콜백: 토큰이 바뀔 때뿐 아니라(아래 "assistant" 분기) 1초 주기로도 호출해서,
  // 모델이 오래 생각하느라 새 줄이 안 와도 경과 시간만큼은 계속 갱신되게 한다.
  const progressTimer = opts?.onProgress
    ? setInterval(() => {
        opts.onProgress!({ tokensUsed: runningTokens, elapsedMs: Date.now() - startedAtMs });
      }, 1000)
    : null;

  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return; // NDJSON이 아닌 잡음 줄은 무시
    }

    const type = event.type;

    if (type === "system" && event.subtype === "init") {
      sessionId = (event.session_id as string) ?? sessionId;
      return;
    }

    if (type === "assistant") {
      const message = event.message as { usage?: Record<string, number> } | undefined;
      if (message?.usage) {
        runningTokens += sumUsage(message.usage);
        opts?.onProgress?.({ tokensUsed: runningTokens, elapsedMs: Date.now() - startedAtMs });
      }
      // 레거시 auto 모드는 계속 raw 토큰으로만 자른다 — 수동 모드처럼 비용 축으로 옮기지 않았다.
      // 이 경로는 웹 플로우에서 더 이상 안 쓰이고(CLAUDE.md), stdout stream-json에는 모델별 분해가
      // 실시간으로 안 들어와 비용을 즉시 환산할 수 없기 때문이다. maxTokens가 없는 문제라면(수동 모드
      // 기준으로만 정의된 문제) 이 하드컷 없이 진행한다.
      if (problem.maxTokens != null && runningTokens > problem.maxTokens) {
        killWithReason("token_limit");
      }
      return;
    }

    if (type === "result") {
      state.resultLine = event as unknown as CliResultLine;
      sessionId = state.resultLine.session_id ?? sessionId;
      return;
    }

    if (type === "rate_limit_event") {
      const info = event.rate_limit_info as { status?: string } | undefined;
      if (info?.status) {
        rateLimitStatus = info.status;
      }
    }
  });

  const { exitCode, signal } = await new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.on("close", (code, sig) => {
      clearTimeout(timeLimitTimer);
      if (progressTimer) clearInterval(progressTimer);
      resolve({ exitCode: code, signal: sig });
    });
  });

  const durationMs = Date.now() - startedAtMs;

  if (disqualifyReason) {
    return {
      status: "disqualified",
      runId,
      problemId: problem.id,
      workspacePath,
      startedAt,
      durationMs,
      sessionId,
      disqualifyReason,
      harnessEstimate: { tokens: runningTokens, elapsedMs: durationMs },
      rateLimitStatus,
    };
  }

  if (exitCode === 0 && state.resultLine) {
    const r = state.resultLine;
    return {
      status: "completed",
      runId,
      problemId: problem.id,
      workspacePath,
      startedAt,
      durationMs,
      exitCode,
      sessionId,
      resultText: r.result,
      numTurns: r.num_turns,
      totalCostUsd: r.total_cost_usd,
      usage: {
        inputTokens: r.usage.input_tokens,
        outputTokens: r.usage.output_tokens,
        cacheCreationInputTokens: r.usage.cache_creation_input_tokens,
        cacheReadInputTokens: r.usage.cache_read_input_tokens,
      },
      cliReportedDurationMs: r.duration_ms ?? null,
      rateLimitStatus,
    };
  }

  return {
    status: "failed",
    runId,
    problemId: problem.id,
    workspacePath,
    startedAt,
    durationMs,
    exitCode,
    signal,
    stderrTail,
    rateLimitStatus,
  };
}

async function main() {
  // db.ts/evaluator.ts는 CLI 진입점에서만 필요하다 — runBenchmark() 자체는 DB/평가를 몰라야 한다
  // (웹 API 라우트 등에서도 순수 함수로 재사용하기 위함, 페이즈 4 요구사항).
  const { saveRun } = await import("./db");

  const problemId = process.argv[2];
  const problem = problemId ? loadProblem(problemId) : pickRandomProblem();

  console.log(
    `[runner] problem=${problem.id} difficulty=${problem.difficulty} maxTokens=${problem.maxTokens} maxDurationMs=${problem.maxDurationMs}`,
  );

  const result = await runBenchmark(problem);
  console.log(JSON.stringify(result, null, 2));

  await saveRun(result);

  // "완료" 상태인 run만 평가한다 — 실격/실패는 미완성 코드라 테스트/채점을 돌려봐야 의미가 없다
  // (docs/evaluation.md).
  if (result.status === "completed") {
    const { evaluateRun } = await import("./evaluator");
    const evaluation = await evaluateRun(result, problem);
    console.log(JSON.stringify(evaluation, null, 2));
  }

  if (result.status !== "completed") {
    process.exitCode = 1;
  }
}

// "이 파일을 직접 실행했을 때만 main()을 돌린다"는 CLI 엔트리 가드.
// typeof 검사를 앞에 두는 이유: 이 모듈은 Next(ESM/번들) 안에서도 import된다(manualRun.ts가
// createWorkspace 등을 재사용한다). ESM 컨텍스트에는 require/module이 아예 없어서 그냥
// `require.main === module`이라고 쓰면 모듈 평가 시점에 ReferenceError가 나고, 이 파일을 (간접적으로라도)
// import하는 API 라우트가 통째로 500이 된다. typeof는 선언되지 않은 식별자에도 안전하다.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error("[runner] 실행 실패:", err);
    process.exitCode = 1;
  });
}
