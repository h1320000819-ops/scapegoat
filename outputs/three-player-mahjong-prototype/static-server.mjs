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
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const cacheControlFor = (filePath, url, pathname) => {
  const ext = path.extname(filePath).toLowerCase();
  if (pathname === "/service-worker.js" || pathname === "/manifest.json") return "no-store";
  if (ext === ".html") return "no-store";
  if (pathname.startsWith("/tiles/") || pathname.startsWith("/sounds/") || [".png", ".jpg", ".jpeg", ".webp", ".svg", ".m4a", ".mp3", ".wav"].includes(ext)) {
    return "public, max-age=31536000, immutable";
  }
  if (url.searchParams.has("v") && [".js", ".css"].includes(ext)) {
    return "public, max-age=31536000, immutable";
  }
  if ([".js", ".css"].includes(ext)) return "public, max-age=300, must-revalidate";
  return "public, max-age=3600";
};

const sendJson = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
};

const supabaseServerRest = async (pathName) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase service role is not configured");
  const response = await fetch(`${SUPABASE_URL}/rest/v1${pathName}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || text || `Supabase REST ${response.status}`);
  return data;
};

const getSupabaseUserFromRequest = async (request) => {
  const authorization = request.headers.authorization || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token || !SUPABASE_URL) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  return response.json();
};

const playerSummaryIncludesUser = (summary, userId) => {
  const players = Array.isArray(summary?.players) ? summary.players : [];
  return players.some((player) => String(player?.playerId || player?.userId || "") === String(userId));
};

const canUserReadReplay = async (replay, userId) => {
  if (!replay?.replay_id || !userId) return false;
  if (playerSummaryIncludesUser(replay.summary, userId)) return true;
  const stats = await supabaseServerRest(`/player_replay_stats?select=replay_id&replay_id=eq.${encodeURIComponent(replay.replay_id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`).catch(() => []);
  if (Array.isArray(stats) && stats.length) return true;
  if (!replay.club_id) return false;
  const members = await supabaseServerRest(`/club_members?select=club_id&club_id=eq.${encodeURIComponent(replay.club_id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`).catch(() => []);
  return Array.isArray(members) && members.length > 0;
};

const getClubMember = async (clubId, userId) => {
  if (!clubId || !userId) return null;
  const rows = await supabaseServerRest(`/club_members?select=club_id,user_id,role&club_id=eq.${encodeURIComponent(clubId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`).catch(() => []);
  return Array.isArray(rows) ? rows[0] : null;
};

const handleReplayApi = async (request, response, replayId) => {
  try {
    const user = await getSupabaseUserFromRequest(request);
    if (!user?.id) {
      sendJson(response, 401, { ok: false, error: "ログイン情報を確認できませんでした。" });
      return;
    }
    const rows = await supabaseServerRest(`/replays?select=replay_id,club_id,table_id,game_id,summary,initial_state,events,snapshots,created_at&replay_id=eq.${encodeURIComponent(replayId)}&limit=1`);
    const replay = Array.isArray(rows) ? rows[0] : null;
    if (!replay) {
      sendJson(response, 404, { ok: false, error: "牌譜が見つかりません。" });
      return;
    }
    if (!await canUserReadReplay(replay, user.id)) {
      sendJson(response, 403, { ok: false, error: "この牌譜を再生する権限がありません。" });
      return;
    }
    const eventRows = await supabaseServerRest(`/replay_events?select=sequence,event_type,actor_player_id,payload&replay_id=eq.${encodeURIComponent(replayId)}&order=sequence.asc`).catch(() => []);
    if (Array.isArray(eventRows) && eventRows.length) {
      replay.events = eventRows.map((row) => row.payload || { type: row.event_type, playerId: row.actor_player_id || null });
      replay.summary = {
        ...(replay.summary || {}),
        replayFormat: "event-log-v1",
        eventLogIsPrimary: true,
        eventCount: replay.events.length,
      };
    }
    sendJson(response, 200, { ok: true, replay });
  } catch (error) {
    console.error("[ReplayApi] failed", { replayId, error: error?.message || String(error) });
    sendJson(response, 500, { ok: false, error: error?.message || "牌譜本体の取得に失敗しました。" });
  }
};

const handleClubRakeApi = async (request, response, clubId) => {
  try {
    const user = await getSupabaseUserFromRequest(request);
    if (!user?.id) {
      sendJson(response, 401, { ok: false, error: "ログイン情報を確認できませんでした。" });
      return;
    }
    const member = await getClubMember(clubId, user.id);
    if (!member) {
      sendJson(response, 403, { ok: false, error: "このクラブのレーキ履歴を見る権限がありません。" });
      return;
    }
    const isAdmin = member.role === "admin";
    if (!isAdmin) {
      sendJson(response, 403, { ok: false, error: "支払レーキ履歴はクラブ管理者のみ確認できます。" });
      return;
    }
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const userId = url.searchParams.get("userId") || "";
    const dateFilter = [
      from ? `&created_at=gte.${encodeURIComponent(from)}` : "",
      to ? `&created_at=lt.${encodeURIComponent(to)}` : "",
      userId ? `&user_id=eq.${encodeURIComponent(userId)}` : "",
    ].join("");
    const rows = await supabaseServerRest(`/club_rake_logs?select=*&club_id=eq.${encodeURIComponent(clubId)}${dateFilter}&order=created_at.desc&limit=1000`);
    sendJson(response, 200, { ok: true, isAdmin, rows: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    console.error("[ClubRakeApi] failed", { clubId, error: error?.message || String(error) });
    sendJson(response, 500, { ok: false, error: error?.message || "レーキ履歴の取得に失敗しました。" });
  }
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
    const replayApiMatch = pathname.match(/^\/api\/replay\/([^/]+)$/);
    if (replayApiMatch) {
      await handleReplayApi(request, response, decodeURIComponent(replayApiMatch[1]));
      return;
    }
    const clubRakeApiMatch = pathname.match(/^\/api\/club-rake\/([^/]+)$/);
    if (clubRakeApiMatch) {
      await handleClubRakeApi(request, response, decodeURIComponent(clubRakeApiMatch[1]));
      return;
    }
    if (pathname === "/.env" || pathname.startsWith("/.env.")) throw new Error("Not found");
    const assetPathname = (pathname.startsWith("/tiles/") || pathname.startsWith("/sounds/")) ? `/public${pathname}` : pathname;
    let filePath = path.join(root, assetPathname === "/" ? "index.html" : assetPathname);

    if (!filePath.startsWith(root)) throw new Error("Invalid path");

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      if (pathname.startsWith("/replay/")) {
        filePath = path.join(root, "replay.html");
      }
      else if (pathname === "/auth/callback") {
        filePath = path.join(root, "online-debug", "index.html");
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
