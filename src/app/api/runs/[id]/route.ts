// GET /api/runs/[id] — run 상세(효율성 필드) + evaluation(품질 필드)을 합쳐서 반환.
// 주로 메인 페이지가 진행이 끝난 직후 결과 요약을 보여줄 때 쓴다(/runs/[id] 상세 페이지 자체는
// 서버 컴포넌트에서 db.ts를 직접 호출해 렌더한다).

import { NextResponse } from "next/server";
import { getRunWithEvaluation } from "@/lib/db";
import { loadProblem } from "@/lib/problems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const data = await getRunWithEvaluation(id);
  if (!data) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  let problemTitle: string | null = null;
  let difficulty: string | null = null;
  try {
    const problem = loadProblem(data.run.problemId);
    problemTitle = problem.title;
    difficulty = problem.difficulty;
  } catch {
    // 문제 파일이 없어졌어도 run 자체는 그대로 보여준다.
  }

  return NextResponse.json({ ...data, problemTitle, difficulty });
}
