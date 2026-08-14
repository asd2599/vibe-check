# Claude Code CLI 실행 스펙

> 이 문서의 플래그/필드명은 **로컬에 설치된 실제 CLI(v2.1.220)를 직접 실행/프로브해서 확인한 값**이다. 문서(`code.claude.com/docs`)를 기반으로 한 조사가 일부 부정확했던 걸 실측으로 바로잡았다 — 특히 스트림 이벤트 구조와 `usage` 필드 모양. CLI가 업그레이드되면 이 문서도 다시 확인해야 한다.

> **주의**: 아래 `--safe-mode` 관련 내용은 이 문서가 다루는 헤드리스 auto 모드(`runner.ts`, 지금 웹 플로우에서 안 씀) 기준이다. 지금 실제로 쓰는 manual 모드는 2026-08-05부로 `--safe-mode`를 빼고 격리된 "가짜 홈"(`USERPROFILE`/`HOME` 오버라이드) 방식으로 바꿨다 — [manual-mode.md](./manual-mode.md#--safe-mode-대신-격리된-가짜-홈-2026-08-05-실측-검증) 참고. 여기 적힌 `--safe-mode`/`--tools "Read,Edit,Write,Bash"` 자체의 동작(CLAUDE.md 격리 확인 방법, `--tools`가 기본 도구 노출을 좁힌다는 사실 등)은 여전히 유효한 실측 지식이라 남겨둔다.

## 인증 방식: 구독 로그인(기본) vs API 키(대안)

두 가지 방법이 있다. **이 프로젝트는 구독 로그인을 기본으로 쓴다** — API 키 종량제 결제를 따로 설정하지 않아도 되고, 이미 이 컴퓨터에 로그인된 `claude` 계정을 그대로 쓸 수 있어서다.

| | `--safe-mode` (기본, 구독 로그인) | `--bare` (대안, API 키) |
|---|---|---|
| 인증 | 이미 로그인된 OAuth 세션 그대로 사용 | `ANTHROPIC_API_KEY` 환경변수 필수(OAuth/키체인은 절대 안 읽음 — CLI 도움말 원문: *"Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read)"*) |
| 비용 | 구독 플랜에 포함(추가 과금 없음), 대신 **5시간 롤링 사용량 한도**가 있음(실측: `stream-json`에 `rate_limit_event`, `rateLimitType:"five_hour"` 이벤트로 확인) | 종량제(pay-as-you-go), 콘솔에서 결제수단 등록 필요, 시간 한도는 없지만 과금은 무제한 |
| CLAUDE.md/hooks/skills/plugins/MCP 격리 | 됨(아래 실측 근거) | 됨 |
| 기본 도구 노출 범위 | **주의**: `--safe-mode`만 켜면 이 세션 자체의 확장 도구(Task, Workflow 등)까지 그대로 노출됨(실측: 31개) — 반드시 `--tools`로 직접 좁혀야 함 | 이 환경 기준 4개(Bash/Edit/PowerShell/Read)로 이미 좁음 |

**`--safe-mode`가 CLAUDE.md를 정말 안 읽는지 직접 검증함:** `workspaces/<run-id>/`(우리 프로젝트 루트 CLAUDE.md의 하위 디렉터리)에서 `--safe-mode`로 "이 프로젝트 CLAUDE.md의 핵심 원칙이 뭐야?"를 물었더니, 모델이 그 내용을 전혀 모른 채 `find . -iname "CLAUDE.md"`로 직접 찾으려고 시도했다(그마저 `--max-turns` 안에서 못 찾음). 즉 상위 디렉터리의 CLAUDE.md가 자동으로 컨텍스트에 주입되지 않는다는 게 실측으로 확인됨.

기본 명령:

```bash
claude -p "<문제 프롬프트>" \
  --safe-mode \
  --verbose \
  --output-format stream-json \
  --tools "Read,Edit,Write,Bash" \
  --allowedTools "Read,Edit,Write,Bash" \
  --strict-mcp-config \
  --max-turns 30
```

- `-p`/`--print`: 비대화형 실행.
- `--safe-mode`: "CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands and agents, output styles, workflows, custom themes, keybindings 등 커스터마이징을 전부 비활성화하되 인증/모델 선택/기본 도구/권한은 정상 동작"(CLI 도움말 원문 요약). **측정 대상 오염 방지 + 구독 로그인 유지, 둘 다 만족하는 게 이 플래그다.**
- `--tools "Read,Edit,Write,Bash"`: **`--safe-mode`만으로는 도구 레지스트리가 안 좁혀진다** — 실측 결과 이 세션 환경의 확장 도구(Task, Workflow, SendMessage 등 31개)가 그대로 노출됐다. `--tools`는 애초에 존재하는(available) 도구 집합 자체를 지정하는 플래그(빈 문자열이면 전부 비활성화, `"default"`면 전부 허용) — 이걸로 실제 노출 범위를 강제로 좁힌다. `--allowedTools`(아래)와는 다른 층위다.
- `--allowedTools`: 위에서 살아남은 도구들에 대해 대화형 권한 프롬프트 없이 자동 승인. `--tools`가 "뭐가 존재하는지", `--allowedTools`가 "그중 뭘 물어보지 않고 써도 되는지"다.
- `--strict-mcp-config`: `--mcp-config`로 명시한 것 외의 MCP 서버 설정을 전부 무시(우리는 `--mcp-config`도 안 주므로 사실상 MCP 완전 차단).
- `--verbose`: **`--output-format stream-json`은 `--print`와 함께 쓸 때 `--verbose` 없이는 즉시 에러로 거부된다**(`Error: When using --print, --output-format=stream-json requires --verbose`, 실측 확인). 빼먹으면 실행 자체가 안 된다.
- `--output-format stream-json`: NDJSON을 stdout에 실시간으로 흘려보낸다. **문제별 `maxTokens`/`maxDurationMs` 한도를 실행 중에 집행하려면 반드시 이 모드를 써야 한다** — `--output-format json`(버퍼링, 종료 후 단일 객체)로는 종료 전까지 토큰 사용량을 알 수 없어 실시간 컷이 불가능하다. 상세는 [실시간 토큰/시간 한도 집행](#실시간-토큰시간-한도-집행) 참고. `--include-partial-messages`는 **일부러 켜지 않는다** — 이 플래그를 켜면 토큰 단위 부분 스트리밍(SSE 델타)까지 내려오는데, 우리에게는 필요 없고 파싱만 복잡해진다. 기본 `stream-json`은 메시지(턴) 단위로 완성된 JSON을 한 줄씩 주기 때문에 그게 오히려 우리한테 더 쉽다.
- `--max-turns`: 무한 루프 방지용 상한. `maxTokens`/`maxDurationMs`와는 별개 안전장치이니 둘 다 유지한다.
- 필요 시 `--model <name>`으로 모델 고정, `--resume <session_id>`로 동일 세션 후속 호출 가능.
- `--max-budget-usd <amount>`: CLI에 내장된 **USD 비용** 상한(API 키 경로에서만 의미 있음 — 구독 로그인은 종량제가 아니라 이 값이 적용 안 됨). 참고: 토큰 개수나 시간 상한은 CLI에 내장 기능이 없다 — 반드시 외부에서 집행해야 한다.

`--bare` + `ANTHROPIC_API_KEY`로 전환하고 싶으면 위 표대로 `--safe-mode`를 `--bare`로, `--tools "Read,Edit,Write,Bash"`를 빼면 된다(이미 좁혀져 있으므로).

## NDJSON 이벤트 구조 (실측)

`--output-format stream-json`(파셜 메시지 미포함, 기본값)은 한 줄에 하나씩 **완성된** 이벤트를 흘려보낸다. 실제로 관찰된 라인 형태:

1. **`{"type":"system","subtype":"init", ...}`** — 세션 시작 시 1회. `session_id`, `tools`(사용 가능한 도구 목록), `model`, `permissionMode`, `apiKeySource` 등을 포함. `apiKeySource`가 `"none"`이면 인증이 안 된 것 — 즉시 실패로 처리해야 한다.
2. **`{"type":"assistant","message":{...},"session_id":...,"uuid":...,"timestamp":...}`** — 모델이 한 턴 응답을 완성할 때마다 1개. **중요: `message.usage`가 그 턴만의 완전히 확정된 값으로 이미 들어있다** — 부분 델타를 이어붙일 필요가 없다. `message.usage` 필드:
   - `input_tokens`, `output_tokens` — 그 턴의 입력/출력 토큰.
   - `cache_creation_input_tokens` — 캐시 쓰기(문서에 `cache_write`로 잘못 표기했던 것의 실제 필드명).
   - `cache_read_input_tokens` — 캐시 읽기(마찬가지로 실제 필드명).
   - 도구 호출은 `message.content`의 `{"type":"tool_use", ...}` 블록으로 같은 메시지 안에 포함된다(별도 이벤트 아님).
3. **`{"type":"user","message":{...}, ...}`** — 도구 실행 결과(tool_result)를 다시 모델에 넣어주는 턴. 모델 호출이 아니므로 `usage`가 없다(있어도 토큰 집계에 쓰지 않는다).
4. **마지막 줄, `{"type":"result", ...}`** — 정상 종료 시에만 존재하는 최종 확정치. **한도 초과로 죽인 run에는 존재하지 않는다.**

## 실시간 토큰 집계 (실측 기반, 단순화됨)

이전 버전 문서는 Anthropic 공개 API의 raw SSE 델타(`message_start`/`message_delta`) 방식을 가정해서 "턴 안에서만 누적되는 값을 커밋해야 한다"는 복잡한 로직을 요구했는데, **이건 Claude Code CLI의 기본 `stream-json`에는 해당하지 않는다** (그건 `--include-partial-messages`를 켰을 때 이야기고, 우리는 안 켠다). 실측 결과 훨씬 단순하다:

```
runningTotal = 0

각 NDJSON 줄에 대해:
  if line.type === "assistant":
    u = line.message.usage
    runningTotal += u.input_tokens + u.output_tokens
                   + u.cache_creation_input_tokens + u.cache_read_input_tokens
    // "실측 결과" 이 시점의 runningTotal을 problems/*.json의 maxTokens와 비교한다
```

`assistant` 타입이 아닌 줄(`system`, `user`, `result`)은 토큰 집계에 넣지 않는다 — `usage`가 없거나(system/user), 이미 `assistant` 줄들의 합으로 계산되는 최종 확정치(result)이기 때문이다.

시간 한도(`maxDurationMs`)는 더 단순하다 — subprocess 시작 시각과 매 줄 수신 시각의 차이를 그냥 비교하면 된다. (참고: 정상 종료 시 최종 `result` 줄에도 `duration_ms`/`duration_api_ms` 필드가 실제로 존재하긴 하지만, 한도 초과로 죽인 run은 애초에 이 줄을 못 받으므로 실시간 집행에는 쓸 수 없다 — 러너가 독립적으로 측정하는 게 유일한 방법이다.)

## 정상 종료 시 결과 JSON에서 파싱할 필드 (실측)

`stream-json`의 마지막 줄(`type: "result"`)에서 확인된 실제 필드:

| 필드 | 의미 |
|---|---|
| `result` | Claude의 최종 텍스트 응답 |
| `session_id` | 세션 UUID (트랜스크립트 대조용) |
| `is_error` | 에러로 종료됐는지 |
| `num_turns` | 총 턴 수 |
| `total_cost_usd` | 추정 비용(로컬 정가 기준, 실제 청구액과 다를 수 있음) |
| `usage.input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens` | **평평한(flat) 객체** — 모델별이 아니라 전체 합계다. (이전 문서의 "`usage.*.input_tokens`처럼 모델별로 나뉜다"는 서술은 틀렸다 — 실측 결과 최상위 `usage`는 단일 객체.) |
| `modelUsage` | 모델별 세부 내역이 필요하면 여기(객체, 모델 이름을 key로 가짐) — 우리 파싱 대상은 아니지만 존재는 확인됨 |
| `duration_ms` / `duration_api_ms` | CLI 자신이 보고하는 소요 시간(참고용). **실시간 한도 집행에는 못 쓴다** — 러너는 독립적으로 벽시계 시간을 측정한다(아래 참고). |

벽시계 시간은 러너가 subprocess 시작/종료 시점을 직접 측정(`Date.now()`)해서 기록한다. CLI의 `duration_ms`는 정상 종료된 run에 한해 교차 확인용으로만 참고한다.

## 실시간 토큰/시간 한도 집행

`problems/*.json`의 `maxTokens`/`maxDurationMs`([problem-set.md](./problem-set.md))를 넘는 순간 러너가 subprocess를 즉시 죽이고 해당 run을 "실격"으로 기록한다([evaluation.md](./evaluation.md)). 유예 없음 — 이 자체가 `CLAUDE.md`의 핵심 원칙이다. 집계 방법은 위 "실시간 토큰 집계" 절, 진행 상황 로그(향후 대시보드용)가 필요하면 `assistant` 메시지의 `content` 배열에서 `tool_use` 블록을 도구 호출 경계로 쓸 수 있다.

### 한도 초과 시 종료 방법

- 러너가 자체 판단으로 `child.kill()`(SIGTERM)을 보낸다.
- POSIX(Linux/macOS)에서는 진행 중이던 턴을 중단하고, 실행 중이던 Bash 툴의 프로세스 트리를 정리하고, `SessionEnd` 훅을 실행한 뒤 exit code 143으로 종료한다 — 이 동작은 CLI가 보장한다.
- **Windows(이 프로젝트의 개발 환경)에서는 Node의 `child_process.kill()`이 진짜 POSIX SIGTERM이 아니라 강제 종료로 동작한다.** 즉 위의 "정상적인 SIGTERM 정리 동작"(훅 실행, 마지막 `result` 라인 flush)이 보장되지 않는다고 가정해야 한다. 실무적으로는 문제 없음 — 실격 run은 어차피 평가를 생략하고, 그 시점까지 워크스페이스에 실제로 쓰여진 파일(diff)은 디스크에 그대로 남아있다.
- 종료 사유(토큰 초과 vs 시간 초과)는 CLI의 exit code로 추론하지 않는다 — 러너가 직접 kill을 실행한 시점에 이미 사유를 알고 있으므로, 그 사유를 run 레코드에 바로 기록한다.
- 실격 run의 토큰/시간 수치는 CLI가 준 게 아니라 **러너가 직접 누적 계산한 값**이므로, 저장할 때 "하네스 추정치"임을 구분되는 필드/플래그로 명시한다. 정상 종료 run의 `usage.*`(CLI 공식 값)와 절대 같은 필드에 섞지 않는다.

## 실행 관련 주의사항

- 인증: 이 컴퓨터에서 `claude` 로그인이 안 돼 있으면(구독 계정) 벤치마크 subprocess는 실패한다. `--bare` 대안 경로를 쓰는 경우에만 `.env`의 `ANTHROPIC_API_KEY`가 필요하다.
- **구독 로그인 경로의 5시간 사용량 한도**: `stream-json`에 `{"type":"rate_limit_event","rate_limit_info":{"rateLimitType":"five_hour",...}}` 이벤트가 실제로 찍히는 걸 확인했다. 문제를 여러 개 연속으로 돌리면 이 한도에 걸려 중간에 실패하는 run이 나올 수 있다 — 이건 "실격"도 "정상 실패"도 아닌 별도 사유이므로, 러너가 이 이벤트를 보면(또는 `result`의 관련 필드로) 감지해서 구분되게 기록하는 걸 고려한다(페이즈 4에서 저장 스키마 설계 시 반영).
- Exit code: 0 성공, 0이 아니면 실패로 기록(SIGTERM 시 143 등). 단, 러너 자신이 한도 초과로 죽인 경우는 "실패"가 아니라 "실격"으로 별도 기록한다(위 참고).
- 한 run 안에서 여러 모델이 섞여 쓰일 수 있다(실측: 같은 run의 `modelUsage`에 `claude-sonnet-5`와 `claude-haiku-4-5` 둘 다 찍힌 사례 확인 — 내부적으로 보조 호출에 다른 모델을 쓰는 것으로 보임). 토큰 집계 로직(위 "실시간 토큰 집계")은 어떤 모델이 처리했든 `assistant` 타입 줄의 `usage`를 그냥 더하므로 영향 없다.
- **세션 트랜스크립트(JSONL)는 raw stdout NDJSON과 형태가 다르다 — 실측으로 직접 확인됨.** `~/.claude/projects/<workdir-경로-슬러그>/<session_id>.jsonl`에 남는 트랜스크립트는 한 턴을 콘텐츠 블록(`thinking`/`text`/`tool_use`)마다 별도 줄로 쪼개서 기록하고, 그 각 줄에 그 턴의 `usage`를 반복해서 담는다. 반면 우리가 실제로 파싱하는 raw stdout `stream-json`은 턴(메시지)당 정확히 한 줄만 나온다(같은 `message.id`가 두 번 나오지 않음, 직접 캡처해서 확인함). **디버깅할 때 트랜스크립트만 보고 토큰 집계를 검증하면 안 된다** — 중복 집계 버그가 있는 것처럼 착각하게 만든다(실제로 한 번 그렇게 오판할 뻔했다). 반드시 러너가 실제로 읽는 stdout(또는 그걸 그대로 로깅한 것)을 근거로 판단한다. 파싱은 `--output-format stream-json`의 이벤트 스트림/최종 `result`에만 의존하고, 트랜스크립트는 어디까지나 아카이빙/보조 참고 자료로만 취급한다. 벤치마크 실행 중 불필요한 디스크 기록을 줄이려면 `--no-session-persistence` 사용을 검토.
- Rate limit에 대한 재시도 로직은 CLI가 자동으로 해주지 않으므로, 러너에서 실패 시 재시도 여부를 명시적으로 결정한다(기본은 재시도 없이 실패로 기록 — 측정값 왜곡 방지).
- `total_cost_usd`는 참고용 추정치임을 대시보드에도 명시한다. 구독 로그인 경로에서는 이 값이 "실제로 청구되는 금액"이 아니라 "API로 환산하면 이 정도"라는 뜻이라는 걸 더 명확히 표시한다(구독은 정액제라 이 run 하나 때문에 추가로 돈이 나가는 게 아님).
- subprocess 실행 전 `child.stdin.end()`로 stdin을 즉시 닫는다 — 안 닫으면 CLI가 stdin 입력을 몇 초간 기다리다 포기하는 지연이 실측 확인됐다(불필요한 지연 3초 이상).
