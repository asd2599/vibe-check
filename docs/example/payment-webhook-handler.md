# 문제 설계 브리프 — 결제 웹훅 핸들러 (효율 변별형)

> 이 문서는 **완성된 문제가 아니라 "문제 저자 브리프"** 다. Claude Code가 이 문서를 읽고
> `problems/payment-webhook-handler.json` + `problems/starters/payment-webhook-handler/` 전체를
> 스캐폴딩할 수 있도록, 필요한 모든 것(시나리오·참고문서 함정값·스타터 파일 구성·히든 테스트·한도 근거)을
> 담았다. 포맷 규칙은 `docs/problem-set.md`를 따른다.

---

## 0. 이 문제가 노리는 변별 축

- **핵심 변별 = 효율(토큰) 스프레드.** 정답 코드는 누구나 맞출 수 있지만, **워크스페이스가 크고(약 16개 파일)
  실제로 고칠 건 2~3개뿐**이라서:
  - naive: "코드베이스 파악한다"며 전부 읽음 → `cache_read` 위주로 토큰 폭증
  - 기술: `Grep`/타겟 `Read`로 핸들러만 찾아 읽음 → 훨씬 적은 토큰
  - **같은 정답, 토큰 2~4배 차이**를 만든다.
- **보조 변별 = 문서 함정(correctness).** `WEBHOOK_SPEC.md`에 **비관습적 값**을 심어서, 문서를 안 읽고
  관습대로 구현하면 히든 테스트에서 떨어지게 한다.
- **오염 함정.** 거대한 픽스처 파일(`fixtures/events-dump.json`, 수천 줄)을 넣어둔다. naive가 "이해하려고"
  통째로 읽으면 토큰을 크게 날리고 컨텍스트가 오염된다. 실제 과제와는 무관하다.

> 채택 기준: 스캐폴딩 후 **naive 프롬프트("여기 있는거 고쳐줘")** 와 **기술 접근(grep→타겟 read→수정)** 두 방식으로
> 직접 돌려서 **토큰 스프레드가 최소 2배 이상** 벌어지는지 실측한다. 안 벌어지면 워크스페이스를 더 키우거나
> 오염 파일을 늘린다. (`docs/problem-set.md`의 naive-vs-정답 검증 + 스프레드 측정)

---

## 1. 시나리오 프롬프트 (`prompt` 필드)

실무 슬랙 톤. 요구사항을 다 적지 않는다 — 정확한 규칙은 문서로 미룬다.

```
[슬랙 DM - 김리드]
바쁘신데 죄송해요 🙏 결제 웹훅 받는 서비스에서 버그가 하나 있어서요.
PG사에서 같은 결제 이벤트를 가끔 두 번씩 쏘는데, 그때 주문이 중복 처리되는 것 같아요.
그거 좀 막아주시고, 이번에 환불 이벤트(refund) 타입도 새로 처리해야 해서 같이 부탁드려요.
서명 검증이랑 정확한 응답 규칙은 저희 연동 문서(WEBHOOK_SPEC.md)에 정리돼 있으니 꼭 그대로 맞춰주세요!
다른 팀 시스템이랑 엮여 있어서 응답 포맷 틀리면 바로 장애나요 😭
테스트는 npm test로 돌려보시면 돼요. 오늘 중으로만 되면 감사하겠습니다!
```

---

## 2. 스타터 워크스페이스 구성 (`starterFiles`)

`problems/starters/payment-webhook-handler/` 아래에 아래 구조로 생성한다.
**"실제로 고쳐야 하는 파일"과 "무관한 분산 파일(distractor)"을 명확히 구분**하는 게 이 문제의 핵심이다.

