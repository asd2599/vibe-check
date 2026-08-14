// handover-relay-staged 통합 검증 (v2)
//
//   node scripts/verify-handover-relay-staged.mjs
//
// 실제 러너와 **같은 순서**로 워크스페이스를 재현한다:
//   starterFiles 복사 → 1단계 풀기 → 게이트1 → unlockPath 복사 → … → 게이트7
//   → hiddenTestsPath 덮어쓰기 → npm test
//
// 확인하는 것:
//   A. 정석 구현이 1→7단계 게이트 전부 통과 + 최종 히든 전부 통과
//   B. 단계 오프셋 — 블록 B(3단계)·C(5단계) 자료가 미리 새어 있지 않은가
//   C. 게이트가 "산출물 없음/형태 틀림"을 실제로 막는가
//   D. 오답이 **의도한 단계의 히든에서만** 실패하는가
//      (게이트는 형태만 보므로 오답도 게이트는 통과한다 — 의도된 설계)
//   E. 조기 "완료" 차단
//   F. 말끔함 + 문제 파일 스키마
//   G. 블록 크기 / override 체인 / 다변형 병합 / 경계값 분포
//
// **정석 solver는 상수를 베끼지 않고 워크스페이스 파일에서 직접 값을 뽑아낸다** — 그래야
// "데이터가 실제로 정답을 유일하게 결정하는가"까지 같이 검증된다.

import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ID = "handover-relay-staged";
const PROBLEM = JSON.parse(readFileSync(path.join(ROOT, "problems", `${ID}.json`), "utf8"));

let pass = 0;
let fail = 0;
const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// 워크스페이스 헬퍼 (러너와 동일하게 cpSync recursive = 덮어쓰기)
// ---------------------------------------------------------------------------
function freshWorkspace(name) {
  const ws = path.join(os.tmpdir(), `vibecheck-verify-${ID}-${name}`);
  rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  mkdirSync(ws, { recursive: true });
  cpSync(path.join(ROOT, PROBLEM.starterFiles), ws, { recursive: true });
  return ws;
}
const unlock = (ws, i) => {
  const s = PROBLEM.stages[i - 1];
  if (s.unlockPath) cpSync(path.join(ROOT, s.unlockPath), ws, { recursive: true });
};
const applyHidden = (ws) => cpSync(path.join(ROOT, PROBLEM.hiddenTestsPath), ws, { recursive: true });

