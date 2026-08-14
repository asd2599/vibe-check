---
name: new-problem
description: Scaffold a new benchmark problem file under problems/*.json following docs/problem-set.md. Use when the user asks to add a new coding task/problem/difficulty to the benchmark set.
argument-hint: [문제 주제/난이도/카테고리 설명]
allowed-tools: Agent
---

사용자 요청: $ARGUMENTS

이 스킬은 직접 파일을 만들지 않는다. `problem-author` 서브에이전트를 호출해서 위 요청을 그대로 전달하라 — 문제 파일 포맷(`docs/problem-set.md`)과 작성 규칙은 그 서브에이전트가 안다.

요청에 난이도/카테고리가 빠져 있으면 서브에이전트에게 기존 `problems/*.json`과 겹치지 않는 쪽으로 알아서 채우라고 지시한다.
