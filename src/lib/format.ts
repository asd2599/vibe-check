// 대시보드 전용 표시 포맷 헬퍼. DB/러너 로직과 무관한 순수 함수만 둔다.

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

// 비용은 어디에 표시하든 "추정치"임을 밝힌다 (CLAUDE.md).
export function formatCostUsdEstimate(costUsd: number | null | undefined): string {
  if (costUsd === null || costUsd === undefined) return "—";
  return `추정 $${costUsd.toFixed(4)}`;
}

export function formatDateTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function clampPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}
