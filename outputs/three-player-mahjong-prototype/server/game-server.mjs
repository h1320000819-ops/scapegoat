import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const PORT = Number(process.env.GAME_SERVER_PORT || 8787);
const allowedOrigins = (process.env.GAME_SERVER_CORS || "*").split(",").map((item) => item.trim()).filter(Boolean);
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ROOM_DB_PERSIST_INTERVAL_MS = Number(process.env.GAME_ROOM_DB_PERSIST_INTERVAL_MS || 15000);
const ROOM_DB_PERSIST_ENABLED = String(process.env.GAME_ROOM_DB_PERSIST_ENABLED || "true").toLowerCase() !== "false";
const ROOM_LOCAL_PERSIST_DEBOUNCE_MS = Number(process.env.GAME_ROOM_LOCAL_PERSIST_DEBOUNCE_MS || 500);
const ACTION_DEBUG_LOGS = String(process.env.GAME_ACTION_DEBUG_LOGS || "false").toLowerCase() === "true";
const DISCONNECTED_DISCARD_GRACE_MS = 30 * 1000;
const DISCONNECTED_LAST_HAND_GRACE_MS = 5 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_STORE_DIR = path.join(__dirname, "game-state-store");
const REPLAY_STORE_DIR = path.join(STATE_STORE_DIR, "replay-json");
fs.mkdirSync(STATE_STORE_DIR, { recursive: true });
fs.mkdirSync(REPLAY_STORE_DIR, { recursive: true });

const createHealthServer = () => http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(getAnmikaServerDiagnostics()));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Anmika Rocket game server is running.");
});

let io = null;

const gameRooms = new Map();
const roomStartLocks = new Map();
let shutdownHandlersInstalled = false;
let processExceptionHandlersInstalled = false;
const serverDiagnostics = {
  startedAt: Date.now(),
  lastException: null,
  lastGameStateSyncFailure: null,
  lastReplaySave: null,
};

const now = () => Date.now();
const isoNow = () => new Date().toISOString();
const pochiTsumoAnnouncementText = {
  blue: "めちゃくちゃ陽気なツモ",
  green: "陽気なツモ",
  yellow: "悲しそうなツモ",
  red: "超悲しそうなツモ",
};
const isPochiResolvedAsWhite = (scoreResult) => {
  const tile = scoreResult?.selectedWait ?? scoreResult?.scoringWinningTile ?? scoreResult?.winningTile;
  return tile?.suit === "honor" && tile?.kind === "white";
};
const pochiTsumoAnnouncement = (scoreResult) => {
  const color = scoreResult?.pochiActivated ? scoreResult?.pochiColor : null;
  return color && !isPochiResolvedAsWhite(scoreResult) && pochiTsumoAnnouncementText[color]
    ? { text: pochiTsumoAnnouncementText[color], kind: `pochi-tsumo-${color}` }
    : null;
};
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
const makeRoomKey = (tableId) => String(tableId || "");
const clone = (value) => JSON.parse(JSON.stringify(value));
const isFinalEndedRoomState = (state) => Boolean(
  state?.phase === "gameEnded" ||
  state?.finalResult ||
  state?.handLog?.result?.finalResult ||
  state?.handLog?.result?.type === "gameEnded"
);
const withRoomStartLock = async (tableId, task) => {
  const key = makeRoomKey(tableId);
  if (!key) return task();
  const previous = roomStartLocks.get(key) || Promise.resolve();
  let release = () => {};
  const lock = new Promise((resolve) => { release = resolve; });
  const chain = previous.catch(() => {}).then(() => lock);
  roomStartLocks.set(key, chain);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (roomStartLocks.get(key) === chain) roomStartLocks.delete(key);
  }
};
const safeStoreFileName = (tableId) => `${String(tableId || "").replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`;
const roomStorePath = (tableId) => path.join(STATE_STORE_DIR, safeStoreFileName(tableId));
const roomBackupStorePath = (tableId) => `${roomStorePath(tableId)}.bak`;
const roomTempStorePath = (tableId) => `${roomStorePath(tableId)}.tmp`;
const roomReplayStorePath = (tableId) => path.join(REPLAY_STORE_DIR, safeStoreFileName(tableId));
const roomReplayBackupStorePath = (tableId) => `${roomReplayStorePath(tableId)}.bak`;
const roomReplayTempStorePath = (tableId) => `${roomReplayStorePath(tableId)}.tmp`;
const asArray = (value) => Array.isArray(value) ? value : [];
const compactError = (error) => ({
  name: error?.name || "Error",
  message: error?.message || String(error),
  stack: error?.stack || "",
  code: error?.code || "",
});
const compactMemoryUsage = () => {
  try {
    const usage = process.memoryUsage();
    return Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, Math.round(Number(value || 0) / 1024 / 1024)]));
  } catch {
    return {};
  }
};
const reportExceptionToSentry = (error, context = {}) => {
  const sentry = globalThis.Sentry;
  if (!sentry?.captureException) return false;
  try {
    sentry.captureException(error, { extra: context });
    return true;
  } catch (sentryError) {
    console.warn("[ExceptionMonitor] Sentry capture failed", compactError(sentryError));
    return false;
  }
};
const logServerException = (source, error, context = {}) => {
  try {
    const exceptionId = context.exceptionId || `ex-${randomUUID()}`;
    const payload = {
      exceptionId,
      source,
      at: isoNow(),
      error: compactError(error),
      context: JSON.parse(JSON.stringify(context || {})),
      memoryMb: compactMemoryUsage(),
    };
    serverDiagnostics.lastException = payload;
    reportExceptionToSentry(error, payload);
    console.error("[ExceptionMonitor]", payload);
    return exceptionId;
  } catch (loggingError) {
    const fallbackId = `ex-${Date.now()}`;
    console.error("[ExceptionMonitor] logging failed", {
      exceptionId: fallbackId,
      source,
      error: error?.message || String(error),
      loggingError: loggingError?.message || String(loggingError),
    });
    return fallbackId;
  }
};
const logGameStateSyncFailure = (source, error, context = {}) => {
  const payload = {
    source,
    at: isoNow(),
    error: compactError(error),
    gameId: context.gameId || "",
    playerId: context.playerId || "",
    version: context.version ?? "",
    tableId: context.tableId || "",
    actionType: context.actionType || "",
    exceptionId: context.exceptionId || "",
  };
  serverDiagnostics.lastGameStateSyncFailure = payload;
  console.error("[GameStateSyncFailure]", payload);
  return payload;
};
const getReplayJsonDiagnostics = () => {
  try {
    const files = fs.readdirSync(REPLAY_STORE_DIR)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => {
        const filePath = path.join(REPLAY_STORE_DIR, fileName);
        const stat = fs.statSync(filePath);
        return { fileName, bytes: stat.size, updatedAt: stat.mtimeMs };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      directory: REPLAY_STORE_DIR,
      count: files.length,
      latest: files.slice(0, 5),
    };
  } catch (error) {
    return {
      directory: REPLAY_STORE_DIR,
      count: 0,
      latest: [],
      error: error?.message || String(error),
    };
  }
};
const getAnmikaServerDiagnostics = () => ({
  ok: true,
  socketIo: Boolean(io),
  rooms: gameRooms.size,
  activeReplaySnapshots: [...gameRooms.values()].map((room) => ({
    tableId: room.tableId,
    gameId: room.gameId,
    version: room.version,
    handId: room.state?.handLog?.handId || "",
    replaySnapshots: asArray(room.state?.replaySnapshots).length,
    hanchanReplaySnapshots: asArray(room.state?.hanchanReplaySnapshots).length,
  })),
  replayJson: getReplayJsonDiagnostics(),
  uptimeMs: Date.now() - serverDiagnostics.startedAt,
  memoryMb: compactMemoryUsage(),
  lastException: serverDiagnostics.lastException,
  lastGameStateSyncFailure: serverDiagnostics.lastGameStateSyncFailure,
  lastReplaySave: serverDiagnostics.lastReplaySave,
});
const createServerPlayerClocks = (players, initialMs = 20000) => Object.fromEntries(asArray(players).map((player) => [player.id, { playerId: player.id, remainingMs: initialMs, isInByoyomi: false }]));
const ensureServerClocks = (state) => {
  if (!state) return {};
  if (!state.playerClocks || Array.isArray(state.playerClocks)) {
    const existing = Array.isArray(state.playerClocks)
      ? Object.fromEntries(state.playerClocks.filter(Boolean).map((clock) => [clock.playerId, clock]))
      : {};
    state.playerClocks = { ...createServerPlayerClocks(state.players, state.settings?.initialClockMs || 20000), ...existing };
  }
  for (const player of asArray(state.players)) {
    state.playerClocks[player.id] ??= { playerId: player.id, remainingMs: state.settings?.initialClockMs || 20000, isInByoyomi: false };
  }
  return state.playerClocks;
};
const startServerClockForPlayer = (state, player) => {
  ensureServerClocks(state);
  state.activeClockPlayerId = player?.type === "cpu" ? null : player?.id || null;
  state.clockStartedAt = player?.type === "cpu" ? null : Date.now();
  state.lastClockRenderTick = null;
};
const stopServerClockForPlayer = (state, playerId, { recoverAfterDiscard = false } = {}) => {
  const clocks = ensureServerClocks(state);
  const clock = clocks[playerId];
  if (!clock) return;
  if (state.activeClockPlayerId === playerId && state.clockStartedAt) {
    clock.remainingMs = Math.max(0, Number(clock.remainingMs || 0) - (Date.now() - state.clockStartedAt));
  }
  if (clock.remainingMs <= 5000) clock.isInByoyomi = true;
  if (recoverAfterDiscard) {
    if (clock.isInByoyomi) clock.remainingMs = 5000;
    else {
      const roundedSeconds = Math.ceil(Number(clock.remainingMs || 0) / 1000);
      clock.remainingMs = Math.min(20, roundedSeconds + 2) * 1000;
    }
  }
  if (state.activeClockPlayerId === playerId) {
    state.activeClockPlayerId = null;
    state.clockStartedAt = null;
    state.lastClockRenderTick = null;
  }
};
const getServerClockRemainingMs = (state, playerId) => {
  const clock = ensureServerClocks(state)[playerId];
  if (!clock) return 0;
  if (state.activeClockPlayerId !== playerId || !state.clockStartedAt) return Number(clock.remainingMs || 0);
  return Math.max(0, Number(clock.remainingMs || 0) - (Date.now() - Number(state.clockStartedAt || 0)));
};
const faceDownTile = (id) => ({
  id: `face-down-${id}`,
  suit: "back",
  kind: "back",
  rank: 0,
  color: "normal",
  isPochi: false,
});
const hiddenTileArray = (count, prefix) => Array.from({ length: Math.max(0, Number(count || 0)) }, (_, index) => faceDownTile(`${prefix}-${index}`));
const isResultPhase = (state) => ["handEnded", "showingResult", "finalResult"].includes(state?.phase) || Boolean(state?.handResult || state?.handLog?.result);
const buildViewStateForPlayer = (state, viewerId) => {
  if (!state) return null;
  const viewState = cloneStateWithoutReplayPayload(state);
  viewState.players = asArray(viewState.players).map((player) => {
    if (player.id === viewerId) {
      return {
        ...player,
        type: player.type === "cpu" ? "cpu" : "human",
      };
    }
    return {
      ...player,
      type: player.type === "cpu" ? "cpu" : "remote",
      hand: hiddenTileArray(asArray(player.hand).length, `${player.id}-hand`),
      drawnTile: player.drawnTile ? faceDownTile(`${player.id}-drawn`) : null,
    };
  });
  viewState.liveWall = hiddenTileArray(asArray(state.liveWall).length, "wall");
  viewState.rinshanWall = hiddenTileArray(asArray(state.rinshanWall).length, "rinshan");
  if (viewState.pendingAction?.type === "multiRon") {
    const alreadyResponded = Boolean(viewState.pendingAction.responses?.[viewerId]);
    const options = alreadyResponded ? [] : asArray(viewState.pendingAction.optionsByPlayerId?.[viewerId]);
    viewState.pendingAction = options.length
      ? { playerId: viewerId, options, source: viewState.pendingAction.source, type: "multiRon" }
      : null;
  }
  if (!isResultPhase(state)) viewState.uraDoraIndicators = [];
  viewState.onlineMeta = {
    ...(viewState.onlineMeta || {}),
    viewForPlayerId: viewerId || null,
    redacted: true,
  };
  return viewState;
};
const publicRoomState = (room, viewerId = null) => ({
  tableId: room.tableId,
  gameId: room.gameId,
  version: room.version,
  state: (() => {
    const view = buildViewStateForPlayer(room.state, viewerId);
    if (view) view.onlineConnections = roomPlayerConnectionList(room);
    return view;
  })(),
  updatedAt: room.updatedAt,
  eventCount: room.events.length,
  connections: roomPlayerConnectionList(room),
});

const playerRecordsFromState = (state) => {
  const seats = asArray(state?.seats);
  const seatedPlayerIds = new Set(seats.map((seat) => seat?.playerId).filter(Boolean));
  return asArray(state?.players)
    .filter((player) => player?.id && player.type !== "cpu")
    .filter((player) => !seats.length || seatedPlayerIds.has(player.id))
    .map((player, index) => {
      const seatIndex = seats.find((seat) => seat?.playerId === player.id)?.seatIndex ?? index;
      return {
        userId: player.id,
        seatIndex,
        connected: false,
        socketId: "",
        lastSeenAt: 0,
        disconnectedAt: 0,
      };
    });
};
const ensureRoomPlayerRegistry = (room) => {
  if (!room) return new Map();
  if (!(room.players instanceof Map)) {
    room.players = new Map(asArray(room.players).map((record) => [record.userId, { ...record }]).filter(([userId]) => userId));
  }
  const seats = asArray(room.state?.seats);
  if (seats.length) {
    const seatedPlayerIds = new Set(seats.map((seat) => seat?.playerId).filter(Boolean));
    for (const userId of [...room.players.keys()]) {
      if (!seatedPlayerIds.has(userId)) room.players.delete(userId);
    }
  }
  for (const record of playerRecordsFromState(room.state)) {
    if (!room.players.has(record.userId)) room.players.set(record.userId, record);
    else {
      const existing = room.players.get(record.userId);
      existing.seatIndex = record.seatIndex;
    }
  }
  return room.players;
};
const roomPlayerConnectionList = (room) => {
  const registry = ensureRoomPlayerRegistry(room);
  return [...registry.values()].map((record) => ({
    userId: record.userId,
    seatIndex: record.seatIndex,
    connected: Boolean(record.connected),
    socketId: record.socketId || "",
    lastSeenAt: record.lastSeenAt || 0,
    disconnectedAt: record.disconnectedAt || 0,
  }));
};
const markRoomPlayerConnected = (room, userId, socket) => {
  if (!room || !userId) return;
  room.disconnectedLeaveSyncedUserIds?.delete?.(userId);
  const registry = ensureRoomPlayerRegistry(room);
  const seats = asArray(room.state?.seats);
  const seatIndex = seats.find((seat) => seat?.playerId === userId)?.seatIndex
    ?? asArray(room.state?.players).findIndex((player) => player?.id === userId);
  if (seats.length && !seats.some((seat) => seat?.playerId === userId) && room.state?.phase === "gameEnded") {
    registry.delete(userId);
    return;
  }
  for (const [existingUserId, record] of registry.entries()) {
    if (existingUserId === userId) continue;
    if (record.socketId === socket.id) {
      record.connected = false;
      record.socketId = "";
      record.disconnectedAt = now();
    }
  }
  registry.set(userId, {
    ...(registry.get(userId) || {}),
    userId,
    seatIndex: seatIndex >= 0 ? seatIndex : registry.get(userId)?.seatIndex ?? -1,
    connected: true,
    socketId: socket.id,
    lastSeenAt: now(),
    disconnectedAt: 0,
    disconnectedAutoPlay: false,
    disconnectedAutoPlayAt: 0,
    disconnectedProgressWaitStartedAt: 0,
  });
};
const markRoomPlayerDisconnected = (room, socketId, reason = "") => {
  if (!room || !socketId) return null;
  const registry = ensureRoomPlayerRegistry(room);
  for (const record of registry.values()) {
    if (record.socketId !== socketId) continue;
    record.connected = false;
    record.socketId = "";
    record.disconnectedAt = now();
    record.disconnectedAutoPlay = false;
    record.disconnectedAutoPlayAt = 0;
    record.disconnectedProgressWaitStartedAt = 0;
    record.lastDisconnectReason = reason;
    return record;
  }
  return null;
};
const isDisconnectedPlayerProgressTarget = (room, playerId) => {
  if (!room?.state || !playerId) return false;
  if (room.state.handLog?.result || ["handEnded", "exhaustiveDraw", "gameEnded", "showingFlowerAnnouncement", "showingWinAnnouncement"].includes(room.state.phase)) return false;
  if (room.state.pendingAction?.type === "multiRon" && room.state.pendingAction.playerIds?.includes?.(playerId) && !room.state.pendingAction.responses?.[playerId]) return true;
  if (room.state.pendingAction?.playerId === playerId) return true;
  const active = currentPlayer(room.state);
  return active?.id === playerId && ["playing", "waitingForHumanDiscard", "waitingForRiichiDiscard"].includes(room.state.phase);
};
const disconnectedHumanPlayerIds = (room) => roomPlayerConnectionList(room)
  .filter((record) => !record.connected && record.userId && isUuid(record.userId) && !room.disconnectedLeaveSyncedUserIds?.has?.(record.userId))
  .map((record) => record.userId);
const connectedHumanPlayerIds = (room) => new Set(roomPlayerConnectionList(room)
  .filter((record) => record.connected && record.userId)
  .map((record) => record.userId));
const isRoomPlayerConnected = (room, userId) => {
  if (!userId) return false;
  const registry = ensureRoomPlayerRegistry(room);
  return Boolean(registry.get(userId)?.connected);
};
const autoOkPlayerIdsForResult = (room, actingPlayerId = "") => {
  if (!room?.state?.handLog?.result) return [];
  const resultId = getCurrentResultId(room.state);
  const startedAt = Number(room.state.resultCountdownStartedAt || 0);
  if (!resultId || room.state.resultCountdownResultId !== resultId || !startedAt) return [];
  if (now() - startedAt < RESULT_AUTO_OK_DELAY_MS) return [];
  const connectedIds = connectedHumanPlayerIds(room);
  return ensureArray(room.state.players)
    .filter((player) => player?.id && player.type !== "cpu")
    .filter((player) => player.id !== actingPlayerId)
    .filter((player) => !connectedIds.has(player.id))
    .map((player) => player.id);
};
const markDisconnectedPlayersAsLastHand = (room) => {
  if (!room?.state) return [];
  const alreadyDeclared = new Set(asArray(room.state.lastHandDeclaredBy));
  const cutoff = now() - DISCONNECTED_LAST_HAND_GRACE_MS;
  const registry = ensureRoomPlayerRegistry(room);
  const ids = disconnectedHumanPlayerIds(room)
    .filter((id) => Number(registry.get(id)?.disconnectedAt || 0) > 0)
    .filter((id) => Number(registry.get(id)?.disconnectedAt || 0) <= cutoff)
    .filter((id) => !alreadyDeclared.has(id));
  if (!ids.length) return [];
  room.state.lastHandDeclaredBy = [...new Set([...(room.state.lastHandDeclaredBy || []), ...ids])];
  room.state.settings ??= {};
  room.state.settings.isLastHand = true;
  for (const seat of asArray(room.state.seats)) {
    if (ids.includes(seat?.playerId)) seat.isLastHandDeclared = true;
  }
  console.warn("[Reconnect] disconnected players marked as last hand", { tableId: room.tableId, gameId: room.gameId, playerIds: ids });
  return ids;
};
const scheduleDisconnectedLastHandTimeout = (room) => {
  if (!room?.state) return;
  if (room.disconnectedLastHandTimer) {
    clearTimeout(room.disconnectedLastHandTimer);
    room.disconnectedLastHandTimer = null;
  }
  const alreadyDeclared = new Set(asArray(room.state.lastHandDeclaredBy));
  const registry = ensureRoomPlayerRegistry(room);
  const candidates = [...registry.values()]
    .filter((record) => record.userId && !record.connected && Number(record.disconnectedAt || 0) > 0)
    .filter((record) => !alreadyDeclared.has(record.userId));
  if (!candidates.length) return;
  const nextAt = Math.min(...candidates.map((record) => Number(record.disconnectedAt || 0) + DISCONNECTED_LAST_HAND_GRACE_MS));
  const delay = Math.max(0, nextAt - now());
  room.disconnectedLastHandTimer = setTimeout(() => {
    try {
      room.disconnectedLastHandTimer = null;
      const ids = markDisconnectedPlayersAsLastHand(room);
      if (ids.length) {
        room.version = Number(room.version || 0) + 1;
        room.state.version = room.version;
        room.state.onlineMeta = {
          ...(room.state.onlineMeta || {}),
          transport: "socket.io",
          reason: "disconnectedLastHandGrace",
          publishedBy: null,
          publishedAt: now(),
        };
        room.updatedAt = now();
        persistRoom(room);
        broadcastState(room);
      }
      scheduleDisconnectedLastHandTimeout(room);
    } catch (error) {
      logServerException("timer:disconnectedLastHand", error, { tableId: room?.tableId, gameId: room?.gameId, version: room?.version });
      scheduleDisconnectedLastHandTimeout(room);
    }
  }, delay);
};
const scheduleDisconnectedProgressTimeout = (room) => {
  if (!room?.state) return;
  if (room.disconnectedProgressTimer) {
    clearTimeout(room.disconnectedProgressTimer);
    room.disconnectedProgressTimer = null;
  }
  const registry = ensureRoomPlayerRegistry(room);
  const candidates = [...registry.values()]
    .filter((record) => record.userId && !record.connected && Number(record.disconnectedAt || 0) > 0)
    .filter((record) => isDisconnectedPlayerProgressTarget(room, record.userId))
    .map((record) => {
      if (!record.disconnectedAutoPlay && !Number(record.disconnectedProgressWaitStartedAt || 0)) {
        record.disconnectedProgressWaitStartedAt = now();
      }
      return record;
    });
  if (!candidates.length) return;
  const nextAt = Math.min(...candidates.map((record) =>
    record.disconnectedAutoPlay
      ? now() + 700
      : Number(record.disconnectedProgressWaitStartedAt || now()) + DISCONNECTED_DISCARD_GRACE_MS
  ));
  const delay = Math.max(0, nextAt - now());
  room.disconnectedProgressTimer = setTimeout(() => {
    try {
      room.disconnectedProgressTimer = null;
      const ids = disconnectedHumanPlayerIds(room)
        .filter((id) => Number(registry.get(id)?.disconnectedAt || 0) > 0)
        .filter((id) => registry.get(id)?.disconnectedAutoPlay || Number(registry.get(id)?.disconnectedProgressWaitStartedAt || 0) + DISCONNECTED_DISCARD_GRACE_MS <= now())
        .filter((id) => {
          const record = registry.get(id);
          if (!record?.disconnectedAutoPlay && Number(record?.disconnectedProgressWaitStartedAt || 0) > 0) {
            record.disconnectedAutoPlay = true;
            record.disconnectedAutoPlayAt = now();
          }
          return isDisconnectedPlayerProgressTarget(room, id);
        });
      const progressed = applyDisconnectedGraceActions(room, ids);
      if (progressed) {
        advanceServerCpuTurns(room.state);
        room.version = Number(room.version || 0) + 1;
        room.state.version = room.version;
        room.state.onlineMeta = {
          ...(room.state.onlineMeta || {}),
          transport: "socket.io",
          reason: "disconnectedGraceProgress",
          publishedBy: null,
          publishedAt: now(),
        };
        room.updatedAt = now();
        persistRoom(room);
        safeSyncClubPointEffects(room, "disconnectedGraceProgress");
        broadcastState(room);
        scheduleRoomServerEffect(room);
        scheduleRoomClockTimeout(room);
        scheduleRoomResultTimeout(room);
      }
      scheduleDisconnectedProgressTimeout(room);
    } catch (error) {
      logServerException("timer:disconnectedProgress", error, { tableId: room?.tableId, gameId: room?.gameId, version: room?.version });
      scheduleDisconnectedProgressTimeout(room);
    }
  }, delay);
};
const scheduleDisconnectedTimeouts = (room) => {
  scheduleDisconnectedProgressTimeout(room);
  scheduleDisconnectedLastHandTimeout(room);
};
const resumeClockForReconnectedPlayer = (room, userId) => {
  if (!room?.state || !userId) return false;
  if (room.state.handLog?.result || ["handEnded", "exhaustiveDraw", "gameEnded", "showingFlowerAnnouncement", "showingWinAnnouncement"].includes(room.state.phase)) return false;
  const current = currentPlayer(room.state);
  const isPendingOwner = room.state.pendingAction?.playerId === userId ||
    (room.state.pendingAction?.type === "multiRon" && room.state.pendingAction.playerIds?.includes?.(userId) && !room.state.pendingAction.responses?.[userId]);
  const isDiscardOwner = current?.id === userId && ["waitingForHumanDiscard", "waitingForRiichiDiscard", "playing"].includes(room.state.phase);
  if (!isPendingOwner && !isDiscardOwner) return false;
  startServerClockForPlayer(room.state, findPlayer(room.state, userId));
  return true;
};
const applyDisconnectedGraceActions = (room, playerIds = []) => {
  if (!room?.state || !playerIds.length) return false;
  if (room.state.handLog?.result || ["handEnded", "exhaustiveDraw", "gameEnded", "showingFlowerAnnouncement", "showingWinAnnouncement"].includes(room.state.phase)) return false;
  let changed = false;
  for (const playerId of playerIds) {
    const player = findPlayer(room.state, playerId);
    if (!player || player.type === "cpu") continue;
    if (room.state.pendingAction?.type === "multiRon" && room.state.pendingAction.playerIds?.includes?.(playerId) && !room.state.pendingAction.responses?.[playerId]) {
      applyServerAction(room.state, {
        playerId,
        actionType: "skip",
        payload: { pending: clone(room.state.pendingAction), reason: "disconnectedGraceTimeout" },
      });
      changed = true;
      continue;
    }
    if (room.state.pendingAction?.playerId === playerId) {
      applyServerAction(room.state, {
        playerId,
        actionType: "skip",
        payload: { pending: clone(room.state.pendingAction), reason: "disconnectedGraceTimeout" },
      });
      changed = true;
      continue;
    }
    const active = currentPlayer(room.state);
    if (active?.id !== playerId) continue;
    if (!player.drawnTile && !drawFromWall(room.state, player, "liveWall")) {
      room.state.phase = "exhaustiveDraw";
      room.state.activeClockPlayerId = null;
      room.state.clockStartedAt = null;
      room.state.handLog ??= {};
      room.state.handLog.result = calculateServerExhaustiveDraw(room.state);
      startResultCountdownState(room.state);
      appendHandEvent(room.state, { type: "exhaustiveDraw", turnIndex: room.state.turnIndex ?? 0, reason: "disconnectedGraceWallEmpty" });
      changed = true;
      continue;
    }
    const tileId = player.drawnTile?.id || player.hand?.at(-1)?.id;
    if (!tileId) continue;
    discardForServer(room.state, player, tileId);
    appendHandEvent(room.state, { type: "disconnectedGraceDiscard", playerId, tile: player.discardedTiles?.at(-1)?.tile || null, turnIndex: room.state.turnIndex ?? 0 });
    changed = true;
  }
  return changed;
};
const syncSeatLeaveToDb = async (tableId, userId) => {
  if (!hasSupabaseServerWriter() || !isUuid(tableId) || !isUuid(userId)) return false;
  await supabaseRest(`/table_seats?table_id=eq.${encodeURIComponent(tableId)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      user_id: null,
      player_type: "empty",
      display_name: null,
      is_last_hand_declared: false,
    },
  });
  await supabaseRest(`/table_waiting_list?table_id=eq.${encodeURIComponent(tableId)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  }).catch((error) => console.warn("[LastHand] waiting delete failed", { tableId, userId, error: error?.message || String(error) }));
  return true;
};
const tableSeatPlayerId = (seat) => seat?.playerId || seat?.user_id || seat?.userId || null;
const tableSeatPlayerType = (seat) => seat?.playerType || seat?.player_type || (tableSeatPlayerId(seat) ? "human" : "empty");
const tableSeatDisplayName = (seat, fallback = "") => seat?.displayName || seat?.display_name || fallback || null;
const normalizeServerSeat = (seat, index = 0) => ({
  seatIndex: Number(seat?.seatIndex ?? seat?.seat_index ?? index),
  playerId: tableSeatPlayerId(seat),
  playerType: tableSeatPlayerType(seat),
  displayName: tableSeatDisplayName(seat),
  isLastHandDeclared: Boolean(seat?.isLastHandDeclared ?? seat?.is_last_hand_declared),
});
const normalizeServerSeats = (seats = []) => {
  const byIndex = new Map(asArray(seats).map((seat, index) => {
    const normalized = normalizeServerSeat(seat, index);
    return [normalized.seatIndex, normalized];
  }));
  return [0, 1, 2].map((seatIndex) => byIndex.get(seatIndex) || {
    seatIndex,
    playerId: null,
    playerType: "empty",
    displayName: null,
    isLastHandDeclared: false,
  });
};
const clearEndedRoomSeatForUser = (room, userId) => {
  if (!room?.state || !userId) return false;
  let changed = false;
  room.state.seats = normalizeServerSeats(room.state.seats);
  for (const seat of room.state.seats) {
    if (seat?.playerId !== userId) continue;
    seat.playerId = null;
    seat.playerType = "empty";
    seat.displayName = null;
    seat.isLastHandDeclared = false;
    changed = true;
  }
  if (room.players?.has?.(userId)) {
    room.players.delete(userId);
    changed = true;
  }
  if (changed) {
    room.state.lastHandLeaveSyncedBy ??= [];
    room.state.lastHandLeaveSyncedBy = [...new Set([...asArray(room.state.lastHandLeaveSyncedBy), userId])];
  }
  return changed;
};
const waitingDisplayName = (row) =>
  row?.users?.display_name || row?.users?.login_id || row?.display_name || `Player ${String(row?.user_id || "").slice(0, 8)}`;
const fillRoomSeatsFromWaitingList = async (room) => {
  if (!room?.state || !hasSupabaseServerWriter() || !isUuid(room.tableId)) return false;
  room.state.seats = normalizeServerSeats(room.state.seats);
  const occupied = new Set(room.state.seats.map((seat) => seat.playerId).filter(Boolean));
  const excluded = new Set([
    ...asArray(room.state.lastHandDeclaredBy),
    ...asArray(room.state.lastHandLeaveSyncedBy),
    ...asArray(room.lastHandLeaveSyncedUserIds),
    ...asArray(room.disconnectedLeaveSyncedUserIds),
  ].filter(Boolean));
  const emptySeats = room.state.seats.filter((seat) => !seat.playerId || seat.playerType === "empty");
  if (!emptySeats.length) return false;
  const rows = await supabaseRest(
    `/table_waiting_list?select=user_id,created_at,users(display_name,login_id)&table_id=eq.${encodeURIComponent(room.tableId)}&order=created_at.asc`
  ).catch((error) => {
    console.warn("[WaitingQueue] load failed", { tableId: room.tableId, error: error?.message || String(error) });
    return [];
  });
  let changed = false;
  for (const seat of emptySeats) {
    const next = asArray(rows).find((row) => row?.user_id && !occupied.has(row.user_id) && !excluded.has(row.user_id));
    if (!next) break;
    occupied.add(next.user_id);
    const name = waitingDisplayName(next);
    seat.playerId = next.user_id;
    seat.playerType = "human";
    seat.displayName = name;
    seat.isLastHandDeclared = false;
    await supabaseRest(`/table_seats?table_id=eq.${encodeURIComponent(room.tableId)}&seat_index=eq.${encodeURIComponent(String(seat.seatIndex))}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        user_id: next.user_id,
        player_type: "human",
        display_name: name,
        is_last_hand_declared: false,
      },
    }).catch((error) => console.warn("[WaitingQueue] seat patch failed", { tableId: room.tableId, userId: next.user_id, error: error?.message || String(error) }));
    await supabaseRest(`/table_waiting_list?table_id=eq.${encodeURIComponent(room.tableId)}&user_id=eq.${encodeURIComponent(next.user_id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    }).catch((error) => console.warn("[WaitingQueue] delete failed", { tableId: room.tableId, userId: next.user_id, error: error?.message || String(error) }));
    changed = true;
  }
  return changed;
};
const syncRoomSeatsToDb = async (room) => {
  if (!room?.state || !hasSupabaseServerWriter() || !isUuid(room.tableId)) return false;
  let changed = false;
  for (const seat of normalizeServerSeats(room.state.seats)) {
    const isCpu = seat.playerType === "cpu" || String(seat.playerId || "").startsWith("cpu");
    await supabaseRest(`/table_seats?table_id=eq.${encodeURIComponent(room.tableId)}&seat_index=eq.${encodeURIComponent(String(seat.seatIndex))}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        user_id: isCpu ? null : (seat.playerId || null),
        player_type: seat.playerId ? (isCpu ? "cpu" : "human") : "empty",
        display_name: seat.playerId ? seat.displayName : null,
        is_last_hand_declared: false,
      },
    }).catch((error) => console.warn("[Seats] sync failed", { tableId: room.tableId, seatIndex: seat.seatIndex, error: error?.message || String(error) }));
    changed = true;
  }
  return changed;
};
const nextHanchanPlayersFromSeats = (state) => {
  const seats = normalizeServerSeats(state?.seats);
  const seatPlayers = seats
    .filter((seat) => seat.playerId || seat.playerType === "cpu")
    .map((seat, index) => ({
      id: seat.playerId || `cpu${index}`,
      name: seat.displayName || (seat.playerType === "cpu" ? `CPU${Number(seat.seatIndex) + 1}` : `Player ${String(seat.playerId || "").slice(0, 8)}`),
      type: seat.playerType === "cpu" ? "cpu" : "remote",
    }));
  if (seatPlayers.length < 3) return [];
  const previousOrder = asArray(state?.round?.initialSeatOrder).filter((id) => seatPlayers.some((player) => player.id === id));
  const baseOrder = previousOrder.length === 3 ? previousOrder : seatPlayers.map((player) => player.id);
  const rotatedOrder = [...baseOrder.slice(1), baseOrder[0]];
  const byId = new Map(seatPlayers.map((player) => [player.id, player]));
  return rotatedOrder.map((id) => byId.get(id)).filter(Boolean);
};
const startNextTsumoLosslessHanchanIfReady = async (room) => {
  if (!room?.state || !isTsumoLossless3maState(room.state) || room.state.phase !== "gameEnded") return false;
  await Promise.race([
    enforceContinuationPointLimit(room, { timing: "nextHanchanStart" }),
    new Promise((resolve) => setTimeout(() => resolve([]), 1200)),
  ]).catch((error) => console.warn("[PointLimit] bounded next-hanchan check failed", { tableId: room.tableId, gameId: room.gameId, error: error?.message || String(error) }));
  await syncDeclaredLastHandLeaves(room);
  await fillRoomSeatsFromWaitingList(room);
  const players = nextHanchanPlayersFromSeats(room.state);
  if (players.length < 3) {
    await supabaseRest(`/tables?table_id=eq.${encodeURIComponent(room.tableId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status: "waiting" },
    }).catch(() => {});
    room.updatedAt = now();
    persistRoom(room);
    broadcastState(room);
    return false;
  }
  const previousGameId = room.gameId;
  const nextGameId = `game-${randomUUID()}`;
  const settings = {
    ...(room.state.settings || {}),
    isLastHand: false,
  };
  const ruleConfig = normalizeRuleConfigForRule(settings.ruleId || settings.gameType || TSUMO_LOSSLESS_3MA_RULE_ID, settings.ruleConfig);
  room.gameId = nextGameId;
  room.version = Number(room.version || 0) + 1;
  room.lastHandLeaveSyncedUserIds = new Set();
  room.disconnectedLeaveSyncedUserIds = new Set();
  room.processedRequestIds = new Set();
  room.events = [];
  room.state = createServerInitialState({
    tableId: room.tableId,
    gameId: nextGameId,
    players,
    settings,
    ruleConfig,
  });
  room.state.version = room.version;
  room.state.onlineMeta = {
    ...(room.state.onlineMeta || {}),
    transport: "socket.io",
    reason: "nextHanchanAutoStart",
    previousGameId,
    publishedBy: null,
    publishedAt: now(),
  };
  ensureRoomPlayerRegistry(room);
  await syncRoomSeatsToDb(room);
  await supabaseRest(`/tables?table_id=eq.${encodeURIComponent(room.tableId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { status: "playing" },
  }).catch(() => {});
  room.updatedAt = now();
  persistRoom(room);
  broadcastState(room);
  scheduleRoomServerEffect(room);
  scheduleRoomClockTimeout(room);
  scheduleDisconnectedTimeouts(room);
  console.log("[Hanchan] next hanchan started", { tableId: room.tableId, previousGameId, nextGameId, playerIds: players.map((player) => player.id) });
  return true;
};
const syncDeclaredLastHandLeaves = async (room) => {
  if (!room?.state || room.state.phase !== "gameEnded") return false;
  if (!(room.lastHandLeaveSyncedUserIds instanceof Set)) {
    room.lastHandLeaveSyncedUserIds = new Set(asArray(room.lastHandLeaveSyncedUserIds || room.state.lastHandLeaveSyncedBy));
  }
  const ids = asArray(room.state.lastHandDeclaredBy).filter((id) => id && !room.lastHandLeaveSyncedUserIds.has(id));
  if (!ids.length) return false;
  let changed = false;
  for (const userId of ids) {
    room.lastHandLeaveSyncedUserIds.add(userId);
    changed = clearEndedRoomSeatForUser(room, userId) || changed;
    await syncSeatLeaveToDb(room.tableId, userId)
      .then((updated) => console.warn("[LastHand] declared player left after game end", { tableId: room.tableId, userId, dbUpdated: updated }))
      .catch((error) => console.error("[LastHand] failed to leave declared player", { tableId: room.tableId, userId, error: error?.message || String(error) }));
  }
  if (changed) {
    room.updatedAt = now();
    persistRoom(room);
  }
  return changed;
};
const syncDisconnectedLastHandLeaves = async (room) => {
  if (!room?.state || room.state.phase !== "gameEnded") return false;
  if (!(room.disconnectedLeaveSyncedUserIds instanceof Set)) {
    room.disconnectedLeaveSyncedUserIds = new Set(asArray(room.disconnectedLeaveSyncedUserIds));
  }
  const ids = disconnectedHumanPlayerIds(room);
  if (!ids.length) return false;
  let changed = false;
  for (const userId of ids) {
    room.disconnectedLeaveSyncedUserIds.add(userId);
    changed = clearEndedRoomSeatForUser(room, userId) || changed;
    await syncSeatLeaveToDb(room.tableId, userId)
      .then((updated) => console.warn("[Reconnect] disconnected player left after game end", { tableId: room.tableId, userId, dbUpdated: updated }))
      .catch((error) => console.error("[Reconnect] failed to leave disconnected player", { tableId: room.tableId, userId, error: error?.message || String(error) }));
  }
  room.updatedAt = now();
  persistRoom(room);
  return changed;
};

const loadPersistedRoom = (tableId, expectedGameId = "") => {
  const filePaths = [roomStorePath(tableId), roomBackupStorePath(tableId)];
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed?.tableId || !parsed?.state) continue;
      if (expectedGameId && parsed.gameId && parsed.gameId !== expectedGameId) {
        console.log("[AnmikaGameServer] skip persisted room with old gameId", {
          tableId,
          file: filePath,
          persistedGameId: parsed.gameId,
          expectedGameId,
        });
        continue;
      }
      console.log("[AnmikaGameServer] loaded persisted room", {
        tableId,
        file: filePath,
        gameId: parsed.gameId,
        version: parsed.version || parsed.state?.version || 0,
      });
      const room = {
        tableId: String(parsed.tableId),
        gameId: parsed.gameId || `game-${tableId}`,
        version: Number(parsed.version || parsed.state?.version || 0),
        state: parsed.state,
        events: Array.isArray(parsed.events) ? parsed.events : [],
        sockets: new Map(),
        players: new Map(asArray(parsed.players || parsed.playerConnections).map((record) => [record.userId, { ...record }]).filter(([userId]) => userId)),
        processedRequestIds: new Set(asArray(parsed.processedRequestIds)),
        disconnectedLeaveSyncedUserIds: new Set(asArray(parsed.disconnectedLeaveSyncedUserIds)),
        lastHandLeaveSyncedUserIds: new Set(asArray(parsed.lastHandLeaveSyncedUserIds || parsed.state?.lastHandLeaveSyncedBy)),
        updatedAt: Number(parsed.updatedAt || now()),
      };
      hydrateRoomReplayJson(room);
      return room;
    } catch (error) {
      console.warn("[AnmikaGameServer] persisted room load failed", tableId, filePath, error);
    }
  }
  return null;
};

const deleteLocalPersistedRoom = (tableId) => {
  const filePaths = [
    roomStorePath(tableId),
    roomBackupStorePath(tableId),
    roomTempStorePath(tableId),
    roomReplayStorePath(tableId),
    roomReplayBackupStorePath(tableId),
    roomReplayTempStorePath(tableId),
  ];
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
      console.warn("[AnmikaGameServer] persisted room delete failed", { tableId, file: filePath, error: error?.message || String(error) });
    }
  }
};

const deletePersistedRoomFromDb = async (tableId) => {
  if (!ROOM_DB_PERSIST_ENABLED || !hasSupabaseServerWriter() || !tableId) return false;
  try {
    await supabaseRest(`/online_game_rooms?table_id=eq.${encodeURIComponent(String(tableId))}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    return true;
  } catch (error) {
    console.warn("[AnmikaGameServer] DB persisted room delete failed", { tableId, error: error?.message || String(error) });
    return false;
  }
};

const deletePersistedRoom = (tableId, reason = "resetRoom") => {
  if (!tableId) return;
  deleteLocalPersistedRoom(tableId);
  deletePersistedRoomFromDb(tableId).catch((error) => {
    console.warn("[AnmikaGameServer] async DB persisted room delete failed", { tableId, reason, error: error?.message || String(error) });
  });
};

const roomDbPersistWarnings = new Set();
const roomDbLoadWarnings = new Set();
const roomFromPersistedPayload = (parsed, tableId) => {
  if (!parsed?.tableId || !parsed?.state) return null;
  const room = {
    tableId: String(parsed.tableId || tableId),
    gameId: parsed.gameId || `game-${tableId}`,
    version: Number(parsed.version || parsed.state?.version || 0),
    state: parsed.state,
    events: Array.isArray(parsed.events) ? parsed.events : [],
    sockets: new Map(),
    players: new Map(asArray(parsed.players || parsed.playerConnections).map((record) => [record.userId, { ...record }]).filter(([userId]) => userId)),
    processedRequestIds: new Set(asArray(parsed.processedRequestIds)),
    disconnectedLeaveSyncedUserIds: new Set(asArray(parsed.disconnectedLeaveSyncedUserIds)),
    lastHandLeaveSyncedUserIds: new Set(asArray(parsed.lastHandLeaveSyncedUserIds || parsed.state?.lastHandLeaveSyncedBy)),
    updatedAt: Number(parsed.updatedAt || now()),
  };
  hydrateRoomReplayJson(room);
  return room;
};
const persistRoomToDb = async (room, payload) => {
  if (!ROOM_DB_PERSIST_ENABLED) return false;
  if (!hasSupabaseServerWriter() || !room?.tableId || !payload?.state) return false;
  try {
    await supabaseRest("/online_game_rooms?on_conflict=table_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        table_id: String(room.tableId),
        game_id: String(room.gameId || ""),
        version: Number(room.version || payload.version || 0),
        state: payload.state,
        events: asArray(payload.events),
        processed_request_ids: asArray(payload.processedRequestIds),
        updated_at: new Date(Number(payload.updatedAt || now())).toISOString(),
      },
    });
    return true;
  } catch (error) {
    if (!roomDbPersistWarnings.has(room.tableId)) {
      roomDbPersistWarnings.add(room.tableId);
      console.warn("[AnmikaGameServer] DB room persistence failed. Run supabase/patch_online_game_rooms_persistence.sql if needed.", {
        tableId: room.tableId,
        error: error?.message || String(error),
      });
    }
    return false;
  }
};

