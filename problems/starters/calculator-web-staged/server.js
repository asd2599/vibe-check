// 브라우저에서 index.html 을 열어보기 위한 정적 파일 서버. 워크스페이스를 열면 자동으로 실행되고,
// 직접 다시 띄우려면 `npm start`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const root = process.cwd();
const firstPort = Number(process.env.PORT ?? 5173);
const lastPort = firstPort + 10;

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = url === "/" ? "/index.html" : url;
  const file = path.join(root, path.normalize(rel).replace(/^[/\\]+/, ""));
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      // 계산기를 고칠 때마다 새로고침이 바로 반영되도록 캐시를 끈다.
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found: " + rel);
  }
});

// 이전에 띄운 서버가 아직 살아있어 포트가 물려 있으면 다음 포트로 넘어간다(창을 다시 열거나
// "다시 하기"를 했을 때 그냥 실패해버리지 않게).
let port = firstPort;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && port < lastPort) {
    server.listen(++port);
    return;
  }
  throw err;
});
server.on("listening", () => {
  console.log(`http://localhost:${port}`);
});
server.listen(port);
