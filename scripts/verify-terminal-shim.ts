// startManualRun()이 실제로 만드는 워크스페이스 설정 파일과 PATH 심을 검사한다.
//
// 확인하는 것:
//  1) .vscode/tasks.json(자동 태스크)과 settings.json(사람이 여는 터미널)이 **완전히 같은 env**를 쓰는가
//     — 도구 세트/가짜 홈/텔레메트리 중 하나라도 어긋나면 세션마다 측정 조건이 달라진다.
//  2) 심(claude.cmd / claude)이 자동 태스크와 동일한 --tools/--allowedTools/--strict-mcp-config를 붙이는가.
//  3) 심이 CommandLine에 runId를 남기는가(--name) — 하드컷 강제 종료가 수동 터미널 세션도 잡으려면 필요.
//  4) 심 디렉터리가 워크스페이스 **밖**(가짜 홈 밑)인가 — 참가자 파일 트리/채점 diff 오염 방지.
//
// 실행: npx tsx scripts/verify-terminal-shim.ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.VIBECHECK_OPEN_VSCODE = "false"; // VS Code 창을 띄우지 않는다
process.env.RUN_WORKSPACES_DIR = mkdtempSync(path.join(os.tmpdir(), "vibecheck-shim-"));

async function main() {
const { startManualRun } = await import("../src/lib/manualRun");
const { loadProblem } = await import("../src/lib/problems");

const runId = randomUUID();
const problem = loadProblem(process.argv[2] ?? "handover-relay-staged");
const { workspacePath } = await startManualRun(problem, { runId });

const tasks = JSON.parse(readFileSync(path.join(workspacePath, ".vscode", "tasks.json"), "utf8"));
const settings = JSON.parse(readFileSync(path.join(workspacePath, ".vscode", "settings.json"), "utf8"));
const taskEnv = tasks.tasks[0].options.env as Record<string, string>;
const termEnv = settings["terminal.integrated.env.windows"] as Record<string, string>;
const termEnvWithoutPath = Object.fromEntries(Object.entries(termEnv).filter(([k]) => k !== "PATH"));
const shimDir = termEnv.PATH.split(";")[0];
const cmdShim = readFileSync(path.join(shimDir, "claude.cmd"), "utf8");
const shShim = readFileSync(path.join(shimDir, "claude"), "utf8");
const taskArgs = (tasks.tasks[0].args as string[]).join(" ");

const checks: [string, boolean][] = [
  // PATH를 뺀 나머지(가짜 홈/텔레메트리)는 두 경로가 완전히 같아야 한다. PATH는 터미널에만 얹는다 —
  // tasks.json의 options.env에서는 ${env:PATH}가 치환되지 않아 태스크 실행 자체가 깨진다(실측).
  ["태스크 env == 터미널 env (PATH 제외 완전 동일)", JSON.stringify(taskEnv) === JSON.stringify(termEnvWithoutPath)],
  ["태스크 env에는 PATH가 없다(있으면 실행 자체가 깨진다)", !("PATH" in taskEnv)],
  ["자동 태스크가 진짜 exe 절대경로를 쓴다", path.isAbsolute(tasks.tasks[0].command) && existsSync(tasks.tasks[0].command)],
  ["터미널 env가 가짜 홈을 쓴다", termEnv.USERPROFILE === termEnv.HOME && termEnv.USERPROFILE.includes(runId)],
  ["터미널 env가 텔레메트리를 runId로 귀속한다", (termEnv.OTEL_RESOURCE_ATTRIBUTES ?? "").includes(runId)],
  ["PATH가 심 디렉터리를 맨 앞에 둔다", termEnv.PATH.startsWith(shimDir + ";")],
  ["PATH가 기존 PATH를 VS Code 변수로 보존한다", termEnv.PATH.endsWith(";${env:PATH}")],
  ["심 디렉터리가 워크스페이스 밖이다", !path.resolve(shimDir).startsWith(path.resolve(workspacePath))],
  ["claude.cmd가 존재한다", existsSync(path.join(shimDir, "claude.cmd"))],
  ["claude(sh, Git Bash용)가 존재한다", existsSync(path.join(shimDir, "claude"))],
  ["cmd 심의 도구 세트가 자동 태스크와 같다", cmdShim.includes("--tools Read,Edit,Write,Bash,Agent,Skill")],
  ["cmd 심이 --allowedTools도 같게 붙인다", cmdShim.includes("--allowedTools Read,Edit,Write,Bash,Agent,Skill")],
  ["cmd 심이 --strict-mcp-config를 붙인다", cmdShim.includes("--strict-mcp-config")],
  ["cmd 심이 CommandLine에 runId를 남긴다(--name)", cmdShim.includes(`--name vibecheck-${runId}`)],
  ["cmd 심이 사용자 인자를 그대로 넘긴다", cmdShim.includes("%*")],
  ["sh 심이 같은 플래그를 붙인다", shShim.includes("--tools Read,Edit,Write,Bash,Agent,Skill") && shShim.includes(`vibecheck-${runId}`)],
  ["sh 심이 역슬래시 없는 경로를 쓴다", !shShim.split("\n")[1].includes("\\")],
  ["sh 심이 LF 줄바꿈이다", !shShim.includes("\r")],
  ["자동 태스크도 같은 도구 세트를 쓴다", taskArgs.includes("--tools Read,Edit,Write,Bash,Agent,Skill")],
  ["자동 태스크만 --session-id를 쓴다(심은 충돌 방지로 안 씀)", taskArgs.includes(`--session-id ${runId}`) && !cmdShim.includes("--session-id")],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}
console.log(`\n${checks.length - failed}/${checks.length} 통과`);
process.exit(failed === 0 ? 0 : 1);
}

main();
