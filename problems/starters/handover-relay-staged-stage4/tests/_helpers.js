const fs = require("node:fs");
const path = require("node:path");
const WS = path.join(__dirname, "..");

// Windows에서 PowerShell 리다이렉션/Out-File로 텍스트를 쓰면 UTF-8 BOM이 앞에 붙어 JSON.parse가
// 내용과 무관하게 죽는다. 산출물 인코딩은 이 문제가 재려는 축과 상관없으므로 벗겨낸다.
function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

function readJson(name) {
  const p = path.join(WS, name);
  if (!fs.existsSync(p)) throw new Error(name + " 파일이 워크스페이스 루트에 없다");
  return JSON.parse(stripBom(fs.readFileSync(p, "utf8")));
}

// 산출물이 한 겹 감싸여 있어도 벗겨낸다 — **게이트에서만 쓴다**(채점 히든은 규격대로 본다).
function unwrapSingleKey(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1) return value[keys[0]];
  }
  return value;
}

module.exports = { readJson, stripBom, unwrapSingleKey };
