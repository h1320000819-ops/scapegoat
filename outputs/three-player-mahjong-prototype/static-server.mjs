import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachAnmikaGameServer } from "./server/game-server.mjs";

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

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, socketIo: true }));
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
      if (pathname.startsWith("/replay/") || pathname.startsWith("/table/") || pathname === "/online-debug") {
        filePath = path.join(root, "index.html");
      }
      else throw new Error("Not found");
    }

    const bytes = await fs.readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
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