function runNodeTest(ws, files) {
  try {
    execFileSync("node", ["--test", ...files], { cwd: ws, encoding: "utf8", stdio: "pipe" });
    return { ok: true, out: "" };
  } catch (e) {
    return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}
function runGate(ws, i) {
  const files = PROBLEM.stages[i - 1].gateTestCommand.replace(/^node --test /, "").split(/\s+/);
  return runNodeTest(ws, files);
}

// ---------------------------------------------------------------------------
// 블록 A — handover.md 파싱
// ---------------------------------------------------------------------------
const RE_STAGING = {
  // 필러에 "리포트"가 많아 "포트"만으로는 안 된다 — "웹 포트"로 좁힌다.
  stagingPort: /스테이징 웹 포트[^.\n]*?(\d{2,5})/g,
  dbSchema: /스테이징 DB 스키마[^.\n]*?\b([a-z][a-z0-9_]{2,})\b/g,
  retryLimit: /스테이징 배포[^.\n]*?재시도 횟수[^.\n]*?(\d+)회/g,
  stagingHost: /스테이징 호스트[^.\n]*?([a-z0-9-]+\.internal)/g,
  healthPath: /스테이징 헬스 체크 경로[^.\n]*?(\/[A-Za-z_-]+)/g,
  cacheTtlSeconds: /스테이징 캐시 만료 시간[^.\n]*?(\d+)초/g,
  rollbackTag: /스테이징 롤백 기준 태그[^.\n]*?\b([a-z]+-\d[\d-]*)\b/g,
};
const RE_PROD = {
  port: /운영 웹 포트[^.\n]*?(\d{2,5})/g,
  dbSchema: /운영 DB 스키마[^.\n]*?\b([a-z][a-z0-9_]{2,})\b/g,
  retryLimit: /운영 배포 재시도 횟수[^.\n]*?(\d+)회/g,
  host: /운영 호스트[^.\n]*?([a-z0-9-]+\.internal)/g,
  healthPath: /운영 헬스 체크 경로[^.\n]*?(\/[A-Za-z_-]+)/g,
  cacheTtlSeconds: /운영 캐시 만료 시간[^.\n]*?(\d+)초/g,
};
const readDoc = (ws) => readFileSync(path.join(ws, "handover.md"), "utf8");
function matches(text, re, label) {
  const all = [...text.matchAll(re)].map((m) => m[1]);
  if (all.length === 0) throw new Error(`${label}: handover.md에서 한 건도 못 찾았다`);
  return all;
}
// mode: "last"(정석 — 뒤가 최신) | "first"(override 무시 오답)
function stagingValue(ws, key, mode = "last") {
  const all = matches(readDoc(ws), RE_STAGING[key], key);
  return mode === "first" ? all[0] : all[all.length - 1];
}
function prodValue(ws, key) {
  const all = matches(readDoc(ws), RE_PROD[key], "prod." + key);
  return all[all.length - 1];
}

// ---------------------------------------------------------------------------
// 블록 B — tickets.md 파싱
// ---------------------------------------------------------------------------
const CANON_CODES = ["CARD_LIMIT", "EXPIRED_CARD", "NETWORK_ERR", "AUTH_FAIL", "NO_FUNDS"];
const canonKey = (s) => s.replace(/[\s_-]/g, "").toUpperCase();
const CANON_BY_KEY = new Map(CANON_CODES.map((c) => [canonKey(c), c]));

function parseTickets(ws) {
  const text = readFileSync(path.join(ws, "payments", "tickets.md"), "utf8");
  const blocks = text.split(/^### (P-\d+)$/m).slice(1);
  const out = [];
  for (let i = 0; i < blocks.length; i += 2) {
    const id = blocks[i];
    const body = blocks[i + 1];
    // 원인 표기: 정식 5개 코드의 어떤 변형이든 잡아낸다
    const variantRe = /(CARD[\s_-]?LIMIT|EXPIRED[\s_-]?CARD|NETWORK[\s_-]?ERR|AUTH[\s_-]?FAIL|NO[\s_-]?FUNDS)/gi;
    const vm = [...body.matchAll(variantRe)].map((m) => m[1]);
    const amount = Number((body.match(/([\d,]+)원/) || [])[1]?.replace(/,/g, ""));
    const team = (body.match(/(결제1팀|결제2팀|가맹점지원팀|리스크팀)/) || [])[1];
    if (vm.length !== 1 || !amount || !team) {
      throw new Error(`티켓 ${id} 파싱 실패 (원인 ${vm.length}개 / 금액 ${amount} / 팀 ${team})`);
    }
    out.push({ id, variant: vm[0], amount, team });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 블록 C — access-requests.md 파싱
// ---------------------------------------------------------------------------
function parseRequests(ws) {
  const text = readFileSync(path.join(ws, "data", "access-requests.md"), "utf8");
  const blocks = text.split(/^### (REQ-\d+)$/m).slice(1);
  const out = [];
  for (let i = 0; i < blocks.length; i += 2) {
    const id = blocks[i];
    const body = blocks[i + 1];
    const dept = (body.match(/(마케팅팀|영업팀|고객지원팀|재무팀|상품팀)/) || [])[1];
    const purpose = (body.match(/(사내통계|마케팅|고객대응|감사대응|서비스개선)/g) || []).find((p) =>
      ["사내통계", "마케팅", "고객대응", "감사대응", "서비스개선"].includes(p),
    );
    // "목적은 X" / "목적 X" 형태를 우선 신뢰한다(부서명 "마케팅팀"과 목적 "마케팅" 충돌 방지)
    const purposeExact = (body.match(/목적[은은는]?\s*([가-힣]+?)(?:입니다|이며|\.|,)/) || [])[1];
    // 직급 어휘는 "급/임원" — 사람 이름("박팀장")과 문자열로 안 겹치게 생성기에서 그렇게 잡았다.
    const rank = (body.match(/(팀장급|본부장급|임원)/) || [])[1];
    const hasPii = /개인정보[^.\n]*?(포함됩니다|포함)/.test(body) && !/개인정보[^.\n]*?(포함되지 않습니다|미포함)/.test(body);
    const lookupDays = Number((body.match(/조회[^.\n]*?(\d+)일/) || body.match(/(\d+)일치/) || [])[1]);
    const retentionDays = Number((body.match(/보관[^.\n]*?(\d+)일/) || [])[1]);
    const p = purposeExact && ["사내통계", "마케팅", "고객대응", "감사대응", "서비스개선"].includes(purposeExact) ? purposeExact : purpose;
    if (!dept || !p || !rank || !lookupDays || !retentionDays) {
      throw new Error(`신청서 ${id} 파싱 실패 (${dept}/${p}/${rank}/${lookupDays}/${retentionDays})`);
    }
    out.push({ id, dept, purpose: p, rank, hasPii, lookupDays, retentionDays });
  }
  return out;
}

// 규정: ①사내통계면 승인 → ②개인정보+팀장급이면 반려 → ③조회 90일 "초과" 반려
//       → ④보관 180일 "이상" 반려 → ⑤그 외 승인
function isRejected(r, v = {}) {
  if (!v.noExempt && r.purpose === "사내통계") return false;
  if (!v.ignoreRank && r.hasPii && r.rank === "팀장급") return true;
  if (v.lookupGte ? r.lookupDays >= 90 : r.lookupDays > 90) return true;
  if (v.retentionGt ? r.retentionDays > 180 : r.retentionDays >= 180) return true;
  return false;
}

const W = (ws, name, obj) => writeFileSync(path.join(ws, name), JSON.stringify(obj, null, 2), "utf8");

// ---------------------------------------------------------------------------
// 단계별 정석 solver (+ variant 로 오답 주입)
// ---------------------------------------------------------------------------
function solveStage(ws, stage, v = {}) {
  const cfgPath = path.join(ws, "config.json");
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  const mode = v.mention || "last";

  if (stage === 1) {
    W(ws, "config.json", {
      ...cfg,
      stagingPort: Number(v.useProd ? prodValue(ws, "port") : stagingValue(ws, "stagingPort", mode)),
      dbSchema: v.useProd ? prodValue(ws, "dbSchema") : stagingValue(ws, "dbSchema", mode),
      retryLimit: Number(v.useProd ? prodValue(ws, "retryLimit") : stagingValue(ws, "retryLimit", mode)),
    });
  }

  if (stage === 2) {
    W(ws, "config.json", {
      ...cfg,
      stagingHost: v.useProd ? prodValue(ws, "host") : stagingValue(ws, "stagingHost", mode),
      healthPath: v.useProd ? prodValue(ws, "healthPath") : stagingValue(ws, "healthPath", mode),
      cacheTtlSeconds: Number(v.useProd ? prodValue(ws, "cacheTtlSeconds") : stagingValue(ws, "cacheTtlSeconds", mode)),
    });
    W(ws, "prod-config.json", {
      port: Number(prodValue(ws, "port")),
      dbSchema: prodValue(ws, "dbSchema"),
      retryLimit: Number(prodValue(ws, "retryLimit")),
      host: prodValue(ws, "host"),
      healthPath: prodValue(ws, "healthPath"),
      cacheTtlSeconds: Number(prodValue(ws, "cacheTtlSeconds")),
    });
  }

  if (stage === 3) {
    const tickets = parseTickets(ws);
    const byCause = {};
    if (v.lowerOnly) {
      // 오답: 소문자화만 하고 구분자는 안 없앤다 → 코드가 5개보다 많아진다
      for (const t of tickets) {
        const k = t.variant.toLowerCase();
        byCause[k] = (byCause[k] || 0) + 1;
      }
    } else if (v.noMerge) {
      // 오답: 표기 그대로 센다
      for (const t of tickets) byCause[t.variant] = (byCause[t.variant] || 0) + 1;
    } else {
      for (const c of CANON_CODES) byCause[c] = 0;
      for (const t of tickets) byCause[CANON_BY_KEY.get(canonKey(t.variant))]++;
    }
    W(ws, "payment-causes.json", byCause);
  }

  if (stage === 4) {
    const byTeam = {};
    for (const t of parseTickets(ws)) {
      byTeam[t.team] ??= { count: 0, totalAmount: 0 };
      byTeam[t.team].count++;
      byTeam[t.team].totalAmount += t.amount;
    }
    W(ws, "payment-teams.json", byTeam);
  }

  if (stage === 5) {
    W(ws, "rejected-requests.json", parseRequests(ws).filter((r) => isRejected(r, v)).map((r) => r.id));
  }

  if (stage === 6) {
    const byDept = {};
    for (const r of parseRequests(ws)) {
      byDept[r.dept] ??= { total: 0, rejected: 0 };
      byDept[r.dept].total++;
      if (isRejected(r, v)) byDept[r.dept].rejected++;
    }
    W(ws, "request-summary.json", byDept);
  }

  if (stage === 7) {
    const prod = JSON.parse(readFileSync(path.join(ws, "prod-config.json"), "utf8"));
    const causes = JSON.parse(readFileSync(path.join(ws, "payment-causes.json"), "utf8"));
    const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0][0];
    W(ws, "deploy-checklist.json", {
      healthCheckUrl: `${v.https ? "https" : "http"}://${cfg.stagingHost}:${cfg.stagingPort}${cfg.healthPath}`,
      dbSchema: cfg.dbSchema,
      retryLimit: cfg.retryLimit,
      cacheTtlSeconds: cfg.cacheTtlSeconds,
      prodDbSchema: prod.dbSchema,
      topCause: top,
      rollbackTag: stagingValue(ws, "rollbackTag", v.staleRollback ? "first" : "last"),
    });
  }
}

function playThrough(name, upTo, variant = {}) {
  const ws = freshWorkspace(name);
  const gates = [];
  for (let s = 1; s <= upTo; s++) {
    if (s > 1) unlock(ws, s);
    solveStage(ws, s, variant);
    gates.push(runGate(ws, s));
  }
  return { ws, gates };
}
function hiddenPerStage(ws) {
  applyHidden(ws);
  const failed = [];
  for (let s = 1; s <= 7; s++) if (!runNodeTest(ws, [`tests/stage${s}.test.js`]).ok) failed.push(s);
  return failed;
}

// ===========================================================================
console.log(`\n=== ${ID} v2 통합 검증 ===\n`);

console.log("A. 정석 구현이 1→7단계 게이트를 순서대로 통과하는가");
const good = playThrough("good", 7);
for (let s = 1; s <= 7; s++) check(`${s}단계 게이트 통과`, good.gates[s - 1].ok, good.gates[s - 1].out.slice(0, 300));
{
  const failed = hiddenPerStage(good.ws);
  check("최종 히든 테스트 전부 통과", failed.length === 0, `실패 단계: ${failed.join(",")}`);
}

console.log("\nB. 단계 오프셋 — 뒤 블록 자료가 미리 새어 있지 않은가");
{
  const ws = freshWorkspace("offset");
  check("시작 시점에 handover.md(블록 A)는 있다", existsSync(path.join(ws, "handover.md")));
  check("시작 시점에 payments/tickets.md(블록 B)는 없다", !existsSync(path.join(ws, "payments/tickets.md")));
  check("시작 시점에 data/access-requests.md(블록 C)는 없다", !existsSync(path.join(ws, "data/access-requests.md")));
  check("시작 시점에 tests/stage2.test.js 는 없다", !existsSync(path.join(ws, "tests/stage2.test.js")));
  unlock(ws, 3);
  check("3단계 언락 후 블록 B가 생긴다", existsSync(path.join(ws, "payments/tickets.md")));
  check("3단계 언락 후에도 블록 C는 없다", !existsSync(path.join(ws, "data/access-requests.md")));
  unlock(ws, 5);
  check("5단계 언락 후 블록 C가 생긴다", existsSync(path.join(ws, "data/access-requests.md")));
}

console.log("\nC. 게이트가 '산출물 없음/형태 틀림'을 실제로 막는가");
{
  const ws = freshWorkspace("empty");
  check("config.json 자체가 없으면 1단계 게이트가 막는다", !runGate(ws, 1).ok);
  W(ws, "config.json", {});
  check("config.json 이 비어 있으면 1단계 게이트가 막는다", !runGate(ws, 1).ok);
  W(ws, "config.json", { stagingPort: "7443", dbSchema: "x", retryLimit: 2 });
  check("stagingPort 가 문자열이면 1단계 게이트가 막는다", !runGate(ws, 1).ok);
  W(ws, "config.json", { stagingPort: 7443, dbSchema: "x", retryLimit: 2 });
  check("형태가 맞으면 (값이 틀려도) 1단계 게이트는 통과시킨다", runGate(ws, 1).ok);
  unlock(ws, 2);
  W(ws, "config.json", { stagingPort: 7443, dbSchema: "x", retryLimit: 2, stagingHost: "h", healthPath: "/x", cacheTtlSeconds: 1 });
  check("prod-config.json 이 없으면 2단계 게이트가 막는다", !runGate(ws, 2).ok);
}

console.log("\nD. 오답이 의도한 단계의 히든에서만 실패하는가");
const VARIANTS = [
  { name: "firstMention", desc: "override 무시 — 문서의 앞 값을 씀", variant: { mention: "first" }, expect: [1, 2, 7] },
  { name: "useProd", desc: "스테이징 자리에 운영 값을 씀", variant: { useProd: true }, expect: [1, 2, 7] },
  { name: "lowerOnly", desc: "표기 통일을 소문자화만 함 (구분자 안 없앰)", variant: { lowerOnly: true }, expect: [3, 7] },
  { name: "noMerge", desc: "표기 변형을 서로 다른 원인으로 셈", variant: { noMerge: true }, expect: [3, 7] },
  { name: "noExempt", desc: "사내통계 예외를 무시", variant: { noExempt: true }, expect: [5, 6] },
  { name: "retentionGt", desc: "보관 기간을 '초과'로 오해 (이상이 맞음)", variant: { retentionGt: true }, expect: [5, 6] },
  { name: "lookupGte", desc: "조회 기간을 '이상'으로 오해 (초과가 맞음)", variant: { lookupGte: true }, expect: [5, 6] },
  { name: "ignoreRank", desc: "승인자 직급 조건을 무시", variant: { ignoreRank: true }, expect: [5, 6] },
  { name: "https", desc: "체크리스트 URL 을 https 로 만듦", variant: { https: true }, expect: [7] },
  { name: "staleRollback", desc: "롤백 태그를 옛 값으로 씀", variant: { staleRollback: true }, expect: [7] },
];
for (const v of VARIANTS) {
  const r = playThrough(v.name, 7, v.variant);
  const gatesAllPass = r.gates.every((g) => g.ok);
  const failed = hiddenPerStage(r.ws);
  check(
    `${v.name} (${v.desc}) → 히든 ${v.expect.join(",")}단계에서만 실패`,
    JSON.stringify(failed) === JSON.stringify(v.expect),
    `실제 실패: [${failed.join(",")}]`,
  );
  check(`  └ ${v.name} 은 게이트 7개를 모두 통과한다 (형태 검사만이므로 의도된 동작)`, gatesAllPass);
}

console.log("\nE. 조기 '완료'를 히든이 차단하는가");
{
  const r2 = playThrough("early2", 2);
  check(
    "2단계까지만 푼 상태에서 워크스페이스의 tests/ 는 통과해버린다 (그래서 히든이 필요하다)",
    runNodeTest(r2.ws, ["tests/stage1.test.js", "tests/stage2.test.js"]).ok,
  );
  const f2 = hiddenPerStage(r2.ws);
  check("히든 이식 후 3~7단계가 정확히 실패한다", JSON.stringify(f2) === JSON.stringify([3, 4, 5, 6, 7]), `실제: [${f2.join(",")}]`);

  const r4 = playThrough("early4", 4);
  const f4 = hiddenPerStage(r4.ws);
  check("4단계까지 푼 뒤 조기 완료 → 5~7단계가 실패한다", JSON.stringify(f4) === JSON.stringify([5, 6, 7]), `실제: [${f4.join(",")}]`);
}

console.log("\nF. 말끔함 + 문제 파일 스키마");
{
  const BANNED = ["컨텍스트", "토큰", "세션", "압축", "정리", "context", "Context", "clear", "Clear", "split", "compact"];
  const hits = [];
  const scan = (label, text) => {
    for (const w of BANNED) if (text.includes(w)) hits.push(`${label}: "${w}"`);
  };
  scan("problem.id", PROBLEM.id);
  scan("problem.title", PROBLEM.title);
  scan("problem.prompt", PROBLEM.prompt);
  for (const s of PROBLEM.stages) {
    scan(`stage${s.index}.title`, s.title);
    scan(`stage${s.index}.promptAddition`, s.promptAddition);
  }
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else scan(path.relative(ROOT, p), readFileSync(p, "utf8"));
    }
  };
  walk(path.join(ROOT, PROBLEM.starterFiles));
  for (const s of PROBLEM.stages) if (s.unlockPath) walk(path.join(ROOT, s.unlockPath));
  check("금지어 0건", hits.length === 0, hits.join(" / "));

  check("stages 개수가 2~10 범위", PROBLEM.stages.length >= 2 && PROBLEM.stages.length <= 10);
  check("stages[i].index 가 배열 순서와 일치", PROBLEM.stages.every((s, i) => s.index === i + 1));
  check("targetDurationMs < maxDurationMs", PROBLEM.targetDurationMs < PROBLEM.maxDurationMs);
  check("tokenScoreZeroAtRatio > 1 이고 referenceWeightedTokens 가 있다", PROBLEM.tokenScoreZeroAtRatio > 1 && PROBLEM.referenceWeightedTokens > 0);
}

console.log("\nG. 블록 크기 · 함정 3가족이 실제로 무장돼 있는가");
{
  const ws = freshWorkspace("blocks");
  unlock(ws, 3);
  unlock(ws, 5);
  const tokOf = (p) => Math.round(Buffer.byteLength(readFileSync(path.join(ws, p), "utf8"), "utf8") / 3.6);
  const a = tokOf("handover.md");
  const b = tokOf("payments/tickets.md");
  const c = tokOf("data/access-requests.md");
  const total = a + b + c;
  check(`블록 A ≈${a.toLocaleString()} · B ≈${b.toLocaleString()} · C ≈${c.toLocaleString()} 토큰 — 각 30K 이상`, a > 30000 && b > 30000 && c > 30000);
  check(`3블록 누적 ≈${total.toLocaleString()} 토큰 — auto-compact 경계(120K) 아래`, total < 120000, "블록을 줄일 것");

  // 함정 ① override 체인
  const doc = readDoc(ws);
  for (const [k, re] of Object.entries(RE_STAGING)) {
    const all = [...doc.matchAll(re)];
    check(`함정① ${k}: ${all.length}회 언급, 최종 "${all[all.length - 1]?.[1]}"`, all.length === 3, "언급이 3회가 아니다");
  }
  for (const [k, re] of Object.entries(RE_PROD)) {
    const all = [...doc.matchAll(re)];
    check(`함정① 운영 ${k}: ${all.length}회 언급 (체인 없음)`, all.length === 1, "운영 값은 1회만 나와야 한다");
  }

  // 함정 ② 다변형 정규화 — 소문자화만 하면 코드 수가 5개를 넘어야 판별력이 있다
  const tickets = parseTickets(ws);
  const lowerOnly = new Set(tickets.map((t) => t.variant.toLowerCase()));
  const merged = new Set(tickets.map((t) => CANON_BY_KEY.get(canonKey(t.variant))));
  check(`함정② 병합 후 ${merged.size}개 코드 / 소문자화만 하면 ${lowerOnly.size}가지로 갈라짐`, merged.size === 5 && lowerOnly.size > 5);
  check("함정② 모든 표기가 정식 코드 5개 중 하나로 유일하게 대응", tickets.every((t) => CANON_BY_KEY.has(canonKey(t.variant))));
  const counts = {};
  for (const t of tickets) counts[CANON_BY_KEY.get(canonKey(t.variant))] = (counts[CANON_BY_KEY.get(canonKey(t.variant))] || 0) + 1;
  const sorted = Object.entries(counts).sort((x, y) => y[1] - x[1]);
  check(`함정② 최다 원인 ${sorted[0][0]}(${sorted[0][1]}) vs 2위 ${sorted[1][0]}(${sorted[1][1]}) — 격차 15 이상`, sorted[0][1] - sorted[1][1] >= 15);

  // 함정 ③ 다단 조건 + 경계값
  const reqs = parseRequests(ws);
  const correct = reqs.filter((r) => isRejected(r)).length;
  for (const [k, vv] of Object.entries({
    noExempt: { noExempt: true },
    retentionGt: { retentionGt: true },
    lookupGte: { lookupGte: true },
    ignoreRank: { ignoreRank: true },
  })) {
    const n = reqs.filter((r) => isRejected(r, vv)).length;
    check(`함정③ 오답 "${k}" → ${n}건 (정답 ${correct}건과 다름)`, n !== correct);
  }
  const boundary = {
    "조회 90일": reqs.filter((r) => r.lookupDays === 90).length,
    "조회 91일": reqs.filter((r) => r.lookupDays === 91).length,
    "보관 179일": reqs.filter((r) => r.retentionDays === 179).length,
    "보관 180일": reqs.filter((r) => r.retentionDays === 180).length,
  };
  for (const [k, n] of Object.entries(boundary)) check(`함정③ 경계값 "${k}" ${n}건 (5건 이상)`, n >= 5);
}

console.log(`\n=== 결과: ${pass}건 통과 / ${fail}건 실패 ===`);
if (fail > 0) {
  console.log("\n실패 항목:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
