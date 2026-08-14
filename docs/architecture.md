# 아키텍처 / 기술 스택 (예정)

- **웹 앱**: Next.js (App Router) + TypeScript — 실행 트리거, 이력 대시보드를 한 앱에서 제공.
- **실행 러너 (지금 쓰는 것)**: `src/lib/manualRun.ts` — 생성된 워크스페이스에 `.vscode/tasks.json`(`runOn: folderOpen`)을 심어서 VS Code 통합 터미널에서 빈 대화형 `claude` 세션이 자동으로 뜨게 하고(사람이 직접 타이핑), `--session-id`로 넘긴 runId를 CommandLine에서 매칭해 정확한 PID만 추적한다. 세션 트랜스크립트 파일을 폴링해 토큰/시간을 실시간 추정하고, 한도 초과 시 그 PID만 강제 종료한다. 메커니즘 상세는 [manual-mode.md](./manual-mode.md) 참고.
- **실행 러너 (예전 것, 참고용, 안 씀)**: `src/lib/runner.ts`의 `runBenchmark()` — `claude` CLI를 헤드리스(`--print --output-format stream-json`)로 직접 실행하던 방식. 코드는 남아있지만 웹 플로우에서 더 이상 호출 안 함. 상세는 [cli-spec.md](./cli-spec.md).
- **DB**: SQLite + Prisma — 로컬에서 가볍게 실행 이력/점수 저장.
- **문제 세트**: `problems/*.json` — 포맷은 [problem-set.md](./problem-set.md) 참고.
- **워크스페이스**: 실행마다 프로젝트 **밖의** 별도 디렉터리(기본값 `<"work" 디렉터리(프로젝트 루트 기준 두 단계 위)>/vibecheck-runs/`, `RUN_WORKSPACES_DIR` 환경변수로 오버라이드 가능)에 격리된 디렉터리를 생성한다. 폴더 이름은 `<problemId>_<YYYYMMDD-HHmmss>_<runId 앞 8자리>` 형태라 탐색기/VS Code 창 제목에서 바로 어떤 실행인지 알아볼 수 있다. 워크스페이스 생성 직후 `VIBECHECK_OPEN_VSCODE`(기본 켜짐, `"false"`로 끔)가 켜져 있으면 `code <경로>`로 VS Code 창을 best-effort로 띄운다(순수 구경용 — 실패해도 벤치마크 실행에 영향 없음, 측정 방식 자체는 여전히 헤드리스 `-p --output-format stream-json`). 실행 후 diff만 추출해 DB에 저장하고 디렉터리는 정리(또는 최근 N개만 보존).
- **LLM 채점**: OpenAI API를 별도로 호출(벤치마크 대상이 Claude Code CLI이므로 채점자는 다른 벤더로 분리 — self-preferencing bias 방지). 이 호출의 토큰/비용은 "채점 비용"으로 벤치마크 대상 실행과 분리해서 기록한다. 상세는 [evaluation.md](./evaluation.md) 참고.

## 디렉터리 구조

```
VibeCheck/                      # 프로젝트 루트
├── CLAUDE.md
├── docs/                       # 상세 스펙 (이 폴더)
├── problems/                   # 고정 문제 세트 (json)
├── prisma/schema.prisma
├── src/
│   ├── app/
│   │   ├── page.tsx             # 메인: 문제 선택 + 시작 + 실시간 진행 + 완료 버튼
│   │   ├── runs/[id]/page.tsx   # 상세: 효율성/품질 분리 표시
│   │   └── api/runs/            # POST(시작)/[id]/complete(완료)/[id]/progress(폴링)/[id]/stage(단계형 문제 제출)
│   └── lib/
│       ├── manualRun.ts        # 지금 쓰는 러너 — 대화형 세션 실행/추적/하드컷 + 단계형 문제 게이트(submitStage) (manual-mode.md)
│       ├── runner.ts           # 예전 헤드리스 러너(runBenchmark) — 참고용, 안 씀. createWorkspace 등은 manualRun.ts가 재사용
│       ├── evaluator.ts        # 테스트 실행 + LLM 채점 (모드 무관, 공용)
│       ├── liveProgress.ts     # 진행 중인 run의 메모리 상태(폴링용)
│       └── db.ts               # saveRun(auto)/saveManualRun(manual)/saveEvaluation 등
└── .env                        # OPENAI_API_KEY(필수), ANTHROPIC_API_KEY(--bare 대안 경로용, 선택),
                                 # RUN_WORKSPACES_DIR(선택), VIBECHECK_OPEN_VSCODE(선택)

<"work" 디렉터리(프로젝트 루트 기준 두 단계 위)>/
└── vibecheck-runs/             # 워크스페이스 기본 위치 (프로젝트 밖, RUN_WORKSPACES_DIR로 오버라이드 가능)
    └── <problemId>_<YYYYMMDD-HHmmss>_<runId 앞 8자리>/   # 실행별 격리된 작업 디렉터리
```

## 대시보드 레이아웃 (2026-08-12)