```
payment-webhook-handler/
├── package.json                 # test 스크립트: node --test (또는 jest). 응시자가 건드리면 안 됨
├── WEBHOOK_SPEC.md              # ★ 반드시 읽어야 하는 함정 문서 (아래 3장)
├── src/
│   ├── server.js                # express 앱 부팅 (무관 — 읽을 필요 없음)
│   ├── routes/
│   │   ├── webhook.js            # ★ 실제 수정 대상 1: 웹훅 엔드포인트 핸들러
│   │   └── health.js             # 무관
│   ├── services/
│   │   ├── orderService.js       # ★ 실제 수정 대상 2: 주문 처리 (중복 방지 로직 들어갈 곳)
│   │   ├── refundService.js      # ★ 실제 수정 대상 3: 환불 처리 (신규 이벤트 연결)
│   │   ├── signature.js          # 서명 검증 유틸 (이미 구현됨 — 여기서 헤더명만 참고하면 됨)
│   │   ├── emailService.js       # 무관 (distractor)
│   │   ├── auditLog.js           # 무관 (distractor)
│   │   └── metrics.js            # 무관 (distractor)
│   ├── db/
│   │   ├── memoryStore.js        # 인메모리 저장소 (idempotency 키 저장에 사용 — 살짝 관련)
│   │   └── schema.js             # 무관 (distractor)
│   └── utils/
│       ├── logger.js             # 무관 (distractor)
│       ├── config.js             # 무관 (distractor)
│       └── validators.js         # 무관 (distractor)
└── fixtures/
    └── events-dump.json          # ★ 오염 함정: 수천 줄짜리 과거 이벤트 덤프. 과제와 완전 무관.
```

### 스타터 코드가 갖춰야 할 상태

- `webhook.js`: POST `/webhook` 핸들러가 이미 있고, `payment.completed` 이벤트를 받아
  `orderService.createOrder()`를 호출한다. **단, (1) 서명 검증을 호출만 하고 실패해도 그냥 통과시키는 버그,
  (2) 중복 이벤트 방어(idempotency) 없음, (3) `refund` 타입은 처리 안 하고 그냥 200만 반환** — 이 세 개가 미완성.
- `orderService.js`: `createOrder(payload)`는 동작하지만 같은 결제ID로 두 번 부르면 주문이 2개 생긴다.
- `refundService.js`: `processRefund(payload)` 함수 시그니처만 있고 본문은 `throw new Error("not implemented")`.
- `signature.js`: `verifySignature(rawBody, headerValue)` 정상 구현. 응시자는 이걸 **호출**만 하면 된다.
- 나머지 distractor 파일들: 그럴듯하게 동작하는 코드로 채워두되, 과제와 논리적으로 얽히지 않게 한다
  (읽어도 시간·토큰만 낭비되도록).

---

## 3. `WEBHOOK_SPEC.md` — 함정 문서 (비관습적 값이 핵심)

이 문서에 **"관습대로 하면 틀리는" 값**을 심는다. 안 읽으면 히든 테스트에서 반드시 떨어져야 한다.

문서에 명시할 규칙 (예시 함정값 — 실제 값은 스캐폴딩 시 이 취지대로 고정):

1. **서명 헤더 이름이 비표준.** 관습적인 `X-Signature`가 아니라 **`X-PG-Verify`** 헤더에서 읽어야 한다.
   서명이 틀리면 **401**이 아니라 사내 규칙상 **`403` + body `{ "errorCode": "SIG_MISMATCH" }`** 로 응답.
   (필드명이 `error`가 아니라 `errorCode`인 것도 함정 — 이름부터 다르게.)
2. **Idempotency 키는 `eventId`가 아니라 `payload.data.paymentId + ":" + payload.type` 조합.**
   같은 조합이 이미 처리됐으면 새로 처리하지 말고 **200 + body `{ "status": "duplicate_ignored" }`** 반환.
   (관습적으로 그냥 eventId로 dedup하면 → refund와 payment가 같은 paymentId를 공유하는 케이스에서 틀린다.)
3. **알 수 없는 이벤트 타입**은 무시하되 **422**로 응답 (관습적 400 아님), body `{ "errorCode": "UNKNOWN_EVENT" }`.
4. **정상 처리 응답 포맷 통일**: 성공 시 항상 `{ "status": "ok", "handled": "<type>" }`.

### 문서에도 안 쓰고 "맥락에서 판단"해야 하는 요소 (스펙-대신-써줘 우회 차단)

- 슬랙에서 "중복 처리를 막아달라"고 했지만 **refund의 경우엔 중복이면 어떻게 할지**는 문서에도 없다.
  → 규칙 2를 refund에도 동일 적용해야 한다는 걸 **스스로 판단**해야 한다. (payment만 dedup하고 refund를
  빠뜨리면 히든 테스트에서 떨어진다.) 이건 문서를 통째로 긁어 spec 하나 만들어 구현하는 우회로는 못 채운다.

---

## 4. 채점 (`testCommand` + 히든 테스트)

