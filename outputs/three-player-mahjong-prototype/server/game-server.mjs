import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const PORT = Number(process.env.GAME_SERVER_PORT || 8787);
const allowedOrigins = (process.env.GAME_SERVER_CORS || "*").split(",").map((item) => item.trim()).filter(Boolean);
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

const ACTION_TYPES = new Set(["draw", "discard", "ron", "tsumo", "pon", "kan", "riichi", "skip", "flower", "nukiDora", "resultOk", "declareLastHand"]);

const DEFAULT_RULE_CONFIG = {
  rocket19Enabled: false,
  baibaEnabled: false,
  otokogiEnabled: true,
  feverRiichiEnabled: false,
  turquoise5pCount: 0,
};

const normalizeRuleConfig = (config = {}) => ({
  ...DEFAULT_RULE_CONFIG,
  ...(config || {}),
  turquoise5pCount: [0, 1, 2].includes(Number(config?.turquoise5pCount)) ? Number(config.turquoise5pCount) : 0,
});

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
  const concealedTiles = [...ensureArray(player?.hand), ...(tile ? [tile] : player?.drawnTile ? [player.drawnTile] : [])].filter((item) => !isFlowerTile(item));
  const melds = ensureArray(player?.melds);
  const allTiles = [...concealedTiles, ...melds.flatMap((meld) => ensureArray(meld.tiles))].filter((item) => !isFlowerTile(item));
  if (!isWinningShapeServer(concealedTiles, melds)) return { canWin: false, reason: "和了形ではありません" };
  const counts = countTilesForShape(concealedTiles);
  const isClosed = isServerMenzen(player);
  const turquoiseOpenRiichi = player.isRiichi && !isClosed && hasTurquoise5pInHandOrMeldsServer(player);
  const yaku = [];
  if (melds.length === 0 && isKokushiShape(counts)) yaku.push({ name: "国士無双", han: 13, isYakuman: true });
  if (melds.length === 0 && isSevenPairsShapeServer(counts)) yaku.push({ name: "七対子", han: 2 });
  if ((isClosed || turquoiseOpenRiichi) && player.isRiichi) yaku.push({ name: "リーチ", han: 1, detail: turquoiseOpenRiichi ? "ターコイズ副露リーチ" : undefined });
  if ((isClosed || turquoiseOpenRiichi) && player.isRiichi && player.ippatsu && !player.ippatsuOwnDrawStarted) yaku.push({ name: "一発", han: 1 });
  if ((isClosed || turquoiseOpenRiichi) && winType === "tsumo") yaku.push({ name: "門前清自摸和", han: 1, detail: turquoiseOpenRiichi ? "ターコイズ副露リーチ" : undefined });
  if (isServerTanyao(allTiles)) yaku.push({ name: "タンヤオ", han: 1 });
  const seatWind = getServerSeatWind(state, player.id);
  for (const key of getServerTripletKeys(counts, melds)) {
    const han = getServerYakuhaiHan(key, seatWind, state?.round?.roundWind || "east");
    if (han > 0) yaku.push({ name: `役牌 ${serverTileLabel(key)}`, han, detail: han === 2 ? "常時役牌 + 自風" : undefined });
  }
  const tripletCount = getServerTripletKeys(counts, melds).length;
  if (tripletCount >= 4) yaku.push({ name: "対々和", han: 2 });
  const hasYakuman = yaku.some((item) => item.isYakuman);
  if (!hasYakuman && state?.settings?.ruleConfig?.otokogiEnabled !== false && isClosed && !player.isRiichi) {
    return { canWin: false, reason: "門前ダマテン和了は禁止です" };
  }
  if (yaku.length === 0) return { canWin: false, reason: "和了形ですが役がありません" };
  return { canWin: true, yaku, winningTiles: allTiles, selectedWait: tile || player.drawnTile || allTiles.at(-1) };
};
const calculateServerScoreResult = (state, player, winType, tile, loserId, yaku) => {
  const winningTiles = [...ensureArray(player.hand), ...(tile ? [tile] : []), ...ensureArray(player.melds).flatMap((meld) => ensureArray(meld.tiles))].filter((item) => !isFlowerTile(item));
  const bonusSourceTiles = [...winningTiles, ...ensureArray(player.nukiDoraTiles)];
  const hasYakuman = ensureArray(yaku).some((item) => item.isYakuman);
  const yakuHan = hasYakuman ? 14 : ensureArray(yaku).reduce((sum, item) => sum + Number(item.han || 0), 0);
  const normalDora = hasYakuman ? 0 : countServerIndicatorDora(state.doraIndicators, winningTiles);
  const colored = hasYakuman ? 0 : winningTiles.filter((tileItem) => ["red", "blue", "gold", "turquoise"].includes(tileItem.color)).length;
  const nuki = hasYakuman ? 0 : ensureArray(player.nukiDoraTiles).length;
  const doraHan = normalDora + colored + nuki;
  const totalHan = hasYakuman ? 14 : yakuHan + doraHan;
  const { basePoints, limitType } = getServerBaseScoreFromHan(totalHan, player.id === state.round?.dealerPlayerId);
  const blueTileBonus = bonusSourceTiles.filter((tileItem) => tileItem.color === "blue" && !tileItem.isPochi).length * 20;
  const goldTileBonus = bonusSourceTiles.filter((tileItem) => tileItem.color === "gold").length * 5;
  const bonusPoints = blueTileBonus + goldTileBonus;
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
    ].filter(Boolean),
    dora: { normal: normalDora, colored, nuki, ura: 0 },
    bonuses: { blueTile: blueTileBonus, rocket: blueTileBonus, goldTile: goldTileBonus, baiba: totalPoints - beforeBaibaPoints },
    baibaMultiplier,
    payments,
    paymentDeltas: Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta })),
    winnerGain: payments[player.id] || 0,
  };
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
    if (waits.length > 0 && !isServerFuritenForWaits({ ...player, hand: afterDiscard, drawnTile: null }, waits)) candidateIds.push(tile.id);
  }
  return [...new Set(candidateIds)];
};
const canServerTsumo = (state, player) => evaluateServerWin(state, player, player?.drawnTile, "tsumo").canWin;
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
const queueServerSelfDrawOptions = (state, player) => {
  if (!player || player.type === "cpu") return false;
  const options = [];
  if (canServerTsumo(state, player)) {
    options.push({ type: "tsumo", playerId: player.id, sourceTile: player.drawnTile || null, tile: player.drawnTile || null });
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
      options.push({ type: "ron", playerId: player.id, fromPlayerId, sourceTile });
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
    player.isRiichi = true;
    player.ippatsu = true;
    player.riichiTurnIndex = state.turnIndex ?? 0;
    player.feverRiichiActive = Boolean(state.settings?.ruleConfig?.feverRiichiEnabled && hasServerFeverRiichiTriplet(player));
    player.feverWinCount = 0;
    appendHandEvent(state, { type: "riichi", playerId: player.id, feverRiichiActive: player.feverRiichiActive, turnIndex: state.turnIndex ?? 0 });
    if (payload.tileId) discardForServer(state, player, payload.tileId, { isRiichiDiscard: true });
    else {
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
    if (!tile || !isFlowerTile(tile)) throw new Error("抜きドラにできる華牌がありません");
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
    const winCheck = evaluateServerWin(state, player, winningTile, action);
    if (!winCheck.canWin) throw new Error(winCheck.reason || "和了できません");
    if (action === "ron") {
      const waits = getWinningTilesForServerTenpai(player);
      if (isServerFuritenForWaits(player, waits)) throw new Error("フリテンのためロンできません");
    }
    const scoreResult = calculateServerScoreResult(state, player, action, winningTile, loserId, winCheck.yaku);
    for (const p of ensureArray(state.players)) {
      p.score = Number(p.score || 0) + Number(scoreResult.payments?.[p.id] || 0);
    }
    state.pendingAction = null;
    state.phase = "handEnded";
    state.handLog ??= {};
    state.handLog.result = {
      type: "win",
      winnerId: player.id,
      loserId,
      winType: action,
      scoreResult,
      payments: scoreResult.paymentDeltas,
    };
    appendHandEvent(state, { type: action, playerId: player.id, fromPlayerId: loserId, tile: winningTile, scoreResult, turnIndex: state.turnIndex ?? 0 });
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

const colorForNumberTile = (suit, rank, copy, ruleConfig = DEFAULT_RULE_CONFIG) => {
  if (rank === 5 && suit === "pinzu") {
    if (ruleConfig.turquoise5pCount === 1) return copy === 1 ? "red" : copy === 2 ? "gold" : copy === 3 ? "blue" : "turquoise";
    if (ruleConfig.turquoise5pCount === 2) return copy <= 2 ? "turquoise" : copy === 3 ? "gold" : "blue";
    return copy <= 2 ? "red" : copy === 3 ? "gold" : "blue";
  }
  if (rank === 5 && suit === "souzu") return copy <= 2 ? "red" : copy === 3 ? "gold" : "blue";
  if (ruleConfig.rocket19Enabled && copy === 4 && isRocketTargetTile(suit, rank)) return "blue";
  return "normal";
};

const createWallTiles = (ruleConfigInput = {}) => {
  const ruleConfig = normalizeRuleConfig(ruleConfigInput);
  const tiles = [];
  for (const spec of [{ suit: "manzu", ranks: [1, 9] }, { suit: "pinzu", ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { suit: "souzu", ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9] }]) {
    for (const rank of spec.ranks) {
      for (let copy = 1; copy <= 4; copy++) {
        const isRocket = Boolean(ruleConfig.rocket19Enabled && copy === 4 && isRocketTargetTile(spec.suit, rank));
        tiles.push({
          id: `${spec.suit}-${rank}-${copy}${isRocket ? "-rocket" : ""}`,
          suit: spec.suit,
          rank,
          color: colorForNumberTile(spec.suit, rank, copy, ruleConfig),
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
    tiles.push({ id: `flower-hua-${copy}`, suit: "flower", kind: "flower", color: copy <= 3 ? "red" : "blue", isPochi: false });
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

const splitStartingWalls = (wall) => {
  const copied = [...wall];
  return { rinshanWall: copied.splice(-8), doraIndicators: copied.splice(-1), uraDoraIndicators: copied.splice(-1), liveWall: copied };
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
  const tenpaiResults = ensureArray(state.players).map((player) => {
    const handTiles = getHand13ForServerTenpai(player);
    const waits = getWinningTilesForServerTenpai(player);
    return { playerId: player.id, isTenpai: waits.length > 0, waits, handTiles };
  });
  const tenpaiPlayerIds = tenpaiResults.filter((item) => item.isTenpai).map((item) => item.playerId);
  const paymentMap = Object.fromEntries(ensureArray(state.players).map((player) => [player.id, 0]));
  if (tenpaiPlayerIds.length === 1) {
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
  const nextDealerId = result?.type === "win" ? result.winnerId : state.round?.dealerPlayerId || state.players?.[0]?.id || "";
  const handNumber = Number(state.round?.handNumber || 1) + 1;
  const ruleConfig = normalizeRuleConfig(state.settings?.ruleConfig);
  const walls = splitStartingWalls(shuffle(createWallTiles(ruleConfig)));
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
  state.round.roundWind = "east";
  state.round.handNumber = handNumber;
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
    roundLabel: "譚ｱ蝣ｴ",
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
  const normalizedRuleConfig = normalizeRuleConfig(ruleConfig || settings.ruleConfig);
  const normalizedPlayers = players.slice(0, 3).map((player, index) => ({
    id: player.id || `cpu${index}`,
    name: player.name || (player.type === "cpu" ? `CPU${index}` : `プレイヤー${index + 1}`),
    type: player.type === "cpu" ? "cpu" : "remote",
    score: Number(player.score ?? 0),
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
      score: 0,
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

  const walls = splitStartingWalls(shuffle(createWallTiles(normalizedRuleConfig)));
  for (let i = 0; i < 13; i++) {
    for (const player of normalizedPlayers) {
      const tile = walls.liveWall.shift();
      if (tile) player.hand.push(tile);
    }
  }
  for (const player of normalizedPlayers) player.hand = sortHandTiles(player.hand);

  const dealerId = normalizedPlayers[0]?.id ?? "";
  const state = {
    players: normalizedPlayers,
    version: 0,
    ...walls,
    kanCount: 0,
    round: { roundWind: "east", handNumber: 1, dealerPlayerId: dealerId },
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
      ruleId: settings.ruleId || "anmika-rocket",
      gameType: settings.gameType || settings.ruleId || "anmika-rocket",
      ruleConfig: normalizedRuleConfig,
      baibaMultiplier: normalizedRuleConfig.baibaEnabled ? 2 : 1,
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
      roundLabel: "譚ｱ蝣ｴ",
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
    advanceServerCpuTurns(room.state);
    room.version = Number(room.version || 0) + 1;
    room.state.version = room.version;
    room.updatedAt = now();
    persistRoom(room);
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
