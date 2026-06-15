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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_STORE_DIR = path.join(__dirname, "game-state-store");
fs.mkdirSync(STATE_STORE_DIR, { recursive: true });

const createHealthServer = () => http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, rooms: gameRooms.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Anmika Rocket game server is running.");
});

let io = null;

const gameRooms = new Map();

const now = () => Date.now();
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
const makeRoomKey = (tableId) => String(tableId || "");
const clone = (value) => JSON.parse(JSON.stringify(value));
const safeStoreFileName = (tableId) => `${String(tableId || "").replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`;
const roomStorePath = (tableId) => path.join(STATE_STORE_DIR, safeStoreFileName(tableId));
const asArray = (value) => Array.isArray(value) ? value : [];
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
  const viewState = clone(state);
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
  state: buildViewStateForPlayer(room.state, viewerId),
  updatedAt: room.updatedAt,
  eventCount: room.events.length,
});

const loadPersistedRoom = (tableId) => {
  const filePath = roomStorePath(tableId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed?.tableId || !parsed?.state) return null;
    return {
      tableId: String(parsed.tableId),
      gameId: parsed.gameId || `game-${tableId}`,
      version: Number(parsed.version || parsed.state?.version || 0),
      state: parsed.state,
      events: Array.isArray(parsed.events) ? parsed.events : [],
      sockets: new Map(),
      updatedAt: Number(parsed.updatedAt || now()),
    };
  } catch (error) {
    console.warn("[AnmikaGameServer] persisted room load failed", tableId, error);
    return null;
  }
};

const persistRoom = (room) => {
  if (!room?.tableId || !room.state) return;
  const payload = {
    tableId: room.tableId,
    gameId: room.gameId,
    version: room.version,
    state: room.state,
    events: room.events,
    updatedAt: room.updatedAt || now(),
  };
  fs.writeFileSync(roomStorePath(room.tableId), JSON.stringify(payload));
  console.log("[AnmikaGameServer] persisted room", {
    tableId: room.tableId,
    gameId: room.gameId,
    version: room.version,
    file: roomStorePath(room.tableId),
  });
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
  const rows = await supabaseRest(`/tables?select=table_id,club_id&table_id=eq.${encodeURIComponent(room.tableId)}&limit=1`);
  const table = Array.isArray(rows) ? rows[0] : null;
  if (!table?.club_id) return null;
  room.tableContext = table;
  return table;
};
const nonCpuPlayersForPointSettlement = (state) =>
  asArray(state?.players).filter((player) => player?.type !== "cpu" && isUuid(player?.id));