const shouldForceRoomDbPersist = (payload) => {
  const state = payload?.state;
  const phase = state?.phase;
  return Boolean(
    phase === "handEnded" ||
    phase === "exhaustiveDraw" ||
    phase === "gameEnded" ||
    phase === "finalResult" ||
    state?.handLog?.result ||
    state?.finalResult
  );
};

const shouldSyncRoomDbEffects = (state) => {
  const phase = state?.phase;
  return Boolean(
    phase === "handEnded" ||
    phase === "exhaustiveDraw" ||
    phase === "gameEnded" ||
    phase === "finalResult" ||
    state?.handLog?.result ||
    state?.finalResult
  );
};

const scheduleRoomDbPersist = (room, payload) => {
  if (!ROOM_DB_PERSIST_ENABLED) return;
  if (!hasSupabaseServerWriter() || !room?.tableId || !payload?.state) return;
  room.pendingDbPersistPayload = payload;
  const force = shouldForceRoomDbPersist(payload);
  const elapsed = now() - Number(room.lastDbPersistAt || 0);
  const run = () => {
    const nextPayload = room.pendingDbPersistPayload;
    room.pendingDbPersistPayload = null;
    if (room.dbPersistTimer) {
      clearTimeout(room.dbPersistTimer);
      room.dbPersistTimer = null;
    }
    if (!nextPayload) return;
    room.lastDbPersistAt = now();
    persistRoomToDb(room, nextPayload);
  };
  if (force || elapsed >= ROOM_DB_PERSIST_INTERVAL_MS) {
    run();
    return;
  }
  if (!room.dbPersistTimer) {
    room.dbPersistTimer = setTimeout(run, Math.max(1000, ROOM_DB_PERSIST_INTERVAL_MS - elapsed));
  }
};

const loadPersistedRoomFromDb = async (tableId, expectedGameId = "") => {
  if (!hasSupabaseServerWriter() || !tableId) return null;
  try {
    const rows = await supabaseRest(`/online_game_rooms?select=*&table_id=eq.${encodeURIComponent(String(tableId))}&limit=1`);
    const row = asArray(rows)[0];
    if (!row?.state) return null;
    if (expectedGameId && row.game_id && row.game_id !== expectedGameId) {
      console.log("[AnmikaGameServer] skip DB persisted room with old gameId", {
        tableId,
        persistedGameId: row.game_id,
        expectedGameId,
      });
      return null;
    }
    const parsed = {
      tableId: row.table_id || tableId,
      gameId: row.game_id || `game-${tableId}`,
      version: row.version,
      state: row.state,
      events: row.events,
      processedRequestIds: row.processed_request_ids,
      updatedAt: row.updated_at ? Date.parse(row.updated_at) : now(),
    };
    const room = roomFromPersistedPayload(parsed, tableId);
    if (room) {
      console.log("[AnmikaGameServer] loaded DB persisted room", {
        tableId,
        gameId: room.gameId,
        version: room.version,
      });
    }
    return room;
  } catch (error) {
    if (!roomDbLoadWarnings.has(String(tableId))) {
      roomDbLoadWarnings.add(String(tableId));
      console.warn("[AnmikaGameServer] DB room load failed. Run supabase/patch_online_game_rooms_persistence.sql if needed.", {
        tableId,
        error: error?.message || String(error),
      });
    }
    return null;
  }
};

const persistRoom = (room) => {
  if (!room?.tableId || !room.state) return;
  appendServerReplaySnapshot(room.state);
  const payload = buildRoomPersistPayload(room);
  room.pendingLocalPersistPayload = payload;
  scheduleRoomDbPersist(room, payload);
  if (shouldForceRoomDbPersist(payload)) {
    flushRoomLocalPersist(room);
    return;
  }
  if (!room.localPersistTimer) {
    room.localPersistTimer = setTimeout(() => flushRoomLocalPersist(room), Math.max(50, ROOM_LOCAL_PERSIST_DEBOUNCE_MS));
  }
};

const buildRoomPersistPayload = (room) => ({
  tableId: room.tableId,
  gameId: room.gameId,
  version: room.version,
  state: compactStateForRoomPersistence(room.state),
  events: asArray(room.events).slice(-500),
  players: roomPlayerConnectionList(room),
  processedRequestIds: [...(room.processedRequestIds || [])].slice(-500),
  disconnectedLeaveSyncedUserIds: [...(room.disconnectedLeaveSyncedUserIds || [])].slice(-100),
  lastHandLeaveSyncedUserIds: [...(room.lastHandLeaveSyncedUserIds || room.state?.lastHandLeaveSyncedBy || [])].slice(-100),
  updatedAt: room.updatedAt || now(),
});

const writeRoomPersistPayload = (room, payload) => {
  if (!room?.tableId || !payload?.state) return;
  const filePath = roomStorePath(room.tableId);
  const backupPath = roomBackupStorePath(room.tableId);
  const tempPath = roomTempStorePath(room.tableId);
  const serialized = JSON.stringify(payload);
  fs.writeFileSync(tempPath, serialized);
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
  }
  fs.renameSync(tempPath, filePath);
};

const flushRoomLocalPersist = (room) => {
  if (!room?.tableId) return;
  if (room.localPersistTimer) {
    clearTimeout(room.localPersistTimer);
    room.localPersistTimer = null;
  }
  const payload = room.pendingLocalPersistPayload || (room.state ? buildRoomPersistPayload(room) : null);
  room.pendingLocalPersistPayload = null;
  if (!payload) return;
  try {
    writeRoomPersistPayload(room, payload);
    persistRoomReplayJson(room);
  } catch (error) {
    const exceptionId = logServerException("room:persist", error, {
      tableId: room?.tableId,
      gameId: room?.gameId,
      version: room?.version,
    });
    logGameStateSyncFailure("room:persist", error, {
      tableId: room?.tableId,
      gameId: room?.gameId,
      version: room?.version,
      exceptionId,
    });
    console.error("[AnmikaGameServer] room persist failed", {
      tableId: room?.tableId,
      gameId: room?.gameId,
      version: room?.version,
      exceptionId,
      error: error?.message || String(error),
    });
  }
};

const isRecoverableClientState = (state, tableId, gameId) => {
  if (!state || typeof state !== "object") return false;
  if (state.tableId && String(state.tableId) !== String(tableId)) return false;
  if (state.onlineMeta?.viewForPlayerId) return false;
  if (!Array.isArray(state.players) || state.players.length !== 3) return false;
  if (!Array.isArray(state.liveWall) || !Array.isArray(state.doraIndicators)) return false;
  if (!state.handLog?.handId) return false;
  return !gameId || !state.gameId || String(state.gameId) === String(gameId);
};

