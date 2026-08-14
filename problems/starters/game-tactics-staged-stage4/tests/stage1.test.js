import test from "node:test";
import assert from "node:assert/strict";
import { createBattle, applyAction, turnOrder, legalMoves, attackTargets } from "../game.js";
import { loadScenario, loadScript, u, snapshot } from "./helpers.js";

function replay(name) {
  let state = createBattle(loadScenario(name));
  for (const action of loadScript(name)) state = applyAction(state, action);
  return state;
}

test("턴 순서: 속도 내림차순 → 동점이면 적군 먼저 → 그래도 동점이면 id 오름차순", () => {
  const state = createBattle(loadScenario("s1_skirmish"));
  assert.deepEqual(turnOrder(state), ["e1","a2","e3","a1","e2","a3"]);
  assert.equal(state.current, "e1");
  assert.equal(state.round, 1);
});

test("이동 가능 칸: 4방향 최단거리, 벽과 다른 유닛(아군 포함)은 통과 불가", () => {
  const state = createBattle(loadScenario("s1_micro"));
  assert.deepEqual(legalMoves(state, "a1"), [{"x":0,"y":1},{"x":0,"y":2},{"x":0,"y":3},{"x":1,"y":3},{"x":2,"y":3},{"x":1,"y":4}]);
});

test("공격 사거리는 맨해튼 거리이며 벽을 무시한다", () => {
  const state = createBattle(loadScenario("s1_micro"));
  assert.deepEqual(attackTargets(state, "e1"), ["a1"]);
  assert.deepEqual(attackTargets(state, "a1"), ["e1"], "사거리 밖");
  assert.deepEqual(attackTargets(state, "e2"), ["a1"], "벽 너머라도 사거리 안이면 대상");
});

test("데미지 = floor(atk^2 / (atk + def)), 최소 1", () => {
  let state = createBattle(loadScenario("s1_micro"));
  state = applyAction(state, { type: "attack", unitId: "e1", targetId: "a1" });
  assert.equal(u(state, "a1").hp, 24);
});

test("잘못된 행동은 Error 를 던진다", () => {
  const state = createBattle(loadScenario("s1_micro"));
  assert.throws(() => applyAction(state, { type: "move", unitId: "a1", x: 0, y: 2 }), Error, "자기 턴이 아닌 유닛");
  assert.throws(() => applyAction(state, { type: "move", unitId: "e1", x: 4, y: 4 }), Error, "이동력 밖");
  assert.throws(() => applyAction(state, { type: "move", unitId: "e1", x: 2, y: 1 }), Error, "벽");
  const attacked = applyAction(state, { type: "attack", unitId: "e1", targetId: "a1" });
  assert.throws(() => applyAction(attacked, { type: "move", unitId: "e1", x: 0, y: 1 }), Error, "공격 후 이동");
});

test("applyAction 은 원본 상태를 변경하지 않는다", () => {
  const state = createBattle(loadScenario("s1_micro"));
  const before = JSON.stringify(state);
  applyAction(state, { type: "attack", unitId: "e1", targetId: "a1" });
  assert.equal(JSON.stringify(state), before);
});

test("s1_skirmish: 기록된 행동을 그대로 재생하면 최종 상태가 일치한다", () => {
  const state = replay("s1_skirmish");
  assert.deepEqual(snapshot(state, ["id","x","y","hp"]), [{"id":"a2","x":2,"y":0,"hp":34},{"id":"a3","x":3,"y":4,"hp":42},{"id":"e2","x":5,"y":0,"hp":21},{"id":"e3","x":4,"y":4,"hp":29}]);
  assert.equal(state.round, 5);
  assert.equal(state.winner, null);
  assert.equal(state.current, "a2");
  assert.deepEqual(turnOrder(state), ["a2","e3","e2","a3"]);
});
