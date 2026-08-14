import { clampPercent } from "@/lib/format";

export function ProgressBar({
  label,
  hint,
  valueLabel,
  value,
  max,
  colorClassName = "bg-blue-500",
  markerValue,
}: {
  label: string;
  // 라벨 옆에 작게 붙는 보조 설명("구독 한도 소모", "적정 15분" 등). 예전엔 이걸 label 문자열에
  // 괄호로 이어붙였는데, 사이드바처럼 좁은 칸에서는 라벨이 두 줄로 접혀 막대와 어긋났다.
  hint?: string;
  valueLabel: string;
  value: number;
  max: number;
  colorClassName?: string;
  // 막대 위에 세로선으로 표시할 기준점(예: 적정 시간). 넘어가면 막대 색이 바뀐다 — 실격은 아니지만
  // 여기서부터 종합 점수가 깎이기 시작하므로 사람이 진행 중에 알아야 한다(docs/evaluation.md).
  markerValue?: number | null;
}) {
  const percent = clampPercent(value, max);
  const overLimit = value > max;
  const overMarker = markerValue != null && value > markerValue;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-zinc-700">
          {label}
          {hint && <span className="ml-1.5 font-normal text-zinc-400">{hint}</span>}
        </span>
        <span
          className={`tabular shrink-0 text-xs ${
            overLimit
              ? "font-semibold text-red-600"
              : overMarker
                ? "font-semibold text-amber-600"
                : "text-zinc-500"
          }`}
        >
          {valueLabel}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            overLimit ? "bg-red-500" : overMarker ? "bg-amber-500" : colorClassName
          }`}
          style={{ width: `${percent}%` }}
        />
        {markerValue != null && markerValue < max && (
          <div
            className="absolute top-0 h-full w-0.5 rounded-full bg-zinc-400"
            style={{ left: `${clampPercent(markerValue, max)}%` }}
            title="적정 기준선 — 여기부터 종합 점수가 깎인다"
          />
        )}
      </div>
    </div>
  );
}
