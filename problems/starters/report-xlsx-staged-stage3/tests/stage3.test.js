// 3단계: 표시 형식(통화/천단위)과 열 너비
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readWorkbook, readSalesCsv } from "./xlsx.js";

const OUT = fileURLToPath(new URL("../output/report.xlsx", import.meta.url));
const CSV = fileURLToPath(new URL("../data/sales.csv", import.meta.url));

function assertCurrency(cell, where) {
  assert.equal(cell.type, "number", `${where} 는 숫자여야 한다 (문자열로 포맷팅해서 넣으면 안 된다)`);
  assert.ok(cell.numFmt, `${where} 에 표시 형식이 지정돼 있지 않다`);
  assert.match(cell.numFmt, /₩/, `${where} 표시 형식에 ₩ 가 없다 (현재: ${cell.numFmt})`);
  assert.match(cell.numFmt, /#,##0/, `${where} 표시 형식에 천단위 구분이 없다 (현재: ${cell.numFmt})`);
  assert.doesNotMatch(
    cell.numFmt,
    /#,##0\.0/,
    `${where} 는 소수점 없이 원 단위로 보여야 한다 (현재: ${cell.numFmt})`,
  );
}

function assertPlainNumber(cell, where) {
  assert.equal(cell.type, "number", `${where} 는 숫자여야 한다`);
  assert.equal(
    cell.numFmt,
    "#,##0",
    `${where} 표시 형식은 통화가 아니라 "#,##0" 이어야 한다 (현재: ${cell.numFmt})`,
  );
}

test("상세 시트의 단가/금액이 숫자값 + 통화 표시 형식이다", () => {
  const rows = readSalesCsv(CSV);
  const s = readWorkbook(OUT).sheet("상세");
  rows.forEach((_, i) => {
    const n = i + 3;
    assertCurrency(s.cell(`E${n}`), `상세!E${n} 단가`);
    assertCurrency(s.cell(`F${n}`), `상세!F${n} 금액`);
  });
});

test("상세 시트의 수량은 통화가 아니라 천단위 형식이다", () => {
  const rows = readSalesCsv(CSV);
  const s = readWorkbook(OUT).sheet("상세");
  rows.forEach((_, i) => assertPlainNumber(s.cell(`D${i + 3}`), `상세!D${i + 3} 수량`));
});

test("요약 시트도 같은 규칙을 따른다", () => {
  const s = readWorkbook(OUT).sheet("요약");
  for (let n = 2; n <= 6; n++) {
    assertPlainNumber(s.cell(`B${n}`), `요약!B${n} 수량 합계`);
    assertCurrency(s.cell(`C${n}`), `요약!C${n} 매출 합계`);
  }
});

// 기본 열 너비는 8 남짓이라, "넓혔는가"만 넉넉한 하한선으로 본다. 정확한 수치로 재지 않는 이유는
// 도구에 따라 글꼴 기준 환산이 달라 저장된 값이 지정한 값과 조금씩 달라지기 때문이다.
test("상품명 열이 잘리지 않게 넓혀져 있다", () => {
  const s = readWorkbook(OUT).sheet("상세");
  const w = s.columnWidth(3); // C열 = 상품명
  assert.ok(w != null, "상세 시트 C열(상품명) 너비가 지정돼 있지 않다 (기본 너비 그대로면 상품명이 잘린다)");
  assert.ok(w >= 20, `상세 시트 C열 너비가 ${w} 다 — 긴 상품명이 안 잘리려면 훨씬 넓어야 한다`);
});
