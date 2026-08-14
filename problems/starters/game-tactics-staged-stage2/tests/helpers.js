import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadScenario(name) {
  return JSON.parse(readFileSync(path.join(here, "fixtures", name + ".json"), "utf8"));
}

export function loadScript(name) {
  return JSON.parse(readFileSync(path.join(here, "fixtures", name + ".script.json"), "utf8"));
}

/** 유닛 조회. 죽은 유닛은 state.units 에서 사라지므로 undefined 가 나온다. */
export function u(state, id) {
  return state.units.find((x) => x.id === id);
}

/** 살아있는 유닛을 id 순으로 정렬해 지정한 필드만 뽑는다. */
export function snapshot(state, fields) {
  return state.units
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((unit) => Object.fromEntries(fields.map((f) => [f, unit[f]])));
}
