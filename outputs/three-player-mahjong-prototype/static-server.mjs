import http from "node:http";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachAnmikaGameServer, getAnmikaServerDiagnostics } from "./server/game-server.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "0.0.0.0";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const cacheControlFor = (filePath, url, pathname) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "no-store";
  if (pathname.startsWith("/tiles/") || [".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext)) {
    return "public, max-age=31536000, immutable";
  }
  if (url.searchParams.has("v") && [".js", ".css"].includes(ext)) {
    return "public, max-age=31536000, immutable";
  }
  if ([".js", ".css"].includes(ext)) return "public, max-age=300, must-revalidate";
  return "public, max-age=3600";
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(getAnmikaServerDiagnostics()));
      return;
    }
    if (pathname === "/.env" || pathname.startsWith("/.env.")) throw new Error("Not found");
    const assetPathname = pathname.startsWith("/tiles/") ? `/public${pathname}` : pathname;
    let filePath = path.join(root, assetPathname === "/" ? "index.html" : assetPathname);

    if (!filePath.startsWith(root)) throw new Error("Invalid path");

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      if (pathname.startsWith("/replay/")) {
        filePath = path.join(root, "replay.html");
      }
      else if (pathname.startsWith("/table/") || pathname === "/online-debug") {
        filePath = path.join(root, "index.html");
      }
      else throw new Error("Not found");
    }

    const finalStat = await fs.stat(filePath);
    if (finalStat.isDirectory()) throw new Error("Not found");
    response.writeHead(200, {
      "Cache-Control": cacheControlFor(filePath, url, pathname),
      "Content-Length": finalStat.size,
      "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!response.headersSent) response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });
    stream.pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
server.requestTimeout = 0;

attachAnmikaGameServer(server);

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.log(`Mahjong prototype: http://localhost:${port}/ is already in use. Reusing the existing web server.`);
    return;
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`Mahjong prototype: http://localhost:${port}/`);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        console.log(`LAN access: http://${entry.address}:${port}/`);
      }
    }
  }
});
