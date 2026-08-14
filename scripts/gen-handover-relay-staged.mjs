// handover-relay-staged 리소스 생성기 (v2, 결정론적 — 같은 시드면 항상 같은 결과)
//
//   node scripts/gen-handover-relay-staged.mjs
//
// 개정 근거: docs/example/handover-relay-staged-v2.md
//   v1 실측(run cd85075a Haiku / de559ff8 Sonnet)이 v1 전제를 반증했다 —
//   ① cache_read가 input보다 10배 싸서 큰 컨텍스트를 이고 가는 벌점이 Haiku에선 거의 안 느껴진다.
//   ② 적재비용(cache_write)은 두 경로가 똑같이 낸다. 분리로 아끼는 건 "적재 후 이고 간 턴"의
//      cache_read뿐이라, 차이를 키우려면 **블록 수 × 이후 무관 턴 수**를 키워야 한다.
//
// 그래서 v2는 **무거운 산문 블록 3개**를 서로 다른 직무에 적재하고 각 블록 뒤에 무관 업무를 둔다:
//   A(1~2단계 인프라) handover.md  ≈38K토큰 — override 체인
//   B(3~4단계 결제)   tickets.md   ≈38K토큰 — 다변형 정규화(Haiku 실패 함정)
//   C(5~6단계 데이터) requests.md  ≈38K토큰 — 다단 조건 + 경계값
//   7단계(인프라 복귀) — A·B에서 확정한 값 교차 참조
//
// 피크 상주 ≈114K 토큰으로 잡았다(v2 문서 2절: auto-compact를 피하려면 ~120K 아래).
//
// 함정은 **개수가 아니라 격차**로 고른다(v2 3절). 함정을 쌓으면 Haiku만이 아니라 Sonnet도 같이
// 깎여서(4개면 Sonnet 전부통과 81%) 효율 축 측정 자체가 무너진다. 그래서 격차 큰 함정
// **3가족만** 쓰고, 4·6단계는 앞 단계 결과를 집계만 하는 무함정 단계로 둬서 턴만 늘린다.

import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STARTERS = path.join(ROOT, "problems", "starters");
const ID = "handover-relay-staged";

// ---------------------------------------------------------------------------
// 결정론적 난수 (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20260813);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// ---------------------------------------------------------------------------
// 참가자 노출 텍스트 금지어 (v2 문서 머리말 — v1 원칙 그대로 유효)
// ---------------------------------------------------------------------------
const BANNED = ["컨텍스트", "토큰", "세션", "압축", "정리", "context", "Context", "split", "clear", "Clear", "compact"];
function assertClean(label, text) {
  for (const w of BANNED) {
    if (text.includes(w)) throw new Error(`[말끔함 검증 실패] ${label}: 금지어 "${w}"`);
  }
}

// ---------------------------------------------------------------------------
// 한국어 조사 보정 — 슬롯을 그냥 끼우면 "서선임가"처럼 어긋나서 기계로 찍은 티가 난다.
// 문서가 부자연스러우면 참가자가 "더미구나" 하고 안 읽어서, 통째로 읽는 naive 경로 자체가 안 생긴다.
// ---------------------------------------------------------------------------
const JOSA = {
  "#이가": ["이", "가"],
  "#은는": ["은", "는"],
  "#을를": ["을", "를"],
  "#와과": ["과", "와"],
  "#으로": ["으로", "로"],
};
function fixJosa(text) {
  return text.replace(/(.)(#이가|#은는|#을를|#와과|#으로)/g, (_, ch, tag) => {
    const code = ch.charCodeAt(0);
    let hasJong = false;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const jong = (code - 0xac00) % 28;
      hasJong = tag === "#으로" ? jong !== 0 && jong !== 8 : jong !== 0;
    }
    const [withJong, withoutJong] = JOSA[tag];
    return ch + (hasJong ? withJong : withoutJong);
  });
}

// ===========================================================================
// 공통 산문 재료
// ===========================================================================
const SYSTEMS = [
  "빌링 어드민", "정산 배치", "알림 발송기", "레거시 회원 API", "리포트 큐",
  "이미지 변환기", "쿠폰 엔진", "위키 연동기", "메일 릴레이", "주문 동기화기",
  "권한 관리 모듈", "파일 보관소", "재고 미러", "사내 단축주소기", "출근 기록기",
];
const PEOPLE = ["김주임", "박팀장", "최과장", "이대리", "윤사원", "한책임", "서선임", "조매니저", "노수석"];
const TEAMS = ["인프라팀", "결제팀", "데이터팀", "CS팀", "보안팀", "QA팀", "경영지원팀"];
const PLACES = [
  "구 위키 12번 문서", "공유 드라이브의 '이관' 폴더", "슬랙 #infra-old 고정 글",
  "노션 아카이브 페이지", "메일함의 '인수' 라벨", "제 자리 서랍의 파란 바인더",
];
const MONTHS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "9월", "10월", "11월"];

const SENTENCES = [
  "{sys}#은는 {who}#이가 한참 전에 만든 뒤로 거의 손을 안 댔습니다.",
  "{sys} 관련 문의가 오면 {team}#으로 그대로 넘기시면 됩니다.",
  "이 부분은 {place}에 더 자세히 적혀 있는데, 오래된 내용이라 절반은 지금과 안 맞습니다.",
  "{who}님이 지난 분기에 한 번 손봤고, 그 뒤로는 바뀐 게 없습니다.",
  "배포 자체는 수동이고 승인은 {who}님이 해주셨습니다.",
  "장애가 나면 {team}에 먼저 알리고 그다음 {who}님께 연락하는 순서였습니다.",
  "{sys}#와과 {sys2}#이가 같은 큐를 쓰기 때문에 한쪽을 내리면 다른 쪽도 같이 밀립니다.",
  "이 화면은 아무도 안 쓰는데 지우면 배치가 죽어서 그냥 두고 있습니다.",
  "{who}님이 만든 스크립트가 하나 돌고 있는데 어디서 도는지는 저도 못 찾았습니다.",
  "{month} 중순쯤 {team}에서 요청이 와서 급하게 붙인 기능입니다.",
  "여기서 나오는 경고는 무시해도 됩니다. 몇 년째 같은 문구가 뜨고 있습니다.",
  "{sys} 쪽 담당은 공식적으로는 {team}인데 실제로는 제가 봐왔습니다.",
  "설정 파일이 두 군데 있는데 실제로 읽히는 건 아래쪽 하나뿐입니다.",
  "이 작업은 반드시 업무 시간 이후에 하셔야 합니다. 낮에 하면 {team}에서 바로 연락 옵니다.",
  "{who}님께 여쭤보면 아마 기억하실 겁니다. 제가 물어봤을 때는 알고 계셨습니다.",
  "{sys} 쪽 알림이 하루에 스무 통씩 오는데 대부분 의미 없는 것들입니다.",
  "예전에 한 번 크게 터진 적이 있어서 그 뒤로 다들 조심스러워합니다.",
  "이 값은 바꿔도 되는데 바꾸고 나면 {team}에 미리 말씀해주셔야 합니다.",
  "관련 이력은 {place}에 남아 있습니다. 다만 중간이 비어 있습니다.",
  "제가 인수받았을 때도 설명을 못 들어서 반쯤은 짐작으로 운영했습니다.",
  "{sys}#은는 곧 걷어낼 예정이라고 몇 년째 이야기만 나오고 있습니다.",
  "테스트 계정은 {who}님이 관리하십니다. 비밀번호는 따로 전달드리겠습니다.",
  "{month}에 한 번 크게 개편했는데 그때 문서를 못 고쳤습니다. 죄송합니다.",
  "여기 적힌 절차는 지금과 다릅니다. 아래쪽에 다시 적어두겠습니다.",
  "이 배치는 새벽 세 시에 돌고, 실패하면 다음 날 아침에야 알 수 있습니다.",
  "{team}에서 매달 첫째 주에 리포트를 요청합니다. 양식은 {place}에 있습니다.",
  "{sys} 접속은 사내망에서만 됩니다. 원격이면 VPN을 먼저 붙이셔야 합니다.",
  "이 기능은 특정 협력사 하나 때문에 남아 있습니다. 지우면 안 됩니다.",
  "권한 요청은 {who}님께 드리면 반나절 안에 처리해주십니다.",
  "저도 이 부분은 끝까지 이해하지 못했습니다. 죄송합니다.",
  "화면에 보이는 숫자와 실제 값이 다릅니다. 반올림해서 보여주고 있어서 그렇습니다.",
  "{sys} 배포 후에는 반드시 {team} 담당자에게 확인 요청을 드려야 합니다.",
  "예전 담당자분이 남긴 메모가 {place}에 그대로 있습니다. 참고만 하십시오.",
  "여기는 건드릴 일이 거의 없습니다. 일 년에 한두 번 정도입니다.",
  "이 작업은 두 사람이 같이 해야 합니다. 혼자 하면 중간에 막힙니다.",
  "{month} 이후로는 {who}님이 대신 봐주고 계셨습니다.",
  "실수로 두 번 실행해도 문제는 없습니다. 같은 결과가 나옵니다.",
  "반대로 이건 두 번 실행하면 데이터가 어긋납니다. 꼭 한 번만 하십시오.",
  "관련해서 {team}#와과 합의한 내용이 있는데 문서로는 안 남아 있습니다.",
  "이 항목은 감사 대상이라 임의로 바꾸시면 안 됩니다.",
  "{sys} 담당자가 최근에 바뀌었습니다. 지금은 {who}님입니다.",
  "그 밖에 특별히 주의할 점은 없습니다. 평소대로 하시면 됩니다.",
  "혹시 막히시면 저한테 연락 주셔도 됩니다. 아는 만큼은 답해드리겠습니다.",
  "이 절차는 예전 방식이고 지금은 안 씁니다. 참고로만 남겨둡니다.",
  "여기 언급된 서버는 이미 없어졌습니다. 이름만 남아 있습니다.",
];

