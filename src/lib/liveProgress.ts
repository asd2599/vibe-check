// 실행 중인 run의 진행 상황(토큰/시간)을 잠깐 들고 있는 메모리 레지스트리.
// DB가 아니다 — next dev/next start 프로세스가 떠 있는 동안만 유효한 휘발성 상태다.
// 로컬 1인용 도구라 이걸로 충분하다(CLAUDE.md: 과설계 금지). 서버가 재시작되면 비워지므로,
// 이 레지스트리를 조회하는 쪽(API 라우트)은 값이 없을 때 DB로 폴백해야 한다.

export type LiveProgressStatus = "running" | "completed" | "disqualified" | "failed";

export type LiveProgress = {
  status: LiveProgressStatus;
  problemId: string;
  tokensUsed: number; // 러너가 실시간으로 누적 집계한 값(하네스 추정치)
  elapsedMs: number;
  maxTokens: number;
  maxDurationMs: number;
  startedAt: string; // ISO
};

// 종료된 run의 최종 상태를 얼마나 오래 레지스트리에 남겨둘지. 이 시간이 지나면 지워서
// (서버가 오래 떠 있어도) 메모리가 계속 쌓이지 않게 한다 — 그 이후 조회는 DB로 폴백된다.
const FINISHED_ENTRY_TTL_MS = 5 * 60 * 1000;

const registry = new Map<string, LiveProgress>();

export function setLiveProgress(runId: string, progress: LiveProgress): void {
  registry.set(runId, progress);
}

export function updateLiveProgress(runId: string, patch: Partial<LiveProgress>): void {
  const current = registry.get(runId);
  if (!current) return;
  const next = { ...current, ...patch };
  registry.set(runId, next);

  if (next.status !== "running") {
    const timer = setTimeout(() => registry.delete(runId), FINISHED_ENTRY_TTL_MS);
    timer.unref?.();
  }
}

export function getLiveProgress(runId: string): LiveProgress | undefined {
  return registry.get(runId);
}
