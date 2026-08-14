---
name: run-bench
description: Run a single benchmark problem locally against the Claude Code CLI, outside the web dashboard, for development/smoke-testing. Use when the user wants to manually trigger or sanity-check one run.
argument-hint: "[problem-id] (생략 시 무작위 선택)"
allowed-tools: Bash, Read, Glob
---

목표: 대시보드 없이 문제 하나를 실제로 돌려서 러너 파이프라인이 살아있는지 빠르게 확인한다. 이 스킬은 평가(테스트 실행/LLM 채점)는 하지 않는다 — 시간/토큰/비용/exit code만 확인한다.

1. 인자 `$ARGUMENTS`가 있으면 그 id의 `problems/<id>.json`을 사용한다. 없으면 `problems/*.json` 중 하나를 무작위로 고른다. 이 문제의 `maxTokens`/`maxDurationMs`를 반드시 확인한다 — 한도 집행의 기준값이다.
2. `src/lib/runner.ts`가 이미 존재하면 그걸 통해 실행한다(예: `npx tsx src/lib/runner.ts <problem-id>`) — 프로덕션과 다른 경로로 테스트하면 의미가 없다. `CLAUDE.md`의 "러너는 멍청하게" 원칙대로, 여기서 실행 로직을 다시 구현하지 않는다.
3. `runner.ts`가 없으면(정상적으로는 없을 일이 없다 — 있어야 정상), `docs/cli-spec.md`(특히 "인증 방식"·"NDJSON 이벤트 구조"·"실시간 토큰/시간 한도 집행" 절)를 그대로 참고해서 `workspaces/`아래 임시 디렉터리를 만들고 `claude -p "<prompt>" --safe-mode --verbose --output-format stream-json --tools "Read,Edit,Write,Bash" --allowedTools "Read,Edit,Write,Bash" --strict-mcp-config ...`을 직접 실행한다(`--verbose` 빠뜨리면 CLI가 즉시 거부함, 이 컴퓨터에 `claude` 로그인이 안 돼 있으면 인증 실패로 즉시 끝남). NDJSON을 읽으며 토큰/시간을 집계하고, 문제의 `maxTokens`/`maxDurationMs`를 넘으면 즉시 kill해서 실격 처리한다 — 문서를 다시 베끼지 말고 매번 `docs/cli-spec.md`를 읽어서 최신 집계 로직을 쓴다.
4. 정상 종료면 마지막 `result` 객체에서 `session_id`, `total_cost_usd`(추정치), `usage`, exit code를 뽑아 보여준다. 한도 초과로 죽였으면 "실격"과 사유(`token_limit`/`time_limit`), 그리고 하네스가 직접 집계한 토큰/시간 값을 대신 보여준다. 어느 쪽이든 직접 측정한 벽시계 시간을 같이 보고한다.
5. 실행이 실패했거나(실격이 아닌데 이상해 보이면) 여기서 원인을 파고들지 말고 `/check-run` 스킬(또는 `benchmark-debugger` 서브에이전트)로 넘기라고 안내한다.