const NOTE_LINES = [
  "- {who}: {sys} 쪽 알림이 너무 많다는 의견",
  "- {team}에서 다음 달까지 개선 요청",
  "- 결론 없이 다음 주로 넘김",
  "- {who}님이 확인 후 회신하기로 함",
  "- {sys} 관련 건은 보류",
  "- 담당자 없음 상태 계속됨",
  "- {place} 문서 갱신 필요 (아직 못 함)",
  "- {team}#와과 일정 조율 필요",
];

function sentence() {
  const s = pick(SENTENCES);
  const sys = pick(SYSTEMS);
  let sys2 = pick(SYSTEMS);
  while (sys2 === sys) sys2 = pick(SYSTEMS);
  return fixJosa(
    s
      .replace("{sys2}", sys2)
      .replace("{sys}", sys)
      .replace("{who}", pick(PEOPLE))
      .replace("{team}", pick(TEAMS))
      .replace("{place}", pick(PLACES))
      .replace("{month}", pick(MONTHS)),
  );
}
function noteLine() {
  return fixJosa(
    pick(NOTE_LINES)
      .replace("{sys}", pick(SYSTEMS))
      .replace("{who}", pick(PEOPLE))
      .replace("{team}", pick(TEAMS))
      .replace("{place}", pick(PLACES)),
  );
}

// 한 문단 안에서 같은 문장이 반복되면 생성기 티가 난다 — 몇 번 다시 뽑는다.
function paragraph(n, gen) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = gen();
    for (let t = 0; t < 8 && seen.has(s); t++) s = gen();
    seen.add(s);
    out.push(s);
  }
  return out;
}

// 섹션 골격을 만드는 공용 루틴 — 지정한 절에 planted 문장을 끼워넣는다.
function buildProseDoc({ header, sectionCount, planted, titlesVague, titlesConcrete, paraRange }) {
  const bySection = new Map();
  for (const p of planted) {
    if (!bySection.has(p.section)) bySection.set(p.section, []);
    bySection.get(p.section).push(p.text);
  }
  let vi = 0;
  let ci = 0;
  const out = [...header, ""];

  for (let s = 1; s <= sectionCount; s++) {
    const isPlanted = bySection.has(s);
    // 값이 심어진 절은 제목만 봐서는 뭐가 들었는지 알 수 없게 둔다 — 제목이 표식이 되면
    // 제목만 훑어도 답이 나와서 "통째로 읽는 게 자연스럽다"는 구조가 무너진다.
    let title;
    if (isPlanted || rnd() < 0.25) {
      title = titlesVague[vi % titlesVague.length];
      vi++;
    } else {
      title = titlesConcrete[ci % titlesConcrete.length];
      ci++;
    }
    out.push(`## ${s}. ${title}`, "");

    const paraCount = int(paraRange[0], paraRange[1]);
    const plantAt = isPlanted ? int(1, paraCount - 1) : -1;
    for (let p = 0; p < paraCount; p++) {
      if (p === plantAt) {
        for (const t of bySection.get(s)) out.push(t, "");
      }
      if (rnd() < 0.18) {
        out.push(...paragraph(int(3, 5), noteLine), "");
      } else {
        out.push(paragraph(int(2, 5), sentence).join(" "), "");
      }
    }
  }
  return out.join("\n");
}

// ===========================================================================
// 블록 A — handover.md (인프라, 1~2단계)
//
// 함정 가족 ①: override 체인. 같은 항목이 정확히 3번 나오고 **뒤가 최신**이다.
// 마지막 언급에 "최종/확정" 같은 표식은 일부러 안 넣는다(표식이 있으면 그 단어만 찾으면 끝난다).
// ===========================================================================

const STAGING = {
  stagingPort: 7443,
  dbSchema: "stg_core_v3",
  retryLimit: 2,
  stagingHost: "stg-edge-07.internal",
  healthPath: "/__alive",
  cacheTtlSeconds: 45,
};
const ROLLBACK_TAG = "hotfix-0217";
// 운영 값은 언급이 1회뿐이다(체인 없음). 1단계에서는 미끼로 작동하고, 2단계에서는 실제로 필요해진다
// — 미끼를 "틀리게 만드는 장치"가 아니라 "읽어야 할 정보"로 겸용해서 Sonnet 위험을 안 키운다.
const PROD = {
  port: 443,
  dbSchema: "prod_core_r2",
  retryLimit: 6,
  host: "prod-edge-01.internal",
  healthPath: "/health-check",
  cacheTtlSeconds: 1800,
};

