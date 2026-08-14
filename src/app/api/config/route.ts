// GET /api/config — 서버 환경설정 중 클라이언트가 알아야 하는 "여부"만 boolean으로 내려준다.
//
// 배경: 대시보드(src/app/page.tsx)는 "use client" 컴포넌트라 process.env.OPENAI_API_KEY를 직접
// 읽을 수 없고, NEXT_PUBLIC_ 접두사를 붙이면 클라이언트 번들에 실제 비밀 문자열이 그대로 노출되므로
// 그렇게 해서도 안 된다(절대 금지). 그래서 서버 쪽(이 라우트, Route Handler는 항상 서버에서 실행)에서
// 키의 "설정 여부"만 계산해 boolean으로 응답한다 — 키 값 자체는 어떤 필드에도 절대 담지 않는다.
//
// 용도: OPENAI_API_KEY가 비어있으면 LLM 채점(evaluator.ts의 judgeWithOpenAI)이 조용히 실패하고
// judge: null로 저장된다(docs/evaluation.md) — 대시보드가 이 값을 미리 보여줘서 "왜 채점이 안
// 되지?"하고 나중에 당황하지 않게 사전 안내 배너를 띄우는 데 쓴다.
import { NextResponse } from "next/server";

export async function GET() {
  const openaiKeyConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  return NextResponse.json({ openaiKeyConfigured });
}
