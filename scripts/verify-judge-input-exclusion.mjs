// 평가기 수정 회귀 확인 — "바이트가 안 바뀐 제공 입력 파일을 채점 프롬프트에서 뺀다"가
// 참가자 산출물을 잘못 빼지 않는지, 저장된 실제 워크스페이스 전부로 확인한다.
//
//   node scripts/verify-judge-input-exclusion.mjs
//
// 실제 LLM 재채점은 못 한다(호출 비용/비결정성). 대신 **결정론적으로 확인 가능한 것**만 본다:
//   1. 제외되는 파일이 전부 "우리가 준 파일"인가 (참가자 산출물이 하나도 안 빠지는가)
//   2. 각 워크스페이스에서 채점기에 실리는 문자 수가 얼마나 줄어드는가
//   3. 제외 후에도 참가자 산출물이 채점 예산(60,000자) 안에 들어가는가

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACES = process.env.RUN_WORKSPACES_DIR?.trim() || path.join(os.homedir(), "Documents", "work", "vibecheck-runs");
const MAX_SOURCE_CHARS = 60_000; // evaluator.ts의 MAX_SOURCE_CHARS_FOR_JUDGE 와 같은 값

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "__pycache__", "dist", "build", ".next", "coverage", "out"]);

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function walkFiles(dir, base = dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      walkFiles(full, base, acc);
    } else if (e.isFile()) {
      acc.push({ abs: full, rel: path.relative(base, full).split(path.sep).join("/") });
    }
  }
  return acc;
}

function providedHashes(problem) {
  const map = new Map();
  const roots = [];
  if (problem.starterFiles) roots.push(problem.starterFiles);
  for (const s of problem.stages ?? []) if (s.unlockPath) roots.push(s.unlockPath);
  if (problem.hiddenTestsPath) roots.push(problem.hiddenTestsPath);
  for (const r of roots) {
    const abs = path.join(ROOT, r);
    if (!existsSync(abs)) continue;
    for (const f of walkFiles(abs)) map.set(f.rel, sha(readFileSync(f.abs)));
  }
  return map;
}

const problems = new Map();
for (const f of readdirSync(path.join(ROOT, "problems")).filter((f) => f.endsWith(".json"))) {
  const p = JSON.parse(readFileSync(path.join(ROOT, "problems", f), "utf8"));
  problems.set(p.id, { problem: p, provided: providedHashes(p) });
}

let totalWs = 0;
let anyArtifactExcluded = 0;
const untouchedNotes = [];
const rows = [];

for (const dir of readdirSync(WORKSPACES)) {
  const full = path.join(WORKSPACES, dir);
  if (!statSync(full).isDirectory()) continue;
  // 폴더명 = <problemId>_<타임스탬프>_<runId8>
  const id = [...problems.keys()].find((pid) => dir.startsWith(pid + "_"));
  if (!id) continue;
  const { provided } = problems.get(id);
  totalWs++;

  let before = 0;
  let after = 0;
  const excluded = [];
  const kept = [];
  for (const f of walkFiles(full)) {
    let buf;
    try {
      buf = readFileSync(f.abs);
    } catch {
      continue;
    }
    const len = buf.toString("utf8").length;
    before += len;
    const p = provided.get(f.rel);
    if (p && p === sha(buf)) {
      excluded.push({ rel: f.rel, len });
    } else {
      after += len;
      kept.push({ rel: f.rel, len });
    }
  }

  // 제외 규칙이 안전한 이유: **바이트가 하나도 안 바뀐 파일만** 뺀다. 참가자 작업물이 제외되려면
  // 그 작업물이 우리가 준 파일과 바이트 단위로 완전히 같아야 하는데, 그건 곧 "아무것도 안 고쳤다"는
  // 뜻이라 채점에서 빠져도 잃는 정보가 없다(오히려 목록의 "변경 없음" 표기가 더 정확한 신호다).
  //
  // 실제로 game-tactics run 3건에서 `index.html`/`server.js`가 제외됐는데, 확인해보니 스타터가 준
  // 파일과 해시가 같았다 — 참가자가 화면 쪽을 안 건드린 것이다. 제외가 맞다.
  const untouchedDeliverables = excluded.filter(
    (e) => !e.rel.startsWith("tests/") && !e.rel.startsWith("data/") && e.rel !== "package.json" && !e.rel.endsWith(".md"),
  );
  if (untouchedDeliverables.length > 0) {
    untouchedNotes.push(`${dir}: ${untouchedDeliverables.map((s) => s.rel).join(", ")}`);
  }
  // 진짜 위험은 "제공한 적 없는 파일이 제외되는 것" — 그건 해시 맵 구성 버그를 뜻한다.
  const notProvided = excluded.filter((e) => !provided.has(e.rel));
  if (notProvided.length > 0) {
    anyArtifactExcluded++;
    console.log(`  ✗ ${dir}: 제공한 적 없는 파일이 제외됨(버그) → ${notProvided.map((s) => s.rel).join(", ")}`);
  }

  rows.push({
    dir,
    id,
    before,
    after,
    excludedCount: excluded.length,
    keptCount: kept.length,
    fitsBudget: after <= MAX_SOURCE_CHARS,
    beforeFit: before <= MAX_SOURCE_CHARS,
  });
}

rows.sort((a, b) => b.before - b.after - (a.before - a.after));

console.log(`\n=== 채점 입력 제외 회귀 확인 (워크스페이스 ${totalWs}개) ===\n`);
console.log("줄어든 폭이 큰 순 상위 15개:");
console.log("  문제 / 워크스페이스".padEnd(56), "제외전".padStart(9), "제외후".padStart(9), "감소".padStart(7), "예산내");
for (const r of rows.slice(0, 15)) {
  const pct = r.before === 0 ? 0 : Math.round(((r.before - r.after) / r.before) * 100);
  console.log(
    "  " + r.dir.slice(0, 54).padEnd(54),
    String(r.before).padStart(9),
    String(r.after).padStart(9),
    (pct + "%").padStart(7),
    r.fitsBudget ? "✓" : "✗",
  );
}

const changed = rows.filter((r) => r.before !== r.after);
const nowFits = rows.filter((r) => !r.beforeFit && r.fitsBudget);
console.log(`\n요약:`);
console.log(`  - 제외가 실제로 일어난 워크스페이스: ${changed.length}/${totalWs}`);
console.log(`  - 제공한 적 없는 파일이 제외된 워크스페이스(버그): ${anyArtifactExcluded}`);
console.log(`  - 참가자가 한 글자도 안 고쳐서 제외된 산출물 파일: ${untouchedNotes.length}건`);
for (const n of untouchedNotes) console.log(`      ${n}`);
console.log(`  - 제외 전엔 예산(${MAX_SOURCE_CHARS.toLocaleString()}자)을 넘었는데 제외 후 들어온 워크스페이스: ${nowFits.length}`);
console.log(`  - 제외 후에도 예산 초과: ${rows.filter((r) => !r.fitsBudget).length}`);

if (anyArtifactExcluded > 0) process.exit(1);
