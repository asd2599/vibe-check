// 2단계: "요약" 시트 — 카테고리별 합계가 살아있는 수식이고, 열어보면 값도 보인다
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readWorkbook, readSalesCsv } from "./xlsx.js";

const OUT = fileURLToPath(new URL("../output/report.xlsx", import.meta.url));
const CSV = fileURLToPath(new URL("../data/sales.csv", import.meta.url));

function expectedSummary() {
  const byCat = new Map();
  for (const r of readSalesCsv(CSV)) {
    const cur = byCat.get(r.category) ?? { qty: 0, amount: 0 };
    cur.qty += r.qty;
    cur.amount += r.amount;
    byCat.set(r.category, cur);
  }
  return [...byCat.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount);
}

test('"요약" 시트가 있다', () => {
  const wb = readWorkbook(OUT);
  assert.ok(wb.hasSheet("요약"), `시트 이름이 "요약" 여야 한다 (현재: ${wb.sheetNames.join(", ")})`);
});

test("1행 머리글이 카테고리 / 수량 합계 / 매출 합계 다", () => {
  const s = readWorkbook(OUT).sheet("요약");
  assert.equal(s.cell("A1").value, "카테고리");
  assert.equal(s.cell("B1").value, "수량 합계");
  assert.equal(s.cell("C1").value, "매출 합계");
});

test("카테고리가 매출 합계 내림차순으로 2행부터 들어있다", () => {
  const want = expectedSummary();
  const s = readWorkbook(OUT).sheet("요약");
  assert.equal(s.maxRow(), 1 + want.length, `카테고리 ${want.length}개가 2행부터 있어야 한다`);
  want.forEach((w, i) => {
    assert.equal(s.cell(`A${i + 2}`).value, w.category, `A${i + 2} (매출 합계 내림차순)`);
  });
});

test("합계 칸이 하드코딩 숫자가 아니라 상세 시트를 참조하는 수식이다", () => {
  const want = expectedSummary();
  const s = readWorkbook(OUT).sheet("요약");
  want.forEach((_, i) => {
    for (const col of ["B", "C"]) {
      const c = s.cell(`${col}${i + 2}`);
      assert.ok(c.formula, `${col}${i + 2} 는 값이 아니라 수식이어야 한다 (하드코딩 금지)`);
      assert.match(
        c.formula,
        /상세/,
        `${col}${i + 2} 수식이 "상세" 시트를 참조해야 한다 (현재: ${c.formula})`,
      );
    }
  });
});

test("수식 셀을 그냥 열어봐도 계산된 값이 보인다", () => {
  const want = expectedSummary();
  const s = readWorkbook(OUT).sheet("요약");
  want.forEach((w, i) => {
    const b = s.cell(`B${i + 2}`);
    const c = s.cell(`C${i + 2}`);
    assert.equal(
      b.type,
      "number",
      `B${i + 2} 에 계산된 값이 저장돼 있어야 한다 (수식만 있고 값이 비어 있으면 뷰어에서 빈칸으로 보인다)`,
    );
    assert.equal(
      c.type,
      "number",
      `C${i + 2} 에 계산된 값이 저장돼 있어야 한다 (수식만 있고 값이 비어 있으면 뷰어에서 빈칸으로 보인다)`,
    );
    assert.equal(b.value, w.qty, `B${i + 2} 수량 합계`);
    assert.equal(c.value, w.amount, `C${i + 2} 매출 합계`);
  });
});
