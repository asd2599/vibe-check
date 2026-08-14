// 이 문제의 **유일한** 채점 테스트다. 단계 게이트는 전부 no-op이라 중간에는 아무것도 안 잡아주고,
// "완료" 시점에 1~6단계에서 채팅으로 요청한 것이 **동시에 전부 살아있는지**를 여기서 한 번에 본다
// (docs/problem-set.md의 "안전망 없는 스펙 누적"). 뒤 기능을 얹으며 앞 기능을 회귀시킨 사람은
// 여기서 처음 걸린다.
//
// 각 test 이름 앞의 단계 번호는 "그 요구사항이 몇 단계에서 도착했는가"다 — 채점은 전부 완료 시점 1회.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../calc.js";

function eq(expr, want) {
  const got = evaluate(expr);
  assert.equal(
    got,
    want,
    `evaluate(${JSON.stringify(expr)}) 가 ${JSON.stringify(want)} 여야 하는데 ${JSON.stringify(got)} 였다`,
  );
}

test("1단계: 사칙연산", () => {
  eq("2+3", "5");
  eq("6-2", "4");
  eq("4*3", "12");
  eq("8/2", "4");
});

test("3단계: 괄호와 연산 우선순위", () => {
  eq("(2+3)*4", "20");
  eq("2+3*4", "14");
  eq("2*(3+4)-5", "9");
});

test("4단계: 0으로 나누기와 잘못된 식은 Error", () => {
  eq("5/0", "Error");
  eq("2+*3", "Error");
  eq("(2+3", "Error");
});

test("5단계: 표시용 숫자 정리", () => {
  eq("0.1+0.2", "0.3");
  eq("4/2", "2");
  eq("1.5*2", "3");
  eq("10/4", "2.5");
});

test("6단계: 나머지 연산", () => {
  eq("7%3", "1");
  eq("10%4", "2");
});

test("6단계: 루트", () => {
  eq("sqrt(9)", "3");
  eq("sqrt(16)", "4");
  eq("sqrt(-1)", "Error");
});

test("6단계: 상용로그", () => {
  eq("log(100)", "2");
  eq("log(1)", "0");
  eq("log(0)", "Error");
  eq("log(-5)", "Error");
});