const PLANTED_A = [
  { section: 4, text: "스테이징 웹 포트는 일단 8080으로 열어뒀습니다. 처음 붙이실 때 이걸로 접속해보시면 됩니다." },
  { section: 21, text: "스테이징 웹 포트를 8443으로 바꿨습니다. 사내 프록시가 쓰던 대역과 겹쳐서 어쩔 수 없었습니다." },
  { section: 44, text: `스테이징 웹 포트를 ${STAGING.stagingPort}으로 옮겼습니다. 보안팀 요청이라 되돌릴 수 없습니다.` },

  { section: 7, text: "스테이징 DB 스키마 이름은 staging_v2입니다. 접속하시면 이 이름으로 보입니다." },
  { section: 28, text: "스테이징 DB 스키마를 stg_core로 옮겼습니다. 이전 이름으로는 이제 안 붙습니다." },
  { section: 49, text: `스테이징 DB 스키마를 ${STAGING.dbSchema}으로 다시 만들었습니다. 컬럼이 두 개 늘어서 새로 판 겁니다.` },

  { section: 11, text: "스테이징 배포 스크립트의 재시도 횟수는 3회로 두고 있습니다." },
  { section: 33, text: "스테이징 배포 재시도 횟수를 5회로 늘렸습니다. 그때 유난히 자주 끊겼습니다." },
  { section: 47, text: `스테이징 배포 재시도 횟수를 ${STAGING.retryLimit}회로 줄였습니다. 5회는 과했고 오히려 배포가 늘어졌습니다.` },

  { section: 9, text: "스테이징 호스트 이름은 stg-web-01.internal입니다. 사내망에서만 붙습니다." },
  { section: 26, text: "스테이징 호스트를 stg-web-02.internal로 옮겼습니다. 앞 장비가 노후돼서 교체했습니다." },
  { section: 52, text: `스테이징 호스트를 ${STAGING.stagingHost}로 옮겼습니다. 앞단 장비 쪽으로 붙이라는 방침이 생겼습니다.` },

  { section: 15, text: "스테이징 헬스 체크 경로는 /health입니다. 모니터링이 이 주소를 봅니다." },
  { section: 31, text: "스테이징 헬스 체크 경로를 /healthz로 바꿨습니다. 다른 팀 규칙에 맞춘 겁니다." },
  { section: 55, text: `스테이징 헬스 체크 경로를 ${STAGING.healthPath}로 바꿨습니다. 외부에서 긁어가는 걸 막으려고 이렇게 했습니다.` },

  { section: 18, text: "스테이징 캐시 만료 시간은 300초입니다. 처음 잡을 때 대충 정한 값입니다." },
  { section: 36, text: "스테이징 캐시 만료 시간을 900초로 늘렸습니다. 부하 실험 때문이었습니다." },
  { section: 53, text: `스테이징 캐시 만료 시간을 ${STAGING.cacheTtlSeconds}초로 줄였습니다. 테스트할 때 값이 안 바뀌어 보인다는 항의가 많았습니다.` },

  { section: 23, text: "스테이징 롤백 기준 태그는 rel-2024-11입니다. 문제가 생기면 이 지점으로 되돌립니다." },
  { section: 40, text: "스테이징 롤백 기준 태그를 rel-2025-03으로 갱신했습니다." },
  { section: 57, text: `스테이징 롤백 기준 태그를 ${ROLLBACK_TAG}로 갱신했습니다. 그 사이에 급한 수정이 두 번 들어갔습니다.` },

  // 운영/로컬 (각 1회)
  { section: 6, text: `참고로 운영 웹 포트는 ${PROD.port}이고, 로컬에서 띄우실 때는 3000을 씁니다. 스테이징과 헷갈리지 마십시오.` },
  { section: 13, text: `운영 DB 스키마 이름은 ${PROD.dbSchema}입니다. 여기는 제가 권한이 없어서 조회만 했습니다.` },
  { section: 30, text: `운영 배포 재시도 횟수는 ${PROD.retryLimit}회입니다. 운영 쪽은 손대실 일이 없을 겁니다.` },
  { section: 38, text: `운영 호스트 이름은 ${PROD.host}입니다. 접속하려면 보안팀 승인이 따로 필요합니다.` },
  { section: 42, text: `운영 헬스 체크 경로는 ${PROD.healthPath}입니다. 스테이징과 주소가 다릅니다.` },
  { section: 50, text: `운영 캐시 만료 시간은 ${PROD.cacheTtlSeconds}초입니다. 이건 제가 건드린 적 없습니다.` },
  { section: 35, text: "로컬 개발용 호스트는 localhost로 두시면 됩니다. 사내 DNS는 안 탑니다." },
];

const VAGUE_A = [
  "이어서", "그 밖에", "추가 메모", "계속", "잡다한 것들", "생각난 김에",
  "메모 (계속)", "빠뜨린 것들", "덧붙임", "이것도 적어둡니다", "또 하나",
  "적다 보니 길어졌습니다", "여기부터는 순서가 없습니다", "남은 이야기",
  "다시 생각해보니", "아래도 참고", "이건 좀 애매합니다", "메모 (계속 2)",
];
const CONCRETE_A = [
  "시작하며 — 이 문서를 어떻게 보시면 되는지", "담당 업무 한눈에", "하루 일과",
  "접속 계정과 권한", "서버 목록과 역할", "모니터링 화면 보는 법",
  "자주 나는 장애 유형", "야간 배치 목록", "로그 보관 방식",
  "외부 연동 목록", "회의록 — 3월 첫째 주", "QA팀과 합의한 것들",
  "문서가 흩어져 있는 위치", "사내 프록시와 방화벽", "백업과 복구",
  "알림 채널 구성", "배포가 실패했을 때 하던 것들", "회의록 — 4월 둘째 주",
  "이제 안 쓰는 기능들", "자격 증명 보관 위치", "협력사 연동 창구",
  "태그 규칙과 릴리스 이름", "지표와 리포트", "회의록 — 5월 셋째 주",
  "테스트 데이터 만드는 방법", "주말 당직 이야기", "회의록 — 6월 첫째 주",
  "남은 숙제들", "마지막으로 드리는 말씀", "부록 — 연락처",
];

function buildHandover() {
  return buildProseDoc({
    header: [
      "# 인수인계 문서 (김주임)",
      "",
      "죄송합니다. 시간이 없어서 생각나는 대로 적었습니다. 순서가 뒤죽박죽입니다.",
      "",
      "**한 가지만 먼저 말씀드립니다.** 같은 항목이 문서 안에서 여러 번 나옵니다.",
      "적다가 나중에 바뀐 걸 뒤에 또 적었기 때문입니다. **그런 경우에는 언제나 뒤에 적힌 것이",
      "최신입니다.** 앞에 적힌 건 그때 그랬다는 기록으로만 봐주십시오.",
      "",
      "스테이징 말고 운영/로컬 값도 섞여 있습니다. 어느 환경 이야기인지는 문장마다 적어뒀습니다.",
      "",
      "필요하신 값은 이 안에 전부 들어 있습니다. 다만 찾기가 좀 번거로우실 겁니다.",
    ],
    sectionCount: 58,
    planted: PLANTED_A,
    titlesVague: VAGUE_A,
    titlesConcrete: CONCRETE_A,
    paraRange: [5, 9],
  });
}

// ===========================================================================
// 블록 B — payments/tickets.md (결제, 3~4단계)
//
// 함정 가족 ②: **다변형 정규화 병합.** 같은 원인 코드가 공백/하이픈/밑줄/대소문자만 다른
// 표기로 흩어져 있다. v1 실측에서 Haiku가 정확히 이 지점에서 틀렸다(소문자화만 하고
// 구분자 변형은 안 합침). Sonnet은 거의 항상 맞춘다 — **능력의 종류 차이**라 격차가 크다.
//
// 판정은 기계적으로 확정된다: 정식 코드 5개를 채팅으로 알려주므로, 구분자를 없애고 대소문자를
// 무시하면 각 표기가 정확히 하나의 코드에 대응한다(모호함 0).
// ===========================================================================