const hasSupabaseServerWriter = () => Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabaseRest = async (pathName, { method = "GET", body, prefer } = {}) => {
  if (!hasSupabaseServerWriter()) throw new Error("SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です");
  const response = await fetch(`${SUPABASE_URL}/rest/v1${pathName}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Supabase REST ${response.status}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};
const getRoomTableContext = async (room) => {
  if (!room?.tableId || !isUuid(room.tableId)) return null;
  if (room.tableContext?.table_id === room.tableId) return room.tableContext;
  const rows = await supabaseRest(`/tables?select=table_id,club_id,rake_percent,point_rate&table_id=eq.${encodeURIComponent(room.tableId)}&limit=1`);
  const table = Array.isArray(rows) ? rows[0] : null;
  if (!table?.club_id) return null;
  room.tableContext = table;
  return table;
};
const nonCpuPlayersForPointSettlement = (state) =>
  asArray(state?.players).filter((player) => player?.type !== "cpu" && isUuid(player?.id));
const pointSettlementPlayerById = (state) => new Map(asArray(state?.players).map((player) => [player.id, player]));
const requiredContinuationPointBalance = (state) => {
  const rate = Math.max(0, Number(state?.settings?.pointRate || 1));
  return isTsumoLossless3maState(state) ? roundToTenth(150 * rate) : roundToTenth(1000 * rate);
};
const markPlayersLastHandForBalance = (state, playerIds = [], reason = "pointBalanceLimit") => {
  const ids = [...new Set(asArray(playerIds).filter((id) => id && isUuid(id)))];
  if (!ids.length) return false;
  state.settings ??= {};
  const before = new Set(asArray(state.lastHandDeclaredBy));
  for (const id of ids) before.add(id);
  state.lastHandDeclaredBy = [...before];
  state.settings.isLastHand = state.lastHandDeclaredBy.length > 0;
  state.seats = normalizeServerSeats(state.seats);
  for (const seat of state.seats) {
    if (ids.includes(seat?.playerId)) seat.isLastHandDeclared = true;
  }
  appendHandEvent(state, { type: "lastHandByPointBalance", playerIds: ids, reason, requiredPointBalance: requiredContinuationPointBalance(state), turnIndex: state.turnIndex ?? 0 });
  return true;
};
const enforceContinuationPointLimit = async (room, { timing = "nextHand" } = {}) => {
  if (!room?.state || !hasSupabaseServerWriter()) return [];
  const state = room.state;
  const players = nonCpuPlayersForPointSettlement(state);
  if (!players.length) return [];
  const required = requiredContinuationPointBalance(state);
  if (!(required > 0)) return [];
  const table = await getRoomTableContext(room).catch((error) => {
    console.warn("[PointLimit] table context unavailable", { tableId: room.tableId, gameId: room.gameId, error: error?.message || String(error) });
    return null;
  });
  if (!table?.club_id) return [];
  const playerIds = players.map((player) => player.id);
  const rows = await supabaseRest(
    `/club_members?select=user_id,point_balance&club_id=eq.${encodeURIComponent(table.club_id)}&user_id=in.(${playerIds.map(encodeURIComponent).join(",")})`
  ).catch((error) => {
    console.warn("[PointLimit] balance check failed", { tableId: room.tableId, gameId: room.gameId, timing, error: error?.message || String(error) });
    return null;
  });
  if (!Array.isArray(rows)) return [];
  const balanceById = new Map(rows.map((row) => [row.user_id, Number(row.point_balance || 0)]));
  const insufficient = players
    .filter((player) => Number(balanceById.get(player.id) ?? 0) + 1e-9 < required)
    .map((player) => player.id);
  const newlyMarked = insufficient.filter((id) => !asArray(state.lastHandDeclaredBy).includes(id));
  if (!newlyMarked.length) return insufficient;
  if (markPlayersLastHandForBalance(state, newlyMarked, timing)) {
    state.continuationPointLimit ??= { checks: [] };
    state.continuationPointLimit.checks.push({
      timing,
      required,
      playerIds: newlyMarked,
      balances: Object.fromEntries(newlyMarked.map((id) => [id, roundToTenth(balanceById.get(id) ?? 0)])),
      checkedAt: now(),
    });
    console.log("[PointLimit] marked last hand", { tableId: room.tableId, gameId: room.gameId, timing, required, playerIds: newlyMarked });
    room.updatedAt = now();
    persistRoom(room);
  }
  return insufficient;
};
const normalizeSignedZero = (value) => Object.is(value, -0) ? 0 : value;
const roundToTenth = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.round((numeric + Math.sign(numeric) * Number.EPSILON) * 10) / 10;
  return normalizeSignedZero(Number(rounded.toFixed(1)));
};
const floorToTenth = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  const floored = Math.floor((numeric + 1e-9) * 10) / 10;
  return normalizeSignedZero(Number(floored.toFixed(1)));
};
const ceilToTenth = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  const ceiled = Math.ceil((numeric - 1e-9) * 10) / 10;
  return normalizeSignedZero(Number(ceiled.toFixed(1)));
};
const normalizePointDeltas = (payments = {}) => {
  const normalized = {};
  for (const [playerId, amount] of Object.entries(payments || {})) {
    if (!isUuid(playerId)) continue;
    const value = roundToTenth(amount);
    if (value) normalized[playerId] = value;
  }
  return normalized;
};
const paymentEntries = (payments) => Array.isArray(payments)
  ? payments.map((payment) => [payment.playerId, payment.delta])
  : Object.entries(payments || {});
const calculateServerRake = (winnerGain, rakePercent) => {
  const gain = Math.max(0, Number(winnerGain || 0));
  const percent = Math.max(0, Number(rakePercent || 0));
  if (!gain || !percent) return 0;
  return roundClubPointCreditInClubFavor(gain * (percent / 100));
};
const applyServerWinRake = (state, winnerId, scoreResult) => {
  if (!scoreResult || isTsumoLossless3maState(state)) return scoreResult;
  const rakePercent = Math.max(0, Number(state?.settings?.rakePercent || 0));
  const payments = { ...(scoreResult.payments || {}) };
  const originalWinnerGain = Number(payments[winnerId] || 0);
  const rakePoints = calculateServerRake(originalWinnerGain, rakePercent);
  if (rakePoints > 0) {
    payments[winnerId] = roundPlayerPointDeltaInClubFavor(originalWinnerGain - rakePoints);
    state.rakePool = roundToTenth(Number(state.rakePool || 0) + rakePoints);
  }
  scoreResult.payments = payments;
  scoreResult.originalWinnerGain = roundToTenth(originalWinnerGain);
  scoreResult.rakePoints = rakePoints;
  scoreResult.rakeAmount = rakePoints;
  scoreResult.rakePercent = rakePercent;
  scoreResult.rakePayerId = winnerId;
  scoreResult.winnerGain = payments[winnerId] || 0;
  scoreResult.paymentDeltas = Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta }));
  return scoreResult;
};
const pointDeltasFromResultPayments = (payments, pointRate = 1) => {
  const rate = Number(pointRate || 1);
  const deltas = {};
  for (const [playerId, delta] of paymentEntries(payments)) {
    if (!isUuid(playerId)) continue;
    const value = roundToTenth(Number(delta || 0) * rate);
    if (value) deltas[playerId] = value;
  }
  return deltas;
};
const pointDeltasForRealPlayers = (state, payments, pointRate = 1) => {
  const entries = Array.isArray(payments)
    ? payments.map((payment) => [payment.playerId, payment.delta])
    : Object.entries(payments || {});
  const rate = Number(pointRate || 1);
  const playerById = pointSettlementPlayerById(state);
  const deltas = {};
  const allDeltas = {};
  const omittedAutoPlayerDeltas = {};
  for (const [playerId, delta] of entries) {
    const value = roundToTenth(Number(delta || 0) * rate);
    if (!value) continue;
    allDeltas[playerId] = value;
    const player = playerById.get(playerId);
    if (player?.type === "cpu" || !isUuid(playerId)) {
      omittedAutoPlayerDeltas[playerId] = value;
      continue;
    }
    deltas[playerId] = value;
  }
  const realPlayerTotal = roundToTenth(Object.values(deltas).reduce((sum, value) => sum + Number(value || 0), 0));
  return {
    deltas,
    metadata: {
      allDeltas,
      omittedAutoPlayerDeltas,
      clubReserveDelta: roundToTenth(-realPlayerTotal),
      cpuCompensationApplied: Object.keys(omittedAutoPlayerDeltas).length > 0,
    },
  };
};
const roundPlayerPointDeltaInClubFavor = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric >= 0 ? floorToTenth(numeric) : ceilToTenth(numeric);
};
const roundClubPointCreditInClubFavor = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric >= 0 ? ceilToTenth(numeric) : floorToTenth(numeric);
};
const anmikaClubPointDeltasFromResult = (state, result, pointRate = 1) => {
  const rate = Number(pointRate || 1);
  const entries = Array.isArray(result?.payments)
    ? result.payments.map((payment) => [payment.playerId, payment.delta])
    : Object.entries(result?.payments || {});
  const playerById = pointSettlementPlayerById(state);
  const deltas = {};
  const allPointDeltas = {};
  const omittedAutoPlayerDeltas = {};
  const rawClubPointDeltas = {};
  for (const [playerId, delta] of entries) {
    const rawValue = Number(delta || 0) * rate;
    if (!rawValue) continue;
    rawClubPointDeltas[playerId] = roundToTenth(rawValue);
    const pointValue = roundPlayerPointDeltaInClubFavor(rawValue);
    if (!pointValue) continue;
    allPointDeltas[playerId] = pointValue;
    const player = playerById.get(playerId);
    if (player?.type === "cpu" || !isUuid(playerId)) {
      omittedAutoPlayerDeltas[playerId] = pointValue;
      continue;
    }
    deltas[playerId] = pointValue;
  }

  const winnerId = result?.winnerId;
  const winnerRawGain = Number(rawClubPointDeltas[winnerId] || 0);
  const rakePercent = Math.max(0, Number(state?.settings?.rakePercent || 0));
  const scoreRakePoints = Number(result?.scoreResult?.rakePoints ?? result?.scoreResult?.rakeAmount ?? 0);
  const scoreRakeApplied = scoreRakePoints > 0;
  const shouldApplyRake = !scoreRakeApplied && winnerId && isUuid(winnerId) && winnerRawGain > 0 && rakePercent > 0;
  let rakeRaw = 0;
  let rakePlayerDeduction = 0;
  let rakeTotalAmount = 0;
  if (shouldApplyRake) {
    rakeRaw = winnerRawGain * (rakePercent / 100);
    rakeTotalAmount = roundClubPointCreditInClubFavor(rakeRaw);
    const winnerAfterRake = roundPlayerPointDeltaInClubFavor(winnerRawGain - rakeRaw);
    rakePlayerDeduction = roundPlayerPointDeltaInClubFavor(winnerRawGain) - winnerAfterRake;
    deltas[winnerId] = winnerAfterRake;
    allPointDeltas[winnerId] = winnerAfterRake;
  }
  else if (scoreRakeApplied) {
    rakeTotalAmount = roundClubPointCreditInClubFavor(scoreRakePoints * rate);
  }

  const realPlayerTotal = roundToTenth(Object.values(deltas).reduce((sum, value) => sum + Number(value || 0), 0));
  const clubReserveDelta = roundToTenth(-realPlayerTotal);
  return {
    deltas,
    metadata: {
      rawGamePayments: Object.fromEntries(entries),
      rawClubPointDeltas,
      allDeltas: allPointDeltas,
      omittedAutoPlayerDeltas,
      clubReserveDelta,
      cpuCompensationApplied: Object.keys(omittedAutoPlayerDeltas).length > 0,
      rake: {
        applied: scoreRakeApplied || shouldApplyRake,
        source: scoreRakeApplied ? "scoreResult" : shouldApplyRake ? "clubPointFallback" : "none",
        winnerId,
        rakePercent,
        winnerRawGain: roundToTenth(winnerRawGain),
        totalAmount: rakeTotalAmount,
        rakeRaw: scoreRakeApplied ? rakeTotalAmount : roundToTenth(rakeRaw),
        rakeGamePoints: scoreRakeApplied ? roundToTenth(scoreRakePoints) : null,
        playerDeduction: rakePlayerDeduction,
        roundingPolicy: "小数第2位以下は常にクラブ側へ寄せる",
      },
    },
  };
};
const applyClubPointDeltasToDb = async (room, reason, payments, metadata = {}) => {
  const deltas = normalizePointDeltas(payments);
  if (!Object.keys(deltas).length) return { skipped: true, reason: "empty" };
  if (!hasSupabaseServerWriter()) {
    if (!room.pointSyncMissingEnvLogged) {
      console.warn("[ClubPointSync] SUPABASE_SERVICE_ROLE_KEY is not set. Point DB sync is skipped.");
      room.pointSyncMissingEnvLogged = true;
    }
    return { skipped: true, reason: "missingEnv" };
  }
  const table = await getRoomTableContext(room);
  if (!table?.club_id) return { skipped: true, reason: "missingClub" };
  await supabaseRest("/rpc/apply_game_club_point_deltas", {
    method: "POST",
    body: {
      p_club_id: table.club_id,
      p_table_id: table.table_id,
      p_game_key: String(room.gameId || room.tableId || ""),
      p_reason: reason,
      p_deltas: deltas,
      p_metadata: {
        tableId: room.tableId,
        gameId: room.gameId,
        ...metadata,
      },
    },
  });
  console.log("[ClubPointSync] applied", { tableId: room.tableId, gameId: room.gameId, reason, deltas });
  return { ok: true };
};
const markClubPointSyncApplied = (state, key) => {
  state.clubPointDbSync ??= { appliedKeys: [] };
  state.clubPointDbSync.appliedKeys = [...new Set([...(state.clubPointDbSync.appliedKeys || []), key])];
};
const hasClubPointSyncApplied = (state, key) => asArray(state?.clubPointDbSync?.appliedKeys).includes(key);
const ensureResultSyncIdentity = (result) => {
  if (!result) return null;
  result.resultId ??= randomUUID();
  result.createdAt ??= now();
  return result;
};
const makeResultSyncKey = (state, room, result, suffix) => {
  const handId = state.handLog?.handId || `${room.gameId || room.tableId}-hand-${state.round?.hanchanRoundIndex ?? 0}`;
  const identified = ensureResultSyncIdentity(result);
  return `${handId}:${identified?.resultId || "result"}:${suffix}`;
};
const syncOneClubPointEffect = async (room, key, reason, payments, metadata = {}) => {
  if (!room?.state || hasClubPointSyncApplied(room.state, key)) return false;
  const result = await applyClubPointDeltasToDb(room, reason, payments, metadata);
  if (!result?.ok) return false;
  markClubPointSyncApplied(room.state, key);
  persistRoom(room);
  return true;
};
const syncAnmikaRakeLogEffect = async (room, result, pointRate = 1) => {
  const scoreResult = result?.scoreResult;
  const rakePoints = Number(scoreResult?.rakePoints ?? scoreResult?.rakeAmount ?? 0);
  const winnerId = result?.winnerId || scoreResult?.rakePayerId;
  if (!room?.state || !rakePoints || !winnerId || !isUuid(winnerId)) return false;
  const key = makeResultSyncKey(room.state, room, result, "rakeLog");
  if (hasClubPointSyncApplied(room.state, key)) return false;
  const table = await getRoomTableContext(room);
  if (!table?.club_id) return false;
  const winner = asArray(room.state.players).find((player) => player.id === winnerId);
  const rakeAmount = roundClubPointCreditInClubFavor(rakePoints * Number(pointRate || 1));
  await supabaseRest("/club_rake_logs", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      club_id: table.club_id,
      user_id: winnerId,
      user_name: winner?.name || null,
      table_id: table.table_id,
      game_id: isUuid(room.gameId) ? room.gameId : null,
      win_type: result?.winType || null,
      original_gain: roundToTenth(scoreResult?.originalWinnerGain ?? 0),
      rake_percent: Number(scoreResult?.rakePercent ?? room.state.settings?.rakePercent ?? table.rake_percent ?? 0),
      rake_amount: rakeAmount,
      amount: rakeAmount,
    },
  });
  markClubPointSyncApplied(room.state, key);
  persistRoom(room);
  console.log("[RakeSync] applied", { tableId: room.tableId, gameId: room.gameId, winnerId, rakeAmount });
  return true;
};
const syncEntryRakeLogEffect = async (room, entryRakePoints = 0) => {
  if (!room?.state) return false;
  const entryRake = roundClubPointCreditInClubFavor(entryRakePoints);
  if (!entryRake) return false;
  const key = `${room.gameId}:entryRakeLog`;
  if (hasClubPointSyncApplied(room.state, key)) return false;
  if (!hasSupabaseServerWriter()) return false;
  const table = await getRoomTableContext(room);
  if (!table?.club_id) return false;
  const rows = nonCpuPlayersForPointSettlement(room.state).map((player) => ({
    club_id: table.club_id,
    user_id: player.id,
    user_name: player.name || null,
    table_id: table.table_id,
    game_id: isUuid(room.gameId) ? room.gameId : null,
    win_type: null,
    original_gain: 0,
    rake_percent: 0,
    rake_amount: entryRake,
    amount: entryRake,
  }));
  if (!rows.length) return false;
  await supabaseRest("/club_rake_logs", {
    method: "POST",
    prefer: "return=minimal",
    body: rows,
  });
  markClubPointSyncApplied(room.state, key);
  persistRoom(room);
  console.log("[RakeSync] entry rake applied", { tableId: room.tableId, gameId: room.gameId, players: rows.length, entryRake });
  return true;
};
const makeHiddenWallForReplay = (length) => Array.from({ length: Math.max(0, Number(length || 0)) }, () => 0);
const cloneStateWithoutReplayPayload = (state) => {
  if (!state) return state;
  const {
    replaySnapshots,
    hanchanReplaySnapshots,
    replayInitialState,
    hanchanReplayInitialState,
    ...lightState
  } = state;
  return clone(lightState);
};
const cloneStateForAction = (state) => {
  const next = cloneStateWithoutReplayPayload(state);
  next.replaySnapshots = state?.replaySnapshots || [];
  next.hanchanReplaySnapshots = state?.hanchanReplaySnapshots || [];
  next.replayInitialState = state?.replayInitialState || null;
  next.hanchanReplayInitialState = state?.hanchanReplayInitialState || null;
  return next;
};
const compactStateForReplay = (state) => {
  if (!state) return state;
  const snapshot = cloneStateWithoutReplayPayload(state);
  snapshot.liveWall = makeHiddenWallForReplay(asArray(state.liveWall).length);
  snapshot.rinshanWall = makeHiddenWallForReplay(asArray(state.rinshanWall).length);
  snapshot.replaySnapshots = undefined;
  snapshot.hanchanReplaySnapshots = undefined;
  snapshot.replayInitialState = undefined;
  snapshot.hanchanReplayInitialState = undefined;
  snapshot.clubPointDbSync = undefined;
  snapshot.replayDbSync = undefined;
  return snapshot;
};
const compactStateForRoomPersistence = (state) => {
  if (!state) return state;
  const snapshot = cloneStateWithoutReplayPayload(state);
  snapshot.liveWall = makeHiddenWallForReplay(asArray(state.liveWall).length);
  snapshot.rinshanWall = makeHiddenWallForReplay(asArray(state.rinshanWall).length);
  return snapshot;
};
const compactInitialStateForSimpleReplay = (state) => {
  if (!state) return state;
  const snapshot = cloneStateWithoutReplayPayload(state);
  snapshot.pendingAction = null;
  snapshot.clubPointDbSync = undefined;
  snapshot.replayDbSync = undefined;
  return snapshot;
};
const compactReplayEvent = (event) => {
  if (!event || typeof event !== "object") return event;
  const {
    tile,
    tiles,
    scoringTile,
    originalTile,
    winningTile,
    displayWinningTile,
    doraIndicators,
    scoreResult,
    ...rest
  } = event;
  return {
    ...rest,
    ...(tile ? { tile } : {}),
    ...(tiles ? { tiles } : {}),
    ...(scoringTile ? { scoringTile } : {}),
    ...(originalTile ? { originalTile } : {}),
    ...(winningTile ? { winningTile } : {}),
    ...(displayWinningTile ? { displayWinningTile } : {}),
    ...(doraIndicators ? { doraIndicators } : {}),
    ...(scoreResult ? { scoreResult } : {}),
  };
};
const buildSimpleReplayPayload = (room, { scope = "hand", initialState = null, events = null, result = null } = {}) => {
  const state = room?.state;
  const baseInitial = initialState || state?.replayInitialState || state;
  if (!room?.tableId || !state?.handLog?.handId || !baseInitial) return null;
  const replayEvents = asArray(events || state.handLog?.events).map(compactReplayEvent);
  return {
    format: "anmika-simple-replay-v1",
    tableId: String(room.tableId),
    gameId: room.gameId || state.gameId || "",
    handId: state.handLog.handId,
    scope,
    ruleId: state.settings?.ruleId || state.settings?.gameType || "anmika-rocket",
    roundLabel: state.handLog.roundLabel || "",
    initialState: compactInitialStateForSimpleReplay(baseInitial),
    events: replayEvents,
    result: result || state.handLog?.result || null,
    wall: {
      initialHands: baseInitial.handLog?.initialHands || null,
      liveWall: asArray(baseInitial.liveWall),
      rinshanWall: asArray(baseInitial.rinshanWall),
      doraIndicators: asArray(baseInitial.doraIndicators),
      uraDoraIndicators: asArray(baseInitial.uraDoraIndicators),
    },
    updatedAt: now(),
  };
};
const replaySnapshotMeaningfulKey = (snapshot) => {
  const result = snapshot?.handLog?.result;
  const pending = snapshot?.pendingAction;
  return [
    snapshot?.handLog?.handId || "",
    snapshot?.phase || "",
    snapshot?.turnIndex ?? 0,
    snapshot?.currentPlayerIndex ?? 0,
    asArray(snapshot?.handLog?.events).length,
    result?.resultId || result?.type || "",
    pending?.type || "",
    pending?.playerId || "",
    asArray(snapshot?.liveWall).length,
    asArray(snapshot?.rinshanWall).length,
  ].join("|");
};
const isReplayAnchorSnapshot = (snapshot, index, snapshots) => {
  const previous = index > 0 ? snapshots[index - 1] : null;
  const next = index + 1 < snapshots.length ? snapshots[index + 1] : null;
  const handId = snapshot?.handLog?.handId || "";
  if (!index) return true;
  if (handId && handId !== (previous?.handLog?.handId || "")) return true;
  if (handId && handId !== (next?.handLog?.handId || "")) return true;
  if (snapshot?.handLog?.result) return true;
  return ["handEnded", "exhaustiveDraw", "gameEnded", "finalResult"].includes(snapshot?.phase);
};
const pickReplaySnapshotsForLimit = (snapshots, limit) => {
  const list = asArray(snapshots).filter(Boolean);
  if (!limit || list.length <= limit) return list;
  const anchors = [];
  const anchorIndexes = new Set();
  list.forEach((snapshot, index) => {
    if (!isReplayAnchorSnapshot(snapshot, index, list)) return;
    anchors.push(snapshot);
    anchorIndexes.add(index);
  });
  if (anchors.length >= limit) return anchors.slice(Math.max(0, anchors.length - limit));
  const remainingSlots = limit - anchors.length;
  const nonAnchors = list.filter((_, index) => !anchorIndexes.has(index));
  const pickedNonAnchors = [];
  if (remainingSlots > 0 && nonAnchors.length) {
    const stride = Math.max(1, Math.ceil(nonAnchors.length / remainingSlots));
    for (let index = 0; index < nonAnchors.length && pickedNonAnchors.length < remainingSlots; index += stride) {
      pickedNonAnchors.push(nonAnchors[index]);
    }
  }
  const picked = new Set([...anchors, ...pickedNonAnchors]);
  return list.filter((snapshot) => picked.has(snapshot));
};
const compactReplaySnapshotList = (snapshots, limit) => pickReplaySnapshotsForLimit(snapshots, limit).map(compactStateForReplay);
const HAND_REPLAY_SNAPSHOT_LIMIT = 260;
const HANCHAN_REPLAY_SNAPSHOT_LIMIT = 12000;
const REPLAY_ANCHOR_SNAPSHOT_LIMIT = 80;
const REPLAY_PAYLOAD_WARNING_BYTES = 2 * 1024 * 1024;
const replayEventTypeForDb = (event = {}) => ({
  draw: "draw",
  discard: "discard",
  riichi: event.feverRiichiActive ? "fever_riichi" : "riichi",
  pon: "pon",
  kan: event.kanType === "ankan" ? "closed_kan" : event.kanType === "kakan" ? "added_kan" : "kan",
  nukiDora: "nuki",
  flowerAnnouncement: "flower",
  ron: "ron",
  tsumo: "tsumo",
  exhaustiveDraw: "exhaustive_draw",
  doraReveal: "dora_reveal",
  resultOk: "result_ok",
  resultOkAuto: "result_ok",
  handStart: "hand_start",
  feverContinuation: "fever_continuation",
})[event?.type] || event?.type || "event";
const replayEventRowsForDb = (replayId, events = []) => ensureArray(events)
  .filter((event) => event && event.type)
  .map((event, index) => ({
    replay_id: replayId,
    sequence: index + 1,
    event_type: replayEventTypeForDb(event),
    actor_player_id: isUuid(event.playerId) ? event.playerId : null,
    payload: event,
  }));
const saveReplayEventsToDb = async (replayId, events = []) => {
  const rows = replayEventRowsForDb(replayId, events);
  if (!rows.length) return false;
  try {
    for (let index = 0; index < rows.length; index += 500) {
      await supabaseRest("/replay_events", {
        method: "POST",
        prefer: "return=minimal",
        body: rows.slice(index, index + 500),
      });
    }
    console.log("[Replay] replay_events saved", { replayId, eventCount: rows.length });
    return true;
  } catch (error) {
    console.warn("[Replay] replay_events skipped. Run supabase/patch_replay_events_event_log.sql if the table is missing.", {
      replayId,
      eventCount: rows.length,
      error: error?.message || String(error),
    });
    return false;
  }
};
const buildRoomReplayPayload = (room) => {
  const state = room?.state;
  if (!room?.tableId || !state?.handLog?.handId) return null;
  const sourceReplaySnapshots = asArray(state.replaySnapshots);
  const sourceHanchanReplaySnapshots = asArray(state.hanchanReplaySnapshots);
  const replaySnapshots = compactReplaySnapshotList(sourceReplaySnapshots, REPLAY_ANCHOR_SNAPSHOT_LIMIT);
  const hanchanReplaySnapshots = compactReplaySnapshotList(sourceHanchanReplaySnapshots, REPLAY_ANCHOR_SNAPSHOT_LIMIT);
  if (!replaySnapshots.length && !hanchanReplaySnapshots.length) return null;
  const isAllRedHanchanReplay = isTsumoLossless3maState(state) && hanchanReplaySnapshots.length > replaySnapshots.length;
  const events = isAllRedHanchanReplay
    ? replayEventsFromSnapshots(sourceHanchanReplaySnapshots)
    : asArray(state.handLog?.events);
  return {
    schemaVersion: 1,
    replayFormat: "event-log-v1",
    tableId: String(room.tableId),
    gameId: room.gameId || state.gameId || "",
    handId: state.handLog.handId,
    roundLabel: state.handLog.roundLabel || "",
    ruleId: state.settings?.ruleId || state.settings?.gameType || "anmika-rocket",
    replayInitialState: state.replayInitialState ? compactStateForReplay(state.replayInitialState) : replaySnapshots[0] || null,
    replaySnapshots,
    hanchanReplayInitialState: state.hanchanReplayInitialState
      ? compactStateForReplay(state.hanchanReplayInitialState)
      : hanchanReplaySnapshots[0] || null,
    hanchanReplaySnapshots,
    events,
    eventCount: events.length,
    simpleReplay: isAllRedHanchanReplay ? null : buildSimpleReplayPayload(room),
    updatedAt: now(),
  };
};
const writeRoomReplayPayload = (room, payload) => {
  if (!room?.tableId || !payload) return;
  const filePath = roomReplayStorePath(room.tableId);
  const backupPath = roomReplayBackupStorePath(room.tableId);
  const tempPath = roomReplayTempStorePath(room.tableId);
  fs.writeFileSync(tempPath, JSON.stringify(payload));
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
  }
  fs.renameSync(tempPath, filePath);
};
const persistRoomReplayJson = (room) => {
  const payload = buildRoomReplayPayload(room);
  if (!payload) return false;
  try {
    writeRoomReplayPayload(room, payload);
    serverDiagnostics.lastReplaySave = {
      target: "local-json",
      ok: true,
      at: isoNow(),
      tableId: room.tableId,
      gameId: room.gameId,
      handId: payload.handId,
      snapshots: payload.replaySnapshots.length,
      hanchanSnapshots: payload.hanchanReplaySnapshots.length,
      fileName: safeStoreFileName(room.tableId),
    };
    return true;
  } catch (error) {
    const exceptionId = logServerException("replay-json:persist", error, {
      tableId: room?.tableId,
      gameId: room?.gameId,
      version: room?.version,
      handId: room?.state?.handLog?.handId,
    });
    logGameStateSyncFailure("replay-json:persist", error, {
      tableId: room?.tableId,
      gameId: room?.gameId,
      version: room?.version,
      exceptionId,
    });
    serverDiagnostics.lastReplaySave = {
      target: "local-json",
      ok: false,
      at: isoNow(),
      tableId: room?.tableId,
      gameId: room?.gameId,
      handId: room?.state?.handLog?.handId || "",
      error: error?.message || String(error),
      exceptionId,
    };
    return false;
  }
};
const hydrateRoomReplayJson = (room) => {
  const state = room?.state;
  if (!room?.tableId || !state) return false;
  state.replaySnapshots = asArray(state.replaySnapshots);
  state.hanchanReplaySnapshots = asArray(state.hanchanReplaySnapshots);
  for (const filePath of [roomReplayStorePath(room.tableId), roomReplayBackupStorePath(room.tableId)]) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (String(payload?.tableId || "") !== String(room.tableId)) continue;
      if (payload?.gameId && room.gameId && String(payload.gameId) !== String(room.gameId)) continue;
      if (payload?.handId && state.handLog?.handId && String(payload.handId) !== String(state.handLog.handId)) continue;
      state.replayInitialState = payload.replayInitialState || state.replayInitialState || null;
      state.replaySnapshots = asArray(payload.replaySnapshots);
      state.hanchanReplayInitialState = payload.hanchanReplayInitialState || state.hanchanReplayInitialState || null;
      state.hanchanReplaySnapshots = asArray(payload.hanchanReplaySnapshots);
      console.log("[ReplayJson] hydrated", {
        tableId: room.tableId,
        gameId: room.gameId,
        handId: state.handLog?.handId,
        replaySnapshots: state.replaySnapshots.length,
        hanchanReplaySnapshots: state.hanchanReplaySnapshots.length,
      });
      return true;
    } catch (error) {
      console.warn("[ReplayJson] hydrate failed", {
        tableId: room?.tableId,
        gameId: room?.gameId,
        file: filePath,
        error: error?.message || String(error),
      });
    }
  }
  return false;
};
const appendServerReplaySnapshot = (state) => {
  if (!state || state.screen !== "game" || !state.handLog?.handId) return;
  const snapshot = compactStateForReplay(state);
  state.replaySnapshots = asArray(state.replaySnapshots);
  const last = state.replaySnapshots.at(-1);
  if (replaySnapshotMeaningfulKey(last) !== replaySnapshotMeaningfulKey(snapshot)) {
    state.replaySnapshots.push(snapshot);
    if (state.replaySnapshots.length > HAND_REPLAY_SNAPSHOT_LIMIT) state.replaySnapshots.splice(0, state.replaySnapshots.length - HAND_REPLAY_SNAPSHOT_LIMIT);
  }
  if (isTsumoLossless3maState(state)) {
    state.hanchanReplaySnapshots = asArray(state.hanchanReplaySnapshots);
    const lastHanchan = state.hanchanReplaySnapshots.at(-1);
    if (replaySnapshotMeaningfulKey(lastHanchan) !== replaySnapshotMeaningfulKey(snapshot)) {
      state.hanchanReplaySnapshots.push(snapshot);
      if (state.hanchanReplaySnapshots.length > HANCHAN_REPLAY_SNAPSHOT_LIMIT) {
        state.hanchanReplaySnapshots = pickReplaySnapshotsForLimit(state.hanchanReplaySnapshots, HANCHAN_REPLAY_SNAPSHOT_LIMIT);
      }
    }
  }
};
const handMarkersFromSnapshots = (snapshots) => {
  const seen = new Set();
  const markers = [];
  asArray(snapshots).forEach((snapshot, index) => {
    const handId = snapshot?.handLog?.handId;
    if (!handId || seen.has(handId)) return;
    seen.add(handId);
    const honba = Number(snapshot?.round?.honba ?? snapshot?.honba ?? 0);
    const baseLabel = snapshot?.handLog?.roundLabel || `局${markers.length + 1}`;
    markers.push({
      handId,
      label: `${baseLabel}${honba > 0 ? `${honba}本場` : ""}`,
      honba,
      index,
    });
  });
  return markers;
};
const replayEventsFromSnapshots = (snapshots) => {
  const events = [];
  const list = asArray(snapshots);
  for (let index = 1; index < list.length; index++) {
    const previous = list[index - 1];
    const current = list[index];
    const previousHandId = previous?.handLog?.handId || "";
    const currentHandId = current?.handLog?.handId || "";
    const previousEvents = asArray(previous?.handLog?.events);
    const currentEvents = asArray(current?.handLog?.events);
    if (currentHandId && previousHandId && currentHandId !== previousHandId) {
      events.push({
        type: "handStart",
        handId: currentHandId,
        roundLabel: current?.handLog?.roundLabel || "",
        initialState: compactStateForReplay(current),
      });
      continue;
    }
    events.push(currentEvents.length > previousEvents.length
      ? (currentEvents[previousEvents.length] || currentEvents.at(-1) || null)
      : (currentEvents.at(-1) || null));
  }
  return events.filter(Boolean).map(compactReplayEvent);
};
const replayRuleName = (ruleId) => ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? "全赤三麻" : "アンミカロケット";
const replayResultSummary = (state, result) => {
  if (!result) return "結果なし";
  const playerName = (playerId) => asArray(state?.players).find((player) => player.id === playerId)?.name || playerId || "";
  const rawPayments = result?.scoreResult?.paymentDeltas || result?.scoreResult?.payments || result?.payments || {};
  const payments = Array.isArray(rawPayments) ? Object.fromEntries(rawPayments.map((item) => [item.playerId, item.delta])) : rawPayments;
  if (result.type === "exhaustiveDraw") {
    const entries = Object.entries(payments).filter(([, delta]) => Number(delta || 0) !== 0);
    return entries.length ? `流局 / ${entries.map(([playerId, delta]) => `${playerName(playerId)} ${Number(delta) > 0 ? "+" : ""}${delta}`).join(" / ")}` : "流局 / 点数移動なし";
  }
  if (result.type === "win") {
    const winLabel = result.winType === "tsumo" ? "ツモ" : "ロン";
    const move = Object.entries(payments).filter(([, delta]) => Number(delta || 0) !== 0)
      .map(([playerId, delta]) => `${playerName(playerId)} ${Number(delta) > 0 ? "+" : ""}${delta}`).join(" / ");
    return `${playerName(result.winnerId)} ${winLabel}${move ? ` / ${move}` : ""}`;
  }
  if (result.type === "gameEnded") return "半荘終了";
  return result.type || "結果";
};
const markReplaySyncApplied = (state, key, replayId = null) => {
  state.replayDbSync ??= { appliedKeys: [], replayIds: {} };
  state.replayDbSync.appliedKeys = [...new Set([...(state.replayDbSync.appliedKeys || []), key])];
  if (replayId) state.replayDbSync.replayIds = { ...(state.replayDbSync.replayIds || {}), [key]: replayId };
};
const hasReplaySyncApplied = (state, key) => asArray(state?.replayDbSync?.appliedKeys).includes(key);
const playerPaymentDeltaFromResult = (result, playerId) => {
  const payments = result?.scoreResult?.paymentDeltas || result?.scoreResult?.payments || result?.payments || {};
  if (Array.isArray(payments)) {
    const found = payments.find((item) => item?.playerId === playerId);
    return Number(found?.delta || 0);
  }
  return Number(payments?.[playerId] || 0);
};
const isReplayCallStatEvent = (event) => {
  if (event?.type === "pon") return true;
  if (event?.type !== "kan") return false;
  return event?.kanType !== "ankan";
};
const countHandsWithEventForPlayer = (events, playerId, predicate) => {
  const handKeys = new Set();
  let currentHandKey = "hand";
  for (const event of asArray(events)) {
    if (event?.type === "handStart") {
      currentHandKey = event.handId || event.roundLabel || `hand-${handKeys.size + 1}`;
      continue;
    }
    if (event?.handId) currentHandKey = event.handId;
    if (event?.playerId === playerId && predicate(event)) handKeys.add(currentHandKey);
  }
  return handKeys.size;
};
const buildPlayerStatRowsForReplay = ({ room, replayId, table, scope, result }) => {
  const state = room?.state;
  const ruleId = state?.settings?.ruleId || state?.settings?.gameType || "anmika-rocket";
  const handEvents = scope === "hanchan"
    ? replayEventsFromSnapshots(state?.hanchanReplaySnapshots?.length ? state.hanchanReplaySnapshots : state?.replaySnapshots)
    : asArray(state?.handLog?.events);
  const socketEvents = asArray(room?.events);
  const handMarkers = scope === "hanchan" ? handMarkersFromSnapshots(state?.hanchanReplaySnapshots || state?.replaySnapshots) : [];
  const handCount = scope === "hanchan" ? Math.max(1, handMarkers.length) : 1;
  const finalSettlement = result?.settlement?.settlements || result?.finalResult?.settlement?.settlements || {};
  const rankedPlayerIds = asArray(result?.settlement?.rankedPlayerIds || result?.finalResult?.settlement?.rankedPlayerIds);
  return asArray(state?.players).map((player) => {
    const playerId = String(player?.id || "");
    const isCpu = player?.type === "cpu" || playerId.startsWith("cpu");
    const riichiEvents = handEvents.filter((event) => event?.playerId === playerId && event?.type === "riichi");
    const callEvents = handEvents.filter((event) => event?.playerId === playerId && isReplayCallStatEvent(event));
    const winEvents = handEvents.filter((event) => event?.playerId === playerId && ["ron", "tsumo"].includes(event?.type));
    const dealInEvents = handEvents.filter((event) => event?.type === "ron" && (event?.loserId === playerId || event?.fromPlayerId === playerId));
    const discardEvents = handEvents.filter((event) => event?.playerId === playerId && event?.type === "discard");
    const drawEvents = handEvents.filter((event) => event?.playerId === playerId && event?.type === "draw");
    const handWithCallCount = Math.min(handCount, countHandsWithEventForPlayer(handEvents, playerId, isReplayCallStatEvent) || (asArray(player?.melds).some((meld) => meld?.type !== "ankan") ? 1 : 0));
    const handWithRiichiCount = Math.min(handCount, countHandsWithEventForPlayer(handEvents, playerId, (event) => event?.type === "riichi") || (player?.isRiichi ? 1 : 0));
    const rank = rankedPlayerIds.length ? rankedPlayerIds.indexOf(playerId) + 1 : null;
    const scoreDelta = scope === "hanchan" && Object.prototype.hasOwnProperty.call(finalSettlement, playerId)
      ? Number(finalSettlement[playerId] || 0)
      : playerPaymentDeltaFromResult(result, playerId);
    return {
      replay_id: replayId,
      club_id: table.club_id,
      table_id: table.table_id,
      game_id: isUuid(room.gameId) ? room.gameId : null,
      rule_id: ruleId,
      scope,
      player_key: playerId,
      user_id: isUuid(playerId) ? playerId : null,
      display_name: player?.name || playerId,
      is_cpu: isCpu,
      hand_count: handCount,
      win_count: result?.type === "win" && result?.winnerId === playerId ? 1 : winEvents.length,
      ron_win_count: result?.type === "win" && result?.winnerId === playerId && result?.winType === "ron" ? 1 : winEvents.filter((event) => event.type === "ron").length,
      tsumo_win_count: result?.type === "win" && result?.winnerId === playerId && result?.winType === "tsumo" ? 1 : winEvents.filter((event) => event.type === "tsumo").length,
      riichi_count: riichiEvents.length || (player?.isRiichi ? 1 : 0),
      call_count: callEvents.length || asArray(player?.melds).length,
      discard_count: discardEvents.length,
      draw_count: drawEvents.length,
      score_delta: scoreDelta,
      final_score: Number(player?.score || 0),
      stat_payload: {
        resultType: result?.type || null,
        winType: result?.winType || null,
        winnerId: result?.winnerId || null,
        loserId: result?.loserId || null,
        dealInCount: result?.type === "win" && result?.winType === "ron" && result?.loserId === playerId ? 1 : dealInEvents.length,
        handWithCallCount,
        handWithRiichiCount,
        hanchanRank: rank > 0 ? rank : null,
        isTobi: scope === "hanchan" && Number(player?.score || 0) <= 0,
        meldCount: asArray(player?.melds).length,
        nukiDoraCount: asArray(player?.nukiDoraTiles).length,
        handEventCount: handEvents.filter((event) => event?.playerId === playerId).length,
        socketEventCount: socketEvents.filter((event) => event?.playerId === playerId).length,
      },
    };
  });
};
const saveReplayStatsToDb = async ({ room, replayId, table, scope, result }) => {
  const rows = buildPlayerStatRowsForReplay({ room, replayId, table, scope, result });
  if (!rows.length) return false;
  try {
    await supabaseRest("/player_replay_stats", {
      method: "POST",
      prefer: "return=minimal",
      body: rows,
    });
    console.log("[ReplayStats] saved", { replayId, rows: rows.length, hasCpu: rows.some((row) => row.is_cpu) });
    return true;
  } catch (error) {
    console.warn("[ReplayStats] skipped or failed. Run supabase/patch_player_replay_stats.sql if the table is missing.", {
      replayId,
      error: error?.message || String(error),
    });
    return false;
  }
};
const saveReplayToDb = async (room, key, scope, { initialState, snapshots, result, summary = {} } = {}) => {
  if (!room?.state || hasReplaySyncApplied(room.state, key)) return false;
  if (!hasSupabaseServerWriter()) {
    if (!room.replaySyncMissingEnvLogged) {
      console.warn("[ReplaySync] SUPABASE_SERVICE_ROLE_KEY is not set. Replay DB sync is skipped.");
      room.replaySyncMissingEnvLogged = true;
    }
    room.state.replayDbSync ??= { appliedKeys: [], replayIds: {} };
    room.state.replayDbSync.lastError = "SUPABASE_SERVICE_ROLE_KEY is not set. Renderの環境変数に設定してください。";
    room.state.replayDbSync.lastErrorAt = now();
    serverDiagnostics.lastReplaySave = {
      target: "supabase",
      ok: false,
      at: isoNow(),
      tableId: room.tableId,
      gameId: room.gameId,
      scope,
      reason: "SUPABASE_SERVICE_ROLE_KEY is not set",
    };
    return false;
  }
  const table = await getRoomTableContext(room);
  if (!table?.club_id) {
    console.warn("[ReplaySync] skipped: table club context is missing", { tableId: room.tableId, gameId: room.gameId });
    room.state.replayDbSync ??= { appliedKeys: [], replayIds: {} };
    room.state.replayDbSync.lastError = "table club context is missing";
    room.state.replayDbSync.lastErrorAt = now();
    serverDiagnostics.lastReplaySave = {
      target: "supabase",
      ok: false,
      at: isoNow(),
      tableId: room.tableId,
      gameId: room.gameId,
      scope,
      reason: "table club context is missing",
    };
    return false;
  }
  const isHanchanReplay = scope === "hanchan";
  const sourceSnapshots = asArray(snapshots);
  const replayEvents = isHanchanReplay
    ? replayEventsFromSnapshots(sourceSnapshots)
    : asArray(room.state?.handLog?.events).length
      ? asArray(room.state.handLog.events)
      : asArray(room.events);
  let compactSnapshots = compactReplaySnapshotList(sourceSnapshots, isHanchanReplay ? REPLAY_ANCHOR_SNAPSHOT_LIMIT : 40);
  const replayId = randomUUID();
  const replayBodyForSnapshots = (snapshotList, retryReason = "") => {
    const simpleReplay = isHanchanReplay ? null : buildSimpleReplayPayload(room, {
      scope,
      initialState: initialState || snapshotList[0] || room.state,
      events: room.state?.handLog?.events,
      result,
    });
    const replaySummary = {
      replayId,
      clubId: table.club_id,
      tableId: table.table_id,
      gameId: room.gameId,
      ruleId: room.state.settings?.ruleId || room.state.settings?.gameType || "anmika-rocket",
      scope,
      startedAt: snapshotList[0]?.handLog?.handId || room.state.handLog?.handId || now(),
      endedAt: now(),
      resultLabel: result?.type === "exhaustiveDraw" ? "流局" : result?.type === "win" ? "和了" : scope === "hanchan" ? "半荘牌譜" : "牌譜",
      ruleName: replayRuleName(room.state.settings?.ruleId || room.state.settings?.gameType || "anmika-rocket"),
      resultSummary: replayResultSummary(room.state, result),
      players: asArray(room.state.players).map((player) => ({ playerId: player.id, name: player.name, finalScore: player.score, type: player.type })),
      handMarkers: handMarkersFromSnapshots(sourceSnapshots.length ? sourceSnapshots : snapshotList),
      replayFormat: "event-log-v1",
      snapshotCount: snapshotList.length,
      eventCount: replayEvents.length,
      eventLogIsPrimary: true,
      ...(retryReason ? { compactedRetry: true, compactedRetryReason: retryReason } : {}),
      ...summary,
    };
    return {
      replay_id: replayId,
      club_id: table.club_id,
      table_id: table.table_id,
      game_id: isUuid(room.gameId) ? room.gameId : null,
      summary: replaySummary,
      initial_state: simpleReplay?.initialState || compactStateForReplay(initialState || snapshotList[0] || room.state),
      events: replayEvents,
      snapshots: snapshotList,
    };
  };
  let replayBody = replayBodyForSnapshots(compactSnapshots);
  const replayPayloadBytes = Buffer.byteLength(JSON.stringify(replayBody));
  console.log("[Replay] event count", { replayId, tableId: room.tableId, gameId: room.gameId, scope, events: replayEvents.length, anchorSnapshots: compactSnapshots.length });
  console.log("[Replay] replay size", { replayId, bytes: replayPayloadBytes });
  if (replayPayloadBytes > REPLAY_PAYLOAD_WARNING_BYTES) {
    console.warn("[Replay] warning: replay payload too large", { replayId, bytes: replayPayloadBytes, events: replayEvents.length, anchorSnapshots: compactSnapshots.length });
  }
  try {
    await supabaseRest("/replays", {
      method: "POST",
      prefer: "return=minimal",
      body: replayBody,
    });
  } catch (error) {
    if (!isHanchanReplay || compactSnapshots.length <= 10) throw error;
    console.warn("[ReplaySync] full hanchan replay save failed; retrying compact payload", {
      tableId: room.tableId,
      gameId: room.gameId,
      snapshots: compactSnapshots.length,
      error: error?.message || String(error),
    });
    compactSnapshots = compactReplaySnapshotList(compactSnapshots, 10);
    replayBody = replayBodyForSnapshots(compactSnapshots, error?.message || "full payload failed");
    await supabaseRest("/replays", {
      method: "POST",
      prefer: "return=minimal",
      body: replayBody,
    });
  }
  await saveReplayEventsToDb(replayId, replayEvents);
  await saveReplayStatsToDb({ room, replayId, table, scope, result });
  markReplaySyncApplied(room.state, key, replayId);
  serverDiagnostics.lastReplaySave = {
    target: "supabase",
    ok: true,
    at: isoNow(),
    tableId: room.tableId,
    gameId: room.gameId,
    replayId,
    scope,
    snapshots: compactSnapshots.length,
  };
  console.log("[ReplaySync] saved", { tableId: room.tableId, gameId: room.gameId, replayId, scope, snapshots: compactSnapshots.length });
  if (!room.skipPersistOnReplaySave) persistRoom(room);
  return true;
};
const queueReplayEffectsSnapshot = (room) => {
  if (!room?.state?.handLog?.result) return;
  const snapshotRoom = {
    ...room,
    state: clone(room.state),
    events: clone(asArray(room.events)),
    sockets: new Map(),
    processedRequestIds: new Set(asArray(room.processedRequestIds)),
    replaySyncInFlight: null,
    skipPersistOnReplaySave: true,
  };
  syncReplayEffects(snapshotRoom).catch((error) => {
    console.error("[ReplaySync] queued snapshot failed", { tableId: room?.tableId, gameId: room?.gameId, error });
  });
};
const syncReplayEffects = async (room) => {
  if (!room?.state || room.replaySyncInFlight) return room?.replaySyncInFlight;
  room.replaySyncInFlight = (async () => {
    const state = room.state;
    const result = state.handLog?.result;
    const handId = state.handLog?.handId || `${room.gameId || room.tableId}-hand-${state.round?.hanchanRoundIndex ?? 0}`;
    if (!result) return;
    if (isTsumoLossless3maState(state)) {
      if (state.phase !== "gameEnded" || !state.finalResult) return;
      const replayRoom = {
        ...room,
        state: clone(state),
        events: clone(asArray(room.events)),
      };
      const replayState = replayRoom.state;
      const hanchanReplayKey = [
        replayRoom.gameId || replayRoom.tableId || "game",
        "hanchanReplay",
        replayState.hanchanReplayInitialState?.handLog?.handId || replayState.hanchanReplaySnapshots?.[0]?.handLog?.handId || replayState.handLog?.handId || replayState.finalResult?.createdAt || replayState.finalResult?.reason || "current",
      ].join(":");
      await saveReplayToDb(replayRoom, hanchanReplayKey, "hanchan", {
        initialState: replayState.hanchanReplayInitialState || replayState.replayInitialState || replayState,
        snapshots: replayState.hanchanReplaySnapshots?.length ? replayState.hanchanReplaySnapshots : replayState.replaySnapshots,
        result: replayState.finalResult,
        summary: {
          resultLabel: "全赤三麻 半荘牌譜",
          finalResult: replayState.finalResult,
        },
      });
      room.state.replayDbSync = replayRoom.state.replayDbSync;
      return;
    }
    if (!["handEnded", "exhaustiveDraw", "gameEnded"].includes(state.phase)) return;
    await saveReplayToDb(room, `${handId}:anmikaReplay`, "hand", {
      initialState: state.replayInitialState || state,
      snapshots: state.replaySnapshots,
      result,
      summary: {
        resultLabel: result.type === "exhaustiveDraw" ? "アンミカロケット 流局" : "アンミカロケット 和了",
        handId,
        roundLabel: state.handLog?.roundLabel || "東場",
      },
    });
  })().catch((error) => {
    const exceptionId = logServerException("replay:sync", error, {
      tableId: room?.tableId,
      gameId: room?.gameId,
      version: room?.version,
      handId: room?.state?.handLog?.handId || "",
    });
    serverDiagnostics.lastReplaySave = {
      target: "supabase",
      ok: false,
      at: isoNow(),
      tableId: room?.tableId,
      gameId: room?.gameId,
      handId: room?.state?.handLog?.handId || "",
      error: error?.message || String(error),
      exceptionId,
    };
    console.error("[ReplaySync] failed", { tableId: room?.tableId, gameId: room?.gameId, exceptionId, error });
  }).finally(() => {
    room.replaySyncInFlight = null;
  });
  return room.replaySyncInFlight;
};
const syncClubPointEffects = async (room) => {
  if (!room?.state) return;
  if (room.clubPointSyncInFlight) return room.clubPointSyncInFlight;
  room.clubPointSyncInFlight = (async () => {
    const state = room.state;
    await syncReplayEffects(room);
    const handId = state.handLog?.handId || `${room.gameId || room.tableId}-hand-${state.round?.hanchanRoundIndex ?? 0}`;
    const result = ensureResultSyncIdentity(state.handLog?.result);
    if (!isTsumoLossless3maState(state) && result?.payments) {
      const rate = Number(state.settings?.pointRate || 1);
      const { deltas: payments, metadata: compensationMetadata } = anmikaClubPointDeltasFromResult(state, result, rate);
      console.log("[ClubPointSync] settlement candidate", {
        tableId: room.tableId,
        gameId: room.gameId,
        handId,
        resultId: result.resultId,
        phase: state.phase,
        payments,
        rake: compensationMetadata.rake,
      });
      await syncOneClubPointEffect(room, makeResultSyncKey(state, room, result, "anmikaSettlement"), "game_settlement", payments, {
        label: "アンミカロケット局精算",
        handId,
        resultId: result.resultId,
        resultType: result.type,
        winnerId: result.winnerId,
        winType: result.winType,
        pointRate: rate,
        ...compensationMetadata,
      });
      await syncAnmikaRakeLogEffect(room, result, rate);
      enforceContinuationPointLimit(room, { timing: "nextHand" })
        .then((insufficient) => {
          if (insufficient?.length) broadcastState(room);
        })
        .catch((error) => console.warn("[PointLimit] async next-hand check failed", { tableId: room.tableId, gameId: room.gameId, error: error?.message || String(error) }));
      return;
    }
    if (!isTsumoLossless3maState(state)) return;
    const entryRake = Number(state.settings?.ruleConfig?.entryRakePoints || 0);
    if (entryRake > 0) {
      const entryRakePlayers = nonCpuPlayersForPointSettlement(state);
      const payments = Object.fromEntries(entryRakePlayers.map((player) => [player.id, -entryRake]));
      const clubReserveDelta = roundClubPointCreditInClubFavor(entryRake * entryRakePlayers.length);
      await syncOneClubPointEffect(room, `${room.gameId}:entryRake`, "entry_rake", payments, {
        label: "半荘開始時レーキ",
        entryRakePoints: entryRake,
        entryRakePlayerCount: entryRakePlayers.length,
        clubReserveDelta,
        rake: {
          type: "entry",
          amountPerPlayer: entryRake,
          totalAmount: clubReserveDelta,
          payerIds: entryRakePlayers.map((player) => player.id),
        },
      });
      await syncEntryRakeLogEffect(room, entryRake);
    }
    const finalSettlement = state.finalResult?.settlement;
    if (state.phase === "gameEnded" && finalSettlement?.settlements) {
      const accumulated = { ...(state.hanchanClubPointPayments || {}) };
      const combined = { ...accumulated };
      for (const [playerId, delta] of Object.entries(finalSettlement.settlements || {})) {
        combined[playerId] = roundToTenth(Number(combined[playerId] || 0) + Number(delta || 0));
      }
      const { deltas, metadata: compensationMetadata } = pointDeltasForRealPlayers(state, combined, 1);
      await syncOneClubPointEffect(room, `${room.gameId}:hanchanSettlement`, "hanchan_settlement", deltas, {
        label: "半荘終了精算",
        finalResult: state.finalResult,
        accumulatedInGamePayments: accumulated,
        ...compensationMetadata,
      });
      enforceContinuationPointLimit(room, { timing: "nextHanchan" })
        .then((insufficient) => {
          if (insufficient?.length) broadcastState(room);
        })
        .catch((error) => console.warn("[PointLimit] async next-hanchan check failed", { tableId: room.tableId, gameId: room.gameId, error: error?.message || String(error) }));
    }
  })().catch((error) => {
    if (room?.state) {
      room.state.clubPointDbSync ??= { appliedKeys: [] };
      room.state.clubPointDbSync.lastError = error?.message || String(error);
      room.state.clubPointDbSync.lastErrorAt = now();
      persistRoom(room);
    }
    console.error("[ClubPointSync] failed", { tableId: room?.tableId, gameId: room?.gameId, error });
  }).finally(() => {
    room.clubPointSyncInFlight = null;
  });
  return room.clubPointSyncInFlight;
};
const safeSyncClubPointEffects = (room, reason = "unspecified") => {
  try {
    return Promise.resolve(syncClubPointEffects(room)).catch((error) => {
      console.error("[ClubPointSync] async failed", {
        reason,
        tableId: room?.tableId,
        gameId: room?.gameId,
        version: room?.version,
        error: error?.message || String(error),
        stack: error?.stack || "",
      });
    });
  } catch (error) {
    console.error("[ClubPointSync] sync failed", {
      reason,
      tableId: room?.tableId,
      gameId: room?.gameId,
      version: room?.version,
      error: error?.message || String(error),
      stack: error?.stack || "",
    });
    return null;
  }
};
const queueResultSideEffectsOnce = (room, resultId, reason = "resultOk") => {
  if (!room?.state || !resultId) return false;
  room.resultSideEffectQueuedIds ??= new Set();
  if (room.resultSideEffectQueuedIds.has(resultId)) return false;
  room.resultSideEffectQueuedIds.add(resultId);
  room.resultPointSyncResultId = resultId;
  queueReplayEffectsSnapshot(room);
  setTimeout(() => {
    try {
      safeSyncClubPointEffects(room, reason);
    } catch (error) {
      console.error("[ResultOk] side effects queue failed", {
        reason,
        tableId: room?.tableId,
        gameId: room?.gameId,
        resultId,
        error: error?.message || String(error),
      });
    }
  }, 0);
  return true;
};

const ACTION_TYPES = new Set(["draw", "discard", "ron", "tsumo", "pon", "kan", "riichi", "skip", "flower", "nukiDora", "resultOk", "agariYame", "declareLastHand", "assistSettings"]);
const GUARDED_ACTION_TYPES = new Set(["discard", "ron", "tsumo", "pon", "kan", "riichi", "flower", "nukiDora"]);
const RESULT_AUTO_OK_DELAY_MS = 15000;
const getCurrentResultId = (state) => state?.handLog?.result?.resultId || "";
const resetResultCountdownState = (state) => {
  if (!state) return;
  state.resultCountdownStartedAt = null;
  state.resultCountdownSeconds = null;
  state.resultAutoCloseHandled = false;
  state.resultOkPlayerIds = [];
  state.resultCountdownResultId = "";
  state.resultAutoCloseHandledResultId = "";
};
const startResultCountdownState = (state) => {
  if (!state) return;
  const resultId = getCurrentResultId(state);
  state.resultCountdownStartedAt = Date.now();
  state.resultCountdownSeconds = Math.ceil(RESULT_AUTO_OK_DELAY_MS / 1000);
  state.resultAutoCloseHandled = false;
  state.resultOkPlayerIds = [];
  state.resultCountdownResultId = resultId;
  state.resultAutoCloseHandledResultId = "";
};

const DEFAULT_RULE_CONFIG = {
  rocket19Enabled: true,
  baibaEnabled: true,
  otokogiEnabled: true,
  feverRiichiEnabled: true,
  turquoise5pCount: 2,
};
const TSUMO_LOSSLESS_3MA_RULE_ID = "tsumo-lossless-red-3ma";
const DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG = {
  fiveTileComposition: "red3blue1",
  flowerComposition: "red3blue1",
  entryRakePoints: 5,
  northNukiDoraEnabled: false,
  umaType: "20-0--20",
  chipValuePoints: 5000,
  startingScore: 35000,
  rounds: ["east1", "east2", "east3", "south1", "south2", "south3"],
  pointRateUnit: "per1000",
  noTsumoLoss: true,
  settlementTiming: "hanchan",
};

const normalizeRuleConfig = (config = {}) => ({
  ...DEFAULT_RULE_CONFIG,
  ...(config || {}),
  turquoise5pCount: [0, 1, 2].includes(Number(config?.turquoise5pCount)) ? Number(config.turquoise5pCount) : DEFAULT_RULE_CONFIG.turquoise5pCount,
});
const normalizeTsumoLossless3maRuleConfig = (config = {}) => ({
  ...DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG,
  ...(config || {}),
  fiveTileComposition: ["red3blue1", "red4", "red2blue2", "blackBlackRedRed"].includes(config?.fiveTileComposition) ? config.fiveTileComposition : "red3blue1",
  flowerComposition: ["red3blue1", "red4", "red2blue2"].includes(config?.flowerComposition) ? config.flowerComposition : "red3blue1",
  entryRakePoints: Math.max(0.1, Math.min(10, Number(config?.entryRakePoints ?? 5))),
  chipValuePoints: [2000, 5000, 10000].includes(Number(config?.chipValuePoints)) ? Number(config.chipValuePoints) : 5000,
  northNukiDoraEnabled: Boolean(config?.northNukiDoraEnabled),
  umaType: ["20-0--20", "30-0--30", "20-10--30"].includes(config?.umaType) ? config.umaType : "20-0--20",
});
const normalizeRuleConfigForRule = (ruleId, config = {}) =>
  ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? normalizeTsumoLossless3maRuleConfig(config) : normalizeRuleConfig(config);

const isTsumoLossless3maState = (state) =>
  state?.settings?.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID || state?.settings?.gameType === TSUMO_LOSSLESS_3MA_RULE_ID;
const startingScoreForRule = (ruleId, ruleConfig = {}) =>
  ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? Number(ruleConfig?.startingScore ?? DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG.startingScore) : 0;
const isNorthNukiTile = (state, tile) =>
  isTsumoLossless3maState(state) && Boolean(state?.settings?.ruleConfig?.northNukiDoraEnabled) && tile?.suit === "honor" && tile?.kind === "north";
const isNukiDoraTileForState = (state, tile) => isFlowerTile(tile) || isNorthNukiTile(state, tile);
const TSUMO_LOSSLESS_ROUNDS = ["東1局", "東2局", "東3局", "南1局", "南2局", "南3局"];
const parseUmaValues = (umaType = "20-0--20") => {
  if (umaType === "30-0--30") return [30, 0, -30];
  if (umaType === "20-10--30") return [20, 10, -30];
  return [20, 0, -20];
};
const playerOrderIndex = (state, playerId) => {
  const order = ensureArray(state?.round?.initialSeatOrder);
  const index = order.indexOf(playerId);
  return index >= 0 ? index : Math.max(0, ensureArray(state?.players).findIndex((player) => player.id === playerId));
};
const getTsumoLosslessRoundIndex = (state) => Math.max(0, Math.min(5, Number(state?.round?.hanchanRoundIndex ?? 0)));
const getTsumoLosslessDealerIdForRound = (state, roundIndex = getTsumoLosslessRoundIndex(state)) => {
  const order = ensureArray(state?.round?.initialSeatOrder).length ? state.round.initialSeatOrder : ensureArray(state?.players).map((player) => player.id);
  return order[roundIndex % 3] || ensureArray(state?.players)[0]?.id || "";
};
const isTsumoLosslessHanchanFinished = (state) => {
  if (!isTsumoLossless3maState(state)) return false;
  if (ensureArray(state.players).some((player) => Number(player.score || 0) <= 0)) return true;
  return getTsumoLosslessRoundIndex(state) >= TSUMO_LOSSLESS_ROUNDS.length - 1;
};
const isTsumoLosslessDealerContinuation = (state, result) => {
  if (!isTsumoLossless3maState(state)) return false;
  const dealerId = state?.round?.dealerPlayerId || "";
  if (!dealerId || !result) return false;
  if (result.type === "win") return result.winnerId === dealerId;
  if (result.type === "exhaustiveDraw") return ensureArray(result.tenpaiPlayerIds).includes(dealerId);
  return false;
};
const isTsumoLosslessAgariYameOpportunity = (state, result = state?.handLog?.result) =>
  isTsumoLossless3maState(state) &&
  getTsumoLosslessRoundIndex(state) >= TSUMO_LOSSLESS_ROUNDS.length - 1 &&
  isTsumoLosslessDealerContinuation(state, result) &&
  !ensureArray(state.players).some((player) => Number(player.score || 0) <= 0);
const shouldEndTsumoLosslessHanchanAfterResult = (state, result) => {
  if (!isTsumoLossless3maState(state)) return false;
  if (ensureArray(state.players).some((player) => Number(player.score || 0) <= 0)) return true;
  if (getTsumoLosslessRoundIndex(state) < TSUMO_LOSSLESS_ROUNDS.length - 1) return false;
  return !isTsumoLosslessDealerContinuation(state, result);
};
const rankTsumoLosslessPlayers = (state) =>
  [...ensureArray(state.players)].sort((a, b) => {
    const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return playerOrderIndex(state, a.id) - playerOrderIndex(state, b.id);
  });
const calculateTsumoLosslessFinalSettlement = (state) => {
  const rate = Number(state?.settings?.pointRate || 1);
  const uma = parseUmaValues(state?.settings?.ruleConfig?.umaType);
  const ranked = rankTsumoLosslessPlayers(state);
  const settlements = {};
  const details = [];
  let lowerTotal = 0;
  ranked.forEach((player, rankIndex) => {
    if (rankIndex === 0) return;
    const raw = Number(player.score || 0) / 1000 - 40 + Number(uma[rankIndex] || 0);
    const pointDelta = roundToTenth(raw * rate);
    settlements[player.id] = pointDelta;
    lowerTotal += pointDelta;
    details.push({ playerId: player.id, rank: rankIndex + 1, score: Number(player.score || 0), uma: uma[rankIndex] || 0, raw, pointDelta });
  });
  if (ranked[0]) {
    settlements[ranked[0].id] = roundToTenth(-lowerTotal);
    details.unshift({ playerId: ranked[0].id, rank: 1, score: Number(ranked[0].score || 0), uma: uma[0] || 0, raw: null, pointDelta: settlements[ranked[0].id] });
  }
  return { type: "hanchanSettlement", rate, umaType: state?.settings?.ruleConfig?.umaType || "20-0--20", rankedPlayerIds: ranked.map((player) => player.id), settlements, details };
};
const getNextHanchanSeatOrder = (state) => {
  const order = ensureArray(state?.round?.initialSeatOrder).length ? state.round.initialSeatOrder : ensureArray(state?.players).map((player) => player.id);
  return order.length ? [...order.slice(1), order[0]] : [];
};
const getChipPointValue = (state) => {
  const chipValuePoints = Number(state?.settings?.ruleConfig?.chipValuePoints || 5000);
  const rate = Number(state?.settings?.pointRate || 1);
  return roundToTenth((chipValuePoints / 1000) * rate);
};
const calculateTsumoLosslessChipSettlement = (state, winner, winType, loserId, scoreResult) => {
  if (!isTsumoLossless3maState(state)) return null;
  const yakuNames = new Set(ensureArray(scoreResult?.yakuList || scoreResult?.yaku).map((item) => item.name));
  const blueChips = ensureArray(scoreResult?.winningTiles).filter((tile) => tile?.color === "blue" || tile?.isRocket).length + ensureArray(winner?.nukiDoraTiles).filter((tile) => tile?.color === "blue").length;
  const ippatsuChips = yakuNames.has("一発") ? 1 : 0;
  const uraChips = Number(scoreResult?.dora?.ura || 0);
  const yakumanChips = ensureArray(scoreResult?.yakuList || scoreResult?.yaku).some((item) => item.isYakuman && !item.isCountedYakuman) ? (winType === "tsumo" ? 5 : 10) : 0;
  const chipsPerPayer = blueChips + ippatsuChips + uraChips + yakumanChips;
  const chipPoint = getChipPointValue(state);
  const pointPerPayer = roundToTenth(chipsPerPayer * chipPoint);
  const payments = Object.fromEntries(ensureArray(state.players).map((player) => [player.id, 0]));
  if (pointPerPayer !== 0) {
    if (winType === "tsumo") {
      for (const player of ensureArray(state.players)) {
        if (player.id === winner.id) continue;
        payments[player.id] -= pointPerPayer;
        payments[winner.id] += pointPerPayer;
      }
    } else if (loserId) {
      payments[loserId] -= pointPerPayer;
      payments[winner.id] += pointPerPayer;
    }
  }
  return { type: "chipSettlement", chipPoint, chipsPerPayer, blueChips, ippatsuChips, uraChips, yakumanChips, pointPerPayer, payments };
};
const calculateTsumoLosslessTobiPrize = (state, winnerId, winType, loserId) => {
  if (!isTsumoLossless3maState(state)) return null;
  const chipPoint = getChipPointValue(state);
  const prize = roundToTenth(chipPoint * 2);
  if (prize <= 0) return null;
  const payments = Object.fromEntries(ensureArray(state.players).map((player) => [player.id, 0]));
  const recipientFor = (payerId) => {
    if (winnerId) return winnerId;
    const order = ensureArray(state.round?.initialSeatOrder).length ? state.round.initialSeatOrder : ensureArray(state.players).map((player) => player.id);
    const index = order.indexOf(payerId);
    return order[(index + 1 + order.length) % order.length] || winnerId;
  };
  const entries = [];
  for (const player of ensureArray(state.players)) {
    if (Number(player.score || 0) > 0) continue;
    const recipient = winType === "ron" && loserId === player.id ? winnerId : recipientFor(player.id);
    if (!recipient || recipient === player.id) continue;
    payments[player.id] -= prize;
    payments[recipient] += prize;
    entries.push({ payerId: player.id, recipientId: recipient, points: prize });
  }
  return entries.length ? { type: "tobiPrize", chipPoint, prizeChips: 2, payments, entries } : null;
};
const accumulateTsumoLosslessClubPointPayments = (state, payments = {}) => {
  if (!isTsumoLossless3maState(state)) return;
  state.hanchanClubPointPayments ??= {};
  for (const [playerId, delta] of Object.entries(payments || {})) {
    const value = Number(delta || 0);
    if (!value) continue;
    state.hanchanClubPointPayments[playerId] = roundToTenth(Number(state.hanchanClubPointPayments[playerId] || 0) + value);
  }
};
const awardTsumoLosslessRiichiSticks = (state, winnerId) => {
  if (!isTsumoLossless3maState(state) || !winnerId) return 0;
  const count = Number(state.riichiStickCount || 0);
  const points = count * 1000;
  if (points <= 0) return 0;
  const winner = findPlayer(state, winnerId);
  if (!winner) return 0;
  winner.score = Number(winner.score || 0) + points;
  state.riichiStickCount = 0;
  return points;
};
const topPlayerIdForTsumoLossless = (state) =>
  [...ensureArray(state.players)].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0]?.id || "";
const applyTsumoLosslessRoundAdvance = (state, result) => {
  if (!isTsumoLossless3maState(state)) return;
  state.round ??= {};
  const dealerContinues = isTsumoLosslessDealerContinuation(state, result);
  const isDraw = result?.type === "exhaustiveDraw";
  state.round.honba = Number(state.round.honba || 0);
  if (dealerContinues || isDraw) state.round.honba += 1;
  else state.round.honba = 0;
  if (!dealerContinues) state.round.hanchanRoundIndex = getTsumoLosslessRoundIndex(state) + 1;
};
const applyAnmikaRoundAdvance = (state, result) => {
  if (!state || isTsumoLossless3maState(state)) return;
  state.round ??= {};
  const dealerId = state.round.dealerPlayerId || ensureArray(state.players)[0]?.id || "";
  const winnerIds = result?.type === "win" ? [result.winnerId, ...ensureArray(result.winners)].filter(Boolean) : [];
  const dealerWon = winnerIds.includes(dealerId);
  const isDraw = result?.type === "exhaustiveDraw";
  state.round.honba = dealerWon || isDraw ? Number(state.round.honba || 0) + 1 : 0;
};
const prepareTsumoLosslessGameEnd = (state, reason = "hanchanEnd") => {
  const riichiStickWinnerId = topPlayerIdForTsumoLossless(state);
  const riichiStickPoints = awardTsumoLosslessRiichiSticks(state, riichiStickWinnerId);
  state.pendingAction = null;
  state.phase = "gameEnded";
  state.isWaitingForHumanAction = false;
  state.activeClockPlayerId = null;
  state.clockStartedAt = null;
  state.finalResult = {
    type: "hanchanEnd",
    reason,
    finalScores: Object.fromEntries(ensureArray(state.players).map((player) => [player.id, Number(player.score || 0)])),
    settlement: calculateTsumoLosslessFinalSettlement(state),
    riichiStickAward: riichiStickPoints > 0 ? { winnerId: riichiStickWinnerId, points: riichiStickPoints } : null,
    nextHanchanSeatOrder: getNextHanchanSeatOrder(state),
  };
  state.handLog ??= {};
  state.handLog.result ??= { type: "gameEnded", reason };
  state.handLog.result.finalResult = state.finalResult;
  if (riichiStickPoints > 0) {
    state.handLog.result.riichiStickAward = { winnerId: riichiStickWinnerId, points: riichiStickPoints };
  }
  return state;
};

const isFlowerTile = (tile) => tile?.suit === "flower";
const currentPlayer = (state) => state?.players?.[state.currentPlayerIndex ?? 0] ?? null;
const findPlayer = (state, playerId) => state?.players?.find((player) => player.id === playerId) ?? null;
const ensureArray = (value) => Array.isArray(value) ? value : [];
const replayPlayerIdentity = (state, playerId) => {
  if (!playerId) return {};
  const seatIndex = ensureArray(state?.players).findIndex((player) => player.id === playerId);
  const player = seatIndex >= 0 ? state.players[seatIndex] : null;
  return {
    playerId,
    playerSeatIndex: seatIndex >= 0 ? seatIndex : null,
    playerName: player?.name || "",
    playerType: player?.type || "",
  };
};
const appendHandEvent = (state, event) => {
  state.handLog ??= {};
  state.handLog.events ??= [];
  const enriched = {
    ...event,
    ...(event?.playerId ? replayPlayerIdentity(state, event.playerId) : {}),
    ...(event?.fromPlayerId ? {
      fromPlayerSeatIndex: ensureArray(state?.players).findIndex((player) => player.id === event.fromPlayerId),
      fromPlayerName: findPlayer(state, event.fromPlayerId)?.name || "",
    } : {}),
  };
  state.handLog.events.push(enriched);
  console.log("[Replay] event recorded", {
    type: enriched.type,
    playerId: enriched.playerId || "",
    handId: state.handLog.handId || "",
    turnIndex: enriched.turnIndex ?? state.turnIndex ?? 0,
    eventCount: state.handLog.events.length,
  });
};
const PAO_YAKUMAN_KEYS = {
  "大三元": ["honor:white", "honor:green", "honor:red"],
  "大四喜": ["honor:east", "honor:south", "honor:west", "honor:north"],
};
const paoTargetYakumanNames = (yaku = []) => ensureArray(yaku)
  .filter((item) => item?.isYakuman && (item.name === "大三元" || item.name === "大四喜"))
  .map((item) => item.name);
const concealedTripletKeysForServerPao = (player) => {
  const counts = new Map();
  for (const tile of ensureArray(player?.hand)) {
    if (isFlowerTile(tile)) continue;
    const key = tileKindKey(tile);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count >= 3).map(([key]) => key);
};
const tripletKeysForServerPao = (player) => {
  const keys = new Set(concealedTripletKeysForServerPao(player));
  for (const meld of ensureArray(player?.melds)) {
    if (!["pon", "minkan", "ankan", "kakan"].includes(meld?.type)) continue;
    const tile = ensureArray(meld.tiles)[0];
    if (tile) keys.add(tileKindKey(tile));
  }
  return keys;
};
const getServerPaoResponsibility = (state, winnerId, yaku = []) => {
  const responsibilities = ensureArray(state?.paoResponsibilities?.[winnerId]);
  const names = paoTargetYakumanNames(yaku);
  return responsibilities.find((entry) => names.includes(entry?.yakumanName) && entry?.responsiblePlayerId) || null;
};
const rewritePaymentsToServerPao = (state, payments, winnerId, responsiblePlayerId) => {
  if (!winnerId || !responsiblePlayerId || winnerId === responsiblePlayerId) return payments;
  const source = { ...(payments || {}) };
  const winnerGain = Number(source[winnerId] || 0);
  if (!Number.isFinite(winnerGain) || winnerGain === 0) return payments;
  const next = Object.fromEntries(ensureArray(state?.players).map((player) => [player.id, 0]));
  next[winnerId] = winnerGain;
  next[responsiblePlayerId] = -winnerGain;
  return next;
};
const applyServerPaoToScoreResult = (state, winner, scoreResult) => {
  const pao = getServerPaoResponsibility(state, winner?.id, scoreResult?.yaku || scoreResult?.yakuList || []);
  if (!pao) return null;
  scoreResult.pao = {
    ...pao,
    winnerId: winner.id,
    text: `${pao.yakumanName} パオ`,
  };
  scoreResult.payments = rewritePaymentsToServerPao(state, scoreResult.payments, winner.id, pao.responsiblePlayerId);
  scoreResult.paymentDeltas = Object.entries(scoreResult.payments).map(([playerId, delta]) => ({ playerId, delta }));
  scoreResult.winnerGain = Number(scoreResult.payments[winner.id] || 0);
  return scoreResult.pao;
};
const applyServerPaoToExtraSettlement = (state, winner, settlement, pao) => {
  if (!pao || !settlement?.payments) return settlement;
  settlement.payments = rewritePaymentsToServerPao(state, settlement.payments, winner.id, pao.responsiblePlayerId);
  settlement.pao = { ...pao };
  return settlement;
};
const updateServerPaoResponsibilityAfterOpenMeld = (state, player, meld, fromPlayerId) => {
  if (!state || !player || !meld || !fromPlayerId || fromPlayerId === player.id) return null;
  if (!["pon", "minkan"].includes(meld.type)) return null;
  const calledKey = tileKindKey(ensureArray(meld.tiles)[0]);
  const tripletKeys = tripletKeysForServerPao(player);
  for (const [yakumanName, keys] of Object.entries(PAO_YAKUMAN_KEYS)) {
    if (!keys.includes(calledKey)) continue;
    if (!keys.every((key) => tripletKeys.has(key))) continue;
    state.paoResponsibilities ??= {};
    const existing = ensureArray(state.paoResponsibilities[player.id]).find((entry) => entry.yakumanName === yakumanName);
    if (existing) return null;
    const entry = {
      yakumanName,
      winnerId: player.id,
      responsiblePlayerId: fromPlayerId,
      calledTile: ensureArray(meld.tiles)[0] || null,
      meldType: meld.type,
      turnIndex: state.turnIndex ?? 0,
    };
    state.paoResponsibilities[player.id] = [...ensureArray(state.paoResponsibilities[player.id]), entry];
    appendHandEvent(state, { type: "pao", playerId: player.id, responsiblePlayerId: fromPlayerId, yakumanName, tile: entry.calledTile, turnIndex: state.turnIndex ?? 0 });
    return entry;
  }
  return null;
};
const drawFromWall = (state, player, source = "liveWall") => {
  const wall = source === "rinshanWall" ? state.rinshanWall : state.liveWall;
  if (!Array.isArray(wall) || wall.length === 0) return null;
  const tile = wall.shift();
  player.drawnTile = tile;
  state.lastDrawnTile = tile;
  if (source === "rinshanWall" && state.pendingRinshanKaihouFromKan) {
    state.rinshanKaihou = { playerId: player.id, tileId: tile.id };
    state.pendingRinshanKaihouFromKan = false;
  } else if (source !== "rinshanWall") {
    state.rinshanKaihou = null;
    state.pendingRinshanKaihouFromKan = false;
  }
  appendHandEvent(state, { type: "draw", playerId: player.id, tile, from: source, turnIndex: state.turnIndex ?? 0 });
  return tile;
};
const isServerRinshanKaihouTsumo = (state, player, tile) => {
  if (!state?.rinshanKaihou || !player?.drawnTile || !tile) return false;
  return state.rinshanKaihou.playerId === player.id &&
    state.rinshanKaihou.tileId === tile.id &&
    player.drawnTile.id === tile.id;
};
const hasLiveWallAfterCurrentDraw = (state) => ensureArray(state?.liveWall).length > 0;
const canServerDeclareKanNow = (state) =>
  Number(state?.kanCount || 0) < 4 &&
  ensureArray(state?.rinshanWall).length > 0 &&
  hasLiveWallAfterCurrentDraw(state);
const removeTileById = (tiles, tileId) => {
  const index = ensureArray(tiles).findIndex((tile) => tile.id === tileId);
  if (index < 0) return null;
  return tiles.splice(index, 1)[0];
};
const tileKindKey = (tile) => {
  if (!tile) return "";
  if (tile.suit === "honor" || tile.suit === "flower") return `${tile.suit}:${tile.kind}`;
  return `${tile.suit}:${tile.rank}`;
};
const sameTileKind = (a, b) => tileKindKey(a) === tileKindKey(b);
const combinedHandTiles = (player) => [...ensureArray(player?.hand), ...(player?.drawnTile ? [player.drawnTile] : [])];
const findFourOfAKindTile = (tiles) => {
  const buckets = new Map();
  for (const tile of ensureArray(tiles)) {
    const key = tileKindKey(tile);
    if (!key) continue;
    const next = buckets.get(key) || [];
    next.push(tile);
    buckets.set(key, next);
  }
  return [...buckets.values()].find((bucket) => bucket.length >= 4)?.[0] || null;
};
const fourOfAKindTiles = (tiles, targetTile = null) => {
  const buckets = new Map();
  for (const tile of ensureArray(tiles)) {
    const key = tileKindKey(tile);
    if (!key) continue;
    const next = buckets.get(key) || [];
    next.push(tile);
    buckets.set(key, next);
  }
  const groups = [...buckets.values()].filter((bucket) => bucket.length >= 4);
  if (!targetTile) return groups;
  const targetKey = tileKindKey(targetTile);
  return groups.filter((bucket) => tileKindKey(bucket[0]) === targetKey);
};
const isRiichiSafeAnkanTile = (player, kanTile) => {
  if (!player?.isRiichi || !kanTile) return true;
  const before = getWinningTilesForServerTenpai({ ...player, drawnTile: null }).map(tileKindKey).sort().join("|");
  const remaining = combinedHandTiles(player)
    .filter((tile) => !isFlowerTile(tile))
    .filter((tile) => tileKindKey(tile) !== tileKindKey(kanTile));
  const afterPlayer = {
    ...player,
    hand: remaining,
    drawnTile: null,
    melds: [...ensureArray(player.melds), { type: "ankan", tiles: fourOfAKindTiles(combinedHandTiles(player), kanTile)[0] || [] }],
  };
  const after = getWinningTilesForServerTenpai(afterPlayer).map(tileKindKey).sort().join("|");
  return Boolean(before && before === after);
};
const findServerAnkanCandidate = (player, { allowRiichi = false } = {}) => {
  for (const group of fourOfAKindTiles(combinedHandTiles(player).filter((tile) => !isFlowerTile(tile)))) {
    const tile = group[0];
    if (!player?.isRiichi || (allowRiichi && isRiichiSafeAnkanTile(player, tile))) return tile;
  }
  return null;
};
const findServerKakanCandidate = (player) => {
  for (const meld of ensureArray(player?.melds)) {
    if (meld?.type !== "pon" || !meld?.tiles?.[0]) continue;
    const tile = combinedHandTiles(player).find((item) => sameTileKind(item, meld.tiles[0]) && !isFlowerTile(item));
    if (tile) return { tile, meld };
  }
  return null;
};
const removeLastMatchingDiscard = (state, fromPlayerId, sourceTile) => {
  const fromPlayer = findPlayer(state, fromPlayerId);
  if (!fromPlayer?.discardedTiles?.length) return null;
  for (let index = fromPlayer.discardedTiles.length - 1; index >= 0; index--) {
    const discard = fromPlayer.discardedTiles[index];
    if (sameTileKind(discard.tile, sourceTile)) {
      return fromPlayer.discardedTiles.splice(index, 1)[0]?.tile || null;
    }
  }
  return null;
};
const setServerPendingActions = (state, playerId, options, source = null) => {
  if (!playerId || !ensureArray(options).length) return false;
  const player = findPlayer(state, playerId);
  const filteredOptions = player?.assistSettings?.noCall
    ? ensureArray(options).filter((option) => !(option.type === "pon" || option.type === "kan"))
    : ensureArray(options);
  if (!filteredOptions.length) return false;
  state.pendingAction = { playerId, options: filteredOptions, source };
  state.phase = "waitingForAction";
  state.isWaitingForHumanAction = true;
  state.activeClockPlayerId = playerId;
  state.clockStartedAt = Date.now();
  state.lastClockRenderTick = null;
  appendHandEvent(state, {
    type: "pendingAction",
    playerId,
    options: filteredOptions.map((option) => option.type),
    source,
    turnIndex: state.turnIndex ?? 0,
  });
  return true;
};
const isServerMultiRonPending = (pending) => pending?.type === "multiRon";
const setServerPendingMultiRonActions = (state, ronOptions, source = null) => {
  const options = ensureArray(ronOptions).filter((option) => option?.type === "ron" && option.playerId);
  if (!options.length) return false;
  const playerIds = [...new Set(options.map((option) => option.playerId))];
  state.pendingAction = {
    type: "multiRon",
    playerIds,
    optionsByPlayerId: Object.fromEntries(playerIds.map((playerId) => [playerId, options.filter((option) => option.playerId === playerId)])),
    responses: {},
    source,
  };
  state.phase = "waitingForAction";
  state.isWaitingForHumanAction = true;
  state.activeClockPlayerId = playerIds[0] || null;
  state.clockStartedAt = Date.now();
  state.lastClockRenderTick = null;
  appendHandEvent(state, {
    type: "pendingMultiRon",
    playerIds,
    source,
    turnIndex: state.turnIndex ?? 0,
  });
  return true;
};
const hasTurquoise5pInHandOrMeldsServer = (player) => {
  const tiles = [
    ...combinedHandTiles(player),
    ...ensureArray(player?.melds).flatMap((meld) => ensureArray(meld.tiles)),
  ];
  return tiles.some((tile) => tile?.suit === "pinzu" && Number(tile.rank) === 5 && tile.color === "turquoise");
};
const hasTurquoise5pInTilesOrMeldsServer = (tiles, melds) =>
  [
    ...ensureArray(tiles),
    ...ensureArray(melds).flatMap((meld) => ensureArray(meld.tiles)),
  ].some((tile) => tile?.suit === "pinzu" && Number(tile.rank) === 5 && tile.color === "turquoise");
const isServerMenzen = (player) => !ensureArray(player?.melds).some((meld) => ["pon", "minkan", "kakan"].includes(meld?.type));
const getServerSeatWind = (state, playerId) => {
  const players = ensureArray(state?.players);
  const dealerIndex = Math.max(0, players.findIndex((player) => player.id === state?.round?.dealerPlayerId));
  const playerIndex = Math.max(0, players.findIndex((player) => player.id === playerId));
  return ["east", "south", "west"][(playerIndex - dealerIndex + players.length) % players.length] || "west";
};
const serverHonorText = { east: "東", south: "南", west: "西", north: "北", white: "白", green: "發", red: "中" };
const serverTileLabel = (key) => {
  const [suit, value] = String(key || "").split(":");
  if (suit === "honor") return serverHonorText[value] || value || key;
  const suffix = suit === "manzu" ? "m" : suit === "pinzu" ? "p" : suit === "souzu" ? "s" : "";
  return `${value}${suffix}`;
};
const getServerYakuhaiHan = (key, seatWind, roundWind = "east") => {
  const always = new Set(["honor:white", "honor:green", "honor:red", "honor:east", "honor:north"]);
  let han = always.has(key) ? 1 : 0;
  if (key === `honor:${seatWind}`) han += 1;
  if (key === `honor:${roundWind}` && roundWind !== "east") han += 1;
  return han;
};
const isServerTanyao = (tiles) => ensureArray(tiles).every((tile) =>
  tile.suit !== "honor" && tile.suit !== "flower" && Number(tile.rank) >= 2 && Number(tile.rank) <= 8
);
const getServerTripletKeys = (counts, melds = []) => {
  const keys = new Set();
  for (const [key, count] of counts.entries()) if (count >= 3) keys.add(key);
  for (const meld of ensureArray(melds)) {
    if (["pon", "minkan", "ankan", "kakan"].includes(meld?.type) && meld?.tiles?.[0]) keys.add(tileKindKey(meld.tiles[0]));
  }
  return [...keys];
};
const serverTerminalHonorKeys = new Set([
  "manzu:1", "manzu:9", "pinzu:1", "pinzu:9", "souzu:1", "souzu:9",
  "honor:east", "honor:south", "honor:west", "honor:north", "honor:white", "honor:green", "honor:red",
]);
const isServerTerminalOrHonorTile = (tile) => serverTerminalHonorKeys.has(tileKindKey(tile));
const isServerNagashiYakumanPlayer = (player) => {
  const discards = ensureArray(player?.discardedTiles).map((entry) => entry?.tile || entry).filter(Boolean);
  return discards.length > 0 && discards.every(isServerTerminalOrHonorTile);
};
const isServerWhitePochiTile = (tile) => tile?.suit === "honor" && tile?.kind === "white" && tile?.isPochi;
const isServerBaibaTriggerTile = (tile) => Boolean(
  tile &&
  (
    tile.isRocket ||
    tile.isPochi ||
    tile.pochiColor ||
    tile.color === "gold" ||
    tile.color === "blue" ||
    tile.color === "turquoise"
  )
);
const getServerBaibaMultiplierDetails = (state, { includeUra = false, pochiColor = null } = {}) => {
  const enabled = Boolean(state?.settings?.ruleConfig?.baibaEnabled);
  const hasBaiba = enabled && ensureArray(state.doraIndicators).some(isServerBaibaTriggerTile);
  const hasSpecialUra = enabled && includeUra && ensureArray(state.uraDoraIndicators).some(isServerBaibaTriggerTile);
  const hasRedOrBluePochiTsumo = enabled && (pochiColor === "red" || pochiColor === "blue");
  const conditionCount = Number(hasBaiba) + Number(hasSpecialUra) + Number(hasRedOrBluePochiTsumo);
  return {
    multiplier: conditionCount === 0 ? 1 : Math.min(4, conditionCount + 1),
    conditionCount,
    hasBaiba,
    hasSpecialUra,
    hasRedOrBluePochiTsumo,
    pochiColor: hasRedOrBluePochiTsumo ? pochiColor : null,
    labels: [
      hasBaiba ? "倍場" : null,
      hasSpecialUra ? "裏ドラ特殊牌" : null,
      hasRedOrBluePochiTsumo ? (pochiColor === "red" ? "赤ぽっち" : "青ぽっち") : null,
    ].filter(Boolean),
  };
};
const calculateServerBaibaMultiplier = (state, options = {}) => getServerBaibaMultiplierDetails(state, options).multiplier;
const serverPochiMultiplier = (tile) => {
  if (!isServerWhitePochiTile(tile)) return 1;
  if (tile.pochiColor === "red") return -1;
  if (tile.pochiColor === "yellow") return -1;
  if (tile.pochiColor === "blue") return 1;
  return 1;
};
const serverTileCloneWithColor = (tile, color) => ({ ...tile, id: `${tile.id || tileKindKey(tile)}-${color}-pochi`, color, isPochi: false, pochiColor: undefined });
const parseServerNumberKey = (key) => {
  const [suit, rawRank] = String(key || "").split(":");
  const rank = Number(rawRank);
  if (!["manzu", "pinzu", "souzu"].includes(suit) || !Number.isFinite(rank)) return null;
  return { suit, rank };
};
const tileKeySortValue = (key) => {
  const [suit, value] = String(key || "").split(":");
  const suitBase = { manzu: 0, pinzu: 20, souzu: 40, honor: 60, flower: 80 }[suit] ?? 99;
  const honorOrder = { east: 1, south: 2, west: 3, north: 4, white: 5, green: 6, red: 7 };
  const numeric = Number(value);
  return suitBase + (Number.isFinite(numeric) ? numeric : honorOrder[value] || 0);
};
const firstPositiveCountEntry = (counts) => [...counts.entries()]
  .filter(([, count]) => count > 0)
  .sort(([a], [b]) => tileKeySortValue(a) - tileKeySortValue(b))[0] || null;
const serverFixedMelds = (melds = []) => ensureArray(melds).map((meld) => ({
  type: "triplet",
  key: tileKindKey(meld?.tiles?.[0]),
  source: meld?.type || "meld",
}));
const serverExtractMelds = (counts) => {
  const first = firstPositiveCountEntry(counts);
  if (!first) return [[]];
  const [key, count] = first;
  const results = [];
  if (count >= 3) {
    const next = new Map(counts);
    next.set(key, count - 3);
    for (const rest of serverExtractMelds(next)) results.push([{ type: "triplet", key, source: "concealed" }, ...rest]);
  }
  const parsed = parseServerNumberKey(key);
  if (parsed && parsed.suit !== "manzu" && parsed.rank <= 7) {
    const key2 = `${parsed.suit}:${parsed.rank + 1}`;
    const key3 = `${parsed.suit}:${parsed.rank + 2}`;
    if ((counts.get(key2) || 0) > 0 && (counts.get(key3) || 0) > 0) {
      const next = new Map(counts);
      next.set(key, (next.get(key) || 0) - 1);
      next.set(key2, (next.get(key2) || 0) - 1);
      next.set(key3, (next.get(key3) || 0) - 1);
      for (const rest of serverExtractMelds(next)) results.push([{ type: "sequence", suit: parsed.suit, start: parsed.rank, source: "concealed" }, ...rest]);
    }
  }
  return results;
};
const serverFindStandardShapes = (counts, neededMelds = 4) => {
  const shapes = [];
  for (const [pairKey, count] of counts.entries()) {
    if (count < 2) continue;
    const next = new Map(counts);
    next.set(pairKey, count - 2);
    for (const melds of serverExtractMelds(next)) {
      if (melds.length === neededMelds) shapes.push({ pairKey, melds });
    }
  }
  return shapes;
};
const serverCountIipeikouPairs = (sequences) => {
  const counts = new Map();
  for (const sequence of sequences) {
    const key = `${sequence.suit}:${sequence.start}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.floor(count / 2), 0);
};
const serverHasSanshoku = (sequences) => {
  for (let start = 1; start <= 7; start++) {
    const suits = new Set(sequences.filter((meld) => meld.start === start).map((meld) => meld.suit));
    if (suits.has("manzu") && suits.has("pinzu") && suits.has("souzu")) return true;
  }
  return false;
};
const serverHasIttsu = (sequences) => ["pinzu", "souzu"].some((suit) => {
  const starts = new Set(sequences.filter((meld) => meld.suit === suit).map((meld) => meld.start));
  return starts.has(1) && starts.has(4) && starts.has(7);
});
const serverIsHonroutou = (tiles) => ensureArray(tiles).every((tile) => serverTerminalHonorKeys.has(tileKindKey(tile)));
const serverChantaOrJunchan = (tiles, shape, isOpen) => {
  if (serverIsHonroutou(tiles)) return null;
  if (!shape.melds.some((meld) => meld.type === "sequence")) return null;
  const meldOk = (meld) => {
    if (meld.type === "triplet") return serverTerminalHonorKeys.has(meld.key);
    return meld.start === 1 || meld.start === 7;
  };
  if (!serverTerminalHonorKeys.has(shape.pairKey) && !parseServerNumberKey(shape.pairKey)) return null;
  const pairParsed = parseServerNumberKey(shape.pairKey);
  const pairOk = serverTerminalHonorKeys.has(shape.pairKey) || pairParsed?.rank === 1 || pairParsed?.rank === 9;
  if (!pairOk || !shape.melds.every(meldOk)) return null;
  const hasHonor = tiles.some((tile) => tile.suit === "honor");
  return hasHonor ? { name: "チャンタ", han: isOpen ? 1 : 2 } : { name: "純チャン", han: isOpen ? 2 : 3 };
};
const serverColorYaku = (tiles, isClosed) => {
  const numberTiles = ensureArray(tiles).filter((tile) => ["manzu", "pinzu", "souzu"].includes(tile.suit));
  const suits = new Set(numberTiles.map((tile) => tile.suit));
  const hasHonor = ensureArray(tiles).some((tile) => tile.suit === "honor");
  if (suits.size === 1 && !hasHonor) return [{ name: "清一色", han: isClosed ? 6 : 5 }];
  if (suits.size === 1 && hasHonor) return [{ name: "混一色", han: isClosed ? 3 : 2 }];
  return [];
};
const serverIsChinitsuTiles = (tiles) => {
  const filtered = ensureArray(tiles).filter((tile) => !isFlowerTile(tile));
  const numberTiles = filtered.filter((tile) => ["manzu", "pinzu", "souzu"].includes(tile.suit));
  return filtered.length > 0 && numberTiles.length === filtered.length && new Set(numberTiles.map((tile) => tile.suit)).size === 1;
};
const serverCountAnkou = (triplets, { isTsumo, winningKey }) => triplets.filter((triplet) => {
  if (triplet.source === "ankan") return true;
  if (triplet.source !== "concealed") return false;
  if (!isTsumo && triplet.key === winningKey) return false;
  return true;
}).length;
const serverIsRyanmen = (shape, winningKey) => {
  const parsed = parseServerNumberKey(winningKey);
  if (!parsed) return false;
  return shape.melds.some((meld) => {
    if (meld.type !== "sequence" || meld.suit !== parsed.suit) return false;
    if (parsed.rank === meld.start) return meld.start !== 7;
    if (parsed.rank === meld.start + 2) return meld.start !== 1;
    return false;
  });
};
const serverIsPinfu = (shape, context) =>
  shape.melds.every((meld) => meld.type === "sequence") &&
  getServerYakuhaiHan(shape.pairKey, getServerSeatWind(context.state, context.player.id), context.state?.round?.roundWind || "east") === 0 &&
  serverIsRyanmen(shape, context.winningKey);
