// 4단계: 제목 행 병합 + 틀 고정
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "./xlsx.js";

const OUT = fileURLToPath(new URL("../output/report.xlsx", import.meta.url));
const TITLE = "2026년 2분기 매출 상세";

test("상세 시트 1행이 A1:F1 로 병합돼 있다", () => {
  const s = readWorkbook(OUT).sheet("상세");
  assert.ok(
    s.merges.includes("A1:F1"),
    `A1:F1 병합이 없다 (현재 병합: ${s.merges.join(", ") || "없음"})`,
  );
});

test("제목 값은 병합 범위의 첫 칸에만 들어 있다", () => {
  const s = readWorkbook(OUT).sheet("상세");
  assert.equal(s.cell("A1").value, TITLE, "A1 제목");
  for (const col of ["B", "C", "D", "E", "F"]) {
    assert.equal(
      s.cell(`${col}1`).type,
      "empty",
      `${col}1 은 병합된 칸이라 값이 들어가면 안 된다 (제목은 A1 에만)`,
    );
  }
});

test("상세 시트는 제목+머리글 2행이 고정돼 있다", () => {
  const s = readWorkbook(OUT).sheet("상세");
  assert.ok(s.freeze, "상세 시트에 틀 고정이 없다");
  assert.equal(s.freeze.state, "frozen", "틀 고정(frozen) 상태여야 한다");
  assert.equal(s.freeze.ySplit, 2, "상세 시트는 위에서 2행이 고정돼야 한다");
});

test("요약 시트는 머리글 1행만 고정돼 있다", () => {
  const s = readWorkbook(OUT).sheet("요약");
  assert.ok(s.freeze, "요약 시트에 틀 고정이 없다");
  assert.equal(s.freeze.state, "frozen", "틀 고정(frozen) 상태여야 한다");
  assert.equal(s.freeze.ySplit, 1, "요약 시트는 위에서 1행만 고정돼야 한다");
});
