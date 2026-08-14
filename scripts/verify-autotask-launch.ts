// 실제 VS Code 창을 열어서 자동 태스크가 정말로 claude.exe를 띄우는지까지 확인한다.
//
// 왜 필요한가: 생성 파일만 검사하는 verify-terminal-shim.ts는 "tasks.json의 options.env에서는
// ${env:PATH}가 치환되지 않아 태스크 실행 자체가 실패한다"는 걸 못 잡았다(2026-08-14 실사용 실패).
// 파일이 그럴듯해도 VS Code가 실제로 실행에 성공하는지는 띄워봐야만 안다.
//
// 확인 후 claude.exe를 정확한 PID로 죽이고 워크스페이스/가짜 홈을 지운다. VS Code 창은 사람이 닫는다
// (이 컴퓨터에서 VS Code는 싱글 인스턴스라 프로세스로 죽이면 무관한 창까지 죽는다 — 기존 안전 수칙).
//
// 실행: npx tsx scripts/verify-autotask-launch.ts [problemId]
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";

async function main() {
  const { startManualRun, killClaudeProcessForRun } = await import("../src/lib/manualRun");
  const { loadProblem, } = await import("../src/lib/problems");
  const { getWorkspacesBaseDir } = await import("../src/lib/runner");

  const runId = randomUUID();
  const problem = loadProblem(process.argv[2] ?? "handover-relay-staged");
  const { workspacePath } = await startManualRun(problem, { runId });
  console.log(`워크스페이스: ${workspacePath}`);
  console.log("VS Code 창이 열리고 자동 태스크가 뜨기를 기다리는 중(최대 90초)...");

  const { execFileSync } = await import("node:child_process");
  let pid: number | null = null;
  for (let i = 0; i < 90; i++) {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(out.trim() || "[]");
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const hit = arr.find((p: { CommandLine?: string }) => (p.CommandLine ?? "").includes(runId));
    if (hit) {
      pid = hit.ProcessId;
      console.log(`\nPASS  자동 태스크가 claude.exe를 띄웠다 (pid=${pid})`);
      console.log(`      ${hit.CommandLine}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (pid == null) {
    console.log("\nFAIL  90초 안에 이 run의 claude.exe가 뜨지 않았다 — VS Code 터미널의 에러 메시지를 확인할 것");
  }

  await killClaudeProcessForRun(runId);
  // 실패했으면 워크스페이스를 남긴다 — VS Code 터미널의 에러 메시지와 생성된 tasks.json을 봐야 한다.
  if (pid != null || process.env.KEEP_WORKSPACE === "true") {
    console.log(pid == null ? `\n워크스페이스를 남겨둔다: ${workspacePath}` : "");
  }
  if (pid != null && process.env.KEEP_WORKSPACE !== "true") {
    try {
      rmSync(workspacePath, { recursive: true, force: true });
      rmSync(path.join(getWorkspacesBaseDir(), "..", "vibecheck-run-homes", runId), { recursive: true, force: true });
    } catch {
      // 정리 실패는 검증 결과와 무관하다(VS Code가 파일을 잡고 있을 수 있음).
    }
  }
  process.exit(pid == null ? 1 : 0);
}

main();