const serverShousangen = (shape, triplets) => {
  const dragons = new Set(["honor:white", "honor:green", "honor:red"]);
  return triplets.filter((meld) => dragons.has(meld.key)).length === 2 && dragons.has(shape.pairKey);
};
const serverIsManzuHonitsuYakuman = (tiles) =>
  ensureArray(tiles).some((tile) => tile.suit === "manzu") &&
  ensureArray(tiles).every((tile) => tile.suit === "manzu" || tile.suit === "honor");
const serverIsRyuuiisou = (tiles) => {
  const greenKeys = new Set(["souzu:2", "souzu:3", "souzu:4", "souzu:6", "souzu:8", "honor:green"]);
  return ensureArray(tiles).length > 0 && ensureArray(tiles).every((tile) => greenKeys.has(tileKindKey(tile)));
};
const serverIsChuren = (tiles, isClosed) => {
  if (!isClosed || ensureArray(tiles).length !== 14) return false;
  const numberTiles = ensureArray(tiles).filter((tile) => ["manzu", "pinzu", "souzu"].includes(tile.suit));
  if (numberTiles.length !== ensureArray(tiles).length) return false;
  const suits = new Set(numberTiles.map((tile) => tile.suit));
  if (suits.size !== 1) return false;
  const counts = Array.from({ length: 10 }, (_, index) => index === 0 ? 0 : numberTiles.filter((tile) => Number(tile.rank) === index).length);
  if (counts[1] < 3 || counts[9] < 3) return false;
  for (let rank = 2; rank <= 8; rank++) if (counts[rank] < 1) return false;
  return counts.slice(1).reduce((sum, count) => sum + count, 0) === 14;
};
const serverIsFirstTsumoYakumanEligible = (state, player, isTsumo) => {
  if (!isTsumo || ensureArray(player?.melds).length > 0) return false;
  const hasCallOrKan = ensureArray(state?.handLog?.events).some((event) => ["pon", "kan"].includes(event.type));
  return !hasCallOrKan && Number(state?.turnIndex || 0) < ensureArray(state?.players).length;
};
const serverIsRenhouEligible = (state, player, isTsumo) => {
  if (isTsumo || ensureArray(player?.melds).length > 0) return false;
  const hasCallOrKan = ensureArray(state?.handLog?.events).some((event) => ["pon", "kan"].includes(event.type));
  return !hasCallOrKan && Number(state?.turnIndex || 0) < ensureArray(state?.players).length;
};
const serverYakumanYaku = (context, shape, triplets) => {
  const yaku = [];
  const tripletKeys = new Set(triplets.map((meld) => meld.key));
  const ankouCount = serverCountAnkou(triplets, { isTsumo: context.isTsumo, winningKey: context.winningKey });
  const kanCount = ensureArray(context.player?.melds).filter((meld) => ["ankan", "minkan", "kakan"].includes(meld.type)).length;
  if (serverIsManzuHonitsuYakuman(context.allTiles)) yaku.push({ name: "萬子混一色", han: 13, isYakuman: true });
  if (serverIsRyuuiisou(context.allTiles)) yaku.push({ name: "緑一色", han: 13, isYakuman: true });
  if (serverIsChuren(context.allTiles, context.isClosed)) yaku.push({ name: "九蓮宝燈", han: 13, isYakuman: true });
  if (context.isClosed && ankouCount === 4) yaku.push({ name: "四暗刻", han: 13, isYakuman: true, detail: context.winningKey === shape.pairKey ? "単騎" : undefined });
  if (["honor:white", "honor:green", "honor:red"].every((key) => tripletKeys.has(key))) yaku.push({ name: "大三元", han: 13, isYakuman: true });
  if (ensureArray(context.allTiles).every((tile) => tile.suit === "honor")) yaku.push({ name: "字一色", han: 13, isYakuman: true });
  const windTripletCount = ["honor:east", "honor:south", "honor:west", "honor:north"].filter((key) => tripletKeys.has(key)).length;
  if (windTripletCount === 4) yaku.push({ name: "大四喜", han: 13, isYakuman: true });
  else if (windTripletCount === 3 && new Set(["honor:east", "honor:south", "honor:west", "honor:north"]).has(shape.pairKey)) yaku.push({ name: "小四喜", han: 13, isYakuman: true });
  if (ensureArray(context.allTiles).every((tile) => tile.suit !== "honor" && tile.rank && (Number(tile.rank) === 1 || Number(tile.rank) === 9))) yaku.push({ name: "清老頭", han: 13, isYakuman: true });
  if (kanCount === 4) yaku.push({ name: "四槓子", han: 13, isYakuman: true });
  return yaku;
};
const serverDedupeYaku = (yaku) => {
  const result = [];
  const seen = new Set();
  for (const item of ensureArray(yaku)) {
    const key = `${item.name}-${item.detail || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};
const isServerFuritenForWaits = (player, waits) => {
  const waitKeys = new Set(ensureArray(waits).map(tileKindKey));
  return ensureArray(player?.discardedTiles).some((discard) => waitKeys.has(tileKindKey(discard?.tile || discard)));
};
const getServerBaseScoreFromHan = (han, isDealer) => {
  const h = Math.max(1, Number(han || 1));
  if (isDealer) {
    if (h <= 1) return { basePoints: 2, limitType: "通常" };
    if (h === 2) return { basePoints: 3, limitType: "通常" };
    if (h === 3) return { basePoints: 6, limitType: "通常" };
    if (h <= 5) return { basePoints: 12, limitType: "満貫" };
    if (h <= 7) return { basePoints: 18, limitType: "跳満" };
    if (h <= 10) return { basePoints: 24, limitType: "倍満" };
    if (h <= 13) return { basePoints: 36, limitType: "三倍満" };
    return { basePoints: 48, limitType: "役満" };
  }
  if (h <= 1) return { basePoints: 1, limitType: "通常" };
  if (h === 2) return { basePoints: 2, limitType: "通常" };
  if (h === 3) return { basePoints: 4, limitType: "通常" };
  if (h <= 5) return { basePoints: 8, limitType: "満貫" };
  if (h <= 7) return { basePoints: 12, limitType: "跳満" };
  if (h <= 10) return { basePoints: 16, limitType: "倍満" };
  if (h <= 13) return { basePoints: 24, limitType: "三倍満" };
  return { basePoints: 32, limitType: "役満" };
};
const getTsumoLossless3maRonScoreFromHan = (han, isDealer) => {
  const h = Math.max(1, Number(han) || 1);
  if (isDealer) {
    if (h <= 1) return { basePoints: 2000, limitType: "通常" };
    if (h === 2) return { basePoints: 3000, limitType: "通常" };
    if (h === 3) return { basePoints: 6000, limitType: "通常" };
    if (h <= 5) return { basePoints: 12000, limitType: "満貫" };
    if (h <= 7) return { basePoints: 18000, limitType: "跳満" };
    if (h <= 10) return { basePoints: 24000, limitType: "倍満" };
    if (h <= 13) return { basePoints: 36000, limitType: "三倍満" };
    return { basePoints: 48000, limitType: "数え役満" };
  }
  if (h <= 1) return { basePoints: 1000, limitType: "通常" };
  if (h === 2) return { basePoints: 2000, limitType: "通常" };
  if (h === 3) return { basePoints: 4000, limitType: "通常" };
  if (h <= 5) return { basePoints: 8000, limitType: "満貫" };
  if (h <= 7) return { basePoints: 12000, limitType: "跳満" };
  if (h <= 10) return { basePoints: 16000, limitType: "倍満" };
  if (h <= 13) return { basePoints: 24000, limitType: "三倍満" };
  return { basePoints: 32000, limitType: "数え役満" };
};
const getTsumoLossless3maTsumoScoreFromHan = (han, isDealer) => {
  const h = Math.max(1, Number(han) || 1);
  if (isDealer) {
    if (h <= 1) return { childPay: 1000, dealerPay: 1000, limitType: "通常" };
    if (h === 2) return { childPay: 2000, dealerPay: 2000, limitType: "通常" };
    if (h === 3) return { childPay: 3000, dealerPay: 3000, limitType: "通常" };
    if (h <= 5) return { childPay: 6000, dealerPay: 6000, limitType: "満貫" };
    if (h <= 7) return { childPay: 9000, dealerPay: 9000, limitType: "跳満" };
    if (h <= 10) return { childPay: 12000, dealerPay: 12000, limitType: "倍満" };
    if (h <= 13) return { childPay: 18000, dealerPay: 18000, limitType: "三倍満" };
    return { childPay: 24000, dealerPay: 24000, limitType: "数え役満" };
  }
  if (h <= 2) return { childPay: 1000, dealerPay: 1000, limitType: "通常" };
  if (h === 3) return { childPay: 1000, dealerPay: 3000, limitType: "通常" };
  if (h <= 5) return { childPay: 3000, dealerPay: 5000, limitType: "満貫" };
  if (h <= 7) return { childPay: 4000, dealerPay: 8000, limitType: "跳満" };
  if (h <= 10) return { childPay: 6000, dealerPay: 10000, limitType: "倍満" };
  if (h <= 13) return { childPay: 8000, dealerPay: 16000, limitType: "三倍満" };
  return { childPay: 12000, dealerPay: 20000, limitType: "数え役満" };
};
const countServerIndicatorDora = (indicators, tiles) => {
  const doraKeys = new Set(ensureArray(indicators).map((indicator) => {
    if (indicator.suit === "pinzu" || indicator.suit === "souzu") return `${indicator.suit}:${Number(indicator.rank) === 9 ? 1 : Number(indicator.rank) + 1}`;
    if (indicator.suit === "manzu") return `manzu:${Number(indicator.rank) === 1 ? 9 : 1}`;
    if (indicator.suit === "honor") {
      const winds = ["east", "south", "west", "north"];
      const dragons = ["white", "green", "red"];
      if (winds.includes(indicator.kind)) return `honor:${winds[(winds.indexOf(indicator.kind) + 1) % winds.length]}`;
      if (dragons.includes(indicator.kind)) return `honor:${dragons[(dragons.indexOf(indicator.kind) + 1) % dragons.length]}`;
    }
    return tileKindKey(indicator);
  }));
  return ensureArray(tiles).filter((tile) => doraKeys.has(tileKindKey(tile))).length;
};
const evaluateServerWin = (state, player, tile, winType) => {
  const winningTile = tile || player?.drawnTile || null;
  const concealedTiles = [...ensureArray(player?.hand), ...(winningTile ? [winningTile] : [])].filter((item) => !isFlowerTile(item));
  const melds = ensureArray(player?.melds);
  const fixedMelds = serverFixedMelds(melds);
  const meldCount = fixedMelds.length;
  const isClosed = isServerMenzen(player);
  const isTsumo = winType === "tsumo";
  const winningKey = winningTile ? tileKindKey(winningTile) : null;
  const allTiles = [...concealedTiles, ...melds.flatMap((meld) => ensureArray(meld.tiles))].filter((item) => !isFlowerTile(item));
  if (concealedTiles.length + meldCount * 3 !== 14) return { canWin: false, reason: "和了判定には14枚相当の牌が必要です" };
  const counts = countTilesForShape(concealedTiles);

  const rejectByRiichiRequirement = (yaku) => {
    if (isTsumoLossless3maState(state)) return null;
    const hasYakuman = ensureArray(yaku).some((item) => item.isYakuman);
    const hasRinshanKaihou = ensureArray(yaku).some((item) => item.name === "嶺上開花");
    if (hasRinshanKaihou) return null;
    if (!hasYakuman && state?.settings?.ruleConfig?.otokogiEnabled !== false && isClosed && !player.isRiichi) {
      return { canWin: false, reason: "門前ダマテン和了は禁止です" };
    }
    return null;
  };

  if (meldCount === 0 && isKokushiShape(counts)) {
    const yaku = [{ name: "国士無双", han: 13, isYakuman: true }];
    return { canWin: true, yaku, winningTiles: allTiles, selectedWait: winningTile || allTiles.at(-1) };
  }

  const turquoiseOpenRiichi = player.isRiichi && !isClosed && hasTurquoise5pInHandOrMeldsServer(player);
  const riichiYakuEnabled = isClosed || turquoiseOpenRiichi;
  const baseYaku = [];
  if (riichiYakuEnabled && player.isRiichi) baseYaku.push({ name: "リーチ", han: 1, detail: turquoiseOpenRiichi ? "ターコイズ副露リーチ" : undefined });
  if (riichiYakuEnabled && player.isRiichi && player.ippatsu) baseYaku.push({ name: "一発", han: 1 });
  if (riichiYakuEnabled && isTsumo) baseYaku.push({ name: "門前清自摸和", han: 1, detail: turquoiseOpenRiichi ? "ターコイズ副露リーチ" : undefined });
  if (isTsumo && isServerRinshanKaihouTsumo(state, player, winningTile)) baseYaku.push({ name: "嶺上開花", han: 1 });
  if (ensureArray(state?.liveWall).length === 0) {
    baseYaku.push({ name: isTsumo ? "ハイテイ" : "ホウテイ", han: 1 });
  }
  if (serverIsFirstTsumoYakumanEligible(state, player, isTsumo)) {
    baseYaku.push({ name: player.id === state.round?.dealerPlayerId ? "天和" : "地和", han: 13, isYakuman: true });
  }
  if (serverIsRenhouEligible(state, player, isTsumo)) baseYaku.push({ name: "人和", han: 13, isYakuman: true });

  if (meldCount === 0 && isSevenPairsShapeServer(counts)) {
    let yaku = serverIsManzuHonitsuYakuman(allTiles)
      ? [{ name: "萬子混一色", han: 13, isYakuman: true }]
      : serverIsChinitsuTiles(allTiles)
        ? [{ name: "大車輪", han: 13, isYakuman: true }]
        : [...baseYaku, { name: "七対子", han: 2 }, ...serverColorYaku(allTiles, isClosed)];
    if (!yaku.some((item) => item.isYakuman) && serverIsHonroutou(allTiles)) yaku.push({ name: "混老頭", han: 2 });
    yaku = serverDedupeYaku(yaku);
    const riichiError = rejectByRiichiRequirement(yaku);
    if (riichiError) return riichiError;
    if (yaku.length === 0) return { canWin: false, reason: "和了形ですが役がありません" };
    return { canWin: true, yaku, winningTiles: allTiles, selectedWait: winningTile || allTiles.at(-1) };
  }

  const shapes = serverFindStandardShapes(counts, 4 - meldCount);
  if (shapes.length === 0) {
    return { canWin: false, reason: "和了形ではありません" };
  }
  const candidates = shapes.map((shape) => {
    const completeShape = { pairKey: shape.pairKey, melds: [...shape.melds, ...fixedMelds] };
    const sequences = completeShape.melds.filter((meld) => meld.type === "sequence");
    const triplets = completeShape.melds.filter((meld) => meld.type === "triplet");
    const context = { state, player, allTiles, isClosed, isTsumo, winningKey };
    let yaku = [...baseYaku, ...serverYakumanYaku(context, completeShape, triplets)];
    if (!yaku.some((item) => item.isYakuman)) {
      if (isServerTanyao(allTiles)) yaku.push({ name: "タンヤオ", han: 1 });
      const seatWind = getServerSeatWind(state, player.id);
      for (const triplet of triplets) {
        const han = getServerYakuhaiHan(triplet.key, seatWind, state?.round?.roundWind || "east");
        if (han > 0) yaku.push({ name: `役牌 ${serverTileLabel(triplet.key)}`, han, detail: han === 2 ? "常時役牌 + 自風" : undefined });
      }
      if (isClosed && serverIsPinfu(completeShape, { state, player, winningKey })) yaku.push({ name: "平和", han: 1 });
      if (isClosed) {
        const iipeikou = serverCountIipeikouPairs(sequences);
        if (iipeikou >= 2) yaku.push({ name: "二盃口", han: 3 });
        else if (iipeikou === 1) yaku.push({ name: "一盃口", han: 1 });
      }
      if (triplets.length === 4) yaku.push({ name: "対々和", han: 2 });
      if (serverCountAnkou(triplets, { isTsumo, winningKey }) >= 3) yaku.push({ name: "三暗刻", han: 2 });
      const kanCount = melds.filter((meld) => ["ankan", "minkan", "kakan"].includes(meld.type)).length;
      if (kanCount >= 3) yaku.push({ name: "三槓子", han: 2 });
      if (serverShousangen(completeShape, triplets)) yaku.push({ name: "小三元", han: 2 });
      if (serverIsHonroutou(allTiles)) yaku.push({ name: "混老頭", han: 2 });
      if (serverHasSanshoku(sequences)) yaku.push({ name: "三色同順", han: isClosed ? 2 : 1 });
      if (serverHasIttsu(sequences)) yaku.push({ name: "一気通貫", han: isClosed ? 2 : 1 });
      const terminalYaku = serverChantaOrJunchan(allTiles, completeShape, !isClosed);
      if (terminalYaku) yaku.push(terminalYaku);
      yaku.push(...serverColorYaku(allTiles, isClosed));
    }
    yaku = serverDedupeYaku(yaku);
    return { yaku, han: yaku.reduce((sum, item) => sum + Number(item.han || 0), 0) };
  });
  const best = candidates.sort((a, b) => b.han - a.han)[0];
  if (!best?.yaku.length) return { canWin: false, reason: "和了形ですが役がありません" };
  const riichiError = rejectByRiichiRequirement(best.yaku);
  if (riichiError) return riichiError;
  return { canWin: true, yaku: best.yaku, winningTiles: allTiles, selectedWait: winningTile || allTiles.at(-1) };
};
const calculateServerScoreResult = (state, player, winType, tile, loserId, yaku, options = {}) => {
  const hand13Tiles = sortHandTiles(ensureArray(player.hand).filter((item) => item && !isFlowerTile(item))).slice(0, 13);
  const winningTiles = [...ensureArray(player.hand), ...(tile ? [tile] : []), ...ensureArray(player.melds).flatMap((meld) => ensureArray(meld.tiles))].filter((item) => !isFlowerTile(item));
  const bonusSourceTiles = [...winningTiles, ...ensureArray(player.nukiDoraTiles)];
  const hasYakuman = ensureArray(yaku).some((item) => item.isYakuman);
  const hasRealYakuman = ensureArray(yaku).some((item) => item.isYakuman && !item.isCountedYakuman);
  const yakuHan = hasYakuman ? 14 : ensureArray(yaku).reduce((sum, item) => sum + Number(item.han || 0), 0);
  const normalDora = hasYakuman ? 0 : countServerIndicatorDora(state.doraIndicators, winningTiles);
  const uraDora = hasYakuman || !player.isRiichi ? 0 : countServerIndicatorDora(state.uraDoraIndicators, winningTiles);
  const colored = hasYakuman ? 0 : winningTiles.filter((tileItem) => ["red", "blue", "gold", "turquoise"].includes(tileItem.color)).length;
  const nuki = hasYakuman ? 0 : ensureArray(player.nukiDoraTiles).length;
  const doraHan = normalDora + colored + nuki + uraDora;
  const totalHan = hasYakuman ? 14 : yakuHan + doraHan;
  const isTsumoLossless3ma = state.settings?.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID || state.settings?.gameType === TSUMO_LOSSLESS_3MA_RULE_ID;
  if (isTsumoLossless3ma) {
    const isDealer = player.id === state.round?.dealerPlayerId;
    const honba = Number(state.round?.honba ?? state.honba ?? 0);
    const payments = Object.fromEntries(ensureArray(state.players).map((p) => [p.id, 0]));
    let basePoints = 0;
    let limitType = "通常";
    let childPay = 0;
    let dealerPay = 0;
    if (winType === "tsumo") {
      const tsumoScore = getTsumoLossless3maTsumoScoreFromHan(totalHan, isDealer);
      limitType = hasRealYakuman ? "本役満" : tsumoScore.limitType;
      childPay = tsumoScore.childPay + honba * 1000;
      dealerPay = tsumoScore.dealerPay + honba * 1000;
      for (const p of ensureArray(state.players)) {
        if (p.id === player.id) continue;
        const pay = p.id === state.round?.dealerPlayerId ? dealerPay : childPay;
        payments[p.id] = -pay;
        payments[player.id] += pay;
      }
      basePoints = isDealer ? childPay : Math.max(childPay, dealerPay);
    } else {
      const ronScore = getTsumoLossless3maRonScoreFromHan(totalHan, isDealer);
      limitType = hasRealYakuman ? "本役満" : ronScore.limitType;
      basePoints = ronScore.basePoints + honba * 1000;
      payments[player.id] = basePoints;
      if (loserId) payments[loserId] = -basePoints;
    }
    const visibleDora = normalDora + colored + nuki;
    return {
      yakuHan,
      doraHan,
      totalHan,
      han: totalHan,
      basePoints,
      bonusPoints: honba * 1000,
      beforeBaibaPoints: basePoints,
      totalPoints: basePoints,
      finalPoints: basePoints,
      limitType,
      yaku,
      yakuList: yaku,
      doraDetails: [
        visibleDora ? { name: "ドラ", han: visibleDora } : null,
        uraDora ? { name: "裏ドラ", han: uraDora } : null,
      ].filter(Boolean),
      dora: { normal: normalDora, colored, nuki, visible: visibleDora, ura: uraDora },
      bonuses: { honba: honba * 1000, chipPending: false },
      chipSettlement: null,
      baibaMultiplier: 1,
      payments,
      paymentDeltas: Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta })),
      winnerGain: payments[player.id] || 0,
      hand13Tiles,
      winningTiles,
      winningTile: tile || null,
      selectedWait: tile || null,
      pochiActivated: false,
      pointMultiplier: 1,
      isTsumo: winType === "tsumo",
      tsumoPayments: winType === "tsumo" ? { childPay, dealerPay } : null,
    };
  }
  const { basePoints, limitType } = getServerBaseScoreFromHan(totalHan, player.id === state.round?.dealerPlayerId);
  const blueTileBonus = bonusSourceTiles.filter((tileItem) => (tileItem.color === "blue" || tileItem.isRocket) && !tileItem.isPochi).length * 20;
  const goldTileBonus = bonusSourceTiles.filter((tileItem) => tileItem.color === "gold" || tileItem.color === "turquoise").length * 5;
  const uraDoraBonus = uraDora * 5;
  const honbaBonus = Number(state.round?.honba ?? state.honba ?? 0) * 5;
  const ippatsuBonus = ensureArray(yaku).some((item) => item.name === "一発") ? 5 : 0;
  const countedYakumanBonus = !hasYakuman && totalHan >= 14 ? 20 : 0;
  const realYakumanBonus = hasYakuman ? 40 : 0;
  const bonusPoints = blueTileBonus + goldTileBonus + uraDoraBonus + honbaBonus + ippatsuBonus + countedYakumanBonus + realYakumanBonus;
  const baibaDetails = getServerBaibaMultiplierDetails(state, {
    includeUra: player.isRiichi,
    pochiColor: options.pochiColor || null,
  });
  const baibaMultiplier = baibaDetails.multiplier;
  const beforeBaibaPoints = basePoints + bonusPoints;
  const totalPoints = beforeBaibaPoints * baibaMultiplier;
  const payments = Object.fromEntries(ensureArray(state.players).map((p) => [p.id, 0]));
  if (winType === "tsumo") {
    for (const p of ensureArray(state.players)) if (p.id !== player.id) payments[p.id] = -totalPoints;
    payments[player.id] = totalPoints * Math.max(0, ensureArray(state.players).length - 1);
  } else {
    payments[player.id] = totalPoints;
    if (loserId) payments[loserId] = -totalPoints;
  }
  const visibleDora = normalDora + colored + nuki;
  return {
    yakuHan,
    doraHan,
    totalHan,
    han: totalHan,
    basePoints,
    bonusPoints,
    beforeBaibaPoints,
    totalPoints,
    finalPoints: totalPoints,
    limitType: hasRealYakuman ? "本役満" : limitType,
    yaku,
    yakuList: yaku,
    doraDetails: [
      visibleDora ? { name: "ドラ", han: visibleDora } : null,
      uraDora ? { name: "裏ドラ", han: uraDora } : null,
    ].filter(Boolean),
    dora: { normal: normalDora, colored, nuki, visible: visibleDora, ura: uraDora },
    bonuses: {
      blueTile: blueTileBonus,
      rocket: blueTileBonus,
      goldTile: goldTileBonus,
      uraDora: uraDoraBonus,
      honba: honbaBonus,
      ippatsu: ippatsuBonus,
      countedYakuman: countedYakumanBonus,
      realYakuman: realYakumanBonus,
      baiba: totalPoints - beforeBaibaPoints,
    },
    baibaMultiplier,
    baibaDetails,
    payments,
    paymentDeltas: Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta })),
    winnerGain: payments[player.id] || 0,
    hand13Tiles,
    winningTiles,
    winningTile: tile || null,
    selectedWait: tile || null,
    pochiActivated: false,
    pointMultiplier: 1,
    isTsumo: winType === "tsumo",
  };
};
const serverPochiCandidateTiles = (waitTile, pochiTile) => {
  const candidates = [];
  const pushCandidate = (tile) => {
    if (!tile) return;
    const key = `${tileKindKey(tile)}:${tile.color || "normal"}:${tile.isPochi ? tile.pochiColor || "pochi" : ""}`;
    if (candidates.some((item) => `${tileKindKey(item)}:${item.color || "normal"}:${item.isPochi ? item.pochiColor || "pochi" : ""}` === key)) return;
    candidates.push(tile);
  };
  if ((waitTile.suit === "pinzu" || waitTile.suit === "souzu") && Number(waitTile.rank) === 5) {
    pushCandidate(serverTileCloneWithColor(waitTile, pochiTile.pochiColor === "red" || pochiTile.pochiColor === "blue" ? "blue" : "red"));
  } else {
    pushCandidate({ ...waitTile, id: `${waitTile.id || tileKindKey(waitTile)}-normal-pochi`, color: waitTile.color || "normal", isPochi: false, pochiColor: undefined });
  }
  if (waitTile.suit === "honor" && waitTile.kind === "white") {
    pushCandidate({ ...pochiTile, id: `${pochiTile.id || "white-pochi"}-as-white`, color: "normal", isPochi: false, pochiColor: undefined });
  }
  return candidates;
};
const resolveServerPochiWin = (state, player, pochiTile, winType = "tsumo", loserId = null) => {
  if (!isServerWhitePochiTile(pochiTile) || !player?.isRiichi) return null;
  const waits = getWinningTilesForServerTenpai(player);
  const candidates = waits.flatMap((wait) => serverPochiCandidateTiles(wait, pochiTile));
  let best = null;
  for (const candidateTile of candidates) {
    const winCheck = evaluateServerWin(state, player, candidateTile, winType);
    if (!winCheck.canWin) continue;
    const scoreResult = calculateServerScoreResult(state, player, winType, candidateTile, loserId, winCheck.yaku, { pochiColor: winType === "tsumo" ? pochiTile.pochiColor : null });
    const multiplier = serverPochiMultiplier(pochiTile);
    scoreResult.pochiActivated = true;
    scoreResult.pointMultiplier = multiplier;
    scoreResult.beforePochiPoints = scoreResult.totalPoints;
    scoreResult.beforeMultiplierPoints = scoreResult.totalPoints;
    scoreResult.totalPoints *= multiplier;
    scoreResult.finalPoints = scoreResult.totalPoints;
    scoreResult.afterMultiplierPoints = scoreResult.totalPoints;
    scoreResult.selectedWait = candidateTile;
    scoreResult.winningTile = candidateTile;
    scoreResult.displayWinningTile = pochiTile;
    scoreResult.pochiTile = pochiTile;
    scoreResult.pochiColor = pochiTile.pochiColor;
    scoreResult.payments = Object.fromEntries(ensureArray(state.players).map((p) => [p.id, 0]));
    if (winType === "tsumo") {
      for (const p of ensureArray(state.players)) if (p.id !== player.id) scoreResult.payments[p.id] = -scoreResult.totalPoints;
      scoreResult.payments[player.id] = scoreResult.totalPoints * Math.max(0, ensureArray(state.players).length - 1);
    } else {
      scoreResult.payments[player.id] = scoreResult.totalPoints;
      if (loserId) scoreResult.payments[loserId] = -scoreResult.totalPoints;
    }
    scoreResult.paymentDeltas = Object.entries(scoreResult.payments).map(([playerId, delta]) => ({ playerId, delta }));
    scoreResult.winnerGain = scoreResult.payments[player.id] || 0;
    if (!best || Math.abs(scoreResult.totalPoints) > Math.abs(best.scoreResult.totalPoints)) {
      best = { winCheck, scoreResult, selectedWait: candidateTile };
    }
  }
  return best;
};
const getServerRiichiDiscardTileIds = (player) => {
  if (!player || player.type === "cpu" || player.isRiichi) return [];
  const hasOpenMeld = ensureArray(player.melds).some((meld) => meld?.type !== "ankan");
  if (hasOpenMeld && !hasTurquoise5pInHandOrMeldsServer(player)) return [];
  const tiles = combinedHandTiles(player).filter((tile) => !isFlowerTile(tile));
  const expectedLength = 14 - ensureArray(player.melds).length * 3;
  if (tiles.length !== expectedLength) return [];
  const candidateIds = [];
  for (const tile of tiles) {
    const afterDiscard = tiles.filter((item) => item.id !== tile.id);
    if (hasOpenMeld && !hasTurquoise5pInTilesOrMeldsServer(afterDiscard, player.melds)) continue;
    const testPlayer = {
      ...player,
      hand: afterDiscard,
      drawnTile: null,
    };
    const waits = getWinningTilesForServerTenpai(testPlayer);
    const afterDiscardPlayer = {
      ...player,
      hand: afterDiscard,
      drawnTile: null,
      discardedTiles: [...ensureArray(player.discardedTiles), { tile }],
    };
    if (waits.length > 0 && !isServerFuritenForWaits(afterDiscardPlayer, waits)) candidateIds.push(tile.id);
  }
  return [...new Set(candidateIds)];
};
const queueServerDiscardTurnOptions = (state, player, source = { type: "discardTurn" }) => {
  if (!player || player.type === "cpu" || player.isRiichi) return false;
  const riichiDiscardTileIds = getServerRiichiDiscardTileIds(player);
  if (!riichiDiscardTileIds.length) {
    console.log("[PonRiichi] unavailable", {
      tableId: state.tableId,
      playerId: player.id,
      source,
      hasTurquoise: hasTurquoise5pInHandOrMeldsServer(player),
      handCount: ensureArray(player.hand).length,
      meldCount: ensureArray(player.melds).length,
      phase: state.phase,
    });
    return false;
  }
  player.riichiDiscardTileIds = riichiDiscardTileIds;
  console.log("[PonRiichi] available", {
    tableId: state.tableId,
    playerId: player.id,
    source,
    discardTileIds: riichiDiscardTileIds,
  });
  return setServerPendingActions(state, player.id, [
    { type: "riichi", playerId: player.id, options: { discardTileIds: riichiDiscardTileIds } },
  ], source);
};
const canServerTsumo = (state, player) => {
  if (isServerWhitePochiTile(player?.drawnTile) && resolveServerPochiWin(state, player, player.drawnTile, "tsumo")) return true;
  return evaluateServerWin(state, player, player?.drawnTile, "tsumo").canWin;
};
const canServerRon = (state, player, sourceTile) => {
  const waits = getWinningTilesForServerTenpai(player);
  if (!waits.some((wait) => sameTileKind(wait, sourceTile))) return false;
  if (isServerFuritenForWaits(player, waits)) return false;
  return evaluateServerWin(state, player, sourceTile, "ron").canWin;
};
const hasServerPureClosedTriplet = (player, suit, rank) => {
  const targetKey = `${suit}:${rank}`;
  if (ensureArray(player?.melds).some((meld) => meld?.type === "ankan" && ensureArray(meld.tiles).some((tile) => tileKindKey(tile) === targetKey))) {
    return true;
  }
  const handTiles = ensureArray(player?.hand).filter((tile) => tileKindKey(tile) === targetKey);
  const drawnMatches = player?.drawnTile && tileKindKey(player.drawnTile) === targetKey ? 1 : 0;
  return handTiles.length + drawnMatches >= 3;
};
const hasServerFeverRiichiTriplet = (player) =>
  hasServerPureClosedTriplet(player, "pinzu", 7) || hasServerPureClosedTriplet(player, "souzu", 7);
const SERVER_FEVER_RIICHI_KEYS = new Set(["pinzu:7", "souzu:7"]);
const hasServerFeverAnkan = (player) =>
  ensureArray(player?.melds).some((meld) =>
    meld?.type === "ankan" &&
    ensureArray(meld.tiles).some((tile) => SERVER_FEVER_RIICHI_KEYS.has(tileKindKey(tile)))
  );
const hasServerClosedFeverTripletInHand13 = (player, hand13) =>
  [...SERVER_FEVER_RIICHI_KEYS].some((key) =>
    ensureArray(hand13).filter((tile) => tileKindKey(tile) === key).length >= 3 ||
    ensureArray(player?.melds).some((meld) => meld?.type === "ankan" && ensureArray(meld.tiles).some((tile) => tileKindKey(tile) === key))
  );
const serverWinningShapeKeepsFeverTriplet = (tiles14, melds = []) => {
  const filtered = ensureArray(tiles14).filter((tile) => !isFlowerTile(tile));
  const fixedAnkanMelds = ensureArray(melds)
    .filter((meld) => meld?.type === "ankan" && meld.tiles?.[0])
    .map((meld) => ({ type: "triplet", key: tileKindKey(meld.tiles[0]), source: "ankan" }));
  const neededMelds = 4 - ensureArray(melds).length;
  if (filtered.length + ensureArray(melds).length * 3 !== 14 || neededMelds < 0) return false;
  const counts = countTilesForShape(filtered);
  return serverFindStandardShapes(counts, neededMelds).some((shape) =>
    [...shape.melds, ...fixedAnkanMelds].some((meld) => meld.type === "triplet" && SERVER_FEVER_RIICHI_KEYS.has(meld.key))
  );
};
const isServerFeverRiichiEligibleAfterDiscard = (state, player, hand13) => {
  if (!state?.settings?.ruleConfig?.feverRiichiEnabled || !player || !hasServerClosedFeverTripletInHand13(player, hand13)) return false;
  const waits = getWinningTilesForServerTenpai({ ...player, hand: hand13, drawnTile: null });
  if (hasServerFeverAnkan(player)) return waits.length > 0;
  return waits.length > 0 && waits.every((wait) => serverWinningShapeKeepsFeverTriplet([...ensureArray(hand13), wait], player.melds));
};
const clearServerIppatsu = (state, reason, exceptPlayerId = null) => {
  let changed = false;
  for (const player of ensureArray(state?.players)) {
    if (!player?.ippatsu || player.id === exceptPlayerId) continue;
    player.ippatsu = false;
    player.ippatsuOwnDrawStarted = false;
    changed = true;
  }
  if (changed) appendHandEvent(state, { type: "ippatsuCleared", reason, turnIndex: state.turnIndex ?? 0 });
  return changed;
};
const beginServerRiichiAutoDiscard = (state, player) => {
  if (!player?.isRiichi || !player.drawnTile || player.type === "cpu") return false;
  state.pendingAction = null;
  state.phase = "riichiAutoDiscard";
  state.isWaitingForHumanAction = false;
  state.activeClockPlayerId = null;
  state.clockStartedAt = null;
  state.pendingServerEffect = {
    type: "riichiAutoDiscard",
    playerId: player.id,
    resumeAt: Date.now() + 850,
  };
  appendHandEvent(state, { type: "riichiAutoDiscardWait", playerId: player.id, tile: player.drawnTile, turnIndex: state.turnIndex ?? 0 });
  return true;
};
const queueServerSelfDrawOptions = (state, player) => {
  if (!player || player.type === "cpu") return false;
  const feverPlayer = ensureArray(state.players).find((item) => item.feverRiichiActive && (item.feverWinCount ?? 0) < 2);
  if (feverPlayer && feverPlayer.id !== player.id) return beginServerRiichiAutoDiscard(state, player);
  const options = [];
  const canKanNow = canServerDeclareKanNow(state);
  if (canServerTsumo(state, player)) {
    const option = { type: "tsumo", playerId: player.id, sourceTile: player.drawnTile || null, tile: player.drawnTile || null };
    if (player.isRiichi || player.assistSettings?.autoWin) {
      applyServerAction(state, { playerId: player.id, actionType: "tsumo", payload: { action: option, sourceTile: player.drawnTile || null } });
      return true;
    }
    options.push(option);
  }
  if (!player.isRiichi && canKanNow) {
    const kanTile = findServerAnkanCandidate(player, { allowRiichi: false });
    if (kanTile) options.push({ type: "kan", playerId: player.id, sourceTile: kanTile, tile: kanTile, options: { kanType: "ankan" } });
    const kakan = findServerKakanCandidate(player);
    if (kakan) options.push({ type: "kan", playerId: player.id, sourceTile: kakan.tile, tile: kakan.tile, options: { kanType: "kakan", meldTile: kakan.meld?.tiles?.[0] } });
  }
  if (player.isRiichi && canKanNow) {
    const kanTile = findServerAnkanCandidate(player, { allowRiichi: true });
    if (kanTile) options.push({ type: "kan", playerId: player.id, sourceTile: kanTile, tile: kanTile, options: { kanType: "ankan" } });
  }
  const riichiDiscardTileIds = getServerRiichiDiscardTileIds(player);
  if (riichiDiscardTileIds.length > 0) {
    player.riichiDiscardTileIds = riichiDiscardTileIds;
    options.push({ type: "riichi", playerId: player.id, options: { discardTileIds: riichiDiscardTileIds } });
  }
  if (player.isRiichi && options.length === 0) return beginServerRiichiAutoDiscard(state, player);
  return setServerPendingActions(state, player.id, options, { type: "selfDraw" });
};
const findAutoFlowerTile = (player) => combinedHandTiles(player).find(isFlowerTile) || null;
const beginServerFlowerAnnouncement = (state, player, tile) => {
  if (!player || !tile) return false;
  state.pendingAction = null;
  state.phase = "showingFlowerAnnouncement";
  state.flowerAnnouncement = player.type === "cpu" ? `${player.name} 華` : "華";
  state.pendingServerEffect = {
    type: "flower",
    playerId: player.id,
    tileId: tile.id,
    resumeAt: Date.now() + 950,
  };
  state.isWaitingForHumanAction = false;
  state.activeClockPlayerId = null;
  state.clockStartedAt = null;
  appendHandEvent(state, { type: "flowerAnnouncement", playerId: player.id, tile, turnIndex: state.turnIndex ?? 0 });
  return true;
};
const beginServerPonAnnouncement = (state, player, { fromPlayerId, sourceTile }) => {
  if (!state || !player || !fromPlayerId || !sourceTile) return false;
  const matchingTiles = ensureArray(player.hand).filter((tile) => sameTileKind(tile, sourceTile)).slice(0, 2);
  if (matchingTiles.length < 2) throw new Error("ポンに必要な2枚がありません");
  state.pendingAction = null;
  state.phase = "showingCallAnnouncement";
  state.serverAnnouncement = { text: "ポン", kind: "call-pon" };
  state.isWaitingForHumanAction = false;
  state.activeClockPlayerId = null;
  state.clockStartedAt = null;
  state.pendingServerEffect = {
    type: "ponReveal",
    playerId: player.id,
    fromPlayerId,
    sourceTile,
    consumedTileIds: matchingTiles.map((tile) => tile.id),
    resumeAt: Date.now() + 1350,
  };
  appendHandEvent(state, { type: "pon", playerId: player.id, fromPlayerId, tile: sourceTile, consumedTiles: matchingTiles, turnIndex: state.turnIndex ?? 0 });
  clearServerIppatsu(state, "pon");
  return true;
};
const scheduleServerFeverForcedDiscard = (state, player, feverPlayer) => {
  if (!state || !player?.drawnTile || !feverPlayer || feverPlayer.id === player.id) return false;
  const flower = findAutoFlowerTile(player);
  if (flower && beginServerFlowerAnnouncement(state, player, flower)) return true;
  state.phase = "riichiAutoDiscard";
  state.isWaitingForHumanAction = false;
  state.activeClockPlayerId = null;
  state.clockStartedAt = null;
  state.pendingServerEffect = {
    type: "riichiAutoDiscard",
    playerId: player.id,
    resumeAt: Date.now() + 850,
    reason: "feverRiichiForcedDiscard",
  };
  appendHandEvent(state, { type: "feverForcedDiscardWait", playerId: player.id, feverPlayerId: feverPlayer.id, tile: player.drawnTile, turnIndex: state.turnIndex ?? 0 });
  return true;
};
const beginServerWinAnnouncement = (state, player, winType, scoreResult = null) => {
  const pochiAnnouncement = winType === "tsumo" ? pochiTsumoAnnouncement(scoreResult) : null;
  const label = pochiAnnouncement?.text || (winType === "tsumo" ? "ツモ" : "ロン");
  state.phase = "showingWinAnnouncement";
  state.winAnnouncement = label;
  state.serverAnnouncement = { text: state.winAnnouncement, kind: pochiAnnouncement?.kind || (winType === "tsumo" ? "tsumo" : "ron"), playerId: player?.id || "" };
  state.activeClockPlayerId = null;
  state.clockStartedAt = null;
  state.pendingServerEffect = {
    type: "winAnnouncement",
    resumeAt: Date.now() + 2400,
  };
};
const sortRonWinnersByKamichaFromLoser = (state, loserId, winnerIds) => {
  const ids = ensureArray(state?.players).map((player) => player.id);
  const loserIndex = ids.indexOf(loserId);
  if (loserIndex < 0) return [...winnerIds];
  const distance = (winnerId) => {
    const winnerIndex = ids.indexOf(winnerId);
    if (winnerIndex < 0) return Number.MAX_SAFE_INTEGER;
    return (loserIndex - winnerIndex + ids.length) % ids.length || ids.length;
  };
  return [...winnerIds].sort((a, b) => distance(a) - distance(b));
};
const buildServerRonWinEntry = (state, player, sourceTile, loserId) => {
  const winCheck = evaluateServerWin(state, player, sourceTile, "ron");
  if (!winCheck.canWin) throw new Error(winCheck.reason || "和了できません");
  const waits = getWinningTilesForServerTenpai(player);
  if (isServerFuritenForWaits(player, waits)) throw new Error("フリテンのためロンできません");
  const scoreResult = applyServerWinRake(
    state,
    player.id,
    calculateServerScoreResult(state, player, "ron", sourceTile, loserId, winCheck.yaku),
  );
  applyServerPaoToScoreResult(state, player, scoreResult);
  scoreResult.displayWinningTile ??= sourceTile;
  return {
    winnerId: player.id,
    loserId,
    winType: "ron",
    winningTile: sourceTile,
    scoringWinningTile: sourceTile,
    scoreResult,
  };
};
const finalizeServerRonWins = (state, winEntries, loserId, sourceTile) => {
  const entries = ensureArray(winEntries).filter((entry) => entry?.winnerId);
  if (!entries.length) return false;
  const orderedWinnerIds = sortRonWinnersByKamichaFromLoser(state, loserId, entries.map((entry) => entry.winnerId));
  const orderedEntries = orderedWinnerIds.map((id) => entries.find((entry) => entry.winnerId === id)).filter(Boolean);
  const primary = orderedEntries[0];
  const combinedPayments = Object.fromEntries(ensureArray(state.players).map((player) => [player.id, 0]));
  for (const entry of orderedEntries) {
    for (const [playerId, delta] of Object.entries(entry.scoreResult?.payments || {})) {
      combinedPayments[playerId] = Number(combinedPayments[playerId] || 0) + Number(delta || 0);
    }
  }
  const riichiStickCount = isTsumoLossless3maState(state) ? Number(state.riichiStickCount || 0) : 0;
  const riichiStickPoints = riichiStickCount * 1000;
  if (riichiStickPoints > 0 && primary?.winnerId) {
    combinedPayments[primary.winnerId] = Number(combinedPayments[primary.winnerId] || 0) + riichiStickPoints;
    primary.scoreResult.payments ??= {};
    primary.scoreResult.payments[primary.winnerId] = Number(primary.scoreResult.payments[primary.winnerId] || 0) + riichiStickPoints;
    primary.scoreResult.riichiStickCount = riichiStickCount;
    primary.scoreResult.riichiStickPoints = riichiStickPoints;
    primary.scoreResult.winnerGain = Number(primary.scoreResult.payments[primary.winnerId] || 0);
    primary.scoreResult.paymentDeltas = Object.entries(primary.scoreResult.payments).map(([playerId, delta]) => ({ playerId, delta }));
    state.riichiStickCount = 0;
  }
  for (const player of ensureArray(state.players)) {
    player.score = Number(player.score || 0) + Number(combinedPayments[player.id] || 0);
  }
  const chipSettlements = [];
  const tobiPrizes = [];
  for (const entry of orderedEntries) {
    const winner = findPlayer(state, entry.winnerId);
    if (!winner) continue;
    const chipSettlement = isTsumoLossless3maState(state)
      ? (entry.scoreResult.chipSettlement || calculateTsumoLosslessChipSettlement(state, winner, "ron", loserId, entry.scoreResult))
      : null;
    const tobiPrize = isTsumoLossless3maState(state)
      ? calculateTsumoLosslessTobiPrize(state, winner.id, "ron", loserId)
      : null;
    applyServerPaoToExtraSettlement(state, winner, chipSettlement, entry.scoreResult?.pao);
    if (chipSettlement?.payments) accumulateTsumoLosslessClubPointPayments(state, chipSettlement.payments);
    if (tobiPrize?.payments) accumulateTsumoLosslessClubPointPayments(state, tobiPrize.payments);
    entry.chipSettlement = chipSettlement;
    entry.tobiPrize = tobiPrize;
    if (chipSettlement) chipSettlements.push({ winnerId: winner.id, ...chipSettlement });
    if (tobiPrize) tobiPrizes.push({ winnerId: winner.id, ...tobiPrize });
  }
  state.pendingAction = null;
  state.handLog ??= {};
  state.handLog.result = {
    resultId: randomUUID(),
    createdAt: now(),
    type: "win",
    winnerId: primary.winnerId,
    loserId,
    winType: "ron",
    winningTile: primary.winningTile || sourceTile,
    scoringWinningTile: primary.scoringWinningTile || sourceTile,
    scoreResult: primary.scoreResult,
    wins: orderedEntries,
    winners: orderedEntries.map((entry) => entry.winnerId),
    payments: Object.entries(combinedPayments).map(([playerId, delta]) => ({ playerId, delta })),
    chipSettlements,
    tobiPrizes,
    riichiStickCount,
    riichiStickPoints,
    primaryWinnerRule: orderedEntries.length > 1 ? "kamicha" : "single",
  };
  resetResultCountdownState(state);
  for (const entry of orderedEntries) {
    appendHandEvent(state, { type: "ron", playerId: entry.winnerId, fromPlayerId: loserId, tile: entry.winningTile || sourceTile, scoringTile: entry.scoringWinningTile || sourceTile, scoreResult: entry.scoreResult, isDoubleRon: orderedEntries.length > 1, primaryWinnerId: primary.winnerId, turnIndex: state.turnIndex ?? 0 });
  }
  const primaryPlayer = findPlayer(state, primary.winnerId);
  beginServerWinAnnouncement(state, primaryPlayer || { id: primary.winnerId }, "ron", primary.scoreResult);
  if (orderedEntries.length > 1) {
    state.winAnnouncement = "ダブロン";
    state.serverAnnouncement = {
      text: "ダブロン",
      kind: "double-ron",
      lines: orderedEntries.map((entry) => `${findPlayer(state, entry.winnerId)?.name || "Player"} ロン`),
      ronCount: orderedEntries.length,
    };
  }
  return true;
};
const continueServerAfterDiscardSource = (state, source) => {
  state.pendingAction = null;
  state.phase = "playing";
  const fromIndex = ensureArray(state.players).findIndex((p) => p.id === source?.fromPlayerId);
  if (fromIndex >= 0) state.currentPlayerIndex = fromIndex;
  advanceTurn(state);
  enterCurrentTurnOnServer(state);
};
const resolveServerMultiRonResponse = (state, player, action, payload = {}) => {
  const pending = state.pendingAction;
  if (!isServerMultiRonPending(pending)) return false;
  if (!pending.playerIds?.includes?.(player.id)) throw new Error("このロン選択の対象プレイヤーではありません");
  if (pending.responses?.[player.id]) return true;
  pending.responses ??= {};
  const option = asArray(pending.optionsByPlayerId?.[player.id]).find((item) => item.type === "ron");
  if (!option) throw new Error("ロン選択が見つかりません");
  if (action === "ron") {
    const sourceTile = payload.action?.sourceTile || payload.sourceTile || option.sourceTile || pending.source?.sourceTile;
    const loserId = payload.action?.fromPlayerId || payload.fromPlayerId || option.fromPlayerId || pending.source?.fromPlayerId;
    pending.responses[player.id] = { type: "ron", entry: buildServerRonWinEntry(state, player, sourceTile, loserId) };
    appendHandEvent(state, { type: "ronAccepted", playerId: player.id, fromPlayerId: loserId, tile: sourceTile, turnIndex: state.turnIndex ?? 0 });
  } else {
    pending.responses[player.id] = { type: "skip" };
    player.sameTurnFuriten = true;
    appendHandEvent(state, { type: "skipAction", playerId: player.id, actionType: "ron", turnIndex: state.turnIndex ?? 0 });
  }
  const waitingIds = pending.playerIds.filter((id) => !pending.responses[id]);
  if (waitingIds.length) {
    state.activeClockPlayerId = waitingIds[0];
    state.clockStartedAt = Date.now();
    state.phase = "waitingForAction";
    state.isWaitingForHumanAction = true;
    return true;
  }
  const entries = pending.playerIds.map((id) => pending.responses[id]).filter((response) => response?.type === "ron").map((response) => response.entry);
  const source = pending.source || {};
  if (entries.length) {
    finalizeServerRonWins(state, entries, source.fromPlayerId || entries[0]?.loserId, source.sourceTile || entries[0]?.winningTile);
    return true;
  }
  continueServerAfterDiscardSource(state, source);
  return true;
};
const drawRinshanAfterFlower = (state, player, removedFromDrawn) => {
  const tile = ensureArray(state.rinshanWall).shift();
  if (!tile) return null;
  if (removedFromDrawn || !player.drawnTile) player.drawnTile = tile;
  else {
    player.hand ??= [];
    player.hand.push(tile);
    player.hand = sortHandTiles(player.hand);
  }
  state.lastDrawnTile = tile;
  state.rinshanKaihou = null;
  state.pendingRinshanKaihouFromKan = false;
  appendHandEvent(state, { type: "draw", playerId: player.id, tile, from: "rinshanWall", turnIndex: state.turnIndex ?? 0 });
  return tile;
};
const applyServerFlowerEffect = (state) => {
  const effect = state.pendingServerEffect;
  if (!effect || effect.type !== "flower") return false;
  const player = findPlayer(state, effect.playerId);
  if (!player) {
    state.pendingServerEffect = null;
    state.flowerAnnouncement = null;
    state.phase = "playing";
    return false;
  }
  const removedFromDrawn = player.drawnTile?.id === effect.tileId;
  const tile = removedFromDrawn ? player.drawnTile : removeTileById(player.hand, effect.tileId);
  if (removedFromDrawn) player.drawnTile = null;
  if (tile && isFlowerTile(tile)) {
    player.nukiDoraTiles ??= [];
    player.nukiDoraTiles.push(tile);
    const replacementTile = ensureArray(state.rinshanWall)[0] || null;
    appendHandEvent(state, { type: "nukiDora", playerId: player.id, tile, replacementTile, turnIndex: state.turnIndex ?? 0 });
    drawRinshanAfterFlower(state, player, removedFromDrawn);
    player.hand = sortHandTiles(player.hand);
  }
  state.pendingServerEffect = null;
  state.flowerAnnouncement = null;
  const nextFlower = findAutoFlowerTile(player);
  if (nextFlower) return beginServerFlowerAnnouncement(state, player, nextFlower);
  const feverPlayer = ensureArray(state.players).find((item) => item.feverRiichiActive && (item.feverWinCount ?? 0) < 2);
  if (scheduleServerFeverForcedDiscard(state, player, feverPlayer)) return true;
  state.phase = "waitingForHumanDiscard";
  if (!queueServerSelfDrawOptions(state, player)) startServerClockForPlayer(state, player);
  return true;
};
const applyServerPonRevealEffect = (state) => {
  const effect = state.pendingServerEffect;
  if (!effect || effect.type !== "ponReveal") return false;
  state.pendingServerEffect = null;
  state.serverAnnouncement = null;
  const player = findPlayer(state, effect.playerId);
  if (!player) {
    state.phase = "playing";
    return false;
  }
  const sourceTile = effect.sourceTile;
  const fromPlayerId = effect.fromPlayerId;
  const calledTile = removeLastMatchingDiscard(state, fromPlayerId, sourceTile) || sourceTile;
  const consumedTileIds = new Set(ensureArray(effect.consumedTileIds).filter(Boolean));
  const tiles = [calledTile];
  const remainingHand = [];
  for (const tile of ensureArray(player.hand)) {
    if (tiles.length < 3 && consumedTileIds.has(tile?.id)) {
      tiles.push(tile);
      consumedTileIds.delete(tile?.id);
    } else {
      remainingHand.push(tile);
    }
  }
  if (tiles.length < 3) {
    const fallbackHand = [];
    for (const tile of remainingHand) {
      if (tiles.length < 3 && sameTileKind(tile, sourceTile)) tiles.push(tile);
      else fallbackHand.push(tile);
    }
    player.hand = fallbackHand;
  } else {
    player.hand = remainingHand;
  }
  if (tiles.length < 3) {
    state.phase = "playing";
    appendHandEvent(state, { type: "ponRevealFailed", playerId: player.id, fromPlayerId, tile: sourceTile, turnIndex: state.turnIndex ?? 0 });
    return false;
  }
  player.melds ??= [];
  const meld = { type: "pon", tiles, calledTile, fromPlayerId };
  player.melds.push(meld);
  player.drawnTile = null;
  player.hand = sortHandTiles(player.hand);
  state.currentPlayerIndex = ensureArray(state.players).findIndex((p) => p.id === player.id);
  state.players.forEach((p) => { p.status = p.id === player.id ? "active" : "waiting"; });
  state.phase = "waitingForHumanDiscard";
  updateServerPaoResponsibilityAfterOpenMeld(state, player, meld, fromPlayerId);
  if (!queueServerDiscardTurnOptions(state, player, { type: "afterPon", fromPlayerId, sourceTile })) {
    startServerClockForPlayer(state, player);
  }
  return true;
};
const queueServerAfterDiscardOptions = (state, fromPlayerId, sourceTile) => {
  const feverPlayer = ensureArray(state.players).find((player) => player.feverRiichiActive && (player.feverWinCount ?? 0) < 2);
  if (feverPlayer && feverPlayer.id !== fromPlayerId) {
    if (canServerRon(state, feverPlayer, sourceTile)) {
      applyServerAction(state, { playerId: feverPlayer.id, actionType: "ron", payload: { action: { type: "ron", playerId: feverPlayer.id, fromPlayerId, sourceTile }, fromPlayerId, sourceTile } });
      return true;
    }
    return false;
  }
  const canCallAfterDiscard = hasLiveWallAfterCurrentDraw(state);
  const canCallKanAfterDiscard = canCallAfterDiscard && canServerDeclareKanNow(state);
  const candidates = ensureArray(state.players).filter((player) => player.id !== fromPlayerId && player.type !== "cpu");
  const ronOptions = [];
  let firstCallPending = null;
  for (const player of candidates) {
    const matchingCount = ensureArray(player.hand).filter((tile) => sameTileKind(tile, sourceTile)).length;
    const noCall = Boolean(player.assistSettings?.noCall);
    const options = [];
    if (canServerRon(state, player, sourceTile)) {
      const option = { type: "ron", playerId: player.id, fromPlayerId, sourceTile };
      console.log("[Ron] available", { tableId: state.tableId, playerId: player.id, fromPlayerId, tile: tileKindKey(sourceTile), version: state.version });
      if (player.isRiichi) {
        ronOptions.push(option);
        continue;
      }
      ronOptions.push(option);
    }
    if (canCallAfterDiscard && !player.isRiichi && !noCall) {
      if (matchingCount >= 3 && canCallKanAfterDiscard) {
        options.push({ type: "kan", playerId: player.id, fromPlayerId, sourceTile, options: { kanType: "minkan" } });
      }
      if (matchingCount >= 2) {
        options.push({ type: "pon", playerId: player.id, fromPlayerId, sourceTile });
      }
    }
    if (options.length > 0) {
      firstCallPending ??= { playerId: player.id, options };
    }
  }
  if (ronOptions.length > 0) {
    const source = { type: "afterDiscard", fromPlayerId, sourceTile };
    if (!setServerPendingMultiRonActions(state, ronOptions, source)) return false;
    for (const option of ronOptions) {
      const ronPlayer = findPlayer(state, option.playerId);
      if (!ronPlayer?.assistSettings?.autoWin && !ronPlayer?.isRiichi) continue;
      resolveServerMultiRonResponse(state, ronPlayer, "ron", { action: option, fromPlayerId, sourceTile });
      if (!isServerMultiRonPending(state.pendingAction)) return true;
    }
    return true;
  }
  if (firstCallPending) return setServerPendingActions(state, firstCallPending.playerId, firstCallPending.options, { type: "afterDiscard", fromPlayerId, sourceTile });
  return false;
};
const advanceTurn = (state) => {
  const before = currentPlayer(state);
  if (before) before.status = "waiting";
  state.currentPlayerIndex = ((state.currentPlayerIndex ?? 0) + 1) % ensureArray(state.players).length;
  const after = currentPlayer(state);
  if (after) after.status = "active";
};
const enterCurrentTurnOnServer = (state) => {
  const player = currentPlayer(state);
  if (!player) return;
  state.pendingAction = null;
  state.phase = "waitingForHumanDiscard";
  startServerClockForPlayer(state, player);
  if (!player.drawnTile && !drawFromWall(state, player, "liveWall")) {
    state.phase = "exhaustiveDraw";
    state.activeClockPlayerId = null;
    state.clockStartedAt = null;
    state.handLog ??= {};
    state.handLog.result = calculateServerExhaustiveDraw(state);
    startResultCountdownState(state);
    appendHandEvent(state, { type: "exhaustiveDraw", turnIndex: state.turnIndex ?? 0, reason: "liveWallEmpty" });
    return;
  }
  const feverPlayer = ensureArray(state.players).find((item) => item.feverRiichiActive && (item.feverWinCount ?? 0) < 2);
  if (scheduleServerFeverForcedDiscard(state, player, feverPlayer)) return;
  const flower = findAutoFlowerTile(player);
  if (flower && beginServerFlowerAnnouncement(state, player, flower)) return;
  if (queueServerSelfDrawOptions(state, player)) return;
};
const discardForServer = (state, player, tileId, { isRiichiDiscard = false, resolveAfterDiscard = true } = {}) => {
  stopServerClockForPlayer(state, player.id, { recoverAfterDiscard: true });
  state.pendingAction = null;
  const drawn = player.drawnTile?.id === tileId ? player.drawnTile : null;
  const tile = drawn || removeTileById(player.hand, tileId);
  if (!tile) throw new Error("指定された牌を持っていません");
  if (drawn) player.drawnTile = null;
  else if (player.drawnTile) {
    player.hand ??= [];
    player.hand.push(player.drawnTile);
    player.drawnTile = null;
    player.hand = sortHandTiles(player.hand);
  }
  const discardType = drawn ? "tsumogiri" : "tedashi";
  state.activeClockPlayerId = null;
  state.clockStartedAt = null;
  player.discardedTiles ??= [];
  player.discardedTiles.push({ tile, discardType, isRiichiDiscard, turnIndex: state.turnIndex ?? 0 });
  appendHandEvent(state, { type: "discard", playerId: player.id, tile, tileId, selectedTileId: tileId, discardType, isRiichiDiscard, turnIndex: state.turnIndex ?? 0 });
  if (player.isRiichi && player.ippatsu && !isRiichiDiscard) {
    player.ippatsu = false;
    player.ippatsuOwnDrawStarted = false;
    appendHandEvent(state, { type: "ippatsuCleared", playerId: player.id, reason: "ownDrawPassed", turnIndex: state.turnIndex ?? 0 });
  }
  state.turnIndex = Number(state.turnIndex || 0) + 1;
  state.phase = "playing";
  state.pendingAction = null;
  if (resolveAfterDiscard && queueServerAfterDiscardOptions(state, player.id, tile)) return tile;
  advanceTurn(state);
  enterCurrentTurnOnServer(state);
  return tile;
};
const continueAfterServerFeverWin = (state) => {
  const result = state.handLog?.result;
  if (!result?.isFeverContinuation) return false;
  const winner = findPlayer(state, result.winnerId);
  if (winner?.drawnTile && result.winType === "tsumo") winner.drawnTile = null;
  state.handLog.result = null;
  state.resultOkPlayerIds = [];
  state.pendingAction = null;
  state.winAnnouncement = null;
  state.serverAnnouncement = null;
  state.pendingServerEffect = null;
  state.phase = "playing";
  state.isWaitingForHumanAction = false;
  advanceTurn(state);
  enterCurrentTurnOnServer(state);
  appendHandEvent(state, { type: "feverContinuation", playerId: result.winnerId, feverWinCount: result.feverWinCount ?? winner?.feverWinCount ?? 1, turnIndex: state.turnIndex ?? 0 });
  return true;
};
const addDoraAfterKan = (state) => {
  state.kanCount = Number(state.kanCount || 0) + 1;
  const indicator = ensureArray(state.liveWall).shift();
  const uraIndicator = ensureArray(state.liveWall).shift();
  if (indicator) {
    state.doraIndicators ??= [];
    state.doraIndicators.push(indicator);
    state.uraDoraIndicators ??= [];
    if (uraIndicator) state.uraDoraIndicators.push(uraIndicator);
    appendHandEvent(state, { type: "doraReveal", tile: indicator, doraIndicators: [...state.doraIndicators], uraDoraIndicators: [...state.uraDoraIndicators], turnIndex: state.turnIndex ?? 0 });
    console.log("[KanDora] revealed", {
      tableId: state.tableId,
      kanCount: state.kanCount,
      indicator: tileKindKey(indicator),
      uraIndicator: uraIndicator ? tileKindKey(uraIndicator) : null,
      doraIndicatorCount: state.doraIndicators.length,
      uraDoraIndicatorCount: state.uraDoraIndicators.length,
    });
  }
};
const applyServerAction = (state, event) => {
  if (!state || !Array.isArray(state.players)) throw new Error("GameStateが初期化されていません");
  if (!ACTION_TYPES.has(event.actionType)) throw new Error("未対応の操作です");
  const player = findPlayer(state, event.playerId);
  if (!player) throw new Error("プレイヤーが見つかりません");
  const active = currentPlayer(state);
  const payload = event.payload || {};
  const action = event.actionType;
  const actionContext = {
    tableId: event.tableId || state.tableId || "",
    gameId: event.gameId || state.gameId || "",
    playerId: event.playerId || "",
    version: state.version ?? event.turnVersion ?? "",
    actionType: action,
    eventId: event.id || "",
    phase: state.phase || "",
  };

  try {

  if (action === "agariYame") {
    const result = state.handLog?.result;
    if (!result || !["handEnded", "exhaustiveDraw"].includes(state.phase)) return state;
    if (payload.resultId && result.resultId && payload.resultId !== result.resultId) {
      console.warn("[AgariYame] stale request ignored", {
        tableId: state.tableId,
        gameId: state.gameId,
        playerId: player.id,
        payloadResultId: payload.resultId,
        currentResultId: result.resultId,
      });
      return state;
    }
    if (!isTsumoLosslessAgariYameOpportunity(state, result)) throw new Error("あがりやめできる局面ではありません");
    if (player.id !== state.round?.dealerPlayerId) throw new Error("あがりやめできるのはオーラス親だけです");
    state.agariYameDeclaredBy = player.id;
    state.agariYameResultId = result.resultId || "";
    appendHandEvent(state, { type: "agariYame", playerId: player.id, resultId: result.resultId || "", turnIndex: state.turnIndex ?? 0 });
    return prepareTsumoLosslessGameEnd(state, "agariYame");
  }

  if (action === "resultOk") {
    if (!state.handLog?.result && !["exhaustiveDraw", "handEnded"].includes(state.phase)) return state;
    if (state.phase === "gameEnded") return state;
    if (payload.resultId && state.handLog?.result?.resultId && payload.resultId !== state.handLog.result.resultId) {
      console.warn("[ResultOk] stale result ignored", {
        tableId: state.tableId,
        gameId: state.gameId,
        playerId: player.id,
        payloadResultId: payload.resultId,
        currentResultId: state.handLog.result.resultId,
        phase: state.phase,
      });
      return state;
    }
    const requiredOkPlayerIds = ensureArray(state.players).filter((p) => p.type !== "cpu").map((p) => p.id);
    const agariYameOpportunity = isTsumoLosslessAgariYameOpportunity(state, state.handLog?.result);
    const dealerId = state.round?.dealerPlayerId || "";
    const resultId = getCurrentResultId(state);
    const startedAt = Number(state.resultCountdownStartedAt || 0);
    const isTimedOut = Boolean(resultId && state.resultCountdownResultId === resultId && startedAt && now() - startedAt >= RESULT_AUTO_OK_DELAY_MS);
    const timedOutAutoOkPlayerIds = payload.autoAllResultOk && isTimedOut && !(agariYameOpportunity && player.id !== dealerId)
      ? requiredOkPlayerIds
      : [];
    const serverAutoOkPlayerIds = isTimedOut
      ? ensureArray(payload.serverAutoOkPlayerIds).filter((id) => requiredOkPlayerIds.includes(id))
      : [];
    const extraOkPlayerIds = [...new Set([...timedOutAutoOkPlayerIds, ...serverAutoOkPlayerIds])];
    if (asArray(state.resultOkPlayerIds).includes(player.id) && !extraOkPlayerIds.length) return state;
    state.resultOkPlayerIds = [...new Set([
      ...(state.resultOkPlayerIds ?? []),
      player.id,
      ...extraOkPlayerIds,
      ...ensureArray(state.players).filter((p) => p.type === "cpu").map((p) => p.id),
    ])];
    state.handLog.result.resultOkPlayerIds = [...state.resultOkPlayerIds];
    appendHandEvent(state, { type: "resultOk", playerId: player.id, resultOkPlayerIds: [...state.resultOkPlayerIds], turnIndex: state.turnIndex ?? 0 });
    const allOk = requiredOkPlayerIds.length === 0 || requiredOkPlayerIds.every((id) => state.resultOkPlayerIds.includes(id));
    if (!allOk) return state;
    if (continueAfterServerFeverWin(state)) return state;
    if (isTsumoLossless3maState(state)) {
      const result = state.handLog?.result;
      if (shouldEndTsumoLosslessHanchanAfterResult(state, result)) {
        return prepareTsumoLosslessGameEnd(state, ensureArray(state.players).some((p) => Number(p.score || 0) <= 0) ? "tobi" : "south3End");
      }
      applyTsumoLosslessRoundAdvance(state, result);
      return startNextServerHand(state);
    }
    if (state.settings?.isLastHand) {
      state.pendingAction = null;
      state.phase = "gameEnded";
      state.isWaitingForHumanAction = false;
      state.activeClockPlayerId = null;
      state.clockStartedAt = null;
      return state;
    }
    applyAnmikaRoundAdvance(state, state.handLog?.result);
    return startNextServerHand(state);
  }

  if (action === "declareLastHand") {
    state.settings ??= {};
    state.lastHandDeclaredBy = ensureArray(state.lastHandDeclaredBy).filter((id) => id !== player.id);
    if (payload.isLastHand !== false) state.lastHandDeclaredBy.push(player.id);
    state.settings.isLastHand = state.lastHandDeclaredBy.length > 0;
    state.seats = normalizeServerSeats(state.seats);
    for (const seat of state.seats) {
      if (seat?.playerId === player.id) seat.isLastHandDeclared = payload.isLastHand !== false;
    }
    appendHandEvent(state, { type: "lastHand", playerId: player.id, isLastHand: state.settings.isLastHand, turnIndex: state.turnIndex ?? 0 });
    return state;
  }

  if (action === "assistSettings") {
    player.assistSettings = {
      autoWin: Boolean(player.assistSettings?.autoWin),
      noCall: Boolean(player.assistSettings?.noCall),
      ...(payload.partial || {}),
    };
    if (state.pendingAction?.playerId === player.id && player.assistSettings.noCall) {
      const previousOptions = ensureArray(state.pendingAction.options);
      const options = ensureArray(state.pendingAction.options).filter((option) =>
        !(option.type === "pon" || option.type === "kan")
      );
      if (options.length) state.pendingAction = { ...state.pendingAction, options };
      else {
        const source = state.pendingAction.source || {};
        const fromPlayerId = previousOptions.find((option) => option.fromPlayerId)?.fromPlayerId || source.fromPlayerId || null;
        state.pendingAction = null;
        if (source.type === "afterDiscard" || fromPlayerId) {
          state.phase = "playing";
          const fromIndex = ensureArray(state.players).findIndex((p) => p.id === fromPlayerId);
          if (fromIndex >= 0) state.currentPlayerIndex = fromIndex;
          advanceTurn(state);
          enterCurrentTurnOnServer(state);
        } else if (currentPlayer(state)?.id === player.id) {
          state.phase = "waitingForHumanDiscard";
          state.isWaitingForHumanAction = true;
          startServerClockForPlayer(state, player);
        }
      }
    }
    if (payload.partial?.noCall === false && currentPlayer(state)?.id === player.id && !player.isRiichi && canServerDeclareKanNow(state)) {
      const kakan = findServerKakanCandidate(player);
      if (kakan) {
        const currentOptions = state.pendingAction?.playerId === player.id ? ensureArray(state.pendingAction.options) : [];
        const hasKakan = currentOptions.some((option) => option.type === "kan" && option.options?.kanType === "kakan");
        if (!hasKakan) {
          setServerPendingActions(state, player.id, [
            ...currentOptions,
            { type: "kan", playerId: player.id, sourceTile: kakan.tile, tile: kakan.tile, options: { kanType: "kakan", meldTile: kakan.meld?.tiles?.[0] } },
          ], { type: "selfDraw" });
        }
      }
    }
    appendHandEvent(state, { type: "assistSettings", playerId: player.id, noCall: Boolean(player.assistSettings.noCall), autoWin: Boolean(player.assistSettings.autoWin), turnIndex: state.turnIndex ?? 0 });
    return state;
  }

  const isCallKan = action === "kan" && Boolean(payload.action?.fromPlayerId || payload.fromPlayerId);
  if (["draw", "discard", "riichi", "flower", "nukiDora", "tsumo"].includes(action) && active?.id !== player.id) {
    throw new Error("現在の手番ではありません");
  }

  if (action === "kan" && !isCallKan && active?.id !== player.id) {
    throw new Error("現在の手番ではありません");
  }
  const activeFeverPlayer = ensureArray(state.players).find((item) => item.feverRiichiActive && (item.feverWinCount ?? 0) < 2);
  if (activeFeverPlayer && activeFeverPlayer.id !== player.id && ["ron", "tsumo", "pon", "kan", "riichi", "flower", "nukiDora"].includes(action)) {
    throw new Error("フィーバーリーチ中の他家はツモ切りのみです");
  }

  if (isServerMultiRonPending(state.pendingAction) && ["ron", "skip"].includes(action)) {
    resolveServerMultiRonResponse(state, player, action, payload);
    return state;
  }

  if (action === "draw") {
    if (player.drawnTile) throw new Error("すでにツモ牌があります");
    drawFromWall(state, player, "liveWall");
    state.phase = "waitingForHumanDiscard";
    const feverPlayer = ensureArray(state.players).find((item) => item.feverRiichiActive && (item.feverWinCount ?? 0) < 2);
    if (scheduleServerFeverForcedDiscard(state, player, feverPlayer)) return state;
    const flower = findAutoFlowerTile(player);
    if (flower && beginServerFlowerAnnouncement(state, player, flower)) return state;
    if (!queueServerSelfDrawOptions(state, player)) startServerClockForPlayer(state, player);
    return state;
  }

  if (action === "discard") {
    const feverPlayer = ensureArray(state.players).find((item) => item.feverRiichiActive && (item.feverWinCount ?? 0) < 2);
    const forcedTsumogiri = Boolean(feverPlayer && feverPlayer.id !== player.id && player.drawnTile);
    if (forcedTsumogiri && isFlowerTile(player.drawnTile)) {
      if (beginServerFlowerAnnouncement(state, player, player.drawnTile)) return state;
    }
    const tileId = forcedTsumogiri ? player.drawnTile.id : (payload.tileId || payload.tile?.id);
    if (!tileId) throw new Error("打牌する牌が指定されていません");
    const isRiichiChoiceDiscard = state.pendingAction?.playerId === player.id &&
      ensureArray(state.pendingAction?.options).some((option) => option.type === "riichi") &&
      state.phase !== "waitingForRiichiDiscard";
    if (isRiichiChoiceDiscard) {
      player.riichiDiscardTileIds = [];
    }
    state.pendingAction = null;
    discardForServer(state, player, tileId, { isRiichiDiscard: state.phase === "waitingForRiichiDiscard" && !forcedTsumogiri });
    return state;
  }

  if (action === "riichi") {
    const riichiDiscardTileIds = getServerRiichiDiscardTileIds(player);
    if (!riichiDiscardTileIds.length) throw new Error("リーチできる打牌がありません");
    if (payload.tileId && !riichiDiscardTileIds.includes(payload.tileId)) {
      throw new Error("その牌ではリーチできません");
    }
    player.riichiDiscardTileIds = riichiDiscardTileIds;
    if (payload.tileId) {
      let riichiStickPoints = 0;
      player.isRiichi = true;
      player.ippatsu = true;
      player.riichiTurnIndex = state.turnIndex ?? 0;
      player.ippatsuOwnDrawStarted = false;
      player.feverWinCount = 0;
      player.assistSettings = { ...(player.assistSettings || {}), autoWin: true };
      if (isTsumoLossless3maState(state) && !player.riichiStickPaid) {
        player.score = Number(player.score || 0) - 1000;
        player.riichiStickPaid = true;
        state.riichiStickCount = Number(state.riichiStickCount || 0) + 1;
        riichiStickPoints = 1000;
      }
      const afterRiichiDiscardTiles = combinedHandTiles(player).filter((item) => item.id !== payload.tileId);
      player.feverRiichiActive = isServerFeverRiichiEligibleAfterDiscard(state, player, afterRiichiDiscardTiles);
      discardForServer(state, player, payload.tileId, { isRiichiDiscard: true });
      appendHandEvent(state, { type: "riichi", playerId: player.id, feverRiichiActive: player.feverRiichiActive, riichiStickPoints, turnIndex: state.turnIndex ?? 0 });
      player.riichiDiscardTileIds = [];
    } else {
      state.pendingAction = null;
      state.phase = "waitingForRiichiDiscard";
      state.isWaitingForHumanAction = true;
      startServerClockForPlayer(state, player);
    }
    return state;
  }

  if (action === "skip") {
    stopServerClockForPlayer(state, player.id, { recoverAfterDiscard: false });
    appendHandEvent(state, { type: "skipAction", playerId: player.id, actionType: payload.pending?.options?.[0]?.type || "skip", turnIndex: state.turnIndex ?? 0 });
    const pendingSource = state.pendingAction?.source || payload.pending?.source || null;
    state.pendingAction = null;
    if (pendingSource?.type === "afterDiscard") {
      state.phase = "playing";
      const fromIndex = ensureArray(state.players).findIndex((p) => p.id === pendingSource.fromPlayerId);
      if (fromIndex >= 0) state.currentPlayerIndex = fromIndex;
      advanceTurn(state);
      enterCurrentTurnOnServer(state);
    } else {
      state.phase = "waitingForHumanDiscard";
      state.isWaitingForHumanAction = true;
      startServerClockForPlayer(state, player);
    }
    return state;
  }

  if (action === "flower" || action === "nukiDora") {
    const actionTile = payload.action?.sourceTile || payload.action?.tile || payload.sourceTile || payload.tile;
    const tileId = payload.tileId || actionTile?.id;
    const removedFromDrawn = tileId === player.drawnTile?.id;
    const tile = removedFromDrawn ? player.drawnTile : removeTileById(player.hand, tileId);
    if (!tile || !isNukiDoraTileForState(state, tile)) throw new Error("抜きドラにできる牌がありません");
    if (removedFromDrawn) player.drawnTile = null;
    player.nukiDoraTiles ??= [];
    player.nukiDoraTiles.push(tile);
    const replacementTile = ensureArray(state.rinshanWall)[0] || null;
    appendHandEvent(state, { type: "nukiDora", playerId: player.id, tile, replacementTile, turnIndex: state.turnIndex ?? 0 });
    drawRinshanAfterFlower(state, player, removedFromDrawn);
    player.hand = sortHandTiles(player.hand);
    state.phase = "waitingForHumanDiscard";
    const nextFlower = findAutoFlowerTile(player);
    if (nextFlower && beginServerFlowerAnnouncement(state, player, nextFlower)) return state;
    if (!queueServerSelfDrawOptions(state, player)) startServerClockForPlayer(state, player);
    return state;
  }

  if (action === "kan") {
    const option = payload.action || {};
    const sourceTile = option.sourceTile || payload.sourceTile;
    const fromPlayerId = option.fromPlayerId || payload.fromPlayerId;
    const tileId = payload.tileId || option.tile?.id || payload.tile?.id || sourceTile?.id;
    const baseTile = sourceTile || (tileId === player.drawnTile?.id ? player.drawnTile : ensureArray(player.hand).find((tile) => tile.id === tileId));
    if (!baseTile) throw new Error("カンする牌が見つかりません");
    const same = (tile) => sameTileKind(tile, baseTile);
    const tiles = [];
    const isMinkan = Boolean(fromPlayerId && sourceTile);
    const kanType = option.options?.kanType || payload.kanType || option.kanType;
    if (!canServerDeclareKanNow(state)) {
      throw new Error("最終ツモまたは嶺上牌がない局面ではカンできません");
    }
    if (player.assistSettings?.noCall) throw new Error("鳴きなし中はカンできません");
    if (kanType === "kakan") {
      const targetMeld = ensureArray(player.melds).find((meld) => meld?.type === "pon" && meld?.tiles?.[0] && sameTileKind(meld.tiles[0], baseTile));
      if (!targetMeld) throw new Error("加槓できるポンがありません");
      let addedTile = null;
      if (player.drawnTile && same(player.drawnTile)) {
        addedTile = player.drawnTile;
        player.drawnTile = null;
      } else {
        addedTile = removeTileById(player.hand, tileId) || removeTileById(player.hand, ensureArray(player.hand).find(same)?.id);
      }
      if (!addedTile) throw new Error("加槓する牌が見つかりません");
      targetMeld.type = "kakan";
      targetMeld.addedTile = addedTile;
      targetMeld.tiles = [...ensureArray(targetMeld.tiles), addedTile];
      appendHandEvent(state, { type: "kan", playerId: player.id, tiles: targetMeld.tiles, addedTile, kanType: "kakan", turnIndex: state.turnIndex ?? 0 });
      clearServerIppatsu(state, "kan");
      addDoraAfterKan(state);
      state.pendingRinshanKaihouFromKan = true;
      drawFromWall(state, player, "rinshanWall");
      player.hand = sortHandTiles(player.hand);
      state.currentPlayerIndex = state.players.findIndex((p) => p.id === player.id);
      state.players.forEach((p) => { p.status = p.id === player.id ? "active" : "waiting"; });
      state.pendingAction = null;
      state.phase = "waitingForHumanDiscard";
      const nextFlower = findAutoFlowerTile(player);
      if (nextFlower && beginServerFlowerAnnouncement(state, player, nextFlower)) return state;
      if (!queueServerSelfDrawOptions(state, player)) startServerClockForPlayer(state, player);
      return state;
    }
    if (!isMinkan && player.isRiichi && !isRiichiSafeAnkanTile(player, baseTile)) {
      throw new Error("待ちが変わるためリーチ後はカンできません");
    }
    if (isMinkan) {
      tiles.push(removeLastMatchingDiscard(state, fromPlayerId, sourceTile) || sourceTile);
    } else if (player.drawnTile && same(player.drawnTile)) {
      tiles.push(player.drawnTile);
      player.drawnTile = null;
    }
    player.hand = ensureArray(player.hand).filter((tile) => {
      if (same(tile) && tiles.length < 4) { tiles.push(tile); return false; }
      return true;
    });
    if (tiles.length < 4) throw new Error("カンに必要な4枚がありません");
    player.melds ??= [];
    const meld = { type: isMinkan ? "minkan" : "ankan", tiles, calledTile: isMinkan ? tiles[0] : undefined, fromPlayerId: isMinkan ? fromPlayerId : undefined };
    player.melds.push(meld);
    appendHandEvent(state, { type: "kan", playerId: player.id, fromPlayerId: isMinkan ? fromPlayerId : undefined, tiles, kanType: isMinkan ? "minkan" : "ankan", turnIndex: state.turnIndex ?? 0 });
    if (isMinkan) updateServerPaoResponsibilityAfterOpenMeld(state, player, meld, fromPlayerId);
    clearServerIppatsu(state, "kan");
    addDoraAfterKan(state);
    if (!isMinkan && player.drawnTile) {
      player.hand ??= [];
      player.hand.push(player.drawnTile);
      player.drawnTile = null;
    }
    state.pendingRinshanKaihouFromKan = true;
    drawFromWall(state, player, "rinshanWall");
    player.hand = sortHandTiles(player.hand);
    state.currentPlayerIndex = state.players.findIndex((p) => p.id === player.id);
    state.players.forEach((p) => { p.status = p.id === player.id ? "active" : "waiting"; });
    state.pendingAction = null;
    state.phase = "waitingForHumanDiscard";
    const nextFlower = findAutoFlowerTile(player);
    if (nextFlower && beginServerFlowerAnnouncement(state, player, nextFlower)) return state;
    if (!queueServerSelfDrawOptions(state, player)) startServerClockForPlayer(state, player);
    return state;
  }

  if (action === "pon") {
    if (player.assistSettings?.noCall) throw new Error("鳴きなし中はポンできません");
    if (!hasLiveWallAfterCurrentDraw(state)) throw new Error("最後の打牌にはポンできません");
    const option = payload.action || {};
    const sourceTile = option.sourceTile || payload.sourceTile;
    const fromPlayerId = option.fromPlayerId || payload.fromPlayerId;
    if (!sourceTile || !fromPlayerId) throw new Error("ポン元の牌がありません");
    beginServerPonAnnouncement(state, player, { fromPlayerId, sourceTile });
    return state;
  }

  if (action === "ron" || action === "tsumo") {
    if (action === "ron") console.log("[Ron] clicked", { tableId: state.tableId, playerId: player.id, version: state.version });
    const winningTile = action === "tsumo"
      ? player.drawnTile
      : (payload.tile || payload.action?.sourceTile || payload.sourceTile);
    const loserId = payload.action?.fromPlayerId || payload.discarderId || payload.fromPlayerId;
    const pochiResolution = action === "tsumo" ? resolveServerPochiWin(state, player, winningTile, action, loserId) : null;
    const effectiveWinningTile = pochiResolution?.selectedWait || winningTile;
    const displayWinningTile = pochiResolution?.scoreResult?.displayWinningTile || winningTile;
    const winCheck = pochiResolution?.winCheck || evaluateServerWin(state, player, effectiveWinningTile, action);
    if (!winCheck.canWin) {
      if (action === "ron") console.log("[Ron] rejected", { tableId: state.tableId, playerId: player.id, reason: winCheck.reason || "和了できません", version: state.version });
      throw new Error(winCheck.reason || "和了できません");
    }
    if (action === "ron") {
      const waits = getWinningTilesForServerTenpai(player);
      if (isServerFuritenForWaits(player, waits)) {
        console.log("[Ron] rejected", { tableId: state.tableId, playerId: player.id, reason: "フリテンのためロンできません", version: state.version });
        throw new Error("フリテンのためロンできません");
      }
    }
    const scoreResult = applyServerWinRake(
      state,
      player.id,
      pochiResolution?.scoreResult || calculateServerScoreResult(state, player, action, effectiveWinningTile, loserId, winCheck.yaku),
    );
    const pao = applyServerPaoToScoreResult(state, player, scoreResult);
    const riichiStickCount = isTsumoLossless3maState(state) ? Number(state.riichiStickCount || 0) : 0;
    const riichiStickPoints = riichiStickCount * 1000;
    if (riichiStickPoints > 0) {
      scoreResult.payments ??= Object.fromEntries(ensureArray(state.players).map((p) => [p.id, 0]));
      scoreResult.payments[player.id] = Number(scoreResult.payments[player.id] || 0) + riichiStickPoints;
      scoreResult.paymentDeltas = Object.entries(scoreResult.payments).map(([playerId, delta]) => ({ playerId, delta }));
      scoreResult.winnerGain = Number(scoreResult.payments[player.id] || 0);
      scoreResult.riichiStickCount = riichiStickCount;
      scoreResult.riichiStickPoints = riichiStickPoints;
      state.riichiStickCount = 0;
    }
    for (const p of ensureArray(state.players)) {
      p.score = Number(p.score || 0) + Number(scoreResult.payments?.[p.id] || 0);
    }
    const chipSettlement = isTsumoLossless3maState(state)
      ? (scoreResult.chipSettlement || calculateTsumoLosslessChipSettlement(state, player, action, loserId, scoreResult))
      : null;
    const tobiPrize = isTsumoLossless3maState(state)
      ? calculateTsumoLosslessTobiPrize(state, player.id, action, loserId)
      : null;
    applyServerPaoToExtraSettlement(state, player, chipSettlement, pao);
    if (chipSettlement?.payments) accumulateTsumoLosslessClubPointPayments(state, chipSettlement.payments);
    if (tobiPrize?.payments) accumulateTsumoLosslessClubPointPayments(state, tobiPrize.payments);
    let isFeverContinuation = false;
    if (player.feverRiichiActive) {
      player.feverWinCount = Number(player.feverWinCount || 0) + 1;
      isFeverContinuation = player.feverWinCount < 2;
      if (!isFeverContinuation) player.feverRiichiActive = false;
    }
    state.pendingAction = null;
    state.handLog ??= {};
    state.handLog.result = {
      resultId: randomUUID(),
      createdAt: now(),
      type: "win",
      winnerId: player.id,
      loserId,
      winType: action,
      winningTile: displayWinningTile,
      scoringWinningTile: effectiveWinningTile,
      scoreResult,
      payments: scoreResult.paymentDeltas,
      chipSettlement,
      tobiPrize,
      riichiStickCount,
      riichiStickPoints,
      isFeverContinuation,
      feverWinCount: player.feverWinCount ?? 0,
    };
    resetResultCountdownState(state);
    if (action === "ron") console.log("[Ron] accepted", { tableId: state.tableId, playerId: player.id, fromPlayerId: loserId, version: state.version });
    scoreResult.displayWinningTile ??= displayWinningTile;
    appendHandEvent(state, { type: action, playerId: player.id, fromPlayerId: loserId, tile: displayWinningTile, scoringTile: effectiveWinningTile, originalTile: winningTile, scoreResult, turnIndex: state.turnIndex ?? 0 });
    beginServerWinAnnouncement(state, player, action, scoreResult);
    return state;
  }

  return state;
  } catch (error) {
    if (GUARDED_ACTION_TYPES.has(action)) {
      const exceptionId = logServerException(`game:action:${action}`, error, actionContext);
      logGameStateSyncFailure(`game:action:${action}`, error, { ...actionContext, exceptionId });
      const wrappedError = new Error(`${error?.message || "操作中にサーバー例外が発生しました"} (exceptionId: ${exceptionId})`);
      wrappedError.exceptionId = exceptionId;
      throw wrappedError;
    }
    throw error;
  }
};

const autoDiscardForCpu = (state, player) => {
  if (!player.drawnTile) drawFromWall(state, player, "liveWall");
  const tileId = player.drawnTile?.id || player.hand?.[player.hand.length - 1]?.id;
  if (!tileId) return false;
  discardForServer(state, player, tileId);
  return true;
};

const advanceServerCpuTurns = (state) => {
  const player = currentPlayer(state);
  if (state.pendingAction || state.pendingServerEffect || ["waitingForAction", "showingFlowerAnnouncement"].includes(state.phase)) return false;
  if (!player || player.type !== "cpu" || ["handEnded", "exhaustiveDraw", "gameEnded"].includes(state.phase)) return false;
  state.phase = "cpuThinking";
  state.cpuThinkingPlayerId = player.id;
  state.cpuThinkingMessage = `${player.name} 思考中...`;
  state.pendingServerEffect = {
    type: "cpuDiscard",
    playerId: player.id,
    resumeAt: Date.now() + 700,
  };
  return true;
};

const applyServerCpuDiscardEffect = (state) => {
  const effect = state.pendingServerEffect;
  if (!effect || effect.type !== "cpuDiscard") return false;
  const player = findPlayer(state, effect.playerId);
  state.pendingServerEffect = null;
  state.cpuThinkingPlayerId = null;
  state.cpuThinkingMessage = "";
  if (!player || player.type !== "cpu") {
    state.phase = "playing";
    return false;
  }
  state.phase = "playing";
  return autoDiscardForCpu(state, player);
};

const applyServerRiichiAutoDiscardEffect = (state) => {
  const effect = state.pendingServerEffect;
  if (!effect || effect.type !== "riichiAutoDiscard") return false;
  const player = findPlayer(state, effect.playerId);
  state.pendingServerEffect = null;
  const isFeverForcedDiscard = effect.reason === "feverRiichiForcedDiscard";
  if (!player || (!player.isRiichi && !isFeverForcedDiscard)) {
    state.phase = "playing";
    return false;
  }
  if (!player.drawnTile) {
    state.phase = "waitingForHumanDiscard";
    return false;
  }
  if (isFeverForcedDiscard && isFlowerTile(player.drawnTile)) {
    return beginServerFlowerAnnouncement(state, player, player.drawnTile);
  }
  state.phase = "playing";
  appendHandEvent(state, { type: isFeverForcedDiscard ? "feverForcedDiscard" : "riichiAutoDiscard", playerId: player.id, tile: player.drawnTile, turnIndex: state.turnIndex ?? 0 });
  return Boolean(discardForServer(state, player, player.drawnTile.id));
};

const applyServerClockTimeout = (state) => {
  const playerId = state?.activeClockPlayerId;
  if (!playerId || state.handLog?.result || ["handEnded", "exhaustiveDraw", "gameEnded", "showingFlowerAnnouncement"].includes(state.phase)) return false;
  const player = findPlayer(state, playerId);
  if (!player) return false;
  if (isServerMultiRonPending(state.pendingAction) && state.pendingAction.playerIds?.includes?.(playerId)) {
    resolveServerMultiRonResponse(state, player, "skip", { pending: clone(state.pendingAction), reason: "timeout" });
    return true;
  }
  if (state.pendingAction?.playerId === playerId) {
    applyServerAction(state, {
      playerId,
      actionType: "skip",
      payload: { pending: clone(state.pendingAction), reason: "timeout" },
    });
    return true;
  }
  const active = currentPlayer(state);
  if (active?.id !== playerId) return false;
  const tileId = player.drawnTile?.id || player.hand?.at(-1)?.id;
  if (!tileId) return false;
  discardForServer(state, player, tileId);
  return true;
};

const isRocketTargetTile = (suit, rank) => (suit === "manzu" && (rank === 1 || rank === 9)) || ((suit === "pinzu" || suit === "souzu") && (rank === 1 || rank === 9));

const colorByComposition = (composition, copy) => {
  if (composition === "red4") return "red";
  if (composition === "red2blue2") return copy <= 2 ? "red" : "blue";
  if (composition === "blackBlackRedRed") return copy <= 2 ? "normal" : "red";
  return copy <= 3 ? "red" : "blue";
};
const flowerColorByComposition = (composition, copy) => {
  if (composition === "red4") return "red";
  if (composition === "red2blue2") return copy <= 2 ? "red" : "blue";
  return copy <= 3 ? "red" : "blue";
};

const colorForNumberTile = (suit, rank, copy, ruleConfig = DEFAULT_RULE_CONFIG, ruleId = "anmika-rocket") => {
  if (ruleId === TSUMO_LOSSLESS_3MA_RULE_ID && rank === 5 && (suit === "pinzu" || suit === "souzu")) {
    return colorByComposition(ruleConfig.fiveTileComposition, copy);
  }
  if (rank === 5 && suit === "pinzu") {
    if (ruleConfig.turquoise5pCount === 1) return copy === 1 ? "red" : copy === 2 ? "gold" : copy === 3 ? "blue" : "turquoise";
    if (ruleConfig.turquoise5pCount === 2) return copy <= 2 ? "turquoise" : copy === 3 ? "gold" : "blue";
    return copy <= 2 ? "red" : copy === 3 ? "gold" : "blue";
  }
  if (rank === 5 && suit === "souzu") return copy <= 2 ? "red" : copy === 3 ? "gold" : "blue";
  if (ruleConfig.rocket19Enabled && copy === 4 && isRocketTargetTile(suit, rank)) return "blue";
  return "normal";
};

const createWallTiles = (ruleConfigInput = {}, ruleId = "anmika-rocket") => {
  const ruleConfig = normalizeRuleConfigForRule(ruleId, ruleConfigInput);
  const tiles = [];
  for (const spec of [{ suit: "manzu", ranks: [1, 9] }, { suit: "pinzu", ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { suit: "souzu", ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9] }]) {
    for (const rank of spec.ranks) {
      for (let copy = 1; copy <= 4; copy++) {
        const isRocket = Boolean(ruleId !== TSUMO_LOSSLESS_3MA_RULE_ID && ruleConfig.rocket19Enabled && copy === 4 && isRocketTargetTile(spec.suit, rank));
        tiles.push({
          id: `${spec.suit}-${rank}-${copy}${isRocket ? "-rocket" : ""}`,
          suit: spec.suit,
          rank,
          color: colorForNumberTile(spec.suit, rank, copy, ruleConfig, ruleId),
          isPochi: false,
          isRocket,
        });
      }
    }
  }
  const usePochi = ruleId !== TSUMO_LOSSLESS_3MA_RULE_ID;
  const pochiColors = ["red", "yellow", "green", "blue"];
  for (const kind of ["east", "south", "west", "north", "white", "green", "red"]) {
    for (let copy = 1; copy <= 4; copy++) {
      const tile = { id: `honor-${kind}-${copy}`, suit: "honor", kind, color: "normal", isPochi: usePochi && kind === "white" };
      if (usePochi && kind === "white") tile.pochiColor = pochiColors[copy - 1];
      tiles.push(tile);
    }
  }
  for (let copy = 1; copy <= 4; copy++) {
    tiles.push({ id: `flower-hua-${copy}`, suit: "flower", kind: "flower", color: ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? flowerColorByComposition(ruleConfig.flowerComposition, copy) : (copy <= 3 ? "red" : "blue"), isPochi: false });
  }
  return tiles;
};

const shuffle = (items) => {
  const copied = [...items];
  for (let i = copied.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
};

const splitStartingWalls = (wall, rinshanCount = 8) => {
  const copied = [...wall];
  return { rinshanWall: copied.splice(-Math.max(8, Number(rinshanCount) || 8)), doraIndicators: copied.splice(-1), uraDoraIndicators: copied.splice(-1), liveWall: copied };
};

const sortHandTiles = (hand) => {
  const suitOrder = { manzu: 0, pinzu: 1, souzu: 2, honor: 3, flower: 4 };
  const honorOrder = { east: 0, south: 1, west: 2, north: 3, white: 4, green: 5, red: 6 };
  return [...hand].sort((a, b) => {
    const suitDiff = (suitOrder[a.suit] ?? 99) - (suitOrder[b.suit] ?? 99);
    if (suitDiff) return suitDiff;
    if (a.suit === "honor") return (honorOrder[a.kind] ?? 99) - (honorOrder[b.kind] ?? 99);
    return Number(a.rank || 0) - Number(b.rank || 0) || String(a.id).localeCompare(String(b.id));
  });
};

const allWinningCheckTiles = () => [
  { suit: "manzu", rank: 1 }, { suit: "manzu", rank: 9 },
  ...Array.from({ length: 9 }, (_, index) => ({ suit: "pinzu", rank: index + 1 })),
  ...Array.from({ length: 9 }, (_, index) => ({ suit: "souzu", rank: index + 1 })),
  ..."east,south,west,north,white,green,red".split(",").map((kind) => ({ suit: "honor", kind })),
].map((tile, index) => ({ id: `virtual-${index}-${tile.suit}-${tile.rank || tile.kind}`, color: "normal", isPochi: false, ...tile }));
const countTilesForShape = (tiles) => {
  const counts = new Map();
  for (const tile of ensureArray(tiles).filter((item) => !isFlowerTile(item))) {
    const key = tileKindKey(tile);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
};
const cloneCounts = (counts) => new Map(counts);
const isKokushiShape = (counts) => {
  const required = ["manzu:1", "manzu:9", "pinzu:1", "pinzu:9", "souzu:1", "souzu:9", "honor:east", "honor:south", "honor:west", "honor:north", "honor:white", "honor:green", "honor:red"];
  let pair = false;
  for (const key of required) {
    const count = counts.get(key) || 0;
    if (count === 0) return false;
    if (count >= 2) pair = true;
  }
  return pair && [...counts.keys()].every((key) => required.includes(key));
};
const isSevenPairsShapeServer = (counts) => {
  let pairs = 0;
  for (const count of counts.values()) {
    if (count === 2) pairs += 1;
    else if (count === 4) pairs += 2;
    else return false;
  }
  return pairs === 7;
};
const canRemoveAllMelds = (counts) => {
  const first = firstPositiveCountEntry(counts);
  if (!first) return true;
  const [key, count] = first;
  if (count >= 3) {
    const next = cloneCounts(counts);
    next.set(key, count - 3);
    if (canRemoveAllMelds(next)) return true;
  }
  const [suit, rawRank] = key.split(":");
  const rank = Number(rawRank);
  if ((suit === "pinzu" || suit === "souzu") && rank >= 1 && rank <= 7) {
    const key2 = `${suit}:${rank + 1}`;
    const key3 = `${suit}:${rank + 2}`;
    if ((counts.get(key2) || 0) > 0 && (counts.get(key3) || 0) > 0) {
      const next = cloneCounts(counts);
      next.set(key, (next.get(key) || 0) - 1);
      next.set(key2, (next.get(key2) || 0) - 1);
      next.set(key3, (next.get(key3) || 0) - 1);
      if (canRemoveAllMelds(next)) return true;
    }
  }
  return false;
};
const isStandardWinWithMeldsServer = (counts, meldCount = 0) => {
  const neededMelds = 4 - meldCount;
  if (neededMelds < 0) return false;
  for (const [key, count] of counts.entries()) {
    if (count < 2) continue;
    const next = cloneCounts(counts);
    next.set(key, count - 2);
    const remainingTiles = [...next.values()].reduce((sum, value) => sum + value, 0);
    if (remainingTiles !== neededMelds * 3) continue;
    if (canRemoveAllMelds(next)) return true;
  }
  return false;
};
const isWinningShapeServer = (tiles, melds = []) => {
  const filtered = ensureArray(tiles).filter((tile) => !isFlowerTile(tile));
  const meldCount = ensureArray(melds).length;
  if (filtered.length + meldCount * 3 !== 14) return false;
  const counts = countTilesForShape(filtered);
  if (meldCount === 0 && isKokushiShape(counts)) return true;
  if (meldCount === 0 && isSevenPairsShapeServer(counts)) return true;
  return isStandardWinWithMeldsServer(counts, meldCount);
};
const getHand13ForServerTenpai = (player) => {
  const expectedLength = 13 - ensureArray(player.melds).length * 3;
  const hand = [...ensureArray(player.hand), ...(player?.drawnTile ? [player.drawnTile] : [])].filter((tile) => !isFlowerTile(tile));
  if (hand.length === expectedLength) return hand;
  return hand.slice(0, Math.max(0, expectedLength));
};
const getWinningTilesForServerTenpai = (player) => {
  const hand13 = getHand13ForServerTenpai(player);
  const melds = ensureArray(player.melds);
  const expectedLength = 13 - melds.length * 3;
  if (hand13.length !== expectedLength) return [];
  const seen = new Set();
  return allWinningCheckTiles().filter((tile) => {
    const key = tileKindKey(tile);
    if (seen.has(key)) return false;
    if (!isWinningShapeServer([...hand13, tile], melds)) return false;
    seen.add(key);
    return true;
  });
};
const calculateServerExhaustiveDraw = (state) => {
  const nagashiWinner = ensureArray(state.players).find(isServerNagashiYakumanPlayer);
  if (nagashiWinner) {
    const lastDiscard = ensureArray(nagashiWinner.discardedTiles).at(-1)?.tile || ensureArray(nagashiWinner.discardedTiles).at(-1) || null;
    const yaku = [{ name: "流し役満", han: 13, isYakuman: true }];
    const scoreResult = applyServerWinRake(state, nagashiWinner.id, calculateServerScoreResult(state, nagashiWinner, "tsumo", lastDiscard, null, yaku));
    const chipSettlement = isTsumoLossless3maState(state)
      ? calculateTsumoLosslessChipSettlement(state, nagashiWinner, "tsumo", null, scoreResult)
      : null;
    if (chipSettlement?.payments) accumulateTsumoLosslessClubPointPayments(state, chipSettlement.payments);
    if (chipSettlement) scoreResult.chipSettlement = chipSettlement;
    for (const player of ensureArray(state.players)) {
      player.score = Number(player.score || 0) + Number(scoreResult.payments?.[player.id] || 0);
    }
    return {
      resultId: randomUUID(),
      createdAt: now(),
      type: "win",
      winnerId: nagashiWinner.id,
      loserId: null,
      winType: "tsumo",
      winningTile: lastDiscard,
      scoreResult,
      chipSettlement,
      payments: scoreResult.paymentDeltas,
      reason: "nagashiYakuman",
      finalScores: Object.fromEntries(ensureArray(state.players).map((player) => [player.id, player.score])),
    };
  }
  const activeFeverPlayer = ensureArray(state.players).find((player) => player.feverRiichiActive && (player.feverWinCount ?? 0) < 2);
  const tenpaiResults = ensureArray(state.players).map((player) => {
    const handTiles = getHand13ForServerTenpai(player);
    if (activeFeverPlayer && player.id !== activeFeverPlayer.id) {
      return { playerId: player.id, isTenpai: false, waits: [], handTiles, forcedNotenByFeverRiichi: true };
    }
    const waits = getWinningTilesForServerTenpai(player);
    return { playerId: player.id, isTenpai: waits.length > 0, waits, handTiles };
  });
  const tenpaiPlayerIds = tenpaiResults.filter((item) => item.isTenpai).map((item) => item.playerId);
  const paymentMap = Object.fromEntries(ensureArray(state.players).map((player) => [player.id, 0]));
  if (isTsumoLossless3maState(state)) {
    const notenPlayerIds = ensureArray(state.players).filter((player) => !tenpaiPlayerIds.includes(player.id)).map((player) => player.id);
    if (tenpaiPlayerIds.length > 0 && notenPlayerIds.length > 0) {
      for (const notenId of notenPlayerIds) paymentMap[notenId] = -1000 * tenpaiPlayerIds.length;
      for (const tenpaiId of tenpaiPlayerIds) paymentMap[tenpaiId] = 1000 * notenPlayerIds.length;
    }
  } else if (tenpaiPlayerIds.length === 1) {
    paymentMap[tenpaiPlayerIds[0]] = 30;
    for (const player of ensureArray(state.players)) if (!tenpaiPlayerIds.includes(player.id)) paymentMap[player.id] = -15;
  } else if (tenpaiPlayerIds.length === 2) {
    for (const id of tenpaiPlayerIds) paymentMap[id] = 15;
    for (const player of ensureArray(state.players)) if (!tenpaiPlayerIds.includes(player.id)) paymentMap[player.id] = -30;
  }
  for (const player of ensureArray(state.players)) player.score = Number(player.score || 0) + (paymentMap[player.id] || 0);
  return {
    resultId: randomUUID(),
    createdAt: now(),
    type: "exhaustiveDraw",
    reason: "liveWallEmpty",
    tenpaiResults,
    tenpaiPlayerIds,
    notenPlayerIds: ensureArray(state.players).filter((player) => !tenpaiPlayerIds.includes(player.id)).map((player) => player.id),
    payments: Object.entries(paymentMap).map(([playerId, delta]) => ({ playerId, delta })),
    finalScores: Object.fromEntries(ensureArray(state.players).map((player) => [player.id, player.score])),
  };
};

const startNextServerHand = (state) => {
  const result = state.handLog?.result;
  const ruleId = state.settings?.ruleId || state.settings?.gameType || "anmika-rocket";
  const isTsumoLossless = ruleId === TSUMO_LOSSLESS_3MA_RULE_ID;
  const nextRoundIndex = isTsumoLossless ? getTsumoLosslessRoundIndex(state) : 0;
  const nextDealerId = isTsumoLossless
    ? getTsumoLosslessDealerIdForRound(state, nextRoundIndex)
    : (result?.type === "win" ? result.winnerId : state.round?.dealerPlayerId || state.players?.[0]?.id || "");
  const handNumber = isTsumoLossless ? nextRoundIndex + 1 : Number(state.round?.handNumber || 1) + 1;
  const ruleConfig = normalizeRuleConfigForRule(ruleId, state.settings?.ruleConfig);
  const walls = splitStartingWalls(shuffle(createWallTiles(ruleConfig, ruleId)), ruleId === TSUMO_LOSSLESS_3MA_RULE_ID && ruleConfig.northNukiDoraEnabled ? 12 : 8);
  Object.assign(state, {
    ...walls,
    kanCount: 0,
    currentPlayerIndex: Math.max(0, ensureArray(state.players).findIndex((player) => player.id === nextDealerId)),
    turnIndex: 0,
    isWaitingForHumanAction: false,
    phase: "playing",
    pendingAction: null,
    lastDrawnTile: null,
    rinshanKaihou: null,
    pendingRinshanKaihouFromKan: false,
    paoResponsibilities: {},
    lastScoreResult: null,
    winAnnouncement: null,
    flowerAnnouncement: null,
    playerClocks: createServerPlayerClocks(state.players, state.settings?.initialClockMs || 20000),
    activeClockPlayerId: null,
    clockStartedAt: null,
    lastClockRenderTick: null,
  });
  resetResultCountdownState(state);
  state.round ??= {};
  state.round.initialSeatOrder = ensureArray(state.round.initialSeatOrder).length ? state.round.initialSeatOrder : ensureArray(state.players).map((player) => player.id);
  state.round.roundWind = isTsumoLossless && nextRoundIndex >= 3 ? "south" : "east";
  state.round.handNumber = handNumber;
  state.round.hanchanRoundIndex = nextRoundIndex;
  state.round.dealerPlayerId = nextDealerId;
  for (const player of ensureArray(state.players)) {
    const assistSettings = { autoWin: Boolean(player.assistSettings?.autoWin), noCall: false };
    Object.assign(player, {
      hand: [],
      drawnTile: null,
      discardedTiles: [],
      nukiDoraTiles: [],
      melds: [],
      status: "waiting",
      isRiichi: false,
      ippatsu: false,
      riichiTurnIndex: null,
      ippatsuOwnDrawStarted: false,
      sameTurnFuriten: false,
      riichiDiscardTileIds: [],
      riichiStickPaid: false,
      feverRiichiActive: false,
      feverWinCount: 0,
      assistSettings,
    });
  }
  for (let i = 0; i < 13; i++) {
    for (const player of ensureArray(state.players)) {
      const tile = state.liveWall.shift();
      if (tile) player.hand.push(tile);
    }
  }
  for (const player of ensureArray(state.players)) player.hand = sortHandTiles(player.hand);
  const dealerIndex = Math.max(0, ensureArray(state.players).findIndex((player) => player.id === nextDealerId));
  state.currentPlayerIndex = dealerIndex;
  if (state.players[dealerIndex]) state.players[dealerIndex].status = "active";
  state.handLog = {
    handId: `socket-${state.activeTableId || "table"}-${Date.now()}`,
    roundLabel: isTsumoLossless ? (TSUMO_LOSSLESS_ROUNDS[nextRoundIndex] || "南3局") : "東場",
    dealerId: nextDealerId,
    events: [],
    initialSeatOrder: ensureArray(state.round.initialSeatOrder),
    initialPlayers: ensureArray(state.players).map((player, seatIndex) => ({ id: player.id, name: player.name, type: player.type, seatIndex })),
    initialHands: Object.fromEntries(ensureArray(state.players).map((player) => [player.id, [...player.hand]])),
    initialDoraIndicators: [...ensureArray(state.doraIndicators)],
    initialScores: Object.fromEntries(ensureArray(state.players).map((player) => [player.id, player.score])),
  };
  for (const tile of ensureArray(state.doraIndicators)) appendHandEvent(state, { type: "doraReveal", tile, doraIndicators: [...state.doraIndicators], turnIndex: state.turnIndex, reason: "initial" });
  state.replayInitialState = clone(state);
  state.replaySnapshots = [clone(state)];
  state.lastSavedReplayId = null;
  if (isTsumoLossless) {
    state.hanchanReplayInitialState ??= clone(state);
    state.hanchanReplaySnapshots ??= [clone(state)];
    const handStartSnapshot = compactStateForReplay(state);
    const lastHanchanSnapshot = state.hanchanReplaySnapshots.at(-1);
    if (replaySnapshotMeaningfulKey(lastHanchanSnapshot) !== replaySnapshotMeaningfulKey(handStartSnapshot)) {
      state.hanchanReplaySnapshots.push(handStartSnapshot);
      if (state.hanchanReplaySnapshots.length > HANCHAN_REPLAY_SNAPSHOT_LIMIT) {
        state.hanchanReplaySnapshots = pickReplaySnapshotsForLimit(state.hanchanReplaySnapshots, HANCHAN_REPLAY_SNAPSHOT_LIMIT);
      }
    }
  }
  enterCurrentTurnOnServer(state);
  advanceServerCpuTurns(state);
  return state;
};

const createServerInitialState = ({ tableId, gameId, players = [], settings = {}, ruleConfig = {} }) => {
  const ruleId = settings.ruleId || settings.gameType || "anmika-rocket";
  const ruleConfigInput = Object.keys(ruleConfig || {}).length > 0 ? ruleConfig : settings.ruleConfig;
  const normalizedRuleConfig = normalizeRuleConfigForRule(ruleId, ruleConfigInput);
  const startingScore = startingScoreForRule(ruleId, normalizedRuleConfig);
  const normalizedPlayers = players.slice(0, 3).map((player, index) => ({
    id: player.id || `cpu${index}`,
    name: player.name || (player.type === "cpu" ? `CPU${index}` : `プレイヤー${index + 1}`),
    type: player.type === "cpu" ? "cpu" : "remote",
    score: ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? startingScore : Number(player.score ?? startingScore),
    hand: [],
    drawnTile: null,
    discardedTiles: [],
    nukiDoraTiles: [],
    melds: [],
    status: "waiting",
    isRiichi: false,
    ippatsu: false,
    riichiTurnIndex: null,
    ippatsuOwnDrawStarted: false,
    sameTurnFuriten: false,
    riichiDiscardTileIds: [],
    riichiStickPaid: false,
    feverRiichiActive: false,
    feverWinCount: 0,
    assistSettings: { autoWin: false, noCall: false },
  }));
  while (normalizedPlayers.length < 3) {
    const index = normalizedPlayers.length;
    normalizedPlayers.push({
      id: `cpu${index}`,
      name: `CPU${index}`,
      type: "cpu",
      score: startingScore,
      hand: [],
      drawnTile: null,
      discardedTiles: [],
      nukiDoraTiles: [],
      melds: [],
      status: "waiting",
      isRiichi: false,
      ippatsu: false,
      riichiTurnIndex: null,
      ippatsuOwnDrawStarted: false,
      sameTurnFuriten: false,
      riichiDiscardTileIds: [],
      riichiStickPaid: false,
      feverRiichiActive: false,
      feverWinCount: 0,
      assistSettings: { autoWin: false, noCall: false },
    });
  }

  const walls = splitStartingWalls(shuffle(createWallTiles(normalizedRuleConfig, ruleId)), ruleId === TSUMO_LOSSLESS_3MA_RULE_ID && normalizedRuleConfig.northNukiDoraEnabled ? 12 : 8);
  for (let i = 0; i < 13; i++) {
    for (const player of normalizedPlayers) {
      const tile = walls.liveWall.shift();
      if (tile) player.hand.push(tile);
    }
  }
  for (const player of normalizedPlayers) player.hand = sortHandTiles(player.hand);

  const dealerId = normalizedPlayers[0]?.id ?? "";
  const initialSeatOrder = normalizedPlayers.map((player) => player.id);
  const state = {
    players: normalizedPlayers,
    version: 0,
    ...walls,
    kanCount: 0,
    round: { roundWind: "east", handNumber: 1, hanchanRoundIndex: 0, honba: 0, dealerPlayerId: dealerId, initialSeatOrder },
    currentPlayerIndex: 0,
    turnIndex: 0,
    isWaitingForHumanAction: false,
    phase: "playing",
    pendingAction: null,
    lastDrawnTile: null,
    rinshanKaihou: null,
    pendingRinshanKaihouFromKan: false,
    paoResponsibilities: {},
    lastScoreResult: null,
    winAnnouncement: null,
    flowerAnnouncement: null,
    settings: {
      ...settings,
      ruleId,
      gameType: settings.gameType || ruleId,
      ruleConfig: normalizedRuleConfig,
      baibaMultiplier: 1,
    },
    activeTableId: tableId,
    seats: normalizedPlayers.map((player, index) => ({
      seatIndex: index,
      playerId: player.id,
      playerType: player.type === "cpu" ? "cpu" : "human",
      displayName: player.name,
      isLastHandDeclared: false,
    })),
    screen: "game",
    rakePool: 0,
    riichiStickCount: 0,
    playerClocks: createServerPlayerClocks(normalizedPlayers, 20000),
    activeClockPlayerId: null,
    clockStartedAt: null,
    resultOkPlayerIds: [],
    handLog: {
      handId: `socket-${gameId || tableId}-${Date.now()}`,
      roundLabel: ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? "東1局" : "東場",
      dealerId,
      events: [],
      initialSeatOrder,
      initialPlayers: normalizedPlayers.map((player, seatIndex) => ({ id: player.id, name: player.name, type: player.type, seatIndex })),
      initialHands: Object.fromEntries(normalizedPlayers.map((player) => [player.id, [...player.hand]])),
      initialDoraIndicators: [...walls.doraIndicators],
      initialScores: Object.fromEntries(normalizedPlayers.map((player) => [player.id, player.score])),
    },
    log: [],
    replayInitialState: null,
    replaySnapshots: [],
    hanchanReplayInitialState: null,
    hanchanReplaySnapshots: [],
    hanchanClubPointPayments: {},
    lastSavedReplayId: null,
  };
  for (const tile of state.doraIndicators) appendHandEvent(state, { type: "doraReveal", tile, doraIndicators: [...state.doraIndicators], turnIndex: state.turnIndex, reason: "initial" });
  state.players[0].status = "active";
  enterCurrentTurnOnServer(state);
  advanceServerCpuTurns(state);
  state.replayInitialState = clone(state);
  state.replaySnapshots = [clone(state)];
  if (ruleId === TSUMO_LOSSLESS_3MA_RULE_ID) {
    state.hanchanReplayInitialState = clone(state);
    state.hanchanReplaySnapshots = [clone(state)];
  }
  return state;
};

const getOrCreateRoom = ({ tableId, gameId, resetRoom = false }) => {
  const key = makeRoomKey(tableId);
  if (!key) throw new Error("tableId is required");
  let room = gameRooms.get(key);
  if (room && gameId && room.gameId && room.gameId !== gameId) {
    if (room.state && !isFinalEndedRoomState(room.state)) {
      console.warn("[AnmikaGameServer] ignore new gameId for active room", {
        tableId: key,
        previousGameId: room.gameId,
        requestedGameId: gameId,
        phase: room.state.phase,
        version: room.version,
      });
      resetRoom = false;
    } else {
      console.log("[AnmikaGameServer] reset room by new gameId", { tableId: key, previousGameId: room.gameId, nextGameId: gameId });
      resetRoom = true;
    }
  }
  if (room && resetRoom && room.state && !isFinalEndedRoomState(room.state)) {
    console.warn("[AnmikaGameServer] reset active room by explicit resetRoom request", {
      tableId: key,
      gameId: room.gameId,
      requestedGameId: gameId || "",
      phase: room.state.phase,
      version: room.version,
    });
  }
  if (room && resetRoom) {
    console.log("[AnmikaGameServer] reset room by start request", { tableId: key, previousGameId: room.gameId, nextGameId: gameId });
    if (room.resultTimer) clearTimeout(room.resultTimer);
    if (room.clockTimer) clearTimeout(room.clockTimer);
    if (room.disconnectedLastHandTimer) clearTimeout(room.disconnectedLastHandTimer);
    if (room.disconnectedProgressTimer) clearTimeout(room.disconnectedProgressTimer);
    if (room.localPersistTimer) clearTimeout(room.localPersistTimer);
    room = null;
    gameRooms.delete(key);
    deletePersistedRoom(key, "reset existing memory room");
  }
  if (!room && resetRoom) {
    deletePersistedRoom(key, "reset without memory room");
  }
  if (!room) {
    room = resetRoom ? null : loadPersistedRoom(key, gameId || "");
    if (room && resetRoom) {
      console.log("[AnmikaGameServer] ignore persisted room by start request", { tableId: key, previousGameId: room.gameId, nextGameId: gameId });
      room = null;
    }
    if (room) {
      if (gameId && !room.gameId) room.gameId = gameId;
      gameRooms.set(key, room);
      return room;
    }
  }
  if (!room) {
    room = {
      tableId: key,
      gameId: gameId || `game-${key}`,
      version: 0,
      state: null,
      skipDbHydration: Boolean(resetRoom),
      events: [],
      sockets: new Map(),
      players: new Map(),
      processedRequestIds: new Set(),
      disconnectedLeaveSyncedUserIds: new Set(),
      lastHandLeaveSyncedUserIds: new Set(),
      updatedAt: now(),
    };
    gameRooms.set(key, room);
  }
  if (gameId && !room.gameId) room.gameId = gameId;
  if (!(room.processedRequestIds instanceof Set)) {
    room.processedRequestIds = new Set(asArray(room.processedRequestIds));
  }
  if (!(room.disconnectedLeaveSyncedUserIds instanceof Set)) {
    room.disconnectedLeaveSyncedUserIds = new Set(asArray(room.disconnectedLeaveSyncedUserIds));
  }
  if (!(room.lastHandLeaveSyncedUserIds instanceof Set)) {
    room.lastHandLeaveSyncedUserIds = new Set(asArray(room.lastHandLeaveSyncedUserIds || room.state?.lastHandLeaveSyncedBy));
  }
  return room;
};
const hydrateRoomFromDbIfNeeded = async (room) => {
  if (!room || room.state) return room;
  if (room.skipDbHydration) {
    console.log("[AnmikaGameServer] skip DB room hydration after reset request", { tableId: room.tableId, gameId: room.gameId });
    return room;
  }
  const persisted = await loadPersistedRoomFromDb(room.tableId, room.gameId || "");
  if (!persisted?.state) {
    console.warn("[AnmikaGameServer] no DB persisted room found", {
      tableId: room.tableId,
      gameId: room.gameId,
      hasSupabaseWriter: hasSupabaseServerWriter(),
    });
    return room;
  }
  const existingSockets = room.sockets instanceof Map ? room.sockets : new Map();
  const existingPlayers = room.players instanceof Map ? room.players : new Map();
  room.gameId = persisted.gameId || room.gameId;
  room.version = Number(persisted.version || persisted.state?.version || room.version || 0);
  room.state = persisted.state;
  room.events = asArray(persisted.events);
  room.processedRequestIds = new Set(asArray(persisted.processedRequestIds));
  room.disconnectedLeaveSyncedUserIds = new Set(asArray(persisted.disconnectedLeaveSyncedUserIds));
  room.lastHandLeaveSyncedUserIds = new Set(asArray(persisted.lastHandLeaveSyncedUserIds || persisted.state?.lastHandLeaveSyncedBy));
  room.updatedAt = Number(persisted.updatedAt || now());
  room.sockets = existingSockets;
  room.players = existingPlayers.size ? existingPlayers : persisted.players;
  ensureRoomPlayerRegistry(room);
  gameRooms.set(room.tableId, room);
  console.log("[AnmikaGameServer] hydrated room from DB", { tableId: room.tableId, gameId: room.gameId, version: room.version });
  return room;
};

const broadcastState = (room) => {
  for (const [socketId, meta] of room.sockets.entries()) {
    try {
      io.to(socketId).emit("game:state", publicRoomState(room, meta?.userId || null));
    } catch (error) {
      const exceptionId = logServerException("game:state:broadcast", error, {
        tableId: room?.tableId,
        gameId: room?.gameId,
        playerId: meta?.userId || "",
        version: room?.version,
        socketId,
      });
      logGameStateSyncFailure("game:state:broadcast", error, {
        tableId: room?.tableId,
        gameId: room?.gameId,
        playerId: meta?.userId || "",
        version: room?.version,
        exceptionId,
      });
    }
  }
};
const scheduleStartupStateBurst = (room, reason = "startupBurst") => {
  if (!room?.state) return;
  const tableId = room.tableId;
  const gameId = room.gameId;
  const version = Number(room.version || room.state.version || 0);
  [250, 800, 1600, 2800].forEach((delay) => {
    setTimeout(() => {
      const current = gameRooms.get(makeRoomKey(tableId));
      if (!current?.state || current.gameId !== gameId) return;
      if (Number(current.version || current.state.version || 0) < version) return;
      try {
        current.state.onlineMeta = {
          ...(current.state.onlineMeta || {}),
          transport: "socket.io",
          reason,
          publishedBy: null,
          publishedAt: now(),
        };
        broadcastState(current);
      } catch (error) {
        logServerException("game:startupBurst", error, { tableId, gameId, version });
      }
    }, delay);
  });
};
const clearRoomLastHandForUser = (room, userId) => {
  if (!room?.state || !userId) return false;
  const isStillSeated = ensureArray(room.state.seats).some((seat) => seat?.playerId === userId);
  if (room.state.phase !== "gameEnded" && isStillSeated) return false;
  const before = ensureArray(room.state.lastHandDeclaredBy);
  const after = before.filter((id) => id !== userId);
  if (after.length === before.length) return false;
  room.state.lastHandDeclaredBy = after;
  room.state.settings ??= {};
  room.state.settings.isLastHand = after.length > 0;
  for (const seat of ensureArray(room.state.seats)) {
    if (seat?.playerId === userId) seat.isLastHandDeclared = false;
  }
  appendHandEvent(room.state, { type: "lastHandClearedOnJoin", playerId: userId, turnIndex: room.state.turnIndex ?? 0 });
  return true;
};
const isWaitingForResultOk = (state) => Boolean(state?.handLog?.result && ["handEnded", "exhaustiveDraw"].includes(state.phase));
const isEndedRoomState = (state) => Boolean(
  state?.phase === "gameEnded" ||
  (state?.handLog?.result && ["handEnded", "exhaustiveDraw"].includes(state?.phase)) ||
  state?.finalResult ||
  state?.handLog?.result?.finalResult ||
  state?.handLog?.result?.type === "gameEnded"
);
const applyAutoResultOk = (state) => {
  if (!isWaitingForResultOk(state)) return false;
  const resultId = getCurrentResultId(state);
  if (!resultId) return false;
  if (state.resultCountdownResultId !== resultId) return false;
  if (state.resultAutoCloseHandledResultId === resultId) return false;
  if (isTsumoLosslessAgariYameOpportunity(state, state.handLog?.result)) return false;
  const startedAt = Number(state.resultCountdownStartedAt || 0);
  if (!startedAt || Date.now() - startedAt < RESULT_AUTO_OK_DELAY_MS) return false;
  state.resultAutoCloseHandledResultId = resultId;
  const requiredOkPlayerIds = ensureArray(state.players).filter((player) => player.type !== "cpu").map((player) => player.id);
  const cpuPlayerIds = ensureArray(state.players).filter((player) => player.type === "cpu").map((player) => player.id);
  state.resultOkPlayerIds = [...new Set([...(state.resultOkPlayerIds ?? []), ...requiredOkPlayerIds, ...cpuPlayerIds])];
  state.handLog.result.resultOkPlayerIds = [...state.resultOkPlayerIds];
  appendHandEvent(state, { type: "resultOkAuto", playerId: null, resultOkPlayerIds: [...state.resultOkPlayerIds], turnIndex: state.turnIndex ?? 0 });
  if (continueAfterServerFeverWin(state)) return true;
  if (isTsumoLossless3maState(state)) {
    const result = state.handLog?.result;
    if (shouldEndTsumoLosslessHanchanAfterResult(state, result)) {
      prepareTsumoLosslessGameEnd(state, ensureArray(state.players).some((p) => Number(p.score || 0) <= 0) ? "tobi" : "south3End");
      return true;
    }
    applyTsumoLosslessRoundAdvance(state, result);
    startNextServerHand(state);
    return true;
  }
  if (state.settings?.isLastHand) {
    state.pendingAction = null;
    state.phase = "gameEnded";
    state.isWaitingForHumanAction = false;
    state.activeClockPlayerId = null;
    state.clockStartedAt = null;
    return true;
  }
  applyAnmikaRoundAdvance(state, state.handLog?.result);
  startNextServerHand(state);
  return true;
};
const scheduleRoomResultTimeout = (room) => {
  if (!room?.state) return;
  if (room.resultTimer) {
    clearTimeout(room.resultTimer);
    room.resultTimer = null;
  }
  if (!isWaitingForResultOk(room.state)) return;
  const timerResultId = getCurrentResultId(room.state);
  if (!timerResultId) return;
  if (isTsumoLosslessAgariYameOpportunity(room.state, room.state.handLog?.result)) return;
  if (room.state.resultCountdownResultId !== timerResultId) {
    room.state.resultCountdownStartedAt = Date.now();
    room.state.resultCountdownResultId = timerResultId;
    room.state.resultAutoCloseHandledResultId = "";
  }
  room.state.resultCountdownStartedAt ??= Date.now();
  const timerStartedAt = Number(room.state.resultCountdownStartedAt || Date.now());
  const delay = Math.max(0, timerStartedAt + RESULT_AUTO_OK_DELAY_MS - Date.now());
  room.resultTimer = setTimeout(async () => {
    room.resultTimer = null;
    try {
      if (!isWaitingForResultOk(room.state) || getCurrentResultId(room.state) !== timerResultId || Number(room.state.resultCountdownStartedAt || 0) !== timerStartedAt) {
        scheduleRoomResultTimeout(room);
        return;
      }
      queueResultSideEffectsOnce(room, timerResultId, "resultOkAuto");
      if (!applyAutoResultOk(room.state)) {
        scheduleRoomResultTimeout(room);
        return;
      }
      advanceServerCpuTurns(room.state);
      room.version = Number(room.version || 0) + 1;
      room.state.version = room.version;
      room.state.onlineMeta = {
        ...(room.state.onlineMeta || {}),
        transport: "socket.io",
        reason: "resultOkAuto",
        publishedBy: null,
        publishedAt: now(),
      };
      room.updatedAt = now();
      persistRoom(room);
      await syncDeclaredLastHandLeaves(room);
      await syncDisconnectedLastHandLeaves(room);
      broadcastState(room);
      scheduleRoomServerEffect(room);
      scheduleRoomClockTimeout(room);
      scheduleRoomResultTimeout(room);
    } catch (error) {
      console.error("[ResultOkAuto] failed", { tableId: room?.tableId, gameId: room?.gameId, error });
      try {
        broadcastState(room);
      } catch {}
      scheduleRoomResultTimeout(room);
    }
  }, delay);
};
const applyPendingRoomServerEffect = (room) => {
  if (!room?.state?.pendingServerEffect) return false;
  if (room.state.pendingServerEffect.type === "flower") applyServerFlowerEffect(room.state);
  else if (room.state.pendingServerEffect.type === "ponReveal") applyServerPonRevealEffect(room.state);
  else if (room.state.pendingServerEffect.type === "cpuDiscard") applyServerCpuDiscardEffect(room.state);
  else if (room.state.pendingServerEffect.type === "riichiAutoDiscard") applyServerRiichiAutoDiscardEffect(room.state);
  else if (room.state.pendingServerEffect.type === "winAnnouncement") {
    room.state.pendingServerEffect = null;
    room.state.winAnnouncement = null;
    room.state.serverAnnouncement = null;
    room.state.phase = "handEnded";
    if (room.state.handLog?.result) startResultCountdownState(room.state);
  } else {
    room.state.pendingServerEffect = null;
  }
  advanceServerCpuTurns(room.state);
  room.version = Number(room.version || 0) + 1;
  room.state.version = room.version;
  room.updatedAt = now();
  persistRoom(room);
  safeSyncClubPointEffects(room, "pendingServerEffect");
  return true;
};
const applyDueRoomServerEffect = (room) => {
  if (!room?.state?.pendingServerEffect) return false;
  if (Number(room.state.pendingServerEffect.resumeAt || 0) > Date.now()) return false;
  return applyPendingRoomServerEffect(room);
};
const scheduleRoomServerEffect = (room) => {
  if (!room?.state?.pendingServerEffect) return;
  if (room.effectTimer) {
    clearTimeout(room.effectTimer);
    room.effectTimer = null;
  }
  const delay = Math.max(0, Number(room.state.pendingServerEffect.resumeAt || Date.now()) - Date.now());
  room.effectTimer = setTimeout(() => {
    try {
      room.effectTimer = null;
      if (!room.state?.pendingServerEffect) return;
      applyPendingRoomServerEffect(room);
      broadcastState(room);
      scheduleRoomServerEffect(room);
      scheduleRoomClockTimeout(room);
      scheduleRoomResultTimeout(room);
      scheduleDisconnectedTimeouts(room);
    } catch (error) {
      logServerException("timer:serverEffect", error, { tableId: room?.tableId, gameId: room?.gameId, version: room?.version, effectType: room?.state?.pendingServerEffect?.type || "" });
      try { broadcastState(room); } catch {}
      scheduleRoomServerEffect(room);
    }
  }, delay);
};

const scheduleRoomClockTimeout = (room) => {
  if (!room?.state) return;
  if (room.clockTimer) {
    clearTimeout(room.clockTimer);
    room.clockTimer = null;
  }
  const playerId = room.state.activeClockPlayerId;
  if (!playerId || room.state.handLog?.result || ["handEnded", "exhaustiveDraw", "gameEnded", "showingFlowerAnnouncement"].includes(room.state.phase)) return;
  const delay = Math.max(0, getServerClockRemainingMs(room.state, playerId)) + 80;
  room.clockTimer = setTimeout(() => {
    try {
      room.clockTimer = null;
      if (room.actionInFlight) {
        console.warn("[Clock] deferred during action", {
          tableId: room.tableId,
          gameId: room.gameId,
          action: room.actionInFlight?.actionType || "",
          playerId: room.actionInFlight?.playerId || "",
        });
        room.clockTimer = setTimeout(() => {
          try {
            room.clockTimer = null;
            scheduleRoomClockTimeout(room);
          } catch (error) {
            logServerException("timer:clockDeferred", error, { tableId: room?.tableId, gameId: room?.gameId, version: room?.version });
          }
        }, 250);
        return;
      }
      if (!room.state?.activeClockPlayerId) return;
      const activePlayerId = room.state.activeClockPlayerId;
      const changed = applyServerClockTimeout(room.state);
      if (!changed) return;
      advanceServerCpuTurns(room.state);
      room.version = Number(room.version || 0) + 1;
      room.state.version = room.version;
      room.state.onlineMeta = {
        ...(room.state.onlineMeta || {}),
        transport: "socket.io",
        reason: "clockTimeout",
        publishedBy: playerId,
        publishedAt: now(),
      };
      room.updatedAt = now();
      persistRoom(room);
      safeSyncClubPointEffects(room, "clockTimeout");
      broadcastState(room);
      scheduleRoomServerEffect(room);
      scheduleRoomClockTimeout(room);
      scheduleRoomResultTimeout(room);
    } catch (error) {
      logServerException("timer:clockTimeout", error, { tableId: room?.tableId, gameId: room?.gameId, version: room?.version, playerId });
      try { broadcastState(room); } catch {}
      scheduleRoomClockTimeout(room);
    }
  }, delay);
};

const acceptStateFromServerPipeline = (room, state, reason, publishedBy) => {
  const next = clone(state);
  room.version = Math.max(Number(room.version || 0) + 1, Number(next.version || 0));
  next.version = room.version;
  next.onlineMeta = {
    ...(next.onlineMeta || {}),
    transport: "socket.io",
    reason,
    publishedBy,
    publishedAt: now(),
  };
  room.state = next;
  ensureRoomPlayerRegistry(room);
  room.updatedAt = now();
  persistRoom(room);
  safeSyncClubPointEffects(room, "acceptState");
  broadcastState(room);
  scheduleRoomServerEffect(room);
  scheduleRoomClockTimeout(room);
  scheduleRoomResultTimeout(room);
  scheduleDisconnectedTimeouts(room);
  return publicRoomState(room, publishedBy);
};

const registerGameSocketHandlers = () => {
io.on("connection", (socket) => {
  console.log("[Socket] connected", {
    socketId: socket.id,
    recovered: Boolean(socket.recovered),
    address: socket.handshake?.address,
    origin: socket.handshake?.headers?.origin || "",
    userId: socket.handshake?.auth?.userId || "",
    tableId: socket.handshake?.auth?.tableId || "",
    gameId: socket.handshake?.auth?.gameId || "",
    transport: socket.conn?.transport?.name || "",
  });
  if (socket.recovered) {
    console.log("[Socket] reconnect recovered", {
      socketId: socket.id,
      userId: socket.handshake?.auth?.userId || "",
      tableId: socket.handshake?.auth?.tableId || "",
      gameId: socket.handshake?.auth?.gameId || "",
    });
  }
  socket.conn?.on?.("upgrade", (transport) => {
    console.log("[Socket] transport upgraded", {
      socketId: socket.id,
      userId: socket.data.userId || socket.handshake?.auth?.userId || "",
      tableId: socket.data.tableId || socket.handshake?.auth?.tableId || "",
      gameId: socket.data.gameId || socket.handshake?.auth?.gameId || "",
      transport: transport?.name || "",
    });
  });
  socket.on("error", (error) => {
    logServerException("socket:error", error, {
      socketId: socket.id,
      userId: socket.data.userId || socket.handshake?.auth?.userId || "",
      tableId: socket.data.tableId || socket.handshake?.auth?.tableId || "",
      gameId: socket.data.gameId || socket.handshake?.auth?.gameId || "",
      version: gameRooms.get(makeRoomKey(socket.data.tableId || socket.handshake?.auth?.tableId || ""))?.version ?? "",
    });
  });
  socket.on("game:join", async (payload = {}, ack) => {
    try {
      const { tableId, gameId, userId, resetRoom = false } = payload;
      let room = await hydrateRoomFromDbIfNeeded(getOrCreateRoom({ tableId, gameId, resetRoom }));
      if (!resetRoom && isEndedRoomState(room.state)) {
        console.log("[AnmikaGameServer] reset ended room on join", { tableId: room.tableId, previousGameId: room.gameId, userId });
        room = getOrCreateRoom({ tableId, gameId, resetRoom: true });
      }
      console.log("[AnmikaGameServer] join", { socketId: socket.id, tableId: room.tableId, gameId: room.gameId, userId, hasState: Boolean(room.state), version: room.version });
      for (const [socketId, meta] of room.sockets.entries()) {
        if (meta?.userId === userId && socketId !== socket.id) room.sockets.delete(socketId);
      }
      room.sockets.set(socket.id, { userId, joinedAt: now() });
      socket.join(`table:${room.tableId}`);
      socket.data.tableId = room.tableId;
      socket.data.gameId = room.gameId;
      socket.data.userId = userId;
      markRoomPlayerConnected(room, userId, socket);
      if (room.state) {
        resumeClockForReconnectedPlayer(room, userId);
        if (applyDueRoomServerEffect(room)) {
          broadcastState(room);
        }
        if (clearRoomLastHandForUser(room, userId)) {
          room.updatedAt = now();
          persistRoom(room);
        }
        room.updatedAt = now();
        persistRoom(room);
        socket.emit("game:state", publicRoomState(room, userId));
        broadcastState(room);
        scheduleRoomClockTimeout(room);
        scheduleDisconnectedTimeouts(room);
        scheduleRoomServerEffect(room);
        scheduleRoomClockTimeout(room);
        scheduleRoomResultTimeout(room);
        const isStartupPhase = Number(room.state?.turnIndex || 0) <= 1 && !ensureArray(room.state?.handLog?.events).some((event) => event?.type === "discard");
        if (isStartupPhase) scheduleStartupStateBurst(room, "joinStartupBurst");
      } else {
        socket.emit("game:needInitialState", { tableId: room.tableId, gameId: room.gameId });
      }
      ack?.({ ok: true, ...publicRoomState(room, userId) });
    } catch (error) {
      console.error("[AnmikaGameServer] join failed", { socketId: socket.id, payload, error: error?.message || String(error) });
      try {
        const { tableId, gameId, playerId } = payload || {};
        const room = tableId ? getOrCreateRoom({ tableId, gameId }) : null;
        ack?.({ ok: false, error: error.message, ...(room ? publicRoomState(room, playerId || socket.data.userId || null) : {}) });
      } catch {
        ack?.({ ok: false, error: error.message });
      }
    }
  });

  socket.on("game:initState", async (payload = {}, ack) => {
    try {
      const { tableId, gameId, state, players, settings, ruleConfig, userId, allowCreateInitialState = true, resetRoom = false } = payload;
      await withRoomStartLock(tableId, async () => {
        const room = await hydrateRoomFromDbIfNeeded(getOrCreateRoom({ tableId, gameId, resetRoom }));
        console.log("[AnmikaGameServer] initState", { socketId: socket.id, tableId: room.tableId, gameId: room.gameId, userId: userId || socket.data.userId, alreadyInitialized: Boolean(room.state), version: room.version });
        if (room.state) {
          const viewerId = userId || socket.data.userId || null;
          if (clearRoomLastHandForUser(room, viewerId)) {
            room.updatedAt = now();
            persistRoom(room);
          }
          ack?.({ ok: true, alreadyInitialized: true, ...publicRoomState(room, viewerId) });
          socket.emit("game:state", publicRoomState(room, viewerId));
          scheduleRoomServerEffect(room);
          scheduleRoomClockTimeout(room);
          scheduleRoomResultTimeout(room);
          const isStartupPhase = Number(room.state?.turnIndex || 0) <= 1 && !ensureArray(room.state?.handLog?.events).some((event) => event?.type === "discard");
          if (isStartupPhase) scheduleStartupStateBurst(room, "alreadyInitializedStartupBurst");
          return;
        }
        const recoveredClientState = isRecoverableClientState(state, room.tableId, room.gameId) ? clone(state) : null;
        if (state && !recoveredClientState) {
          console.warn("[AnmikaGameServer] rejected client initial state recovery payload", {
            tableId: room.tableId,
            gameId: room.gameId,
            hasPlayers: Array.isArray(state?.players),
            hasLiveWall: Array.isArray(state?.liveWall),
            handId: state?.handLog?.handId,
            viewForPlayerId: state?.onlineMeta?.viewForPlayerId,
          });
        }
        if (!recoveredClientState && allowCreateInitialState === false) {
          throw new Error("保存済み局面を復元できませんでした。新しい配牌は作成しません。数秒後に再読み込みしてください。");
        }
        const serverState = recoveredClientState || createServerInitialState({
          tableId: room.tableId,
          gameId: room.gameId,
          players,
          settings,
          ruleConfig,
        });
        console.log("[AnmikaGameServer] initial state source", {
          tableId: room.tableId,
          gameId: room.gameId,
          source: recoveredClientState ? "clientRecovery" : "newInitial",
          allowCreateInitialState,
          hasSupabaseWriter: hasSupabaseServerWriter(),
        });
        acceptStateFromServerPipeline(room, serverState, recoveredClientState ? "serverRecoveredInitial" : "serverInitial", userId || socket.data.userId);
        markRoomPlayerConnected(room, userId || socket.data.userId, socket);
        resumeClockForReconnectedPlayer(room, userId || socket.data.userId);
        scheduleDisconnectedTimeouts(room);
        scheduleRoomServerEffect(room);
        scheduleRoomClockTimeout(room);
        scheduleRoomResultTimeout(room);
        persistRoom(room);
        broadcastState(room);
        scheduleStartupStateBurst(room, "serverInitialBurst");
        ack?.({ ok: true, ...publicRoomState(room, userId || socket.data.userId || null) });
      });
    } catch (error) {
      console.error("[AnmikaGameServer] initState failed", { socketId: socket.id, payload: { tableId: payload?.tableId, gameId: payload?.gameId, userId: payload?.userId }, error: error?.message || String(error) });
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on("game:action", async (payload = {}, ack) => {
    let room = null;
    let playerIdForAck = payload?.playerId || socket.data.userId || null;
    try {
      const { tableId, gameId, playerId, actionType, turnVersion, payload: rawActionPayload } = payload;
      let actionPayload = rawActionPayload;
      playerIdForAck = playerId || playerIdForAck;
      room = await hydrateRoomFromDbIfNeeded(getOrCreateRoom({ tableId, gameId }));
      if (!room.state) throw new Error("対局が初期化されていません");
      if (ACTION_DEBUG_LOGS) {
        console.log("[Action] received", {
          socketId: socket.id,
          tableId,
          gameId,
          playerId,
          actionType,
          clientVersion: turnVersion,
          serverVersion: room.version,
          phase: room.state?.phase,
        });
      }
      const requestId = actionPayload?.discardRequestId || actionPayload?.requestId || payload.requestId || "";
      if (requestId && room.processedRequestIds?.has(requestId)) {
        ack?.({ ok: true, duplicate: true, ...publicRoomState(room, playerId) });
        return;
      }
      let clientVersion = Number(turnVersion ?? room.version);
      if (actionType === "resultOk") clientVersion = room.version;
      if (clientVersion !== room.version) {
        console.warn("[Version] stale action accepted for revalidation", { tableId, actionType, clientVersion, serverVersion: room.version });
        clientVersion = room.version;
      }
      if (!ACTION_TYPES.has(actionType)) throw new Error("未対応の操作です");
      if (actionType === "resultOk") {
        if (room.state?.phase === "gameEnded") {
          const endedResultId = getCurrentResultId(room.state) || room.state?.finalResult?.createdAt || room.state?.finalResult?.reason || "gameEnded";
          queueResultSideEffectsOnce(room, endedResultId, "resultOkAlreadyGameEnded");
          const changed = (await syncDeclaredLastHandLeaves(room)) || (await syncDisconnectedLastHandLeaves(room));
          if (changed) {
            room.version = Number(room.version || 0) + 1;
            room.state.version = room.version;
            room.state.onlineMeta = {
              ...(room.state.onlineMeta || {}),
              transport: "socket.io",
              reason: "resultOkAlreadyGameEndedLeaveSync",
              publishedBy: playerId,
              publishedAt: now(),
            };
            persistRoom(room);
            broadcastState(room);
          }
          ack?.({ ok: true, duplicate: true, ...publicRoomState(room, playerId) });
          return;
        }
      }
      if (actionType === "resultOk" && room.state?.handLog?.result) {
        const resultSyncId = getCurrentResultId(room.state);
        queueResultSideEffectsOnce(room, resultSyncId, "resultOk");
        const serverAutoOkPlayerIds = autoOkPlayerIdsForResult(room, playerId);
        if (serverAutoOkPlayerIds.length) {
          actionPayload = { ...(actionPayload || {}), serverAutoOkPlayerIds };
          console.log("[ResultOk] auto OK for disconnected players", { tableId: room.tableId, playerId, serverAutoOkPlayerIds });
        }
      }
      const clockGuardedAction = ["discard", "riichi", "skip", "pon", "kan", "flower", "nukiDora", "ron", "tsumo"].includes(actionType);
      if (clockGuardedAction) {
        room.actionInFlight = {
          actionType,
          playerId,
          requestId,
          startedAt: now(),
        };
        if (room.clockTimer) {
          clearTimeout(room.clockTimer);
          room.clockTimer = null;
        }
        if (playerId && room.state?.activeClockPlayerId === playerId) {
          stopServerClockForPlayer(room.state, playerId, { recoverAfterDiscard: false });
        }
      }
      const event = {
        id: `event-${randomUUID()}`,
        tableId: room.tableId,
        gameId: room.gameId,
        playerId,
        actionType,
        turnVersion: clientVersion,
        payload: actionPayload || {},
        createdAt: now(),
      };
      const nextState = cloneStateForAction(room.state);
      applyServerAction(nextState, event);
      advanceServerCpuTurns(nextState);
      room.events.push(event);
      if (room.events.length > 500) room.events.splice(0, room.events.length - 500);
      room.version = Number(room.version || 0) + 1;
      nextState.version = room.version;
      nextState.onlineMeta = {
        ...(nextState.onlineMeta || {}),
        transport: "socket.io",
        reason: actionType,
        lastEventId: event.id,
        publishedBy: playerId,
        publishedAt: now(),
      };
      room.state = nextState;
      room.updatedAt = now();
      room.actionInFlight = null;
      if (actionType === "resultOk" && room.state?.phase === "gameEnded") {
        const finalSyncId = [
          room.gameId || room.tableId || "game",
          "gameEnded",
          room.state?.finalResult?.createdAt || room.state?.finalResult?.reason || getCurrentResultId(room.state) || "final",
        ].join(":");
        queueResultSideEffectsOnce(room, finalSyncId, "resultOkGameEnded");
        await syncDeclaredLastHandLeaves(room);
        await syncDisconnectedLastHandLeaves(room);
      }
      persistRoom(room);
      if (requestId) {
        room.processedRequestIds.add(requestId);
        if (room.processedRequestIds.size > 500) {
          room.processedRequestIds = new Set([...room.processedRequestIds].slice(-300));
        }
      }
      io.to(`table:${room.tableId}`).emit("game:event", event);
      broadcastState(room);
      scheduleRoomServerEffect(room);
      scheduleRoomClockTimeout(room);
      scheduleRoomResultTimeout(room);
      scheduleDisconnectedTimeouts(room);
      if (ACTION_DEBUG_LOGS) {
        console.log("[Action] accepted", { tableId: room.tableId, gameId: room.gameId, playerId, actionType, serverVersion: room.version, phase: room.state?.phase });
      }
      ack?.({ ok: true, event, ...publicRoomState(room, playerId) });
      if (actionType !== "resultOk" && shouldSyncRoomDbEffects(room.state)) safeSyncClubPointEffects(room, `gameAction:${actionType}`);
    } catch (error) {
      if (room?.actionInFlight) room.actionInFlight = null;
      if (room?.state && ["discard", "riichi", "skip", "pon", "kan", "flower", "nukiDora", "ron", "tsumo"].includes(payload?.actionType)) {
        const retryPlayerId = playerIdForAck;
        const retryPlayer = findPlayer(room.state, retryPlayerId);
        const current = currentPlayer(room.state);
        const canResumeClock = retryPlayer &&
          !room.state.handLog?.result &&
          !["handEnded", "exhaustiveDraw", "gameEnded", "showingFlowerAnnouncement", "showingWinAnnouncement"].includes(room.state.phase) &&
          (room.state.pendingAction?.playerId === retryPlayerId || current?.id === retryPlayerId);
        if (canResumeClock) {
          startServerClockForPlayer(room.state, retryPlayer);
          scheduleRoomClockTimeout(room);
        }
      }
      const alreadyTraced = Boolean(error?.exceptionId) || String(error?.message || "").includes("exceptionId:");
      const exceptionId = error?.exceptionId || (alreadyTraced ? "" : logServerException("game:action:rejected", error, {
        socketId: socket.id,
        tableId: payload?.tableId,
        gameId: payload?.gameId,
        playerId: playerIdForAck,
        actionType: payload?.actionType,
        clientVersion: payload?.turnVersion,
        serverVersion: room?.version,
        phase: room?.state?.phase,
      }));
      logGameStateSyncFailure("game:action:rejected", error, {
        tableId: payload?.tableId || room?.tableId,
        gameId: payload?.gameId || room?.gameId,
        playerId: playerIdForAck,
        version: room?.version,
        actionType: payload?.actionType,
        exceptionId,
      });
      console.error("[Action] rejected", {
        socketId: socket.id,
        tableId: payload?.tableId,
        gameId: payload?.gameId,
        playerId: playerIdForAck,
        actionType: payload?.actionType,
        clientVersion: payload?.turnVersion,
        serverVersion: room?.version,
        phase: room?.state?.phase,
        exceptionId,
        error: error?.message || String(error),
      });
      ack?.({ ok: false, error: error.message, exceptionId, ...(room?.state ? publicRoomState(room, playerIdForAck) : {}) });
    }
  });

  socket.on("game:finalResultOk", async (payload = {}, ack) => {
    let room = null;
    try {
      const { tableId, gameId, userId } = payload || {};
      room = await hydrateRoomFromDbIfNeeded(getOrCreateRoom({ tableId, gameId, resetRoom: false }));
      const viewerId = userId || socket.data.userId || null;
      if (!room?.state) throw new Error("GameStateが初期化されていません");
      if (!isTsumoLossless3maState(room.state) || room.state.phase !== "gameEnded") {
        ack?.({ ok: true, advanced: false, ...publicRoomState(room, viewerId) });
        return;
      }
      const finalSyncId = [
        room.gameId || room.tableId || "game",
        "gameEnded",
        room.state?.finalResult?.createdAt || room.state?.finalResult?.reason || getCurrentResultId(room.state) || "final",
      ].join(":");
      queueResultSideEffectsOnce(room, finalSyncId, "finalResultOk");
      const hasDeclaredLeaver = asArray(room.state.lastHandDeclaredBy).filter(Boolean).length > 0;
      const advanced = await startNextTsumoLosslessHanchanIfReady(room);
      ack?.({ ok: true, advanced, hasDeclaredLeaver, ...publicRoomState(room, viewerId) });
    } catch (error) {
      const exceptionId = logServerException("game:finalResultOk", error, {
        socketId: socket.id,
        tableId: payload?.tableId,
        gameId: payload?.gameId,
        userId: payload?.userId || socket.data.userId || "",
        version: room?.version,
      });
      ack?.({ ok: false, error: `${error?.message || String(error)} (exceptionId: ${exceptionId})`, exceptionId, ...(room?.state ? publicRoomState(room, payload?.userId || socket.data.userId) : {}) });
    }
  });

  socket.on("game:publishState", (payload = {}, ack) => {
    try {
      ack?.({ ok: false, error: "Socket.IO対局中の局面更新は game:initState または game:action で受け付けます。" });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on("game:requestState", async (payload = {}, ack) => {
    try {
      const room = await hydrateRoomFromDbIfNeeded(getOrCreateRoom(payload));
      const viewerId = payload.userId || socket.data.userId || null;
      if (room.state) {
        if (applyDueRoomServerEffect(room)) {
          broadcastState(room);
        }
        ack?.({ ok: true, ...publicRoomState(room, viewerId) });
        socket.emit("game:state", publicRoomState(room, viewerId));
        scheduleRoomServerEffect(room);
        scheduleRoomClockTimeout(room);
        scheduleRoomResultTimeout(room);
      }
      else {
        ack?.({ ok: true, ...publicRoomState(room, viewerId) });
        socket.emit("game:needInitialState", { tableId: room.tableId, gameId: room.gameId });
      }
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on("disconnect", (reason) => {
    const tableId = socket.data.tableId;
    console.warn("[Socket] disconnected", {
      socketId: socket.id,
      reason,
      tableId,
      userId: socket.data.userId || "",
      transport: socket.conn?.transport?.name || "",
    });
    if (!tableId) return;
    const room = gameRooms.get(tableId);
    const record = markRoomPlayerDisconnected(room, socket.id, reason);
    room?.sockets.delete(socket.id);
    if (room?.state) {
      if (record?.userId && room.state.activeClockPlayerId === record.userId) {
        stopServerClockForPlayer(room.state, record.userId, { recoverAfterDiscard: false });
      }
      room.updatedAt = now();
      persistRoom(room);
      broadcastState(room);
      scheduleRoomClockTimeout(room);
      scheduleDisconnectedTimeouts(room);
    }
    if (record) console.warn("[Socket] player marked disconnected", { tableId, userId: record.userId, seatIndex: record.seatIndex, reason });
  });
});
};

const persistAllRoomsForShutdown = (signal) => {
  console.warn("[AnmikaGameServer] shutdown requested", { signal, rooms: gameRooms.size });
  for (const room of gameRooms.values()) {
    try {
      flushRoomLocalPersist(room);
    } catch (error) {
      console.error("[AnmikaGameServer] shutdown room persist failed", {
        tableId: room?.tableId,
        gameId: room?.gameId,
        error: error?.message || String(error),
      });
    }
  }
};

const installShutdownHandlers = () => {
  if (shutdownHandlersInstalled || typeof process === "undefined") return;
  shutdownHandlersInstalled = true;
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      persistAllRoomsForShutdown(signal);
      try {
        io?.emit("server:shutdown", { reason: signal, reconnect: true, at: now() });
        io?.close?.();
      } catch {}
      setTimeout(() => process.exit(0), 250).unref?.();
    });
  }
};

const installProcessExceptionHandlers = () => {
  if (processExceptionHandlersInstalled || typeof process === "undefined") return;
  processExceptionHandlersInstalled = true;
  process.on("uncaughtException", (error) => {
    logServerException("process:uncaughtException", error, { processWillExit: false });
  });
  process.on("unhandledRejection", (reason) => {
    let message = "";
    try {
      message = typeof reason === "string" ? reason : JSON.stringify(reason);
    } catch {
      message = String(reason);
    }
    const error = reason instanceof Error ? reason : new Error(message || "Unhandled rejection");
    logServerException("process:unhandledRejection", error, { processWillExit: false });
  });
};

export const attachAnmikaGameServer = (httpServer) => {
  if (io) return io;
  installProcessExceptionHandlers();
  console.log("[AnmikaGameServer] starting", {
    cors: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    pingInterval: 25000,
    pingTimeout: 180000,
    connectionStateRecoveryMs: 600000,
  });
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
      methods: ["GET", "POST"],
    },
    pingInterval: 25000,
    pingTimeout: 180000,
    connectTimeout: 90000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 600000,
      skipMiddlewares: true,
    },
    transports: ["websocket", "polling"],
  });
  registerGameSocketHandlers();
  installShutdownHandlers();
  return io;
};

export { getAnmikaServerDiagnostics };

export const createAnmikaGameHttpServer = () => {
  const httpServer = createHealthServer();
  attachAnmikaGameServer(httpServer);
  return httpServer;
};

export const __testHooks = {
  getWinningTilesForServerTenpai,
  isWinningShapeServer,
  tileKindKey,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const httpServer = createAnmikaGameHttpServer();
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[AnmikaGameServer] listening on http://0.0.0.0:${PORT}`);
  });
}
