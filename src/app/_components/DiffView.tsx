import type { FileDiff } from "@/lib/workspaceDiff";

// 상세 페이지에서 diff를 보여주는 순수 렌더링 컴포넌트. 인터랙션(펼치기/접기)은 native
// <details>/<summary>로 처리해서 클라이언트 JS 없이도 서버 컴포넌트 안에서 동작한다.

function DiffLines({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-xs leading-5 text-zinc-200">
      {lines.map((line, i) => {
        let cls = "";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "text-zinc-400";
        else if (line.startsWith("@@")) cls = "text-sky-400";
        else if (line.startsWith("+")) cls = "text-green-400";
        else if (line.startsWith("-")) cls = "text-red-400";
        return (
          <div key={i} className={cls}>
            {line.length > 0 ? line : " "}
          </div>
        );
      })}
    </pre>
  );
}

const CHANGE_LABELS = { added: "새 파일", modified: "변경됨", unchanged: "변경 없음" } as const;
const CHANGE_STYLES = {
  added: "text-emerald-700",
  modified: "text-amber-700",
  unchanged: "text-zinc-400",
} as const;

export function DiffView({ diffs }: { diffs: FileDiff[] }) {
  if (diffs.length === 0) {
    return <p className="text-sm text-zinc-500">워크스페이스에 파일이 없다.</p>;
  }

  const changed = diffs.filter((d) => d.changeType !== "unchanged");
  const unchanged = diffs.filter((d) => d.changeType === "unchanged");

  return (
    <div className="space-y-2">
      {changed.length === 0 && <p className="text-sm text-zinc-500">starter 대비 변경된 파일이 없다.</p>}
      {changed.map((d) => (
        <details key={d.path} open className="rounded-md border border-zinc-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            <span className={CHANGE_STYLES[d.changeType]}>[{CHANGE_LABELS[d.changeType]}]</span> {d.path}
          </summary>
          <div className="border-t border-zinc-200 p-2">
            <DiffLines patch={d.patch} />
          </div>
        </details>
      ))}
      {unchanged.length > 0 && (
        <details className="rounded-md border border-zinc-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-500">
            변경 없는 파일 {unchanged.length}개
          </summary>
          <ul className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500">
            {unchanged.map((d) => (
              <li key={d.path}>{d.path}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
