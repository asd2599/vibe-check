import type { DisqualifyReason } from "./types";

type Status = "running" | "completed" | "disqualified" | "failed";

// 테두리 대신 옅은 배경 + 얇은 ring으로 통일한다(카드 스타일과 같은 언어). 앞에 붙는 점 색으로
// 상태를 먼저 읽히게 하고, 글자는 과하지 않은 대비로 둔다.
const STYLES: Record<Status, string> = {
  running: "bg-blue-50 text-blue-700 ring-blue-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  disqualified: "bg-amber-50 text-amber-800 ring-amber-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
};

const DOT_STYLES: Record<Status, string> = {
  running: "bg-blue-500",
  completed: "bg-emerald-500",
  disqualified: "bg-amber-500",
  failed: "bg-red-500",
};

const LABELS: Record<Status, string> = {
  running: "실행 중",
  completed: "완료",
  disqualified: "실격",
  failed: "실패",
};

const REASON_LABELS: Record<DisqualifyReason, string> = {
  token_limit: "토큰 한도 초과",
  time_limit: "시간 한도 초과",
  cost_limit: "구독 한도 소모 초과",
};

// "포기"는 별도 status가 아니다 — status는 completed 그대로이고 채점도 정상 수행된다. 다만 이력에서
// "끝까지 풀고 자동 완료된 run"과 "중도에 손 든 run"이 똑같이 "완료"로 보이면 안 되므로 라벨만
// 바꿔 단다(prisma/schema.prisma의 abandoned 주석). 색은 실격(amber)과 헷갈리지 않게 중립 톤이다.
const ABANDONED_STYLE = "bg-zinc-100 text-zinc-600 ring-zinc-300";
const ABANDONED_DOT = "bg-zinc-400";

export function StatusBadge({
  status,
  disqualifyReason,
  showReason = true,
  abandoned = false,
}: {
  status: Status;
  disqualifyReason?: DisqualifyReason | null;
  // completed인 run이 "포기"로 끝났는지. status가 completed가 아닐 때는 무시된다(실격/실패가 우선).
  abandoned?: boolean;
  // 실격 사유("시간 한도 초과" 등)를 배지 안에 같이 쓸지. 이력 표처럼 칸 폭이 아까운 곳에서는
  // 끈다 — 사유가 붙으면 "상태" 칼럼만 다른 칼럼의 두세 배로 벌어졌다(사용자 지적).
  // 끈 자리에서도 정보가 사라지지는 않는다: title로 남겨 마우스를 올리면 보이고, run 상세
  // 페이지에서는 항상 사유까지 펼쳐서 보여준다.
  showReason?: boolean;
}) {
  const reason = status === "disqualified" && disqualifyReason ? REASON_LABELS[disqualifyReason] : null;
  const isAbandoned = abandoned && status === "completed";
  const label = isAbandoned ? "포기" : LABELS[status];

  return (
    <span
      title={
        isAbandoned
          ? "단계를 다 통과하지 못한 채 포기로 끝낸 run이다 — 채점은 정상 수행됐다"
          : reason
            ? `${LABELS[status]} · ${reason}`
            : undefined
      }
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
        isAbandoned ? ABANDONED_STYLE : STYLES[status]
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${isAbandoned ? ABANDONED_DOT : DOT_STYLES[status]}`}
      />
      {label}
      {reason && showReason && <span className="opacity-75">· {reason}</span>}
    </span>
  );
}

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-sky-50 text-sky-700 ring-sky-200",
  hard: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "쉬움",
  medium: "보통",
  hard: "어려움",
};

export function DifficultyBadge({ difficulty }: { difficulty: string | null }) {
  if (!difficulty) {
    return <span className="text-xs text-zinc-400">—</span>;
  }
  const style = DIFFICULTY_STYLES[difficulty] ?? "bg-zinc-50 text-zinc-700 ring-zinc-200";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${style}`}>
      {DIFFICULTY_LABELS[difficulty] ?? difficulty}
    </span>
  );
}