const CAUSES = {
  CARD_LIMIT: ["CARD_LIMIT", "card_limit", "card-limit", "cardLimit", "Card Limit", "CARDLIMIT"],
  EXPIRED_CARD: ["EXPIRED_CARD", "expired_card", "expired-card", "expiredCard", "Expired Card", "EXPIREDCARD"],
  NETWORK_ERR: ["NETWORK_ERR", "network_err", "network-err", "networkErr", "Network Err", "NETWORKERR"],
  AUTH_FAIL: ["AUTH_FAIL", "auth_fail", "auth-fail", "authFail", "Auth Fail", "AUTHFAIL"],
  NO_FUNDS: ["NO_FUNDS", "no_funds", "no-funds", "noFunds", "No Funds", "NOFUNDS"],
};
const CAUSE_CODES = Object.keys(CAUSES);
const PAY_TEAMS = ["결제1팀", "결제2팀", "가맹점지원팀", "리스크팀"];
const MERCHANTS = [
  "우리동네마트", "그린북스", "카페모리", "한빛문구", "미도리꽃집", "동성전자",
  "블루샌드", "온누리약국", "파랑세탁소", "달빛제과", "성수철물", "노을사진관",
];

// 티켓 문장은 **순서를 바꿔가며** 산문에 섞는다. 필드 순서가 고정이면 정규식 한 줄로 접혀서
// 원본이 대화에 안 올라오고, 그러면 상주 무게 자체가 안 생긴다(v1이 실패한 이유).
const TICKET_TEMPLATES = [
  (t) => `${t.merchant} 건입니다. 결제가 안 된다고 연락 주셨고 확인해보니 원인은 ${t.variant}였습니다. 금액은 ${t.amount.toLocaleString()}원이었고 담당은 ${t.team}입니다.`,
  (t) => `담당 ${t.team}. 금액 ${t.amount.toLocaleString()}원짜리 결제가 실패했는데 로그에 ${t.variant}#으로 찍혀 있었습니다. 가맹점은 ${t.merchant}입니다.`,
  (t) => `${t.merchant}에서 문의가 들어왔습니다. ${t.amount.toLocaleString()}원 결제 건이고, 사유는 ${t.variant}. ${t.team}에서 받아 처리했습니다.`,
  (t) => `원인 ${t.variant}. ${t.team} 이관 건이고 가맹점은 ${t.merchant}, 결제 금액은 ${t.amount.toLocaleString()}원이었습니다.`,
  (t) => `${t.team}에서 올린 건입니다. ${t.merchant} 결제 ${t.amount.toLocaleString()}원이 안 되고 있었고, 게이트웨이 응답은 ${t.variant}였습니다.`,
];
const TICKET_NOISE = [
  "고객이 여러 번 시도하신 흔적이 있습니다.",
  "가맹점 담당자분이 직접 전화를 주셨습니다.",
  "같은 날 비슷한 문의가 몇 건 더 있었습니다.",
  "전산 쪽에는 따로 남긴 기록이 없습니다.",
  "이건 예전에도 한 번 있었던 유형입니다.",
  "확인까지 사흘이 걸렸습니다.",
  "고객에게는 다음 날 안내드렸습니다.",
  "가맹점 쪽 단말 문제일 가능성도 있어 보입니다.",
  "추가로 확인할 건 없어 보입니다.",
  "담당자가 중간에 바뀌어서 인계가 한 번 더 있었습니다.",
];

const VAGUE_B = [
  "이어지는 접수분", "계속", "추가 접수", "그 밖의 건", "밀린 것들",
  "옮겨 적다 만 부분", "여기서부터 다시", "남은 접수분", "덧붙임",
];
const CONCRETE_B = [
  "접수 대장을 어떻게 봐야 하는지", "이번 분기 접수분", "가맹점 문의 유형",
  "게이트웨이 응답에 대해", "월초 접수분", "월중 접수분", "월말 접수분",
  "재문의가 들어온 건들", "담당 배분 기준", "회신이 늦었던 건들",
];

function buildTickets() {
  const tickets = [];
  const lines = [
    "# 결제 실패 접수 대장 (인수 전 자료)",
    "",
    "결제팀에서 접수한 실패 건을 그때그때 적어둔 것입니다. 사람마다 적는 방식이 달라서",
    "같은 원인인데도 표기가 제각각입니다. 죄송합니다.",
    "",
  ];

  let n = 0;
  let sec = 0;
  let vi = 0;
  let ci = 0;
  // 목표 분량에 닿을 때까지 절을 이어 붙인다(분량은 아래 SIZE_TARGET_B로 조절).
  while (lines.join("\n").length < SIZE_TARGET_B) {
    sec++;
    let title;
    if (rnd() < 0.4) {
      title = VAGUE_B[vi % VAGUE_B.length];
      vi++;
    } else {
      title = CONCRETE_B[ci % CONCRETE_B.length];
      ci++;
    }
    lines.push(`## ${sec}. ${title}`, "");

    // 절마다 산문 잡담 몇 문단 + 티켓 몇 건
    const chatter = int(1, 3);
    for (let i = 0; i < chatter; i++) lines.push(paragraph(int(2, 4), sentence).join(" "), "");

    const count = int(3, 6);
    for (let i = 0; i < count; i++) {
      n++;
      // 원인 분포를 일부러 한쪽으로 기울인다. 7단계가 "최다 원인 코드"를 교차 참조하는데,
      // 1~2건 차이로 1위가 갈리면 사소한 실수 하나가 7단계까지 뒤집어서 **측정 축이 아닌 곳에서
      // 결과가 흔들린다**(저장소 원칙). 넉넉한 격차를 두면 "변형을 합쳤는가"만 남는다 —
      // 안 합친 사람은 애초에 1위가 코드가 아니라 표기 문자열이라 반드시 틀린다.
      const code = rnd() < 0.40 ? "NETWORK_ERR" : pick(CAUSE_CODES.filter((c) => c !== "NETWORK_ERR"));
      const t = {
        id: "P-" + String(1000 + n),
        code,
        variant: pick(CAUSES[code]),
        amount: int(5, 900) * 1000,
        team: pick(PAY_TEAMS),
        merchant: pick(MERCHANTS),
      };
      tickets.push(t);
      lines.push(`### ${t.id}`, "");
      lines.push(fixJosa(pick(TICKET_TEMPLATES)(t)) + " " + pick(TICKET_NOISE), "");
      if (rnd() < 0.35) lines.push(paragraph(int(1, 3), sentence).join(" "), "");
    }
  }

  // --- 정답 ---
  const byCause = {};
  for (const c of CAUSE_CODES) byCause[c] = 0;
  for (const t of tickets) byCause[t.code]++;

  const byTeam = {};
  for (const t of tickets) {
    byTeam[t.team] ??= { count: 0, totalAmount: 0 };
    byTeam[t.team].count++;
    byTeam[t.team].totalAmount += t.amount;
  }

  // 판별력 확인: 소문자화만 하면(구분자 안 없애면) 코드가 5개보다 훨씬 많아져야 한다.
  const lowerOnlyKeys = new Set(tickets.map((t) => t.variant.toLowerCase()));
  if (lowerOnlyKeys.size <= CAUSE_CODES.length) {
    throw new Error("블록 B: 소문자화만 해도 정답이 나온다 — 변형이 부족하다");
  }
  // 모호함 0 확인: 구분자 제거 + 대문자화가 각 변형을 정확히 하나의 코드로 보낸다.
  const canon = (s) => s.replace(/[\s_-]/g, "").toUpperCase();
  const seen = new Map();
  for (const [code, variants] of Object.entries(CAUSES)) {
    for (const v of variants) {
      const k = canon(v);
      if (seen.has(k) && seen.get(k) !== code) throw new Error(`블록 B: 변형 "${v}"가 두 코드에 걸린다`);
      seen.set(k, code);
    }
  }

  const topCause = Object.entries(byCause).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const second = Object.entries(byCause).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[1];
  if (topCause[1] - second[1] < 15) {
    throw new Error(
      `블록 B: 최다 원인 격차가 ${topCause[1] - second[1]}건뿐이라 7단계 교차참조가 사소한 실수에 흔들린다`,
    );
  }

  return {
    text: lines.join("\n") + "\n",
    tickets,
    byCause,
    byTeam,
    topCause: topCause[0],
    lowerOnlyDistinct: lowerOnlyKeys.size,
  };
}