const isDebugGameForPointSettlement = (state) => asArray(state?.players).some((player) => player?.type === "cpu");
const normalizePointDeltas = (payments = {}) => {
  const normalized = {};
  for (const [playerId, amount] of Object.entries(payments || {})) {
    if (!isUuid(playerId)) continue;
    const value = Math.round(Number(amount || 0) * 10) / 10;
    if (value) normalized[playerId] = value;
  }
  return normalized;
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
const syncOneClubPointEffect = async (room, key, reason, payments, metadata = {}) => {
  if (!room?.state || hasClubPointSyncApplied(room.state, key)) return false;
  const result = await applyClubPointDeltasToDb(room, reason, payments, metadata);
  if (!result?.ok) return false;
  markClubPointSyncApplied(room.state, key);
  persistRoom(room);
  return true;
};
const syncClubPointEffects = async (room) => {
  if (!room?.state || !isTsumoLossless3maState(room.state)) return;
  if (isDebugGameForPointSettlement(room.state)) return;
  if (room.clubPointSyncInFlight) return room.clubPointSyncInFlight;
  room.clubPointSyncInFlight = (async () => {
    const state = room.state;
    const handId = state.handLog?.handId || `${room.gameId || room.tableId}-hand-${state.round?.hanchanRoundIndex ?? 0}`;
    const entryRake = Number(state.settings?.ruleConfig?.entryRakePoints || 0);
    if (entryRake > 0) {
      const payments = Object.fromEntries(nonCpuPlayersForPointSettlement(state).map((player) => [player.id, -entryRake]));
      await syncOneClubPointEffect(room, `${room.gameId}:entryRake`, "entry_rake", payments, {
        label: "半荘開始時レーキ",
        entryRakePoints: entryRake,
      });
    }
    const result = state.handLog?.result;
    if (result?.chipSettlement?.payments) {
      await syncOneClubPointEffect(room, `${handId}:chipSettlement`, "shugi", result.chipSettlement.payments, {
        label: "祝儀",
        handId,
        resultType: result.type,
        winnerId: result.winnerId,
        winType: result.winType,
        chipSettlement: result.chipSettlement,
      });
    }
    if (result?.tobiPrize?.payments) {
      await syncOneClubPointEffect(room, `${handId}:tobiPrize`, "tobi_prize", result.tobiPrize.payments, {
        label: "飛び賞",
        handId,
        winnerId: result.winnerId,
        winType: result.winType,
        tobiPrize: result.tobiPrize,
      });
    }
    const finalSettlement = state.finalResult?.settlement;
    if (state.phase === "gameEnded" && finalSettlement?.settlements) {
      await syncOneClubPointEffect(room, `${room.gameId}:hanchanSettlement`, "hanchan_settlement", finalSettlement.settlements, {
        label: "半荘終了精算",
        finalResult: state.finalResult,
      });
    }
  })().catch((error) => {
    console.error("[ClubPointSync] failed", { tableId: room?.tableId, gameId: room?.gameId, error });
  }).finally(() => {
    room.clubPointSyncInFlight = null;
  });
  return room.clubPointSyncInFlight;
};

const ACTION_TYPES = new Set(["draw", "discard", "ron", "tsumo", "pon", "kan", "riichi", "skip", "flower", "nukiDora", "resultOk", "declareLastHand"]);

const DEFAULT_RULE_CONFIG = {
  rocket19Enabled: false,
  baibaEnabled: false,
  otokogiEnabled: true,
  feverRiichiEnabled: false,
  turquoise5pCount: 0,
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
  turquoise5pCount: [0, 1, 2].includes(Number(config?.turquoise5pCount)) ? Number(config.turquoise5pCount) : 0,
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
    const pointDelta = Math.round(raw * rate * 10) / 10;
    settlements[player.id] = pointDelta;
    lowerTotal += pointDelta;
    details.push({ playerId: player.id, rank: rankIndex + 1, score: Number(player.score || 0), uma: uma[rankIndex] || 0, raw, pointDelta });
  });
  if (ranked[0]) {
    settlements[ranked[0].id] = Math.round(-lowerTotal * 10) / 10;
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
  return Math.round((chipValuePoints / 1000) * rate * 10) / 10;
};
const calculateTsumoLosslessChipSettlement = (state, winner, winType, loserId, scoreResult) => {
  if (!isTsumoLossless3maState(state)) return null;
  const yakuNames = new Set(ensureArray(scoreResult?.yakuList || scoreResult?.yaku).map((item) => item.name));
  const blueChips = ensureArray(scoreResult?.winningTiles).filter((tile) => tile?.color === "blue" || tile?.isRocket).length + ensureArray(winner?.nukiDoraTiles).filter((tile) => tile?.color === "blue").length;
  const ippatsuChips = yakuNames.has("一発") ? 1 : 0;
  const uraChips = Number(scoreResult?.dora?.ura || 0);
  const yakumanChips = ensureArray(scoreResult?.yakuList || scoreResult?.yaku).some((item) => item.isYakuman) ? (winType === "tsumo" ? 5 : 10) : 0;
  const chipsPerPayer = blueChips + ippatsuChips + uraChips + yakumanChips;
  const chipPoint = getChipPointValue(state);
  const pointPerPayer = Math.round(chipsPerPayer * chipPoint * 10) / 10;
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
  const prize = Math.round(chipPoint * 2 * 10) / 10;
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
const applyTsumoLosslessRoundAdvance = (state, result) => {
  if (!isTsumoLossless3maState(state)) return;
  state.round ??= {};
  const dealerId = state.round.dealerPlayerId;
  const isDealerWin = result?.type === "win" && result.winnerId === dealerId;
  const isDraw = result?.type === "exhaustiveDraw";
  state.round.honba = Number(state.round.honba || 0);
  if (isDealerWin || isDraw) state.round.honba += 1;
  else state.round.honba = 0;
  state.round.hanchanRoundIndex = getTsumoLosslessRoundIndex(state) + 1;
};
const prepareTsumoLosslessGameEnd = (state, reason = "hanchanEnd") => {
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
    nextHanchanSeatOrder: getNextHanchanSeatOrder(state),
  };
  state.handLog ??= {};
  state.handLog.result ??= { type: "gameEnded", reason };
  state.handLog.result.finalResult = state.finalResult;
  return state;
};

