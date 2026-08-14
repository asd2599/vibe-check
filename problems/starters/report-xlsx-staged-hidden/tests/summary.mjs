// 만들어진 report.xlsx 를 **결과물 그대로** 텍스트로 도식화한다. 채점자(LLM)는 소스만 읽을 수 있어서
// 바이너리인 .xlsx 를 아예 못 보는데, 그러면 "열었을 때 바로 쓸 만한 리포트인가"를 판단할 근거가
// 없다(docs/evaluation.md의 "산출물을 아무도 안 본다" 절). 이 스크립트의 stdout이 채점 프롬프트의
// "산출물 요약" 블록으로 들어간다.
//
// 어떤 도구로 만들었는지와 무관하게 **결과 파일만** 본다 — 방법 중립. 의존성 0(zlib만 쓴다).
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { readWorkbook } from "./xlsx.js";

const FILE = "output/report.xlsx";

// ---- xlsx.js 가 안 보는 부분(글꼴 강조/채움)만 여기서 따로 읽는다 ----

function readZip(buf) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lnLen = buf.readUInt16LE(localOff + 26);
    const leLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lnLen + leLen;
    const raw = buf.subarray(start, start + compSize);
    try {
      out.set(name, method === 0 ? raw : inflateRawSync(raw));
    } catch {
      /* 못 읽는 엔트리는 건너뛴다 */
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// cellXfs 의 s 인덱스 → 글꼴 강조 여부
function buildStyleLookup(stylesXml) {
  const fonts = [];
  const fontsBlock = stylesXml?.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/);
  if (fontsBlock) {
    for (const m of fontsBlock[1].matchAll(/<font\b[^>]*?(?:\/>|>[\s\S]*?<\/font>)/g)) {
      const szM = m[0].match(/<sz\s+val="([^"]+)"/);
      fonts.push({ bold: /<b\b[^>]*\/?>/.test(m[0]), size: szM ? Number(szM[1]) : null });
    }
  }
  const xfs = [];
  const xfsBlock = stylesXml?.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (xfsBlock) {
    for (const m of xfsBlock[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
      const f = m[0].match(/\sfontId="(\d+)"/);
      xfs.push(f ? Number(f[1]) : 0);
    }
  }
  return (styleIndex) => fonts[xfs[styleIndex ?? 0] ?? 0] ?? { bold: false, size: null };
}

// 시트 XML 에서 셀별 s 인덱스를 뽑는다(xlsx.js 는 numFmt 로만 쓰고 원본 s 를 안 돌려준다).
function styleIndexMap(sheetXml) {
  const map = new Map();
  for (const m of sheetXml.matchAll(/<c\b[^>]*\/?>/g)) {
    const r = m[0].match(/\sr="([A-Z]+\d+)"/);
    const s = m[0].match(/\ss="(\d+)"/);
    if (r) map.set(r[1], s ? Number(s[1]) : 0);
  }
  return map;
}

// ---- 본문 ----

let wb;
try {
  wb = readWorkbook(FILE);
} catch (err) {
  console.log(`${FILE} 를 열 수 없다: ${err.message}`);
  process.exit(0);
}

const entries = readZip(readFileSync(FILE));
const text = (n) => (entries.has(n) ? entries.get(n).toString("utf8") : null);
const fontOf = buildStyleLookup(text("xl/styles.xml"));

// 워크북 XML 에서 시트 이름 → 시트 파일 경로
const wbXml = text("xl/workbook.xml") ?? "";
const relsXml = text("xl/_rels/workbook.xml.rels") ?? "";
const rels = new Map();
for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
  const id = m[0].match(/\sId="([^"]+)"/);
  const t = m[0].match(/\sTarget="([^"]+)"/);
  if (id && t) rels.set(id[1], `xl/${t[1].replace(/^\/?xl\//, "").replace(/^\.\//, "")}`);
}
const sheetPaths = new Map();
let i = 0;
for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
  i++;
  const name = m[0].match(/\sname="([^"]+)"/);
  const rid = m[0].match(/\sr:id="([^"]+)"/);
  let p = rid ? rels.get(rid[1]) : null;
  if (!p || !entries.has(p)) p = `xl/worksheets/sheet${i}.xml`;
  if (name) sheetPaths.set(name[1], p);
}

const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const lines = [];
lines.push(`파일: ${FILE} · 시트 ${wb.sheetNames.length}개 (${wb.sheetNames.join(", ")})`);

for (const name of wb.sheetNames) {
  const sh = wb.sheet(name);
  const sxml = text(sheetPaths.get(name)) ?? "";
  const sIdx = styleIndexMap(sxml);
  const rows = sh.maxRow();
  let maxCol = 1;
  for (const c of sh.cells.values()) if (c.col > maxCol) maxCol = c.col;

  const widths = [];
  for (let c = 1; c <= maxCol; c++) {
    const w = sh.columnWidth(c);
    widths.push(`${COLS[c - 1]}=${w == null ? "기본" : w}`);
  }

  lines.push("");
  lines.push(`[${name}] ${rows}행 × ${maxCol}열`);
  lines.push(`  병합: ${sh.merges.length ? sh.merges.join(", ") : "없음"}`);
  const fz = sh.freeze;
  lines.push(
    `  틀 고정: ${fz ? `${fz.ySplit}행 / ${fz.xSplit}열 고정 (topLeft=${fz.topLeftCell ?? "-"}, state=${fz.state ?? "-"})` : "없음"}`,
  );
  lines.push(`  열 너비: ${widths.join(" ")}`);

  const describe = (r) => {
    const parts = [];
    for (let c = 1; c <= maxCol; c++) {
      const ref = `${COLS[c - 1]}${r}`;
      const cell = sh.cell(ref);
      if (cell.type === "empty" && !cell.formula) {
        parts.push("(빈칸)");
        continue;
      }
      const f = fontOf(sIdx.get(ref));
      const marks = [];
      if (f.bold) marks.push("굵게");
      if (f.size) marks.push(`${f.size}pt`);
      if (cell.numFmt && cell.numFmt !== "General") marks.push(`서식 ${cell.numFmt}`);
      if (cell.formula) marks.push(`수식 =${cell.formula}`);
      const v = cell.value == null ? "" : String(cell.value);
      parts.push(`${v}${marks.length ? ` <${marks.join(", ")}>` : ""}`);
    }
    return `  ${String(r).padStart(3)}행: ${parts.join(" | ")}`;
  };

  for (const r of [1, 2, 3, 4]) if (r <= rows) lines.push(describe(r));
  if (rows > 5) {
    lines.push(`  ... (${rows - 5}행 생략)`);
    lines.push(describe(rows));
  }
}

console.log(lines.join("\n"));