// ===========================================================================
// 블록 C — data/access-requests.md (데이터, 5~6단계)
//
// 함정 가족 ③: **다단 조건 + 경계값.** 규칙이 순서대로 적용되고 예외가 앞선다.
// 경계(초과 vs 이상)를 서로 다르게 섞어서 흔들리는 모델이 걸리게 한다.
// ===========================================================================

const REQ_DEPTS = ["마케팅팀", "영업팀", "고객지원팀", "재무팀", "상품팀"];
const REQ_PURPOSES = ["사내통계", "마케팅", "고객대응", "감사대응", "서비스개선"];
// 직급 어휘에 "급/임원"을 붙인 이유: 사람 이름 풀에 "박팀장"이 있어서 "팀장"만 쓰면 **승인자 이름과
// 직급이 문자열로 충돌한다**(검증에서 실제로 잡혔다 — 정석 구현이 5·6단계에서 틀렸다). 문서가
// 모호해지면 측정 축이 아닌 곳에서 결과가 갈린다(저장소 원칙). REQ_NAMES 도 같은 이유로 직급
// 낱말이 안 들어간 이름만 쓴다.
const REQ_RANKS = ["팀장급", "본부장급", "임원"];
const REQ_NAMES = ["김민서", "이준영", "박서윤", "정하늘", "최유진", "강도현", "윤지호", "임수아", "오세훈", "신예린"];
const REQ_KINDS = ["주문 내역", "접속 기록", "결제 수단 정보", "상담 이력", "회원 기본정보", "쿠폰 사용 내역"];

const VAGUE_C = [
  "이어지는 신청분", "계속", "추가 신청", "그 밖의 신청", "밀린 신청서",
  "여기서부터 다시", "남은 신청분", "덧붙임", "다시 이어서",
];
const CONCRETE_C = [
  "신청서를 어떻게 보시면 되는지", "이번 분기 신청분", "부서별 신청 경향",
  "반려가 잦았던 유형", "월초 신청분", "월중 신청분", "월말 신청분",
  "재신청 건들", "승인 절차 안내", "회신이 늦었던 신청서",
];

const REQ_TEMPLATES = [
  (r) => `${r.dept} ${r.requester}님이 올린 신청서입니다. ${r.kind}#을를 ${r.lookupDays}일치 조회하고 싶다고 하시고, 목적은 ${r.purpose}입니다. 보관은 ${r.retentionDays}일로 적으셨고 승인자는 ${r.approver} 직급 ${r.rank}입니다. 개인정보 ${r.hasPii ? "포함" : "미포함"}.`,
  (r) => `목적 ${r.purpose}. 신청 부서는 ${r.dept}이고 신청자는 ${r.requester}님입니다. 개인정보는 ${r.hasPii ? "포함됩니다" : "포함되지 않습니다"}. 조회 기간 ${r.lookupDays}일, 보관 기간 ${r.retentionDays}일. ${r.rank} ${r.approver}님이 승인하셨습니다. 대상은 ${r.kind}입니다.`,
  (r) => `${r.kind} 건입니다. 승인자는 ${r.rank}(${r.approver})이고 신청 부서는 ${r.dept}, 신청자는 ${r.requester}님입니다. 조회는 ${r.lookupDays}일, 보관은 ${r.retentionDays}일로 요청하셨습니다. 목적은 ${r.purpose}이며 개인정보 ${r.hasPii ? "포함" : "미포함"} 건입니다.`,
];
const REQ_NOISE = [
  "신청서 서식이 예전 것이라 항목 위치가 다릅니다.",
  "부서장 도장이 빠져 있어 한 번 반송했던 건입니다.",
  "같은 부서에서 비슷한 신청이 몇 건 더 있었습니다.",
  "담당자가 바뀌어 재신청된 건입니다.",
  "특별히 덧붙일 내용은 없습니다.",
  "처리까지 일주일 정도 걸렸습니다.",
  "구두로 먼저 협의가 있었던 건입니다.",
];

// 규칙 (채팅으로만 전달된다 — 워크스페이스에 규칙 문서 없음)
//   ① 목적이 사내통계면 다른 조건과 무관하게 승인 (예외가 가장 앞)
//   ② 개인정보 포함인데 승인자가 팀장급이면 반려
//   ③ 조회 기간이 90일 "초과"면 반려 (정확히 90일은 통과)
//   ④ 보관 기간이 180일 "이상"이면 반려 (정확히 180일도 반려)
//   ⑤ 그 외 승인
function judgeRequest(r) {
  if (r.purpose === "사내통계") return false;
  if (r.hasPii && r.rank === "팀장급") return true;
  if (r.lookupDays > 90) return true;
  if (r.retentionDays >= 180) return true;
  return false;
}

function buildRequests() {
  const requests = [];
  const lines = [
    "# 데이터 접근 신청서 모음 (인수 전 자료)",
    "",
    "부서에서 올라온 데이터 접근 신청서를 받은 순서대로 옮겨 적은 것입니다.",
    "서식이 몇 번 바뀌어서 항목이 적힌 순서가 신청서마다 다릅니다.",
    "",
  ];

  let n = 0;
  let sec = 0;
  let vi = 0;
  let ci = 0;
  while (lines.join("\n").length < SIZE_TARGET_C) {
    sec++;
    let title;
    if (rnd() < 0.4) {
      title = VAGUE_C[vi % VAGUE_C.length];
      vi++;
    } else {
      title = CONCRETE_C[ci % CONCRETE_C.length];
      ci++;
    }
    lines.push(`## ${sec}. ${title}`, "");

    const chatter = int(1, 3);
    for (let i = 0; i < chatter; i++) lines.push(paragraph(int(2, 4), sentence).join(" "), "");

    const count = int(3, 6);
    for (let i = 0; i < count; i++) {
      n++;
      // 경계값을 의도적으로 자주 만든다 — 89/90/91일, 179/180/181일
      const lr = rnd();
      const lookupDays = lr < 0.3 ? pick([89, 90, 91]) : int(7, 200);
      const rr = rnd();
      const retentionDays = rr < 0.3 ? pick([179, 180, 181]) : int(30, 400);
      const r = {
        id: "REQ-" + String(2000 + n),
        dept: pick(REQ_DEPTS),
        requester: pick(REQ_NAMES),
        approver: pick(REQ_NAMES),
        rank: pick(REQ_RANKS),
        purpose: pick(REQ_PURPOSES),
        kind: pick(REQ_KINDS),
        hasPii: rnd() < 0.55,
        lookupDays,
        retentionDays,
      };
      r.rejected = judgeRequest(r);
      requests.push(r);
      lines.push(`### ${r.id}`, "");
      lines.push(fixJosa(pick(REQ_TEMPLATES)(r)) + " " + pick(REQ_NOISE), "");
      if (rnd() < 0.3) lines.push(paragraph(int(1, 2), sentence).join(" "), "");
    }
  }

  const rejected = requests.filter((r) => r.rejected).map((r) => r.id);
  const byDept = {};
  for (const r of requests) {
    byDept[r.dept] ??= { total: 0, rejected: 0 };
    byDept[r.dept].total++;
    if (r.rejected) byDept[r.dept].rejected++;
  }

  // --- 판별력 확인: 각 규칙을 하나씩 틀렸을 때 답이 실제로 갈리는가 ---
  const variantCount = (fn) => requests.filter(fn).length;
  const naive = {
    // 사내통계 예외를 무시
    noExempt: variantCount((r) => (r.hasPii && r.rank === "팀장급") || r.lookupDays > 90 || r.retentionDays >= 180),
    // 보관 기간을 "초과"로 오해
    retentionGt: variantCount((r) => judgeRequest({ ...r, retentionDays: r.retentionDays === 180 ? 179 : r.retentionDays })),
    // 조회 기간을 "이상"으로 오해
    lookupGte: variantCount((r) => {
      if (r.purpose === "사내통계") return false;
      if (r.hasPii && r.rank === "팀장급") return true;
      if (r.lookupDays >= 90) return true;
      return r.retentionDays >= 180;
    }),
    // 승인자 직급 조건 자체를 무시
    ignoreRank: variantCount((r) => {
      if (r.purpose === "사내통계") return false;
      return r.lookupDays > 90 || r.retentionDays >= 180;
    }),
  };
  for (const [k, v] of Object.entries(naive)) {
    if (v === rejected.length) throw new Error(`블록 C: 오답 "${k}"이 정답과 같은 건수(${v})라 판별이 안 된다`);
  }
  const boundary = {
    lookup90: requests.filter((r) => r.lookupDays === 90).length,
    lookup91: requests.filter((r) => r.lookupDays === 91).length,
    retention179: requests.filter((r) => r.retentionDays === 179).length,
    retention180: requests.filter((r) => r.retentionDays === 180).length,
  };
  for (const [k, v] of Object.entries(boundary)) {
    if (v < 5) throw new Error(`블록 C: 경계값 ${k}이 ${v}건뿐이라 판별력이 약하다`);
  }

  return { text: lines.join("\n") + "\n", requests, rejected, byDept, naive, boundary };
}

