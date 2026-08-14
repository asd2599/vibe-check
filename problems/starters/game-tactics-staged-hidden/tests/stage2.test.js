import test from "node:test";
import assert from "node:assert/strict";
import { createBattle, applyAction, turnOrder, legalMoves, attackTargets } from "../game.js";
import { loadScenario, loadScript, u, snapshot } from "./helpers.js";

function replay(name) {
  let state = createBattle(loadScenario(name));
  for (const action of loadScript(name)) state = applyAction(state, action);
  return state;
}

test("지형 이동 비용: 평지 1, 숲 2, 물 3, 벽 통과 불가", () => {
  const state = createBattle(loadScenario("s2_wetlands"));
  assert.deepEqual(legalMoves(state, "e1"), [{"x":5,"y":0},{"x":6,"y":0},{"x":7,"y":0},{"x":5,"y":1},{"x":6,"y":1},{"x":7,"y":1},{"x":3,"y":2},{"x":4,"y":2},{"x":5,"y":2},{"x":7,"y":2},{"x":3,"y":3},{"x":4,"y":3},{"x":5,"y":3},{"x":6,"y":3},{"x":7,"y":3},{"x":4,"y":4},{"x":5,"y":4},{"x":6,"y":4},{"x":7,"y":4},{"x":6,"y":5},{"x":7,"y":5}]);
});

test("숲 방어자는 받는 데미지 -25%, 물 위 공격자는 데미지 -1, 적용 순서는 숲 → 물", () => {
  let state = createBattle(loadScenario("s2_micro"));
  state = applyAction(state, { type: "attack", unitId: "a1", targetId: "e1" });
  assert.equal(u(state, "e1").hp, 33, "물 위 공격자 → 평지 방어자");
  state = applyAction(state, { type: "end", unitId: "a1" });
  state = applyAction(state, { type: "attack", unitId: "a2", targetId: "e2" });
  assert.equal(u(state, "e2").hp, 38, "물 위 공격자 → 숲 방어자 (보정 순서가 결과를 가른다)");
  state = applyAction(state, { type: "end", unitId: "a2" });
  state = applyAction(state, { type: "attack", unitId: "e1", targetId: "a1" });
  assert.equal(u(state, "a1").hp, 32, "물은 방어자에게는 영향이 없다");
  state = applyAction(state, { type: "end", unitId: "e1" });
  state = applyAction(state, { type: "attack", unitId: "e2", targetId: "a2" });
  assert.equal(u(state, "a2").hp, 35, "숲은 공격자에게는 영향이 없다");
});

test("s2_wetlands: 기록된 행동을 그대로 재생하면 최종 상태가 일치한다", () => {
  const state = replay("s2_wetlands");
  assert.deepEqual(snapshot(state, ["id","x","y","hp"]), [{"id":"a1","x":3,"y":1,"hp":12},{"id":"a2","x":5,"y":0,"hp":26},{"id":"e2","x":5,"y":1,"hp":22}]);
  assert.equal(state.round, 6);
  assert.equal(state.winner, null);
  assert.equal(state.current, "a1");
  assert.deepEqual(turnOrder(state), ["a1","e2","a2"]);
});

test("h2: 기록된 행동을 그대로 재생하면 최종 상태가 일치한다", () => {
  const state = replay("h2");
  assert.deepEqual(snapshot(state, ["id","x","y","hp"]), [{"id":"a1","x":1,"y":0,"hp":30},{"id":"e2","x":0,"y":0,"hp":30}]);
  assert.equal(state.round, 6);
  assert.equal(state.winner, null);
  assert.equal(state.current, "a1");
  assert.deepEqual(turnOrder(state), ["a1","e2"]);
});
