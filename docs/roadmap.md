# 개발 로드맵

> **이 표는 "AI 헤드리스 자동 모드" 시절(페이즈 1~6)에 쓰여진 이력이다 — 지금은 수동 모드로 완전히 전환됐다(`CLAUDE.md`, [manual-mode.md](./manual-mode.md)).** 러너/대시보드 관련 담당(3~7행)은 실제 구현이 많이 바뀌었으니 그대로 믿지 말고 `docs/manual-mode.md`/`docs/architecture.md`를 우선해라. **`problem-author`/`/new-problem`(2행, 8행)은 여전히 유효하다** — 문제 추가 작업은 앞으로도 이 경로로 하면 된다.

페이즈는 [overview.md](./overview.md)의 전체 플로우(문제선택→워크스페이스→CLI실행→메트릭→평가→저장→대시보드)를 구현 순서로 쪼갠 것이다. 각 페이즈에 이 저장소에 준비된 전담 서브에이전트/스킬을 붙였다. 새 페이즈가 필요해지면 이 표부터 갱신한다.

| # | 페이즈 | 산출물 | 담당 서브에이전트 | 관련 스킬 |
|---|---|---|---|---|
| 0 | 스펙 정비 | `CLAUDE.md`, `docs/*.md` | — | — |
| 1 | 스캐폴딩 | Next.js/TS 프로젝트, Prisma 초기화, `docs/architecture.md`의 디렉터리 뼈대 | — (1회성, 직접 진행) | — |
| 2 | 문제 세트 작성 | `problems/*.json` 3~5개 (난이도 혼합) | [`problem-author`](../.claude/agents/problem-author.md) | [`/new-problem`](../.claude/skills/new-problem/SKILL.md) |
| 3 | 러너 구현 | `src/lib/runner.ts` (headless subprocess 실행, 워크스페이스 격리) | [`runner-engineer`](../.claude/agents/runner-engineer.md) | [`/run-bench`](../.claude/skills/run-bench/SKILL.md) |
| 4 | 메트릭/저장 | `src/lib/metrics.ts`, `prisma/schema.prisma`, `src/lib/db.ts` | [`runner-engineer`](../.claude/agents/runner-engineer.md) | [`/run-bench`](../.claude/skills/run-bench/SKILL.md) |
| 5 | 평가 구현 | `src/lib/evaluator.ts` (테스트 실행 + LLM 채점) | [`eval-engineer`](../.claude/agents/eval-engineer.md) | [`/run-bench`](../.claude/skills/run-bench/SKILL.md) |
| 6 | 대시보드 UI | `src/app/**` (실행 트리거, 이력, 상세 diff/메트릭 뷰) | [`dashboard-engineer`](../.claude/agents/dashboard-engineer.md) | — |
| 7 | 엔드투엔드 검증 | 문제 1개가 선택→실행→평가→저장→표시까지 완주하는지 확인, 실패 케이스 정리 | [`benchmark-debugger`](../.claude/agents/benchmark-debugger.md) | [`/check-run`](../.claude/skills/check-run/SKILL.md) |
| 8 | 확장 | 문제 세트 확대, 모델별 비교, 리더보드 | `problem-author` + `dashboard-engineer` | `/new-problem` |

## 진행 원칙

- 페이즈는 순서대로 진행하되, 3~5(러너/메트릭/평가)는 서로 강하게 얽혀 있으니 같은 세션에서 이어서 다뤄도 된다.
- 페이즈 7 전에는 UI가 없어도 `/run-bench`로 파이프라인을 CLI에서 직접 검증할 수 있어야 한다 — 대시보드가 없다는 이유로 검증을 미루지 않는다.
- 문제/실행이 이상하게 실패하면 새 기능을 얹기 전에 `benchmark-debugger` + `/check-run`으로 먼저 원인을 좁힌다.
