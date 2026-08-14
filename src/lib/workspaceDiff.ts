// 상세 페이지에서 diff(변경된 코드)를 보여주기 위한 워크스페이스 파일 비교.
// DB/러너/평가 로직과 무관한 순수 조회 헬퍼다 — runner.ts/evaluator.ts/db.ts는 건드리지 않는다.
// starterFiles가 있는 문제는 starter 대비 unified diff, 없는 문제는 전부 "새 파일"로 표시된다
// (evaluator.ts의 LLM 채점 입력과 같은 방식 — 최종 워크스페이스 파일 전체가 근거다).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { resolveProjectPath } from "./problems";

// evaluator.ts의 EXCLUDED_DIRS와 같은 의도(빌드 산출물/의존성은 diff에서 제외) — 별도 파일이라
// import는 안 하지만(evaluator.ts를 건드리지 않기 위해 export하지 않았음) 목록은 동일하게 유지한다.
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "out"]);

function collectFiles(rootDir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(rootDir)) return files;

  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(rootDir, full).split(path.sep).join("/");
        try {
          files.set(rel, readFileSync(full, "utf8"));
        } catch {
          files.set(rel, "[바이너리 또는 텍스트로 읽을 수 없는 파일]");
        }
      }
    }
  }

  walk(rootDir);
  return files;
}

export type FileDiff = {
  path: string;
  changeType: "added" | "modified" | "unchanged";
  patch: string; // unified diff 텍스트. added는 starter 쪽이 빈 파일로 취급되어 전체가 추가로 보인다.
};

// workspacePath가 이미 사라진 경우(수동 삭제 등) null을 반환한다 — 호출부에서 "코드를 볼 수 없음"으로 표시.
export function getWorkspaceDiff(
  workspacePath: string,
  starterFilesRelPath: string | null,
): FileDiff[] | null {
  if (!existsSync(workspacePath)) return null;

  const finalFiles = collectFiles(workspacePath);
  const starterFiles = starterFilesRelPath
    ? collectFiles(resolveProjectPath(starterFilesRelPath))
    : new Map<string, string>();

  const diffs: FileDiff[] = [];
  for (const [relPath, finalContent] of finalFiles) {
    const starterContent = starterFiles.get(relPath);
    if (starterContent === undefined) {
      const patch = createTwoFilesPatch(relPath, relPath, "", finalContent, "starter(없음)", "final");
      diffs.push({ path: relPath, changeType: "added", patch });
    } else if (starterContent !== finalContent) {
      const patch = createTwoFilesPatch(relPath, relPath, starterContent, finalContent, "starter", "final");
      diffs.push({ path: relPath, changeType: "modified", patch });
    } else {
      diffs.push({ path: relPath, changeType: "unchanged", patch: "" });
    }
  }

  // 변경/추가된 파일을 먼저 보여주고, 그대로인 파일은 뒤로.
  diffs.sort((a, b) => {
    const rank = (t: FileDiff["changeType"]) => (t === "unchanged" ? 1 : 0);
    return rank(a.changeType) - rank(b.changeType) || a.path.localeCompare(b.path);
  });

  return diffs;
}
