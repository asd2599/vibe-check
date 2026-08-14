import test from "node:test";
import assert from "node:assert/strict";
import { createBattle, applyAction, turnOrder, legalMoves, attackTargets } from "../game.js";
import { loadScenario, loadScript, u, snapshot } from "./helpers.js";

function replay(name) {
  let state = createBattle(loadScenario(name));
  for (const action of loadScript(name)) state = applyAction(state, action);
  return state;
}

test("피격 시 게이지 +10 (최대 100)", () => {
  let state = createBattle(loadScenario("s1_micro"));
  assert.equal(u(state, "a1").gauge, 0);
  state = applyAction(state, { type: "attack", unitId: "e1", targetId: "a1" });
  assert.equal(u(state, "a1").gauge, 10);
  assert.equal(u(state, "e1").gauge, 0, "때린 쪽은 게이지가 오르지 않는다");
});

test("게이지 100 이면 턴 시작에 궁극기가 자동 발동한다 (맨해튼 2 이내 적 전원, 지형 보정 후 1.5배)", () => {
  const state = createBattle(loadScenario("s4_micro"));
  assert.equal(u(state, "e1").hp, 31, "숲 위 대상");
  assert.equal(u(state, "e2").hp, 28, "평지 대상");
  assert.equal(u(state, "e3").hp, 40, "사거리 밖 대상은 무사해야 한다");
  assert.equal(u(state, "a1").gauge, 0, "발동하면 게이지 소모");
  assert.equal(u(state, "e1").gauge, 10, "궁극기 피격도 게이지를 채운다");
  assert.throws(
    () => applyAction(state, { type: "attack", unitId: "a1", targetId: "e1" }),
    Error,
    "발동한 턴에는 추가 행동 불가",
  );
});

test("사거리 안에 적이 없으면 궁극기는 발동하지 않고 게이지를 유지한다", () => {
  const state = createBattle(loadScenario("s4_hold"));
  assert.equal(u(state, "a1").gauge, 100);
  assert.equal(u(state, "e1").hp, 40);
  assert.ok(legalMoves(state, "a1").length > 0, "발동하지 않았으므로 평소처럼 행동할 수 있다");
});

test("독 피해로는 게이지가 오르지 않는다", () => {
  const state = createBattle(loadScenario("s3_micro"));
  assert.equal(u(state, "a1").hp, 26);
  assert.equal(u(state, "a1").gauge, 0);
});

test("s4_melee: 기록된 행동을 그대로 재생하면 최종 상태가 일치한다", () => {
  const state = replay("s4_melee");
  assert.deepEqual(snapshot(state, ["id","x","y","hp","poisonTurns","gauge"]), [{"id":"a1","x":3,"y":3,"hp":28,"poisonTurns":0,"gauge":70},{"id":"a3","x":3,"y":2,"hp":40,"poisonTurns":2,"gauge":20},{"id":"e1","x":4,"y":3,"hp":14,"poisonTurns":0,"gauge":70},{"id":"e2","x":5,"y":2,"hp":1,"poisonTurns":0,"gauge":50},{"id":"e3","x":5,"y":3,"hp":66,"poisonTurns":0,"gauge":0}]);
  assert.equal(state.round, 9);
  assert.equal(state.winner, null);
  assert.equal(state.current, "e1");
  assert.deepEqual(turnOrder(state), ["e1","a1","e2","e3","a3"]);
});

test("h4: 기록된 행동을 그대로 재생하면 최종 상태가 일치한다", () => {
  const state = replay("h4");
  assert.deepEqual(snapshot(state, ["id","x","y","hp","poisonTurns","gauge"]), [{"id":"a1","x":4,"y":0,"hp":48,"poisonTurns":0,"gauge":40},{"id":"a3","x":2,"y":5,"hp":19,"poisonTurns":0,"gauge":40},{"id":"e1","x":3,"y":0,"hp":35,"poisonTurns":0,"gauge":50},{"id":"e3","x":3,"y":5,"hp":4,"poisonTurns":0,"gauge":50}]);
  assert.equal(state.round, 10);
  assert.equal(state.winner, null);
  assert.equal(state.current, "e1");
  assert.deepEqual(turnOrder(state), ["e1","a1","e3","a3"]);
});