`testCommand`: `npm test`. 테스트 파일은 응시자에게 **공개하지 않는다**(스타터에 넣지 않고, 평가 시점에
워크스페이스로 복사해 실행하는 방식 — `docs/evaluation.md` 규칙에 맞춰 eval-engineer가 배치).

히든 테스트가 검증할 항목 (전부 문서 함정과 연결):

- [ ] 잘못된 서명 → **403 + `{errorCode:"SIG_MISMATCH"}`** (헤더 `X-PG-Verify` 사용 확인)
- [ ] 같은 `paymentId+type` 두 번 → 두 번째는 **200 + `{status:"duplicate_ignored"}`**, 주문/환불 1건만 생성
- [ ] `refund` 이벤트 정상 처리 → `{status:"ok", handled:"refund"}` + 환불 1건 기록
- [ ] refund도 중복이면 dedup (문서 밖 판단 항목)
- [ ] 알 수 없는 타입 → **422 + `{errorCode:"UNKNOWN_EVENT"}`**
- [ ] 정상 payment → `{status:"ok", handled:"payment"}`
- [ ] `package.json`/기존 테스트/`signature.js`를 수정하지 않고 통과했는가

### `rubric` (LLM 채점 항목)

```
- WEBHOOK_SPEC.md의 비관습적 규칙(헤더명 X-PG-Verify, 403/422 코드, errorCode 필드명)을 정확히 반영했는가
- idempotency 키를 paymentId+type 조합으로 구성했는가(단순 eventId dedup이 아닌가)
- refund에도 중복 방지를 적용했는가(문서에 없는, 맥락 판단 항목)
- signature.js를 재구현하지 않고 기존 유틸을 호출만 했는가
- 코드 가독성과 기존 구조와의 일관성
```

---

## 5. 한도 (`maxTokens` / `maxDurationMs`)

`docs/problem-set.md`의 "턴당 1만~1.5만 토큰" 기준으로 산정한다.

- 예상 왕복: grep로 대상 찾기(1) + WEBHOOK_SPEC 읽기(1) + 대상 파일 3개 읽기(2~3) + 수정 왕복(3~5) +
  테스트 돌려 고치기(2~3) ≈ **10~14턴** → 기술 접근 기준 대략 **12만~18만 토큰** 예상.
- naive(전체 파일 + 오염 픽스처까지 읽기)는 여기에 오염 파일만으로도 수만~십수만이 더 붙어 **30만+** 로 튈 수 있음.

권장 초기값 (실측 후 조정):

| 필드 | 값 | 근거 |
|---|---|---|
| `maxTokens` | **250000** | 기술 접근은 통과, 오염 파일까지 다 읽는 naive는 실격 위험 → **효율이 통과/실격을 가르게** 함(레시피 B) |
| `maxDurationMs` | **1800000** (30분) | 사람이 문서 읽고 판단·타이핑하는 시간 포함, medium 기준 |
| `difficulty` | `medium` | |
| `category` | `refactor` (또는 `api`) | |

> ⚠️ `maxTokens`를 250k로 두면 "예산 게이팅(B)"으로 동작한다 — naive가 실제로 실격되는지 스캐폴딩 후
> 반드시 실측하라. 만약 오염 파일을 읽어도 250k를 안 넘으면 (a) 오염 파일을 더 키우거나 (b) maxTokens를
> 스프레드 측정값 사이로 낮춰라. 단순 효율 랭킹만 원하면 반대로 maxTokens를 400k처럼 넉넉히 두고 둘 다
> 통과시킨 뒤 토큰 수로 줄세운다.

---

## 6. 스캐폴딩 후 필수 검증 (이걸 통과 못 하면 문제 폐기)

1. **정답 검증**: 문서를 반영한 정석 구현으로 히든 테스트 전부 통과.
2. **naive 실패 검증**: 문서 안 읽고 관습대로 구현 → 서명/idempotency/코드값 테스트에서 떨어짐.
3. **스펙-대신-써줘 우회 검증**: 문서를 안 보여주고 "상황 보고 알아서 구현해줘" → refund dedup(문서 밖 판단
   항목)에서 떨어짐.
4. **토큰 스프레드 검증**: naive(전체+오염 파일 읽기) vs 기술(grep→타겟) 토큰을 실측, **2배 이상** 벌어지는지 확인.

네 가지 모두 통과하면 이 문제는 "정답은 쉽지만 기술이 점수를 가르는" VibeCheck 황금 표준 템플릿이 된다.