const isFlowerTile = (tile) => tile?.suit === "flower";
const currentPlayer = (state) => state?.players?.[state.currentPlayerIndex ?? 0] ?? null;
const findPlayer = (state, playerId) => state?.players?.find((player) => player.id === playerId) ?? null;
const ensureArray = (value) => Array.isArray(value) ? value : [];
const appendHandEvent = (state, event) => {
  state.handLog ??= {};
  state.handLog.events ??= [];
  state.handLog.events.push(event);
};
const drawFromWall = (state, player, source = "liveWall") => {
  const wall = source === "rinshanWall" ? state.rinshanWall : state.liveWall;
  if (!Array.isArray(wall) || wall.length === 0) return null;
  const tile = wall.shift();
  player.drawnTile = tile;
  state.lastDrawnTile = tile;
  appendHandEvent(state, { type: "draw", playerId: player.id, tile, from: source, turnIndex: state.turnIndex ?? 0 });
  return tile;
};
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
  state.pendingAction = { playerId, options, source };
  state.phase = "waitingForAction";
  state.isWaitingForHumanAction = true;
  state.activeClockPlayerId = playerId;
  state.clockStartedAt = Date.now();
  state.lastClockRenderTick = null;
  appendHandEvent(state, {
    type: "pendingAction",
    playerId,
    options: options.map((option) => option.type),
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
const isServerMenzen = (player) => !ensureArray(player?.melds).some((meld) => ["pon", "minkan", "kakan"].includes(meld?.type));
const getServerSeatWind = (state, playerId) => {
  const index = ensureArray(state?.players).findIndex((player) => player.id === playerId);
  return ["east", "south", "west"][Math.max(0, index)] || "west";
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
const serverPochiMultiplier = (tile) => {
  if (!isServerWhitePochiTile(tile)) return 1;
  if (tile.pochiColor === "red") return -2;
  if (tile.pochiColor === "yellow") return -1;
  if (tile.pochiColor === "blue") return 2;
  return 1;
};
const serverTileCloneWithColor = (tile, color) => ({ ...tile, id: `${tile.id || tileKindKey(tile)}-${color}-pochi`, color, isPochi: false, pochiColor: undefined });
const parseServerNumberKey = (key) => {
  const [suit, rawRank] = String(key || "").split(":");
  const rank = Number(rawRank);
  if (!["manzu", "pinzu", "souzu"].includes(suit) || !Number.isFinite(rank)) return null;
  return { suit, rank };
};
const serverFixedMelds = (melds = []) => ensureArray(melds).map((meld) => ({
  type: "triplet",
  key: tileKindKey(meld?.tiles?.[0]),
  source: meld?.type || "meld",
}));
const serverExtractMelds = (counts) => {
  const first = [...counts.entries()].find(([, count]) => count > 0);
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
  if (!parsed || shape.pairKey === winningKey) return false;
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
    const hasYakuman = ensureArray(yaku).some((item) => item.isYakuman);
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
  if (riichiYakuEnabled && player.isRiichi && player.ippatsu && !player.ippatsuOwnDrawStarted) baseYaku.push({ name: "一発", han: 1 });
  if (riichiYakuEnabled && isTsumo) baseYaku.push({ name: "門前清自摸和", han: 1, detail: turquoiseOpenRiichi ? "ターコイズ副露リーチ" : undefined });
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
  if (shapes.length === 0) return { canWin: false, reason: "和了形ではありません" };
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
const calculateServerScoreResult = (state, player, winType, tile, loserId, yaku) => {
  const winningTiles = [...ensureArray(player.hand), ...(tile ? [tile] : []), ...ensureArray(player.melds).flatMap((meld) => ensureArray(meld.tiles))].filter((item) => !isFlowerTile(item));
  const bonusSourceTiles = [...winningTiles, ...ensureArray(player.nukiDoraTiles)];
  const hasYakuman = ensureArray(yaku).some((item) => item.isYakuman);
  const yakuHan = hasYakuman ? 14 : ensureArray(yaku).reduce((sum, item) => sum + Number(item.han || 0), 0);
  const normalDora = hasYakuman ? 0 : countServerIndicatorDora(state.doraIndicators, winningTiles);
  const uraDora = hasYakuman || !player.isRiichi ? 0 : countServerIndicatorDora(state.uraDoraIndicators, winningTiles);
  const colored = hasYakuman ? 0 : winningTiles.filter((tileItem) => ["red", "blue", "gold", "turquoise"].includes(tileItem.color)).length;
  const nuki = hasYakuman ? 0 : ensureArray(player.nukiDoraTiles).length;
  const doraHan = normalDora + colored + nuki;
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
      limitType = tsumoScore.limitType;
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
      limitType = ronScore.limitType;
      basePoints = ronScore.basePoints + honba * 1000;
      payments[player.id] = basePoints;
      if (loserId) payments[loserId] = -basePoints;
    }
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
        normalDora ? { name: "ドラ", han: normalDora } : null,
        colored ? { name: "色付き牌ドラ", han: colored } : null,
        nuki ? { name: "抜きドラ", han: nuki } : null,
        uraDora ? { name: "裏ドラ", han: uraDora } : null,
      ].filter(Boolean),
      dora: { normal: normalDora, colored, nuki, ura: uraDora },
      bonuses: { honba: honba * 1000, chipPending: false },
      chipSettlement,
      baibaMultiplier: 1,
      payments,
      paymentDeltas: Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta })),
      winnerGain: payments[player.id] || 0,
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
  const baibaMultiplier = Number(state.settings?.ruleConfig?.baibaEnabled ? state.settings?.baibaMultiplier || 2 : 1);
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
    limitType,
    yaku,
    yakuList: yaku,
    doraDetails: [
      normalDora ? { name: "ドラ", han: normalDora } : null,
      colored ? { name: "色付き牌ドラ", han: colored } : null,
      nuki ? { name: "抜きドラ", han: nuki } : null,
      uraDora ? { name: "裏ドラ", han: uraDora } : null,
    ].filter(Boolean),
    dora: { normal: normalDora, colored, nuki, ura: uraDora },
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
    payments,
    paymentDeltas: Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta })),
    winnerGain: payments[player.id] || 0,
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
    const scoreResult = calculateServerScoreResult(state, player, winType, candidateTile, loserId, winCheck.yaku);
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
  const candidateIds = [];
  for (const tile of tiles) {
    const afterDiscard = tiles.filter((item) => item.id !== tile.id);
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
  const handTiles = ensureArray(player?.hand).filter((tile) => tileKindKey(tile) === targetKey);
  const drawnMatches = player?.drawnTile && tileKindKey(player.drawnTile) === targetKey ? 1 : 0;
  if (handTiles.length + drawnMatches < 3) return false;

  const visibleTiles = [...ensureArray(player?.hand), ...(player?.drawnTile ? [player.drawnTile] : [])].filter((tile) => !isFlowerTile(tile));
  const counts = countTilesForShape(visibleTiles);
  const targetCount = counts.get(targetKey) || 0;
  if (targetCount < 3) return false;

  const withoutTriplet = cloneCounts(counts);
  withoutTriplet.set(targetKey, targetCount - 3);
  for (const [key, count] of withoutTriplet.entries()) {
    if (count < 2) continue;
    const afterPair = cloneCounts(withoutTriplet);
    afterPair.set(key, count - 2);
    if (canRemoveAllMelds(afterPair)) return true;
  }
  return false;
};
const hasServerFeverRiichiTriplet = (player) =>
  hasServerPureClosedTriplet(player, "pinzu", 7) || hasServerPureClosedTriplet(player, "souzu", 7);
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
  const options = [];
  if (canServerTsumo(state, player)) {
    const option = { type: "tsumo", playerId: player.id, sourceTile: player.drawnTile || null, tile: player.drawnTile || null };
    if (player.isRiichi) {
      applyServerAction(state, { playerId: player.id, actionType: "tsumo", payload: { action: option, sourceTile: player.drawnTile || null } });
      return true;
    }
    options.push(option);
  }
  if (!player.isRiichi && Number(state.kanCount || 0) < 4) {
    const kanTile = findFourOfAKindTile(combinedHandTiles(player).filter((tile) => !isFlowerTile(tile)));
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
    appendHandEvent(state, { type: "nukiDora", playerId: player.id, tile, turnIndex: state.turnIndex ?? 0 });
    drawRinshanAfterFlower(state, player, removedFromDrawn);
    player.hand = sortHandTiles(player.hand);
  }
  state.pendingServerEffect = null;
  state.flowerAnnouncement = null;
  const nextFlower = findAutoFlowerTile(player);
  if (nextFlower) return beginServerFlowerAnnouncement(state, player, nextFlower);
  state.phase = "waitingForHumanDiscard";
  if (!queueServerSelfDrawOptions(state, player)) startServerClockForPlayer(state, player);
  return true;
};
const queueServerAfterDiscardOptions = (state, fromPlayerId, sourceTile) => {
  const candidates = ensureArray(state.players).filter((player) => player.id !== fromPlayerId && player.type !== "cpu");
  for (const player of candidates) {
    const matchingCount = ensureArray(player.hand).filter((tile) => sameTileKind(tile, sourceTile)).length;
    const options = [];
    if (canServerRon(state, player, sourceTile)) {
      const option = { type: "ron", playerId: player.id, fromPlayerId, sourceTile };
      if (player.isRiichi) {
        applyServerAction(state, { playerId: player.id, actionType: "ron", payload: { action: option, fromPlayerId, sourceTile } });
        return true;
      }
      options.push(option);
    }
    if (!player.isRiichi) {
      if (matchingCount >= 3 && Number(state.kanCount || 0) < 4) {
        options.push({ type: "kan", playerId: player.id, fromPlayerId, sourceTile, options: { kanType: "minkan" } });
      }
      if (matchingCount >= 2) {
        options.push({ type: "pon", playerId: player.id, fromPlayerId, sourceTile });
      }
    }
    if (options.length > 0) {
      return setServerPendingActions(state, player.id, options, { type: "afterDiscard", fromPlayerId, sourceTile });
    }
  }
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
    appendHandEvent(state, { type: "exhaustiveDraw", turnIndex: state.turnIndex ?? 0, reason: "liveWallEmpty" });
    return;
  }
  const flower = findAutoFlowerTile(player);
  if (flower && beginServerFlowerAnnouncement(state, player, flower)) return;
  if (queueServerSelfDrawOptions(state, player)) return;
};
const discardForServer = (state, player, tileId, { isRiichiDiscard = false, resolveAfterDiscard = true } = {}) => {
  stopServerClockForPlayer(state, player.id, { recoverAfterDiscard: true });
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
  appendHandEvent(state, { type: "discard", playerId: player.id, tile, discardType, isRiichiDiscard, turnIndex: state.turnIndex ?? 0 });
  state.turnIndex = Number(state.turnIndex || 0) + 1;
  state.phase = "playing";
  state.pendingAction = null;
  if (resolveAfterDiscard && queueServerAfterDiscardOptions(state, player.id, tile)) return tile;
  advanceTurn(state);
  enterCurrentTurnOnServer(state);
  return tile;
};
const addDoraAfterKan = (state) => {
  state.kanCount = Number(state.kanCount || 0) + 1;
  const indicator = ensureArray(state.liveWall).shift();
  if (indicator) {
    state.doraIndicators ??= [];
    state.doraIndicators.push(indicator);
    appendHandEvent(state, { type: "doraReveal", tile: indicator, turnIndex: state.turnIndex ?? 0 });
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

  if (action === "resultOk") {
    if (!state.handLog?.result && !["exhaustiveDraw", "handEnded"].includes(state.phase)) return state;
    state.resultOkPlayerIds = [...new Set([...(state.resultOkPlayerIds ?? []), player.id, ...ensureArray(state.players).filter((p) => p.type === "cpu").map((p) => p.id)])];
    state.handLog.result.resultOkPlayerIds = [...state.resultOkPlayerIds];
    appendHandEvent(state, { type: "resultOk", playerId: player.id, resultOkPlayerIds: [...state.resultOkPlayerIds], turnIndex: state.turnIndex ?? 0 });
    const requiredOkPlayerIds = ensureArray(state.players).filter((p) => p.type !== "cpu").map((p) => p.id);
    const allOk = requiredOkPlayerIds.length === 0 || requiredOkPlayerIds.every((id) => state.resultOkPlayerIds.includes(id));
    if (!allOk) return state;
    if (isTsumoLossless3maState(state)) {
      const result = state.handLog?.result;
      if (isTsumoLosslessHanchanFinished(state)) {
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
    return startNextServerHand(state);
  }

  if (action === "declareLastHand") {
    state.settings ??= {};
    state.lastHandDeclaredBy = ensureArray(state.lastHandDeclaredBy).filter((id) => id !== player.id);
    if (payload.isLastHand !== false) state.lastHandDeclaredBy.push(player.id);
    state.settings.isLastHand = state.lastHandDeclaredBy.length > 0;
    appendHandEvent(state, { type: "lastHand", playerId: player.id, isLastHand: state.settings.isLastHand, turnIndex: state.turnIndex ?? 0 });
    return state;
  }

  const isCallKan = action === "kan" && Boolean(payload.action?.fromPlayerId || payload.fromPlayerId);
  if (["draw", "discard", "riichi", "flower", "nukiDora", "tsumo"].includes(action) && active?.id !== player.id) {
    throw new Error("現在の手番ではありません");
  }

  if (action === "kan" && !isCallKan && active?.id !== player.id) {
    throw new Error("現在の手番ではありません");
  }

  if (action === "draw") {
    if (player.drawnTile) throw new Error("すでにツモ牌があります");
    drawFromWall(state, player, "liveWall");
    state.phase = "waitingForHumanDiscard";
    const flower = findAutoFlowerTile(player);
    if (flower && beginServerFlowerAnnouncement(state, player, flower)) return state;
    if (!queueServerSelfDrawOptions(state, player)) startServerClockForPlayer(state, player);
    return state;
  }

  if (action === "discard") {
    const tileId = payload.tileId || payload.tile?.id;
    if (!tileId) throw new Error("打牌する牌が指定されていません");
    discardForServer(state, player, tileId, { isRiichiDiscard: state.phase === "waitingForRiichiDiscard" });
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
      player.isRiichi = true;
      player.ippatsu = true;
      player.riichiTurnIndex = state.turnIndex ?? 0;
      player.feverRiichiActive = Boolean(state.settings?.ruleConfig?.feverRiichiEnabled && hasServerFeverRiichiTriplet(player));
      player.feverWinCount = 0;
      appendHandEvent(state, { type: "riichi", playerId: player.id, feverRiichiActive: player.feverRiichiActive, turnIndex: state.turnIndex ?? 0 });
      discardForServer(state, player, payload.tileId, { isRiichiDiscard: true });
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
    const tile = tileId === player.drawnTile?.id ? player.drawnTile : removeTileById(player.hand, tileId);
    if (!tile || !isNukiDoraTileForState(state, tile)) throw new Error("抜きドラにできる牌がありません");
    if (player.drawnTile?.id === tileId) player.drawnTile = null;
    player.nukiDoraTiles ??= [];
    player.nukiDoraTiles.push(tile);
    appendHandEvent(state, { type: "nukiDora", playerId: player.id, tile, turnIndex: state.turnIndex ?? 0 });
    drawFromWall(state, player, "rinshanWall");
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
    player.melds.push({ type: isMinkan ? "minkan" : "ankan", tiles, calledTile: isMinkan ? tiles[0] : undefined, fromPlayerId: isMinkan ? fromPlayerId : undefined });
    appendHandEvent(state, { type: "kan", playerId: player.id, fromPlayerId: isMinkan ? fromPlayerId : undefined, tiles, turnIndex: state.turnIndex ?? 0 });
    addDoraAfterKan(state);
    if (!isMinkan && player.drawnTile) {
      player.hand ??= [];
      player.hand.push(player.drawnTile);
      player.drawnTile = null;
    }
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
    const option = payload.action || {};
    const sourceTile = option.sourceTile || payload.sourceTile;
    const fromPlayerId = option.fromPlayerId || payload.fromPlayerId;
    if (!sourceTile || !fromPlayerId) throw new Error("ポン元の牌がありません");
    const same = (tile) => sameTileKind(tile, sourceTile);
    const calledTile = removeLastMatchingDiscard(state, fromPlayerId, sourceTile) || sourceTile;
    const tiles = [calledTile];
    player.hand = ensureArray(player.hand).filter((tile) => {
      if (same(tile) && tiles.length < 3) { tiles.push(tile); return false; }
      return true;
    });
    if (tiles.length < 3) throw new Error("ポンに必要な2枚がありません");
    player.melds ??= [];
    player.melds.push({ type: "pon", tiles, calledTile, fromPlayerId });
    player.hand = sortHandTiles(player.hand);
    state.currentPlayerIndex = state.players.findIndex((p) => p.id === player.id);
    state.players.forEach((p) => { p.status = p.id === player.id ? "active" : "waiting"; });
    state.pendingAction = null;
    state.phase = "waitingForHumanDiscard";
    appendHandEvent(state, { type: "pon", playerId: player.id, fromPlayerId, tile: sourceTile, turnIndex: state.turnIndex ?? 0 });
    if (!queueServerSelfDrawOptions(state, player)) startServerClockForPlayer(state, player);
    return state;
  }

  if (action === "ron" || action === "tsumo") {
    const winningTile = action === "tsumo"
      ? player.drawnTile
      : (payload.tile || payload.action?.sourceTile || payload.sourceTile);
    const loserId = payload.action?.fromPlayerId || payload.discarderId || payload.fromPlayerId;
    const pochiResolution = action === "tsumo" ? resolveServerPochiWin(state, player, winningTile, action, loserId) : null;
    const effectiveWinningTile = pochiResolution?.selectedWait || winningTile;
    const winCheck = pochiResolution?.winCheck || evaluateServerWin(state, player, effectiveWinningTile, action);
    if (!winCheck.canWin) throw new Error(winCheck.reason || "和了できません");
    if (action === "ron") {
      const waits = getWinningTilesForServerTenpai(player);
      if (isServerFuritenForWaits(player, waits)) throw new Error("フリテンのためロンできません");
    }
    const scoreResult = pochiResolution?.scoreResult || calculateServerScoreResult(state, player, action, effectiveWinningTile, loserId, winCheck.yaku);
    for (const p of ensureArray(state.players)) {
      p.score = Number(p.score || 0) + Number(scoreResult.payments?.[p.id] || 0);
    }
    const chipSettlement = isTsumoLossless3maState(state)
      ? (scoreResult.chipSettlement || calculateTsumoLosslessChipSettlement(state, player, action, loserId, scoreResult))
      : null;
    const tobiPrize = isTsumoLossless3maState(state)
      ? calculateTsumoLosslessTobiPrize(state, player.id, action, loserId)
      : null;
    state.pendingAction = null;
    state.phase = "handEnded";
    state.handLog ??= {};
    state.handLog.result = {
      type: "win",
      winnerId: player.id,
      loserId,
      winType: action,
      winningTile: effectiveWinningTile,
      scoreResult,
      payments: scoreResult.paymentDeltas,
      chipSettlement,
      tobiPrize,
    };
    appendHandEvent(state, { type: action, playerId: player.id, fromPlayerId: loserId, tile: effectiveWinningTile, originalTile: winningTile, scoreResult, turnIndex: state.turnIndex ?? 0 });
    return state;
  }

  return state;
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
  if (!player || !player.isRiichi) {
    state.phase = "playing";
    return false;
  }
  if (!player.drawnTile) {
    state.phase = "waitingForHumanDiscard";
    return false;
  }
  state.phase = "playing";
  appendHandEvent(state, { type: "riichiAutoDiscard", playerId: player.id, tile: player.drawnTile, turnIndex: state.turnIndex ?? 0 });
  return Boolean(discardForServer(state, player, player.drawnTile.id));
};

const applyServerClockTimeout = (state) => {
  const playerId = state?.activeClockPlayerId;
  if (!playerId || state.handLog?.result || ["handEnded", "exhaustiveDraw", "gameEnded", "showingFlowerAnnouncement"].includes(state.phase)) return false;
  const player = findPlayer(state, playerId);
  if (!player) return false;
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
  const pochiColors = ["red", "yellow", "green", "blue"];
  for (const kind of ["east", "south", "west", "north", "white", "green", "red"]) {
    for (let copy = 1; copy <= 4; copy++) {
      const tile = { id: `honor-${kind}-${copy}`, suit: "honor", kind, color: "normal", isPochi: kind === "white" };
      if (kind === "white") tile.pochiColor = pochiColors[copy - 1];
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
  const first = [...counts.entries()].find(([, count]) => count > 0);
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
  const hand = ensureArray(player.hand).filter((tile) => !isFlowerTile(tile));
  if (hand.length === 13 - ensureArray(player.melds).length * 3) return hand;
  return hand.slice(0, Math.max(0, 13 - ensureArray(player.melds).length * 3));
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
    const scoreResult = calculateServerScoreResult(state, nagashiWinner, "tsumo", lastDiscard, null, yaku);
    for (const player of ensureArray(state.players)) {
      player.score = Number(player.score || 0) + Number(scoreResult.payments?.[player.id] || 0);
    }
    return {
      type: "win",
      winnerId: nagashiWinner.id,
      loserId: null,
      winType: "tsumo",
      winningTile: lastDiscard,
      scoreResult,
      payments: scoreResult.paymentDeltas,
      reason: "nagashiYakuman",
      finalScores: Object.fromEntries(ensureArray(state.players).map((player) => [player.id, player.score])),
    };
  }
  const tenpaiResults = ensureArray(state.players).map((player) => {
    const handTiles = getHand13ForServerTenpai(player);
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
    lastScoreResult: null,
    winAnnouncement: null,
    flowerAnnouncement: null,
    playerClocks: createServerPlayerClocks(state.players, state.settings?.initialClockMs || 20000),
    activeClockPlayerId: null,
    clockStartedAt: null,
    resultOkPlayerIds: [],
    lastClockRenderTick: null,
  });
  state.round ??= {};
  state.round.initialSeatOrder = ensureArray(state.round.initialSeatOrder).length ? state.round.initialSeatOrder : ensureArray(state.players).map((player) => player.id);
  state.round.roundWind = isTsumoLossless && nextRoundIndex >= 3 ? "south" : "east";
  state.round.handNumber = handNumber;
  state.round.hanchanRoundIndex = nextRoundIndex;
  state.round.dealerPlayerId = nextDealerId;
  for (const player of ensureArray(state.players)) {
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
      feverRiichiActive: false,
      feverWinCount: 0,
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
    initialHands: Object.fromEntries(ensureArray(state.players).map((player) => [player.id, [...player.hand]])),
    initialDoraIndicators: [...ensureArray(state.doraIndicators)],
    initialScores: Object.fromEntries(ensureArray(state.players).map((player) => [player.id, player.score])),
  };
  for (const tile of ensureArray(state.doraIndicators)) appendHandEvent(state, { type: "doraReveal", tile, doraIndicators: [...state.doraIndicators], turnIndex: state.turnIndex, reason: "initial" });
  state.replayInitialState = clone(state);
  state.replaySnapshots = [clone(state)];
  state.lastSavedReplayId = null;
  enterCurrentTurnOnServer(state);
  advanceServerCpuTurns(state);
  return state;
};

const createServerInitialState = ({ tableId, gameId, players = [], settings = {}, ruleConfig = {} }) => {
  const ruleId = settings.ruleId || settings.gameType || "anmika-rocket";
  const normalizedRuleConfig = normalizeRuleConfigForRule(ruleId, ruleConfig || settings.ruleConfig);
  const normalizedPlayers = players.slice(0, 3).map((player, index) => ({
    id: player.id || `cpu${index}`,
    name: player.name || (player.type === "cpu" ? `CPU${index}` : `プレイヤー${index + 1}`),
    type: player.type === "cpu" ? "cpu" : "remote",
    score: Number(player.score ?? (ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? 35000 : 0)),
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
      score: ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? 35000 : 0,
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
    lastScoreResult: null,
    winAnnouncement: null,
    flowerAnnouncement: null,
    settings: {
      ...settings,
      ruleId,
      gameType: settings.gameType || ruleId,
      ruleConfig: normalizedRuleConfig,
      baibaMultiplier: ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? 1 : (normalizedRuleConfig.baibaEnabled ? 2 : 1),
    },
    activeTableId: tableId,
    screen: "game",
    rakePool: 0,
    playerClocks: createServerPlayerClocks(normalizedPlayers, 20000),
    activeClockPlayerId: null,
    clockStartedAt: null,
    resultOkPlayerIds: [],
    handLog: {
      handId: `socket-${gameId || tableId}-${Date.now()}`,
      roundLabel: ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? "東1局" : "東場",
      dealerId,
      events: [],
      initialHands: Object.fromEntries(normalizedPlayers.map((player) => [player.id, [...player.hand]])),
      initialDoraIndicators: [...walls.doraIndicators],
      initialScores: Object.fromEntries(normalizedPlayers.map((player) => [player.id, player.score])),
    },
    log: [],
    replayInitialState: null,
    replaySnapshots: [],
    lastSavedReplayId: null,
  };
  for (const tile of state.doraIndicators) appendHandEvent(state, { type: "doraReveal", tile, doraIndicators: [...state.doraIndicators], turnIndex: state.turnIndex, reason: "initial" });
  state.players[0].status = "active";
  enterCurrentTurnOnServer(state);
  advanceServerCpuTurns(state);
  state.replayInitialState = clone(state);
  state.replaySnapshots = [clone(state)];
  return state;
};

const getOrCreateRoom = ({ tableId, gameId }) => {
  const key = makeRoomKey(tableId);
  if (!key) throw new Error("tableId is required");
  let room = gameRooms.get(key);
  if (!room) {
    room = loadPersistedRoom(key);
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
      events: [],
      sockets: new Map(),
      updatedAt: now(),
    };
    gameRooms.set(key, room);
  }
  if (gameId && !room.gameId) room.gameId = gameId;
  return room;
};

const broadcastState = (room) => {
  for (const [socketId, meta] of room.sockets.entries()) {
    io.to(socketId).emit("game:state", publicRoomState(room, meta?.userId || null));
  }
};
const isWaitingForResultOk = (state) => Boolean(state?.handLog?.result && ["handEnded", "exhaustiveDraw"].includes(state.phase));
const applyAutoResultOk = (state) => {
  if (!isWaitingForResultOk(state)) return false;
  const requiredOkPlayerIds = ensureArray(state.players).filter((player) => player.type !== "cpu").map((player) => player.id);
  const cpuPlayerIds = ensureArray(state.players).filter((player) => player.type === "cpu").map((player) => player.id);
  state.resultOkPlayerIds = [...new Set([...(state.resultOkPlayerIds ?? []), ...requiredOkPlayerIds, ...cpuPlayerIds])];
  state.handLog.result.resultOkPlayerIds = [...state.resultOkPlayerIds];
  appendHandEvent(state, { type: "resultOkAuto", playerId: null, resultOkPlayerIds: [...state.resultOkPlayerIds], turnIndex: state.turnIndex ?? 0 });
  if (state.settings?.isLastHand) {
    state.pendingAction = null;
    state.phase = "gameEnded";
    state.isWaitingForHumanAction = false;
    state.activeClockPlayerId = null;
    state.clockStartedAt = null;
    return true;
  }
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
  room.state.resultCountdownStartedAt ??= Date.now();
  const delay = Math.max(0, Number(room.state.resultCountdownStartedAt) + 10000 - Date.now());
  room.resultTimer = setTimeout(() => {
    room.resultTimer = null;
    if (!applyAutoResultOk(room.state)) return;
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
    syncClubPointEffects(room);
    broadcastState(room);
    scheduleRoomServerEffect(room);
    scheduleRoomClockTimeout(room);
    scheduleRoomResultTimeout(room);
  }, delay);
};
const scheduleRoomServerEffect = (room) => {
  if (!room?.state?.pendingServerEffect || room.effectTimer) return;
  const delay = Math.max(0, Number(room.state.pendingServerEffect.resumeAt || Date.now()) - Date.now());
  room.effectTimer = setTimeout(() => {
    room.effectTimer = null;
    if (!room.state?.pendingServerEffect) return;
    if (room.state.pendingServerEffect.type === "flower") applyServerFlowerEffect(room.state);
    else if (room.state.pendingServerEffect.type === "cpuDiscard") applyServerCpuDiscardEffect(room.state);
    else if (room.state.pendingServerEffect.type === "riichiAutoDiscard") applyServerRiichiAutoDiscardEffect(room.state);
    advanceServerCpuTurns(room.state);
    room.version = Number(room.version || 0) + 1;
    room.state.version = room.version;
    room.updatedAt = now();
    persistRoom(room);
    syncClubPointEffects(room);
    broadcastState(room);
    scheduleRoomServerEffect(room);
    scheduleRoomClockTimeout(room);
    scheduleRoomResultTimeout(room);
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
    room.clockTimer = null;
    if (!room.state?.activeClockPlayerId) return;
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
    syncClubPointEffects(room);
    broadcastState(room);
    scheduleRoomServerEffect(room);
    scheduleRoomClockTimeout(room);
    scheduleRoomResultTimeout(room);
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
  room.updatedAt = now();
  persistRoom(room);
  syncClubPointEffects(room);
  broadcastState(room);
  scheduleRoomServerEffect(room);
  scheduleRoomClockTimeout(room);
  scheduleRoomResultTimeout(room);
  return publicRoomState(room, publishedBy);
};

const registerGameSocketHandlers = () => {
io.on("connection", (socket) => {
  socket.on("game:join", (payload = {}, ack) => {
    try {
      const { tableId, gameId, userId } = payload;
      const room = getOrCreateRoom({ tableId, gameId });
      console.log("[AnmikaGameServer] join", { tableId: room.tableId, gameId: room.gameId, userId, hasState: Boolean(room.state), version: room.version });
      room.sockets.set(socket.id, { userId, joinedAt: now() });
      socket.join(`table:${room.tableId}`);
      socket.data.tableId = room.tableId;
      socket.data.userId = userId;
      if (room.state) {
        socket.emit("game:state", publicRoomState(room, userId));
        scheduleRoomServerEffect(room);
        scheduleRoomClockTimeout(room);
        scheduleRoomResultTimeout(room);
      } else {
        socket.emit("game:needInitialState", { tableId: room.tableId, gameId: room.gameId });
      }
      ack?.({ ok: true, ...publicRoomState(room, userId) });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on("game:initState", (payload = {}, ack) => {
    try {
      const { tableId, gameId, state, players, settings, ruleConfig, userId } = payload;
      const room = getOrCreateRoom({ tableId, gameId });
      console.log("[AnmikaGameServer] initState", { tableId: room.tableId, gameId: room.gameId, userId: userId || socket.data.userId, alreadyInitialized: Boolean(room.state) });
      if (room.state) {
        const viewerId = userId || socket.data.userId || null;
        ack?.({ ok: true, alreadyInitialized: true, ...publicRoomState(room, viewerId) });
        socket.emit("game:state", publicRoomState(room, viewerId));
        scheduleRoomServerEffect(room);
        scheduleRoomClockTimeout(room);
        scheduleRoomResultTimeout(room);
        return;
      }
      const serverState = createServerInitialState({
        tableId: room.tableId,
        gameId: room.gameId,
        players,
        settings,
        ruleConfig,
      });
      acceptStateFromServerPipeline(room, serverState || state, "serverInitial", userId || socket.data.userId);
      ack?.({ ok: true, ...publicRoomState(room, userId || socket.data.userId || null) });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on("game:action", (payload = {}, ack) => {
    try {
      const { tableId, gameId, playerId, actionType, turnVersion, payload: actionPayload } = payload;
      const room = getOrCreateRoom({ tableId, gameId });
      if (!room.state) throw new Error("対局が初期化されていません");
      let clientVersion = Number(turnVersion ?? room.version);
      if (actionType === "resultOk") clientVersion = room.version;
      if (clientVersion !== room.version) throw new Error("局面のバージョンが古いため操作できません");
      if (!ACTION_TYPES.has(actionType)) throw new Error("未対応の操作です");
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
      const nextState = clone(room.state);
      applyServerAction(nextState, event);
      advanceServerCpuTurns(nextState);
      room.events.push(event);
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
      persistRoom(room);
      syncClubPointEffects(room);
      io.to(`table:${room.tableId}`).emit("game:event", event);
      broadcastState(room);
      scheduleRoomServerEffect(room);
      scheduleRoomClockTimeout(room);
      scheduleRoomResultTimeout(room);
      ack?.({ ok: true, event, ...publicRoomState(room, playerId) });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on("game:publishState", (payload = {}, ack) => {
    try {
      ack?.({ ok: false, error: "Socket.IO対局中の局面更新は game:initState または game:action で受け付けます。" });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on("game:requestState", (payload = {}, ack) => {
    try {
      const room = getOrCreateRoom(payload);
      const viewerId = payload.userId || socket.data.userId || null;
      ack?.({ ok: true, ...publicRoomState(room, viewerId) });
      if (room.state) {
        socket.emit("game:state", publicRoomState(room, viewerId));
        scheduleRoomServerEffect(room);
        scheduleRoomClockTimeout(room);
        scheduleRoomResultTimeout(room);
      }
      else socket.emit("game:needInitialState", { tableId: room.tableId, gameId: room.gameId });
    } catch (error) {
      ack?.({ ok: false, error: error.message });
    }
  });

  socket.on("disconnect", () => {
    const tableId = socket.data.tableId;
    if (!tableId) return;
    const room = gameRooms.get(tableId);
    room?.sockets.delete(socket.id);
  });
});
};

export const attachAnmikaGameServer = (httpServer) => {
  if (io) return io;
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
      methods: ["GET", "POST"],
    },
  });
  registerGameSocketHandlers();
  return io;
};

export const createAnmikaGameHttpServer = () => {
  const httpServer = createHealthServer();
  attachAnmikaGameServer(httpServer);
  return httpServer;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const httpServer = createAnmikaGameHttpServer();
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[AnmikaGameServer] listening on http://0.0.0.0:${PORT}`);
  });
}
