// 1단계: "상세" 시트에 sales.csv 원본이 그대로 들어갔는가
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbook, readSalesCsv } from "./xlsx.js";

const OUT = fileURLToPath(new URL("../output/report.xlsx", import.meta.url));
const CSV = fileURLToPath(new URL("../data/sales.csv", import.meta.url));

const HEADERS = ["날짜", "카테고리", "상품명", "수량", "단가", "금액"];
const COLS = ["A", "B", "C", "D", "E", "F"];

test("output/report.xlsx 파일이 만들어졌다", () => {
  assert.ok(existsSync(OUT), "output/report.xlsx 가 없다");
});

test('"상세" 시트가 있다', () => {
  const wb = readWorkbook(OUT);
  assert.ok(wb.hasSheet("상세"), `시트 이름이 "상세" 여야 한다 (현재: ${wb.sheetNames.join(", ")})`);
});

test("2행이 머리글이다 (1행은 제목 자리로 비워둔다)", () => {
  const s = readWorkbook(OUT).sheet("상세");
  HEADERS.forEach((h, i) => {
    assert.equal(s.cell(`${COLS[i]}2`).value, h, `${COLS[i]}2 머리글`);
  });
});

test("데이터는 3행부터 시작하고 행 수가 sales.csv 와 같다", () => {
  const rows = readSalesCsv(CSV);
  const s = readWorkbook(OUT).sheet("상세");
  assert.equal(rows.length, 120, "테스트 기준 데이터가 120행이어야 한다");
  // 마지막 데이터 행 = 2(제목+머리글) + 120
  assert.equal(s.maxRow(), 2 + rows.length, "데이터 행 수가 다르다");
  assert.notEqual(s.cell("A3").type, "empty", "3행부터 데이터가 있어야 한다");
});

test("모든 행의 값이 sales.csv 와 일치한다", () => {
  const rows = readSalesCsv(CSV);
  const s = readWorkbook(OUT).sheet("상세");
  rows.forEach((r, i) => {
    const n = i + 3;
    assert.equal(s.cell(`A${n}`).value, r.date, `A${n} 날짜`);
    assert.equal(s.cell(`B${n}`).value, r.category, `B${n} 카테고리`);
    assert.equal(s.cell(`C${n}`).value, r.name, `C${n} 상품명`);
    assert.equal(s.cell(`D${n}`).value, r.qty, `D${n} 수량`);
    assert.equal(s.cell(`E${n}`).value, r.unitPrice, `E${n} 단가`);
  });
});

test("날짜는 텍스트, 수량/단가/금액은 숫자 타입이다", () => {
  const rows = readSalesCsv(CSV);
  const s = readWorkbook(OUT).sheet("상세");
  rows.forEach((_, i) => {
    const n = i + 3;
    assert.equal(s.cell(`A${n}`).type, "string", `A${n} 날짜는 텍스트여야 한다`);
    assert.equal(s.cell(`D${n}`).type, "number", `D${n} 수량은 숫자여야 한다`);
    assert.equal(s.cell(`E${n}`).type, "number", `E${n} 단가는 숫자여야 한다`);
    assert.equal(s.cell(`F${n}`).type, "number", `F${n} 금액은 숫자여야 한다`);
  });
});

test("금액 = 수량 × 단가", () => {
  const rows = readSalesCsv(CSV);
  const s = readWorkbook(OUT).sheet("상세");
  rows.forEach((r, i) => {
    assert.equal(s.cell(`F${i + 3}`).value, r.amount, `F${i + 3} 금액`);
  });
});