// 분량 목표 — 3블록 상주 합계가 auto-compact 경계(~120K 토큰) 아래로 유지되게 잡는다.
// 한글 UTF-8 기준 대략 3.6바이트/토큰이므로 문서당 137KB ≈ 38K 토큰, 3개면 ≈114K.
// (문자 수 기준 — 한글/ASCII 혼합이라 실제 바이트는 약 2.1배, 토큰은 약 바이트/3.6.
//  아래 값은 실측으로 맞춘 것이다: 62,000자 ≈ 133KB ≈ 37K 토큰.)
const SIZE_TARGET_B = 62_000;
const SIZE_TARGET_C = 62_000;

// ===========================================================================
// 테스트 파일
// ===========================================================================

const HELPERS = `const fs = require("node:fs");
const path = require("node:path");
const WS = path.join(__dirname, "..");

// Windows에서 PowerShell 리다이렉션/Out-File로 텍스트를 쓰면 UTF-8 BOM이 앞에 붙어 JSON.parse가
// 내용과 무관하게 죽는다. 산출물 인코딩은 이 문제가 재려는 축과 상관없으므로 벗겨낸다.
function stripBom(text) {
  return text.replace(/^\\uFEFF/, "");
}

function readJson(name) {
  const p = path.join(WS, name);
  if (!fs.existsSync(p)) throw new Error(name + " 파일이 워크스페이스 루트에 없다");
  return JSON.parse(stripBom(fs.readFileSync(p, "utf8")));
}

// 산출물이 한 겹 감싸여 있어도 벗겨낸다 — **게이트에서만 쓴다**(채점 히든은 규격대로 본다).
function unwrapSingleKey(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1) return value[keys[0]];
  }
  return value;
}

module.exports = { readJson, stripBom, unwrapSingleKey };
`;

// --- 게이트: 형태만 본다 -----------------------------------------------------
//
// **기대값을 절대 적지 않는다.** 게이트 파일은 참가자 워크스페이스로 복사되므로 정답을 적으면
// 문서를 한 줄도 안 읽고 테스트만 보고 베낄 수 있다 — 이 문제에선 존재 이유가 사라진다.
const GATE = {};

GATE[1] = `// 1단계 [인프라팀] 스테이징 설정값 — **게이트(진행 판정)**
// 값이 맞는지는 보지 않는다. 정확한 값은 완료 시점 히든 테스트가 채점한다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("config.json — 설정값 3개가 채워져 있는가", () => {
  const c = readJson("config.json");
  assert.ok(c && typeof c === "object" && !Array.isArray(c), "config.json은 JSON 객체여야 한다");
  assert.equal(typeof c.stagingPort, "number", "stagingPort는 숫자여야 한다");
  assert.ok(c.stagingPort > 0 && c.stagingPort < 65536, "stagingPort는 포트 번호 범위여야 한다");
  assert.equal(typeof c.dbSchema, "string", "dbSchema는 문자열이어야 한다");
  assert.ok(c.dbSchema.trim().length > 0, "dbSchema가 비어 있다");
  assert.equal(typeof c.retryLimit, "number", "retryLimit는 숫자여야 한다");
  assert.ok(Number.isInteger(c.retryLimit) && c.retryLimit >= 0, "retryLimit는 0 이상의 정수여야 한다");
});
`;

GATE[2] = `// 2단계 [인프라팀] 스테이징 나머지 + 운영 설정 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("config.json — 호스트/헬스 경로/캐시 만료가 채워져 있는가", () => {
  const c = readJson("config.json");
  assert.equal(typeof c.stagingHost, "string", "stagingHost는 문자열이어야 한다");
  assert.ok(c.stagingHost.trim().length > 0, "stagingHost가 비어 있다");
  assert.equal(typeof c.healthPath, "string", "healthPath는 문자열이어야 한다");
  assert.ok(c.healthPath.startsWith("/"), "healthPath는 /로 시작해야 한다");
  assert.equal(typeof c.cacheTtlSeconds, "number", "cacheTtlSeconds는 숫자여야 한다");
  assert.ok(c.cacheTtlSeconds > 0, "cacheTtlSeconds는 0보다 커야 한다");
});

test("prod-config.json — 운영 설정 6개가 채워져 있는가", () => {
  const p = readJson("prod-config.json");
  assert.ok(p && typeof p === "object" && !Array.isArray(p), "prod-config.json은 JSON 객체여야 한다");
  assert.equal(typeof p.port, "number", "port는 숫자여야 한다");
  assert.equal(typeof p.dbSchema, "string", "dbSchema는 문자열이어야 한다");
  assert.equal(typeof p.retryLimit, "number", "retryLimit는 숫자여야 한다");
  assert.equal(typeof p.host, "string", "host는 문자열이어야 한다");
  assert.equal(typeof p.healthPath, "string", "healthPath는 문자열이어야 한다");
  assert.equal(typeof p.cacheTtlSeconds, "number", "cacheTtlSeconds는 숫자여야 한다");
});
`;

GATE[3] = `// 3단계 [결제팀] 원인별 집계 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("payment-causes.json — 원인별 건수가 채워져 있는가", () => {
  const r = readJson("payment-causes.json");
  assert.ok(r && typeof r === "object" && !Array.isArray(r), "payment-causes.json은 JSON 객체여야 한다");
  const keys = Object.keys(r);
  assert.ok(keys.length > 0, "집계 결과가 비어 있다");
  assert.ok(
    keys.every((k) => typeof r[k] === "number"),
    "각 원인의 값은 건수(숫자)여야 한다",
  );
});
`;

