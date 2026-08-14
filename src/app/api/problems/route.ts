// GET /api/problems — 고정 문제 세트 목록. 대시보드의 문제 선택 드롭다운용.
import { NextResponse } from "next/server";
import { listProblemsInDisplayOrder } from "@/lib/problems";
import { toWeightedTokens } from "@/lib/pricing";

export type ProblemSummary = {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  // 사용량 하드컷을 화면 단위(가중 토큰)로 환산한 값 — 100만 가중 토큰 = $1(src/lib/pricing.ts).
  // 러너가 실제로 자르는 기준(maxCostUsd)과 같은 값을 눈금만 바꾼 것이다.
  maxWeightedTokens: number;
  maxDurationMs: number;
};

export async function GET() {
  // 순서는 problems.ts가 정한다(listOrder → id). 첫 항목이 대시보드의 기본 선택값이 된다.
  const problems: ProblemSummary[] = listProblemsInDisplayOrder().map((p) => {
    return {
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      category: p.category,
      maxWeightedTokens: toWeightedTokens(p.maxCostUsd),
      maxDurationMs: p.maxDurationMs,
    };
  });

  return NextResponse.json({ problems });
}
