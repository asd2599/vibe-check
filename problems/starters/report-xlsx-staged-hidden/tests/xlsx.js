// 테스트가 결과물(.xlsx)을 다시 열어보기 위한 최소 리더.
// 이 파일 자체는 아무것도 추가로 받지 않는다 — .xlsx 는 그냥 XML 여러 장을 담은 zip 이라, node 에
// 기본으로 들어있는 zlib 만으로 충분히 읽을 수 있다. 여기서 필요한 것만 파싱한다: 시트, 셀 값/타입/수식, 표시 형식, 병합, 틀 고정,
// 열 너비.
//
// (이 파일은 채점용이다. 결과물을 어떤 도구로 만들든 상관없이 파일 자체만 본다.)
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// ---------------------------------------------------------------- zip

function readZipEntries(buf) {
  // End of Central Directory 를 뒤에서부터 찾는다(주석이 있어도 최대 64KB 안쪽).
  let eocd = -1;
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip 형식이 아니다 (EOCD 없음)");

  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: 필드가 0xFFFF/0xFFFFFFFF 로 포화되면 ZIP64 EOCD 를 본다.
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    let z64loc = -1;
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x07064b50) {
        z64loc = i;
        break;
      }
    }
    if (z64loc < 0) throw new Error("ZIP64 locator 를 찾지 못했다");
    const z64 = Number(buf.readBigUInt64LE(z64loc + 8));
    if (buf.readUInt32LE(z64) !== 0x06064b50) throw new Error("ZIP64 EOCD 가 깨졌다");
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdSize = Number(buf.readBigUInt64LE(z64 + 40));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // ZIP64 extra field (0x0001) 로 넘어간 값들 회수
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const hid = buf.readUInt16LE(e);
        const hsize = buf.readUInt16LE(e + 2);
        let q = e + 4;
        if (hid === 0x0001) {
          if (uncompSize === 0xffffffff) {
            uncompSize = Number(buf.readBigUInt64LE(q));
            q += 8;
          }
          if (compSize === 0xffffffff) {
            compSize = Number(buf.readBigUInt64LE(q));
            q += 8;
          }
          if (localOffset === 0xffffffff) {
            localOffset = Number(buf.readBigUInt64LE(q));
            q += 8;
          }
        }
        e += 4 + hsize;
      }
    }

    // 로컬 헤더에서 실제 데이터 시작 위치를 다시 계산한다(extra 길이가 다를 수 있음).
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`로컬 헤더가 깨졌다: ${name}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let content;
    if (method === 0) content = Buffer.from(raw);
    else if (method === 8) content = inflateRawSync(raw);
    else throw new Error(`지원하지 않는 zip 압축 방식(${method}): ${name}`);

    entries.set(name, content);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------------------------------------------------------------- xml

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
}

// ---------------------------------------------------------------- 표시 형식(numFmt)

// 스프레드시트 표준 내장 형식 중 실제로 마주칠 만한 것만. 나머지는 null 로 둔다.
const BUILTIN_NUM_FMT = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  14: "mm-dd-yy",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  49: "@",
};

function parseStyles(xml) {
  const custom = {};
  if (xml) {
    for (const m of xml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
      const id = attr(m[0], "numFmtId");
      const code = attr(m[0], "formatCode");
      if (id != null) custom[Number(id)] = code ?? "";
    }
  }
  // cellXfs 의 xf 순서가 곧 셀의 s 인덱스다.
  const xfs = [];
  const block = xml && xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (block) {
    for (const m of block[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
      xfs.push(Number(attr(m[0], "numFmtId") ?? 0));
    }
  }
  return {
    formatOf(styleIndex) {
      const id = xfs[styleIndex ?? 0];
      if (id == null) return "General";
      if (custom[id] != null) return custom[id];
      return BUILTIN_NUM_FMT[id] ?? null;
    },
  };
}

function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // 서식 런(<r><t>..</t></r>)이 여러 개면 이어붙인다.
    let text = "";
    for (const t of si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeEntities(t[1]);
    out.push(text);
  }
  return out;
}

// ---------------------------------------------------------------- 시트

function colToIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n; // A=1
}

function parseSheet(xml, shared, styles) {
  const cells = new Map(); // "A1" -> {value, type, formula, numFmt, row, col}
  for (const cm of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const head = "<c" + cm[1] + ">";
    const body = cm[2] ?? "";
    const ref = attr(head, "r");
    if (!ref) continue;
    const t = attr(head, "t") ?? "n";
    const s = attr(head, "s");
    const fm = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/);
    const formula = fm ? decodeEntities(fm[1]) : null;
    const vm = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);

    let value = null;
    let type = "empty";
    if (t === "inlineStr") {
      let text = "";
      for (const tt of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeEntities(tt[1]);
      value = text;
      type = "string";
    } else if (vm) {
      const rawV = decodeEntities(vm[1]);
      if (t === "s") {
        value = shared[Number(rawV)] ?? "";
        type = "string";
      } else if (t === "str") {
        value = rawV;
        type = "string";
      } else if (t === "b") {
        value = rawV === "1";
        type = "boolean";
      } else if (t === "e") {
        value = rawV;
        type = "error";
      } else {
        value = Number(rawV);
        type = "number";
      }
    }

    cells.set(ref, {
      ref,
      row: Number(ref.match(/\d+$/)[0]),
      col: colToIndex(ref),
      value,
      type,
      formula,
      numFmt: styles.formatOf(s == null ? 0 : Number(s)),
    });
  }

  const merges = [];
  for (const m of xml.matchAll(/<mergeCell\b[^>]*\/>/g)) {
    const ref = attr(m[0], "ref");
    if (ref) merges.push(ref);
  }

  const pm = xml.match(/<pane\b[^>]*\/?>/);
  const freeze = pm
    ? {
        xSplit: Number(attr(pm[0], "xSplit") ?? 0),
        ySplit: Number(attr(pm[0], "ySplit") ?? 0),
        topLeftCell: attr(pm[0], "topLeftCell"),
        state: attr(pm[0], "state"),
      }
    : null;

  const cols = [];
  for (const m of xml.matchAll(/<col\b[^>]*\/?>/g)) {
    cols.push({
      min: Number(attr(m[0], "min") ?? 0),
      max: Number(attr(m[0], "max") ?? 0),
      width: attr(m[0], "width") == null ? null : Number(attr(m[0], "width")),
    });
  }

  return {
    cells,
    merges,
    freeze,
    cols,
    cell(ref) {
      return cells.get(ref) ?? { ref, value: null, type: "empty", formula: null, numFmt: null };
    },
    // 열 너비: <col min..max> 구간에 해당 열이 들어있으면 그 width
    columnWidth(colIndex) {
      for (const c of cols) if (colIndex >= c.min && colIndex <= c.max) return c.width;
      return null;
    },
    maxRow() {
      let r = 0;
      for (const c of cells.values()) if (c.type !== "empty" && c.row > r) r = c.row;
      return r;
    },
  };
}

// ---------------------------------------------------------------- 공개 API

export function readWorkbook(filePath) {
  const entries = readZipEntries(readFileSync(filePath));
  const text = (name) => (entries.has(name) ? entries.get(name).toString("utf8") : null);

  const wbXml = text("xl/workbook.xml");
  if (!wbXml) throw new Error("xl/workbook.xml 이 없다 — 올바른 xlsx 파일이 아니다");
  const relsXml = text("xl/_rels/workbook.xml.rels") ?? "";

  const rels = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attr(m[0], "Id");
    let target = attr(m[0], "Target");
    if (!id || !target) continue;
    target = target.replace(/^\/?xl\//, "").replace(/^\.\//, "");
    rels.set(id, `xl/${target}`);
  }

  const shared = parseSharedStrings(text("xl/sharedStrings.xml"));
  const styles = parseStyles(text("xl/styles.xml"));

  const sheets = new Map();
  const order = [];
  let i = 0;
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    i++;
    const name = attr(m[0], "name");
    const rid = attr(m[0], "r:id") ?? attr(m[0], "id");
    let path = rid ? rels.get(rid) : null;
    if (!path || !entries.has(path)) path = `xl/worksheets/sheet${i}.xml`;
    if (!entries.has(path)) continue;
    sheets.set(name, parseSheet(entries.get(path).toString("utf8"), shared, styles));
    order.push(name);
  }

  return {
    sheetNames: order,
    sheet(name) {
      const s = sheets.get(name);
      if (!s) {
        throw new Error(`"${name}" 시트가 없다 (있는 시트: ${order.join(", ") || "없음"})`);
      }
      return s;
    },
    hasSheet(name) {
      return sheets.has(name);
    },
  };
}

// data/sales.csv 를 읽어 기대값을 만든다(테스트 쪽 기준 데이터).
export function readSalesCsv(filePath) {
  const lines = readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  return lines.slice(1).map((line) => {
    const [date, category, name, qty, unitPrice] = line.split(",");
    return {
      date,
      category,
      name,
      qty: Number(qty),
      unitPrice: Number(unitPrice),
      amount: Number(qty) * Number(unitPrice),
    };
  });
}