GATE[4] = `// 4단계 [결제팀] 담당팀별 집계 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("payment-teams.json — 팀별 집계가 채워져 있는가", () => {
  const r = readJson("payment-teams.json");
  assert.ok(r && typeof r === "object" && !Array.isArray(r), "payment-teams.json은 JSON 객체여야 한다");
  const keys = Object.keys(r);
  assert.ok(keys.length > 0, "집계 결과가 비어 있다");
  for (const k of keys) {
    assert.equal(typeof r[k].count, "number", k + ".count는 숫자여야 한다");
    assert.equal(typeof r[k].totalAmount, "number", k + ".totalAmount는 숫자여야 한다");
  }
});
`;

GATE[5] = `// 5단계 [데이터팀] 반려 대상 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

test("rejected-requests.json — 반려 목록이 채워져 있는가", () => {
  const r = unwrapSingleKey(readJson("rejected-requests.json"));
  assert.ok(Array.isArray(r), "rejected-requests.json은 문자열 배열이어야 한다");
  assert.ok(r.length > 0, "반려 건이 하나도 없다");
  assert.ok(r.every((v) => typeof v === "string"), "배열 원소는 신청서 id 문자열이어야 한다");
});
`;

GATE[6] = `// 6단계 [데이터팀] 부서별 집계 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("request-summary.json — 부서별 집계가 채워져 있는가", () => {
  const r = readJson("request-summary.json");
  assert.ok(r && typeof r === "object" && !Array.isArray(r), "request-summary.json은 JSON 객체여야 한다");
  const keys = Object.keys(r);
  assert.ok(keys.length > 0, "집계 결과가 비어 있다");
  for (const k of keys) {
    assert.equal(typeof r[k].total, "number", k + ".total은 숫자여야 한다");
    assert.equal(typeof r[k].rejected, "number", k + ".rejected는 숫자여야 한다");
  }
});
`;

GATE[7] = `// 7단계 [인프라팀 복귀] 배포 체크리스트 — **게이트(진행 판정)**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("deploy-checklist.json — 항목이 채워져 있는가", () => {
  const r = readJson("deploy-checklist.json");
  assert.ok(r && typeof r === "object" && !Array.isArray(r), "deploy-checklist.json은 JSON 객체여야 한다");
  // 스킴(http/https)까지 보지 않는다 — 그건 형태가 아니라 **값** 판단이고, 게이트는 실패 이유를
  // 알려주지 않으므로 마지막 단계에서 이유 없이 막히면 참가자만 헤맨다.
  assert.ok(/^https?:\\/\\/.+:\\d+\\/.+/.test(r.healthCheckUrl || ""), "healthCheckUrl은 호스트/포트/경로가 다 들어간 URL이어야 한다");
  assert.equal(typeof r.dbSchema, "string", "dbSchema는 문자열이어야 한다");
  assert.equal(typeof r.retryLimit, "number", "retryLimit는 숫자여야 한다");
  assert.equal(typeof r.cacheTtlSeconds, "number", "cacheTtlSeconds는 숫자여야 한다");
  assert.equal(typeof r.rollbackTag, "string", "rollbackTag는 문자열이어야 한다");
  assert.ok(r.rollbackTag.trim().length > 0, "rollbackTag가 비어 있다");
  assert.equal(typeof r.prodDbSchema, "string", "prodDbSchema는 문자열이어야 한다");
  assert.equal(typeof r.topCause, "string", "topCause는 문자열이어야 한다");
});
`;

// --- 히든: 정확한 값 ---------------------------------------------------------

function hiddenTests(pay, req) {
  const H = {};
  const j = (v) => JSON.stringify(v, null, 2).replace(/\n/g, "\n  ");

  H[1] = `// 1단계 [인프라팀] 스테이징 설정값 — **채점**
// handover.md 안에서 같은 항목이 3번 나오고 **뒤에 적힌 것이 최신**이다.
// 앞 값(8080 / staging_v2 / 3)이나 운영 값(443 / prod_core_r2 / 6)을 쓰면 여기서 걸린다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("config.json — 스테이징 최신 설정값", () => {
  const c = readJson("config.json");
  assert.equal(c.stagingPort, ${STAGING.stagingPort}, "stagingPort");
  assert.equal(c.dbSchema, ${JSON.stringify(STAGING.dbSchema)}, "dbSchema");
  assert.equal(c.retryLimit, ${STAGING.retryLimit}, "retryLimit");
});
`;

  H[2] = `// 2단계 [인프라팀] 스테이징 나머지 + 운영 설정 — **채점**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("config.json — 스테이징 호스트/헬스 경로/캐시 만료", () => {
  const c = readJson("config.json");
  assert.equal(c.stagingHost, ${JSON.stringify(STAGING.stagingHost)}, "stagingHost");
  assert.equal(c.healthPath, ${JSON.stringify(STAGING.healthPath)}, "healthPath");
  assert.equal(c.cacheTtlSeconds, ${STAGING.cacheTtlSeconds}, "cacheTtlSeconds");
});

test("prod-config.json — 운영 설정 6개", () => {
  const p = readJson("prod-config.json");
  assert.equal(p.port, ${PROD.port}, "port");
  assert.equal(p.dbSchema, ${JSON.stringify(PROD.dbSchema)}, "dbSchema");
  assert.equal(p.retryLimit, ${PROD.retryLimit}, "retryLimit");
  assert.equal(p.host, ${JSON.stringify(PROD.host)}, "host");
  assert.equal(p.healthPath, ${JSON.stringify(PROD.healthPath)}, "healthPath");
  assert.equal(p.cacheTtlSeconds, ${PROD.cacheTtlSeconds}, "cacheTtlSeconds");
});
`;

  H[3] = `// 3단계 [결제팀] 원인별 집계 — **채점**
// 같은 원인이 공백/하이픈/밑줄/대소문자만 다른 표기로 흩어져 있다. 구분자를 없애고 대소문자를
// 무시하면 정확히 5개 코드로 합쳐진다. 소문자화만 하면 ${pay.lowerOnlyDistinct}가지로 갈라져서 걸린다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("payment-causes.json — 정식 코드 5개로 합친 건수", () => {
  assert.deepEqual(readJson("payment-causes.json"), ${j(pay.byCause)});
});
`;

  H[4] = `// 4단계 [결제팀] 담당팀별 집계 — **채점**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("payment-teams.json — 팀별 건수와 금액 합계", () => {
  assert.deepEqual(readJson("payment-teams.json"), ${j(pay.byTeam)});
});
`;

  H[5] = `// 5단계 [데이터팀] 반려 대상 — **채점**
// 규칙 순서: ①사내통계면 무조건 승인 → ②개인정보+팀장급 승인이면 반려 → ③조회 90일 "초과" 반려
//            → ④보관 180일 "이상" 반려 → ⑤그 외 승인
// 정답 ${req.rejected.length}건. 흔한 오답: 사내통계 예외 무시 ${req.naive.noExempt}건 /
// 보관을 "초과"로 오해 ${req.naive.retentionGt}건 / 조회를 "이상"으로 오해 ${req.naive.lookupGte}건 /
// 승인자 직급 무시 ${req.naive.ignoreRank}건.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson, unwrapSingleKey } = require("./_helpers.js");

const EXPECTED = ${JSON.stringify(req.rejected)};

test("rejected-requests.json — 반려 대상 신청서 id", () => {
  const r = unwrapSingleKey(readJson("rejected-requests.json"));
  assert.ok(Array.isArray(r), "rejected-requests.json은 배열이어야 한다");
  assert.deepEqual([...r].sort(), [...EXPECTED].sort(), "rejected-requests");
});
`;

  H[6] = `// 6단계 [데이터팀] 부서별 집계 — **채점**
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("request-summary.json — 부서별 신청/반려 건수", () => {
  assert.deepEqual(readJson("request-summary.json"), ${j(req.byDept)});
});
`;

  H[7] = `// 7단계 [인프라팀 복귀] 배포 체크리스트 — **채점**
// 앞 블록에서 확정한 값을 교차 참조해야 한다: 스테이징 설정(1·2단계), 운영 스키마(2단계),
// 최다 원인 코드(3단계). rollbackTag만 handover.md에서 새로 찾는다(이것도 3번 나온다).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readJson } = require("./_helpers.js");

test("deploy-checklist.json — 확정값 교차 참조 + 롤백 태그", () => {
  const r = readJson("deploy-checklist.json");
  assert.equal(
    r.healthCheckUrl,
    "http://${STAGING.stagingHost}:${STAGING.stagingPort}${STAGING.healthPath}",
    "healthCheckUrl",
  );
  assert.equal(r.dbSchema, ${JSON.stringify(STAGING.dbSchema)}, "dbSchema");
  assert.equal(r.retryLimit, ${STAGING.retryLimit}, "retryLimit");
  assert.equal(r.cacheTtlSeconds, ${STAGING.cacheTtlSeconds}, "cacheTtlSeconds");
  assert.equal(r.rollbackTag, ${JSON.stringify(ROLLBACK_TAG)}, "rollbackTag");
  assert.equal(r.prodDbSchema, ${JSON.stringify(PROD.dbSchema)}, "prodDbSchema");
  assert.equal(r.topCause, ${JSON.stringify(pay.topCause)}, "topCause");
});
`;

  return H;
}

