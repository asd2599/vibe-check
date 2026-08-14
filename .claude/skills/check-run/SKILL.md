---
name: check-run
description: Investigate a specific stored benchmark run that failed, timed out, or produced a suspicious score. Use when the user reports a run problem and wants a root cause before fixing anything.
argument-hint: "[run-id] (생략 시 가장 최근 실패 run)"
allowed-tools: Agent
---

조사 대상: $ARGUMENTS (run id, 생략 시 가장 최근에 실패했거나 이상해 보이는 run을 찾아서 대상으로 삼는다)

`benchmark-debugger` 서브에이전트를 호출해서 위 run을 조사시켜라. 이 스킬은 코드를 고치지 않는다 — 서브에이전트의 원인 분류(러너 버그/평가 버그/문제 정의 모호/CLI 자체 실패) 결과를 그대로 사용자에게 전달하고, 필요하면 어느 서브에이전트(`runner-engineer`/`eval-engineer`/`problem-author`)로 이어서 넘길지 물어라.
