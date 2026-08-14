// 설치된 Chrome(없으면 Edge)을 헤드리스로 띄워 페이지를 **실제로 클릭해보는** 최소 도구.
// 의존성 0 — Node 24의 전역 `fetch`/`WebSocket`으로 Chrome DevTools Protocol을 직접 말한다.
//
// 왜 이게 필요한가: 이 문제의 산출물 절반은 화면인데, `calc.js`만 테스트하면 "계산 함수는 완벽한데
// 버튼이 죽어있는" 산출물을 잡을 수 없다. 실측 사고(run c3f5bfff): 이벤트 리스너 셀렉터가 `#pad`만
// 덮어서 `#sciPad`의 괄호·루트·로그 버튼이 전부 무반응이었는데, 히든 테스트는 7/7 통과했고 소스를
// 읽는 LLM 채점자도 두 번 다 못 잡아서 90점이 나왔다(docs/evaluation.md).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 참가자의 server.js를 쓰지 않고 채점기가 직접 서빙한다 — 서버 쪽을 손댔다고 화면 채점이 흔들리면
// 안 되기 때문이다(측정 축은 화면 배선이지 서버가 아니다).
export function serveWorkspace(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const rel = url === "/" ? "/index.html" : url;
      const file = path.join(root, path.normalize(rel).replace(/^[/\\]+/, ""));
      if (!file.startsWith(root)) return void res.writeHead(403).end();
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 0;

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const resolver = pending.get(msg.id);
    if (resolver) {
      pending.delete(msg.id);
      resolver(msg);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP 웹소켓 연결 실패")), { once: true });
  });

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) =>
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result),
      );
      ws.send(JSON.stringify({ id, method, params }));
    });

  return { ready, send, close: () => ws.close() };
}

async function readDevToolsPort(profileDir) {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  for (let i = 0; i < 150; i++) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, "utf8").split("\n")[0].trim();
      if (first) return Number(first);
    }
    await sleep(100);
  }
  throw new Error("브라우저가 디버깅 포트를 열지 않았다(DevToolsActivePort 없음)");
}

async function findPageTarget(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 아직 안 떴다 */
    }
    await sleep(100);
  }
  throw new Error("브라우저 페이지 타깃을 찾지 못했다");
}

// url을 실제 브라우저로 열고, 페이지 컨텍스트에서 expression을 평가해 값을 돌려준다.
export async function runInPage(url, expression, { readyExpression } = {}) {
  const browser = findBrowser();
  if (!browser) {
    throw new Error(
      "화면을 채점할 브라우저(Chrome/Edge)를 찾지 못했다 — CHROME_PATH 환경변수로 실행 파일 경로를 지정해라",
    );
  }

  const profileDir = await mkdtemp(path.join(os.tmpdir(), "calc-chrome-"));
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      url,
    ],
    { stdio: "ignore", windowsHide: true },
  );

  let cdp = null;
  try {
    const port = await readDevToolsPort(profileDir);
    cdp = connectCdp(await findPageTarget(port));
    await cdp.ready;
    await cdp.send("Runtime.enable");

    // 모듈 스크립트는 defer라 DOM이 준비된 뒤에 붙는다 — 준비 조건이 참이 될 때까지 기다린다.
    const guard = readyExpression ?? "document.readyState === 'complete'";
    let settled = false;
    for (let i = 0; i < 100; i++) {
      const probe = await cdp.send("Runtime.evaluate", { expression: guard, returnByValue: true });
      if (probe.result?.value === true) {
        settled = true;
        break;
      }
      await sleep(100);
    }
    if (!settled) throw new Error(`페이지가 준비되지 않았다: ${guard}`);
    await sleep(300); // 리스너가 붙을 여유

    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const desc =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "알 수 없는 예외";
      throw new Error(`페이지 실행 중 예외: ${desc}`);
    }
    return result.result.value;
  } finally {
    cdp?.close();
    child.kill();
    await sleep(200);
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 임시 프로필 정리 실패는 무시 */
    }
  }
}