const PACKAGE_JSON =
  JSON.stringify(
    {
      name: `${ID}-workspace`,
      private: true,
      version: "0.0.0",
      description: "인수인계 작업 워크스페이스",
      scripts: { test: "node --test tests/*.test.js" },
    },
    null,
    2,
  ) + "\n";

// ===========================================================================
// 쓰기
// ===========================================================================
function write(dir, rel, content) {
  const p = path.join(dir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
}

function main() {
  const handover = buildHandover();
  const pay = buildTickets();
  const req = buildRequests();
  const H = hiddenTests(pay, req);

  assertClean("handover.md", handover);
  assertClean("payments/tickets.md", pay.text);
  assertClean("data/access-requests.md", req.text);
  for (const k of Object.keys(GATE)) assertClean(`gate stage${k}`, GATE[k]);
  assertClean("_helpers.js", HELPERS);

  const dirs = [
    path.join(STARTERS, ID),
    ...[2, 3, 4, 5, 6, 7].map((i) => path.join(STARTERS, `${ID}-stage${i}`)),
    path.join(STARTERS, `${ID}-hidden`),
  ];
  // 디렉터리 **안의 내용만** 비운다 — Windows에서는 VS Code/dev 서버 감시자가 디렉터리 핸들을
  // 잡고 있어서 디렉터리 자체를 지우면 EPERM이 난다(실측).
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const entry of readdirSync(d)) {
      rmSync(path.join(d, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }

  // 1단계 시작 상태 — 블록 A만 보인다
  const s1 = path.join(STARTERS, ID);
  write(s1, "handover.md", handover);
  write(s1, "package.json", PACKAGE_JSON);
  write(s1, "tests/_helpers.js", HELPERS);
  write(s1, "tests/stage1.test.js", GATE[1]);

  // 2~7단계 언락 — 블록 B는 3단계, 블록 C는 5단계에서 풀린다
  for (const i of [2, 3, 4, 5, 6, 7]) {
    const d = path.join(STARTERS, `${ID}-stage${i}`);
    write(d, `tests/stage${i}.test.js`, GATE[i]);
    write(d, "tests/_helpers.js", HELPERS);
    if (i === 3) write(d, "payments/tickets.md", pay.text);
    if (i === 5) write(d, "data/access-requests.md", req.text);
  }

  // 히든 — 완료 시점 채점용
  const hd = path.join(STARTERS, `${ID}-hidden`);
  write(hd, "package.json", PACKAGE_JSON);
  write(hd, "tests/_helpers.js", HELPERS);
  for (const i of [1, 2, 3, 4, 5, 6, 7]) write(hd, `tests/stage${i}.test.js`, H[i]);

  // --- 요약 -----------------------------------------------------------------
  const kb = (s) => (Buffer.byteLength(s, "utf8") / 1024).toFixed(1) + " KB";
  const tok = (s) => Math.round(Buffer.byteLength(s, "utf8") / 3.6);
  const totalTok = tok(handover) + tok(pay.text) + tok(req.text);
  console.log("=== handover-relay-staged v2 생성 완료 ===");
  console.log(`블록 A  handover.md          : ${kb(handover)} ≈ ${tok(handover).toLocaleString()} tokens`);
  console.log(`블록 B  payments/tickets.md  : ${kb(pay.text)} ≈ ${tok(pay.text).toLocaleString()} tokens (티켓 ${pay.tickets.length}건)`);
  console.log(`블록 C  data/access-requests : ${kb(req.text)} ≈ ${tok(req.text).toLocaleString()} tokens (신청서 ${req.requests.length}건)`);
  console.log(`3블록 누적 피크 상주         : ≈ ${totalTok.toLocaleString()} tokens  ${totalTok < 120000 ? "✓ auto-compact 경계(~120K) 아래" : "✗ 경계 초과 — 분량을 줄일 것"}`);
  console.log("");
  console.log("정답:");
  console.log("  1단계 staging:", STAGING.stagingPort, STAGING.dbSchema, STAGING.retryLimit);
  console.log("  2단계 staging:", STAGING.stagingHost, STAGING.healthPath, STAGING.cacheTtlSeconds, "/ prod:", PROD);
  console.log("  3단계 byCause:", pay.byCause, `(소문자화만 하면 ${pay.lowerOnlyDistinct}가지로 갈라짐)`);
  console.log("  4단계 byTeam :", pay.byTeam);
  console.log("  5단계 반려   :", req.rejected.length, "건 / 오답:", req.naive, "/ 경계값:", req.boundary);
  console.log("  6단계 byDept :", req.byDept);
  console.log("  7단계 topCause =", pay.topCause, "/ rollbackTag =", ROLLBACK_TAG);

  writeFileSync(
    path.join(ROOT, "docs", "guides", `${ID}.answers.json`),
    JSON.stringify(
      {
        생성기: "scripts/gen-handover-relay-staged.mjs (v2, 시드 20260813)",
        블록크기토큰추정: { A: tok(handover), B: tok(pay.text), C: tok(req.text), 합계: totalTok },
        stage1: { stagingPort: STAGING.stagingPort, dbSchema: STAGING.dbSchema, retryLimit: STAGING.retryLimit },
        stage2: {
          stagingHost: STAGING.stagingHost,
          healthPath: STAGING.healthPath,
          cacheTtlSeconds: STAGING.cacheTtlSeconds,
          prod: PROD,
        },
        stage3: { byCause: pay.byCause, 오답_소문자화만하면_갈라지는가짓수: pay.lowerOnlyDistinct },
        stage4: { byTeam: pay.byTeam },
        stage5: { count: req.rejected.length, 오답: req.naive, 경계값분포: req.boundary, ids: req.rejected },
        stage6: { byDept: req.byDept },
        stage7: {
          healthCheckUrl: `http://${STAGING.stagingHost}:${STAGING.stagingPort}${STAGING.healthPath}`,
          dbSchema: STAGING.dbSchema,
          retryLimit: STAGING.retryLimit,
          cacheTtlSeconds: STAGING.cacheTtlSeconds,
          rollbackTag: ROLLBACK_TAG,
          prodDbSchema: PROD.dbSchema,
          topCause: pay.topCause,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

main();
