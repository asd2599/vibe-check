// 브라우저에서 index.html 을 열어보기 위한 정적 파일 서버. npm start 로 실행.
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
const port = Number(process.env.PORT ?? 5173);

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = url === "/" ? "/index.html" : url;
  const file = path.join(root, path.normalize(rel).replace(/^[/\\]+/, ""));
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found: " + rel);
  }
}).listen(port, () => {
  console.log("http://localhost:" + port);
});
