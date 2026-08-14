// POST /api/runs/[id]/stage — 단계형 문제(problem.stages)에서 사람이 "이 단계 제출" 버튼을 누르면
// 호출한다. manualRun.ts의 submitStage()를 그대로 감싼다 — 현재 단계의 게이트 테스트를 워크스페이스에
// 대고 돌려서 통과 여부만 반환한다(어떤 검증이 깨졌는지는 절대 안 준다, docs/problem-set.md의
// "스펙 대신 써줘" 우회 방지 원칙과 동일한 맥락). 통과하면 다음 단계 리소스가 워크스페이스에 자동으로
// 풀리고, 프론트는 응답의 nextStage로 새로 공개된 요구사항 텍스트를 보여주면 된다. nextStage가
// null이면 그 단계가 마지막이었다는 뜻 — 사람은 이제 "완료" 버튼을 누르면 된다.

import { NextRequest, NextResponse } from "next/server";
import { skipStage, submitStage } from "@/lib/manualRun";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // { skip: true }면 게이트를 돌리지 않고 다음 단계를 연다(사람이 "건너뛰기"를 눌렀을 때).
  // 채점은 완료 시점 히든 테스트가 그대로 하므로 점수 우회 경로가 아니다(manualRun.ts의 skipStage 주석).
  let skip = false;
  try {
    const body = (await request.json()) as { skip?: unknown };
    skip = body?.skip === true;
  } catch {
    // 본문 없이 호출하는 기존 "제출" 경로 — skip=false 그대로 간다.
  }

  try {
    const result = skip ? await skipStage(id) : await submitStage(id);
    return NextResponse.json({ ...result, skipped: skip });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
