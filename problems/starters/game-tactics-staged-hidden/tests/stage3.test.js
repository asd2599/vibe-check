import test from "node:test";
import assert from "node:assert/strict";
import { createBattle, applyAction, turnOrder, legalMoves, attackTargets } from "../game.js";
import { loadScenario, loadScript, u, snapshot } from "./helpers.js";

function replay(name) {
  let state = createBattle(loadScenario(name));
  for (const action of loadScript(name)) state = applyAction(state, action);
  return state;
}

test("독 피해는 자기 턴 시작에 floor(maxHp * 0.1)(최소 1)이며 지형 보정을 받지 않는다", () => {
  const state = createBattle(loadScenario("s3_micro"));
  assert.equal(u(state, "a1").hp, 26, "숲 위에 있어도 독 피해는 줄지 않는다");
  assert.equal(u(state, "a1").poisonTurns, 3, "지속 턴은 턴이 끝날 때 줄어든다");
});

test("독으로는 죽지 않고 hp 1 에서 멈춘다", () => {
  let state = createBattle(loadScenario("s3_micro"));
  state = applyAction(state, { type: "end", unitId: "a1" });
  assert.equal(u(state, "a1").poisonTurns, 2);
  assert.ok(u(state, "a2"), "독 피해로 유닛이 제거되면 안 된다");
  assert.equal(u(state, "a2").hp, 1);
});

test("venom 유닛의 공격은 대상의 독 지속 턴을 3 으로 덮어쓴다", () => {
  let state = createBattle(loadScenario("s3_micro"));
  for (const id of ["a1", "a2", "a3"]) state = applyAction(state, { type: "end", unitId: id });
  state = applyAction(state, { type: "attack", unitId: "e1", targetId: "a3" });
  assert.equal(u(state, "a3").hp, 30);
  assert.equal(u(state, "a3").poisonTurns, 3, "누적이 아니라 3 으로 리셋");
});

test("s3_venom: 기록된 행동을 그대로 재생하면 최종 상태가 일치한다", () => {
  const state = replay("s3_venom");
  assert.deepEqual(snapshot(state, ["id","x","y","hp","poisonTurns"]), [{"id":"e1","x":2,"y":1,"hp":18,"poisonTurns":0},{"id":"e2","x":3,"y":0,"hp":5,"poisonTurns":3}]);
  assert.equal(state.round, 5);
  assert.equal(state.winner, "enemy");
  assert.equal(state.current, "e1");
  assert.deepEqual(turnOrder(state), ["e1","e2"]);
});

test("h3: 기록된 행동을 그대로 재생하면 최종 상태가 일치한다", () => {
  const state = replay("h3");
  assert.deepEqual(snapshot(state, ["id","x","y","hp","poisonTurns"]), [{"id":"a2","x":1,"y":0,"hp":30,"poisonTurns":0}]);
  assert.equal(state.round, 5);
  assert.equal(state.winner, "ally");
  assert.equal(state.current, "a2");
  assert.deepEqual(turnOrder(state), ["a2"]);
});