**실행 중 화면은 문제가 주 컬럼, 상태가 보조 사이드바다.** 그전에는 문제 카드와 진행 상황 박스가
둘 다 전체 폭으로 세로로 쌓여 있었는데, 실사용에서 "문제칸이 너무 작고 상태칸이 너무 크다"는
지적이 나왔다. 실제로 사람이 세션 내내 계속 읽어야 하는 건 문제 텍스트이고(단계형 문제는 단계가
쌓일수록 계속 길어진다), 진행 막대는 곁눈질로 확인하는 값이다. 그래서:

- 컨테이너를 `max-w-4xl` → `max-w-6xl`로 넓히고, 실행 중에는 `lg:grid-cols-5`로 나눈다 —
  **문제 3/5, 상태 2/5**. 비율은 `page.tsx`의 `lg:col-span-3` / `lg:col-span-2`만 바꾸면 된다.
- 상태 사이드바는 `lg:sticky lg:top-6`이라 문제를 스크롤해도 따라온다.
- 문제 카드 본문은 `text-[15px] leading-7`로 키웠고, 루브릭과 진행 안내는 `<details>`로 접어서
  본문과 자리를 다투지 않게 했다.
- 좁은 화면(`lg` 미만)에서는 예전처럼 한 컬럼으로 쌓인다.

**기반 두 가지도 같이 고쳤다**(둘 다 실제 결함이었다):

- `layout.tsx`가 Geist 폰트를 로드하는데 `globals.css`의 `font-family: Arial`이 그걸 덮어써서
  **한 번도 안 쓰이고 있었다.** `--font-sans`를 쓰도록 고치고 한글 폰트를 뒤에 붙였다.
- `globals.css`에 `prefers-color-scheme: dark` 블록이 있어 **body 배경만** 검게 뒤집혔는데, 화면의
  모든 컴포넌트는 라이트 고정 색이라 OS 다크 사용자에게는 검은 배경 + 흰 카드가 섞여 나왔다.
  제대로 지원하려면 전 컴포넌트 색을 토큰화해야 하는데 로컬 1인용 도구에 그만한 값이 없다고 보고
  **라이트 전용으로 명시 고정**했다(어정쩡하게 반만 지원하지 않는다).

## 다른 PC에서 실행하기 (2026-08-06)

이 앱은 로컬 VS Code/`claude.exe`를 직접 제어하는 구조라(위 "실행 러너" 참고) Vercel류 클라우드 배포와는 안 맞는다 — 사람이 실제로 앉아서 VS Code로 타이핑하는 바로 그 PC에서 서버가 돌아야 한다. 그래서 배포 대신 "다른 PC에 로컬로 복사해서 원클릭 실행"하는 방식을 택했다.

- **전제**: 대상 PC에 Node.js, VS Code, Claude Code CLI(구독 로그인 완료)가 이미 설치되어 있어야 한다. `start.bat`은 이것들을 설치하지 않는다.
- **`start.bat`**(프로젝트 루트): 더블클릭하면 `.env` 없으면 `.env.example`로 생성 → `node_modules` 없으면 `npm install` → `npx prisma migrate deploy`로 스키마 반영 → `npm run dev`를 별도 콘솔 창에서 실행 → 서버가 응답할 때까지 폴링한 뒤 기본 브라우저로 `http://localhost:3000`을 연다.
- **`package.bat`**(프로젝트 루트): 배포용 zip을 만든다. `node_modules`/`.next`/`prisma/dev.db`는 빼고(이 PC 전용 상태 — 대상 PC에서 `start.bat`이 알아서 새로 만든다), **`.env`는 그대로 포함한다**(아래 참고) — `%USERPROFILE%\Desktop`에 zip으로 떨어진다.
- **`OPENAI_API_KEY`를 그대로 공유하기로 결정함(2026-08-06)**: 처음엔 각 PC가 자기 키를 직접 발급받게 하거나(유출 위험 없음, 대신 상대방이 키 발급 절차를 거쳐야 함), 진짜 키를 안 보여주면서 공유하는 릴레이 프록시(Cloudflare Worker)까지 만들어봤는데, 후자는 "상대 PC에서 압축 풀고 바로 실행"이라는 목표에 비해 설치 단계(클라우드 계정, `wrangler` 배포, 토큰 관리)가 과했다. 최종적으로 "압축 풀면 바로 된다"는 단순함을 우선해 **진짜 `OPENAI_API_KEY`를 `.env`에 그대로 담아 zip에 포함**하기로 사용자가 명시적으로 결정했다 — 유출 위험을 인지한 상태의 트레이드오프다. 안전장치로 [platform.openai.com](https://platform.openai.com) 대시보드에서 이 키에 지출 한도(hard spending limit)를 걸어두는 걸 강력히 권장한다 — zip을 나눠준 만큼 그 키를 손에 쥔 사람이 늘어난다는 뜻이므로, 새는 걸 막기보다 "새도 피해가 한도 안에서 끝나게" 하는 쪽으로 대응한다.
- 워크스페이스 기본 위치(`RUN_WORKSPACES_DIR` 미설정 시 `<work>/vibecheck-runs/`)는 PC마다 별도로 생성된다 — 공유하지 않는다.
