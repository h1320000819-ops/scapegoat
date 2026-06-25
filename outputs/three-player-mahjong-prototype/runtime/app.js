const MAX_AUTO_TURNS = 200;
const INITIAL_TIME_MS = 20000;
const RESULT_COUNTDOWN_SECONDS = 15;
const ONLINE_LOADING_DISPLAY_DELAY_MS = 5000;
const SOCKET_STARTUP_RESYNC_DELAYS_MS = [600, 1400, 2600, 4200, 6500];
const SOCKET_EARLY_TURN_WATCH_TURNS = 12;
const SOCKET_EARLY_TURN_WATCH_IDLE_MS = 2200;
const SOCKET_EARLY_TURN_WATCH_RESYNC_MS = 2600;
const SOCKET_STATE_STALL_IDLE_MS = 4500;
const SOCKET_STATE_STALL_RESYNC_MS = 3200;
const installResultOkClickBridge = () => {
  if (globalThis.__anmikaResultOkBridgeInstalled) return;
  globalThis.__anmikaResultOkBridgeInstalled = true;
  let lastHandledAt = 0;
  let lastHandledResultId = "";
  const handler = (event) => {
    const resultOk = event.target?.closest?.("[data-result-ok]");
    if (!resultOk) return;
    if ((event.type === "pointerdown" || event.type === "mousedown") && event.button !== 0) return;
    const resultId = resultOk.dataset?.resultId || "";
    const nowMs = Date.now();
    if (resultId && resultId === lastHandledResultId && nowMs - lastHandledAt < 180) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      event.stopPropagation();
      return;
    }
    lastHandledAt = nowMs;
    lastHandledResultId = resultId;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
    const controller = globalThis.__anmikaController || (typeof window !== "undefined" ? window.__anmikaController : null);
    controller?.handleResultOk?.({ resultId });
  };
  document.addEventListener("pointerdown", handler, true);
  document.addEventListener("click", handler, true);
};
installResultOkClickBridge();
const STOP_PHASES = new Set(["waitingForAction", "waitingForHumanDiscard", "waitingForRiichiDiscard", "showingWinAnnouncement", "showingFlowerAnnouncement", "showingCallAnnouncement", "handEnded", "exhaustiveDraw", "gameEnded"]);

const colorText = { normal: "", red: "赤", gold: "金", blue: "青", turquoise: "ターコイズ" };
const suitText = { man: "萬", pin: "筒", sou: "索", manzu: "萬", pinzu: "筒", souzu: "索", honor: "字", flower: "華" };
const honorText = { east: "東", south: "南", west: "西", north: "北", white: "白", green: "發", red: "中" };
const pochiText = { red: "赤ぽっち", yellow: "黄ぽっち", green: "緑ぽっち", blue: "青ぽっち" };
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
const soundTypeForPochiTsumo = (scoreResult) => {
  if (isPochiResolvedAsWhite(scoreResult)) return "";
  const color = scoreResult?.pochiActivated ? scoreResult?.pochiColor : null;
  if (color === "red") return "pochiTsumoRed";
  if (color === "blue") return "pochiTsumoBlue";
  return "";
};
const soundTypeForWinAnnouncementKind = (kind) => {
  if (kind === "pochi-tsumo-red") return "pochiTsumoRed";
  if (kind === "pochi-tsumo-blue") return "pochiTsumoBlue";
  if (String(kind || "").startsWith("pochi-tsumo-")) return "tsumo";
  if (kind === "tsumo") return "tsumo";
  if (kind === "ron" || kind === "double-ron") return "ron";
  return "";
};
const TERMINAL_HONOR = new Set(["manzu-1", "manzu-9", "pinzu-1", "pinzu-9", "souzu-1", "souzu-9", "honor-east", "honor-south", "honor-west", "honor-north", "honor-white", "honor-green", "honor-red"]);
const UI_ASSETS = {
  avatars: {
    human: null,
    cpu1: null,
    cpu2: null,
  },
  dealerMark: null,
  tableBackground: null,
};
const CURRENT_USER_ID = "p1";
const DEBUG_AUTH_ENABLED = true;
const DEFAULT_ANMIKA_ROCKET_RULE_CONFIG = {
  rocket19Enabled: true,
  baibaEnabled: true,
  otokogiEnabled: true,
  feverRiichiEnabled: true,
  turquoise5pCount: 2,
};
const TSUMO_LOSSLESS_3MA_RULE_ID = "tsumo-lossless-red-3ma";
const TSUMO_LOSSLESS_ROUNDS = ["東1局", "東2局", "東3局", "南1局", "南2局", "南3局"];
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
const GAME_RULE_DEFINITIONS = [
  { id: "anmika-rocket", name: "アンミカロケット", implemented: true },
  { id: TSUMO_LOSSLESS_3MA_RULE_ID, name: "全赤三麻", implemented: true },
];
const normalizeAnmikaRocketRuleConfig = (config = {}) => ({
  ...DEFAULT_ANMIKA_ROCKET_RULE_CONFIG,
  ...config,
  turquoise5pCount: [0, 1, 2].includes(Number(config.turquoise5pCount)) ? Number(config.turquoise5pCount) : DEFAULT_ANMIKA_ROCKET_RULE_CONFIG.turquoise5pCount,
});
const normalizeTsumoLossless3maRuleConfig = (config = {}) => ({
  ...DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG,
  ...(config || {}),
  fiveTileComposition: ["red3blue1", "red4", "red2blue2", "blackBlackRedRed"].includes(config?.fiveTileComposition) ? config.fiveTileComposition : DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG.fiveTileComposition,
  flowerComposition: ["red3blue1", "red4", "red2blue2"].includes(config?.flowerComposition) ? config.flowerComposition : DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG.flowerComposition,
  entryRakePoints: Math.max(0.1, Math.min(10, Number(config?.entryRakePoints ?? DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG.entryRakePoints))),
  chipValuePoints: [2000, 5000, 10000].includes(Number(config?.chipValuePoints)) ? Number(config.chipValuePoints) : DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG.chipValuePoints,
  northNukiDoraEnabled: Boolean(config?.northNukiDoraEnabled),
  umaType: ["20-0--20", "30-0--30", "20-10--30"].includes(config?.umaType) ? config.umaType : DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG.umaType,
});
const normalizeRuleConfigForRule = (ruleId = "anmika-rocket", config = {}) =>
  ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? normalizeTsumoLossless3maRuleConfig(config) : normalizeAnmikaRocketRuleConfig(config);
const isTsumoLossless3maState = (state) =>
  state?.settings?.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID || state?.settings?.gameType === TSUMO_LOSSLESS_3MA_RULE_ID;
const isNorthNukiTile = (state, tile) =>
  isTsumoLossless3maState(state) && Boolean(state?.settings?.ruleConfig?.northNukiDoraEnabled) && tile?.suit === "honor" && tile?.kind === "north";
const isNukiDoraTileForState = (state, tile) => isFlowerTile(tile) || isNorthNukiTile(state, tile);
const createDefaultTableSettings = () => ({
  ruleId: "anmika-rocket",
  gameType: "anmika-rocket",
  rakePercent: 0,
  pointRate: 1,
  ruleConfig: normalizeAnmikaRocketRuleConfig(),
});
const APP_STORAGE_KEYS = {
  currentUser: "anmikaRocket.currentUser",
  currentUserId: "anmikaRocket.currentUserId",
  users: "anmikaRocket.users",
  tables: "anmikaRocket.tables",
  clubs: "anmikaRocket.clubs",
  replays: "anmikaRocket.replays",
  clubMemberPoints: "anmikaRocket.clubMemberPoints",
  onlineSync: "anmikaRocket.onlineSync",
  socketDebug: "anmikaRocket.socketDebug",
};
const now = () => Date.now();
const createId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${now()}-${Math.random().toString(36).slice(2)}`}`;
const createReadableId = (prefix) => `${prefix}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[char]));
const hashPassword = (password = "") => `local-${btoa(unescape(encodeURIComponent(password))).split("").reverse().join("")}`;
const replayUrlFor = (replayId) => {
  const origin = globalThis.location?.origin ?? "";
  const pathname = globalThis.location?.pathname ?? "";
  const encoded = encodeURIComponent(replayId);
  if (globalThis.location?.protocol === "file:") return `${origin}${pathname}#/replay/${encoded}`;
  return `${origin}/replay/${encoded}`;
};
const tableUrlFor = (tableId) => {
  const origin = globalThis.location?.origin ?? "";
  const pathname = globalThis.location?.pathname ?? "";
  const encoded = encodeURIComponent(tableId);
  // TODO: URL参加はlocalStorageでは別端末同期できないため、将来はTableRepositoryをサーバー/WebSocketへ差し替える。
  if (globalThis.location?.protocol === "file:") return `${origin}${pathname}#/table/${encoded}`;
  return `${origin}/table/${encoded}`;
};
const getReplayIdFromHash = () => {
  const match = globalThis.location?.hash?.match(/^#\/replay\/(.+)$/);
  if (match) return decodeURIComponent(match[1]);
  const pathMatch = globalThis.location?.pathname?.match(/\/replay\/([^/]+)$/);
  return pathMatch ? decodeURIComponent(pathMatch[1]) : null;
};
const getTableIdFromHash = () => {
  const match = globalThis.location?.hash?.match(/^#\/table\/(.+)$/);
  if (match) return decodeURIComponent(match[1]);
  const pathMatch = globalThis.location?.pathname?.match(/\/table\/([^/]+)$/);
  return pathMatch ? decodeURIComponent(pathMatch[1]) : null;
};
const isUuidString = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ""));
const isCpuPlayerId = (playerId) => typeof playerId === "string" && playerId.startsWith("cpu");
const canDeleteTableRoom = (table) => {
  const humanCount = table.seats.filter((seat) => seat.playerType === "human" || (seat.playerId && !isCpuPlayerId(seat.playerId))).length;
  return humanCount === 0 || table.status !== "playing";
};
const tableHasOnlyRealPlayers = (table) => Boolean(table?.clubId) && table.seats?.length === 3 && table.seats.every((seat) => seat.playerId && !isCpuPlayerId(seat.playerId) && seat.playerType !== "cpu");
const isCpuDebugTable = (table) => !tableHasOnlyRealPlayers(table);
const isLocalHumanPlayerType = (type) => type === "human";
const isAutoControlledPlayerType = (type) => type === "cpu";
const canSitAtTable = (table, playerId = CURRENT_USER_ID) => {
  if (!table || table.status === "playing") return false;
  if (table.seats.some((seat) => seat.playerId === playerId)) return false;
  return table.seats.some((seat) => !seat.playerId || isCpuPlayerId(seat.playerId));
};
const getJoinableSeat = (table) => table?.seats.find((seat) => !seat.playerId) ?? table?.seats.find((seat) => isCpuPlayerId(seat.playerId)) ?? null;
const safeReadJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const safeWriteJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Local storage is a mock persistence layer. If it is unavailable, keep the in-memory state.
    console.warn(`[Storage] ${key} の保存に失敗しました`);
    return false;
  }
};
const safeRemoveStorage = (key) => {
  try { localStorage.removeItem(key); } catch {}
};
const hydrateDebugLaunchFromWindowName = () => {
  try {
    if (!window.name) return;
    const payload = JSON.parse(window.name);
    if (payload?.type !== "anmika-debug-table-launch" || !payload.table) return;
    const tables = safeReadJson(APP_STORAGE_KEYS.tables, []);
    const users = safeReadJson(APP_STORAGE_KEYS.users, []);
    safeWriteJson(APP_STORAGE_KEYS.tables, [payload.table, ...tables.filter((table) => table.id !== payload.table.id)]);
    safeWriteJson(APP_STORAGE_KEYS.users, [...(payload.users ?? []), ...users.filter((user) => !(payload.users ?? []).some((item) => item.id === user.id))]);
    if (payload.currentUser) {
      safeWriteJson(APP_STORAGE_KEYS.currentUser, payload.currentUser);
      safeWriteJson(APP_STORAGE_KEYS.currentUserId, payload.currentUser.id);
    }
    if (payload.onlineSync) safeWriteJson(APP_STORAGE_KEYS.onlineSync, payload.onlineSync);
    try { sessionStorage.removeItem("anmikaOnlineDebug.launchingTable"); } catch {}
    window.name = "";
  } catch (error) {
    console.warn("[DebugLaunch] デバッグ対局情報の復元に失敗しました", error);
  }
};
hydrateDebugLaunchFromWindowName();
const maybeReloadAfterAutoLaunch = () => {
  try {
    const sync = safeReadJson(APP_STORAGE_KEYS.onlineSync, null);
    if (!sync?.autoReloadAfterLaunch) return;
    safeWriteJson(APP_STORAGE_KEYS.onlineSync, { ...sync, autoReloadAfterLaunch: false });
    console.log("[DebugLaunch] 古い自動再読み込みフラグを解除しました", {
      tableId: sync.tableId,
      gameId: sync.gameId,
    });
  } catch (error) {
    console.warn("[DebugLaunch] 自動開始後の再読み込み予約に失敗しました", error);
  }
};
maybeReloadAfterAutoLaunch();
const getPendingOnlineDebugLaunchTableId = () => {
  const tableId = getTableIdFromHash();
  if (isOnlineDebugLocalTableId(tableId)) return tableId;
  return "";
};
const renderStartupFallback = (message) => {
  const root = document.querySelector("#game-root") || document.body;
  const clubId = localStorage.getItem(ONLINE_DEBUG_RETURN_CLUB_KEY) || "";
  root.innerHTML = `<section class="lobby-panel" style="margin:80px auto;max-width:720px;color:#f6f8f7;background:rgba(10,20,28,.94);padding:20px;border-radius:12px;">
    <h2>麻雀画面を開けませんでした</h2>
    <p>原因: ${escapeHtml(message || "起動情報を取得できませんでした。")}</p>
    <div class="screen-actions">
      <a class="button-link" href="${onlineDebugLobbyUrl(clubId)}">卓一覧へ戻る</a>
      <button type="button" onclick="location.reload()">再読み込み</button>
    </div>
  </section>`;
};
const onlineLoadingReturnUrl = () => {
  const sync = loadOnlineSync();
  const clubId = localStorage.getItem(ONLINE_DEBUG_RETURN_CLUB_KEY) || "";
  return normalizeOnlineDebugReturnUrl(sync?.returnUrl || onlineDebugLobbyUrl(clubId), clubId, sync?.tableId || "");
};
const setCurrentUserSession = (user) => {
  safeWriteJson(APP_STORAGE_KEYS.currentUser, user);
  safeWriteJson(APP_STORAGE_KEYS.currentUserId, user?.id ?? null);
};
const fallbackCopyText = (text) => {
  let copied = false;
  const onCopy = (event) => {
    event.clipboardData?.setData("text/plain", text ?? "");
    event.preventDefault();
    copied = true;
  };
  document.addEventListener("copy", onCopy);
  try { document.execCommand("copy"); } catch {}
  document.removeEventListener("copy", onCopy);
  if (copied) return true;

  const textarea = document.createElement("textarea");
  textarea.value = text ?? "";
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try { copied = document.execCommand("copy"); } catch { copied = false; }
  textarea.remove();
  return copied;
};
const copyTextToClipboard = async (text) => {
  const value = String(text ?? "");
  if (!value) return false;
  let clipboardPromise = null;
  try {
    clipboardPromise = navigator.clipboard?.writeText?.(value);
  } catch {}
  // execCommand needs the original click activation, so try it before awaiting the async clipboard result.
  if (fallbackCopyText(value)) return true;
  if (!clipboardPromise) return false;
  try {
    await clipboardPromise;
    return true;
  } catch {
    return false;
  }
};
const saveOnlineSync = (sync) => sync ? safeWriteJson(APP_STORAGE_KEYS.onlineSync, sync) : safeRemoveStorage(APP_STORAGE_KEYS.onlineSync);
const isByteStringHeaderValue = (value) => /^[\u0000-\u00ff]*$/.test(String(value ?? ""));
const isLikelyJwtToken = (value) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value || ""));
const clearBrokenSupabaseSession = (reason = "broken auth header") => {
  console.warn("[OnlineSync] cleared broken Supabase session", { reason });
  safeRemoveStorage(APP_STORAGE_KEYS.onlineSync);
  safeRemoveStorage(APP_STORAGE_KEYS.socketDebug);
  try {
    localStorage.removeItem("anmikaAccessToken");
    localStorage.removeItem("anmikaRefreshToken");
    localStorage.removeItem("anmikaDebugUser");
  } catch {}
};
const sanitizeOnlineSync = (sync) => {
  if (!sync) return null;
  if (sync.anonKey && !isByteStringHeaderValue(sync.anonKey)) {
    clearBrokenSupabaseSession("invalid online sync anon key");
    return null;
  }
  if (sync.accessToken && (!isByteStringHeaderValue(sync.accessToken) || !isLikelyJwtToken(sync.accessToken))) {
    clearBrokenSupabaseSession("invalid online sync access token");
    return null;
  }
  return sync;
};
const loadOnlineSync = () => sanitizeOnlineSync(safeReadJson(APP_STORAGE_KEYS.onlineSync, null));
const buildSupabaseAuthHeaders = ({ anonKey = "", accessToken = "", json = false } = {}) => {
  if (!isByteStringHeaderValue(anonKey) || !isByteStringHeaderValue(accessToken) || !isLikelyJwtToken(accessToken)) {
    clearBrokenSupabaseSession("invalid Supabase auth header");
    throw new Error("ログイン情報または通信ヘッダーが壊れていたため、ログイン状態をクリアしました。ロビーで再ログインしてください。");
  }
  return {
    apikey: String(anonKey),
    Authorization: `Bearer ${accessToken}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
};
const loadSocketDebugStatus = () => safeReadJson(APP_STORAGE_KEYS.socketDebug, {});
const saveSocketDebugStatus = (patch = {}) => {
  const sync = loadOnlineSync() || {};
  const socket = globalThis.anmikaGameSocket || null;
  const previous = loadSocketDebugStatus() || {};
  const next = {
    ...previous,
    socket: socket?.connected ? "CONNECTED" : "DISCONNECTED",
    gameServer: patch.gameServer || previous.gameServer || (socket?.connected ? "OK" : "NG"),
    socketId: socket?.id || previous.socketId || "",
    socketUrl: patch.socketUrl || previous.socketUrl || sync.socketUrl || defaultGameServerUrl(),
    tableId: patch.tableId ?? sync.tableId ?? previous.tableId ?? "",
    gameId: patch.gameId ?? sync.gameId ?? previous.gameId ?? "",
    userId: patch.userId ?? sync.userId ?? previous.userId ?? "",
    clientVersion: patch.clientVersion ?? sync.version ?? previous.clientVersion ?? "",
    serverVersion: patch.serverVersion ?? previous.serverVersion ?? "",
    currentVersion: patch.currentVersion ?? sync.version ?? previous.currentVersion ?? "",
    lastAction: patch.lastAction ?? sync.lastActionType ?? previous.lastAction ?? "",
    lastError: patch.lastError ?? previous.lastError ?? "",
    lastException: patch.lastException ?? previous.lastException ?? "",
    lastExceptionId: patch.lastExceptionId ?? previous.lastExceptionId ?? "",
    lastExceptionAt: patch.lastExceptionAt ?? previous.lastExceptionAt ?? "",
    lastDisconnectReason: patch.lastDisconnectReason ?? previous.lastDisconnectReason ?? "",
    lastReconnectReason: patch.lastReconnectReason ?? previous.lastReconnectReason ?? "",
    lastReconnectAt: patch.lastReconnectAt ?? previous.lastReconnectAt ?? "",
    updatedAt: Date.now(),
  };
  safeWriteJson(APP_STORAGE_KEYS.socketDebug, next);
  console.log("[SocketDebug]", next);
  return next;
};
const ONLINE_DEBUG_RETURN_CLUB_KEY = "anmikaOnlineDebug.returnClubId";
const ONLINE_DEBUG_RECENTLY_LEFT_TABLE_KEY = "anmikaOnlineDebug.recentlyLeftTable";
const ONLINE_DEBUG_AUTO_START_BLOCK_KEY = "anmikaOnlineDebug.autoStartBlockedUntil";
const DEFAULT_GAME_SERVER_PORT = 8787;
const defaultGameServerUrl = () => {
  if (globalThis.location?.protocol === "file:") return `http://127.0.0.1:${DEFAULT_GAME_SERVER_PORT}`;
  return globalThis.location?.origin || `http://127.0.0.1:${DEFAULT_GAME_SERVER_PORT}`;
};
const resolveGameServerUrl = (savedUrl) => {
  if (globalThis.location?.protocol === "file:") return savedUrl || defaultGameServerUrl();
  return defaultGameServerUrl();
};
const isSocketAuthoritativeGame = () => {
  const sync = loadOnlineSync();
  return Boolean(sync?.enabled && sync.transport === "socketio" && sync.tableId && sync.gameId);
};
let socketClientLoadPromise = null;
let socketClientLoadUrl = "";
const loadSocketIoClient = async (serverUrl = defaultGameServerUrl()) => {
  if (globalThis.io) return globalThis.io;
  const normalizedUrl = serverUrl.replace(/\/$/, "");
  if (socketClientLoadUrl && socketClientLoadUrl !== normalizedUrl) socketClientLoadPromise = null;
  if (!socketClientLoadPromise) {
    socketClientLoadUrl = normalizedUrl;
    socketClientLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${normalizedUrl}/socket.io/socket.io.js`;
      script.onload = () => globalThis.io ? resolve(globalThis.io) : reject(new Error("Socket.IOクライアントを読み込めませんでした"));
      script.onerror = () => reject(new Error(`Socket.IOサーバーへ接続できません: ${serverUrl}`));
      document.head.appendChild(script);
    });
  }
  return socketClientLoadPromise;
};
const SOCKET_ACK_TIMEOUT_MS = 45000;
const SOCKET_CONNECT_TIMEOUT_MS = 90000;
const waitForSocketConnected = (socket, timeoutMs = SOCKET_CONNECT_TIMEOUT_MS) => new Promise((resolve, reject) => {
  if (!socket) {
    saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", lastError: "Socketが初期化されていません" });
    reject(new Error("ゲームサーバー接続が初期化されていません"));
    return;
  }
  if (socket.connected) {
    saveSocketDebugStatus({ socket: "CONNECTED", gameServer: "OK", lastError: "" });
    resolve(socket);
    return;
  }
  let settled = false;
  let lastError = null;
  let lastDisconnect = "";
  let timer = null;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    socket.off("connect", onConnect);
    socket.off("connect_error", onConnectError);
    socket.off("disconnect", onDisconnect);
  };
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    fn(value);
  };
  const onConnect = () => {
    saveSocketDebugStatus({ socket: "CONNECTED", gameServer: "OK", socketId: socket.id, lastError: "" });
    finish(resolve, socket);
  };
  const onConnectError = (error) => {
    lastError = error;
    console.warn("[SocketGame] connect retry", error?.message ?? error);
    saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", lastError: error?.message || String(error), lastReconnectReason: "connect_error" });
  };
  const onDisconnect = (reason) => {
    lastDisconnect = reason || "";
    saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", lastDisconnectReason: lastDisconnect, lastReconnectReason: "disconnect" });
  };
  socket.on("connect", onConnect);
  socket.on("connect_error", onConnectError);
  socket.on("disconnect", onDisconnect);
  timer = setTimeout(() => {
    const suffix = lastError?.message || lastDisconnect ? ` (${lastError?.message || lastDisconnect})` : "";
    saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", lastError: `接続タイムアウト${suffix}` });
    finish(reject, new Error(`ゲームサーバー接続がタイムアウトしました${suffix}`));
  }, timeoutMs);
  socket.connect?.();
});
const ensureSocketConnected = async (socket, { timeoutMs = SOCKET_CONNECT_TIMEOUT_MS } = {}) => {
  if (!socket) throw new Error("ゲームサーバー接続が初期化されていません");
  if (socket.connected) return socket;
  socket.connect?.();
  return waitForSocketConnected(socket, timeoutMs);
};
const isSocketDisconnectedAckError = (error) => {
  const message = String(error?.message || error || "");
  return message.includes("socket has been disconnected") || message.includes("transport close") || message.includes("ping timeout");
};
const socketEmitWithAck = async (socket, eventName, payload, timeoutMs = SOCKET_ACK_TIMEOUT_MS, attempt = 0) => {
  await ensureSocketConnected(socket, { timeoutMs: Math.min(timeoutMs, SOCKET_CONNECT_TIMEOUT_MS) });
  saveSocketDebugStatus({
    socket: "CONNECTED",
    gameServer: "OK",
    tableId: payload?.tableId,
    gameId: payload?.gameId,
    userId: payload?.userId || payload?.playerId,
    clientVersion: payload?.turnVersion,
    currentVersion: payload?.turnVersion,
    lastAction: eventName,
    lastError: "",
  });
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(eventName, payload, (error, response) => {
    if (error) {
      saveSocketDebugStatus({ lastAction: eventName, lastError: error?.message || String(error), gameServer: "NG" });
      if (attempt < 2 && isSocketDisconnectedAckError(error)) {
        setTimeout(() => {
          socketEmitWithAck(socket, eventName, payload, timeoutMs, attempt + 1).then(resolve, reject);
        }, 600 + attempt * 900);
        return;
      }
      reject(error);
      return;
    }
    if (response?.ok === false) {
      const errorObject = new Error(response.error || "ゲームサーバー処理に失敗しました");
      errorObject.response = response;
      errorObject.exceptionId = response.exceptionId || "";
      saveSocketDebugStatus({
        lastAction: eventName,
        lastError: errorObject.message,
        lastException: response.exceptionId ? errorObject.message : "",
        lastExceptionId: response.exceptionId || "",
        lastExceptionAt: response.exceptionId ? Date.now() : "",
        serverVersion: response?.version,
        currentVersion: response?.version,
        gameServer: "OK",
      });
      reject(errorObject);
      return;
    }
    saveSocketDebugStatus({
      lastAction: eventName,
      lastError: "",
      serverVersion: response?.version,
      currentVersion: response?.version,
      gameServer: "OK",
    });
    resolve(response);
  });
  });
};
const isOnlineDebugLocalTableId = (tableId) => String(tableId || "").startsWith("online-debug-");
const sourceTableIdFromLocalDebugId = (tableId) => isOnlineDebugLocalTableId(tableId) ? String(tableId).replace(/^online-debug-/, "") : tableId;
const forgetLocalOnlineDebugTable = (tableId) => {
  if (!isOnlineDebugLocalTableId(tableId)) return;
  try {
    saveTables(loadTables().filter((table) => table.id !== tableId));
  } catch (error) {
    console.warn("[OnlineDebug] ローカル卓キャッシュの削除に失敗しました", error);
  }
};
const forgetOnlineDebugLaunchCache = (sync, activeTableId = "") => {
  try { forgetLocalOnlineDebugTable(activeTableId); } catch {}
  try { forgetLocalOnlineDebugTable(sync?.localTableId); } catch {}
  try { sessionStorage.removeItem("anmikaOnlineDebug.launchingTable"); } catch {}
  try { globalThis.anmikaGameSocket?.disconnect?.(); } catch {}
};
const onlineDebugLobbyUrl = (clubId = "") => {
  const query = clubId ? `?returnClubId=${encodeURIComponent(clubId)}` : "";
  if (globalThis.location?.protocol === "file:") return new URL(`online-debug/index.html${query}`, globalThis.location.href).href;
  return `${globalThis.location?.origin || ""}/online-debug/index.html${query}`;
};
const onlineDebugReplayListUrl = (clubId = "") => {
  const base = onlineDebugLobbyUrl(clubId);
  try {
    const url = new URL(base, globalThis.location?.href || "http://localhost/");
    url.searchParams.set("settings", "replays");
    url.searchParams.set("open", "replays");
    return url.href;
  } catch {
    return `${base}${base.includes("?") ? "&" : "?"}settings=replays&open=replays`;
  }
};
const goToOnlineDebugLobby = (clubId = "", replace = false) => {
  const currentState = globalThis.__anmikaController?.getState?.();
  const shouldOpenReplayList = Boolean(currentState?.screen === "replayViewer" || currentState?.screen === "replayList" || currentState?.selectedReplayId || globalThis.location?.pathname?.includes("/replay"));
  const target = shouldOpenReplayList ? onlineDebugReplayListUrl(clubId) : onlineDebugLobbyUrl(clubId);
  if (replace) globalThis.location?.replace?.(target);
  else if (globalThis.location) globalThis.location.href = target;
};
const goToOnlineDebugReplayList = (clubId = "", replace = true) => {
  const target = onlineDebugReplayListUrl(clubId);
  if (replace) globalThis.location?.replace?.(target);
  else if (globalThis.location) globalThis.location.href = target;
};
const normalizeOnlineDebugReturnUrl = (returnUrl, clubId = "", leftTableId = "") => {
  const value = String(returnUrl || "");
  const shouldOpenReplayList = value.includes("/replay") || value.includes("settings=replays") || value.includes("open=replays");
  const base = value.includes("/online-debug") ? value : (shouldOpenReplayList ? onlineDebugReplayListUrl(clubId) : onlineDebugLobbyUrl(clubId));
  leftTableId = sourceTableIdFromLocalDebugId(leftTableId);
  if (!leftTableId) return base;
  try {
    sessionStorage.setItem(ONLINE_DEBUG_RECENTLY_LEFT_TABLE_KEY, JSON.stringify({ tableId: leftTableId, leftAt: Date.now() }));
    sessionStorage.setItem(ONLINE_DEBUG_AUTO_START_BLOCK_KEY, String(Date.now() + 10 * 60 * 1000));
  } catch {}
  try {
    const url = new URL(base, globalThis.location?.href || "http://localhost/");
    if (clubId && !url.searchParams.get("returnClubId")) url.searchParams.set("returnClubId", clubId);
    url.searchParams.set("leftTableId", leftTableId);
    url.searchParams.set("leftAt", String(Date.now()));
    return url.href;
  } catch {
    const joiner = base.includes("?") ? "&" : "?";
    const clubPart = clubId && !base.includes("returnClubId=") ? `returnClubId=${encodeURIComponent(clubId)}&` : "";
    return `${base}${joiner}${clubPart}leftTableId=${encodeURIComponent(leftTableId)}&leftAt=${Date.now()}`;
  }
};
const submitOnlineGameAction = async (actionType, payload = {}, options = {}) => {
  const sync = loadOnlineSync();
  if (sync?.transport === "socketio") {
    const socket = globalThis.anmikaGameSocket;
    if (actionType === "ron") console.log("[Ron] clicked", { tableId: sync.tableId, gameId: sync.gameId, version: sync.version, payload });
    let response;
    try {
      response = await socketEmitWithAck(socket, "game:action", {
        tableId: sync.tableId,
        gameId: sync.gameId,
        playerId: sync.userId,
        actionType,
        turnVersion: sync.version ?? 0,
        payload,
      }, options.timeoutMs ?? (actionType === "resultOk" ? 12000 : SOCKET_ACK_TIMEOUT_MS));
    } catch (error) {
      if (error.response?.state) {
        saveOnlineSync({
          ...sync,
          version: error.response.version ?? sync.version ?? 0,
          lastServerState: error.response.state,
          lastSyncedAt: Date.now(),
        });
        globalThis.__anmikaController?.applyOnlineStateSnapshot?.(error.response.state);
      }
      saveSocketDebugStatus({
        lastAction: actionType,
        lastError: error?.message || String(error),
        clientVersion: sync.version ?? 0,
        serverVersion: error.response?.version ?? error.response?.state?.version ?? "",
        currentVersion: error.response?.version ?? error.response?.state?.version ?? sync.version ?? 0,
      });
      throw error;
    }
    saveOnlineSync({
      ...sync,
      version: response?.version ?? sync.version ?? 0,
      lastActionType: actionType,
      lastEventAt: Date.now(),
      lastServerState: response?.state ?? sync.lastServerState ?? null,
      lastSyncedAt: Date.now(),
    });
    if (actionType === "ron") console.log("[Ron] accepted", { tableId: sync.tableId, gameId: sync.gameId, version: response?.version });
    saveSocketDebugStatus({
      lastAction: actionType,
      lastError: "",
      clientVersion: sync.version ?? 0,
      serverVersion: response?.version ?? response?.state?.version ?? "",
      currentVersion: response?.version ?? response?.state?.version ?? sync.version ?? 0,
    });
    if (response?.state && globalThis.__anmikaController?.applyOnlineStateSnapshot) {
      globalThis.__anmikaController.applyOnlineStateSnapshot(response.state);
    }
    return response;
  }
  if (!sync?.enabled || !sync.gameId || !sync.tableId || !sync.userId || !sync.supabaseUrl || !sync.anonKey || !sync.accessToken) return null;
  const response = await fetch(`${sync.supabaseUrl}/rest/v1/rpc/submit_game_action`, {
    method: "POST",
    headers: buildSupabaseAuthHeaders({ anonKey: sync.anonKey, accessToken: sync.accessToken, json: true }),
    body: JSON.stringify({
      p_game_id: sync.gameId,
      p_table_id: sync.tableId,
      p_player_id: sync.userId,
      p_action_type: actionType,
      p_turn_version: sync.version ?? 0,
      p_payload: payload,
    }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || response.statusText || "オンラインイベント送信に失敗しました");
  const nextSync = { ...sync, version: (sync.version ?? 0) + 1, lastActionType: actionType, lastEventAt: Date.now() };
  saveOnlineSync(nextSync);
  return data;
};
const submitOnlineFinalResultOk = async (options = {}) => {
  const sync = loadOnlineSync();
  if (!sync?.enabled || sync.transport !== "socketio" || !sync.tableId || !sync.gameId) return null;
  const response = await socketEmitWithAck(globalThis.anmikaGameSocket, "game:finalResultOk", {
    tableId: sync.tableId,
    gameId: sync.gameId,
    userId: sync.userId,
  }, options.timeoutMs ?? 12000);
  saveOnlineSync({
    ...sync,
    gameId: response?.gameId ?? response?.state?.gameId ?? sync.gameId,
    version: response?.version ?? response?.state?.version ?? sync.version ?? 0,
    lastActionType: "finalResultOk",
    lastEventAt: Date.now(),
    lastServerState: response?.state ?? sync.lastServerState ?? null,
    lastSyncedAt: Date.now(),
  });
  saveSocketDebugStatus({
    lastAction: "finalResultOk",
    lastError: "",
    clientVersion: sync.version ?? 0,
    serverVersion: response?.version ?? response?.state?.version ?? "",
    currentVersion: response?.version ?? response?.state?.version ?? sync.version ?? 0,
  });
  if (response?.state && globalThis.__anmikaController?.applyOnlineStateSnapshot) {
    globalThis.__anmikaController.applyOnlineStateSnapshot(response.state);
  }
  return response;
};
const refreshOnlineSyncFromServer = async () => {
  const sync = loadOnlineSync();
  if (sync?.transport === "socketio") {
    const socket = globalThis.anmikaGameSocket;
    if (!socket?.connected) return !sync.resetRoom && sync.lastServerState ? { state: sync.lastServerState, version: sync.version ?? 0 } : null;
    const response = await socketEmitWithAck(socket, "game:requestState", { tableId: sync.tableId, gameId: sync.gameId, userId: sync.userId });
    if (response?.state) {
      saveOnlineSync({ ...sync, version: response.version ?? sync.version ?? 0, lastServerState: response.state, lastSyncedAt: Date.now() });
      return { state: response.state, version: response.version ?? sync.version ?? 0 };
    }
    return null;
  }
  if (!sync?.enabled || !sync.gameId || !sync.supabaseUrl || !sync.anonKey || !sync.accessToken) return null;
  const params = new URLSearchParams({
    select: "game_id,table_id,version,state,updated_at",
    game_id: `eq.${sync.gameId}`,
    is_active: "eq.true",
    limit: "1",
  });
  const response = await fetch(`${sync.supabaseUrl}/rest/v1/game_states?${params}`, {
    headers: buildSupabaseAuthHeaders({ anonKey: sync.anonKey, accessToken: sync.accessToken }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : [];
  if (!response.ok) throw new Error(data?.message || response.statusText || "オンライン局面の取得に失敗しました");
  const row = data?.[0];
  if (!row) return null;
  if (sync.resetRoom) return null;
  saveOnlineSync({
    ...sync,
    version: row.version ?? sync.version ?? 0,
    lastServerState: row.state ?? null,
    lastSyncedAt: Date.now(),
  });
  return row;
};
const isUsableOnlineGameState = (state) => Boolean(
  state &&
  Array.isArray(state.players) &&
  state.players.length >= 3 &&
  (
    (Array.isArray(state.liveWall) && state.liveWall.length > 0) ||
    (state.handLog?.handId && state.handLog.handId !== "not-started") ||
    ["playing", "waitingForHumanDiscard", "waitingForAction", "waitingForRiichiDiscard", "handEnded", "showingWinAnnouncement", "showingCallAnnouncement"].includes(state.phase)
  )
);
const pushOnlineSyncState = async (gameState, reason = "state") => {
  const sync = loadOnlineSync();
  if (sync?.transport === "socketio") {
    const state = cloneOnlineGameState(gameState);
    state.onlineMeta = { publishedBy: sync.userId, reason, publishedAt: Date.now(), transport: "socket.io" };
    const response = await socketEmitWithAck(globalThis.anmikaGameSocket, "game:publishState", {
      tableId: sync.tableId,
      gameId: sync.gameId,
      userId: sync.userId,
      reason,
      state,
    });
    saveOnlineSync({ ...sync, version: response?.version ?? sync.version ?? 0, lastPublishedVersion: response?.version ?? sync.version ?? 0, lastPublishedAt: Date.now(), lastPublishReason: reason, lastServerState: response?.state ?? state });
    return response?.version ?? sync.version ?? 0;
  }
  if (!sync?.enabled || !sync.gameId || !sync.tableId || !sync.supabaseUrl || !sync.anonKey || !sync.accessToken) return null;
  const state = cloneOnlineGameState(gameState);
  state.onlineMeta = { publishedBy: sync.userId, reason, publishedAt: Date.now() };
  const nextVersion = Math.max(Number(sync.version ?? 0) + 1, Number(gameState.version ?? 0));
  state.version = nextVersion;
  const headers = {
    ...buildSupabaseAuthHeaders({ anonKey: sync.anonKey, accessToken: sync.accessToken, json: true }),
  };
  const rpcResponse = await fetch(`${sync.supabaseUrl}/rest/v1/rpc/publish_game_state`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_game_id: sync.gameId,
      p_table_id: sync.tableId,
      p_state: state,
      p_version: nextVersion,
    }),
  }).catch(() => null);
  if (rpcResponse?.ok) {
    saveOnlineSync({ ...sync, version: nextVersion, lastPublishedVersion: nextVersion, lastPublishedAt: Date.now(), lastPublishReason: reason });
    return nextVersion;
  }
  const response = await fetch(`${sync.supabaseUrl}/rest/v1/game_states?game_id=eq.${encodeURIComponent(sync.gameId)}&table_id=eq.${encodeURIComponent(sync.tableId)}&is_active=eq.true`, {
    method: "PATCH",
    headers: {
      ...headers,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      version: nextVersion,
      state,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText || "オンライン局面の保存に失敗しました");
  }
  saveOnlineSync({ ...sync, version: nextVersion, lastPublishedVersion: nextVersion, lastPublishedAt: Date.now(), lastPublishReason: reason });
  return nextVersion;
};
const leaveOnlineTableForSync = async (sync) => {
  if (!sync?.tableId || !sync?.supabaseUrl || !sync?.anonKey || !sync?.accessToken) return false;
  const headers = {
    ...buildSupabaseAuthHeaders({ anonKey: sync.anonKey, accessToken: sync.accessToken, json: true }),
  };
  const markTableWaiting = async () => {
    const rpcResponse = await fetch(`${sync.supabaseUrl}/rest/v1/rpc/mark_table_waiting_if_no_active_game`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_table_id: sync.tableId }),
    }).catch((error) => {
      console.warn("[OnlineSync] table waiting rpc failed", error);
      return null;
    });
    if (rpcResponse?.ok) return;
    await fetch(`${sync.supabaseUrl}/rest/v1/game_states?table_id=eq.${encodeURIComponent(sync.tableId)}&is_active=eq.true`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    }).catch((error) => console.warn("[OnlineSync] active game close failed", error));
    await fetch(`${sync.supabaseUrl}/rest/v1/games?table_id=eq.${encodeURIComponent(sync.tableId)}&status=eq.playing`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "ended", ended_at: new Date().toISOString() }),
    }).catch((error) => console.warn("[OnlineSync] game close failed", error));
    await fetch(`${sync.supabaseUrl}/rest/v1/tables?table_id=eq.${encodeURIComponent(sync.tableId)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "waiting" }),
    }).catch((error) => console.warn("[OnlineSync] table waiting update failed", error));
  };
  const resolveLastHandWaitingQueue = async () => {
    const response = await fetch(`${sync.supabaseUrl}/rest/v1/rpc/resolve_last_hand_and_waiting_queue`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_table_id: sync.tableId }),
    }).catch((error) => {
      console.warn("[OnlineSync] ラス半後ウェイティング処理に失敗しました", error);
      return null;
    });
    if (!response?.ok) return false;
    return true;
  };
  const clearOwnWaiting = async () => {
    if (!sync.userId) return;
    await fetch(`${sync.supabaseUrl}/rest/v1/table_waiting_list?user_id=eq.${encodeURIComponent(sync.userId)}`, {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=minimal" },
    }).catch((error) => console.warn("[OnlineSync] ラス半者のウェイティング解除に失敗しました", error));
  };
  const clearOwnSeatDirectly = async () => {
    if (!sync.userId) return false;
    const seatRowsResponse = await fetch(`${sync.supabaseUrl}/rest/v1/table_seats?select=table_id,seat_index&table_id=eq.${encodeURIComponent(sync.tableId)}&user_id=eq.${encodeURIComponent(sync.userId)}`, {
      headers,
    }).catch(() => null);
    const seatRows = seatRowsResponse?.ok ? await seatRowsResponse.json().catch(() => []) : [];
    for (const seat of Array.isArray(seatRows) ? seatRows : []) {
      if (seat?.seat_index === null || seat?.seat_index === undefined) continue;
      await fetch(`${sync.supabaseUrl}/rest/v1/table_seats?table_id=eq.${encodeURIComponent(sync.tableId)}&seat_index=eq.${encodeURIComponent(String(seat.seat_index))}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          user_id: null,
          player_type: "empty",
          display_name: null,
          is_last_hand_declared: false,
        }),
      }).catch((error) => console.warn("[OnlineSync] seat-index leave failed", error));
    }
    const fallbackResponse = await fetch(`${sync.supabaseUrl}/rest/v1/table_seats?table_id=eq.${encodeURIComponent(sync.tableId)}&user_id=eq.${encodeURIComponent(sync.userId)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: null,
        player_type: "empty",
        display_name: null,
        is_last_hand_declared: false,
      }),
    });
    return fallbackResponse.ok;
  };
  try {
    await clearOwnWaiting();
    const forceLeaveResponse = await fetch(`${sync.supabaseUrl}/rest/v1/rpc/leave_table_after_last_hand`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_table_id: sync.tableId }),
    });
    if (forceLeaveResponse.ok) {
      await clearOwnWaiting();
      await clearOwnSeatDirectly().catch((error) => console.warn("[OnlineSync] ラス半者の直接退席に失敗しました", error));
      await markTableWaiting();
      await resolveLastHandWaitingQueue();
      return true;
    }
    const forceLeaveText = await forceLeaveResponse.text();
    if (
      forceLeaveText &&
      !forceLeaveText.includes("leave_table_after_last_hand") &&
      !forceLeaveText.includes("schema cache") &&
      !forceLeaveText.includes("Could not find the function")
    ) {
      console.warn("[OnlineSync] ラス半終了時の強制退席に失敗しました", forceLeaveText);
    }
    const resolveResponse = await fetch(`${sync.supabaseUrl}/rest/v1/rpc/resolve_last_hand_leavers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_table_id: sync.tableId }),
    });
    if (resolveResponse.ok) {
      await clearOwnWaiting();
      await clearOwnSeatDirectly().catch((error) => console.warn("[OnlineSync] ラス半者の直接退席に失敗しました", error));
      await markTableWaiting();
      await resolveLastHandWaitingQueue();
      return true;
    }
    const resolveText = await resolveResponse.text();
    if (
      resolveText &&
      !resolveText.includes("resolve_last_hand_leavers") &&
      !resolveText.includes("schema cache") &&
      !resolveText.includes("Could not find the function")
    ) {
      console.warn("[OnlineSync] ラス半者の一括退席に失敗しました", resolveText);
    }
  } catch (error) {
    console.warn("[OnlineSync] ラス半者の一括退席に失敗しました", error);
  }
  try {
    await clearOwnWaiting();
    await clearOwnSeatDirectly().catch((error) => console.warn("[OnlineSync] ラス半者の直接退席に失敗しました", error));
    const response = await fetch(`${sync.supabaseUrl}/rest/v1/rpc/leave_table`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_table_id: sync.tableId }),
    });
    await markTableWaiting();
    await resolveLastHandWaitingQueue();
    if (response.ok) return true;
    const text = await response.text();
    console.warn("[OnlineSync] ラス半終了時の退席に失敗しました", text || response.statusText);
  } catch (error) {
    console.warn("[OnlineSync] ラス半終了時の退席に失敗しました", error);
    await markTableWaiting();
  }
  try {
    await clearOwnWaiting();
    const fallbackOk = await clearOwnSeatDirectly();
    await markTableWaiting();
    await resolveLastHandWaitingQueue();
    if (fallbackOk) return true;
    console.warn("[OnlineSync] ラス半終了時の直接退席にも失敗しました");
  } catch (error) {
    console.warn("[OnlineSync] ラス半終了時の直接退席にも失敗しました", error);
  }
  return false;
};
const createDefaultTables = () => ([
  {
    id: "table-free-1",
    clubId: "club-demo",
    name: "デモ卓 1",
    ruleId: "anmika-rocket",
    gameType: "anmika-rocket",
    rakePercent: 0,
    pointRate: 1,
    ruleConfig: normalizeAnmikaRocketRuleConfig(),
    createdBy: CURRENT_USER_ID,
    seats: [0, 1, 2].map((seatIndex) => ({ seatIndex, playerId: undefined, isOccupied: false, isReady: false, isLastHandDeclared: false })),
    waitingList: [],
    status: "waiting",
    createdAt: now(),
  },
]);
const createDefaultClubs = () => ([
  {
    id: "club-demo",
    name: "デモクラブ",
    description: "ローカルモックのクラブです。",
    ownerUserId: CURRENT_USER_ID,
    members: [{ userId: CURRENT_USER_ID, role: "admin", pointBalance: 0, joinedAt: now() }],
    pendingApplicants: [],
    adminUserIds: [CURRENT_USER_ID],
    memberUserIds: [CURRENT_USER_ID],
    pendingApplicantUserIds: [],
    clubPointBalance: 10000,
    rakeBalance: 0,
    createdAt: now(),
  },
  {
    id: "club-guest",
    name: "ゲスト募集クラブ",
    description: "参加申請の確認用クラブです。",
    ownerUserId: "cpu1",
    members: [{ userId: "cpu1", role: "admin", pointBalance: 0, joinedAt: now() }],
    pendingApplicants: [],
    adminUserIds: ["cpu1"],
    memberUserIds: ["cpu1"],
    pendingApplicantUserIds: [],
    clubPointBalance: 10000,
    rakeBalance: 0,
    createdAt: now(),
  },
]);
const createDefaultClubMemberPoints = () => ([{ clubId: "club-demo", userId: CURRENT_USER_ID, balance: 0 }, { clubId: "club-guest", userId: "cpu1", balance: 0 }]);
const createDefaultUsers = () => ([{ id: CURRENT_USER_ID, displayName: "プレイヤー1", passwordHash: hashPassword("debug"), iconUrl: undefined, createdAt: now() }]);
const loadUsers = () => safeReadJson(APP_STORAGE_KEYS.users, createDefaultUsers());
const saveUsers = (users) => safeWriteJson(APP_STORAGE_KEYS.users, users);
const normalizeClub = (club) => {
  if (!club) return undefined;
  const oldAdmins = club.adminUserIds ?? [];
  const oldMembers = club.memberUserIds ?? [];
  const members = club.members?.length ? club.members : [...new Set([club.ownerUserId, ...oldAdmins, ...oldMembers].filter(Boolean))].map((userId) => ({
    userId,
    role: userId === club.ownerUserId || oldAdmins.includes(userId) ? "admin" : "member",
    pointBalance: 0,
    joinedAt: club.createdAt ?? now(),
  }));
  return {
    ...club,
    members,
    pendingApplicants: club.pendingApplicants ?? club.pendingApplicantUserIds ?? [],
    adminUserIds: members.filter((member) => member.role === "admin").map((member) => member.userId),
    memberUserIds: members.map((member) => member.userId),
    clubPointBalance: club.clubPointBalance ?? 10000,
    rakeBalance: club.rakeBalance ?? 0,
  };
};
const getClubRole = (userId, club) => normalizeClub(club).members.find((member) => member.userId === userId)?.role;
const isClubMember = (userId, club) => Boolean(getClubRole(userId, club));
const canCreateTable = (userId, club) => getClubRole(userId, club) === "admin";
const getClubMemberPoint = (userId, club) => normalizeClub(club).members.find((member) => member.userId === userId)?.pointBalance ?? 0;
const loadTables = () => safeReadJson(APP_STORAGE_KEYS.tables, createDefaultTables());
const saveTables = (tables) => safeWriteJson(APP_STORAGE_KEYS.tables, tables);
const loadClubs = () => safeReadJson(APP_STORAGE_KEYS.clubs, createDefaultClubs()).map(normalizeClub);
const saveClubs = (clubs) => safeWriteJson(APP_STORAGE_KEYS.clubs, clubs.map(normalizeClub));
const loadReplays = () => safeReadJson(APP_STORAGE_KEYS.replays, []);
const saveReplays = (replays) => {
  if (safeWriteJson(APP_STORAGE_KEYS.replays, replays)) return true;
  for (const limit of [300, 200, 100, 50, 20, 10, 5, 1]) {
    if (safeWriteJson(APP_STORAGE_KEYS.replays, replays.slice(0, limit))) return true;
  }
  return false;
};
const loadClubMemberPoints = () => safeReadJson(APP_STORAGE_KEYS.clubMemberPoints, createDefaultClubMemberPoints());
const saveClubMemberPoints = (points) => safeWriteJson(APP_STORAGE_KEYS.clubMemberPoints, points);
const authRepository = {
  getCurrentUser: () => {
    const stored = safeReadJson(APP_STORAGE_KEYS.currentUser, undefined);
    if (stored?.id) return stored;
    const userId = safeReadJson(APP_STORAGE_KEYS.currentUserId, undefined);
    return userId ? loadUsers().find((user) => user.id === userId) : undefined;
  },
  getUser: (id) => loadUsers().find((user) => user.id === id),
  login: ({ userId, password } = {}) => {
    const user = loadUsers().find((item) => item.id === userId && item.passwordHash === hashPassword(password ?? ""));
    if (!user) return null;
    setCurrentUserSession(user);
    return user;
  },
  loginDebug: () => {
    const users = loadUsers();
    let user = users.find((item) => item.id === CURRENT_USER_ID);
    if (!user) {
      user = { id: CURRENT_USER_ID, displayName: "プレイヤー1", passwordHash: hashPassword("debug"), iconUrl: undefined, createdAt: now() };
      users.push(user);
      saveUsers(users);
    }
    setCurrentUserSession(user);
    return user;
  },
  createAccount: ({ displayName, password, iconUrl } = {}) => {
    const users = loadUsers();
    let id;
    do { id = createReadableId("P"); } while (users.some((user) => user.id === id));
    const user = { id, displayName: displayName || "プレイヤー", passwordHash: hashPassword(password || "password"), iconUrl, createdAt: now() };
    users.push(user);
    saveUsers(users);
    setCurrentUserSession(user);
    return user;
  },
  updateUser: (userId, patch = {}) => {
    const users = loadUsers();
    const index = users.findIndex((user) => user.id === userId);
    if (index < 0) return null;
    const next = { ...users[index], ...patch };
    users[index] = next;
    saveUsers(users);
    const current = authRepository.getCurrentUser();
    if (current?.id === userId) setCurrentUserSession(next);
    return next;
  },
  changePassword: (userId, password) => authRepository.updateUser(userId, { passwordHash: hashPassword(password ?? "") }),
  logout: () => {
    safeRemoveStorage(APP_STORAGE_KEYS.currentUser);
    safeRemoveStorage(APP_STORAGE_KEYS.currentUserId);
  },
};
const userRepository = {
  getUser: (id) => authRepository.getUser(id),
  listUsers: () => loadUsers(),
  saveUser: (user) => authRepository.updateUser(user.id, user),
};
const tableRepository = {
  listTables: () => loadTables(),
  listTablesByClub: (clubId) => loadTables().filter((table) => table.clubId === clubId),
  getTable: (id) => loadTables().find((table) => table.id === id),
  saveTable: (table) => {
    const tables = loadTables();
    const index = tables.findIndex((item) => item.id === table.id);
    if (index >= 0) tables[index] = table;
    else tables.push(table);
    saveTables(tables);
    return table;
  },
  deleteTable: (tableId) => saveTables(loadTables().filter((table) => table.id !== tableId)),
};
const clubRepository = {
  listMyClubs: (userId) => loadClubs().filter((club) => isClubMember(userId, club)),
  getClub: (id) => loadClubs().find((club) => club.id === id),
  saveClub: (club) => {
    const clubs = loadClubs();
    club = normalizeClub(club);
    const index = clubs.findIndex((item) => item.id === club.id);
    if (index >= 0) clubs[index] = club;
    else clubs.push(club);
    saveClubs(clubs);
    return club;
  },
  createClub: ({ name, description, ownerUserId }) => {
    if (loadClubs().some((club) => club.ownerUserId === ownerUserId)) return null;
    const club = normalizeClub({
      id: createReadableId("C"),
      name: name || "新しいクラブ",
      description,
      ownerUserId,
      members: [{ userId: ownerUserId, role: "admin", pointBalance: 0, joinedAt: now() }],
      pendingApplicants: [],
      clubPointBalance: 10000,
      rakeBalance: 0,
      createdAt: now(),
    });
    return clubRepository.saveClub(club);
  },
};
const replayRuleName = (ruleId) => ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? "全赤三麻" : "アンミカロケット";
const replayResultSummaryFromState = (state, result) => {
  if (!result) return "結果なし";
  const playerName = (playerId) => state?.players?.find((player) => player.id === playerId)?.name || getPlayerNameById(playerId);
  const payments = result?.scoreResult?.payments || result?.scoreResult?.paymentDeltas || result?.payments || {};
  const entries = Array.isArray(payments)
    ? payments.map((item) => [item.playerId, item.delta])
    : Object.entries(payments);
  const paymentText = entries
    .filter(([, delta]) => Number(delta || 0) !== 0)
    .map(([playerId, delta]) => `${playerName(playerId)} ${Number(delta) > 0 ? "+" : ""}${delta}`)
    .join(" / ");
  if (result.type === "exhaustiveDraw") return paymentText ? `流局 / ${paymentText}` : "流局 / 点数移動なし";
  if (result.type === "win") return `${playerName(result.winnerId)} ${result.winType === "tsumo" ? "ツモ" : "ロン"}${paymentText ? ` / ${paymentText}` : ""}`;
  return result.type || "結果";
};
const replayRepository = {
  listReplays: () => loadReplays()
    .filter((replay) => replay?.summary || replay?.replayId)
    .map((replay) => ({
      replayId: replay.summary?.replayId ?? replay.replayId,
      replayUrl: replay.summary?.replayUrl ?? replayUrlFor(replay.summary?.replayId ?? replay.replayId),
      clubId: replay.summary?.clubId ?? replay.initialState?.selectedClubId ?? replay.initialState?.activeClubId ?? loadTables().find((table) => table.id === (replay.summary?.tableId ?? replay.initialState?.activeTableId))?.clubId,
      tableId: replay.summary?.tableId ?? replay.initialState?.activeTableId,
      ruleId: replay.summary?.ruleId ?? "anmika-rocket",
      ruleName: replay.summary?.ruleName ?? replayRuleName(replay.summary?.ruleId ?? "anmika-rocket"),
      startedAt: replay.summary?.startedAt ?? replay.initialState?.handLog?.handId?.split("-").at(-1) ?? now(),
      endedAt: replay.summary?.endedAt ?? now(),
      players: replay.summary?.players ?? replay.initialState?.players?.map((player) => ({ playerId: player.id, name: player.name, finalScore: player.score })) ?? [],
      resultLabel: replay.summary?.resultLabel ?? replay.initialState?.handLog?.result?.type ?? "牌譜",
      resultSummary: replay.summary?.resultSummary ?? replayResultSummaryFromState(replay.initialState, replay.initialState?.handLog?.result),
    }))
    .filter((summary) => summary.replayId),
  getReplay: (id) => loadReplays().find((replay) => replay.replayId === id || replay.summary?.replayId === id),
  listReplaysByClub: (clubId) => replayRepository.listReplays().filter((summary) => summary.clubId === clubId),
  saveReplay: (replay) => {
    const replays = loadReplays();
    const snapshotLimits = [120, 80, 40, 20, 8, 2, 1];
    const replayLimits = [300, 200, 100, 50, 20, 10, 5, 1];
    for (const snapshotLimit of snapshotLimits) {
      const compactReplay = compactReplayForStorage(replay, snapshotLimit);
      const compactOld = replays.filter((item) => item.replayId !== replay.replayId).map((item) => compactReplayForStorage(item, snapshotLimit));
      for (const replayLimit of replayLimits) {
        const next = [compactReplay, ...compactOld].slice(0, replayLimit);
        if (safeWriteJson(APP_STORAGE_KEYS.replays, next)) return compactReplay;
      }
    }
    return replay;
  },
};
const fetchSupabaseReplayRows = async ({ clubId = "", replayId = "" } = {}) => {
  const sync = loadOnlineSync();
  const publicConfig = globalThis.ANMIKA_SUPABASE_CONFIG || {};
  const supabaseUrl = sync?.supabaseUrl || publicConfig.url || "";
  const anonKey = sync?.anonKey || publicConfig.anonKey || "";
  const accessToken = sync?.accessToken || localStorage.getItem("anmikaAccessToken") || "";
  if (!supabaseUrl || !anonKey || !accessToken) return [];
  if (replayId && !isUuidString(replayId)) return [];
  const baseUrl = supabaseUrl.replace(/\/$/, "");
  const headers = {
    ...buildSupabaseAuthHeaders({ anonKey, accessToken, json: true }),
  };
  if (replayId) {
    const serverResponse = await fetch(`${globalThis.location?.origin || ""}/api/replay/${encodeURIComponent(replayId)}`, {
      headers: { Authorization: buildSupabaseAuthHeaders({ anonKey, accessToken }).Authorization },
      cache: "no-store",
    }).catch(() => null);
    if (serverResponse?.ok) {
      const data = await serverResponse.json();
      if (data?.replay) return [data.replay];
    }
    const rpcResponse = await fetch(`${baseUrl}/rest/v1/rpc/get_my_replay`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_replay_id: replayId }),
    }).catch(() => null);
    if (rpcResponse?.ok) {
      const text = await rpcResponse.text();
      const data = text ? JSON.parse(text) : [];
      return Array.isArray(data) ? data : data ? [data] : [];
    }
  }
  const filters = [
    "select=replay_id,club_id,table_id,game_id,summary,initial_state,events,snapshots,created_at",
    "order=created_at.desc",
    `limit=${replayId ? 1 : 300}`,
  ];
  if (clubId) filters.push(`club_id=eq.${encodeURIComponent(clubId)}`);
  if (replayId) filters.push(`replay_id=eq.${encodeURIComponent(replayId)}`);
  const response = await fetch(`${baseUrl}/rest/v1/replays?${filters.join("&")}`, { headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : [];
  if (!response.ok) throw new Error(data?.message || response.statusText || "牌譜の取得に失敗しました");
  return Array.isArray(data) ? data : [];
};
const replayFromSupabaseRow = (row) => {
  const replayId = row.replay_id || row.summary?.replayId;
  return {
    replayId,
    summary: {
      ...(row.summary || {}),
      replayId,
      replayUrl: replayUrlFor(replayId),
      clubId: row.club_id || row.summary?.clubId,
      tableId: row.table_id || row.summary?.tableId,
      gameId: row.game_id || row.summary?.gameId,
      endedAt: row.summary?.endedAt || Date.parse(row.created_at || "") || now(),
    },
    initialState: row.initial_state,
    events: row.events || [],
    snapshots: row.snapshots || [],
    simpleReplay: row.summary?.simpleReplay || (row.summary?.replayFormat === "anmika-simple-replay-v1" ? {
      format: "anmika-simple-replay-v1",
      initialState: row.initial_state,
      events: row.events || [],
      result: row.initial_state?.handLog?.result || null,
    } : null),
  };
};
const mergeReplaysIntoLocalStore = (incoming = []) => {
  if (!incoming.length) return replayRepository.listReplays();
  const current = loadReplays();
  const byId = new Map(current.map((replay) => [replay.replayId || replay.summary?.replayId, replay]));
  for (const replay of incoming) {
    if (!replay?.replayId) continue;
    byId.set(replay.replayId, replay);
  }
  saveReplays([...byId.values()].slice(0, 200));
  return replayRepository.listReplays();
};
const createTableRoom = ({ id, name, clubId, ruleId = "anmika-rocket", gameType = ruleId, rakePercent = 0, pointRate = 1, ruleConfig = normalizeRuleConfigForRule(ruleId), createdBy } = {}) => ({
  id: id ?? `table-${now()}`,
  name: name ?? `卓 ${new Date().toLocaleTimeString("ja-JP")}`,
  clubId,
  ruleId,
  gameType,
  rakePercent,
  pointRate,
  ruleConfig: normalizeRuleConfigForRule(ruleId, ruleConfig),
  createdBy,
  seats: [0, 1, 2].map((seatIndex) => ({ seatIndex, isOccupied: false, isReady: false, isLastHandDeclared: false })),
  waitingList: [],
  status: "waiting",
  createdAt: now(),
});
const getPlayerNameById = (playerId) => {
  const user = loadUsers().find((item) => item.id === playerId);
  if (user) return user.displayName;
  return playerId === CURRENT_USER_ID ? "プレイヤー1" : playerId?.startsWith("cpu") ? playerId.replace("cpu", "CPU") : playerId ?? "";
};
const makeWallPlaceholders = (_prefix, length) => Array.from({ length }, () => 0);
const cloneSnapshot = (state) => JSON.parse(JSON.stringify({
  players: state.players,
  liveWall: makeWallPlaceholders("live-wall", state.liveWall?.length ?? 0),
  rinshanWall: makeWallPlaceholders("rinshan-wall", state.rinshanWall?.length ?? 0),
  doraIndicators: state.doraIndicators,
  uraDoraIndicators: state.uraDoraIndicators,
  kanCount: state.kanCount,
  round: state.round,
  currentPlayerIndex: state.currentPlayerIndex,
  turnIndex: state.turnIndex,
  phase: state.phase,
  pendingAction: null,
  handLog: state.handLog ? { ...state.handLog, events: [] } : createEmptyHandLog(),
  settings: state.settings,
  rakePool: state.rakePool,
  activeTableId: state.activeTableId,
  activeClubId: state.activeClubId,
  selectedClubId: state.selectedClubId,
  currentUser: state.currentUser,
}));
const cloneOnlineGameState = (state) => JSON.parse(JSON.stringify({
  players: state.players,
  liveWall: state.liveWall ?? [],
  rinshanWall: state.rinshanWall ?? [],
  doraIndicators: state.doraIndicators ?? [],
  uraDoraIndicators: state.uraDoraIndicators ?? [],
  kanCount: state.kanCount ?? 0,
  round: state.round,
  currentPlayerIndex: state.currentPlayerIndex ?? 0,
  turnIndex: state.turnIndex ?? 0,
  phase: state.phase,
  pendingAction: state.pendingAction ?? null,
  handLog: state.handLog ?? createEmptyHandLog(),
  settings: state.settings,
  rakePool: state.rakePool ?? 0,
  activeTableId: state.activeTableId,
  activeClubId: state.activeClubId,
  selectedClubId: state.selectedClubId,
  version: state.version ?? 0,
  lastDrawnTile: state.lastDrawnTile ?? null,
  lastScoreResult: state.lastScoreResult ?? null,
  winAnnouncement: state.winAnnouncement ?? null,
  flowerAnnouncement: state.flowerAnnouncement ?? null,
}));
const buildTableState = (state) => ({
  players: state.players.map((player) => ({ id: player.id, name: player.name, type: player.type, score: player.score, status: player.status })),
  scores: Object.fromEntries(state.players.map((player) => [player.id, player.score])),
  wall: { liveWallCount: state.liveWall?.length ?? 0, rinshanWallCount: state.rinshanWall?.length ?? 0, doraIndicators: state.doraIndicators ?? [], uraDoraIndicators: state.uraDoraIndicators ?? [] },
  discards: Object.fromEntries(state.players.map((player) => [player.id, player.discardedTiles ?? []])),
  melds: Object.fromEntries(state.players.map((player) => [player.id, player.melds ?? []])),
  currentTurn: getCurrentPlayer(state)?.id,
  phase: state.phase,
  turnIndex: state.turnIndex,
});
const appendReplaySnapshot = (state) => {
  if (state.screen !== "game" || state.phase === "idle" || !Array.isArray(state.replaySnapshots)) return;
  state.replaySnapshots.push(cloneSnapshot(state));
  if (state.replaySnapshots.length > 300) state.replaySnapshots.shift();
};
const getCurrentReplaySnapshot = (replay, index) => {
  const snapshots = getReplaySnapshots(replay);
  return snapshots[Math.max(0, Math.min(index, snapshots.length - 1))];
};
const getSimpleReplayPayload = (replay) => {
  const payload = replay?.simpleReplay || replay?.summary?.simpleReplay;
  if (payload?.format === "anmika-simple-replay-v1") return payload;
  if ((replay?.summary?.replayFormat === "event-log-v1" || replay?.summary?.eventLogIsPrimary) && replay?.initialState && Array.isArray(replay?.events)) {
    return {
      format: "event-log-v1",
      initialState: replay.initialState,
      events: replay.events,
      result: replay.summary?.finalResult || replay.initialState?.handLog?.result || null,
    };
  }
  if (!replay?.snapshots?.length && replay?.initialState && Array.isArray(replay?.events)) {
    return {
      format: "anmika-simple-replay-v1",
      initialState: replay.initialState,
      events: replay.events,
      result: replay.initialState?.handLog?.result || null,
    };
  }
  return null;
};
const cloneReplayState = (state) => JSON.parse(JSON.stringify(state || {}));
const findReplayPlayer = (state, playerId) => state?.players?.find((player) => player.id === playerId);
const replayPlayerForEvent = (state, event, key = "playerId") => {
  const directId = event?.[key];
  const direct = findReplayPlayer(state, directId);
  const seatKey = key === "fromPlayerId" ? "fromPlayerSeatIndex" : "playerSeatIndex";
  const seatIndex = Number(event?.[seatKey]);
  const bySeat = Number.isInteger(seatIndex) && seatIndex >= 0 ? state?.players?.[seatIndex] : null;
  if (direct && (!bySeat || bySeat.id === direct.id)) return direct;
  if (!direct && bySeat) {
    addReplayIntegrityWarning(state, { type: "playerIdMissingSeatFallback", eventType: event.type, key, playerId: directId || "", seatPlayerId: bySeat.id, seatIndex });
    return bySeat;
  }
  if (direct && bySeat && bySeat.id !== direct.id) {
    addReplayIntegrityWarning(state, { type: "playerIdentityMismatch", eventType: event.type, playerId: direct.id, seatPlayerId: bySeat.id, seatIndex });
    return direct;
  }
  if (directId) addReplayIntegrityWarning(state, { type: "playerNotFoundForReplayEvent", eventType: event.type, key, playerId: directId });
  return direct || null;
};
const removeReplayTileById = (tiles, tileId) => {
  const index = Array.isArray(tiles) ? tiles.findIndex((tile) => tile?.id === tileId) : -1;
  if (index < 0) return null;
  return tiles.splice(index, 1)[0];
};
const removeReplayTileByKind = (tiles, target) => {
  if (!target) return null;
  const index = Array.isArray(tiles) ? tiles.findIndex((tile) => sameTileKind(tile, target)) : -1;
  if (index < 0) return null;
  return tiles.splice(index, 1)[0];
};
const removeReplayDrawnOrHandTile = (player, tile) => {
  if (!player || !tile) return null;
  if (player.drawnTile?.id === tile.id) {
    const drawn = player.drawnTile;
    player.drawnTile = null;
    return drawn;
  }
  return removeReplayTileById(player.hand, tile.id) || removeReplayTileByKind(player.hand, tile);
};
const addReplayIntegrityWarning = (state, warning) => {
  state.replayIntegrityWarnings ??= [];
  state.replayIntegrityWarnings.push(warning);
};
const removeReplayWallTile = (state, tile, source = "liveWall") => {
  const wall = source === "rinshanWall" ? state.rinshanWall : state.liveWall;
  if (!Array.isArray(wall)) return tile || null;
  if (wall[0]?.id === tile?.id) {
    wall.shift();
    return tile;
  }
  const removed = removeReplayTileById(wall, tile?.id);
  if (!removed && wall.length) {
    const skipped = wall.shift();
    addReplayIntegrityWarning(state, { type: "wallDrawMismatch", expectedTileId: tile?.id || "", skippedTileId: skipped?.id || "", source });
  } else if (removed) {
    addReplayIntegrityWarning(state, { type: "wallDrawOutOfOrder", expectedTileId: tile?.id || "", source });
  }
  return tile || removed || null;
};
const removeReplayLastDiscard = (state, playerId, tile) => {
  const player = findReplayPlayer(state, playerId);
  const discards = player?.discardedTiles || [];
  if (!tile) return null;
  for (let index = discards.length - 1; index >= 0; index--) {
    if (sameTileKind(discards[index]?.tile, tile)) return discards.splice(index, 1)[0]?.tile || tile;
  }
  return tile;
};
const removeReplayLastDiscardForEvent = (state, event, tile) => {
  const fromPlayer = replayPlayerForEvent(state, event, "fromPlayerId");
  return removeReplayLastDiscard(state, fromPlayer?.id || event?.fromPlayerId, tile);
};
const setReplayActivePlayer = (state, playerId) => {
  state.currentPlayerIndex = Math.max(0, state.players?.findIndex((player) => player.id === playerId) ?? 0);
  for (const player of state.players || []) player.status = player.id === playerId ? "active" : "waiting";
};
const previousReplayEvent = (state) => {
  const events = state?.handLog?.events || [];
  return events.length >= 2 ? events[events.length - 2] : null;
};
const replayDrawSourceForEvent = (state, event) => {
  if (event.from) return event.from;
  const previous = previousReplayEvent(state);
  if (previous?.type === "kan" || previous?.type === "nukiDora") return "rinshanWall";
  return "liveWall";
};
const applySimpleReplayEvent = (state, event) => {
  if (!state || !event?.type) return state;
  state.handLog ??= createEmptyHandLog();
  state.handLog.events ??= [];
  if (event.type === "handStart" && event.initialState) {
    const next = cloneReplayState(event.initialState);
    next.handLog = { ...(next.handLog || createEmptyHandLog()), events: [...state.handLog.events], result: null };
    next.replaySnapshots = undefined;
    next.replayInitialState = undefined;
    return next;
  }
  const player = replayPlayerForEvent(state, event);
  if (event.type === "doraReveal") {
    state.doraIndicators = event.doraIndicators || [...(state.doraIndicators || []), event.tile].filter(Boolean);
    if (event.uraDoraIndicators) state.uraDoraIndicators = event.uraDoraIndicators;
    return state;
  }
  if (event.type === "draw" && player) {
    const source = replayDrawSourceForEvent(state, event);
    const previous = previousReplayEvent(state);
    const isReplacementDrawAlreadyApplied = source === "rinshanWall"
      && previous?.type === "nukiDora"
      && player.drawnTile
      && (
        player.drawnTile.id === event.tile?.id
        || previous.replacementTile?.id === event.tile?.id
        || (previous.replacementTile && sameTileKind(previous.replacementTile, event.tile) && sameTileKind(player.drawnTile, event.tile))
      );
    if (isReplacementDrawAlreadyApplied) {
      state.lastDrawnTile = player.drawnTile;
      state.phase = "waitingForHumanDiscard";
      setReplayActivePlayer(state, player.id);
      return state;
    }
    if (player.drawnTile) {
      addReplayIntegrityWarning(state, { type: "drawWhileDrawnTileExists", playerId: player.id, oldTileId: player.drawnTile.id, newTileId: event.tile?.id || "" });
      player.drawnTile = null;
    }
    const tile = removeReplayWallTile(state, event.tile, source) || event.tile;
    player.drawnTile = tile;
    state.lastDrawnTile = tile;
    state.phase = "waitingForHumanDiscard";
    setReplayActivePlayer(state, player.id);
    return state;
  }
  if (event.type === "discard" && player) {
    const discardType = event.discardType || "tedashi";
    let tile = null;
    if (discardType === "tsumogiri") {
      if (player.drawnTile && !sameTileKind(player.drawnTile, event.tile)) {
        addReplayIntegrityWarning(state, { type: "tsumogiriTileMismatch", playerId: player.id, drawnTileId: player.drawnTile.id, eventTileId: event.tile?.id || "" });
      }
      tile = event.tile || player.drawnTile;
      player.drawnTile = null;
    } else {
      tile = removeReplayTileById(player.hand, event.tile?.id) || removeReplayTileByKind(player.hand, event.tile);
      if (!tile) {
        addReplayIntegrityWarning(state, { type: "discardTileMissingFromHand", playerId: player.id, eventTileId: event.tile?.id || "", handCount: player.hand?.length || 0, hasDrawnTile: Boolean(player.drawnTile) });
        tile = event.tile || null;
        player.drawnTile = null;
      } else if (player.drawnTile) {
        player.hand.push(player.drawnTile);
        player.drawnTile = null;
        player.hand = sortHandTiles(player.hand);
      }
    }
    player.discardedTiles ??= [];
    if (tile) player.discardedTiles.push({ tile, discardType, isRiichiDiscard: Boolean(event.isRiichiDiscard), turnIndex: event.turnIndex ?? state.turnIndex ?? 0 });
    state.turnIndex = Math.max(Number(state.turnIndex || 0), Number(event.turnIndex || 0) + 1);
    state.phase = "playing";
    return state;
  }
  if (event.type === "riichi" && player) {
    player.isRiichi = true;
    player.ippatsu = true;
    player.riichiTurnIndex = event.turnIndex ?? state.turnIndex ?? 0;
    player.feverRiichiActive = Boolean(event.feverRiichiActive);
    return state;
  }
  if (event.type === "pon" && player) {
    const calledTile = removeReplayLastDiscardForEvent(state, event, event.tile);
    const consumed = [removeReplayTileByKind(player.hand, event.tile), removeReplayTileByKind(player.hand, event.tile)].filter(Boolean);
    player.melds ??= [];
    player.melds.push({ type: "pon", tiles: [...consumed, calledTile], calledTile, fromPlayerId: event.fromPlayerId });
    player.hand = sortHandTiles(player.hand);
    setReplayActivePlayer(state, player.id);
    state.phase = "waitingForHumanDiscard";
    return state;
  }
  if (event.type === "kan" && player) {
    const tiles = Array.isArray(event.tiles) ? event.tiles : [];
    const kanType = event.kanType || (event.fromPlayerId ? "minkan" : "ankan");
    if (kanType === "kakan") {
      const target = player.melds?.find((meld) => meld.type === "pon" && sameTileKind(meld.tiles?.[0], event.addedTile || tiles[0]));
      if (target) {
        const addedTile = event.addedTile || tiles.at(-1);
        if (addedTile) removeReplayDrawnOrHandTile(player, addedTile);
        target.type = "kakan";
        target.addedTile = addedTile;
        target.tiles = tiles.length ? tiles : [...(target.tiles || []), target.addedTile].filter(Boolean);
      }
    } else {
      if (event.fromPlayerId) removeReplayLastDiscardForEvent(state, event, tiles[0]);
      for (const tile of tiles) removeReplayDrawnOrHandTile(player, tile);
      player.melds ??= [];
      player.melds.push({ type: kanType, tiles, calledTile: event.fromPlayerId ? tiles[0] : undefined, fromPlayerId: event.fromPlayerId });
    }
    state.kanCount = Number(state.kanCount || 0) + 1;
    setReplayActivePlayer(state, player.id);
    return state;
  }
  if (event.type === "nukiDora" && player) {
    const wasDrawnFlower = Boolean(player.drawnTile && sameTileKind(player.drawnTile, event.tile));
    const tile = removeReplayDrawnOrHandTile(player, event.tile) || event.tile;
    player.nukiDoraTiles ??= [];
    if (tile) player.nukiDoraTiles.push(tile);
    const replacementTile = event.replacementTile || null;
    if (replacementTile) {
      const replacement = removeReplayWallTile(state, replacementTile, "rinshanWall") || replacementTile;
      if (wasDrawnFlower || !player.drawnTile) {
        player.drawnTile = replacement;
      } else {
        player.hand ??= [];
        player.hand.push(replacement);
        player.hand = sortHandTiles(player.hand);
      }
      state.lastDrawnTile = replacement;
    }
    state.phase = "waitingForHumanDiscard";
    setReplayActivePlayer(state, player.id);
    return state;
  }
  if ((event.type === "ron" || event.type === "tsumo") && player) {
    const fromPlayer = event.type === "ron" ? replayPlayerForEvent(state, event, "fromPlayerId") : null;
    state.phase = "handEnded";
    for (const seat of state.players || []) seat.status = seat.id === player.id ? "declared-win" : "waiting";
    state.handLog.result = {
      type: "win",
      winnerId: player.id,
      loserId: fromPlayer?.id || event.fromPlayerId || null,
      winType: event.type,
      winningTile: event.tile,
      scoringWinningTile: event.scoringTile,
      scoreResult: event.scoreResult,
      payments: event.scoreResult?.paymentDeltas || [],
    };
    return state;
  }
  if (event.type === "exhaustiveDraw") {
    state.phase = "exhaustiveDraw";
    state.handLog.result = { type: "exhaustiveDraw", reason: event.reason || "liveWallEmpty", payments: [] };
    return state;
  }
  return state;
};
const buildSimpleReplaySnapshots = (replay) => {
  const simple = getSimpleReplayPayload(replay);
  if (!simple?.initialState) return [];
  let state = cloneReplayState(simple.initialState);
  state.handLog = { ...(state.handLog || createEmptyHandLog()), events: [], result: null };
  state.replaySnapshots = undefined;
  state.replayInitialState = undefined;
  const snapshots = [cloneReplayState(state)];
  for (const event of simple.events || []) {
    state.handLog.events.push(event);
    state = applySimpleReplayEvent(state, event) || state;
    snapshots.push(cloneReplayState(state));
  }
  if (simple.result && !state.handLog.result) {
    state.handLog.result = simple.result;
    snapshots.push(cloneReplayState(state));
  }
  return snapshots;
};
const getReplaySnapshots = (replay) => {
  const simpleSnapshots = getSimpleReplayPayload(replay) ? buildSimpleReplaySnapshots(replay) : [];
  if (simpleSnapshots.length) return simpleSnapshots;
  const isHanchanReplay = replay?.summary?.scope === "hanchan"
    || (replay?.summary?.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID && (replay?.summary?.handMarkers?.length ?? 0) > 1);
  if (isHanchanReplay && replay?.snapshots?.length) return replay.snapshots;
  if (replay?.snapshots?.length) return replay.snapshots;
  if (!replay?.initialState) return [];
  const events = replay.events ?? [];
  if (!events.length) return [replay.initialState];
  return [
    replay.initialState,
    ...events.map((_, index) => ({
      ...replay.initialState,
      handLog: {
        ...(replay.initialState.handLog ?? createEmptyHandLog()),
        events: events.slice(0, index + 1),
      },
    })),
  ];
};
const replayUsesSnapshotSteps = (replay) => Boolean(replay?.snapshots?.length) && (
  replay?.summary?.scope === "hanchan"
  || replay?.summary?.replayFormat === "snapshot-v1"
  || replay?.summary?.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID
);
const deriveReplayEventsFromSnapshots = (snapshots = []) => {
  const derived = [];
  for (let index = 1; index < snapshots.length; index++) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    const previousHandId = previous?.handLog?.handId || "";
    const currentHandId = current?.handLog?.handId || "";
    const previousEvents = Array.isArray(previous?.handLog?.events) ? previous.handLog.events : [];
    const currentEvents = Array.isArray(current?.handLog?.events) ? current.handLog.events : [];
    if (currentHandId && previousHandId && currentHandId !== previousHandId) {
      derived.push({ type: "handStart", handId: currentHandId });
      continue;
    }
    if (currentEvents.length > previousEvents.length) {
      derived.push(currentEvents[previousEvents.length] || currentEvents.at(-1) || null);
      continue;
    }
    derived.push(currentEvents.at(-1) || null);
  }
  return derived;
};
const getReplayEvents = (replay) => {
  const simpleEvents = getSimpleReplayPayload(replay)?.events;
  if (simpleEvents) return simpleEvents;
  if (replayUsesSnapshotSteps(replay)) return deriveReplayEventsFromSnapshots(replay.snapshots);
  return replay?.events || [];
};
const isSkippedReplayStepEvent = (event) => {
  if (!event?.type) return false;
  if (event.type === "skipAction") return true;
  if (["doraReveal", "ippatsuCleared", "flowerAnnouncement", "riichi", "riichiAutoDiscardWait", "riichiAutoDiscard", "feverForcedDiscardWait", "feverForcedDiscard", "nukiDora"].includes(event.type)) return true;
  return false;
};
const getReplayVisibleSnapshotIndexes = (replay) => {
  const snapshots = getReplaySnapshots(replay);
  if (snapshots.length <= 1) return snapshots.map((_, index) => index);
  const events = getReplayEvents(replay);
  if (!events.length) return snapshots.map((_, index) => index);
  const indexes = [0];
  events.forEach((event, eventIndex) => {
    const snapshotIndex = eventIndex + 1;
    if (snapshotIndex < snapshots.length && !isSkippedReplayStepEvent(event)) indexes.push(snapshotIndex);
  });
  if (indexes.at(-1) !== snapshots.length - 1) {
    const last = snapshots.at(-1);
    if (last?.handLog?.result || ["handEnded", "exhaustiveDraw", "gameEnded", "finalResult"].includes(last?.phase)) indexes.push(snapshots.length - 1);
  }
  return [...new Set(indexes)].sort((a, b) => a - b);
};
const getReplayVisiblePosition = (replay, snapshotIndex) => {
  const visible = getReplayVisibleSnapshotIndexes(replay);
  if (!visible.length) return { visible, position: 0 };
  const exact = visible.indexOf(snapshotIndex);
  if (exact >= 0) return { visible, position: exact };
  const next = visible.findIndex((index) => index > snapshotIndex);
  return { visible, position: next < 0 ? visible.length - 1 : Math.max(0, next - 1) };
};
const getReplayEventForSnapshotIndex = (replay, snapshotIndex) => getReplayEvents(replay)[Math.max(0, snapshotIndex - 1)];
const getValidReplayViewerId = (snapshot, requestedViewerId, replay) => {
  const players = snapshot?.players ?? [];
  if (players.some((player) => player.id === requestedViewerId)) return requestedViewerId;
  const summaryPlayers = replay?.summary?.players ?? [];
  const humanSummary = summaryPlayers.find((player) => players.some((snapshotPlayer) => snapshotPlayer.id === player.playerId && snapshotPlayer.type === "human"));
  if (humanSummary?.playerId) return humanSummary.playerId;
  const humanPlayer = players.find((player) => player.type === "human");
  return humanPlayer?.id ?? players[0]?.id ?? requestedViewerId;
};
function pickReplaySnapshots(snapshots = [], maxSnapshots = 120) {
  if (snapshots.length <= maxSnapshots) return snapshots;
  if (maxSnapshots <= 1) return [snapshots.at(-1)];
  const picked = [];
  for (let i = 0; i < maxSnapshots; i++) {
    const index = Math.round((i * (snapshots.length - 1)) / (maxSnapshots - 1));
    picked.push(snapshots[index]);
  }
  return picked;
}
function compactSnapshotForStorage(snapshot) {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    liveWall: makeWallPlaceholders("live-wall", snapshot.liveWall?.length ?? 0),
    rinshanWall: makeWallPlaceholders("rinshan-wall", snapshot.rinshanWall?.length ?? 0),
    pendingAction: null,
    handLog: snapshot.handLog ? { ...snapshot.handLog, events: [] } : createEmptyHandLog(),
    replaySnapshots: undefined,
  };
}
function compactReplayForStorage(replay, maxSnapshots = 120) {
  const snapshots = pickReplaySnapshots(replay.snapshots?.length ? replay.snapshots : [replay.initialState].filter(Boolean), maxSnapshots).map(compactSnapshotForStorage);
  const isEventLogPrimary = replay?.summary?.replayFormat === "event-log-v1" || replay?.summary?.eventLogIsPrimary;
  const events = isEventLogPrimary ? (replay.events ?? []) : maxSnapshots < 20 ? (replay.events ?? []).slice(-Math.max(0, maxSnapshots - 1)) : (replay.events ?? []);
  return {
    ...replay,
    initialState: compactSnapshotForStorage(replay.initialState ?? snapshots[0]),
    events,
    snapshots,
  };
}
const filterActionOptionsByAssistSettings = (options, player) => {
  if (!player?.assistSettings?.noCall) return options;
  return options.filter((option) => !(option.type === "pon" || option.type === "kan"));
};
const getKakanActionOption = (state, player) => {
  if (!state || !player || player.isRiichi || !canDeclareKanNow(state)) return null;
  const concealed = [...(player.hand ?? []), ...(player.drawnTile ? [player.drawnTile] : [])];
  const canKakan = (player.melds ?? []).some((meld) => meld.type === "pon" && concealed.some((tile) => sameTileKind(tile, meld.tiles?.[0])));
  return canKakan ? { type: "kan", playerId: player.id, options: { kanType: "kakan" } } : null;
};
const formatTile = (tile) => {
  if (!tile) return "?";
  if (tile.suit === "honor") return tile.kind === "white" && tile.pochiColor ? pochiText[tile.pochiColor] : honorText[tile.kind];
  if (tile.suit === "flower") return `${colorText[tile.color] ?? ""}華`;
  return `${tile.isRocket ? "ロケット" : colorText[tile.color] ?? ""}${tile.rank}${suitText[tile.suit]}`;
};
const isFlowerTile = (tile) => tile?.suit === "flower";
const tileKindKey = (tile) => tile.suit === "honor" || tile.suit === "flower" ? `${tile.suit}-${tile.kind}` : `${tile.suit}-${tile.rank}`;
const sameTileKind = (a, b) => tileKindKey(a) === tileKindKey(b);
const isBaibaTriggerTile = (tile) => Boolean(
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
const getVisibleBaibaMultiplierDetails = (state, options = {}) => {
  const enabled = Boolean(state?.settings?.ruleConfig?.baibaEnabled);
  const hasBaiba = enabled && (state.doraIndicators ?? []).some(isBaibaTriggerTile);
  const hasSpecialUra = enabled && Boolean(state.handLog?.result) && (state.uraDoraIndicators ?? []).some(isBaibaTriggerTile);
  const pochiColor = Object.prototype.hasOwnProperty.call(options, "pochiColor")
    ? options.pochiColor
    : state.handLog?.result?.scoreResult?.pochiColor || null;
  const hasRedOrBluePochi = enabled && (pochiColor === "red" || pochiColor === "blue");
  const conditionCount = Number(hasBaiba) + Number(hasSpecialUra) + Number(hasRedOrBluePochi);
  return {
    multiplier: conditionCount === 0 ? 1 : Math.min(4, conditionCount + 1),
    labels: [
      hasBaiba ? "倍場" : null,
      hasSpecialUra ? "裏ドラ特殊牌" : null,
      hasRedOrBluePochi ? (pochiColor === "red" ? "赤ぽっち" : "青ぽっち") : null,
    ].filter(Boolean),
  };
};
const getDoraTileTypeFromIndicator = (indicator) => {
  if (indicator.suit === "pinzu" || indicator.suit === "souzu") return `${indicator.suit}-${indicator.rank === 9 ? 1 : indicator.rank + 1}`;
  if (indicator.suit === "manzu") return `manzu-${indicator.rank === 1 ? 9 : 1}`;
  if (indicator.suit === "flower") return "flower-flower";
  const winds = ["east", "south", "west", "north"];
  const dragons = ["white", "green", "red"];
  if (winds.includes(indicator.kind)) return `honor-${winds[(winds.indexOf(indicator.kind) + 1) % winds.length]}`;
  if (dragons.includes(indicator.kind)) return `honor-${dragons[(dragons.indexOf(indicator.kind) + 1) % dragons.length]}`;
  return tileKindKey(indicator);
};
const countIndicatorDora = (indicators, tiles) => {
  const doraTypes = indicators.map(getDoraTileTypeFromIndicator);
  return tiles.reduce((count, tile) => count + doraTypes.filter((type) => type === tileKindKey(tile)).length, 0);
};
const getBaseScoreFromHan = (han, isDealer) => {
  const child = {
    1: { basePoints: 1, limitType: "通常" },
    2: { basePoints: 2, limitType: "通常" },
    3: { basePoints: 4, limitType: "通常" },
    4: { basePoints: 8, limitType: "満貫" },
    5: { basePoints: 8, limitType: "満貫" },
    6: { basePoints: 12, limitType: "跳満" },
    7: { basePoints: 12, limitType: "跳満" },
    8: { basePoints: 16, limitType: "倍満" },
    9: { basePoints: 16, limitType: "倍満" },
    10: { basePoints: 16, limitType: "倍満" },
    11: { basePoints: 24, limitType: "三倍満" },
    12: { basePoints: 24, limitType: "三倍満" },
    13: { basePoints: 24, limitType: "三倍満" },
  };
  const dealer = {
    1: { basePoints: 2, limitType: "通常" },
    2: { basePoints: 3, limitType: "通常" },
    3: { basePoints: 6, limitType: "通常" },
    4: { basePoints: 12, limitType: "満貫" },
    5: { basePoints: 12, limitType: "満貫" },
    6: { basePoints: 18, limitType: "跳満" },
    7: { basePoints: 18, limitType: "跳満" },
    8: { basePoints: 24, limitType: "倍満" },
    9: { basePoints: 24, limitType: "倍満" },
    10: { basePoints: 24, limitType: "倍満" },
    11: { basePoints: 36, limitType: "三倍満" },
    12: { basePoints: 36, limitType: "三倍満" },
    13: { basePoints: 36, limitType: "三倍満" },
  };
  if (han <= 0) return { basePoints: 0, limitType: "通常" };
  if (han >= 14) return isDealer ? { basePoints: 48, limitType: "役満" } : { basePoints: 32, limitType: "役満" };
  return (isDealer ? dealer : child)[han];
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
const sortHandTiles = (hand) => {
  const suitOrder = { manzu: 0, pinzu: 1, souzu: 2, honor: 3, flower: 4 };
  const honorOrder = { east: 0, south: 1, west: 2, north: 3, white: 4, green: 5, red: 6 };
  return [...hand].sort((a, b) => {
    const suitDiff = suitOrder[a.suit] - suitOrder[b.suit];
    if (suitDiff) return suitDiff;
    if (a.suit === "honor") return (honorOrder[a.kind] ?? 99) - (honorOrder[b.kind] ?? 99);
    return (a.rank ?? 0) - (b.rank ?? 0);
  });
};
const colorSuffix = (tile) => tile.color === "normal" ? "" : `_${tile.color}`;
const tileAssetPath = (fileName) => location.protocol === "file:" ? `./public/tiles/${fileName}` : `/tiles/${fileName}`;
const soundAssetPath = (fileName) => location.protocol === "file:" ? `./public/sounds/${fileName}` : `/sounds/${fileName}`;
const GAME_SOUND_FILES = { pon: "pon.wav", kan: "kan.wav", tsumo: "tsumo.wav", ron: "ron.wav", riichi: "riichi.wav", feverRiichi: "fever-riichi.wav", baiba: "baiba.wav", pochiTsumoRed: "pochi-tsumo-red.wav", pochiTsumoBlue: "pochi-tsumo-blue.wav", discard: ["dapai.m4a", "discard.m4a", "discard.mp3"] };
const gameSoundCache = new Map();
const gameSoundPools = new Map();
const soundFileNamesForType = (type) => {
  const files = GAME_SOUND_FILES[type];
  return Array.isArray(files) ? files : files ? [files] : [];
};
const mimeTypeForSoundFile = (fileName) => {
  const ext = String(fileName || "").split(".").pop()?.toLowerCase();
  if (ext === "m4a") return "audio/mp4";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  return "";
};
const selectSupportedSoundFile = (type) => {
  const fileNames = soundFileNamesForType(type);
  if (!fileNames.length || typeof Audio === "undefined") return "";
  const tester = new Audio();
  return fileNames.find((fileName) => {
    const mimeType = mimeTypeForSoundFile(fileName);
    return !mimeType || tester.canPlayType(mimeType) !== "";
  }) || fileNames[0];
};
const getGameSoundAudio = (type) => {
  const fileName = selectSupportedSoundFile(type);
  if (!fileName || typeof Audio === "undefined") return null;
  if (!gameSoundCache.has(type)) {
    const audio = new Audio(soundAssetPath(fileName));
    audio.preload = "auto";
    audio.volume = 0.92;
    gameSoundCache.set(type, audio);
  }
  return gameSoundCache.get(type);
};
const getGameSoundPool = (type) => {
  if (typeof Audio === "undefined") return [];
  if (!gameSoundPools.has(type)) {
    const fileName = selectSupportedSoundFile(type);
    if (!fileName) return [];
    const poolSize = type === "discard" ? 10 : 5;
    const pool = Array.from({ length: poolSize }, () => {
      const audio = new Audio(soundAssetPath(fileName));
      audio.preload = "auto";
      audio.volume = 0.92;
      audio.__anmikaStartedAt = 0;
      audio.load?.();
      return audio;
    });
    gameSoundPools.set(type, pool);
  }
  return gameSoundPools.get(type) || [];
};
const getPlayableGameSoundAudio = (type) => {
  const pool = getGameSoundPool(type);
  if (!pool.length) return getGameSoundAudio(type);
  const available = pool.find((audio) => audio.paused || audio.ended || audio.currentTime === 0);
  const audio = available || [...pool].sort((a, b) => (a.__anmikaStartedAt || 0) - (b.__anmikaStartedAt || 0))[0];
  audio.__anmikaStartedAt = Date.now();
  return audio;
};
const soundTypeForEvent = (event) => {
  if (!event?.type) return "";
  if (event.type === "discard") return "discard";
  if (event.type === "pon") return "pon";
  if (event.type === "kan" || event.type === "added_kan" || event.type === "closed_kan") return "kan";
  if (event.type === "tsumo") return soundTypeForPochiTsumo(event.scoreResult) || "tsumo";
  if (event.type === "ron") return "ron";
  if (event.type === "win") return event.winType === "tsumo" ? (soundTypeForPochiTsumo(event.scoreResult) || "tsumo") : event.winType === "ron" ? "ron" : "";
  if (event.type === "riichi" || event.type === "fever_riichi") return event.feverRiichiActive || event.type === "fever_riichi" ? "feverRiichi" : "riichi";
  return "";
};
const replayAnnouncementForEvent = (event) => {
  if (!event?.type) return null;
  const playerId = event.playerId || event.winnerId || event.actorPlayerId || "";
  if (event.type === "pon") return { text: "ポン", kind: "call-pon", playerId };
  if (event.type === "kan" || event.type === "added_kan" || event.type === "closed_kan") return { text: "カン", kind: "call-kan", playerId };
  if (event.type === "ron") return { text: "ロン", kind: "ron", playerId };
  if (event.type === "tsumo") return { ...(pochiTsumoAnnouncement(event.scoreResult) || { text: "ツモ", kind: "tsumo" }), playerId };
  if (event.type === "win") {
    if (event.winType === "tsumo") return { ...(pochiTsumoAnnouncement(event.scoreResult) || { text: "ツモ", kind: "tsumo" }), playerId };
    if (event.winType === "ron") return { text: "ロン", kind: "ron", playerId };
  }
  if (event.type === "riichi" || event.type === "fever_riichi") {
    const isFever = event.feverRiichiActive || event.type === "fever_riichi";
    return { text: isFever ? "フィーバーリーチ" : "リーチ", kind: isFever ? "fever-riichi" : "riichi", playerId };
  }
  return null;
};
const announcementClassForKind = (kind) => (
  kind === "double-ron" ? "double-ron-announcement" :
  kind === "baiba-start" ? "baiba-announcement" :
  kind === "fever-riichi" ? "fever-announcement" :
  kind === "riichi" ? "riichi-announcement" :
  kind === "call-pon" ? "pon-announcement" :
  kind === "call-kan" ? "kan-announcement" :
  kind === "pao" ? "pao-announcement" :
  kind === "ron" ? "ron-announcement" :
  kind === "tsumo" ? "tsumo-announcement" :
  String(kind || "").startsWith("pochi-tsumo-") ? `tsumo-announcement pochi-tsumo-announcement ${kind}-announcement` :
  ""
);
const playAudioFile = (fileName, volume = 0.92) => {
  const audio = new Audio(soundAssetPath(fileName));
  audio.preload = "auto";
  audio.volume = volume;
  audio.currentTime = 0;
  return audio.play();
};
const playGameSound = (type, { key = "" } = {}) => {
  const fileNames = soundFileNamesForType(type);
  if (!fileNames.length || typeof Audio === "undefined") return;
  const nowMs = Date.now();
  const cacheKey = key || `${type}:${nowMs}`;
  globalThis.__anmikaSoundHistory ??= {};
  if (key && globalThis.__anmikaSoundHistory[cacheKey] && nowMs - globalThis.__anmikaSoundHistory[cacheKey] < (type === "discard" ? 60 : 450)) return;
  if (!key && globalThis.__anmikaSoundHistory[cacheKey] && nowMs - globalThis.__anmikaSoundHistory[cacheKey] < 450) return;
  globalThis.__anmikaSoundHistory[cacheKey] = nowMs;
  try {
    const audio = getPlayableGameSoundAudio(type) || new Audio(soundAssetPath(selectSupportedSoundFile(type) || fileNames[0]));
    audio.volume = 0.92;
    audio.currentTime = 0;
    audio.play()?.catch?.(() => {
      const fallback = fileNames.find((fileName) => fileName !== selectSupportedSoundFile(type));
      if (fallback) playAudioFile(fallback).catch?.(() => {});
    });
  } catch {}
};
const unlockGameSounds = () => {
  if (globalThis.__anmikaGameSoundsUnlocked || typeof Audio === "undefined") return;
  globalThis.__anmikaGameSoundsUnlocked = true;
  Object.keys(GAME_SOUND_FILES).forEach((type) => {
    getGameSoundPool(type).forEach((audio) => {
      try {
        const originalVolume = audio.volume;
        audio.muted = true;
        audio.volume = 0;
        audio.currentTime = 0;
        const promise = audio.play?.();
        promise?.then?.(() => {
          audio.pause?.();
          audio.currentTime = 0;
          audio.muted = false;
          audio.volume = originalVolume || 0.92;
        })?.catch?.(() => {
          audio.muted = false;
          audio.volume = originalVolume || 0.92;
        });
      } catch {}
    });
  });
};
if (typeof document !== "undefined") {
  ["pointerdown", "touchstart", "keydown"].forEach((eventName) => {
    document.addEventListener(eventName, unlockGameSounds, { once: true, passive: true });
  });
}
const rocketAssetExtension = (rank) => (rank === 1 || rank === 5 || rank === 9) ? "png" : "jpg";
const normalizeTileForView = (tile) => {
  if (!tile) return tile;
  if (tile.tile) tile = tile.tile;
  const suitMap = { man: "manzu", pin: "pinzu", sou: "souzu" };
  const honorMap = { haku: "white", hatsu: "green", chun: "red" };
  const suit = suitMap[tile.suit] ?? tile.suit;
  const kind = honorMap[tile.kind ?? tile.honor] ?? tile.kind ?? tile.honor;
  return {
    ...tile,
    suit,
    kind,
    color: tile.color ?? "normal",
    isPochi: Boolean(tile.isPochi),
  };
};
const getTileImagePath = (tile, faceDown = false) => {
  tile = normalizeTileForView(tile);
  if (faceDown || !tile) return tileAssetPath("tile_back.png");
  if (tile.isRocket && tile.suit === "manzu") return tileAssetPath(`man${tile.rank}_rocket.${rocketAssetExtension(tile.rank)}`);
  if (tile.isRocket && tile.suit === "pinzu") return tileAssetPath(`pin${tile.rank}_rocket.${rocketAssetExtension(tile.rank)}`);
  if (tile.isRocket && tile.suit === "souzu") return tileAssetPath(`sou${tile.rank}_rocket.${rocketAssetExtension(tile.rank)}`);
  if (tile.rank === 5 && tile.color === "blue" && tile.suit === "pinzu") return tileAssetPath("pin5_rocket.png");
  if (tile.rank === 5 && tile.color === "blue" && tile.suit === "souzu") return tileAssetPath("sou5_rocket.png");
  if (tile.suit === "manzu") return tileAssetPath(`man${tile.rank}.png`);
  if (tile.suit === "pinzu" && tile.color === "turquoise") return tileAssetPath(`pin${tile.rank}_turquoise.jpg`);
  if (tile.suit === "pinzu") return tileAssetPath(`pin${tile.rank}${colorSuffix(tile)}.png`);
  if (tile.suit === "souzu") return tileAssetPath(`sou${tile.rank}${colorSuffix(tile)}.png`);
  if (tile.suit === "flower" && tile.color === "blue") return tileAssetPath("flower_rocket.png");
  if (tile.suit === "flower") return tileAssetPath(`flower${colorSuffix(tile)}.png`);
  if (tile.kind === "white" && tile.pochiColor) return tileAssetPath(`haku_${tile.pochiColor}.png`);
  return tileAssetPath(`${{ east: "east", south: "south", west: "west", north: "north", white: "haku", green: "hatsu", red: "chun" }[tile.kind]}.png`);
};
const preloadedTileImagePaths = new Set();
const decodedTileImagePaths = new Set();
const tileImageMemoryCache = new Map();
const preloadTileImagePath = (src, { link = false } = {}) => {
  if (!src || preloadedTileImagePaths.has(src) || typeof document === "undefined") return;
  preloadedTileImagePaths.add(src);
  if (link) {
    const preload = document.createElement("link");
    preload.rel = "preload";
    preload.as = "image";
    preload.href = src;
    document.head?.appendChild(preload);
  }
  const img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  tileImageMemoryCache.set(src, img);
  img.src = src;
  img.decode?.().then(() => decodedTileImagePaths.add(src)).catch(() => {});
};
const buildAllTileAssetNames = () => {
  const paths = ["tile_back.png", "back.png", "east.png", "south.png", "west.png", "north.png", "haku.png", "hatsu.png", "chun.png"];
  for (let rank = 1; rank <= 9; rank++) {
    paths.push(`man${rank}.png`, `pin${rank}.png`, `sou${rank}.png`);
  }
  for (const suit of ["man", "pin", "sou"]) for (const rank of [1, 5, 9]) paths.push(`${suit}${rank}_rocket.${rocketAssetExtension(rank)}`);
  for (const color of ["red", "blue", "gold"]) paths.push(`pin5_${color}.png`, `sou5_${color}.png`);
  paths.push("pin5_turquoise.jpg");
  for (const color of ["red", "blue"]) paths.push(`flower_${color}.png`);
  paths.push("flower_rocket.png");
  for (const color of ["red", "yellow", "green", "blue"]) paths.push(`haku_${color}.png`);
  return paths;
};
const scheduleTileImagePreload = (paths, { linkFirst = false } = {}) => {
  const unique = [...new Set(paths)].filter(Boolean);
  const run = () => {
    for (let index = 0; index < unique.length; index++) {
      preloadTileImagePath(unique[index], { link: linkFirst && index < 6 });
    }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1800 });
  else setTimeout(run, 80);
};
const preloadTileImages = () => {
  const critical = ["tile_back.png", "east.png", "south.png", "west.png", "north.png", "haku.png", "hatsu.png", "chun.png"];
  for (let rank = 1; rank <= 9; rank++) critical.push(`man${rank}.png`, `pin${rank}.png`, `sou${rank}.png`);
  scheduleTileImagePreload(critical.map(tileAssetPath), { linkFirst: true });
  scheduleTileImagePreload(buildAllTileAssetNames().map(tileAssetPath));
};
preloadTileImages();
const collectTileImagePathsFromSnapshot = (snapshot) => {
  const paths = new Set();
  const addTile = (tile, faceDown = false) => {
    const path = getTileImagePath(tile, faceDown);
    if (path) paths.add(path);
  };
  if (!snapshot) return paths;
  for (const player of snapshot.players ?? []) {
    for (const tile of player.hand ?? []) addTile(tile);
    addTile(player.drawnTile);
    for (const tile of player.nukiDoraTiles ?? []) addTile(tile);
    for (const discard of player.discardedTiles ?? []) addTile(discard?.tile ?? discard);
    for (const meld of player.melds ?? []) {
      for (const tile of meld.tiles ?? []) addTile(tile);
      addTile(meld.addedTile);
    }
  }
  for (const tile of snapshot.doraIndicators ?? []) addTile(tile);
  for (const tile of snapshot.uraDoraIndicators ?? []) addTile(tile);
  const result = snapshot.handLog?.result || snapshot.lastScoreResult || null;
  for (const win of result?.wins ?? []) {
    for (const tile of win.hand ?? []) addTile(tile);
    for (const tile of win.meldTiles ?? []) addTile(tile);
    for (const tile of win.nukiDoraTiles ?? []) addTile(tile);
    addTile(win.winningTile || win.displayWinningTile);
  }
  return paths;
};
const warmReplayTileImages = (replay, index, radius = 2) => {
  const snapshots = getReplaySnapshots(replay);
  const paths = new Set();
  for (let offset = -1; offset <= radius; offset++) {
    const snapshot = snapshots[index + offset];
    for (const path of collectTileImagePathsFromSnapshot(snapshot)) paths.add(path);
  }
  scheduleTileImagePreload([...paths], { linkFirst: true });
};
const renderTileView = ({ tile, isDrawnTile = false, isTsumogiri = false, faceDown = false, buttonTileId, buttonAction = "discard", disabledForRiichi = false, isSelectedForDiscard = false }) => {
  tile = normalizeTileForView(tile);
  const classes = ["tile", isDrawnTile ? "drawn" : "", isTsumogiri ? "tsumogiri" : "", disabledForRiichi ? "disabled-for-riichi" : "", isSelectedForDiscard ? "selected-discard" : ""].filter(Boolean).join(" ");
  const label = faceDown ? "■" : formatTile(tile);
  const imagePath = getTileImagePath(tile, faceDown);
  preloadTileImagePath(imagePath);
  const content = `<img class="tile-image" src="${imagePath}" alt="${label}" decoding="async" loading="eager" fetchpriority="high" draggable="false" onerror="this.hidden=true; this.nextElementSibling.hidden=false;" /><span class="tile-fallback" hidden>${label}</span>`;
  if (!buttonTileId) return `<span class="${classes}">${content}</span>`;
  const attr = buttonAction === "nuki" ? "data-nuki-tile-id" : "data-discard-tile-id";
  return `<button class="${classes} tile-button" type="button" ${attr}="${buttonTileId}" oncontextmenu="event.preventDefault(); event.stopPropagation(); window.__anmikaController && window.__anmikaController.handleContextMenuAction && window.__anmikaController.handleContextMenuAction(); return false;">${content}</button>`;
};

const isRiichiDeclarationDiscard = (phase) => phase === "waitingForRiichiDiscard";
const isRiichiChoicePending = (pending) =>
  Boolean(pending?.options?.some((option) => option.type === "riichi")) &&
  !pending?.options?.some((option) => option.fromPlayerId || ["ron", "pon"].includes(option.type));
const canUseTsumogiriShortcut = (gameState, viewerPlayerId) => {
  const player = getCurrentPlayer(gameState);
  return gameState.phase === "waitingForHumanDiscard" &&
    !gameState.pendingAction &&
    !gameState.handLog.result &&
    player?.id === viewerPlayerId &&
    player?.type === "human" &&
    Boolean(player.drawnTile);
};
const formatRoundLabel = (state) => {
  const round = state?.round ?? {};
  const honba = Number(round.honba ?? state?.honba ?? 0);
  let base = state?.handLog?.roundLabel || "";
  if (isTsumoLossless3maState(state)) {
    const index = Number(round.hanchanRoundIndex ?? 0);
    base = TSUMO_LOSSLESS_ROUNDS[index] || base || "東1局";
  } else {
    base = "東場";
  }
  return `${base}${honba > 0 ? `（${honba}本場）` : ""}`;
};
const formatCenterRoundLabel = (state) => {
  const round = state?.round ?? {};
  const honba = Math.max(0, Number(round.honba ?? state?.honba ?? 0) || 0);
  if (!isTsumoLossless3maState(state)) return `東場 ${honba}本場`;
  const index = Number(round.hanchanRoundIndex ?? 0);
  const base = TSUMO_LOSSLESS_ROUNDS[index] || state?.handLog?.roundLabel || "東1局";
  return `${base} ${honba}本場`;
};
const formatReplayHandLabel = (snapshot, fallbackLabel = "", fallbackIndex = 0) => {
  const round = snapshot?.round ?? {};
  const honba = Number(round.honba ?? snapshot?.honba ?? 0);
  let base = fallbackLabel || snapshot?.handLog?.roundLabel || "";
  if (isTsumoLossless3maState(snapshot)) {
    const index = Number(round.hanchanRoundIndex ?? fallbackIndex ?? 0);
    base = TSUMO_LOSSLESS_ROUNDS[index] || base || `局${Number(fallbackIndex || 0) + 1}`;
  }
  return `${base}${honba > 0 && !/本場/.test(base) ? `${honba}本場` : ""}`;
};
const buildReplayHandMarkers = (replay, snapshots = []) => {
  const summaryMarkers = replay?.summary?.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? (replay.summary?.handMarkers ?? []) : [];
  const seen = new Set();
  const markers = [];
  const firstSnapshotIndexForHand = (handId, fallbackIndex = 0) => {
    if (!handId) return Math.max(0, Number(fallbackIndex || 0));
    const index = snapshots.findIndex((snapshot) => snapshot?.handLog?.handId === handId);
    return index >= 0 ? index : Math.max(0, Number(fallbackIndex || 0));
  };
  const pushMarker = (marker = {}, indexFallback = 0) => {
    const fallbackIndex = Math.max(0, Number(marker.index ?? indexFallback ?? 0));
    const fallbackSnapshot = snapshots[fallbackIndex] ?? null;
    const handId = marker.handId || fallbackSnapshot?.handLog?.handId || `hand-${fallbackIndex}`;
    if (seen.has(handId)) return;
    seen.add(handId);
    const index = firstSnapshotIndexForHand(handId, fallbackIndex);
    const snapshot = snapshots[index] ?? fallbackSnapshot;
    markers.push({
      handId,
      index,
      label: formatReplayHandLabel(snapshot, marker.label, markers.length),
    });
  };
  summaryMarkers.forEach(pushMarker);
  if (!markers.length && replay?.summary?.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID) {
    snapshots.forEach((snapshot, index) => {
      if (snapshot?.handLog?.handId) pushMarker({ index, handId: snapshot.handLog.handId, label: snapshot.handLog.roundLabel || "" }, index);
    });
  }
  return markers.sort((a, b) => a.index - b.index);
};
const isTsumoLosslessDealerContinuation = (state, result) => {
  if (!isTsumoLossless3maState(state)) return false;
  const dealerId = state?.round?.dealerPlayerId || "";
  if (!dealerId || !result) return false;
  if (result.type === "win") return result.winnerId === dealerId;
  if (result.type === "exhaustiveDraw") return Array.isArray(result.tenpaiPlayerIds) && result.tenpaiPlayerIds.includes(dealerId);
  return false;
};
const getTsumoLosslessRoundIndex = (state) => Math.max(0, Math.min(TSUMO_LOSSLESS_ROUNDS.length - 1, Number(state?.round?.hanchanRoundIndex ?? 0)));
const isTsumoLosslessAgariYameOpportunity = (state, result = state?.handLog?.result) =>
  isTsumoLossless3maState(state) &&
  getTsumoLosslessRoundIndex(state) >= TSUMO_LOSSLESS_ROUNDS.length - 1 &&
  isTsumoLosslessDealerContinuation(state, result) &&
  !(state?.players ?? []).some((player) => Number(player.score || 0) <= 0);
const canLocalPlayerAgariYame = (state) => {
  const localPlayerId = getLocalHumanPlayerId(state);
  return Boolean(localPlayerId && localPlayerId === state?.round?.dealerPlayerId && isTsumoLosslessAgariYameOpportunity(state));
};
const getSeatRoleLabel = (state, playerId) => {
  const players = state?.players ?? [];
  const dealerIndex = players.findIndex((player) => player.id === state?.round?.dealerPlayerId);
  const playerIndex = players.findIndex((player) => player.id === playerId);
  if (dealerIndex < 0 || playerIndex < 0 || players.length === 0) return "";
  const offset = (playerIndex - dealerIndex + players.length) % players.length;
  if (offset === 0) return "親";
  if (offset === 1) return "南家";
  return "西家";
};
const expectedDiscardTileCount = (player) => Math.max(2, 14 - (player?.melds?.length ?? 0) * 3);
const getDiscardStatus = (gameState, viewerPlayerId, tileId = null) => {
  const fail = (reason) => ({ can: false, reason });
  const ok = (reason = "") => ({ can: true, reason });
  if (!gameState) return fail("局面がありません");
  if (gameState.screen && gameState.screen !== "game") return fail("対局画面ではありません");
  if (gameState.handLog?.result) return fail("結果画面を表示中です");
  if (gameState.phase === "showingWinAnnouncement" || gameState.phase === "showingFlowerAnnouncement" || gameState.phase === "showingCallAnnouncement") return fail("演出中です");
  const pendingRiichiChoice = isRiichiChoicePending(gameState.pendingAction);
  if (gameState.pendingAction && !pendingRiichiChoice) return fail("pendingAction が残っています");
  const phaseAllowsDiscard = ["waitingForHumanDiscard", "waitingForRiichiDiscard", "playing"].includes(gameState.phase) ||
    (pendingRiichiChoice && gameState.phase === "waitingForAction");
  if (!phaseAllowsDiscard) return fail(`打牌フェーズではありません (${gameState.phase})`);
  const player = getCurrentPlayer(gameState);
  if (!player) return fail("現在プレイヤーが見つかりません");
  if (!viewerPlayerId) return fail("自分のプレイヤーIDが復元できません");
  if (player.id !== viewerPlayerId) return fail("現在の手番ではありません");
  if (player.type === "cpu") return fail("CPUの手番です");
  if (tileId && player.drawnTile?.id !== tileId && !(player.hand ?? []).some((tile) => tile.id === tileId)) return fail("その牌を持っていません");
  const tileCount = (player.hand?.length ?? 0) + (player.drawnTile ? 1 : 0);
  const expected = expectedDiscardTileCount(player);
  if (tileCount < expected) return fail(`手牌枚数が不足しています (${tileCount}/${expected})`);
  if (gameState.phase === "waitingForRiichiDiscard" && tileId && !(Array.isArray(player.riichiDiscardTileIds) ? player.riichiDiscardTileIds : []).includes(tileId)) {
    return fail("この牌ではリーチ後テンパイになりません");
  }
  if (player.isRiichi && tileId && player.drawnTile?.id !== tileId && gameState.phase !== "waitingForRiichiDiscard") {
    return fail("リーチ後はツモ切りのみです");
  }
  if (tileCount > expected) return ok(`手牌枚数が多いため打牌で補正します (${tileCount}/${expected})`);
  return ok();
};
const getDiscardBlockReason = (gameState, viewerPlayerId, tileId = null) => getDiscardStatus(gameState, viewerPlayerId, tileId).reason;
const canDiscard = (gameState, viewerPlayerId, tileId = null) => getDiscardStatus(gameState, viewerPlayerId, tileId).can;
const shouldEndAfterResultOk = (gameState) => Boolean(gameState.settings?.isLastHand) && !isTsumoLossless3maState(gameState);
const didLocalPlayerDeclareLastHand = (gameState, sync) => {
  const localUserId = sync?.userId || gameState?.onlineSync?.userId || CURRENT_USER_ID;
  if (!localUserId) return false;
  const declaredBy = Array.isArray(gameState?.lastHandDeclaredBy) ? gameState.lastHandDeclaredBy : [];
  if (declaredBy.includes(localUserId)) return true;
  const localSeat = gameState?.onlineTableSeats?.find?.((seat) => seat.userId === localUserId || seat.playerId === localUserId);
  return Boolean(localSeat?.isLastHandDeclared);
};
const shouldLeaveOnlineTableAfterGameEnded = (gameState, sync) =>
  Boolean(sync?.tableId && gameState?.phase === "gameEnded" && didLocalPlayerDeclareLastHand(gameState, sync));
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
const hasLiveWallAfterCurrentDraw = (state) => (state?.liveWall?.length ?? 0) > 0;
const canDeclareKanNow = (state) =>
  Number(state?.kanCount || 0) < 4 &&
  (state?.rinshanWall?.length ?? 0) > 0 &&
  hasLiveWallAfterCurrentDraw(state);
const formatPointDisplay = (value) => {
  const rounded = roundToTenth(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};
const signedPointDisplay = (value = 0) => {
  const rounded = roundToTenth(value);
  return `${rounded > 0 ? "+" : ""}${formatPointDisplay(rounded)}`;
};
const calculateRake = (winnerGain, rakePercent) => {
  const gain = Math.max(0, Number(winnerGain || 0));
  const percent = Math.max(0, Number(rakePercent || 0));
  if (!gain || !percent) return 0;
  return roundClubPointCreditInClubFavor(gain * (percent / 100));
};
const createPlayerClocks = (players, initialMs = INITIAL_TIME_MS) => Object.fromEntries(players.map((player) => [player.id, { playerId: player.id, remainingMs: initialMs, isInByoyomi: false }]));
const getClockRemainingMs = (state, playerId) => {
  const clock = state.playerClocks?.[playerId];
  if (!clock) return state.settings?.initialClockMs ?? INITIAL_TIME_MS;
  if (state.activeClockPlayerId !== playerId || !state.clockStartedAt) return clock.remainingMs;
  return Math.max(0, clock.remainingMs - (Date.now() - state.clockStartedAt));
};
const formatClock = (state, playerId) => `${Math.ceil(getClockRemainingMs(state, playerId) / 1000)}秒`;
const getLocalHumanPlayerId = (state) => {
  const sync = loadOnlineSync();
  const onlineUserId = sync?.userId || state.onlineMeta?.viewForPlayerId;
  if (onlineUserId && state.players?.some((player) => player.id === onlineUserId && player.type !== "cpu")) return onlineUserId;
  const currentUserId = state.currentUser?.id || authRepository.getCurrentUser()?.id;
  if (currentUserId && state.players?.some((player) => player.id === currentUserId && player.type !== "cpu")) return currentUserId;
  return state.players?.find((player) => player.type !== "cpu")?.id || null;
};
const getResultOkPlayerIds = (state) => state.handLog?.result?.resultOkPlayerIds ?? state.resultOkPlayerIds ?? [];
const getResultRequiredOkPlayerIds = (state) => (state.players ?? []).filter((player) => player.type !== "cpu").map((player) => player.id);
const hasLocalPlayerConfirmedResult = (state) => {
  const localId = getLocalHumanPlayerId(state);
  return Boolean(localId && getResultOkPlayerIds(state).includes(localId));
};
const getCurrentResultId = (state) => state.handLog?.result?.resultId || "";
const isResultCountdownExpired = (state) => Boolean(
  state.handLog?.result &&
  state.resultCountdownResultId === getCurrentResultId(state) &&
  state.resultCountdownStartedAt &&
  Date.now() - Number(state.resultCountdownStartedAt) >= RESULT_COUNTDOWN_SECONDS * 1000
);
const renderResultOkButton = (state) => {
  const countdown = state.resultCountdownSeconds ?? RESULT_COUNTDOWN_SECONDS;
  const okIds = getResultOkPlayerIds(state);
  const requiredIds = getResultRequiredOkPlayerIds(state);
  const isConfirmed = hasLocalPlayerConfirmedResult(state);
  const isSubmitting = Boolean(state.resultOkSubmitted && !isConfirmed);
  const countText = requiredIds.length > 1 ? ` ${okIds.filter((id) => requiredIds.includes(id)).length}/${requiredIds.length}` : "";
  const disabledAttr = isConfirmed ? " disabled aria-disabled=\"true\"" : "";
  return `<button type="button" class="primary-action" data-result-ok data-result-id="${escapeHtml(getCurrentResultId(state))}"${disabledAttr}>${isConfirmed ? `OK済み (${countdown}秒)${countText}` : isSubmitting ? `OK再送 (${countdown}秒)${countText}` : `OK (${countdown}秒)${countText}`}</button>`;
};
const renderAgariYameButton = (state) => {
  if (!canLocalPlayerAgariYame(state)) return "";
  return `<button type="button" class="danger agari-yame-action" data-agari-yame data-result-id="${escapeHtml(getCurrentResultId(state))}">あがりやめ</button>`;
};
const buildViewStateForPlayer = (gameState, viewerPlayerId) => {
  const viewerIndex = Math.max(0, gameState.players.findIndex((player) => player.id === viewerPlayerId));
  const ordered = [0, 1, 2].map((offset) => gameState.players[(viewerIndex + offset) % gameState.players.length]);
  const connectionsByUserId = new Map((gameState.onlineConnections ?? []).map((record) => [record.userId, record]));
  const makeSeat = (player) => {
    const connection = connectionsByUserId.get(player.id);
    const isDisconnected = Boolean(player.type !== "cpu" && connection && !connection.connected);
    return {
      playerId: player.id,
      playerName: player.name,
      isViewer: player.id === viewerPlayerId,
      isDealer: player.id === gameState.round.dealerPlayerId,
      isDisconnected,
      disconnectedAt: connection?.disconnectedAt || 0,
      score: player.score,
      handTiles: player.hand.map((tile) => ({ tile, faceDown: player.id !== viewerPlayerId })),
      drawnTile: player.drawnTile ? { tile: player.drawnTile, faceDown: player.id !== viewerPlayerId } : undefined,
      discards: player.discardedTiles.map((discard) => ({ ...discard, tile: discard.tile, faceDown: false })),
      melds: player.melds.map((meld) => ({ ...meld, tiles: meld.tiles.map((tile) => ({ tile, faceDown: false })) })),
      nukiDoraTiles: player.nukiDoraTiles.map((tile) => ({ tile, faceDown: false })),
      player,
    };
  };
  return {
    viewerPlayerId,
    seats: { bottom: makeSeat(ordered[0]), right: makeSeat(ordered[1]), top: makeSeat(ordered[2]) },
    center: { roundLabel: "東場", scores: gameState.players.map((player) => ({ playerId: player.id, name: player.name, score: player.score, isDealer: player.id === gameState.round.dealerPlayerId })), rakePool: gameState.rakePool ?? 0 },
    actionOptions: getActionOptions(gameState.pendingAction),
    canUseTsumogiriShortcut: canUseTsumogiriShortcut(gameState, viewerPlayerId),
  };
};

const createPlayer = (id, name, type = "human", score = 0) => ({ id, name, type, score, hand: [], drawnTile: null, discardedTiles: [], nukiDoraTiles: [], melds: [], status: "waiting", isRiichi: false, ippatsu: false, riichiTurnIndex: null, ippatsuOwnDrawStarted: false, sameTurnFuriten: false, riichiDiscardTileIds: [], feverRiichiActive: false, feverWinCount: 0, assistSettings: { autoWin: false, noCall: false } });
const getCurrentPlayer = (state) => state.players[state.currentPlayerIndex];
const replayPlayerIdentityFromLog = (log, playerId) => {
  if (!playerId) return {};
  const order = log?.initialSeatOrder || [];
  const seatIndex = order.indexOf(playerId);
  const initialPlayers = log?.initialPlayers || [];
  const player = initialPlayers.find((item) => item.id === playerId) || null;
  return {
    playerId,
    playerSeatIndex: seatIndex >= 0 ? seatIndex : null,
    playerName: player?.name || "",
    playerType: player?.type || "",
  };
};
const appendHandLogEvent = (log, event) => {
  const enriched = {
    ...event,
    ...(event?.playerId ? replayPlayerIdentityFromLog(log, event.playerId) : {}),
    ...(event?.fromPlayerId ? {
      fromPlayerSeatIndex: (log?.initialSeatOrder || []).indexOf(event.fromPlayerId),
      fromPlayerName: (log?.initialPlayers || []).find((item) => item.id === event.fromPlayerId)?.name || "",
    } : {}),
  };
  log.events.push(enriched);
};
const createEmptyHandLog = () => ({ handId: "not-started", roundLabel: "東場", dealerId: "", events: [], initialHands: {}, initialDoraIndicators: [], initialScores: {} });
const bumpGameStateVersion = (state) => { state.version = (state.version ?? 0) + 1; return state.version; };
const createInitialGameState = (players) => {
  const currentUser = authRepository.getCurrentUser();
  return {
    players,
    version: 0,
    liveWall: [],
    rinshanWall: [],
    doraIndicators: [],
    uraDoraIndicators: [],
    kanCount: 0,
    round: { roundWind: "east", handNumber: 1, hanchanRoundIndex: 0, honba: 0, dealerPlayerId: players[0]?.id ?? "" },
    currentPlayerIndex: 0,
    turnIndex: 0,
    isWaitingForHumanAction: false,
    phase: "idle",
    pendingAction: null,
    lastDrawnTile: null,
    lastScoreResult: null,
    winAnnouncement: null,
    flowerAnnouncement: null,
    onlineLoadingMessage: "",
    onlineLoadingMessageStartedAt: 0,
    onlineLoadingVisible: false,
    resultCountdownStartedAt: null,
    resultCountdownSeconds: null,
    resultAutoCloseHandled: false,
    ruleHelpOpen: false,
    logoutConfirmOpen: false,
    toastMessage: "",
    cpuThinkingPlayerId: null,
    cpuThinkingMessage: "",
    settings: { isLastHand: false, rakePercent: 0, pointRate: 1, initialClockMs: INITIAL_TIME_MS, ruleId: "anmika-rocket", gameType: "anmika-rocket", ruleConfig: normalizeAnmikaRocketRuleConfig(), baibaMultiplier: 1 },
    playerClocks: createPlayerClocks(players, INITIAL_TIME_MS),
    activeClockPlayerId: null,
    clockStartedAt: null,
    lastClockRenderTick: null,
    settingsOpen: false,
    rakePool: 0,
    handLog: createEmptyHandLog(),
    log: [],
    currentUser,
    screen: currentUser ? "clubSelect" : "auth",
    tables: loadTables(),
    clubs: loadClubs(),
    clubMemberPoints: loadClubMemberPoints(),
    replaySummaries: replayRepository.listReplays(),
    selectedTableId: null,
    selectedClubId: null,
    clubSearchId: "",
    clubSearchResultId: null,
    createTableSettings: createDefaultTableSettings(),
    selectedReplayId: null,
    replayIndex: 0,
    replayViewerId: CURRENT_USER_ID,
    replayRevealHands: false,
    replayAnnouncement: null,
    replayInitialState: null,
    replaySnapshots: [],
    activeTableId: null,
    activeClubId: null,
    lastSavedReplayId: null,
  };
};

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
const colorForNumberTile = (suit, rank, copy, ruleConfig = normalizeAnmikaRocketRuleConfig(), ruleId = "anmika-rocket") => {
  if (ruleId === TSUMO_LOSSLESS_3MA_RULE_ID && rank === 5 && (suit === "pinzu" || suit === "souzu")) {
    return colorByComposition(ruleConfig.fiveTileComposition, copy);
  }
  if (rank === 5 && suit === "pinzu") {
    if (ruleConfig.turquoise5pCount === 1) return copy === 1 ? "red" : copy === 2 ? "gold" : copy === 3 ? "blue" : "turquoise";
    if (ruleConfig.turquoise5pCount === 2) return copy <= 2 ? "turquoise" : copy === 3 ? "gold" : "blue";
    return copy <= 2 ? "red" : copy === 3 ? "gold" : "blue";
  }
  if (rank === 5 && suit === "souzu") return copy <= 2 ? "red" : copy === 3 ? "gold" : "blue";
  if (ruleConfig.rocket19Enabled && copy === 4 && ((suit === "manzu" && (rank === 1 || rank === 9)) || ((suit === "pinzu" || suit === "souzu") && (rank === 1 || rank === 9)))) return "blue";
  return "normal";
};
const isRocketTargetTile = (suit, rank) => (suit === "manzu" && (rank === 1 || rank === 9)) || ((suit === "pinzu" || suit === "souzu") && (rank === 1 || rank === 9));
const createWallTiles = (ruleConfig = normalizeAnmikaRocketRuleConfig(), ruleId = "anmika-rocket") => {
  ruleConfig = normalizeRuleConfigForRule(ruleId, ruleConfig);
  const tiles = [];
  for (const spec of [{ suit: "manzu", ranks: [1, 9] }, { suit: "pinzu", ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { suit: "souzu", ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9] }]) {
    for (const rank of spec.ranks) for (let copy = 1; copy <= 4; copy++) {
      const isRocket = Boolean(ruleId !== TSUMO_LOSSLESS_3MA_RULE_ID && ruleConfig.rocket19Enabled && copy === 4 && isRocketTargetTile(spec.suit, rank));
      tiles.push({ id: `${spec.suit}-${rank}-${copy}${isRocket ? "-rocket" : ""}`, suit: spec.suit, rank, color: colorForNumberTile(spec.suit, rank, copy, ruleConfig, ruleId), isPochi: false, isRocket });
    }
  }
  const usePochi = ruleId !== TSUMO_LOSSLESS_3MA_RULE_ID;
  const pochiColors = ["red", "yellow", "green", "blue"];
  for (const kind of ["east", "south", "west", "north", "white", "green", "red"]) for (let copy = 1; copy <= 4; copy++) {
    const tile = { id: `honor-${kind}-${copy}`, suit: "honor", kind, color: "normal", isPochi: usePochi && kind === "white" };
    if (usePochi && kind === "white") tile.pochiColor = pochiColors[copy - 1];
    tiles.push(tile);
  }
  for (let copy = 1; copy <= 4; copy++) tiles.push({ id: `flower-hua-${copy}`, suit: "flower", kind: "flower", color: ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? flowerColorByComposition(ruleConfig.flowerComposition, copy) : (copy <= 3 ? "red" : "blue"), isPochi: false });
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

const countTiles = (tiles) => {
  const counts = new Map();
  for (const tile of tiles.filter((t) => !isFlowerTile(t))) counts.set(tileKindKey(tile), (counts.get(tileKindKey(tile)) ?? 0) + 1);
  return counts;
};
const isSevenPairs = (counts) => counts.size === 7 && [...counts.values()].every((count) => count === 2);
const isKokushi = (counts) => [...TERMINAL_HONOR].every((key) => (counts.get(key) ?? 0) >= 1) && [...counts.keys()].every((key) => TERMINAL_HONOR.has(key)) && [...counts.values()].some((count) => count >= 2);
const parseNumberKey = (key) => {
  const [suit, rankText] = key.split("-");
  const rank = Number(rankText);
  return ["manzu", "pinzu", "souzu"].includes(suit) ? { suit, rank } : null;
};
const tileTypeSortValue = (key) => {
  const parsed = parseNumberKey(key);
  if (parsed) return ({ manzu: 0, pinzu: 10, souzu: 20 }[parsed.suit] ?? 90) + parsed.rank;
  const honorOrder = { "honor-east": 30, "honor-south": 31, "honor-west": 32, "honor-north": 33, "honor-white": 34, "honor-green": 35, "honor-red": 36 };
  return honorOrder[key] ?? 99;
};
const firstPositiveCountEntry = (counts) => [...counts.entries()]
  .filter(([, count]) => count > 0)
  .sort(([left], [right]) => tileTypeSortValue(left) - tileTypeSortValue(right))[0];
const canExtractMelds = (counts) => {
  const first = firstPositiveCountEntry(counts);
  if (!first) return true;
  const [key, count] = first;
  if (count >= 3) {
    const next = new Map(counts);
    next.set(key, count - 3);
    if (canExtractMelds(next)) return true;
  }
  const parsed = parseNumberKey(key);
  if (parsed && parsed.rank <= 7) {
    const k2 = `${parsed.suit}-${parsed.rank + 1}`;
    const k3 = `${parsed.suit}-${parsed.rank + 2}`;
    if ((counts.get(k2) ?? 0) > 0 && (counts.get(k3) ?? 0) > 0) {
      const next = new Map(counts);
      next.set(key, next.get(key) - 1);
      next.set(k2, next.get(k2) - 1);
      next.set(k3, next.get(k3) - 1);
      if (canExtractMelds(next)) return true;
    }
  }
  return false;
};
const isStandardWin = (counts) => {
  for (const [key, count] of counts) {
    if (count < 2) continue;
    const next = new Map(counts);
    next.set(key, count - 2);
    if (canExtractMelds(next)) return true;
  }
  return false;
};
const canExtractNMelds = (counts, neededMelds) => {
  if (neededMelds === 0) return [...counts.values()].every((count) => count === 0);
  const first = firstPositiveCountEntry(counts);
  if (!first) return false;
  const [key, count] = first;
  if (count >= 3) {
    const next = new Map(counts);
    next.set(key, count - 3);
    if (canExtractNMelds(next, neededMelds - 1)) return true;
  }
  const parsed = parseNumberKey(key);
  if (parsed && parsed.rank <= 7) {
    const k2 = `${parsed.suit}-${parsed.rank + 1}`;
    const k3 = `${parsed.suit}-${parsed.rank + 2}`;
    if ((counts.get(k2) ?? 0) > 0 && (counts.get(k3) ?? 0) > 0) {
      const next = new Map(counts);
      next.set(key, next.get(key) - 1);
      next.set(k2, next.get(k2) - 1);
      next.set(k3, next.get(k3) - 1);
      if (canExtractNMelds(next, neededMelds - 1)) return true;
    }
  }
  return false;
};
const isStandardWinWithMelds = (counts, meldCount) => {
  const neededMelds = 4 - meldCount;
  for (const [key, count] of counts) {
    if (count < 2) continue;
    const next = new Map(counts);
    next.set(key, count - 2);
    if (canExtractNMelds(next, neededMelds)) return true;
  }
  return false;
};
const getSeatWind = (state, playerId) => {
  const dealerIndex = Math.max(0, state.players.findIndex((player) => player.id === state.round.dealerPlayerId));
  const playerIndex = Math.max(0, state.players.findIndex((player) => player.id === playerId));
  return ["east", "south", "west"][(playerIndex - dealerIndex + state.players.length) % state.players.length] ?? "east";
};
const getYakuhaiHan = (tripletTileType, playerSeatWind, roundWind = "east") => {
  const alwaysYakuhai = new Set(["honor-white", "honor-green", "honor-red", "honor-east", "honor-north"]);
  let han = alwaysYakuhai.has(tripletTileType) ? 1 : 0;
  if (tripletTileType === `honor-${playerSeatWind}`) han += 1;
  if (tripletTileType === `honor-${roundWind}` && roundWind !== "east") han += 1;
  return han;
};
const getTripletKeysFromMelds = (melds) => melds
  .filter((meld) => ["pon", "minkan", "ankan", "kakan"].includes(meld.type))
  .map((meld) => tileKindKey(meld.tiles[0]));
const evaluateWin = (state, player, tile) => {
  const tiles = [...player.hand, ...(tile ? [tile] : player.drawnTile ? [player.drawnTile] : [])].filter((t) => !isFlowerTile(t));
  const meldCount = player.melds?.length ?? 0;
  if (tiles.length + meldCount * 3 !== 14) return { canWin: false };
  const counts = countTiles(tiles);
  if (meldCount > 0 && !isStandardWinWithMelds(counts, meldCount)) return { canWin: false };
  if (meldCount === 0 && !(isKokushi(counts) || isSevenPairs(counts) || isStandardWin(counts))) return { canWin: false };
  const yaku = [];
  if (isKokushi(counts)) yaku.push({ name: "国士無双", han: 13, isYakuman: true });
  if (isSevenPairs(counts)) yaku.push({ name: "七対子", han: 2 });
  if (player.isRiichi) yaku.push({ name: "リーチ", han: 1 });
  if (player.ippatsu && player.isRiichi) yaku.push({ name: "一発", han: 1 });
  if (player.drawnTile && tile?.id === player.drawnTile.id) yaku.push({ name: "門前清自摸和", han: 1 });
  if (tiles.every((t) => t.suit !== "honor" && t.rank !== 1 && t.rank !== 9)) yaku.push({ name: "タンヤオ", han: 1 });
  for (const key of ["honor-white", "honor-green", "honor-red", "honor-east"]) if ((counts.get(key) ?? 0) >= 3) yaku.push({ name: `役牌 ${explicitLabelKey(key)}`, han: 1 });
  const tanyaoYaku = yaku.find((item) => item.name === "タンヤオ");
  if (meldCount > 0) yaku.splice(0, yaku.length, ...(tanyaoYaku ? [tanyaoYaku] : []));
  const tripletKeys = new Set([...getTripletKeysFromMelds(player.melds ?? []), ...[...counts.entries()].filter(([, count]) => count >= 3).map(([key]) => key)]);
  const seatWind = getSeatWind(state, player.id);
  for (const key of tripletKeys) {
    const han = getYakuhaiHan(key, seatWind, state.round.roundWind);
    if (han > 0) yaku.push({ name: `役牌 ${honorText[key.replace("honor-", "")] ?? key}`, han });
  }
  if (yaku.length === 0) return { canWin: false };
  return { canWin: true, yaku };
};

const explicitIsMenzen = (player) => !(player.melds ?? []).some((meld) => ["pon", "minkan", "kakan"].includes(meld.type));
const isTurquoise5p = (tile) => tile?.suit === "pinzu" && tile.rank === 5 && tile.color === "turquoise";
const hasTurquoise5pInTilesOrMelds = (tiles = [], melds = []) => [
  ...tiles,
  ...(melds ?? []).flatMap((meld) => meld.tiles ?? []),
].some(isTurquoise5p);
const hasTurquoise5pInHandOrMelds = (player) => hasTurquoise5pInTilesOrMelds([
  ...(player.hand ?? []),
  ...(player.drawnTile ? [player.drawnTile] : []),
], player.melds ?? []);
const canUseTurquoiseOpenRiichi = (player) => !explicitIsMenzen(player) && hasTurquoise5pInHandOrMelds(player);
const explicitFixedMelds = (melds = []) => melds.map((meld) => ({ type: "triplet", key: tileKindKey(meld.tiles[0]), source: meld.type }));
const isRenhouEligible = (state, player, isTsumo) => {
  if (isTsumo) return false;
  const hasCallOrKan = state.handLog.events.some((event) => ["pon", "kan"].includes(event.type)) || state.players.some((p) => (p.melds ?? []).some((meld) => ["pon", "minkan", "ankan", "kakan"].includes(meld.type)));
  return !hasCallOrKan && state.turnIndex <= state.players.length;
};
const canWinByRiichiRequirement = ({ state, yaku, player, isClosed }) => {
  if (isTsumoLossless3maState(state)) return true;
  if (state?.settings?.ruleConfig?.otokogiEnabled === false) return true;
  if (yaku.some((item) => item.name === "国士無双" || item.name === "人和")) return true;
  if (yaku.some((item) => item.name === "嶺上開花")) return true;
  if (!isClosed) return true;
  return player.isRiichi;
};
const isRinshanKaihouTsumo = (state, player, tile) => {
  if (!state?.rinshanKaihou || !player?.drawnTile || !tile) return false;
  return state.rinshanKaihou.playerId === player.id &&
    state.rinshanKaihou.tileId === tile.id &&
    player.drawnTile.id === tile.id;
};
const explicitIsChinitsuTiles = (tiles) => {
  const numberTiles = tiles.filter((tile) => ["manzu", "pinzu", "souzu"].includes(tile.suit));
  const suits = new Set(numberTiles.map((tile) => tile.suit));
  return numberTiles.length === tiles.length && suits.size === 1;
};
const explicitIsSevenPairs = (counts) => {
  let pairCount = 0;
  for (const count of counts.values()) {
    if (count === 2) pairCount += 1;
    else if (count === 4) pairCount += 2;
    else return false;
  }
  return pairCount === 7;
};
const explicitIsKokushi = (counts) => [...TERMINAL_HONOR].every((key) => (counts.get(key) ?? 0) >= 1) && [...counts.keys()].every((key) => TERMINAL_HONOR.has(key)) && [...counts.values()].some((count) => count >= 2);
const explicitIsKokushi13Wait = (hand) => {
  const counts = countTiles(hand);
  return counts.size === 13 && [...TERMINAL_HONOR].every((key) => (counts.get(key) ?? 0) === 1);
};
const explicitExtractMelds = (counts) => {
  const first = firstPositiveCountEntry(counts);
  if (!first) return [[]];
  const [key, count] = first;
  const results = [];
  if (count >= 3) {
    const next = new Map(counts);
    next.set(key, count - 3);
    for (const rest of explicitExtractMelds(next)) results.push([{ type: "triplet", key, source: "concealed" }, ...rest]);
  }
  const parsed = parseNumberKey(key);
  if (parsed && parsed.rank <= 7) {
    const k2 = `${parsed.suit}-${parsed.rank + 1}`;
    const k3 = `${parsed.suit}-${parsed.rank + 2}`;
    if ((counts.get(k2) ?? 0) > 0 && (counts.get(k3) ?? 0) > 0) {
      const next = new Map(counts);
      next.set(key, next.get(key) - 1);
      next.set(k2, next.get(k2) - 1);
      next.set(k3, next.get(k3) - 1);
      for (const rest of explicitExtractMelds(next)) results.push([{ type: "sequence", suit: parsed.suit, start: parsed.rank, source: "concealed" }, ...rest]);
    }
  }
  return results;
};
const explicitFindStandardShapes = (counts, neededMelds = 4) => {
  const shapes = [];
  for (const [pairKey, count] of counts) {
    if (count < 2) continue;
    const next = new Map(counts);
    next.set(pairKey, count - 2);
    for (const melds of explicitExtractMelds(next)) if (melds.length === neededMelds) shapes.push({ pairKey, melds });
  }
  return shapes;
};
const explicitIsTanyao = (tiles) => tiles.every((tile) => tile.suit !== "honor" && tile.suit !== "flower" && tile.rank !== 1 && tile.rank !== 9);
const explicitCountIipeikouPairs = (sequences) => {
  const counts = new Map();
  for (const sequence of sequences) {
    const key = `${sequence.suit}-${sequence.start}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.floor(count / 2), 0);
};
const explicitHasSanshoku = (sequences) => {
  for (let start = 1; start <= 7; start++) {
    const suits = new Set(sequences.filter((meld) => meld.start === start).map((meld) => meld.suit));
    if (suits.has("manzu") && suits.has("pinzu") && suits.has("souzu")) return true;
  }
  return false;
};
const explicitHasIttsu = (sequences) => ["manzu", "pinzu", "souzu"].some((suit) => {
  const starts = new Set(sequences.filter((meld) => meld.suit === suit).map((meld) => meld.start));
  return starts.has(1) && starts.has(4) && starts.has(7);
});
const explicitIsHonroutou = (tiles) => tiles.every((tile) => TERMINAL_HONOR.has(tileKindKey(tile)));
const explicitSetTerminalCheck = (meld) => {
  if (meld.type === "triplet") return meld.key;
  return meld.start === 1 || meld.start === 7 ? "terminal-set" : `${meld.suit}-${meld.start}`;
};
const explicitChantaOrJunchan = (tiles, shape, isOpen) => {
  if (explicitIsHonroutou(tiles)) return null;
  if (!shape.melds.some((meld) => meld.type === "sequence")) return null;
  const ok = [shape.pairKey, ...shape.melds.map(explicitSetTerminalCheck)].every((key) => key === "terminal-set" || TERMINAL_HONOR.has(key));
  if (!ok) return null;
  const hasHonor = tiles.some((tile) => tile.suit === "honor");
  return hasHonor ? { name: "チャンタ", han: isOpen ? 1 : 2 } : { name: "純チャン", han: isOpen ? 2 : 3 };
};
const explicitColorYaku = (tiles, isClosed) => {
  const numberTiles = tiles.filter((tile) => ["manzu", "pinzu", "souzu"].includes(tile.suit));
  const suits = new Set(numberTiles.map((tile) => tile.suit));
  const hasHonor = tiles.some((tile) => tile.suit === "honor");
  if (suits.size === 1 && !hasHonor) return [{ name: "清一色", han: isClosed ? 6 : 5 }];
  if (suits.size === 1 && hasHonor) return [{ name: "混一色", han: isClosed ? 3 : 2 }];
  return [];
};
const explicitCountAnkou = (triplets, context) => triplets.filter((triplet) => {
  if (triplet.source === "ankan") return true;
  if (triplet.source !== "concealed") return false;
  if (!context.isTsumo && triplet.key === context.winningKey) return false;
  return true;
}).length;
const explicitIsRyanmen = (shape, winningKey) => {
  if (!winningKey) return false;
  const parsed = parseNumberKey(winningKey);
  if (!parsed) return false;
  return shape.melds.some((meld) => {
    if (meld.type !== "sequence" || meld.suit !== parsed.suit) return false;
    if (parsed.rank === meld.start) return meld.start !== 7;
    if (parsed.rank === meld.start + 2) return meld.start !== 1;
    return false;
  });
};
const explicitIsPinfu = (shape, context) =>
  shape.melds.every((meld) => meld.type === "sequence") &&
  getYakuhaiHan(shape.pairKey, getSeatWind(context.state, context.player.id), context.state.round.roundWind) === 0 &&
  explicitIsRyanmen(shape, context.winningKey);
const isPureClosedTriplet = (hand, tileType) => {
  const key = typeof tileType === "string" ? tileType : tileKindKey(tileType);
  const counts = countTiles(hand.filter((tile) => !isFlowerTile(tile)));
  return (counts.get(key) ?? 0) >= 3;
};
const explicitShousangen = (shape, triplets) => {
  const dragons = new Set(["honor-white", "honor-green", "honor-red"]);
  return triplets.filter((meld) => dragons.has(meld.key)).length === 2 && dragons.has(shape.pairKey);
};
const explicitIsManzuHonitsuYakuman = (tiles) =>
  tiles.some((tile) => tile.suit === "manzu") &&
  tiles.every((tile) => tile.suit === "manzu" || tile.suit === "honor");
const explicitIsRyuuiisou = (tiles) => {
  const greenKeys = new Set(["souzu-2", "souzu-3", "souzu-4", "souzu-6", "souzu-8", "honor-green"]);
  return tiles.length > 0 && tiles.every((tile) => greenKeys.has(tileKindKey(tile)));
};
const explicitIsChuren = (tiles, isClosed) => {
  if (!isClosed || tiles.length !== 14) return false;
  const numberTiles = tiles.filter((tile) => ["manzu", "pinzu", "souzu"].includes(tile.suit));
  if (numberTiles.length !== tiles.length) return false;
  const suits = new Set(numberTiles.map((tile) => tile.suit));
  if (suits.size !== 1) return false;
  const counts = Array.from({ length: 10 }, (_, index) => index === 0 ? 0 : numberTiles.filter((tile) => tile.rank === index).length);
  if (counts[1] < 3 || counts[9] < 3) return false;
  for (let rank = 2; rank <= 8; rank++) if (counts[rank] < 1) return false;
  return counts.slice(1).reduce((sum, count) => sum + count, 0) === 14;
};
const isFirstTsumoYakumanEligible = (state, player, isTsumo) => {
  if (!isTsumo || (player.melds ?? []).length > 0) return false;
  const hasCallOrKan = state.handLog.events.some((event) => ["pon", "kan"].includes(event.type));
  return !hasCallOrKan && state.turnIndex < state.players.length;
};
const explicitYakumanYaku = (context, shape, triplets) => {
  const yaku = [];
  const tripletKeys = new Set(triplets.map((meld) => meld.key));
  const ankouCount = explicitCountAnkou(triplets, { isTsumo: context.isTsumo, winningKey: context.winningKey });
  const kanCount = (context.player.melds ?? []).filter((meld) => ["ankan", "minkan", "kakan"].includes(meld.type)).length;
  if (explicitIsManzuHonitsuYakuman(context.allTiles)) yaku.push({ name: "萬子混一色", han: 13, isYakuman: true });
  if (explicitIsRyuuiisou(context.allTiles)) yaku.push({ name: "緑一色", han: 13, isYakuman: true });
  if (explicitIsChuren(context.allTiles, context.isClosed)) yaku.push({ name: "九蓮宝燈", han: 13, isYakuman: true });
  if (context.isClosed && ankouCount === 4) yaku.push({ name: "四暗刻", han: 13, isYakuman: true, detail: context.winningKey === shape.pairKey ? "単騎" : undefined });
  if (["honor-white", "honor-green", "honor-red"].every((key) => tripletKeys.has(key))) yaku.push({ name: "大三元", han: 13, isYakuman: true });
  if (context.allTiles.every((tile) => tile.suit === "honor")) yaku.push({ name: "字一色", han: 13, isYakuman: true });
  const windTripletCount = ["honor-east", "honor-south", "honor-west", "honor-north"].filter((key) => tripletKeys.has(key)).length;
  if (windTripletCount === 4) yaku.push({ name: "大四喜", han: 13, isYakuman: true });
  else if (windTripletCount === 3 && new Set(["honor-east", "honor-south", "honor-west", "honor-north"]).has(shape.pairKey)) yaku.push({ name: "小四喜", han: 13, isYakuman: true });
  if (context.allTiles.every((tile) => tile.suit !== "honor" && tile.rank && (tile.rank === 1 || tile.rank === 9))) yaku.push({ name: "清老頭", han: 13, isYakuman: true });
  if (kanCount === 4) yaku.push({ name: "四槓子", han: 13, isYakuman: true });
  return yaku;
};
const explicitDedupeYaku = (yaku) => {
  const result = [];
  const seen = new Set();
  for (const item of yaku) {
    const key = `${item.name}-${item.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};
const explicitLabelKey = (key) => ({ "honor-east": "東", "honor-south": "南", "honor-west": "西", "honor-north": "北", "honor-white": "白", "honor-green": "發", "honor-red": "中" }[key] ?? key);
const evaluateWinExplicit = (state, player, tile) => {
  const concealedTiles = [...player.hand, ...(tile ? [tile] : player.drawnTile ? [player.drawnTile] : [])].filter((t) => !isFlowerTile(t));
  const fixedMelds = explicitFixedMelds(player.melds);
  const meldCount = fixedMelds.length;
  const isClosed = explicitIsMenzen(player);
  const isTsumo = Boolean(player.drawnTile && (!tile || player.drawnTile.id === tile.id));
  const winningKey = tile ? tileKindKey(tile) : player.drawnTile ? tileKindKey(player.drawnTile) : null;
  if (concealedTiles.length + meldCount * 3 !== 14) return { canWin: false, reason: "和了判定には14枚相当の牌が必要です" };
  const concealedCounts = countTiles(concealedTiles);
  const allTiles = [...concealedTiles, ...(player.melds ?? []).flatMap((meld) => meld.tiles ?? [])].filter((t) => !isFlowerTile(t));

  if (meldCount === 0 && explicitIsKokushi(concealedCounts)) {
    return { canWin: true, handType: "kokushi", yaku: [{ name: "国士無双", han: 13, isYakuman: true, detail: explicitIsKokushi13Wait(player.hand) ? "13面待ち" : undefined }], han: 13 };
  }
  const turquoiseOpenRiichi = player.isRiichi && canUseTurquoiseOpenRiichi(player);
  const riichiYakuEnabled = isClosed || turquoiseOpenRiichi;
  const menzenTsumoYakuEnabled = isClosed || turquoiseOpenRiichi;
  const baseYaku = [];
  if (riichiYakuEnabled && player.isRiichi) baseYaku.push({ name: "リーチ", han: 1, detail: turquoiseOpenRiichi ? "ターコイズ副露リーチ" : undefined });
  if (riichiYakuEnabled && player.ippatsu && player.isRiichi) baseYaku.push({ name: "一発", han: 1 });
  if (menzenTsumoYakuEnabled && isTsumo) baseYaku.push({ name: "門前清自摸和", han: 1, detail: turquoiseOpenRiichi ? "ターコイズ副露リーチ" : undefined });
  if (isTsumo && isRinshanKaihouTsumo(state, player, tile || player.drawnTile)) baseYaku.push({ name: "嶺上開花", han: 1 });
  if (isFirstTsumoYakumanEligible(state, player, isTsumo)) baseYaku.push({ name: player.id === state.round.dealerPlayerId ? "天和" : "地和", han: 13, isYakuman: true });
  if (isRenhouEligible(state, player, isTsumo)) baseYaku.push({ name: "人和", han: 13, isYakuman: true });
  if (meldCount === 0 && explicitIsSevenPairs(concealedCounts)) {
    let yaku = explicitIsManzuHonitsuYakuman(allTiles) ? [{ name: "萬子混一色", han: 13, isYakuman: true }] : explicitIsChinitsuTiles(allTiles) ? [{ name: "大車輪", han: 13, isYakuman: true }] : [...baseYaku, { name: "七対子", han: 2 }, ...explicitColorYaku(allTiles, isClosed)];
    if (!yaku.some((item) => item.isYakuman) && explicitIsHonroutou(allTiles)) yaku.push({ name: "混老頭", han: 2 });
    yaku = explicitDedupeYaku(yaku);
    if (!canWinByRiichiRequirement({ state, yaku, player, isClosed })) return { canWin: false, reason: "門前ダマテン和了は禁止です" };
    return yaku.length ? { canWin: true, handType: "sevenPairs", yaku, han: yaku.reduce((sum, item) => sum + item.han, 0) } : { canWin: false, reason: "和了形ですが役がありません" };
  }
  const shapes = explicitFindStandardShapes(concealedCounts, 4 - meldCount);
  if (shapes.length === 0) {
    return { canWin: false, reason: "和了形ではありません" };
  }
  const candidates = shapes.map((shape) => {
    const completeShape = { pairKey: shape.pairKey, melds: [...shape.melds, ...fixedMelds] };
    const sequences = completeShape.melds.filter((meld) => meld.type === "sequence");
    const triplets = completeShape.melds.filter((meld) => meld.type === "triplet");
    const context = { state, player, allTiles, isClosed, isTsumo, winningKey };
    let yaku = [...baseYaku, ...explicitYakumanYaku(context, completeShape, triplets)];
    if (!yaku.some((item) => item.isYakuman)) {
      if (explicitIsTanyao(allTiles)) yaku.push({ name: "タンヤオ", han: 1 });
      const seatWind = getSeatWind(state, player.id);
      for (const triplet of triplets) {
        const han = getYakuhaiHan(triplet.key, seatWind, state.round.roundWind);
        if (han > 0) yaku.push({ name: `役牌 ${explicitLabelKey(triplet.key)}`, han, detail: han === 2 ? "常時役牌 + 自風" : undefined });
      }
      if (isClosed && explicitIsPinfu(completeShape, { state, player, winningKey })) yaku.push({ name: "平和", han: 1 });
      if (isClosed) {
        const iipeikou = explicitCountIipeikouPairs(sequences);
        if (iipeikou >= 2) yaku.push({ name: "二盃口", han: 3 });
        else if (iipeikou === 1) yaku.push({ name: "一盃口", han: 1 });
      }
      if (triplets.length === 4) yaku.push({ name: "対々和", han: 2 });
      if (explicitCountAnkou(triplets, { isTsumo, winningKey }) >= 3) yaku.push({ name: "三暗刻", han: 2 });
      const kanCount = (player.melds ?? []).filter((meld) => ["ankan", "minkan", "kakan"].includes(meld.type)).length;
      if (kanCount >= 3) yaku.push({ name: "三槓子", han: 2 });
      if (explicitShousangen(completeShape, triplets)) yaku.push({ name: "小三元", han: 2 });
      if (explicitIsHonroutou(allTiles)) yaku.push({ name: "混老頭", han: 2 });
      if (explicitHasSanshoku(sequences)) yaku.push({ name: "三色同順", han: isClosed ? 2 : 1 });
      if (explicitHasIttsu(sequences)) yaku.push({ name: "一気通貫", han: isClosed ? 2 : 1 });
      const terminalYaku = explicitChantaOrJunchan(allTiles, completeShape, !isClosed);
      if (terminalYaku) yaku.push(terminalYaku);
      yaku.push(...explicitColorYaku(allTiles, isClosed));
    }
    yaku = explicitDedupeYaku(yaku);
    return { yaku, han: yaku.reduce((sum, item) => sum + item.han, 0) };
  });
  const best = candidates.sort((a, b) => b.han - a.han)[0];
  if (!best?.yaku.length) return { canWin: false, reason: "和了形ですが役がありません" };
  if (!canWinByRiichiRequirement({ state, yaku: best.yaku, player, isClosed })) return { canWin: false, reason: "門前ダマテン和了は禁止です" };
  return { canWin: true, handType: "standard", yaku: best.yaku, han: best.han };
};

class RuleEngine {
  canDraw(state, player) { return (state.phase === "playing" || state.phase === "waitingForHumanDiscard") && state.liveWall.length > 0 && player.status === "active" && !player.drawnTile; }
  canDiscard(_state, player, tile) { return player.drawnTile?.id === tile.id || player.hand.some((t) => t.id === tile.id); }
  canWin(state, player, tile) {
    const activeFever = getActiveFeverRiichiPlayer(state);
    if (activeFever && activeFever.id !== player?.id) {
      return { canWin: false, reason: "フィーバーリーチ中はフィーバーリーチ者以外は和了できません" };
    }
    return evaluateWinExplicit(state, player, tile);
  }
  calculateScore(state, _winner, input) {
    const normalDora = input.doraCount ?? countIndicatorDora(state.doraIndicators, input.winningTiles);
    const colored = input.winningTiles.filter((tile) => ["red", "blue", "gold", "turquoise"].includes(tile.color)).length;
    const bonusSourceTiles = [...input.winningTiles, ...(input.nukiDoraTiles ?? [])];
    const blueTileCount = bonusSourceTiles.filter((tile) => tile.color === "blue" && !tile.isPochi).length;
    const goldTileCount = bonusSourceTiles.filter((tile) => tile.color === "gold").length;
    const nuki = input.nukiDoraCount ?? 0;
    const uraDora = input.uraDoraCount ?? 0;
    const hasRealYakuman = input.yaku.some((yaku) => yaku.isYakuman && !yaku.isCountedYakuman);
    const yakuHan = hasRealYakuman ? 14 : input.yaku.reduce((sum, yaku) => sum + yaku.han, 0);
    const doraHan = hasRealYakuman ? 0 : normalDora + colored + nuki + uraDora;
    const totalHan = hasRealYakuman ? 14 : yakuHan + doraHan;
    const isAllRedScoreView = isTsumoLossless3maState(state) || Object.prototype.hasOwnProperty.call(score.bonuses ?? {}, "chipPending") || Boolean(score.tsumoPayments);
    if (isAllRedScoreView) {
      const isDealer = input.winnerId === input.dealerPlayerId;
      const honba = Number(state.round?.honba ?? state.honba ?? 0);
      const payments = Object.fromEntries(input.playerIds.map((id) => [id, 0]));
      let basePoints = 0;
      let limitType = "通常";
      let childPay = 0;
      let dealerPay = 0;
      if (input.winType === "tsumo") {
        const tsumoScore = getTsumoLossless3maTsumoScoreFromHan(totalHan, isDealer);
        limitType = hasRealYakuman ? "本役満" : tsumoScore.limitType;
        childPay = tsumoScore.childPay + honba * 1000;
        dealerPay = tsumoScore.dealerPay + honba * 1000;
        for (const id of input.playerIds) {
          if (id === input.winnerId) continue;
          const pay = id === input.dealerPlayerId ? dealerPay : childPay;
          payments[id] = -pay;
          payments[input.winnerId] += pay;
        }
        basePoints = isDealer ? childPay : Math.max(childPay, dealerPay);
      } else {
        const ronScore = getTsumoLossless3maRonScoreFromHan(totalHan, isDealer);
        limitType = hasRealYakuman ? "本役満" : ronScore.limitType;
        basePoints = ronScore.basePoints + honba * 1000;
        payments[input.winnerId] = basePoints;
        if (input.discarderId) payments[input.discarderId] = -basePoints;
      }
      const visibleDora = normalDora + colored + nuki;
      const doraDetails = [
        visibleDora > 0 ? { name: "ドラ", han: visibleDora } : null,
        uraDora > 0 ? { name: "裏ドラ", han: uraDora } : null,
      ].filter(Boolean);
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
        isDealer,
        isTsumo: input.winType === "tsumo",
        paymentPerPlayer: input.winType === "tsumo" ? basePoints : undefined,
        winnerGain: payments[input.winnerId],
        payments,
        paymentDeltas: Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta })),
        selectedWait: input.selectedWait ?? input.winningTiles.at(-1),
        pochiActivated: false,
        pointMultiplier: 1,
        baibaMultiplier: 1,
        yaku: input.yaku,
        yakuList: input.yaku,
        doraDetails,
        dora: { normal: normalDora, colored, nuki, visible: visibleDora, ura: uraDora },
        bonuses: { honba: honba * 1000, chipPending: false },
        tsumoPayments: input.winType === "tsumo" ? { childPay, dealerPay } : null,
      };
    }
    const { basePoints, limitType } = getBaseScoreFromHan(totalHan, input.winnerId === input.dealerPlayerId);
    const countedYakumanBonus = totalHan >= 14 && !hasRealYakuman ? 20 : 0;
    const realYakumanBonus = hasRealYakuman ? 40 : 0;
    const uraDoraBonus = (input.uraDoraCount ?? 0) * 5;
    const honbaBonus = Number(input.honba ?? state.round?.honba ?? state.honba ?? 0) * 5;
    const ippatsuBonus = input.isIppatsu ? 5 : 0;
    const baibaMultiplier = input.baibaMultiplier ?? getVisibleBaibaMultiplierDetails(state, { pochiColor: input.pochiColor || null }).multiplier;
    const blueTileBonus = blueTileCount * 20;
    const bonusPoints = blueTileBonus + goldTileCount * 5 + uraDoraBonus + honbaBonus + ippatsuBonus + countedYakumanBonus + realYakumanBonus;
    const beforeBaibaPoints = basePoints + bonusPoints;
    const totalPoints = beforeBaibaPoints * baibaMultiplier;
    const payments = Object.fromEntries(input.playerIds.map((id) => [id, 0]));
    if (input.winType === "tsumo") {
      for (const id of input.playerIds) if (id !== input.winnerId) payments[id] = -totalPoints;
      payments[input.winnerId] = totalPoints * 2;
    } else {
      payments[input.winnerId] = totalPoints;
      payments[input.discarderId] = -totalPoints;
    }
    const visibleDora = normalDora + colored + nuki;
    const doraDetails = [
      visibleDora > 0 ? { name: "ドラ", han: visibleDora } : null,
      (input.uraDoraCount ?? 0) > 0 ? { name: "裏ドラ", han: input.uraDoraCount ?? 0 } : null,
    ].filter(Boolean);
    return { yakuHan, doraHan, totalHan, han: totalHan, basePoints, bonusPoints, beforeBaibaPoints, totalPoints, finalPoints: totalPoints, limitType: hasRealYakuman ? "本役満" : limitType, isDealer: input.winnerId === input.dealerPlayerId, isTsumo: input.winType === "tsumo", paymentPerPlayer: input.winType === "tsumo" ? totalPoints : undefined, winnerGain: payments[input.winnerId], payments, selectedWait: input.selectedWait ?? input.winningTiles.at(-1), pochiActivated: false, pointMultiplier: 1, baibaMultiplier, yaku: input.yaku, yakuList: input.yaku, doraDetails, dora: { normal: normalDora, colored, nuki, visible: visibleDora, ura: input.uraDoraCount ?? 0 }, bonuses: { goldTile: goldTileCount * 5, blueTile: blueTileBonus, rocket: 0, baiba: totalPoints - beforeBaibaPoints, uraDora: uraDoraBonus, honba: honbaBonus, ippatsu: ippatsuBonus, countedYakuman: countedYakumanBonus, realYakuman: realYakumanBonus } };
  }
}

const canNukiDora = (state, playerId) => {
  const player = state.players.find((p) => p.id === playerId);
  return Boolean(player && getCurrentPlayer(state).id === playerId && (player.hand.some((tile) => isNukiDoraTileForState(state, tile)) || (player.drawnTile && isNukiDoraTileForState(state, player.drawnTile))));
};
const findManualNorthNukiTile = (state, playerId) => {
  const player = state?.players?.find((p) => p.id === playerId);
  if (!player || getCurrentPlayer(state)?.id !== playerId || !state?.settings?.ruleConfig?.northNukiDoraEnabled) return null;
  if (isNorthNukiTile(state, player.drawnTile)) return player.drawnTile;
  return player.hand?.find((tile) => isNorthNukiTile(state, tile)) || null;
};
const performNukiDoraDetailed = (state, playerId, tileId) => {
  if (!canNukiDora(state, playerId)) return null;
  const player = state.players.find((p) => p.id === playerId);
  const fromDrawn = player.drawnTile?.id === tileId && isNukiDoraTileForState(state, player.drawnTile);
  const tile = fromDrawn ? player.drawnTile : player.hand.find((t) => t.id === tileId);
  if (!tile || !isNukiDoraTileForState(state, tile)) return null;
  if (fromDrawn) player.drawnTile = null;
  else player.hand = player.hand.filter((t) => t.id !== tileId);
  player.nukiDoraTiles.push(tile);
    const replacementTile = state.rinshanWall.shift();
    if (replacementTile) {
      if (fromDrawn) player.drawnTile = replacementTile;
      else player.hand.push(replacementTile);
      state.lastDrawnTile = replacementTile;
      state.rinshanKaihou = null;
      state.pendingRinshanKaihouFromKan = false;
    }
  player.hand = sortHandTiles(player.hand);
  return replacementTile ? { nukiTile: tile, replacementTile } : { nukiTile: tile };
};
class TsumogiriCpuStrategy {
  chooseDiscard(_state, player) { if (!player.drawnTile) throw new Error(`CPU player ${player.id} has no drawnTile.`); return player.drawnTile.id; }
}
const processCpuTurn = (state, strategy, actions) => {
  const player = getCurrentPlayer(state);
  if (player.type !== "cpu") return;
  if (!player.drawnTile) actions.drawTileForCpu();
  actions.autoNukiDoraForCurrentTurn();
  if (player.drawnTile) actions.discardTileForCpu(strategy.chooseDiscard(state, player));
};
const getActionOptions = (pendingAction) => {
  if (!pendingAction) return [];
  return Array.isArray(pendingAction.options) ? pendingAction.options : [pendingAction];
};
const takeMatchingTiles = (hand, target, count) => {
  const taken = [];
  for (const tile of [...hand]) {
    if (taken.length >= count) break;
    if (sameTileKind(tile, target)) {
      taken.push(tile);
      hand.splice(hand.findIndex((candidate) => candidate.id === tile.id), 1);
    }
  }
  return taken;
};
const findFourOfAKind = (tiles) => {
  const groups = new Map();
  for (const tile of tiles) groups.set(tileKindKey(tile), [...(groups.get(tileKindKey(tile)) ?? []), tile]);
  return [...groups.values()].find((group) => group.length >= 4)?.slice(0, 4) ?? null;
};
const removeTileById = (player, tileId) => {
  if (player.drawnTile?.id === tileId) player.drawnTile = null;
  else player.hand = player.hand.filter((tile) => tile.id !== tileId);
};
const getAllTileTypesForWinningCheck = () => [
  "manzu-1", "manzu-9",
  ...Array.from({ length: 9 }, (_, index) => `pinzu-${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `souzu-${index + 1}`),
  "honor-east", "honor-south", "honor-west", "honor-north", "honor-white", "honor-green", "honor-red",
];
const createVirtualTile = (tileType) => {
  const [suit, value] = tileType.split("-");
  if (suit === "honor") return { id: `virtual-${tileType}`, suit, kind: value, color: "normal", isPochi: false };
  return { id: `virtual-${tileType}`, suit, rank: Number(value), color: "normal", isPochi: false };
};
const getAllWinningCheckTiles = () => getAllTileTypesForWinningCheck().map(createVirtualTile);
const getWaitTiles = (state, player) => {
  return getWinningTilesForTenpai(state, player);
};
const isPermanentFuriten = (state, player) => {
  const waits = getWaitTiles(state, player).map(tileKindKey);
  return player.discardedTiles.some((discard) => waits.includes(tileKindKey(discard.tile)));
};
const isTerminalOrHonorTile = (tile) => TERMINAL_HONOR.has(tileKindKey(tile));
const isNagashiYakumanPlayer = (player) => player.discardedTiles.length > 0 && player.discardedTiles.every((discard) => isTerminalOrHonorTile(discard.tile));
const isSevenPairsShape = (counts) => {
  let pairCount = 0;
  for (const count of counts.values()) {
    if (count === 2) pairCount += 1;
    else if (count === 4) pairCount += 2;
    else return false;
  }
  return pairCount === 7;
};
const canFormStandardShapeWithMelds = (tiles, melds = []) => {
  const filtered = tiles.filter((tile) => !isFlowerTile(tile));
  const meldCount = melds.length;
  if (filtered.length + meldCount * 3 !== 14) return false;
  const counts = countTiles(filtered);
  return isStandardWinWithMelds(counts, meldCount);
};
const canFormWinningShape = (tiles, melds = []) => {
  const filtered = tiles.filter((tile) => !isFlowerTile(tile));
  const meldCount = melds.length;
  if (filtered.length + meldCount * 3 !== 14) return false;
  const counts = countTiles(filtered);
  if (meldCount === 0 && isKokushi(counts)) return true;
  if (meldCount === 0 && isSevenPairsShape(counts)) return true;
  return canFormStandardShapeWithMelds(filtered, melds);
};
const getHand13ForTenpai = (player) => {
  if (player.hand.length === 13) return [...player.hand];
  if (player.drawnTile && player.hand.length === 13) return [...player.hand];
  if (!player.drawnTile && player.hand.length === 14) return player.hand.slice(0, 13);
  return [...player.hand].slice(0, 13);
};
const getWinningTilesForTenpai = (stateOrHand, playerOrMelds) => {
  const hand13 = Array.isArray(stateOrHand)
    ? stateOrHand.filter((tile) => !isFlowerTile(tile))
    : getHand13ForTenpai(playerOrMelds).filter((tile) => !isFlowerTile(tile));
  const melds = Array.isArray(stateOrHand) ? (playerOrMelds ?? []) : (playerOrMelds?.melds ?? []);
  const expectedHandLength = 13 - melds.length * 3;
  if (hand13.length !== expectedHandLength) return [];
  const seen = new Set();
  return getAllWinningCheckTiles().filter((tile) => {
    const key = tileKindKey(tile);
    if (seen.has(key)) return false;
    if (!canFormWinningShape([...hand13, tile], melds)) return false;
    seen.add(key);
    return true;
  });
};
const calculateExhaustiveDrawPayments = (state) => {
  const tenpaiResults = state.players.map((player) => {
    const handTiles = getHand13ForTenpai(player);
    const waits = getWinningTilesForTenpai(handTiles, player.melds);
    return {
      playerId: player.id,
      isTenpai: waits.length > 0,
      waits,
      handTiles,
    };
  });
  const tenpaiPlayerIds = tenpaiResults.filter((result) => result.isTenpai).map((result) => result.playerId);
  const notenPlayerIds = state.players.filter((player) => !tenpaiPlayerIds.includes(player.id)).map((player) => player.id);
  const paymentMap = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  if (tenpaiPlayerIds.length === 1) {
    paymentMap[tenpaiPlayerIds[0]] = 30;
    for (const player of state.players) if (!tenpaiPlayerIds.includes(player.id)) paymentMap[player.id] = -15;
  } else if (tenpaiPlayerIds.length === 2) {
    for (const id of tenpaiPlayerIds) paymentMap[id] = 15;
    for (const player of state.players) if (!tenpaiPlayerIds.includes(player.id)) paymentMap[player.id] = -30;
  }
  const payments = Object.entries(paymentMap).map(([playerId, delta]) => ({ playerId, delta }));
  const finalScores = Object.fromEntries(state.players.map((player) => [player.id, player.score + (paymentMap[player.id] ?? 0)]));
  return { tenpaiResults, tenpaiPlayerIds, notenPlayerIds, payments, paymentMap, finalScores };
};
const applyWinPayments = (gameState, winnerId, winType, scoreResult, loserId) => {
  const activeTable = gameState.activeTableId ? loadTables().find((table) => table.id === gameState.activeTableId) : null;
  if (isTsumoLossless3maState(gameState)) {
    const presetPayments = Array.isArray(scoreResult.paymentDeltas)
      ? Object.fromEntries(scoreResult.paymentDeltas.map((payment) => [payment.playerId, Number(payment.delta || 0)]))
      : { ...(scoreResult.payments || {}) };
    const payments = Object.fromEntries(gameState.players.map((player) => [player.id, Number(presetPayments[player.id] || 0)]));
    scoreResult.payments = payments;
    scoreResult.paymentDeltas = Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta }));
    scoreResult.winnerGain = payments[winnerId] ?? 0;
    scoreResult.originalWinnerGain = scoreResult.winnerGain;
    scoreResult.rakePoints = 0;
    scoreResult.rakeAmount = 0;
    scoreResult.rakePercent = 0;
    for (const player of gameState.players) player.score += payments[player.id] ?? 0;
    gameState.log.unshift(`点数移動 ${scoreResult.paymentDeltas.map((p) => `${p.playerId}:${p.delta >= 0 ? "+" : ""}${p.delta}`).join(" ")}`);
    return gameState;
  }
  const totalPoints = scoreResult.finalPoints ?? scoreResult.totalPoints;
  const payments = Object.fromEntries(gameState.players.map((player) => [player.id, 0]));
  if (winType === "tsumo") {
    for (const player of gameState.players) {
      if (player.id !== winnerId) payments[player.id] = -totalPoints;
    }
    payments[winnerId] = totalPoints * (gameState.players.length - 1);
    scoreResult.paymentPerPlayer = totalPoints;
  } else if (loserId) {
    payments[winnerId] = totalPoints;
    payments[loserId] = -totalPoints;
    delete scoreResult.paymentPerPlayer;
  }
  const originalWinnerGain = roundToTenth(payments[winnerId] ?? 0);
  const rakePoints = calculateRake(originalWinnerGain, gameState.settings?.rakePercent ?? 0);
  if (rakePoints > 0) {
    payments[winnerId] = roundPlayerPointDeltaInClubFavor(originalWinnerGain - rakePoints);
    if (activeTable?.clubId) {
      const club = clubRepository.getClub(activeTable.clubId);
      if (club) {
        club.rakeBalance = roundToTenth(Number(club.rakeBalance ?? 0) + rakePoints);
        clubRepository.saveClub(club);
      }
    } else {
      gameState.rakePool = roundToTenth(Number(gameState.rakePool ?? 0) + rakePoints);
    }
  }
  for (const playerId of Object.keys(payments)) payments[playerId] = roundToTenth(payments[playerId]);
  scoreResult.payments = payments;
  scoreResult.rakePoints = rakePoints;
  scoreResult.rakeAmount = rakePoints;
  scoreResult.rakePercent = gameState.settings?.rakePercent ?? 0;
  scoreResult.rakePayerId = winnerId;
  scoreResult.originalWinnerGain = originalWinnerGain;
  scoreResult.winnerGain = payments[winnerId] ?? 0;
  scoreResult.paymentDeltas = Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta }));
  for (const player of gameState.players) player.score = roundToTenth(Number(player.score || 0) + Number(payments[player.id] ?? 0));
  gameState.log.unshift(`点数移動 ${scoreResult.paymentDeltas.map((p) => `${p.playerId}:${p.delta >= 0 ? "+" : ""}${p.delta}`).join(" ")}${rakePoints ? ` レーキ:${rakePoints}` : ""}`);
  return gameState;
};
const pochiMultiplier = { red: -1, yellow: -1, green: 1, blue: 1 };
const isWhitePochiTile = (tile) => tile?.suit === "honor" && tile.kind === "white" && tile.isPochi && tile.pochiColor;
const tileForPochiCandidate = (waitTile, pochiColor) => {
  if ((waitTile.suit === "pinzu" || waitTile.suit === "souzu") && waitTile.rank === 5) {
    return { ...waitTile, id: `pochi-${pochiColor}-${waitTile.suit}-5`, color: pochiColor === "red" || pochiColor === "blue" ? "blue" : "red" };
  }
  if (waitTile.suit === "honor" && waitTile.kind === "white") {
    return { ...waitTile, id: "pochi-normal-white", color: "normal", isPochi: false, pochiColor: undefined };
  }
  return waitTile;
};
const resolvePochiWin = (gameState, player, pochiTile, ruleEngine) => {
  if (!isWhitePochiTile(pochiTile) || !player.isRiichi) return null;
  const hand13 = getHand13ForTenpai(player);
  const waits = getWinningTilesForTenpai(gameState, { ...player, hand: hand13, drawnTile: null, isRiichi: true });
  let best = null;
  for (const wait of waits) {
    const selectedWait = tileForPochiCandidate(wait, pochiTile.pochiColor);
    const simulatedPlayer = { ...player, hand: hand13, drawnTile: selectedWait, isRiichi: true };
    const win = ruleEngine.canWin(gameState, simulatedPlayer, selectedWait);
    if (!win.canWin || !win.yaku?.length) continue;
    const score = ruleEngine.calculateScore(gameState, simulatedPlayer, {
      winnerId: player.id,
      dealerPlayerId: gameState.round.dealerPlayerId,
      playerIds: gameState.players.map((p) => p.id),
      winType: "tsumo",
      yaku: win.yaku,
      winningTiles: [...hand13, selectedWait].filter((tile) => !isFlowerTile(tile)),
      selectedWait,
      drawnTile: selectedWait,
      nukiDoraCount: player.nukiDoraTiles.length,
      nukiDoraTiles: player.nukiDoraTiles,
      isRiichi: true,
      isIppatsu: player.ippatsu,
      pochiColor: pochiTile.pochiColor,
    });
    const beforeMultiplierPoints = score.finalPoints ?? score.totalPoints;
    const pointMultiplier = pochiMultiplier[pochiTile.pochiColor] ?? 1;
    const afterMultiplierPoints = beforeMultiplierPoints * pointMultiplier;
    const payments = Object.fromEntries(gameState.players.map((p) => [p.id, 0]));
    for (const opponent of gameState.players) {
      if (opponent.id !== player.id) payments[opponent.id] = -afterMultiplierPoints;
    }
    payments[player.id] = afterMultiplierPoints * (gameState.players.length - 1);
    const paymentDeltas = gameState.players.map((p) => ({ playerId: p.id, delta: payments[p.id] ?? 0 }));
    const candidate = {
      pochiActivated: true,
      pochiColor: pochiTile.pochiColor,
      selectedWait,
      pointMultiplier,
      beforeMultiplierPoints,
      afterMultiplierPoints,
      scoreResult: { ...score, selectedWait, pochiActivated: true, pochiColor: pochiTile.pochiColor, pointMultiplier, beforeMultiplierPoints, afterMultiplierPoints, totalPoints: afterMultiplierPoints, finalPoints: afterMultiplierPoints, paymentPerPlayer: afterMultiplierPoints, payments, paymentDeltas, winnerGain: payments[player.id] ?? 0 },
    };
    if (!best || Math.abs(candidate.afterMultiplierPoints) > Math.abs(best.afterMultiplierPoints)) best = candidate;
  }
  return best;
};

const hasFeverRiichiTriplet = (player) => (
  (player.melds ?? []).some((meld) => meld.type === "ankan" && (meld.tiles ?? []).some((tile) => tileKindKey(tile) === "pinzu-7" || tileKindKey(tile) === "souzu-7")) ||
  isPureClosedTriplet(player.hand ?? [], "pinzu-7") ||
  isPureClosedTriplet(player.hand ?? [], "souzu-7")
);
const FEVER_RIICHI_KEYS = new Set(["pinzu-7", "souzu-7"]);
const hasFeverAnkan = (player) =>
  (player.melds ?? []).some((meld) =>
    meld.type === "ankan" &&
    (meld.tiles ?? []).some((tile) => FEVER_RIICHI_KEYS.has(tileKindKey(tile)))
  );
const hasClosedFeverTripletInHand13 = (player, hand13) =>
  [...FEVER_RIICHI_KEYS].some((key) =>
    hand13.filter((tile) => tileKindKey(tile) === key).length >= 3 ||
    (player.melds ?? []).some((meld) => meld.type === "ankan" && (meld.tiles ?? []).some((tile) => tileKindKey(tile) === key))
  );
const winningShapeKeepsFeverTriplet = (tiles14, melds = []) => {
  const filtered = tiles14.filter((tile) => !isFlowerTile(tile));
  const fixedAnkanMelds = (melds ?? [])
    .filter((meld) => meld.type === "ankan" && meld.tiles?.[0])
    .map((meld) => ({ type: "triplet", key: tileKindKey(meld.tiles[0]), source: "ankan" }));
  const neededMelds = 4 - (melds ?? []).length;
  if (filtered.length + (melds ?? []).length * 3 !== 14 || neededMelds < 0) return false;
  const counts = countTiles(filtered);
  return explicitFindStandardShapes(counts, neededMelds).some((shape) =>
    [...shape.melds, ...fixedAnkanMelds].some((meld) => meld.type === "triplet" && FEVER_RIICHI_KEYS.has(meld.key))
  );
};
const isFeverRiichiEligibleAfterDiscard = (state, player, hand13) => {
  if (!state?.settings?.ruleConfig?.feverRiichiEnabled || !player || !hasClosedFeverTripletInHand13(player, hand13)) return false;
  const waits = getWinningTilesForTenpai(hand13, player.melds ?? []);
  if (hasFeverAnkan(player)) return waits.length > 0;
  return waits.length > 0 && waits.every((wait) => winningShapeKeepsFeverTriplet([...hand13, wait], player.melds ?? []));
};
const getActiveFeverRiichiPlayer = (state) => state.players.find((player) => player.feverRiichiActive && (player.feverWinCount ?? 0) < 2);

class GameController {
  constructor(players, ruleEngine, onStateChanged = () => {}, cpuStrategy = new TsumogiriCpuStrategy()) {
    this.state = createInitialGameState(players);
    this.ruleEngine = ruleEngine;
    this.onStateChanged = onStateChanged;
    this.cpuStrategy = cpuStrategy;
    this.onlineSyncTimer = null;
    this.onlinePublishTimer = null;
    this.onlineLoadingRevealTimer = null;
    this.isApplyingOnlineState = false;
    this.lastAppliedOnlinePublishedAt = 0;
    this.lastOnlineStateAppliedAt = 0;
    this.lastEarlyTurnWatchResyncAt = 0;
    this.earlyTurnWatchInFlight = false;
    this.lastEarlyTurnWatchKey = "";
    this.lastSocketStateStallResyncAt = 0;
    this.socketStateStallInFlight = false;
    this.onlineInitialPublisher = false;
    this.socketInitialStateInFlight = false;
    this.socketStartupResyncTimers = [];
    this.gameSocket = null;
    this.onlineGameEndedReturnScheduled = false;
    this.replayAutoListTimer = null;
    this.replayAnnouncementTimer = null;
    this.replayEffectQueueTimer = null;
    this.lastDisplayedResultKey = "";
    this.lastPlayedResultSoundKey = "";
    this.lastDisplayedAnnouncementKey = "";
    this.lastDisplayedBaibaHandId = "";
    this.announcementClearTimer = null;
    this.setupGlobalResultOkHandler();
    document.addEventListener("anmika-result-ok", (event) => {
      event?.preventDefault?.();
      this.handleResultOk({ autoAllResultOk: true });
    });
  }
  showActionAnnouncement(event, { targetState = this.state, durationMs = 1200, emit = false } = {}) {
    if (!event?.type) return false;
    const labels = { pon: "ポン", kan: "カン", pao: "パオ" };
    const label = labels[event.type];
    if (!label) return false;
    const announcementKey = `${event.type}:${event.playerId || ""}:${event.turnIndex ?? ""}:${event.kanType || ""}:${event.tile?.id || event.tiles?.map?.((tile) => tile?.id).join(",") || ""}`;
    if (announcementKey === this.lastDisplayedAnnouncementKey) return false;
    this.lastDisplayedAnnouncementKey = announcementKey;
    targetState.serverAnnouncement = { text: label, kind: event.type === "pao" ? "pao" : `call-${event.type}`, playerId: event.playerId || event.actorPlayerId || "" };
    playGameSound(soundTypeForEvent(event), { key: `call:${announcementKey}` });
    if (this.announcementClearTimer) clearTimeout(this.announcementClearTimer);
    this.announcementClearTimer = setTimeout(() => {
      if (this.state.serverAnnouncement?.kind === (event.type === "pao" ? "pao" : `call-${event.type}`)) {
        this.state.serverAnnouncement = null;
        this.emit();
      }
    }, durationMs);
    if (emit) this.emit();
    return true;
  }
  showBaibaStartAnnouncement(targetState = this.state, { emit = false } = {}) {
    if (!targetState || targetState.handLog?.result) return false;
    const handId = targetState.handLog?.handId || `${targetState.round?.handNumber || ""}:${targetState.round?.honba || ""}:${targetState.turnIndex || 0}`;
    const announcementKey = `baiba:${handId}`;
    if (!handId || announcementKey === this.lastDisplayedBaibaHandId) return false;
    const details = getVisibleBaibaMultiplierDetails(targetState);
    if (!details.labels.includes("倍場")) return false;
    this.lastDisplayedBaibaHandId = announcementKey;
    targetState.serverAnnouncement = { text: "倍場", kind: "baiba-start", playerId: "" };
    playGameSound("baiba", { key: announcementKey });
    if (this.announcementClearTimer) clearTimeout(this.announcementClearTimer);
    this.announcementClearTimer = setTimeout(() => {
      if (this.state.serverAnnouncement?.kind === "baiba-start") {
        this.state.serverAnnouncement = null;
        this.emit();
      }
    }, 1500);
    if (emit) this.emit();
    return true;
  }
  playResultSoundOnce(state, source = "result") {
    const result = state?.handLog?.result;
    if (!result) return false;
    const resultId = result.resultId || `${result.type || "result"}:${result.winnerId || result.winners?.map?.((item) => item?.winnerId).join(",") || ""}:${result.winType || ""}:${state.turnIndex ?? ""}`;
    const winType = result.winType || (Array.isArray(result.winners) && result.winners.length ? "ron" : "");
    const soundType = result.scoreResult
      ? (soundTypeForPochiTsumo(result.scoreResult) || (winType === "tsumo" ? "tsumo" : winType === "ron" ? "ron" : ""))
      : (winType === "tsumo" ? "tsumo" : winType === "ron" ? "ron" : "");
    if (!soundType) return false;
    const soundKey = `${resultId}:${soundType}`;
    if (this.lastPlayedResultSoundKey === soundKey) return false;
    this.lastPlayedResultSoundKey = soundKey;
    playGameSound(soundType, { key: `result:${source}:${soundKey}` });
    return true;
  }
  showLatestCallAnnouncement(events, { targetState = this.state } = {}) {
    const callEvent = [...(events ?? [])].reverse().find((event) => event?.type === "pon" || event?.type === "kan" || event?.type === "pao");
    if (!callEvent) return false;
    return this.showActionAnnouncement(callEvent, { targetState, durationMs: callEvent.type === "kan" ? 1600 : callEvent.type === "pao" ? 1500 : 1200 });
  }
  setOnlineLoadingMessage(message) {
    const text = String(message || "");
    if (this.onlineLoadingRevealTimer) {
      clearTimeout(this.onlineLoadingRevealTimer);
      this.onlineLoadingRevealTimer = null;
    }
    this.state.onlineLoadingMessage = text;
    this.state.onlineLoadingMessageStartedAt = text ? Date.now() : 0;
    this.state.onlineLoadingVisible = false;
    if (!text) return;
    const startedAt = this.state.onlineLoadingMessageStartedAt;
    this.onlineLoadingRevealTimer = setTimeout(() => {
      if (!this.state.onlineLoadingMessage || this.state.onlineLoadingMessageStartedAt !== startedAt) return;
      this.state.onlineLoadingVisible = true;
      this.onStateChanged(this.state);
    }, ONLINE_LOADING_DISPLAY_DELAY_MS);
  }
  clearOnlineLoadingMessage() {
    this.setOnlineLoadingMessage("");
  }
  clearSocketStartupResyncTimers() {
    for (const timer of this.socketStartupResyncTimers || []) clearTimeout(timer);
    this.socketStartupResyncTimers = [];
  }
  scheduleSocketStartupResync(reason = "startup") {
    const sync = loadOnlineSync();
    const socket = globalThis.anmikaGameSocket;
    if (sync?.transport !== "socketio" || !socket) return;
    const tableId = sync.tableId;
    const gameId = sync.gameId;
    this.clearSocketStartupResyncTimers();
    this.socketStartupResyncTimers = SOCKET_STARTUP_RESYNC_DELAYS_MS.map((delay, index) => setTimeout(() => {
      const latest = loadOnlineSync();
      if (latest?.transport !== "socketio" || latest.tableId !== tableId || latest.gameId !== gameId) return;
      if (!globalThis.anmikaGameSocket?.connected) return;
      const hasDiscard = this.state.handLog?.events?.some?.((event) => event?.type === "discard");
      const stillEarly = this.state.phase === "onlineLoading" || Number(this.state.turnIndex || 0) <= 1 || !hasDiscard;
      if (!stillEarly) return;
      this.resyncSocketGameState(`${reason}:${index + 1}`).catch((error) => {
        console.warn("[SocketGame] startup resync failed", { reason, index: index + 1, error: error?.message || String(error) });
      });
    }, delay));
  }
  shouldKeepSocketStartupResync(state = this.state) {
    if (!isSocketAuthoritativeGame()) return false;
    const hasDiscard = state.handLog?.events?.some?.((event) => event?.type === "discard");
    if (["handEnded", "exhaustiveDraw", "gameEnded"].includes(state.phase)) return false;
    return state.phase === "onlineLoading" || Number(state.turnIndex || 0) <= 1 || !hasDiscard;
  }
  setupGlobalResultOkHandler() {
    if (globalThis.__anmikaResultOkHandlerInstalled) return;
    globalThis.__anmikaResultOkHandlerInstalled = true;
    document.addEventListener("click", (event) => {
      const resultOk = event.target?.closest?.("[data-result-ok]");
      if (!resultOk) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      event.stopPropagation();
      globalThis.__anmikaController?.handleResultOk?.({ resultId: resultOk.dataset?.resultId || "" });
    }, true);
  }
  getState() { return this.state; }
  getPlayer(id) { const player = this.state.players.find((p) => p.id === id); if (!player) throw new Error(`Player not found: ${id}`); return player; }
  currentUserId() { return this.state.currentUser?.id ?? CURRENT_USER_ID; }
  ensureClocks() {
    this.state.playerClocks ??= createPlayerClocks(this.state.players, this.state.settings?.initialClockMs ?? INITIAL_TIME_MS);
    for (const player of this.state.players) {
      if (!this.state.playerClocks[player.id]) this.state.playerClocks[player.id] = { playerId: player.id, remainingMs: this.state.settings?.initialClockMs ?? INITIAL_TIME_MS, isInByoyomi: false };
    }
  }
  startClockForPlayer(playerId) {
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player || player.type !== "human") return;
    this.ensureClocks();
    if (this.state.activeClockPlayerId === playerId && this.state.clockStartedAt) return;
    this.state.activeClockPlayerId = playerId;
    this.state.clockStartedAt = Date.now();
    this.state.lastClockRenderTick = null;
  }
  stopClockForPlayer(playerId, completedAction = true) {
    this.ensureClocks();
    if (this.state.activeClockPlayerId !== playerId || !this.state.clockStartedAt) return;
    const clock = this.state.playerClocks[playerId];
    clock.remainingMs = Math.max(0, clock.remainingMs - (Date.now() - this.state.clockStartedAt));
    if (clock.remainingMs <= 5000) clock.isInByoyomi = true;
    if (completedAction && clock.isInByoyomi) clock.remainingMs = 5000;
    this.state.activeClockPlayerId = null;
    this.state.clockStartedAt = null;
    this.state.lastClockRenderTick = null;
  }
  stopAllClocks() {
    if (this.state.activeClockPlayerId) this.stopClockForPlayer(this.state.activeClockPlayerId, false);
    this.state.activeClockPlayerId = null;
    this.state.clockStartedAt = null;
  }
  recoverClockAfterDiscard(playerId) {
    this.ensureClocks();
    const clock = this.state.playerClocks[playerId];
    if (!clock) return;
    const roundedSeconds = Math.ceil((clock.remainingMs ?? 0) / 1000);
    clock.remainingMs = Math.min(roundedSeconds + 2, 20) * 1000;
  }
  tickClock() {
    if (this.state.handLog.result && this.state.phase !== "showingWinAnnouncement") {
      this.tickResultCountdown();
      this.monitorSocketStateStall();
      return;
    }
    this.monitorDiscardRecover();
    this.monitorEarlyTurnStall();
    this.monitorSocketStateStall();
    const playerId = this.state.activeClockPlayerId;
    if (!playerId || this.state.screen !== "game" || this.state.handLog.result) return;
    if (isSocketAuthoritativeGame() && this.state.optimisticDiscardRequestId) return;
    const player = this.getPlayer(playerId);
    const remainingMs = getClockRemainingMs(this.state, playerId);
    if (remainingMs > 0) {
      const renderTick = Math.ceil(remainingMs / 500);
      if (renderTick === this.state.lastClockRenderTick) return;
      this.state.lastClockRenderTick = renderTick;
      this.onStateChanged(this.state);
      return;
    }
    if (player?.type !== "human") {
      if (this.state.lastClockRenderTick !== 0) {
        this.state.lastClockRenderTick = 0;
        this.onStateChanged(this.state);
      }
      return;
    }
    if (isSocketAuthoritativeGame()) {
      this.state.lastClockRenderTick = 0;
      this.state.discardDebugMessage = this.gameSocket?.connected ? "サーバーの時間切れ処理を待っています..." : "接続が切れています。再接続後に手番を再開します。";
      this.onStateChanged(this.state);
      const nowMs = Date.now();
      if (!this.clockExpiredResyncAt || nowMs - this.clockExpiredResyncAt >= 2000) {
        this.clockExpiredResyncAt = nowMs;
        this.resyncSocketGameState(this.gameSocket?.connected ? "clockExpiredAwaitingServer" : "clockExpiredWhileDisconnected").catch(() => {});
      }
      return;
    }
    if (this.state.pendingAction) {
      this.skipPendingAction();
      return;
    }
    const tile = player.drawnTile ?? player.hand.at(-1);
    if (tile) this.handleDiscardTileClick(tile.id);
  }
  monitorDiscardRecover() {
    if (this.state.screen !== "game" || this.state.handLog?.result) {
      this.discardBlockedSince = null;
      return;
    }
    const viewerId = getLocalHumanPlayerId(this.state);
    const current = getCurrentPlayer(this.state);
    const phaseLooksDiscardable = ["waitingForHumanDiscard", "waitingForRiichiDiscard", "playing"].includes(this.state.phase);
    const tileCount = current ? (current.hand?.length ?? 0) + (current.drawnTile ? 1 : 0) : 0;
    const looksLikeMyDiscardTurn = Boolean(current && viewerId && current.id === viewerId && current.type !== "cpu" && phaseLooksDiscardable && tileCount >= expectedDiscardTileCount(current));
    if (!looksLikeMyDiscardTurn) {
      this.discardBlockedSince = null;
      return;
    }
    const status = getDiscardStatus(this.state, viewerId, current.drawnTile?.id ?? current.hand?.at(-1)?.id ?? null);
    if (status.can) {
      this.discardBlockedSince = null;
      if (this.state.discardRecoveryVisible) {
        this.state.discardRecoveryVisible = false;
        this.state.discardDebugMessage = "";
        this.onStateChanged(this.state);
      }
      return;
    }
    this.discardBlockedSince ??= Date.now();
    const elapsed = Date.now() - this.discardBlockedSince;
    if (elapsed >= 2000 && !this.discardAutoResyncInFlight) {
      this.discardAutoResyncInFlight = true;
      console.warn("[DiscardAction] force resync", { reason: status.reason, elapsed });
      this.resyncSocketGameState("discardAutoRecover").finally(() => {
        this.discardAutoResyncInFlight = false;
      });
    }
    if (elapsed >= 5000 && !this.state.discardRecoveryVisible) {
      this.state.discardRecoveryVisible = true;
      this.state.discardDebugMessage = `打牌状態の同期が崩れています: ${status.reason}`;
      this.onStateChanged(this.state);
    }
  }
  monitorEarlyTurnStall() {
    if (!isSocketAuthoritativeGame()) return;
    if (this.state.screen !== "game" || this.state.handLog?.result) return;
    if (this.state.optimisticDiscardRequestId) return;
    const socket = globalThis.anmikaGameSocket;
    if (!socket?.connected) return;
    const phase = this.state.phase || "";
    if (!["playing", "waitingForHumanDiscard", "waitingForRiichiDiscard", "waitingForAction"].includes(phase)) return;
    const turnIndex = Number(this.state.turnIndex || 0);
    if (turnIndex > SOCKET_EARLY_TURN_WATCH_TURNS) return;
    const nowMs = Date.now();
    const lastApplied = Number(this.lastOnlineStateAppliedAt || this.state.onlineMeta?.publishedAt || 0);
    if (lastApplied && nowMs - lastApplied < SOCKET_EARLY_TURN_WATCH_IDLE_MS) return;
    if (nowMs - Number(this.lastEarlyTurnWatchResyncAt || 0) < SOCKET_EARLY_TURN_WATCH_RESYNC_MS) return;
    const current = getCurrentPlayer(this.state);
    const viewerId = getLocalHumanPlayerId(this.state);
    const watchKey = `${this.state.handLog?.handId || ""}:${turnIndex}:${this.state.currentPlayerIndex || 0}:${phase}:${current?.id || ""}`;
    if (this.earlyTurnWatchInFlight && this.lastEarlyTurnWatchKey === watchKey) return;
    this.earlyTurnWatchInFlight = true;
    this.lastEarlyTurnWatchResyncAt = nowMs;
    this.lastEarlyTurnWatchKey = watchKey;
    this.resyncSocketGameState(`earlyTurnStall:${turnIndex}:${current?.id || "none"}:${viewerId || "none"}`).finally(() => {
      this.earlyTurnWatchInFlight = false;
    });
  }
  monitorSocketStateStall() {
    if (!isSocketAuthoritativeGame()) return;
    if (this.state.screen !== "game") return;
    const socket = globalThis.anmikaGameSocket;
    if (!socket?.connected) return;
    if (this.socketStateStallInFlight) return;
    if (["auth", "onlineLoading"].includes(this.state.phase)) return;
    const nowMs = Date.now();
    const lastApplied = Number(this.lastOnlineStateAppliedAt || this.state.onlineMeta?.publishedAt || 0);
    if (!lastApplied || nowMs - lastApplied < SOCKET_STATE_STALL_IDLE_MS) return;
    if (nowMs - Number(this.lastSocketStateStallResyncAt || 0) < SOCKET_STATE_STALL_RESYNC_MS) return;
    this.lastSocketStateStallResyncAt = nowMs;
    this.socketStateStallInFlight = true;
    this.resyncSocketGameState(`stateStall:${this.state.phase || ""}:${this.state.version ?? 0}:${this.state.turnIndex ?? 0}`)
      .finally(() => {
        this.socketStateStallInFlight = false;
      });
  }
  tickResultCountdown() {
    if (!this.state.handLog.result) return;
    const resultId = getCurrentResultId(this.state);
    if (this.state.resultCountdownResultId !== resultId) {
      this.state.resultCountdownStartedAt = Date.now();
      this.state.resultCountdownResultId = resultId;
      this.state.resultAutoCloseHandled = false;
      this.state.resultAutoCloseHandledResultId = "";
      this.state.resultOkSubmitted = false;
      this.state.resultOkSubmittedAt = null;
      this.state.resultOkSubmittedResultId = "";
    }
    this.state.resultCountdownStartedAt ??= Date.now();
    this.state.resultCountdownSeconds ??= RESULT_COUNTDOWN_SECONDS;
    const nextSeconds = Math.max(0, RESULT_COUNTDOWN_SECONDS - Math.floor((Date.now() - this.state.resultCountdownStartedAt) / 1000));
    if (nextSeconds !== this.state.resultCountdownSeconds) {
      this.state.resultCountdownSeconds = nextSeconds;
      this.onStateChanged(this.state);
    }
    const canRetrySubmittedOk = Boolean(
      isSocketAuthoritativeGame() &&
      this.state.resultOkSubmitted &&
      !hasLocalPlayerConfirmedResult(this.state) &&
      Date.now() - Number(this.state.resultOkSubmittedAt || 0) > 3500
    );
    const alreadyAutoHandled = this.state.resultAutoCloseHandledResultId === resultId;
    if (isTsumoLosslessAgariYameOpportunity(this.state)) return;
    if (nextSeconds <= 0 && !alreadyAutoHandled && (isSocketAuthoritativeGame() || !this.state.resultAutoCloseHandled || canRetrySubmittedOk)) {
      if (canRetrySubmittedOk) {
        this.state.resultOkSubmitted = false;
        this.state.resultOkSubmittedResultId = "";
        this.state.resultAutoCloseHandled = false;
      }
      this.state.resultAutoCloseHandled = true;
      this.state.resultAutoCloseHandledResultId = resultId;
      this.handleResultOk({ autoAllResultOk: true });
    }
  }
  handleContextMenuAction(viewerPlayerId = getLocalHumanPlayerId(this.state)) {
    if (this.state.screen === "replayViewer") return false;
    if (!viewerPlayerId) return false;
    if (this.state.pendingAction?.playerId === viewerPlayerId) {
      this.skipPendingAction();
      return true;
    }
    return this.handleTsumogiriShortcut(viewerPlayerId);
  }
  refreshStoredData() {
    this.state.currentUser = authRepository.getCurrentUser();
    this.state.tables = loadTables();
    this.state.clubs = loadClubs();
    this.state.clubMemberPoints = loadClubMemberPoints();
    this.state.replaySummaries = replayRepository.listReplays();
  }
  loginDebug() {
    if (!DEBUG_AUTH_ENABLED) return;
    this.state.currentUser = authRepository.loginDebug();
    this.refreshStoredData();
    this.state.screen = "clubSelect";
    this.emit();
  }
  loginWithPassword(userId, password) {
    const user = authRepository.login({ userId, password });
    if (!user) {
      this.state.log.unshift("ログインに失敗しました");
      this.emit();
      return;
    }
    this.state.currentUser = user;
    this.refreshStoredData();
    this.state.screen = "clubSelect";
    this.emit();
  }
  createAccount(displayName = "プレイヤー1", password = "password") {
    this.state.currentUser = authRepository.createAccount({ displayName, password });
    this.refreshStoredData();
    this.state.screen = "clubSelect";
    this.emit();
  }
  updateAccountSettings({ displayName, password, iconUrl } = {}) {
    if (!this.state.currentUser) return;
    let user = this.state.currentUser;
    if (displayName) user = authRepository.updateUser(user.id, { displayName }) ?? user;
    if (iconUrl) user = authRepository.updateUser(user.id, { iconUrl }) ?? user;
    if (password) user = authRepository.changePassword(user.id, password) ?? user;
    this.state.currentUser = user;
    this.refreshStoredData();
    this.emit();
  }
  async copyText(text, successMessage = "コピーしました") {
    const copied = await copyTextToClipboard(text);
    const message = copied ? successMessage : `コピーできませんでした: ${text ?? ""}`;
    this.state.toastMessage = message;
    this.state.log.unshift(message);
    this.emit();
  }
  openLogoutConfirm() {
    this.state.logoutConfirmOpen = true;
    this.emit();
  }
  closeLogoutConfirm() {
    this.state.logoutConfirmOpen = false;
    this.emit();
  }
  confirmLogout() {
    this.state.logoutConfirmOpen = false;
    this.logout();
  }
  logout() {
    authRepository.logout();
    this.state.currentUser = null;
    this.state.selectedClubId = null;
    this.state.logoutConfirmOpen = false;
    this.state.screen = "auth";
    this.emit();
  }
  navigate(screen) {
    if (this.replayAutoListTimer) {
      clearTimeout(this.replayAutoListTimer);
      this.replayAutoListTimer = null;
    }
    if (screen === "replayList") {
      const clubId = this.state.selectedClubId || this.state.activeClubId || localStorage.getItem(ONLINE_DEBUG_RETURN_CLUB_KEY) || "";
      goToOnlineDebugReplayList(clubId, true);
      return;
    }
    this.refreshStoredData();
    if (!this.state.currentUser && screen !== "auth" && screen !== "replayViewer") screen = "auth";
    this.state.screen = screen;
    if (screen !== "replayViewer" && (globalThis.location?.hash?.startsWith("#/replay/") || /\/replay\/[^/]+$/.test(globalThis.location?.pathname ?? ""))) {
      const target = onlineDebugReplayListUrl(this.state.selectedClubId || this.state.activeClubId || "");
      try { globalThis.history?.replaceState?.(null, "", target); } catch {}
    }
    if (screen !== "game") this.state.phase = this.state.phase === "playing" ? this.state.phase : this.state.phase;
    this.emit();
  }
  async refreshReplaysFromSupabase({ replayId = "" } = {}) {
    const rows = await fetchSupabaseReplayRows({ replayId });
    const replays = rows.map(replayFromSupabaseRow);
    this.state.replaySummaries = mergeReplaysIntoLocalStore(replays);
    this.emit();
    return replays;
  }
  selectClubHome(clubId) {
    const club = clubRepository.getClub(clubId);
    if (!club || !this.state.currentUser || !isClubMember(this.state.currentUser.id, club)) return;
    this.state.selectedClubId = clubId;
    this.state.screen = "clubHome";
    this.refreshStoredData();
    this.emit();
  }
  createClub(name = "マイクラブ") {
    if (!this.state.currentUser) return;
    const club = clubRepository.createClub({ name, ownerUserId: this.state.currentUser.id });
    if (!club) {
      this.state.log.unshift("クラブ作成は1アカウントにつき1つまでです");
      this.emit();
      return;
    }
    this.state.selectedClubId = club.id;
    this.refreshStoredData();
    this.state.screen = "clubHome";
    this.emit();
  }
  openCreateTable() {
    const club = clubRepository.getClub(this.state.selectedClubId);
    if (!club || !this.state.currentUser || !canCreateTable(this.state.currentUser.id, club)) return;
    if (tableRepository.listTablesByClub(club.id).length >= 100) {
      this.state.log.unshift("卓の最大保持数は100卓です");
      this.emit();
      return;
    }
    this.state.createTableSettings = createDefaultTableSettings();
    this.state.screen = "createTable";
    this.emit();
  }
  updateCreateTableSettings(partial) {
    const current = this.state.createTableSettings ?? createDefaultTableSettings();
    const nextRuleId = partial.ruleId ?? current.ruleId ?? "anmika-rocket";
    this.state.createTableSettings = {
      ...current,
      ...partial,
      gameType: partial.gameType ?? partial.ruleId ?? current.gameType ?? nextRuleId,
      ruleConfig: normalizeRuleConfigForRule(nextRuleId, { ...(current.ruleConfig ?? {}), ...(partial.ruleConfig ?? {}) }),
    };
    this.emit();
  }
  createClubTableFromSettings() {
    const club = clubRepository.getClub(this.state.selectedClubId);
    if (!club || !this.state.currentUser || !canCreateTable(this.state.currentUser.id, club)) return;
    const settings = this.state.createTableSettings ?? createDefaultTableSettings();
    const table = createTableRoom({
      name: `${club.name} 卓 ${tableRepository.listTablesByClub(club.id).length + 1}`,
      clubId: club.id,
      ruleId: settings.ruleId,
      gameType: settings.gameType ?? settings.ruleId,
      rakePercent: settings.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? 0 : Math.max(0, Math.min(10, Number(settings.rakePercent) || 0)),
      pointRate: Math.max(0.1, Math.min(10, Number(settings.pointRate) || 1)),
      ruleConfig: normalizeRuleConfigForRule(settings.ruleId, settings.ruleConfig),
      createdBy: this.state.currentUser.id,
    });
    this.syncTable(table);
    this.state.screen = "clubTables";
    this.emit();
  }
  syncTable(table) {
    tableRepository.saveTable(table);
    this.state.tables = loadTables();
    return table;
  }
  createFreeTable() {
    const club = this.state.currentUser ? clubRepository.listMyClubs(this.state.currentUser.id)[0] : null;
    if (!club) {
      this.state.log.unshift("卓作成にはクラブ所属が必要です");
      this.state.screen = "clubSelect";
      this.emit();
      return;
    }
    this.state.selectedClubId = club.id;
    this.openCreateTable();
  }
  createClubTable(clubId) {
    const club = clubRepository.getClub(clubId);
    if (!club || !this.state.currentUser || !canCreateTable(this.state.currentUser.id, club)) {
      this.state.log.unshift("管理者だけがクラブ卓を作成できます");
      this.emit();
      return;
    }
    this.state.selectedClubId = clubId;
    this.openCreateTable();
  }
  selectTable(tableId) {
    const table = loadTables().find((item) => item.id === tableId);
    if (!table) {
      if (isOnlineDebugLocalTableId(tableId)) {
        renderStartupFallback(`対局開始用の卓データが見つかりません: ${tableId || "未指定"}`);
        return;
      }
      this.refreshStoredData();
      this.state.screen = "tableRoom";
      this.state.selectedTableId = tableId;
      this.state.log.unshift("卓が見つかりません");
      this.emit();
      return;
    }
    const club = table?.clubId ? clubRepository.getClub(table.clubId) : null;
    if (club && this.state.currentUser && !isClubMember(this.state.currentUser.id, club)) {
      this.state.log.unshift("この卓に参加する権限がありません");
      this.emit();
      return;
    }
    this.state.selectedTableId = tableId;
    if (table?.clubId) this.state.selectedClubId = table.clubId;
    if (table.status === "playing") {
      this.startGameForTable(tableId);
      return;
    }
    if (isOnlineDebugLocalTableId(tableId)) {
      renderStartupFallback("この卓はまだ対局中ではありません。卓一覧に戻って、対局開始ボタンから開始してください。");
      return;
    }
    this.state.screen = "tableRoom";
    this.emit();
  }
  getSelectedTable() {
    return this.state.tables.find((table) => table.id === this.state.selectedTableId);
  }
  joinSeat(tableId, seatIndex, playerId = this.currentUserId()) {
    const table = loadTables().find((item) => item.id === tableId);
    const club = table?.clubId ? clubRepository.getClub(table.clubId) : null;
    if (club && this.state.currentUser && !isClubMember(this.state.currentUser.id, club)) {
      this.state.log.unshift("この卓に参加する権限がありません");
      this.emit();
      return;
    }
    if (!canSitAtTable(table, playerId)) return;
    const seat = table.seats.find((item) => item.seatIndex === Number(seatIndex));
    if (!seat || (seat.playerId && !isCpuPlayerId(seat.playerId) && seat.playerId !== playerId)) return;
    if (table.status === "ended") table.status = "waiting";
    table.waitingList = (table.waitingList ?? []).filter((id) => id !== playerId);
    table.participants = (table.participants ?? []).filter((id) => id !== playerId);
    table.joinedUsers = (table.joinedUsers ?? []).filter((id) => id !== playerId);
    for (const otherSeat of table.seats) {
      if (otherSeat.playerId === playerId) Object.assign(otherSeat, { playerId: undefined, playerType: undefined, isOccupied: false, isReady: false, isLastHandDeclared: false });
    }
    Object.assign(seat, { playerId, playerType: isCpuPlayerId(playerId) ? "cpu" : "human", isOccupied: true, isReady: true });
    table.participants = [...new Set([...(table.participants ?? []), playerId])];
    this.autoSeatWaitingPlayers(table);
    this.syncTable(table);
    this.maybeStartTable(table.id);
  }
  fillTableWithCpu(tableId) {
    const table = loadTables().find((item) => item.id === tableId);
    if (!table || table.status !== "waiting") return;
    let cpuNumber = 1;
    for (const seat of table.seats) {
      if (!seat.playerId) {
        while (table.seats.some((item) => item.playerId === `cpu${cpuNumber}`)) cpuNumber++;
        Object.assign(seat, { playerId: `cpu${cpuNumber}`, playerType: "cpu", isOccupied: true, isReady: true });
      }
    }
    this.syncTable(table);
    this.maybeStartTable(table.id);
  }
  maybeStartTable(tableId) {
    const table = loadTables().find((item) => item.id === tableId);
    if (!table) return;
    const allSeatsFilled = table.seats.every((seat) => seat.playerId);
    const allRealPlayers = tableHasOnlyRealPlayers(table);
    if (allSeatsFilled && (allRealPlayers || table.seats.some((seat) => isCpuPlayerId(seat.playerId)))) {
      table.isDebugCpuTable = !allRealPlayers;
      table.status = "playing";
      this.syncTable(table);
      this.startGameForTable(table.id);
    } else {
      this.emit();
    }
  }
  startGameForTable(tableId) {
    try {
      const table = loadTables().find((item) => item.id === tableId);
      if (!table) {
        renderStartupFallback(`卓データが見つかりません: ${tableId || "未指定"}`);
        return;
      }
      const currentUserId = this.currentUserId();
      const rawSeats = Array.isArray(table.seats) ? table.seats : [];
      const normalizedSeats = [0, 1, 2].map((index) => {
        const source = rawSeats[index] ?? {};
        const playerId = source.playerId || source.userId || (index === 0 ? currentUserId : `cpu${index}`);
        return {
          ...source,
          seatIndex: source.seatIndex ?? index,
          playerId,
          playerType: source.playerType || (isCpuPlayerId(playerId) ? "cpu" : "human"),
          isOccupied: Boolean(playerId),
          isReady: true,
          isLastHandDeclared: Boolean(source.isLastHandDeclared),
        };
      });
      table.seats = normalizedSeats;
      while (this.state.players.length < 3) {
        const index = this.state.players.length;
        this.state.players.push(createPlayer(`cpu${index}`, `CPU${index}`, "cpu"));
      }
      this.state.players = this.state.players.slice(0, 3);
      this.state.activeTableId = tableId;
      this.state.activeClubId = table.clubId ?? null;
      this.state.selectedTableId = tableId;
      this.state.selectedClubId = table.clubId ?? this.state.selectedClubId;
      this.state.screen = "game";
      this.state.settings.isLastHand = normalizedSeats.some((seat) => seat.isLastHandDeclared);
      this.state.settings.rakePercent = table.rakePercent ?? 0;
      this.state.settings.pointRate = table.pointRate ?? 1;
      this.state.settings.ruleId = table.ruleId ?? "anmika-rocket";
      this.state.settings.gameType = table.gameType ?? table.ruleId ?? "anmika-rocket";
      this.state.settings.ruleConfig = normalizeRuleConfigForRule(this.state.settings.ruleId, table.ruleConfig);
      this.state.settings.baibaMultiplier = 1;
      for (const [index, seat] of normalizedSeats.entries()) {
        const player = this.state.players[index] ?? createPlayer(`cpu${index}`, `CPU${index}`, "cpu");
        this.state.players[index] = player;
        player.id = seat.playerId ?? `cpu${index}`;
        player.name = getPlayerNameById(player.id) || seat.displayName || (isCpuPlayerId(player.id) ? `CPU${index}` : "プレイヤー");
        player.type = isCpuPlayerId(player.id) || seat.playerType === "cpu" ? "cpu" : player.id === currentUserId ? "human" : "remote";
      }
      this.onlineInitialPublisher = normalizedSeats[0]?.playerId === currentUserId;
      let sync = loadOnlineSync();
      if ((!sync?.enabled || !sync?.gameId) && isOnlineDebugLocalTableId(tableId)) {
        const sourceTableId = table.sourceTableId || table.remoteTableId || sourceTableIdFromLocalDebugId(tableId);
        sync = {
          enabled: true,
          transport: "socketio",
          tableId: sourceTableId,
          localTableId: tableId,
          gameId: `socket-game-${sourceTableId}`,
          version: 0,
          userId: currentUserId,
          socketUrl: defaultGameServerUrl(),
          returnUrl: onlineDebugLobbyUrl(this.state.activeClubId || this.state.selectedClubId || ""),
        };
        saveOnlineSync(sync);
      }
      if (isOnlineDebugLocalTableId(tableId) && (!sync?.enabled || sync.transport !== "socketio" || !sync.tableId || !sync.gameId)) {
        this.state.phase = "onlineLoading";
        this.setOnlineLoadingMessage("Socket.IO対局情報が見つかりません。卓一覧からもう一度この卓の対局を開始してください。");
        this.state.isWaitingForHumanAction = false;
        this.onStateChanged(this.state);
        return;
      }
      const syncMatchesTable = sync?.tableId === tableId || sync?.localTableId === tableId;
      if (sync?.enabled && sync.gameId && syncMatchesTable && sync.transport === "socketio") {
        if (sync.localTableId !== tableId) {
          sync = { ...sync, localTableId: tableId };
          saveOnlineSync(sync);
        }
        this.state.phase = "onlineLoading";
        this.setOnlineLoadingMessage("ゲームサーバーへ接続中...");
        this.state.isWaitingForHumanAction = false;
        this.onStateChanged(this.state);
        this.connectSocketGameServer().catch((error) => {
          console.warn("[SocketGame] 接続に失敗しました", error);
          const message = error?.message ?? String(error);
          this.setOnlineLoadingMessage(isSocketDisconnectedAckError(error)
            ? `ゲームサーバーへ再接続中... ${message}`
            : `ゲームサーバーへ接続できません: ${message}`);
          this.onStateChanged(this.state);
          if (isSocketDisconnectedAckError(error)) {
            this.socketInitialConnectRetryCount = (this.socketInitialConnectRetryCount || 0) + 1;
            this.gameSocket?.connect?.();
          }
        });
        return;
      }
      if (isOnlineDebugLocalTableId(tableId)) {
        this.state.phase = "onlineLoading";
        this.setOnlineLoadingMessage("Socket.IO対局の卓IDが一致しません。卓一覧からもう一度この卓の対局を開始してください。");
        this.state.isWaitingForHumanAction = false;
        this.onStateChanged(this.state);
        return;
      }
      if (sync?.enabled && sync.gameId && syncMatchesTable) {
        this.state.phase = "onlineLoading";
        this.setOnlineLoadingMessage("オンライン局面を同期中...");
        this.state.isWaitingForHumanAction = false;
        this.onStateChanged(this.state);
        this.startOnlineStateSync();
        refreshOnlineSyncFromServer()
          .then((row) => {
            const latest = loadOnlineSync();
            const serverState = row?.state ?? latest?.lastServerState;
            if (isUsableOnlineGameState(serverState)) {
              if (this.applyOnlineStateSnapshot(serverState)) {
                this.lastAppliedOnlinePublishedAt = Number(serverState?.onlineMeta?.publishedAt ?? Date.now());
              }
              return;
            }
            if (!this.onlineInitialPublisher) {
              this.setOnlineLoadingMessage("親プレイヤーの初期局面を待っています...");
              this.onStateChanged(this.state);
              return;
            }
            this.startGame();
            this.scheduleOnlineStatePublish("start");
          })
          .catch((error) => {
            console.warn("[OnlineSync] 初期局面の取得に失敗しました", error);
            if (!this.onlineInitialPublisher) {
              this.setOnlineLoadingMessage(`オンライン局面の取得に失敗しました: ${error?.message ?? error}`);
              this.onStateChanged(this.state);
              return;
            }
            this.startGame();
            this.scheduleOnlineStatePublish("start");
          });
        return;
      }
      if (isOnlineDebugLocalTableId(tableId)) {
        this.state.phase = "onlineLoading";
        this.setOnlineLoadingMessage("オンラインデバッグ卓ではローカル新規配牌を行いません。Socket.IOゲームサーバーを起動してください。");
        this.state.isWaitingForHumanAction = false;
        this.onStateChanged(this.state);
        return;
      }
      this.startGame();
    } catch (error) {
      console.error("[Startup] 対局開始に失敗しました", error);
      renderStartupFallback(error?.message || String(error));
    }
  }
  applyOnlineStateSnapshot(snapshot) {
    if (!snapshot || this.isApplyingOnlineState) return false;
    const sync = loadOnlineSync();
    const currentUserId = snapshot.onlineMeta?.viewForPlayerId || sync?.userId || this.currentUserId();
    const next = JSON.parse(JSON.stringify(snapshot));
    if (this.state.optimisticDiscardRequestId) {
      const meta = next.onlineMeta || {};
      const incomingVersion = Number(next.version || 0);
      const currentVersion = Number(sync?.version || this.state.version || 0);
      const isOwnDiscardAck = ["discard", "riichi"].includes(meta.reason) &&
        meta.publishedBy === currentUserId &&
        incomingVersion > currentVersion;
      const isAuthoritativeProgress = incomingVersion > currentVersion;
      if (!isOwnDiscardAck && !isAuthoritativeProgress) {
        console.warn("[DiscardAction] ignored stale state during optimistic discard", {
          requestId: this.state.optimisticDiscardRequestId,
          incomingVersion: next.version,
          currentVersion: sync?.version ?? this.state.version ?? 0,
          reason: meta.reason || "",
          publishedBy: meta.publishedBy || "",
        });
        return false;
      }
    }
    next.players = (next.players ?? []).map((player) => ({
      ...player,
      type: isCpuPlayerId(player.id) || player.type === "cpu" ? "cpu" : player.id === currentUserId ? "human" : "remote",
    }));
    const previousResultKey = this.state.handLog?.result
      ? JSON.stringify({
        resultId: this.state.handLog.result.resultId,
        type: this.state.handLog.result.type,
        winnerId: this.state.handLog.result.winnerId,
        reason: this.state.handLog.result.reason,
        turnIndex: this.state.turnIndex,
      })
      : "";
    const nextResultKey = next.handLog?.result
      ? JSON.stringify({
        resultId: next.handLog.result.resultId,
        type: next.handLog.result.type,
        winnerId: next.handLog.result.winnerId,
        reason: next.handLog.result.reason,
        turnIndex: next.turnIndex,
      })
      : "";
    for (const nextPlayer of next.players ?? []) {
      const previousPlayer = this.state.players?.find?.((player) => player.id === nextPlayer.id);
      const previousDiscards = previousPlayer?.discardedTiles ?? [];
      const nextDiscards = nextPlayer.discardedTiles ?? [];
      if (nextDiscards.length > previousDiscards.length) {
        for (let index = previousDiscards.length; index < nextDiscards.length; index++) {
          const discard = nextDiscards[index];
          playGameSound("discard", { key: `discard:${nextPlayer.id}:${index}:${discard?.turnIndex ?? ""}:${discard?.tile?.id || ""}` });
        }
      }
    }
    const latestEvent = next.handLog?.events?.at?.(-1);
    if (latestEvent?.type === "riichi") {
      const announcementKey = `riichi:${latestEvent.playerId}:${latestEvent.turnIndex}:${latestEvent.feverRiichiActive ? "fever" : "normal"}`;
      if (announcementKey !== this.lastDisplayedAnnouncementKey) {
        this.lastDisplayedAnnouncementKey = announcementKey;
        next.serverAnnouncement = {
          text: latestEvent.feverRiichiActive ? "🔥フィーバーリーチ🔥" : "リーチ",
          kind: latestEvent.feverRiichiActive ? "fever-riichi" : "riichi",
          playerId: latestEvent.playerId || "",
        };
        playGameSound(latestEvent.feverRiichiActive ? "feverRiichi" : "riichi", { key: `riichi:${latestEvent.playerId}:${latestEvent.turnIndex}:${latestEvent.feverRiichiActive ? "fever" : "normal"}` });
        if (this.announcementClearTimer) clearTimeout(this.announcementClearTimer);
        this.announcementClearTimer = setTimeout(() => {
          if (this.state.serverAnnouncement?.kind === next.serverAnnouncement.kind) {
            this.state.serverAnnouncement = null;
            this.emit();
          }
        }, latestEvent.feverRiichiActive ? 2400 : 1500);
      }
    }
    const announcementKind = next.phase === "showingWinAnnouncement"
      ? (next.serverAnnouncement?.kind || (next.winAnnouncement === "ツモ" ? "tsumo" : next.winAnnouncement === "ロン" ? "ron" : ""))
      : "";
    const winSoundType = soundTypeForWinAnnouncementKind(announcementKind);
    if (winSoundType) {
      if (!this.playResultSoundOnce(next, "announcement")) {
        playGameSound(winSoundType, {
          key: `win:${next.handLog?.result?.resultId || next.turnIndex || ""}:${announcementKind}`,
        });
      }
    }
    this.showLatestCallAnnouncement(next.handLog?.events?.slice?.(-8) ?? [], { targetState: next });
    if (next.handLog?.result && next.phase !== "showingWinAnnouncement" && nextResultKey && nextResultKey !== this.lastDisplayedResultKey) {
      this.playResultSoundOnce(next, "snapshot");
      this.lastDisplayedResultKey = nextResultKey;
      next.resultCountdownStartedAt = Number(next.resultCountdownStartedAt || 0) || Date.now();
      next.resultCountdownResultId = getCurrentResultId(next);
      next.resultCountdownSeconds = Number(next.resultCountdownSeconds || 0) || RESULT_COUNTDOWN_SECONDS;
      next.resultAutoCloseHandled = false;
      next.resultAutoCloseHandledResultId = "";
      next.resultOkSubmitted = false;
      next.resultOkSubmittedAt = null;
      next.resultOkSubmittedResultId = "";
    }
    if (!next.handLog?.result) {
      this.lastDisplayedResultKey = "";
      this.lastPlayedResultSoundKey = "";
      next.resultCountdownResultId = "";
      next.resultAutoCloseHandledResultId = "";
    }
    if (!next.handLog?.result && next.phase !== "showingWinAnnouncement" && Number(next.turnIndex || 0) <= 1) {
      this.showBaibaStartAnnouncement(next);
    }
    if (next.activeClockPlayerId && next.activeClockPlayerId === currentUserId) {
      next.playerClocks ??= this.state.playerClocks ?? createPlayerClocks(next.players, next.settings?.initialClockMs ?? INITIAL_TIME_MS);
      next.playerClocks[currentUserId] ??= { playerId: currentUserId, remainingMs: next.settings?.initialClockMs ?? INITIAL_TIME_MS, isInByoyomi: false };
      next.playerClocks[currentUserId].remainingMs = next.playerClocks[currentUserId].remainingMs ?? next.settings?.initialClockMs ?? INITIAL_TIME_MS;
      next.clockStartedAt = Date.now();
    }
    next.currentUser = this.state.currentUser;
    next.screen = "game";
    if (this.onlineLoadingRevealTimer) {
      clearTimeout(this.onlineLoadingRevealTimer);
      this.onlineLoadingRevealTimer = null;
    }
    next.onlineLoadingMessage = "";
    next.onlineLoadingMessageStartedAt = 0;
    next.onlineLoadingVisible = false;
    next.activeTableId = this.state.activeTableId || next.activeTableId;
    next.activeClubId = this.state.activeClubId || next.activeClubId;
    next.selectedClubId = this.state.selectedClubId || next.selectedClubId;
    next.replayInitialState = this.state.replayInitialState;
    next.replaySnapshots = this.state.replaySnapshots;
    next.lastSavedReplayId = this.state.lastSavedReplayId;
    next.discardDebugMessage = "";
    this.clearOptimisticDiscard();
    this.isApplyingOnlineState = true;
    this.state = { ...this.state, ...next };
    this.isApplyingOnlineState = false;
    this.lastOnlineStateAppliedAt = Date.now();
    this.lastEarlyTurnWatchKey = `${this.state.handLog?.handId || ""}:${this.state.turnIndex || 0}:${this.state.currentPlayerIndex || 0}:${this.state.phase || ""}:${getCurrentPlayer(this.state)?.id || ""}`;
    if (this.state.phase === "showingFlowerAnnouncement" && isSocketAuthoritativeGame()) {
      if (this.flowerAnnouncementWatchdog) clearTimeout(this.flowerAnnouncementWatchdog);
      const effectId = `${this.state.pendingServerEffect?.playerId || ""}:${this.state.pendingServerEffect?.tileId || ""}:${this.state.turnIndex || 0}`;
      this.flowerAnnouncementWatchdog = setTimeout(() => {
        if (this.state.phase !== "showingFlowerAnnouncement") return;
        const currentEffectId = `${this.state.pendingServerEffect?.playerId || ""}:${this.state.pendingServerEffect?.tileId || ""}:${this.state.turnIndex || 0}`;
        if (currentEffectId !== effectId) return;
        this.resyncSocketGameState("flowerAnnouncementWatchdog").catch(() => {});
      }, 1800);
    } else if (this.flowerAnnouncementWatchdog) {
      clearTimeout(this.flowerAnnouncementWatchdog);
      this.flowerAnnouncementWatchdog = null;
    }
    if (this.state.phase === "showingCallAnnouncement" && isSocketAuthoritativeGame()) {
      if (this.callAnnouncementWatchdog) clearTimeout(this.callAnnouncementWatchdog);
      const effectId = `${this.state.pendingServerEffect?.type || ""}:${this.state.pendingServerEffect?.playerId || ""}:${this.state.pendingServerEffect?.fromPlayerId || ""}:${this.state.pendingServerEffect?.sourceTile?.id || ""}:${this.state.turnIndex || 0}`;
      this.callAnnouncementWatchdog = setTimeout(() => {
        if (this.state.phase !== "showingCallAnnouncement") return;
        const currentEffectId = `${this.state.pendingServerEffect?.type || ""}:${this.state.pendingServerEffect?.playerId || ""}:${this.state.pendingServerEffect?.fromPlayerId || ""}:${this.state.pendingServerEffect?.sourceTile?.id || ""}:${this.state.turnIndex || 0}`;
        if (currentEffectId !== effectId) return;
        this.resyncSocketGameState("callAnnouncementWatchdog").catch(() => {});
      }, 1800);
    } else if (this.callAnnouncementWatchdog) {
      clearTimeout(this.callAnnouncementWatchdog);
      this.callAnnouncementWatchdog = null;
    }
    if (this.state.phase === "showingWinAnnouncement" && isSocketAuthoritativeGame()) {
      if (this.winAnnouncementWatchdog) clearTimeout(this.winAnnouncementWatchdog);
      const effectId = `${this.state.pendingServerEffect?.type || ""}:${this.state.turnIndex || 0}:${this.state.handLog?.result?.resultId || ""}`;
      this.winAnnouncementWatchdog = setTimeout(() => {
        if (this.state.phase !== "showingWinAnnouncement") return;
        const currentEffectId = `${this.state.pendingServerEffect?.type || ""}:${this.state.turnIndex || 0}:${this.state.handLog?.result?.resultId || ""}`;
        if (currentEffectId !== effectId) return;
        this.resyncSocketGameState("winAnnouncementWatchdog").catch(() => {});
      }, 2600);
    } else if (this.winAnnouncementWatchdog) {
      clearTimeout(this.winAnnouncementWatchdog);
      this.winAnnouncementWatchdog = null;
    }
    if (next.handLog?.result && nextResultKey !== previousResultKey) {
      this.saveReplayForCurrentHand();
    }
    if (shouldLeaveOnlineTableAfterGameEnded(this.state, sync) && !this.onlineGameEndedReturnScheduled) {
      this.onlineGameEndedReturnScheduled = true;
      setTimeout(async () => {
        try {
          const activeTableId = this.state.activeTableId;
          const leavePlayerId = sync?.userId || getLocalHumanPlayerId(this.state);
          await leaveOnlineTableForSync(sync);
          if (activeTableId && leavePlayerId) this.leaveSeat(activeTableId, leavePlayerId);
          forgetOnlineDebugLaunchCache(sync, activeTableId);
          saveOnlineSync(null);
          if (sync.returnUrl) {
            window.location.href = normalizeOnlineDebugReturnUrl(sync.returnUrl, localStorage.getItem(ONLINE_DEBUG_RETURN_CLUB_KEY) || this.state.activeClubId || this.state.selectedClubId || "", sync.tableId || activeTableId);
          } else {
            this.state.screen = "clubLobby";
            this.emit();
          }
        } catch (error) {
          console.warn("[SocketGame] game ended return failed", error);
        }
      }, 400);
    }
    const humanPlayer = this.state.players.find((player) => player.type === "human");
    const current = getCurrentPlayer(this.state);
    const clockOwnerId = this.state.pendingAction?.playerId || current?.id || this.state.activeClockPlayerId;
    const shouldRunClock = Boolean(
      humanPlayer &&
      clockOwnerId === humanPlayer.id &&
      !this.state.handLog?.result &&
      ["playing", "waitingForHumanDiscard", "waitingForAction", "waitingForRiichiDiscard"].includes(this.state.phase)
    );
    if (shouldRunClock) this.startClockForPlayer(humanPlayer.id);
    else if (humanPlayer && this.state.activeClockPlayerId === humanPlayer.id) this.stopClockForPlayer(humanPlayer.id, false);
    if (!this.shouldKeepSocketStartupResync(this.state)) this.clearSocketStartupResyncTimers();
    this.onStateChanged(this.state);
    this.maybeReloadAfterInitialOnlineState("applyOnlineStateSnapshot");
    return true;
  }
  maybeReloadAfterInitialOnlineState(reason = "initialOnlineState") {
    const sync = loadOnlineSync();
    if (!sync?.autoReloadAfterLaunch || sync.transport !== "socketio" || !sync.tableId || !sync.gameId) return false;
    if (this.postLaunchReloadTimer) return true;
    if (this.state.screen !== "game" || this.state.phase === "onlineLoading") return false;
    if (!Array.isArray(this.state.players) || this.state.players.length < 3) return false;
    const reloadKey = String(sync.launchReloadKey || `${sync.tableId}:${sync.gameId}:post-initial-state`);
    const sessionKey = `anmikaRocket.postInitialStateReloaded:${reloadKey}`;
    if (sessionStorage.getItem(sessionKey) === "1") {
      saveOnlineSync({ ...sync, autoReloadAfterLaunch: false });
      return false;
    }
    sessionStorage.setItem(sessionKey, "1");
    saveOnlineSync({ ...sync, autoReloadAfterLaunch: false, postInitialReloadedAt: Date.now(), postInitialReloadReason: reason });
    console.log("[DebugLaunch] 初期局面同期後に一度だけ再読み込みします", {
      reason,
      tableId: sync.tableId,
      gameId: sync.gameId,
      reloadKey,
      phase: this.state.phase,
      version: this.state.version,
      turnIndex: this.state.turnIndex,
    });
    this.postLaunchReloadTimer = setTimeout(() => {
      this.postLaunchReloadTimer = null;
      globalThis.location?.reload?.();
    }, 650);
    return true;
  }
  async connectSocketGameServer() {
    const sync = loadOnlineSync();
    if (!sync?.enabled || sync.transport !== "socketio" || !sync.tableId || !sync.gameId) return;
    const serverUrl = resolveGameServerUrl(sync.socketUrl);
    console.log("[SocketGame] connecting", { serverUrl, tableId: sync.tableId, gameId: sync.gameId, userId: sync.userId, version: sync.version });
    saveSocketDebugStatus({
      socket: "DISCONNECTED",
      gameServer: "NG",
      socketUrl: serverUrl,
      tableId: sync.tableId,
      gameId: sync.gameId,
      userId: sync.userId,
      clientVersion: sync.version ?? 0,
      currentVersion: sync.version ?? 0,
      lastReconnectReason: "connectSocketGameServer",
      lastError: "",
    });
    await loadSocketIoClient(serverUrl);
    if (
      this.gameSocket &&
      this.gameSocket.auth?.tableId === sync.tableId &&
      this.gameSocket.auth?.gameId === sync.gameId &&
      this.gameSocket.auth?.userId === sync.userId
    ) {
      if (!this.gameSocket.connected) {
        saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", socketUrl: serverUrl, lastReconnectReason: "reuseExistingSocket", lastError: "" });
        await waitForSocketConnected(this.gameSocket, SOCKET_CONNECT_TIMEOUT_MS + 15000);
      }
      saveSocketDebugStatus({ socket: "CONNECTED", gameServer: "OK", socketId: this.gameSocket.id, socketUrl: serverUrl, lastReconnectReason: "replaceExistingSocketForFreshJoin", lastError: "" });
      this.gameSocket.off("game:state");
      this.gameSocket.off("game:needInitialState");
      this.gameSocket.off("server:shutdown");
      this.gameSocket.off("connect");
      this.gameSocket.off("disconnect");
      this.gameSocket.off("connect_error");
      this.gameSocket.disconnect();
      this.gameSocket = null;
      globalThis.anmikaGameSocket = null;
    }
    if (this.gameSocket) {
      this.gameSocket.off("game:state");
      this.gameSocket.off("game:needInitialState");
      this.gameSocket.off("server:shutdown");
      this.gameSocket.off("connect");
      this.gameSocket.off("disconnect");
      this.gameSocket.off("connect_error");
      this.gameSocket.disconnect();
    }
    this.socketInitialStateInFlight = false;
    const socket = globalThis.io(serverUrl, {
      transports: ["polling", "websocket"],
      upgrade: true,
      tryAllTransports: true,
      rememberUpgrade: false,
      autoConnect: false,
      closeOnBeforeunload: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: SOCKET_CONNECT_TIMEOUT_MS,
      forceNew: false,
      auth: { userId: sync.userId, tableId: sync.tableId, gameId: sync.gameId },
    });
    this.gameSocket = socket;
    globalThis.anmikaGameSocket = socket;
    socket.io?.on?.("reconnect_attempt", (attempt) => {
      console.warn("[SocketGame] reconnect_attempt", { attempt, tableId: sync.tableId, gameId: sync.gameId, userId: sync.userId, version: loadOnlineSync()?.version ?? sync.version ?? 0 });
      saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", lastReconnectReason: `reconnect_attempt:${attempt}`, lastReconnectAt: Date.now() });
    });
    socket.io?.on?.("reconnect", (attempt) => {
      console.log("[SocketGame] reconnect", { attempt, tableId: sync.tableId, gameId: sync.gameId, userId: sync.userId, version: loadOnlineSync()?.version ?? sync.version ?? 0 });
      saveSocketDebugStatus({ socket: "CONNECTED", gameServer: "OK", lastReconnectReason: `reconnect:${attempt}`, lastReconnectAt: Date.now(), lastError: "" });
    });
    socket.io?.on?.("reconnect_error", (error) => {
      console.warn("[SocketGame] reconnect_error", { error: error?.message ?? error, tableId: sync.tableId, gameId: sync.gameId, userId: sync.userId, version: loadOnlineSync()?.version ?? sync.version ?? 0 });
      saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", lastReconnectReason: "reconnect_error", lastReconnectAt: Date.now(), lastError: error?.message || String(error) });
    });
    let didInitialJoin = false;
    const rejoinSocketRoom = async (reason = "reconnect") => {
      if (!didInitialJoin || !socket.connected) return;
      try {
        const latestSync = loadOnlineSync();
        const response = await socketEmitWithAck(socket, "game:join", {
          tableId: latestSync?.tableId || sync.tableId,
          gameId: latestSync?.gameId || sync.gameId,
          userId: latestSync?.userId || sync.userId,
          reason,
          resetRoom: false,
        });
        if (response?.state) {
          saveOnlineSync({ ...loadOnlineSync(), version: response.version ?? 0, lastServerState: response.state, lastSyncedAt: Date.now() });
          saveSocketDebugStatus({
            socket: "CONNECTED",
            gameServer: "OK",
            serverVersion: response.version ?? response.state?.version ?? 0,
            currentVersion: response.version ?? response.state?.version ?? 0,
            lastAction: `game:join:${reason}`,
            lastError: "",
          });
          this.applyOnlineStateSnapshot(response.state);
          this.scheduleSocketStartupResync(`rejoin:${reason}`);
          if (reason === "connect" || reason === "reconnect") {
            this.setOnlineLoadingMessage("対局へ復帰しました");
            this.onStateChanged(this.state);
            setTimeout(() => {
              if (this.state.onlineLoadingMessage === "対局へ復帰しました") {
                this.clearOnlineLoadingMessage();
                this.onStateChanged(this.state);
              }
            }, 1800);
          }
        }
      } catch (error) {
        console.warn("[SocketGame] 再接続後の卓復帰に失敗しました", error);
        saveSocketDebugStatus({ lastAction: `game:join:${reason}`, lastError: error?.message || String(error) });
        this.setOnlineLoadingMessage(`ゲームサーバーへ再接続中... ${error?.message ?? error}`);
        this.onStateChanged(this.state);
      }
    };
    socket.on("game:state", (payload) => {
      const state = payload?.state;
      if (!state) return;
      saveOnlineSync({ ...loadOnlineSync(), version: payload.version ?? 0, lastServerState: state, lastSyncedAt: Date.now() });
      saveSocketDebugStatus({
        socket: socket.connected ? "CONNECTED" : "DISCONNECTED",
        gameServer: "OK",
        serverVersion: payload.version ?? state.version ?? 0,
        currentVersion: payload.version ?? state.version ?? 0,
        tableId: sync.tableId,
        gameId: sync.gameId,
        userId: sync.userId,
        lastAction: state.onlineMeta?.reason || "game:state",
        lastError: "",
      });
      if (this.applyOnlineStateSnapshot(state)) this.lastAppliedOnlinePublishedAt = Number(state?.onlineMeta?.publishedAt ?? Date.now());
    });
    const sendInitialSocketState = async (reason = "needInitialState") => {
      if (this.socketInitialStateInFlight) return;
      this.socketInitialStateInFlight = true;
      this.setOnlineLoadingMessage("ゲームサーバーの初期局面を作成中...");
      this.onStateChanged(this.state);
      try {
        const latestSync = loadOnlineSync();
        const shouldResetRoom = Boolean(latestSync?.resetRoom);
        const localRecoveryState = !shouldResetRoom && isUsableOnlineGameState(this.state) && !this.state.onlineMeta?.redacted
          ? cloneOnlineGameState(this.state)
          : null;
        const cachedRecoveryState = !shouldResetRoom && isUsableOnlineGameState(latestSync?.lastServerState) && !latestSync?.lastServerState?.onlineMeta?.redacted
          ? latestSync.lastServerState
          : null;
        const recoveryState = localRecoveryState || cachedRecoveryState;
        const response = await socketEmitWithAck(socket, "game:initState", {
          tableId: sync.tableId,
          gameId: sync.gameId,
          userId: sync.userId,
          reason,
          resetRoom: shouldResetRoom,
          state: recoveryState,
          allowCreateInitialState: true,
          players: this.state.players.map((player) => ({
            id: player.id,
            name: player.name,
            type: player.type === "cpu" ? "cpu" : "human",
            score: player.score ?? 0,
          })),
          settings: {
            ...this.state.settings,
            ruleConfig: this.state.settings?.ruleConfig,
          },
          ruleConfig: this.state.settings?.ruleConfig,
        });
        if (response?.state) {
          saveOnlineSync({ ...loadOnlineSync(), version: response.version ?? 0, lastServerState: response.state, lastSyncedAt: Date.now() });
          this.applyOnlineStateSnapshot(response.state);
          this.scheduleSocketStartupResync(`init:${reason}`);
        }
      } catch (error) {
        console.warn("[SocketGame] 初期局面の作成に失敗しました", error);
        this.setOnlineLoadingMessage(`ゲームサーバーの初期局面作成に失敗しました: ${error?.message ?? error}`);
        this.onStateChanged(this.state);
      } finally {
        this.socketInitialStateInFlight = false;
      }
    };
    socket.on("game:needInitialState", () => sendInitialSocketState("needInitialState"));
    socket.on("server:shutdown", (payload = {}) => {
      console.warn("[SocketGame] server shutdown", payload);
      saveSocketDebugStatus({
        socket: "DISCONNECTED",
        gameServer: "NG",
        lastReconnectReason: "server_shutdown",
        lastError: "ゲームサーバーが再起動中です",
      });
      this.setOnlineLoadingMessage("ゲームサーバーが再起動中です。自動で復帰します...");
      this.onStateChanged(this.state);
    });
    socket.on("connect", () => {
      console.log("[SocketGame] connected", { socketId: socket.id, tableId: sync.tableId, gameId: sync.gameId, userId: sync.userId, version: loadOnlineSync()?.version ?? sync.version ?? 0 });
      saveSocketDebugStatus({ socket: "CONNECTED", gameServer: "OK", socketId: socket.id, socketUrl: serverUrl, lastReconnectReason: didInitialJoin ? "reconnect" : "initialConnect", lastError: "" });
      if (didInitialJoin) {
        rejoinSocketRoom("connect");
        this.scheduleSocketStartupResync("connect");
      }
    });
    socket.on("disconnect", (reason) => {
      if (reason === "io client disconnect") return;
      console.warn("[SocketGame] disconnected", { reason, tableId: sync.tableId, gameId: sync.gameId, userId: sync.userId, version: loadOnlineSync()?.version ?? sync.version ?? 0 });
      saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", lastDisconnectReason: reason, lastReconnectReason: "socketDisconnect", lastError: reason });
      this.setOnlineLoadingMessage(`接続が切れました。再接続中... (${reason})`);
      this.onStateChanged(this.state);
    });
    socket.on("connect_error", (error) => {
      console.warn("[SocketGame] connect_error", { error: error?.message ?? error, tableId: sync.tableId, gameId: sync.gameId, userId: sync.userId, version: loadOnlineSync()?.version ?? sync.version ?? 0 });
      saveSocketDebugStatus({ socket: "DISCONNECTED", gameServer: "NG", lastReconnectReason: "connect_error", lastError: error?.message || String(error) });
      this.setOnlineLoadingMessage(`ゲームサーバーへ再接続中... ${error?.message ?? error}`);
      this.onStateChanged(this.state);
    });
    await waitForSocketConnected(socket, SOCKET_CONNECT_TIMEOUT_MS + 15000);
    const joinResponse = await socketEmitWithAck(socket, "game:join", {
      tableId: sync.tableId,
      gameId: sync.gameId,
      userId: sync.userId,
      resetRoom: Boolean(sync.resetRoom),
    });
    didInitialJoin = true;
    this.socketInitialConnectRetryCount = 0;
    if (sync.resetRoom) saveOnlineSync({ ...loadOnlineSync(), resetRoom: false });
    if (joinResponse?.state) {
      saveOnlineSync({ ...loadOnlineSync(), version: joinResponse.version ?? 0, lastServerState: joinResponse.state, lastSyncedAt: Date.now() });
      this.applyOnlineStateSnapshot(joinResponse.state);
      this.scheduleSocketStartupResync("join");
    } else {
      setTimeout(() => {
        const latest = loadOnlineSync();
        if (latest?.transport === "socketio" && latest?.tableId === sync.tableId && socket.connected && this.state.phase === "onlineLoading") {
          sendInitialSocketState("joinFallback");
        }
      }, 1200);
    }
    setTimeout(() => {
      const latest = loadOnlineSync();
      if (
        latest?.transport === "socketio" &&
        latest?.tableId === sync.tableId &&
        socket.connected &&
        this.state.phase === "onlineLoading"
      ) {
        this.resyncSocketGameState("startupWatchdog").then((synced) => {
          if (!synced && this.state.phase === "onlineLoading") sendInitialSocketState("startupWatchdog");
        }).catch((error) => {
          console.warn("[SocketGame] startup watchdog resync failed", error);
          if (this.state.phase === "onlineLoading") sendInitialSocketState("startupWatchdog");
        });
      }
    }, 2400);
  }
  async resyncSocketGameState(reason = "resync") {
    const sync = loadOnlineSync();
    const socket = globalThis.anmikaGameSocket;
    if (sync?.transport !== "socketio" || !socket) return false;
    try {
      console.log("[Discard] resync requested", reason);
      const response = await socketEmitWithAck(socket, "game:requestState", {
        tableId: sync.tableId,
        gameId: sync.gameId,
        userId: sync.userId,
        reason,
      });
      if (response?.state) {
        saveOnlineSync({ ...loadOnlineSync(), version: response.version ?? sync.version ?? 0, lastServerState: response.state, lastSyncedAt: Date.now() });
        this.applyOnlineStateSnapshot(response.state);
        return true;
      }
    } catch (error) {
      console.warn("[Discard] resync failed", error);
    }
    return false;
  }
  applyOptimisticDiscard(tileId, requestId, { isRiichiDiscard = false } = {}) {
    const player = getCurrentPlayer(this.state);
    if (!player) return false;
    const drawn = player.drawnTile?.id === tileId ? player.drawnTile : null;
    const handTile = drawn ? null : player.hand.find((tile) => tile.id === tileId);
    const tile = drawn || handTile;
    if (!tile) return false;
    this.optimisticDiscardRollbackState = JSON.parse(JSON.stringify(this.state));
    if (drawn) player.drawnTile = null;
    else {
      player.hand = player.hand.filter((item) => item.id !== tileId);
      if (player.drawnTile) {
        player.hand.push(player.drawnTile);
        player.drawnTile = null;
        player.hand = sortHandTiles(player.hand);
      }
    }
    player.discardedTiles ??= [];
    player.discardedTiles.push({ tile, discardType: drawn ? "tsumogiri" : "tedashi", isRiichiDiscard, turnIndex: this.state.turnIndex ?? 0, optimistic: true });
    this.state.pendingAction = null;
    this.state.optimisticDiscardRequestId = requestId;
    this.state.discardDebugMessage = "打牌送信中...";
    this.onStateChanged(this.state);
    return true;
  }
  rollbackOptimisticDiscard(message = "") {
    if (this.optimisticDiscardRollbackState) {
      const currentUser = this.state.currentUser;
      this.state = { ...this.optimisticDiscardRollbackState, currentUser };
      this.optimisticDiscardRollbackState = null;
    }
    this.state.optimisticDiscardRequestId = null;
    if (message) this.state.discardDebugMessage = message;
    this.onStateChanged(this.state);
  }
  clearOptimisticDiscard() {
    this.optimisticDiscardRollbackState = null;
    this.state.optimisticDiscardRequestId = null;
  }
  startOnlineStateSync() {
    const sync = loadOnlineSync();
    if (!sync?.enabled || !sync.gameId) return;
    if (sync.transport === "socketio") return;
    if (this.onlineSyncTimer) clearInterval(this.onlineSyncTimer);
    this.onlineSyncTimer = setInterval(async () => {
      try {
        const before = loadOnlineSync();
        const row = await refreshOnlineSyncFromServer();
        const latest = loadOnlineSync();
        const serverState = row?.state ?? latest?.lastServerState;
        const serverVersion = Number(row?.version ?? latest?.version ?? 0);
        const localVersion = Number(this.state.version ?? 0);
        const publishedAt = Number(serverState?.onlineMeta?.publishedAt ?? 0);
        const publishedByMe = serverState?.onlineMeta?.publishedBy && serverState.onlineMeta.publishedBy === before?.userId;
        if (serverState && !publishedByMe && (serverVersion > localVersion || publishedAt > this.lastAppliedOnlinePublishedAt)) {
          if (this.applyOnlineStateSnapshot(serverState)) this.lastAppliedOnlinePublishedAt = publishedAt || Date.now();
        }
      } catch (error) {
        console.warn("[OnlineSync] 局面同期に失敗しました", error);
      }
    }, 900);
  }
  scheduleOnlineStatePublish(reason = "state") {
    if (this.isApplyingOnlineState) return;
    const sync = loadOnlineSync();
    if (!sync?.enabled || !sync.gameId || this.state.screen !== "game") return;
    if (sync.transport === "socketio") return;
    if (reason === "emit" && this.state.turnIndex === 0 && !this.onlineInitialPublisher) return;
    if (this.onlinePublishTimer) clearTimeout(this.onlinePublishTimer);
    this.onlinePublishTimer = setTimeout(() => {
      pushOnlineSyncState(this.state, reason).catch((error) => {
        console.warn("[OnlineSync] 局面保存に失敗しました", error);
      });
    }, 120);
  }
  leaveSeat(tableId, playerId = this.currentUserId()) {
    const table = loadTables().find((item) => item.id === tableId);
    if (!table) return;
    const seat = table.seats.find((item) => item.playerId === playerId);
    if (seat) Object.assign(seat, { playerId: undefined, playerType: undefined, isOccupied: false, isReady: false, isLastHandDeclared: false });
    table.waitingList = (table.waitingList ?? []).filter((id) => id !== playerId);
    table.participants = (table.participants ?? []).filter((id) => id !== playerId);
    table.joinedUsers = (table.joinedUsers ?? []).filter((id) => id !== playerId);
    if (table.status !== "playing") this.autoSeatWaitingPlayers(table);
    this.syncTable(table);
    this.emit();
  }
  deleteTable(tableId) {
    const tables = loadTables();
    const table = tables.find((item) => item.id === tableId);
    if (!table || !canDeleteTableRoom(table)) {
      this.state.log.unshift("この卓はまだ削除できません");
      this.emit();
      return;
    }
    const ok = typeof globalThis.confirm === "function" ? globalThis.confirm("この卓を削除しますか？") : true;
    if (!ok) return;
    saveTables(tables.filter((item) => item.id !== tableId));
    if (this.state.selectedTableId === tableId) this.state.selectedTableId = null;
    this.refreshStoredData();
    this.state.screen = "tableList";
    this.emit();
  }
  joinWaitingList(tableId, playerId = this.currentUserId()) {
    const table = loadTables().find((item) => item.id === tableId);
    if (!table || table.seats.some((seat) => seat.playerId === playerId)) return;
    if (table.waitingList.includes(playerId)) table.waitingList = table.waitingList.filter((id) => id !== playerId);
    else table.waitingList.push(playerId);
    this.syncTable(table);
    this.emit();
  }
  autoSeatWaitingPlayers(table) {
    table.waitingList ??= [];
    while (table.waitingList.length > 0) {
      const targetSeat = table.seats.find((seat) => !seat.playerId) ?? table.seats.find((seat) => isCpuPlayerId(seat.playerId));
      if (!targetSeat) break;
      const promotedPlayerId = table.waitingList.shift();
      Object.assign(targetSeat, { playerId: promotedPlayerId, playerType: isCpuPlayerId(promotedPlayerId) ? "cpu" : "human", isOccupied: true, isReady: true });
    }
    return table;
  }
  promoteFromWaitingList(table) {
    return this.autoSeatWaitingPlayers(table);
  }
  updateSeatLastHand(tableId, playerId = CURRENT_USER_ID, isLastHandDeclared = false) {
    const table = loadTables().find((item) => item.id === tableId);
    const seat = table?.seats.find((item) => item.playerId === playerId);
    if (!table || !seat) return;
    seat.isLastHandDeclared = isLastHandDeclared;
    this.syncTable(table);
    if (playerId === CURRENT_USER_ID) this.state.settings.isLastHand = isLastHandDeclared;
    this.emit();
  }
  saveReplayForCurrentHand() {
    const result = this.state.handLog.result;
    if (!result || this.state.lastSavedReplayId === this.state.handLog.handId) return;
    const endedAt = now();
    const replayId = createId("replay");
    const table = this.state.activeTableId ? tableRepository.listTables().find((item) => item.id === this.state.activeTableId) : null;
    const replay = {
      replayId,
      summary: {
        replayId,
        replayUrl: replayUrlFor(replayId),
        clubId: this.state.activeClubId ?? table?.clubId ?? undefined,
        tableId: this.state.activeTableId ?? undefined,
        ruleId: table?.ruleId ?? "anmika-rocket",
        ruleName: replayRuleName(table?.ruleId ?? "anmika-rocket"),
        startedAt: Number(this.state.handLog.handId.split("-").at(-1)) || endedAt,
        endedAt,
        players: this.state.players.map((player) => ({ playerId: player.id, name: player.name, finalScore: player.score })),
        resultLabel: result.type === "win" ? `${getPlayerNameById(result.winnerId)} ${result.winType === "tsumo" ? "ツモ" : "ロン"}` : "流局",
        resultSummary: replayResultSummaryFromState(this.state, result),
        replayFormat: "event-log-v1",
        eventLogIsPrimary: true,
        eventCount: this.state.handLog.events.length,
      },
      initialState: this.state.replayInitialState ?? cloneSnapshot(this.state),
      events: [...this.state.handLog.events],
      snapshots: pickReplaySnapshots([...(this.state.replaySnapshots ?? []), cloneSnapshot(this.state)], 40),
    };
    replayRepository.saveReplay(replay);
    this.state.lastSavedReplayId = this.state.handLog.handId;
    this.state.replaySummaries = replayRepository.listReplays();
  }
  openReplay(replayId, { updateHash = true } = {}) {
    if (this.replayAutoListTimer) {
      clearTimeout(this.replayAutoListTimer);
      this.replayAutoListTimer = null;
    }
    this.refreshStoredData();
    const replay = replayRepository.getReplay(replayId);
    if (!replay) {
      this.state.selectedReplayId = replayId;
      this.state.replayIndex = 0;
      this.state.replayLoading = true;
      this.state.replayLoadError = "";
      this.state.screen = "replayViewer";
      this.emit();
      this.refreshReplaysFromSupabase({ replayId }).then(() => {
        this.state.replayLoading = false;
        if (replayRepository.getReplay(replayId)) this.openReplay(replayId, { updateHash });
        else {
          this.state.replayLoadError = "牌譜本体を取得できませんでした。牌譜一覧から開き直してください。";
          this.emit();
        }
      }).catch((error) => {
        this.state.replayLoading = false;
        this.state.replayLoadError = error.message || "牌譜取得に失敗しました。";
        this.state.log.unshift(`牌譜取得に失敗しました: ${error.message}`);
        this.emit();
      });
      return;
    }
    const firstSnapshot = getCurrentReplaySnapshot(replay, 0);
    this.clearReplayAnnouncement();
    this.state.selectedReplayId = replayId;
    this.state.replayIndex = 0;
    this.state.replayLoading = false;
    this.state.replayLoadError = "";
    this.state.replayViewerId = getValidReplayViewerId(firstSnapshot, this.state.replayViewerId ?? CURRENT_USER_ID, replay);
    this.state.replayRevealHands = false;
    this.state.screen = "replayViewer";
    warmReplayTileImages(replay, 0, 4);
    if (updateHash && globalThis.location) {
      const encoded = encodeURIComponent(replayId);
      if (globalThis.location.protocol === "file:") {
        const nextHash = `#/replay/${encoded}`;
        if (globalThis.location.hash !== nextHash) globalThis.location.hash = nextHash;
      } else {
        try { globalThis.history?.pushState?.(null, "", `/replay/${encoded}`); } catch {}
      }
    }
    this.emit();
  }
  stepReplay(delta) {
    const replay = replayRepository.getReplay(this.state.selectedReplayId);
    const max = Math.max(0, getReplaySnapshots(replay).length - 1);
    const visible = getReplayVisibleSnapshotIndexes(replay);
    const previousIndex = this.state.replayIndex;
    if (visible.length) {
      const { position } = getReplayVisiblePosition(replay, this.state.replayIndex);
      const nextPosition = Math.max(0, Math.min(visible.length - 1, position + delta));
      this.state.replayIndex = visible[nextPosition] ?? this.state.replayIndex;
    } else {
      this.state.replayIndex = Math.max(0, Math.min(max, this.state.replayIndex + delta));
    }
    warmReplayTileImages(replay, this.state.replayIndex, delta >= 0 ? 5 : 2);
    if (this.state.replayIndex !== previousIndex) this.playReplayEffectsBetween(replay, previousIndex, this.state.replayIndex);
    this.emit();
  }
  setReplayIndex(index) {
    const replay = replayRepository.getReplay(this.state.selectedReplayId);
    const max = Math.max(0, getReplaySnapshots(replay).length - 1);
    const previousIndex = this.state.replayIndex;
    this.state.replayIndex = Math.max(0, Math.min(max, Number(index || 0)));
    warmReplayTileImages(replay, this.state.replayIndex, 5);
    if (this.state.replayIndex !== previousIndex) this.playReplayEffectsAtIndex(replay, this.state.replayIndex);
    this.emit();
  }
  playReplayEffectsAtIndex(replay, index) {
    const event = getReplayEventForSnapshotIndex(replay, index);
    if (!event) {
      this.clearReplayAnnouncement();
      return;
    }
    this.playReplayEffectQueue([{ event, index }]);
  }
  playReplayEffectsBetween(replay, fromIndex, toIndex) {
    if (!replay || fromIndex === toIndex) return;
    const items = [];
    if (toIndex > fromIndex) {
      for (let index = fromIndex + 1; index <= toIndex; index++) {
        const event = getReplayEventForSnapshotIndex(replay, index);
        if (event) items.push({ event, index });
      }
    } else {
      const event = getReplayEventForSnapshotIndex(replay, toIndex);
      if (event) items.push({ event, index: toIndex });
    }
    this.playReplayEffectQueue(items);
  }
  playReplayEffectQueue(items) {
    const effectItems = (items || []).filter(({ event }) => soundTypeForEvent(event) || replayAnnouncementForEvent(event));
    const queue = effectItems.filter(({ event }, index) => {
      const nextEvent = effectItems[index + 1]?.event;
      return !(event?.type === "win" && (nextEvent?.type === "ron" || nextEvent?.type === "tsumo") && nextEvent.type === event.winType);
    });
    if (this.replayEffectQueueTimer) clearTimeout(this.replayEffectQueueTimer);
    if (!queue.length) {
      this.clearReplayAnnouncement();
      return;
    }
    const playNext = () => {
      const item = queue.shift();
      if (!item) return;
      const { event, index } = item;
      const soundType = soundTypeForEvent(event);
      const announcement = replayAnnouncementForEvent(event);
      if (soundType) playGameSound(soundType, { key: `replay:${soundType}:${index}:${event.playerId || event.actorPlayerId || ""}` });
      if (announcement) {
        const key = `replay:${announcement.kind}:${index}:${event.playerId || event.actorPlayerId || ""}`;
        this.state.replayAnnouncement = { ...announcement, key };
        if (this.replayAnnouncementTimer) clearTimeout(this.replayAnnouncementTimer);
        this.replayAnnouncementTimer = setTimeout(() => {
          if (this.state.replayAnnouncement?.key === key) {
            this.state.replayAnnouncement = null;
            this.emit();
          }
        }, 1300);
        this.emit();
      }
      if (queue.length) this.replayEffectQueueTimer = setTimeout(playNext, 700);
    };
    playNext();
  }
  clearReplayAnnouncement() {
    if (this.replayAnnouncementTimer) clearTimeout(this.replayAnnouncementTimer);
    if (this.replayEffectQueueTimer) clearTimeout(this.replayEffectQueueTimer);
    this.replayAnnouncementTimer = null;
    this.replayEffectQueueTimer = null;
    if (this.state.replayAnnouncement) this.state.replayAnnouncement = null;
  }
  goNextReplayStep() {
    this.stepReplay(1);
  }
  goPrevReplayStep() {
    this.stepReplay(-1);
  }
  setReplayViewer(viewerId) {
    const replay = replayRepository.getReplay(this.state.selectedReplayId);
    const snapshot = getCurrentReplaySnapshot(replay, this.state.replayIndex);
    this.state.replayViewerId = getValidReplayViewerId(snapshot, viewerId, replay);
    this.emit();
  }
  setReplayRevealHands(checked) {
    this.state.replayRevealHands = Boolean(checked);
    this.emit();
  }
  async copyReplayUrl(replayId) {
    const url = replayUrlFor(replayId);
    try {
      await globalThis.navigator?.clipboard?.writeText(url);
      this.state.log.unshift("牌譜URLをコピーしました");
    } catch {
      this.state.log.unshift(url);
    }
    this.emit();
  }
  async copyTableUrl(tableId) {
    const url = tableUrlFor(tableId);
    try {
      await globalThis.navigator?.clipboard?.writeText(url);
      this.state.log.unshift("卓URLをコピーしました");
    } catch {
      this.state.log.unshift(url);
    }
    this.emit();
  }
  searchClub(clubId) {
    this.state.clubSearchId = clubId;
    this.state.clubSearchResultId = clubRepository.getClub(clubId)?.id ?? null;
    this.emit();
  }
  openClub(clubId) {
    this.state.selectedClubId = clubId;
    this.state.screen = "clubDetail";
    this.refreshStoredData();
    this.emit();
  }
  applyToClub(clubId, userId = this.currentUserId()) {
    const club = normalizeClub(clubRepository.getClub(clubId));
    if (!club || isClubMember(userId, club) || club.pendingApplicants.includes(userId)) return;
    club.pendingApplicants.push(userId);
    clubRepository.saveClub(club);
    this.refreshStoredData();
    this.emit();
  }
  approveClubApplicant(clubId, adminUserId, applicantUserId) {
    const club = normalizeClub(clubRepository.getClub(clubId));
    if (!club || getClubRole(adminUserId, club) !== "admin") return;
    club.pendingApplicants = club.pendingApplicants.filter((id) => id !== applicantUserId);
    if (!isClubMember(applicantUserId, club)) club.members.push({ userId: applicantUserId, role: "member", pointBalance: 0, joinedAt: now() });
    clubRepository.saveClub(club);
    const points = loadClubMemberPoints();
    if (!points.some((item) => item.clubId === clubId && item.userId === applicantUserId)) points.push({ clubId, userId: applicantUserId, balance: 0 });
    saveClubMemberPoints(points);
    this.refreshStoredData();
    this.emit();
  }
  rejectClubApplicant(clubId, adminUserId, applicantUserId) {
    const club = normalizeClub(clubRepository.getClub(clubId));
    if (!club || getClubRole(adminUserId, club) !== "admin") return;
    club.pendingApplicants = club.pendingApplicants.filter((id) => id !== applicantUserId);
    clubRepository.saveClub(club);
    this.refreshStoredData();
    this.emit();
  }
  transferClubPointsToMember(clubId, adminUserId, memberUserId, amount) {
    const club = normalizeClub(clubRepository.getClub(clubId));
    if (!club || getClubRole(adminUserId, club) !== "admin" || amount <= 0 || club.clubPointBalance < amount) return;
    const member = club.members.find((item) => item.userId === memberUserId);
    if (!member) return;
    club.clubPointBalance -= amount;
    member.pointBalance = (member.pointBalance ?? 0) + amount;
    clubRepository.saveClub(club);
    this.refreshStoredData();
    this.emit();
  }
  collectClubPointsFromMember(clubId, adminUserId, memberUserId, amount) {
    const club = normalizeClub(clubRepository.getClub(clubId));
    if (!club || getClubRole(adminUserId, club) !== "admin" || amount <= 0) return;
    const member = club.members.find((item) => item.userId === memberUserId);
    if (!member || (member.pointBalance ?? 0) < amount) return;
    member.pointBalance -= amount;
    club.clubPointBalance += amount;
    clubRepository.saveClub(club);
    this.refreshStoredData();
    this.emit();
  }
  removeClubMember(clubId, adminUserId, memberUserId) {
    const club = normalizeClub(clubRepository.getClub(clubId));
    if (!club || getClubRole(adminUserId, club) !== "admin") {
      this.state.log.unshift("メンバー削除に失敗しました: 権限がありません");
      this.emit();
      return;
    }
    const member = club.members.find((item) => item.userId === memberUserId);
    if (!member) {
      this.state.log.unshift("メンバー削除に失敗しました: メンバーが見つかりません");
      this.emit();
      return;
    }
    if (member.role === "admin" || member.userId === adminUserId) {
      this.state.log.unshift("管理者はこの画面から削除できません");
      this.emit();
      return;
    }
    const memberName = getPlayerNameById(memberUserId);
    if (!globalThis.confirm?.(`${memberName} をクラブから削除しますか？\nこのメンバーのクラブポイントはすべてクラブ側へ戻ります。`)) return;
    const balance = Number(member.pointBalance || 0);
    club.clubPointBalance = Number(club.clubPointBalance || 0) + balance;
    club.members = club.members.filter((item) => item.userId !== memberUserId);
    club.pendingApplicants = club.pendingApplicants.filter((id) => id !== memberUserId);
    clubRepository.saveClub(club);
    const points = loadClubMemberPoints().filter((item) => !(item.clubId === clubId && item.userId === memberUserId));
    saveClubMemberPoints(points);
    this.state.log.unshift(`${memberName} をクラブから削除しました`);
    this.refreshStoredData();
    this.emit();
  }
  grantClubAdminRole(clubId, adminUserId, memberUserId) {
    const club = normalizeClub(clubRepository.getClub(clubId));
    if (!club || getClubRole(adminUserId, club) !== "admin") {
      this.state.log.unshift("管理者権限の付与に失敗しました: 権限がありません");
      this.emit();
      return;
    }
    const member = club.members.find((item) => item.userId === memberUserId);
    if (!member) {
      this.state.log.unshift("管理者権限の付与に失敗しました: メンバーが見つかりません");
      this.emit();
      return;
    }
    if (member.role === "admin") {
      this.state.log.unshift("このメンバーはすでに管理者権限を持っています");
      this.emit();
      return;
    }
    const memberName = getPlayerNameById(memberUserId);
    if (!globalThis.confirm?.(`${memberName} に管理者権限を付与しますか？\n卓作成、加入承認、クラブポイント管理ができるようになります。`)) return;
    member.role = "admin";
    clubRepository.saveClub(club);
    this.state.log.unshift(`${memberName} に管理者権限を付与しました`);
    this.refreshStoredData();
    this.emit();
  }
  assertHandCount(player, context = this.state.phase) {
    const total = player.hand.length + (player.drawnTile ? 1 : 0);
    console.log("[HandCount]", player.id, player.hand.length, !!player.drawnTile);
    const discardLike = ["waitingForHumanDiscard", "waitingForRiichiDiscard", "waitingForAction"].includes(this.state.phase);
    if (player.melds.length === 0 && discardLike && total !== 14) console.error("Invalid hand count during discard phase", context, player);
    if (player.melds.length === 0 && !discardLike && this.state.phase === "playing" && total !== 13 && total !== 14) console.error("Invalid hand count outside discard phase", context, player);
  }
  normalizeHumanDrawStateForDiscard(player) {
    if (player.type !== "human" || player.melds.length > 0) {
      this.assertHandCount(player, "skip-normalize-open-hand");
      return;
    }
    if (!player.drawnTile && player.hand.length < 13) {
      while (player.hand.length < 13 && this.state.liveWall.length > 0) {
        const repairTile = this.state.liveWall.shift();
        if (repairTile) player.hand.push(repairTile);
      }
      player.hand = sortHandTiles(player.hand);
    }
    if (!player.drawnTile && player.hand.length === 13) {
      this.drawTile({ suppressEmit: true });
    } else if (!player.drawnTile && player.hand.length === 14) {
      player.drawnTile = player.hand.pop();
      player.hand = sortHandTiles(player.hand);
    }
    this.assertHandCount(player, "normalizeHumanDrawStateForDiscard");
  }
  startGame({ preserveScores = false } = {}) {
    const ruleId = this.state.settings?.ruleId || this.state.settings?.gameType || "anmika-rocket";
    const ruleConfig = normalizeRuleConfigForRule(ruleId, this.state.settings?.ruleConfig);
    this.state.settings.ruleId = ruleId;
    this.state.settings.gameType = this.state.settings.gameType || ruleId;
    this.state.settings.ruleConfig = ruleConfig;
    Object.assign(this.state, splitStartingWalls(shuffle(createWallTiles(ruleConfig, ruleId)), ruleId === TSUMO_LOSSLESS_3MA_RULE_ID && ruleConfig.northNukiDoraEnabled ? 12 : 8), { kanCount: 0, turnIndex: 0, phase: "playing", pendingAction: null, lastDrawnTile: null, rinshanKaihou: null, pendingRinshanKaihouFromKan: false, lastScoreResult: null, winAnnouncement: null, flowerAnnouncement: null, resultCountdownStartedAt: null, resultCountdownResultId: "", resultCountdownSeconds: null, resultAutoCloseHandled: false, resultAutoCloseHandledResultId: "", resultOkSubmitted: false, resultOkSubmittedAt: null, resultOkSubmittedResultId: "", resultOkPlayerIds: [], log: [] });
    if (!preserveScores) this.state.rakePool = 0;
    if (!preserveScores) this.state.riichiStickCount = 0;
    if (!preserveScores) this.state.playerClocks = createPlayerClocks(this.state.players, this.state.settings?.initialClockMs ?? INITIAL_TIME_MS);
    this.stopAllClocks();
    if (!preserveScores) {
      this.state.round.roundWind = "east";
      this.state.round.handNumber = 1;
      this.state.round.hanchanRoundIndex = 0;
      this.state.round.honba = 0;
      this.state.round.dealerPlayerId = this.state.players[0]?.id ?? "";
    }
    const startingScore = ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? Number(ruleConfig.startingScore ?? DEFAULT_TSUMO_LOSSLESS_3MA_RULE_CONFIG.startingScore) : 0;
    for (const player of this.state.players) {
      const assistSettings = { autoWin: Boolean(player.assistSettings?.autoWin), noCall: false };
      Object.assign(player, { hand: [], drawnTile: null, discardedTiles: [], nukiDoraTiles: [], melds: [], status: "waiting", score: preserveScores ? player.score : startingScore, isRiichi: false, ippatsu: false, riichiTurnIndex: null, ippatsuOwnDrawStarted: false, sameTurnFuriten: false, riichiDiscardTileIds: [], riichiStickPaid: false, feverRiichiActive: false, feverWinCount: 0, assistSettings });
    }
    for (let i = 0; i < 13; i++) for (const player of this.state.players) { const tile = this.state.liveWall.shift(); if (tile) player.hand.push(tile); }
    for (const player of this.state.players) player.hand = sortHandTiles(player.hand);
    this.state.handLog = {
      handId: `east-${this.state.round.handNumber}-${Date.now()}`,
      roundLabel: formatRoundLabel(this.state),
      dealerId: this.state.round.dealerPlayerId,
      events: [],
      initialSeatOrder: this.state.players.map((p) => p.id),
      initialPlayers: this.state.players.map((p, seatIndex) => ({ id: p.id, name: p.name, type: p.type, seatIndex })),
      initialHands: Object.fromEntries(this.state.players.map((p) => [p.id, [...p.hand]])),
      initialDoraIndicators: [...this.state.doraIndicators],
      initialScores: Object.fromEntries(this.state.players.map((p) => [p.id, p.score])),
    };
    for (const tile of this.state.doraIndicators) appendHandLogEvent(this.state.handLog, { type: "doraReveal", tile, doraIndicators: [...this.state.doraIndicators], turnIndex: this.state.turnIndex, reason: "initial" });
    this.state.currentPlayerIndex = Math.max(0, this.state.players.findIndex((p) => p.id === this.state.round.dealerPlayerId));
    getCurrentPlayer(this.state).status = "active";
    this.state.replayInitialState = cloneSnapshot(this.state);
    this.state.replaySnapshots = [this.state.replayInitialState];
    this.state.lastSavedReplayId = null;
    this.showBaibaStartAnnouncement(this.state);
    this.advanceUntilHumanAction();
    this.emit();
  }
  startNextHand() {
    const result = this.state.handLog.result;
    const isDraw = result?.type === "exhaustiveDraw";
    if (isTsumoLossless3maState(this.state)) {
      const dealerContinues = isTsumoLosslessDealerContinuation(this.state, result);
      this.state.round.honba = dealerContinues || isDraw ? Number(this.state.round.honba || 0) + 1 : 0;
      if (!dealerContinues) this.state.round.hanchanRoundIndex = Number(this.state.round.hanchanRoundIndex || 0) + 1;
      const order = Array.isArray(this.state.round.initialSeatOrder) && this.state.round.initialSeatOrder.length
        ? this.state.round.initialSeatOrder
        : this.state.players.map((player) => player.id);
      this.state.round.dealerPlayerId = order[Number(this.state.round.hanchanRoundIndex || 0) % Math.max(1, order.length)] || this.state.players[0]?.id || "";
      this.state.round.handNumber = Number(this.state.round.hanchanRoundIndex || 0) + 1;
      console.log("[NextHand]", this.state.round.dealerPlayerId);
      this.startGame({ preserveScores: true });
      return;
    }
    const winnerIds = result?.type === "win"
      ? [
        ...(Array.isArray(result.winners) ? result.winners.map((winner) => winner?.winnerId || winner?.playerId || winner?.id || "") : []),
        result.winnerId,
      ].filter(Boolean)
      : [];
    const dealerWon = winnerIds.includes(this.state.round.dealerPlayerId);
    const nextDealerId = winnerIds[0] || this.state.round.dealerPlayerId;
    this.state.round.honba = dealerWon || isDraw ? Number(this.state.round.honba || 0) + 1 : 0;
    this.state.round.dealerPlayerId = nextDealerId;
    this.state.round.handNumber++;
    console.log("[NextHand]", nextDealerId);
    this.startGame({ preserveScores: true });
  }
  async handleResultOk(options = {}) {
    console.log("[ResultOk] clicked", this.state.handLog.result?.type, this.state.phase);
    const result = this.state.handLog.result;
    if (!result) return;
    if (options.resultId && result.resultId && options.resultId !== result.resultId) {
      console.warn("[ResultOk] stale click ignored", { requestedResultId: options.resultId, currentResultId: result.resultId, phase: this.state.phase });
      return;
    }
    if (options.autoAllResultOk && !isResultCountdownExpired(this.state)) {
      console.warn("[ResultOk] early auto ignored", { resultId: result.resultId, countdownStartedAt: this.state.resultCountdownStartedAt, phase: this.state.phase });
      this.state.resultAutoCloseHandled = false;
      this.state.resultAutoCloseHandledResultId = "";
      return;
    }
    if (isSocketAuthoritativeGame()) {
      const localPlayerId = getLocalHumanPlayerId(this.state);
      if (!localPlayerId) return;
      const currentResultId = result.resultId || "";
      if (
        this.state.resultOkSubmitted &&
        this.state.resultOkSubmittedResultId === currentResultId &&
        Date.now() - Number(this.state.resultOkSubmittedAt || 0) < 700
      ) return;
      const requestId = `result-ok-${result.resultId || "result"}-${localPlayerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.state.resultOkSubmitted = true;
      this.state.resultOkSubmittedAt = Date.now();
      this.state.resultOkSubmittedResultId = currentResultId;
      this.state.resultAutoCloseHandled = true;
      this.state.resultOkPlayerIds = [...new Set([...(this.state.resultOkPlayerIds || []), localPlayerId])];
      if (this.state.handLog?.result) {
        this.state.handLog.result.resultOkPlayerIds = [...new Set([...(this.state.handLog.result.resultOkPlayerIds || []), localPlayerId])];
      }
      this.onStateChanged(this.state);
      submitOnlineGameAction("resultOk", { localPlayerId, resultId: result.resultId || "", autoAllResultOk: Boolean(options.autoAllResultOk), requestId }, { timeoutMs: 5000 }).then(async (response) => {
        if (response?.state) {
          saveOnlineSync({ ...loadOnlineSync(), version: response.version ?? response.state.version ?? loadOnlineSync()?.version ?? 0, lastServerState: response.state, lastSyncedAt: Date.now() });
          this.applyOnlineStateSnapshot(response.state);
        } else {
          this.state.resultOkSubmitted = false;
          this.state.resultOkSubmittedResultId = "";
          this.state.resultAutoCloseHandled = false;
          await this.resyncSocketGameState("resultOkAckWithoutState").catch(() => {});
          this.emit();
          return;
        }
        if (response?.state?.phase !== "gameEnded") {
          return;
        }
        const sync = loadOnlineSync();
        const activeTableId = this.state.activeTableId;
        if (shouldLeaveOnlineTableAfterGameEnded(response.state, sync)) {
          const leavePlayerId = sync?.userId || localPlayerId;
          await leaveOnlineTableForSync(sync);
          if (activeTableId && leavePlayerId) this.leaveSeat(activeTableId, leavePlayerId);
          forgetOnlineDebugLaunchCache(sync, activeTableId);
          saveOnlineSync(null);
          if (sync?.returnUrl) {
            window.location.href = normalizeOnlineDebugReturnUrl(sync.returnUrl, localStorage.getItem(ONLINE_DEBUG_RETURN_CLUB_KEY) || this.state.activeClubId || this.state.selectedClubId || "", sync.tableId || activeTableId);
          } else {
            this.state.screen = "clubLobby";
            this.emit();
          }
          return;
        }
        this.state.resultOkSubmitted = false;
        this.state.resultOkSubmittedResultId = "";
        this.state.resultAutoCloseHandled = false;
        this.emit();
      }).catch((error) => {
        this.state.resultOkSubmitted = false;
        this.state.resultOkSubmittedResultId = "";
        this.state.resultAutoCloseHandled = false;
        console.warn("[SocketGame] result ok failed", error);
        this.state.log.unshift(`OK送信を再試行できます: ${error.message}`);
        this.emit();
        this.resyncSocketGameState("resultOkFailed").catch(() => {});
      });
      return;
    }
    this.state.resultCountdownStartedAt = null;
    this.state.resultCountdownSeconds = null;
    this.state.resultAutoCloseHandled = false;
    if (result?.isFeverContinuation) {
      this.state.handLog.result = null;
      this.state.lastScoreResult = null;
      this.state.pendingAction = null;
      this.state.phase = "playing";
      this.state.isWaitingForHumanAction = false;
      for (const player of this.state.players) player.status = "waiting";
      if (result.winType === "tsumo") this.getPlayer(result.winnerId).drawnTile = null;
      const resumeFromId = result.winType === "ron" ? result.loserId : result.winnerId;
      const resumeIndex = this.state.players.findIndex((player) => player.id === resumeFromId);
      if (resumeIndex >= 0) {
        this.state.currentPlayerIndex = resumeIndex;
        this.state.players[resumeIndex].status = "active";
      }
      if (result.winType === "ron") this.continueAfterDiscardCallWindow();
      else this.advanceTurn();
      this.advanceUntilHumanAction();
      this.emit();
      return;
    }
    this.saveReplayForCurrentHand();
    if (shouldEndAfterResultOk(this.state)) {
      const activeTableId = this.state.activeTableId;
      this.state.handLog.result = null;
      this.state.phase = "gameEnded";
      this.state.pendingAction = null;
      this.state.isWaitingForHumanAction = false;
      const sync = loadOnlineSync();
      if (shouldLeaveOnlineTableAfterGameEnded(this.state, sync)) {
        const leavePlayerId = sync?.userId || getLocalHumanPlayerId(this.state);
        await leaveOnlineTableForSync(sync);
        if (activeTableId && leavePlayerId) this.leaveSeat(activeTableId, leavePlayerId);
        forgetOnlineDebugLaunchCache(sync, activeTableId);
        saveOnlineSync(null);
        if (sync?.returnUrl) {
          window.location.href = normalizeOnlineDebugReturnUrl(sync.returnUrl, localStorage.getItem(ONLINE_DEBUG_RETURN_CLUB_KEY) || this.state.activeClubId || this.state.selectedClubId || "", sync.tableId || activeTableId);
        } else {
          this.state.screen = "clubLobby";
          this.emit();
        }
        return;
      }
      this.emit();
      return;
    }
    this.startNextHand();
  }
  async handleFinalResultOk() {
    const sync = loadOnlineSync();
    if (isSocketAuthoritativeGame() && isTsumoLossless3maState(this.state)) {
      try {
        const response = await submitOnlineFinalResultOk({ timeoutMs: 15000 });
        if (response?.advanced && response?.state) {
          this.onlineGameEndedReturnScheduled = false;
          this.state.screen = "game";
          this.emit();
          return;
        }
      } catch (error) {
        console.warn("[SocketGame] final result ok failed", error);
        this.state.log.unshift(`次の半荘開始に失敗: ${error.message}`);
        this.emit();
        return;
      }
    }
    this.stopAllClocks();
    const activeTableId = this.state.activeTableId;
    const shouldLeave = shouldLeaveOnlineTableAfterGameEnded(this.state, sync);
    this.state.phase = "idle";
    this.state.handLog.result = null;
    this.state.pendingAction = null;
    this.state.activeTableId = null;
    this.state.screen = "home";
    this.refreshStoredData();
    if (sync?.returnUrl) {
      if (shouldLeave) {
        const leavePlayerId = sync?.userId || getLocalHumanPlayerId(this.state);
        await leaveOnlineTableForSync(sync);
        if (activeTableId && leavePlayerId) this.leaveSeat(activeTableId, leavePlayerId);
        forgetOnlineDebugLaunchCache(sync, activeTableId);
        window.location.href = normalizeOnlineDebugReturnUrl(sync.returnUrl, localStorage.getItem(ONLINE_DEBUG_RETURN_CLUB_KEY) || this.state.activeClubId || this.state.selectedClubId || "", sync.tableId || activeTableId);
      } else {
        window.location.href = sync.returnUrl;
      }
      saveOnlineSync(null);
      return;
    }
    this.emit();
  }
  async handleAgariYame(options = {}) {
    const result = this.state.handLog?.result;
    if (!result || !canLocalPlayerAgariYame(this.state)) return;
    if (options.resultId && result.resultId && options.resultId !== result.resultId) return;
    if (this.state.resultOkSubmitted && Date.now() - Number(this.state.resultOkSubmittedAt || 0) < 800) return;
    this.state.resultOkSubmitted = true;
    this.state.resultOkSubmittedAt = Date.now();
    this.emit();
    if (isSocketAuthoritativeGame()) {
      const localPlayerId = getLocalHumanPlayerId(this.state);
      try {
        await submitOnlineGameAction("agariYame", { localPlayerId, resultId: result.resultId || "" }, { timeoutMs: 12000 });
      } catch (error) {
        this.state.resultOkSubmitted = false;
        console.warn("[SocketGame] agari yame failed", error);
        this.state.log.unshift(`あがりやめに失敗: ${error.message}`);
        this.emit();
        this.resyncSocketGameState("agariYameFailed").catch(() => {});
      }
      return;
    }
    this.saveReplayForCurrentHand();
    this.state.agariYameDeclaredBy = getLocalHumanPlayerId(this.state);
    this.state.agariYameResultId = result.resultId || "";
    this.state.phase = "gameEnded";
    this.state.pendingAction = null;
    this.state.isWaitingForHumanAction = false;
    this.state.activeClockPlayerId = null;
    this.state.clockStartedAt = null;
    this.emit();
  }
  async leaveOnlineGameToLobby() {
    const sync = loadOnlineSync();
    const activeTableId = this.state.activeTableId || sync?.localTableId || sync?.tableId || "";
    const leavePlayerId = sync?.userId || getLocalHumanPlayerId(this.state);
    const clubId = localStorage.getItem(ONLINE_DEBUG_RETURN_CLUB_KEY) || this.state.activeClubId || this.state.selectedClubId || "";
    const returnUrl = normalizeOnlineDebugReturnUrl(sync?.returnUrl || onlineDebugLobbyUrl(clubId), clubId, sync?.tableId || activeTableId);
    this.clearSocketStartupResyncTimers();
    this.stopAllClocks();
    this.state.pendingAction = null;
    this.state.isWaitingForHumanAction = false;
    this.state.onlineLoadingMessage = "退席して卓一覧へ戻っています...";
    this.emit();
    try {
      await leaveOnlineTableForSync(sync);
    } catch (error) {
      console.warn("[SocketGame] leave on loading failed", error);
    }
    if (activeTableId && leavePlayerId) {
      try { this.leaveSeat(activeTableId, leavePlayerId); } catch {}
    }
    forgetOnlineDebugLaunchCache(sync, activeTableId);
    saveOnlineSync(null);
    try { globalThis.anmikaGameSocket?.disconnect?.(); } catch {}
    window.location.href = returnUrl;
  }
  toggleSettings() {
    this.state.settingsOpen = !this.state.settingsOpen;
    this.emit();
  }
  updateSettings(partial) {
    this.state.settings = { ...this.state.settings, ...partial };
    if (Object.prototype.hasOwnProperty.call(partial, "isLastHand") && this.state.activeTableId) {
      const sync = loadOnlineSync();
      const localPlayerId = getLocalHumanPlayerId(this.state) || sync?.userId || this.currentUserId();
      if (isSocketAuthoritativeGame()) {
        submitOnlineGameAction("declareLastHand", { isLastHand: Boolean(partial.isLastHand), localPlayerId }).catch((error) => {
          console.warn("[SocketGame] last hand failed", error);
          this.state.log.unshift(`ラス半宣言に失敗: ${error.message}`);
          this.emit();
        });
      }
      const table = loadTables().find((item) => item.id === this.state.activeTableId);
      const seat = table?.seats.find((item) => item.playerId === localPlayerId);
      if (table && seat) {
        seat.isLastHandDeclared = Boolean(partial.isLastHand);
        this.syncTable(table);
      }
    }
    if (Object.prototype.hasOwnProperty.call(partial, "initialClockMs") && this.state.phase === "idle") {
      this.state.playerClocks = createPlayerClocks(this.state.players, this.state.settings.initialClockMs);
    }
    this.emit();
  }
  updateAssistSettings(playerId, partial) {
    const player = this.getPlayer(playerId);
    player.assistSettings = { autoWin: false, noCall: false, ...(player.assistSettings ?? {}), ...partial };
    if (this.state.pendingAction?.playerId === playerId && partial.noCall) {
      const previousOptions = getActionOptions(this.state.pendingAction);
      const remainingOptions = getActionOptions(this.state.pendingAction).filter((option) =>
        !(option.type === "pon" || option.type === "kan")
      );
      if (remainingOptions.length) this.state.pendingAction = { ...this.state.pendingAction, options: remainingOptions };
      else {
        const fromPlayerId = previousOptions.find((option) => option.fromPlayerId)?.fromPlayerId || null;
        if (fromPlayerId) {
          this.continueAfterDiscardCallWindow(fromPlayerId);
        } else if (getCurrentPlayer(this.state)?.id === playerId) {
          this.state.pendingAction = null;
          this.state.phase = "waitingForHumanDiscard";
          this.state.isWaitingForHumanAction = true;
          this.startClockForPlayer(playerId);
        } else {
          this.state.pendingAction = null;
        }
      }
    }
    if (partial.noCall === false && getCurrentPlayer(this.state)?.id === playerId) {
      const kakanOption = getKakanActionOption(this.state, player);
      if (kakanOption) {
        const currentOptions = this.state.pendingAction?.playerId === playerId ? getActionOptions(this.state.pendingAction) : [];
        const hasKakan = currentOptions.some((option) => option.type === "kan" && option.options?.kanType === "kakan");
        if (!hasKakan) this.setPendingActions(playerId, [...currentOptions, kakanOption]);
      }
    }
    if (isSocketAuthoritativeGame()) {
      submitOnlineGameAction("assistSettings", { targetPlayerId: playerId, partial, localPlayerId: playerId }).catch((error) => {
        console.warn("[SocketGame] assist settings failed", error);
        this.state.log.unshift(`鳴きなし設定の同期に失敗: ${error.message}`);
        this.emit();
      });
    }
    this.emit();
  }
  openRuleHelp() {
    this.state.ruleHelpOpen = true;
    this.emit();
  }
  closeRuleHelp() {
    this.state.ruleHelpOpen = false;
    this.emit();
  }
  handleTsumogiriShortcut(viewerPlayerId = getLocalHumanPlayerId(this.state)) {
    if (!viewerPlayerId || !canUseTsumogiriShortcut(this.state, viewerPlayerId)) return false;
    const player = getCurrentPlayer(this.state);
    this.discardTile(player.drawnTile.id);
    return true;
  }
  handleDiscardTileClick(tileId) {
    if (!tileId) return;
    if (this.state.selectedDiscardTileId === tileId) {
      this.state.selectedDiscardTileId = null;
      this.discardTile(tileId);
      return;
    }
    const player = getCurrentPlayer(this.state);
    const viewerPlayerId = isSocketAuthoritativeGame() ? loadOnlineSync()?.userId : getLocalHumanPlayerId(this.state);
    const discardStatus = getDiscardStatus(this.state, viewerPlayerId, tileId);
    if (!discardStatus.can) {
      this.state.selectedDiscardTileId = null;
      this.state.discardDebugMessage = `打牌できません: ${discardStatus.reason}`;
      if (isSocketAuthoritativeGame() && /バージョン|局面|手番|フェーズ|pendingAction|演出/.test(discardStatus.reason)) {
        this.resyncSocketGameState("discardSelectBlocked").then((synced) => {
          if (!synced) this.emit();
        });
      } else {
        this.emit();
      }
      return;
    }
    if (!player?.hand?.some((tile) => tile.id === tileId) && player?.drawnTile?.id !== tileId) return;
    this.state.selectedDiscardTileId = tileId;
    this.state.discardDebugMessage = "";
    if (isSocketAuthoritativeGame() && this.state.phase === "waitingForRiichiDiscard" && player?.id === viewerPlayerId) {
      submitOnlineGameAction("selectDiscard", { tileId, localPlayerId: player.id, reason: "riichiSelection" }, { timeoutMs: 3000 }).catch((error) => {
        console.warn("[SocketGame] selected riichi discard sync failed", error);
      });
    }
    this.emit();
  }
  drawTile({ suppressEmit = false } = {}) {
    const player = getCurrentPlayer(this.state);
    if (!this.ruleEngine.canDraw(this.state, player)) return null;
    const tile = this.state.liveWall.shift();
    if (!tile) { this.endExhaustiveDraw(); if (!suppressEmit) this.emit(); return null; }
    player.drawnTile = tile;
    player.sameTurnFuriten = false;
    if (player.isRiichi && player.ippatsu && player.riichiTurnIndex !== null && this.state.turnIndex > player.riichiTurnIndex) {
      player.ippatsuOwnDrawStarted = true;
    }
    this.state.lastDrawnTile = tile;
    this.state.rinshanKaihou = null;
    this.state.pendingRinshanKaihouFromKan = false;
    appendHandLogEvent(this.state.handLog, { type: "draw", playerId: player.id, tile, from: "liveWall", turnIndex: this.state.turnIndex });
    bumpGameStateVersion(this.state);
    appendReplaySnapshot(this.state);
    console.log("[Draw]", player.id, tile); console.log("[Wall]", this.state.liveWall.length);
    if (!suppressEmit) this.emit();
    return tile;
  }
  discardTile(tileId, { isCpuAction = false, suppressEmit = false, suppressCpuAutoProgress = false } = {}) {
    const clickedAt = performance.now?.() ?? Date.now();
    const player = getCurrentPlayer(this.state);
    const activeFever = getActiveFeverRiichiPlayer(this.state);
    if (activeFever && activeFever.id !== player?.id && player?.drawnTile) {
      if (isFlowerTile(player.drawnTile) && this.beginFlowerAnnouncement(player.id, player.drawnTile.id)) return;
      tileId = player.drawnTile.id;
    }
    const viewerPlayerId = isCpuAction ? player?.id : (isSocketAuthoritativeGame() ? loadOnlineSync()?.userId : getLocalHumanPlayerId(this.state));
    const discardStatus = isCpuAction ? { can: true, reason: "" } : getDiscardStatus(this.state, viewerPlayerId, tileId);
    const syncForLog = loadOnlineSync();
    console.log("[DiscardClick] tile=", tileId);
    console.log("[DiscardClick] canDiscard=", discardStatus.can);
    console.log("[DiscardClick] reason=", discardStatus.reason || "OK");
    console.log("[DiscardClick] clientVersion=", syncForLog?.version ?? this.state.version ?? 0);
    console.log("[DiscardClick] serverVersion=", syncForLog?.lastServerState?.version ?? syncForLog?.version ?? this.state.version ?? 0);
    if (!discardStatus.can) {
      this.state.selectedDiscardTileId = null;
      this.state.discardDebugMessage = `打牌できません: ${discardStatus.reason}`;
      console.warn("[Discard] blocked", { tileId, reason: discardStatus.reason, pendingAction: this.state.pendingAction, phase: this.state.phase, version: this.state.version });
      if (isSocketAuthoritativeGame() && /バージョン|局面|手番|フェーズ|pendingAction|演出/.test(discardStatus.reason)) {
        this.resyncSocketGameState("discardBlocked").then((synced) => {
          if (!synced) this.emit();
        });
      } else {
        this.emit();
      }
      return;
    }
    this.state.selectedDiscardTileId = null;
    this.state.discardDebugMessage = "";
    const discardWithoutRiichiFromChoice = isRiichiChoicePending(this.state.pendingAction) && this.state.phase !== "waitingForRiichiDiscard";
    if (!player) {
      console.warn("[Discard] blocked: current player missing", { tileId, phase: this.state.phase });
      return;
    }
    this.stopClockForPlayer(player.id, true);
    const isRiichiDiscardPhase = this.state.phase === "waitingForRiichiDiscard";
    const drawn = player.drawnTile?.id === tileId ? player.drawnTile : null;
    const hand = player.hand.find((t) => t.id === tileId);
    const tile = drawn ?? hand;
    if (!tile) {
      console.warn("[Discard] blocked: tile not found", { tileId, playerId: player.id, drawnTile: player.drawnTile?.id, handCount: player.hand?.length, phase: this.state.phase });
      return;
    }
    if (!isCpuAction && isSocketAuthoritativeGame() && player.type !== "cpu") {
      const onlineActionType = isRiichiDiscardPhase ? "riichi" : "discard";
      const requestId = `discard-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const uiBefore = performance.now?.() ?? Date.now();
      console.log("[DiscardClick] optimistic update");
      playGameSound("discard", { key: `click-discard:${requestId}` });
      this.applyOptimisticDiscard(tileId, requestId, { isRiichiDiscard: isRiichiDiscardPhase });
      console.log("[DiscardPerf] クリック → UI反映", Math.round((performance.now?.() ?? Date.now()) - clickedAt), "ms");
      console.log("[DiscardAction] sent", { onlineActionType, tileId, requestId, version: loadOnlineSync()?.version });
      console.log("[DiscardPerf] クリック → サーバー送信", Math.round((performance.now?.() ?? Date.now()) - clickedAt), "ms");
      submitOnlineGameAction(onlineActionType, { tileId, tile, localPlayerId: player.id, discardRequestId: requestId }, { timeoutMs: 30000 }).catch((error) => {
        console.warn("[DiscardAction] rejected", error);
        if (error?.response?.state) {
          saveOnlineSync({ ...loadOnlineSync(), version: error.response.version ?? loadOnlineSync()?.version ?? 0, lastServerState: error.response.state, lastSyncedAt: Date.now() });
          this.applyOnlineStateSnapshot(error.response.state);
        } else {
          this.resyncSocketGameState("discardRejected").then((synced) => {
            if (!synced) this.rollbackOptimisticDiscard(`打牌できません: ${error.message}`);
          });
        }
        console.warn("[SocketGame] discard action failed", error);
        this.state.discardDebugMessage = `打牌できません: ${error.message}`;
        this.state.log.unshift(`${isRiichiDiscardPhase ? "オンラインリーチ" : "オンライン打牌"}に失敗: ${error.message}`);
        this.emit();
      }).then((response) => {
        if (response) {
          console.log("[DiscardAction] accepted", { version: response.version });
          this.clearOptimisticDiscard();
          this.state.discardDebugMessage = "";
          this.onStateChanged(this.state);
        }
      });
      return;
    }
    if (player.isRiichi && !drawn && !isRiichiDiscardPhase) {
      this.emit();
      return;
    }
    if (isRiichiDiscardPhase && !player.riichiDiscardTileIds.includes(tileId)) {
      this.emit();
      return;
    }
    if (drawn) player.drawnTile = null;
    else {
      player.hand = player.hand.filter((t) => t.id !== tileId);
      if (player.drawnTile) { player.hand.push(player.drawnTile); player.drawnTile = null; player.hand = sortHandTiles(player.hand); }
    }
    const discardType = drawn ? "tsumogiri" : "tedashi";
    player.discardedTiles.push({ tile, discardType, isRiichiDiscard: isRiichiDeclarationDiscard(this.state.phase), turnIndex: this.state.turnIndex });
    if (discardWithoutRiichiFromChoice) this.state.pendingAction = null;
    this.recoverClockAfterDiscard(player.id);
    appendHandLogEvent(this.state.handLog, { type: "discard", playerId: player.id, tile, tileId, selectedTileId: tileId, discardType, isRiichiDiscard: isRiichiDeclarationDiscard(this.state.phase), turnIndex: this.state.turnIndex, isCpuAction: isCpuAction || player.type === "cpu" });
    playGameSound("discard", { key: `local-discard:${player.id}:${this.state.turnIndex}:${tileId}` });
    if (player.isRiichi && player.ippatsu && !isRiichiDiscardPhase) {
      player.ippatsu = false;
      player.ippatsuOwnDrawStarted = false;
      appendHandLogEvent(this.state.handLog, { type: "ippatsuCleared", playerId: player.id, reason: "ownDrawPassed", turnIndex: this.state.turnIndex });
    }
    if (!isCpuAction && player.type !== "cpu") {
      submitOnlineGameAction("discard", { tileId, tile, discardType, localPlayerId: player.id }).catch((error) => {
        console.warn("[OnlineSync] discard event failed", error);
        this.state.log.unshift(`オンライン打牌同期に失敗: ${error.message}`);
        this.emit();
      });
    }
    bumpGameStateVersion(this.state);
    appendReplaySnapshot(this.state);
    console.log("[Discard]", player.id, tile, discardType);
    if (isRiichiDiscardPhase) {
      if (isTsumoLossless3maState(this.state) && !player.riichiStickPaid) {
        player.score = Number(player.score || 0) - 1000;
        player.riichiStickPaid = true;
        this.state.riichiStickCount = Number(this.state.riichiStickCount || 0) + 1;
      }
      player.isRiichi = true;
      player.ippatsu = true;
      player.riichiTurnIndex = this.state.turnIndex;
      player.ippatsuOwnDrawStarted = false;
      player.feverRiichiActive = isFeverRiichiEligibleAfterDiscard(this.state, player, player.hand.filter((tile) => !isFlowerTile(tile)));
      player.feverWinCount = 0;
      appendHandLogEvent(this.state.handLog, { type: "riichi", playerId: player.id, feverRiichiActive: player.feverRiichiActive, turnIndex: this.state.turnIndex });
      this.state.serverAnnouncement = {
        text: player.feverRiichiActive ? "🔥フィーバーリーチ🔥" : "リーチ",
        kind: player.feverRiichiActive ? "fever-riichi" : "riichi",
        playerId: player.id,
      };
      if (this.announcementClearTimer) clearTimeout(this.announcementClearTimer);
      const riichiAnnouncementKind = this.state.serverAnnouncement.kind;
      this.announcementClearTimer = setTimeout(() => {
        if (this.state.serverAnnouncement?.kind === riichiAnnouncementKind) {
          this.state.serverAnnouncement = null;
          this.emit();
        }
      }, player.feverRiichiActive ? 2400 : 1500);
      playGameSound(player.feverRiichiActive ? "feverRiichi" : "riichi", { key: `local-riichi:${player.id}:${this.state.turnIndex}:${player.feverRiichiActive ? "fever" : "normal"}` });
      this.state.log.unshift(player.feverRiichiActive ? `${player.name} フィーバーリーチ` : `${player.name} リーチ`);
    }
    player.riichiDiscardTileIds = [];
    this.state.turnIndex++;
    if (!this.queueResponseAfterDiscard(player.id, tile)) this.continueAfterDiscardCallWindow();
    if (!suppressCpuAutoProgress) this.advanceUntilHumanAction();
    if (!suppressEmit) this.emit();
  }
  confirmPendingAction(actionType) {
    const pending = this.state.pendingAction;
    if (!pending) return;
    const action = actionType ? getActionOptions(pending).find((option) => option.type === actionType) : getActionOptions(pending)[0];
    if (!action) return;
    if (action.type === "riichi") {
      playGameSound("riichi", { key: `riichi-confirm:${action.playerId}:${this.state.turnIndex}` });
    }
    if (isSocketAuthoritativeGame()) {
      submitOnlineGameAction(action.type, { action, localPlayerId: action.playerId }).catch((error) => {
        if (action.type === "ron") console.warn("[Ron] rejected", error);
        console.warn("[SocketGame] action failed", error);
        this.state.log.unshift(`オンライン操作に失敗: ${error.message}`);
        this.emit();
      });
      return;
    }
    submitOnlineGameAction(action.type, { action, localPlayerId: action.playerId }).catch((error) => {
      console.warn("[OnlineSync] action event failed", error);
      this.state.log.unshift(`オンライン操作同期に失敗: ${error.message}`);
      this.emit();
    });
    this.confirmPendingActionFromOption(action);
  }
  skipPendingAction() {
    const pending = this.state.pendingAction;
    if (!pending) return;
    const options = getActionOptions(pending);
    const action = options[0];
    this.stopClockForPlayer(action.playerId, true);
    console.log("[SkipAction]", pending);
    if (isSocketAuthoritativeGame()) {
      submitOnlineGameAction("skip", { pending, localPlayerId: action.playerId }).catch((error) => {
        console.warn("[SocketGame] skip failed", error);
        this.state.log.unshift(`オンラインスキップに失敗: ${error.message}`);
        this.emit();
      });
      return;
    }
    submitOnlineGameAction("skip", { pending, localPlayerId: action.playerId }).catch((error) => {
      console.warn("[OnlineSync] skip event failed", error);
      this.state.log.unshift(`オンラインスキップ同期に失敗: ${error.message}`);
      this.emit();
    });
    for (const option of options) appendHandLogEvent(this.state.handLog, { type: "skipAction", playerId: option.playerId, actionType: option.type, turnIndex: this.state.turnIndex });
    this.state.pendingAction = null;
    if (options.some((option) => option.type === "ron")) this.getPlayer(action.playerId).sameTurnFuriten = true;
    if (options.some((option) => ["ron", "pon", "kan"].includes(option.type) && option.fromPlayerId)) {
      this.continueAfterDiscardCallWindow(options.find((option) => option.fromPlayerId)?.fromPlayerId);
      this.continueGameFlow();
    } else {
      this.waitForHumanDiscard(action.playerId);
    }
    this.emit();
  }
  finishHand(input) {
    const winner = this.getPlayer(input.winnerId ?? getCurrentPlayer(this.state).id);
    const activeFever = getActiveFeverRiichiPlayer(this.state);
    if (activeFever && activeFever.id !== winner.id) {
      console.warn("[FeverRiichi] blocked non-fever win", { feverPlayerId: activeFever.id, winnerId: winner.id, winType: input.winType });
      this.state.lastError = "フィーバーリーチ中はフィーバーリーチ者以外は和了できません";
      this.emit();
      return null;
    }
    const meldTiles = winner.melds.flatMap((meld) => meld.tiles ?? []);
    const winningTiles = [...input.winningTiles, ...(input.drawnTile ? [input.drawnTile] : []), ...meldTiles].filter((t) => !isFlowerTile(t));
    const score = input.scoreResult ?? this.ruleEngine.calculateScore(this.state, winner, { ...input, winnerId: winner.id, dealerPlayerId: this.state.round.dealerPlayerId, playerIds: this.state.players.map((p) => p.id), winningTiles, nukiDoraCount: winner.nukiDoraTiles.length, nukiDoraTiles: winner.nukiDoraTiles });
    if (isTsumoLossless3maState(this.state)) {
      const riichiStickCount = Number(this.state.riichiStickCount || 0);
      const riichiStickPoints = riichiStickCount * 1000;
      if (riichiStickPoints > 0) {
        score.payments ??= Object.fromEntries(this.state.players.map((p) => [p.id, 0]));
        score.payments[winner.id] = Number(score.payments[winner.id] || 0) + riichiStickPoints;
        score.paymentDeltas = Object.entries(score.payments).map(([playerId, delta]) => ({ playerId, delta }));
        score.winnerGain = Number(score.payments[winner.id] || 0);
        score.riichiStickCount = riichiStickCount;
        score.riichiStickPoints = riichiStickPoints;
        this.state.riichiStickCount = 0;
      }
    }
    applyWinPayments(this.state, winner.id, input.winType, score, input.discarderId);
    let isFeverContinuation = false;
    if (winner.feverRiichiActive) {
      winner.feverWinCount = (winner.feverWinCount ?? 0) + 1;
      isFeverContinuation = winner.feverWinCount < 2;
      if (!isFeverContinuation) winner.feverRiichiActive = false;
    }
    for (const player of this.state.players) player.status = player.id === winner.id ? "declared-win" : "waiting";
    const scoringWinningTile = score.selectedWait ?? input.selectedWait ?? winningTiles.at(-1);
    const displayWinningTile = input.displayWinningTile ?? score.displayWinningTile ?? scoringWinningTile;
    appendHandLogEvent(this.state.handLog, { type: "win", winnerId: winner.id, loserId: input.discarderId, winType: input.winType, winningTile: displayWinningTile, scoringWinningTile, scoreResult: score, turnIndex: this.state.turnIndex });
    appendHandLogEvent(this.state.handLog, input.winType === "tsumo" ? { type: "tsumo", playerId: winner.id, tile: displayWinningTile, scoringTile: scoringWinningTile, scoreResult: score, turnIndex: this.state.turnIndex } : { type: "ron", playerId: winner.id, fromPlayerId: input.discarderId, tile: displayWinningTile, scoringTile: scoringWinningTile, scoreResult: score, turnIndex: this.state.turnIndex });
    this.state.handLog.result = { resultId: createId("result"), createdAt: now(), type: "win", winnerId: winner.id, loserId: input.discarderId, winType: input.winType, winningTile: displayWinningTile, scoringWinningTile, scoreResult: score, payments: score.paymentDeltas ?? Object.entries(score.payments ?? {}).map(([playerId, delta]) => ({ playerId, delta })), isFeverContinuation, feverWinCount: winner.feverWinCount ?? 0 };
    score.winningTiles ??= winningTiles;
    score.winningTile ??= scoringWinningTile;
    score.displayWinningTile ??= displayWinningTile;
    bumpGameStateVersion(this.state);
    appendReplaySnapshot(this.state);
    if (!isFeverContinuation) this.saveReplayForCurrentHand();
    console.log("[Result]", this.state.handLog.result);
    this.state.lastScoreResult = score;
    this.state.resultCountdownStartedAt = null;
    this.state.resultCountdownSeconds = RESULT_COUNTDOWN_SECONDS;
    this.state.resultAutoCloseHandled = false;
    this.state.resultOkPlayerIds = [];
    this.state.resultOkSubmitted = false;
    this.state.resultOkSubmittedAt = null;
    this.state.resultOkSubmittedResultId = "";
    this.state.pendingAction = null;
    this.state.phase = "showingWinAnnouncement";
    const pochiAnnouncement = input.winType === "tsumo" ? pochiTsumoAnnouncement(score) : null;
    const announcement = pochiAnnouncement?.text || (input.winType === "tsumo" ? "ツモ" : "ロン");
    this.state.winAnnouncement = announcement;
    this.state.serverAnnouncement = { text: announcement, kind: pochiAnnouncement?.kind || input.winType, playerId: winner.id };
    this.state.isWaitingForHumanAction = false;
    this.stopAllClocks();
    this.state.cpuThinkingPlayerId = null;
    this.state.cpuThinkingMessage = "";
    playGameSound(soundTypeForPochiTsumo(score) || input.winType, { key: `local-win:${this.state.handLog.result?.resultId || this.state.turnIndex}:${input.winType}` });
    this.emit();
    setTimeout(() => {
      if (this.state.phase !== "showingWinAnnouncement") return;
      this.state.winAnnouncement = null;
      this.state.phase = "handEnded";
      this.state.resultCountdownStartedAt = Date.now();
      this.state.resultCountdownSeconds = RESULT_COUNTDOWN_SECONDS;
      this.state.resultAutoCloseHandled = false;
      this.emit();
    }, 2400);
    return score;
  }
  queueResponseAfterDiscard(fromPlayerId, tile) {
    const feverPlayer = getActiveFeverRiichiPlayer(this.state);
    if (feverPlayer) {
      if (feverPlayer.id === fromPlayerId) return false;
      const ron = this.ruleEngine.canWin(this.state, feverPlayer, tile);
      if (ron.canWin && !feverPlayer.sameTurnFuriten && !isPermanentFuriten(this.state, feverPlayer)) {
        this.finishHand({ winnerId: feverPlayer.id, winType: "ron", discarderId: fromPlayerId, yaku: ron.yaku ?? [], winningTiles: [...feverPlayer.hand, tile], selectedWait: tile, isRiichi: feverPlayer.isRiichi, isIppatsu: feverPlayer.ippatsu });
        return true;
      }
      return false;
    }
    const human = this.state.players.find((p) => p.type === "human" && p.id !== fromPlayerId);
    if (!human) return false;
    const options = [];
    const ron = this.ruleEngine.canWin(this.state, human, tile);
    if (ron.canWin && !human.sameTurnFuriten && !isPermanentFuriten(this.state, human)) {
      const option = { type: "ron", playerId: human.id, fromPlayerId, sourceTile: tile, options: { yaku: ron.yaku } };
      if (human.isRiichi || human.assistSettings?.autoWin) {
        this.confirmRon(option);
        return true;
      }
      options.push(option);
    }
    const canCallAfterDiscard = hasLiveWallAfterCurrentDraw(this.state);
    if (canCallAfterDiscard && !human.isRiichi && canDeclareKanNow(this.state) && human.hand.filter((t) => sameTileKind(t, tile)).length >= 3) options.push({ type: "kan", playerId: human.id, fromPlayerId, sourceTile: tile, options: { kanType: "minkan" } });
    if (canCallAfterDiscard && !human.isRiichi && human.hand.filter((t) => sameTileKind(t, tile)).length >= 2) options.push({ type: "pon", playerId: human.id, fromPlayerId, sourceTile: tile });
    if (options.length > 0) return this.setPendingActions(human.id, options);
    return false;
  }
  queueCallAfterDiscard(tile, fromPlayerId, alreadySkippedRon) {
    if (getActiveFeverRiichiPlayer(this.state)) return false;
    const human = this.state.players.find((p) => p.type === "human" && p.id !== fromPlayerId);
    if (!human || !tile) return false;
    if (!hasLiveWallAfterCurrentDraw(this.state)) return false;
    if (!human.isRiichi && canDeclareKanNow(this.state) && human.hand.filter((t) => sameTileKind(t, tile)).length >= 3) return this.setPendingAction({ type: "kan", playerId: human.id, fromPlayerId, sourceTile: tile, options: { kanType: "minkan" } });
    if (!human.isRiichi && human.hand.filter((t) => sameTileKind(t, tile)).length >= 2) return this.setPendingAction({ type: "pon", playerId: human.id, fromPlayerId, sourceTile: tile });
    if (alreadySkippedRon) this.continueAfterDiscardCallWindow(fromPlayerId);
    return false;
  }
  continueAfterDiscardCallWindow(fromPlayerId = null) {
    this.state.pendingAction = null;
    this.state.phase = "playing";
    const fromIndex = this.state.players.findIndex((player) => player.id === fromPlayerId);
    if (fromIndex >= 0) this.state.currentPlayerIndex = fromIndex;
    this.advanceTurn();
  }
  confirmTsumo(action) {
    const player = this.getPlayer(action.playerId);
    const activeFever = getActiveFeverRiichiPlayer(this.state);
    if (activeFever && activeFever.id !== player.id) {
      this.state.lastError = "フィーバーリーチ中はフィーバーリーチ者以外は和了できません";
      this.emit();
      return;
    }
    const tile = player.drawnTile ?? action.sourceTile;
    const pochiResolution = resolvePochiWin(this.state, player, tile, this.ruleEngine);
    if (pochiResolution) {
      this.finishHand({ winnerId: player.id, winType: "tsumo", yaku: pochiResolution.scoreResult.yaku ?? action.options?.yaku ?? [], winningTiles: player.hand, selectedWait: pochiResolution.selectedWait, drawnTile: pochiResolution.selectedWait, displayWinningTile: tile, scoreResult: pochiResolution.scoreResult, isRiichi: player.isRiichi, isIppatsu: player.ippatsu });
      return;
    }
    this.finishHand({ winnerId: player.id, winType: "tsumo", yaku: action.options?.yaku ?? [], winningTiles: player.hand, selectedWait: tile, drawnTile: tile, isRiichi: player.isRiichi, isIppatsu: player.ippatsu });
  }
  confirmRon(action) {
    const player = this.getPlayer(action.playerId);
    const activeFever = getActiveFeverRiichiPlayer(this.state);
    if (activeFever && activeFever.id !== player.id) {
      this.state.lastError = "フィーバーリーチ中はフィーバーリーチ者以外は和了できません";
      this.emit();
      return;
    }
    this.finishHand({ winnerId: player.id, winType: "ron", discarderId: action.fromPlayerId, yaku: action.options?.yaku ?? [], winningTiles: [...player.hand, action.sourceTile], selectedWait: action.sourceTile, isRiichi: player.isRiichi, isIppatsu: player.ippatsu });
  }
  confirmRiichi(action) {
    const player = this.getPlayer(action.playerId);
    player.riichiDiscardTileIds = action.options?.allowedDiscardIds ?? action.options?.discardTileIds ?? this.getRiichiDiscardIds(player.id);
    console.log("[RiichiCandidates]", player.id, player.riichiDiscardTileIds);
    if (player.riichiDiscardTileIds.length === 0) {
      this.waitForHumanDiscard(player.id);
      return;
    }
    this.state.pendingAction = null;
    this.state.currentPlayerIndex = this.state.players.findIndex((p) => p.id === player.id);
    for (const p of this.state.players) p.status = p.id === player.id ? "active" : "waiting";
    this.state.phase = "waitingForRiichiDiscard";
    this.state.isWaitingForHumanAction = true;
    this.startClockForPlayer(player.id);
    playGameSound("riichi", { key: `riichi-button:${player.id}:${this.state.turnIndex}` });
    this.emit();
  }
  confirmPon(action) {
    const player = this.getPlayer(action.playerId);
    if (!hasLiveWallAfterCurrentDraw(this.state)) return;
    const consumed = takeMatchingTiles(player.hand, action.sourceTile, 2);
    if (consumed.length !== 2) return;
    this.removeCalledTileFromDiscard(action.fromPlayerId, action.sourceTile.id);
    player.melds.push({ type: "pon", tiles: [...consumed, action.sourceTile], calledTile: action.sourceTile, fromPlayerId: action.fromPlayerId });
    const ponEvent = { type: "pon", playerId: player.id, fromPlayerId: action.fromPlayerId, tile: action.sourceTile, consumedTiles: consumed, turnIndex: this.state.turnIndex };
    appendHandLogEvent(this.state.handLog, ponEvent);
    this.showActionAnnouncement(ponEvent, { targetState: this.state, durationMs: 1200 });
    appendReplaySnapshot(this.state);
    for (const p of this.state.players) { p.ippatsu = false; p.ippatsuOwnDrawStarted = false; }
    this.state.currentPlayerIndex = this.state.players.findIndex((p) => p.id === player.id);
    for (const p of this.state.players) p.status = p.id === player.id ? "active" : "waiting";
    this.queueRiichiDiscard(player.id);
    this.emit();
  }
  confirmKan(action) {
    const player = this.getPlayer(action.playerId);
    const kanType = action.options?.kanType ?? "ankan";
    if (!canDeclareKanNow(this.state)) return;
    let tiles = [];
    if (kanType === "minkan") {
      const consumed = takeMatchingTiles(player.hand, action.sourceTile, 3);
      if (consumed.length !== 3) return;
      this.removeCalledTileFromDiscard(action.fromPlayerId, action.sourceTile.id);
      tiles = [...consumed, action.sourceTile];
      player.melds.push({ type: "minkan", tiles, calledTile: action.sourceTile, fromPlayerId: action.fromPlayerId });
    } else if (kanType === "kakan") {
      const concealed = [...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])];
      const pon = player.melds.find((m) => m.type === "pon" && concealed.some((tile) => sameTileKind(tile, m.tiles[0])));
      const addTile = pon ? concealed.find((tile) => sameTileKind(tile, pon.tiles[0])) : null;
      if (!pon || !addTile) return;
      removeTileById(player, addTile.id);
      pon.type = "kakan";
      pon.addedTile = addTile;
      pon.tiles.push(addTile);
      tiles = [...pon.tiles];
    } else {
      const group = findFourOfAKind([...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])]);
      if (!group) return;
      for (const tile of group) removeTileById(player, tile.id);
      tiles = group;
      player.melds.push({ type: "ankan", tiles });
    }
    this.state.kanCount++;
    const kanEvent = { type: "kan", playerId: player.id, fromPlayerId: action.fromPlayerId, tiles, kanType, turnIndex: this.state.turnIndex };
    appendHandLogEvent(this.state.handLog, kanEvent);
    this.showActionAnnouncement(kanEvent, { targetState: this.state, durationMs: 1600 });
    appendReplaySnapshot(this.state);
    this.revealAdditionalDoraIndicator("kan");
    if (player.drawnTile) {
      player.hand.push(player.drawnTile);
      player.hand = sortHandTiles(player.hand);
      player.drawnTile = null;
    }
    const rinshan = this.state.rinshanWall.shift();
    if (!rinshan) {
      this.endExhaustiveDraw();
      this.emit();
      return;
    }
    player.drawnTile = rinshan;
    this.state.rinshanKaihou = { playerId: player.id, tileId: rinshan.id };
    this.state.pendingRinshanKaihouFromKan = false;
    appendHandLogEvent(this.state.handLog, { type: "draw", playerId: player.id, tile: rinshan, from: "rinshanWall", turnIndex: this.state.turnIndex });
    appendReplaySnapshot(this.state);
    for (const p of this.state.players) { p.ippatsu = false; p.ippatsuOwnDrawStarted = false; }
    this.state.pendingAction = null;
    if (player.type === "human") this.queueTsumoKanRiichiDiscard(player.id); else this.state.phase = "playing";
    this.emit();
  }
  removeCalledTileFromDiscard(fromPlayerId, tileId) {
    const fromPlayer = this.state.players.find((player) => player.id === fromPlayerId);
    if (!fromPlayer) return;
    const index = [...fromPlayer.discardedTiles].reverse().findIndex((discard) => discard.tile.id === tileId);
    if (index < 0) return;
    fromPlayer.discardedTiles.splice(fromPlayer.discardedTiles.length - 1 - index, 1);
  }
  queueTsumoKanRiichiDiscard(playerId) {
    const player = this.getPlayer(playerId);
    const activeFever = getActiveFeverRiichiPlayer(this.state);
    if (activeFever && activeFever.id !== player.id) {
      this.state.pendingAction = null;
      this.state.phase = "playing";
      this.state.isWaitingForHumanAction = false;
      this.emit();
      if (player.drawnTile) {
        const tsumogiriTileId = player.drawnTile.id;
        setTimeout(() => {
          if (this.state.phase === "playing" && player.drawnTile?.id === tsumogiriTileId) this.discardTile(tsumogiriTileId);
        }, 600);
      }
      return;
    }
    const options = [];
    if (player.drawnTile) {
      if (isWhitePochiTile(player.drawnTile) && player.isRiichi && resolvePochiWin(this.state, player, player.drawnTile, this.ruleEngine)) {
        options.push({ type: "tsumo", playerId, sourceTile: player.drawnTile, options: { pochi: true } });
      } else {
        const tsumo = this.ruleEngine.canWin(this.state, player, player.drawnTile);
        if (tsumo.canWin) options.push({ type: "tsumo", playerId, sourceTile: player.drawnTile, options: { yaku: tsumo.yaku } });
      }
    }
    if (player.isRiichi && canDeclareKanNow(this.state)) {
      const four = findFourOfAKind([...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])]);
      if (four) options.push({ type: "kan", playerId, options: { kanType: "ankan" } });
    }
    if (!player.isRiichi && canDeclareKanNow(this.state)) {
      const four = findFourOfAKind([...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])]);
      if (four) options.push({ type: "kan", playerId, options: { kanType: "ankan" } });
      const concealed = [...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])];
      const canKakan = player.melds.some((meld) => meld.type === "pon" && concealed.some((tile) => sameTileKind(tile, meld.tiles[0])));
      if (canKakan) options.push({ type: "kan", playerId, options: { kanType: "kakan" } });
    }
    const allowedDiscardIds = this.getRiichiDiscardIds(playerId);
    if (!player.isRiichi && allowedDiscardIds.length > 0) options.push({ type: "riichi", playerId, options: { allowedDiscardIds } });
    if (options.length > 0) return this.setPendingActions(playerId, options);
    if (player.isRiichi && player.drawnTile) {
      const tsumogiriTileId = player.drawnTile.id;
      if (player.ippatsu && player.ippatsuOwnDrawStarted) {
        player.ippatsu = false;
        player.ippatsuOwnDrawStarted = false;
      }
      this.state.pendingAction = null;
      this.state.phase = "playing";
      this.state.isWaitingForHumanAction = false;
      this.emit();
      setTimeout(() => {
        if (this.state.phase === "playing" && player.drawnTile?.id === tsumogiriTileId) {
          this.discardTile(tsumogiriTileId);
        }
      }, 600);
      return;
    }
    this.waitForHumanDiscard(playerId);
  }
  queueKanRiichiDiscard(playerId) {
    const player = this.getPlayer(playerId);
    // 簡易実装: リーチ後の暗槓は、待ち変化判定が必要なため現時点では禁止する。
    if (player.isRiichi) return this.queueRiichiDiscard(playerId);
    const four = canDeclareKanNow(this.state) ? findFourOfAKind([...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])]) : null;
    if (four) return this.setPendingAction({ type: "kan", playerId, options: { kanType: "ankan" } });
    if (canDeclareKanNow(this.state)) {
      const concealed = [...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])];
      const canKakan = player.melds.some((meld) => meld.type === "pon" && concealed.some((tile) => sameTileKind(tile, meld.tiles[0])));
      if (canKakan) return this.setPendingAction({ type: "kan", playerId, options: { kanType: "kakan" } });
    }
    this.queueRiichiDiscard(playerId);
  }
  queueRiichiDiscard(playerId) {
    const player = this.getPlayer(playerId);
    const allowedDiscardIds = this.getRiichiDiscardIds(playerId);
    if (!player.isRiichi && allowedDiscardIds.length > 0) return this.setPendingAction({ type: "riichi", playerId, options: { allowedDiscardIds } });
    this.waitForHumanDiscard(playerId);
  }
  canRiichi(playerId) {
    const player = this.getPlayer(playerId);
    if (player.isRiichi) return false;
    if (player.id !== getCurrentPlayer(this.state)?.id) return false;
    if (!["waitingForHumanDiscard", "playing"].includes(this.state.phase)) return false;
    if (!explicitIsMenzen(player) && !hasTurquoise5pInHandOrMelds(player)) return false;
    return this.getRiichiDiscardIds(playerId).length > 0;
  }
  getRiichiDiscardIds(playerId) {
    const player = this.getPlayer(playerId);
    if (player.isRiichi) return [];
    if (!explicitIsMenzen(player) && !hasTurquoise5pInHandOrMelds(player)) return [];
    const tiles = [...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])].filter((tile) => !isFlowerTile(tile));
    const expectedLength = 14 - (player.melds?.length ?? 0) * 3;
    if (tiles.length !== expectedLength) return [];
    return tiles.filter((discard) => {
      const remaining = [...tiles];
      const index = remaining.findIndex((tile) => tile.id === discard.id);
      remaining.splice(index, 1);
      if (!explicitIsMenzen(player) && !hasTurquoise5pInTilesOrMelds(remaining, player.melds ?? [])) return false;
      const waits = getWinningTilesForTenpai(remaining, player.melds ?? []);
      console.log("[WaitAfterDiscard]", formatTile(discard), waits.map(formatTile).join(", "));
      const discardedKinds = new Set([...player.discardedTiles.map((entry) => tileKindKey(entry.tile)), tileKindKey(discard)]);
      return waits.length > 0 && !waits.some((wait) => discardedKinds.has(tileKindKey(wait)));
    }).map((tile) => tile.id);
  }
  getCandidateWinningTiles() {
    return getAllWinningCheckTiles();
  }
  waitForHumanDiscard(playerId) {
    this.state.pendingAction = null;
    this.state.currentPlayerIndex = this.state.players.findIndex((p) => p.id === playerId);
    for (const p of this.state.players) p.status = p.id === playerId ? "active" : "waiting";
    this.state.phase = "waitingForHumanDiscard";
    this.state.isWaitingForHumanAction = true;
    this.startClockForPlayer(playerId);
    const player = this.getPlayer(playerId);
    if (player.ippatsu && player.isRiichi && player.ippatsuOwnDrawStarted) {
      player.ippatsu = false;
      player.ippatsuOwnDrawStarted = false;
    }
    this.normalizeHumanDrawStateForDiscard(player);
    if (player.type === "human") {
      const waits = getWinningTilesForTenpai(this.state, player).map(formatTile).join(", ") || "なし";
      console.log("[CurrentWaits]", waits);
      this.state.log.unshift(`現在の待ち: ${waits}`);
    }
  }
  continueGameFlow() {
    console.log("[Flow] continueGameFlow");
    return this.advanceUntilHumanAction();
  }
  setPendingAction(action) {
    if (this.getPlayer(action.playerId).type === "cpu") return false;
    return this.setPendingActions(action.playerId, [action]);
  }
  setPendingActions(playerId, options) {
    if (this.getPlayer(playerId).type === "cpu" || options.length === 0) return false;
    const player = this.getPlayer(playerId);
    const filteredOptions = filterActionOptionsByAssistSettings(options, player);
    const winOption = filteredOptions.find((option) => option.type === "ron" || option.type === "tsumo");
    if ((player.isRiichi || player.assistSettings?.autoWin) && winOption) {
      this.confirmPendingActionFromOption(winOption);
      return true;
    }
    if (filteredOptions.length === 0) return false;
    this.state.pendingAction = { playerId, options: filteredOptions };
    this.state.phase = "waitingForAction";
    this.state.isWaitingForHumanAction = true;
    this.startClockForPlayer(playerId);
    return true;
  }
  confirmPendingActionFromOption(action) {
    if (!action) return;
    this.stopClockForPlayer(action.playerId, true);
    if (action.type === "tsumo") this.confirmTsumo(action);
    else if (action.type === "ron") this.confirmRon(action);
    else if (action.type === "riichi") this.confirmRiichi(action);
    else if (action.type === "pon") this.confirmPon(action);
    else if (action.type === "kan") this.confirmKan(action);
  }
  advanceTurn() {
    getCurrentPlayer(this.state).status = "waiting";
    this.state.currentPlayerIndex = (this.state.currentPlayerIndex + 1) % this.state.players.length;
    getCurrentPlayer(this.state).status = "active";
    console.log("[NextPlayer]", getCurrentPlayer(this.state).id);
    this.enterCurrentTurn();
  }
  advanceUntilHumanAction() {
    console.log("[Flow] continueGameFlow");
    let guard = 0;
    while (!STOP_PHASES.has(this.state.phase)) {
      if (++guard > MAX_AUTO_TURNS) throw new Error("Auto progress exceeded safety limit.");
      const player = getCurrentPlayer(this.state);
      console.log("[Phase]", this.state.phase);
      console.log("[CurrentPlayer]", player.id, player.type);
      console.log("[HandCount]", player.id, player.hand.length, player.drawnTile ? 1 : 0);
      console.log("[PendingAction]", getActionOptions(this.state.pendingAction).map((option) => option.type).join(",") || "none");
      console.log("[Turn]", player.id, player.type);
      if (this.state.liveWall.length === 0 && !player.drawnTile) { this.endExhaustiveDraw(); break; }
      if (!isAutoControlledPlayerType(player.type)) {
        if (isLocalHumanPlayerType(player.type)) this.enterCurrentTurn();
        this.emit();
        break;
      }
      console.log("[CPU] start turn", player.id);
      this.state.cpuThinkingPlayerId = player.id;
      this.state.cpuThinkingMessage = "";
      this.emit();
      setTimeout(() => {
        this.state.log.unshift(`${player.name} ツモ`);
        processCpuTurn(this.state, this.cpuStrategy, {
          drawTileForCpu: () => this.drawTile({ suppressEmit: true }),
          autoNukiDoraForCurrentTurn: () => this.autoNukiDoraForCurrentTurn(),
          discardTileForCpu: (tileId) => {
            this.state.log.unshift(`${player.name} 打牌`);
            console.log("[CPU] discard", player.id, tileId);
            this.discardTile(tileId, { isCpuAction: true, suppressEmit: true, suppressCpuAutoProgress: true });
          },
        });
        if (this.state.phase === "playing" && getCurrentPlayer(this.state).id === player.id && !player.drawnTile) {
          this.advanceTurn();
        }
        this.state.cpuThinkingPlayerId = null;
        this.state.cpuThinkingMessage = "";
        this.advanceUntilHumanAction();
        this.emit();
      }, 850);
      break;
    }
    return this.state;
  }
  enterCurrentTurn() {
    if (this.state.phase !== "playing") return;
    const player = getCurrentPlayer(this.state);
    if (this.state.liveWall.length === 0 && !player.drawnTile) {
      this.endExhaustiveDraw();
      this.emit();
      return;
    }
    if (!player.drawnTile) this.drawTile({ suppressEmit: true });
    if (this.state.phase === "exhaustiveDraw") return;
    if (this.maybeAnnounceFlowerForCurrentTurn()) return;
    const activeFever = getActiveFeverRiichiPlayer(this.state);
    if (activeFever && activeFever.id !== player.id && player.drawnTile) {
      const tsumogiriTileId = player.drawnTile.id;
      this.state.phase = "playing";
      this.emit();
      setTimeout(() => {
        if (this.state.phase === "playing" && getCurrentPlayer(this.state).id === player.id && player.drawnTile?.id === tsumogiriTileId) {
          this.discardTile(tsumogiriTileId, { isCpuAction: player.type === "cpu" });
        }
      }, 800);
      return;
    }
    this.autoNukiDoraForCurrentTurn();
    if (player.drawnTile && player.feverRiichiActive) {
      const tsumo = this.ruleEngine.canWin(this.state, player, player.drawnTile);
      if (tsumo.canWin) {
        this.finishHand({ winnerId: player.id, winType: "tsumo", yaku: tsumo.yaku ?? [], winningTiles: player.hand, selectedWait: player.drawnTile, drawnTile: player.drawnTile, isRiichi: player.isRiichi, isIppatsu: player.ippatsu });
        return;
      }
    }
    if (player.type === "human") {
      if (player.drawnTile || player.hand.length === 14) this.queueTsumoKanRiichiDiscard(player.id);
      else this.waitForHumanDiscard(player.id);
    }
    else this.state.phase = "playing";
  }
  autoNukiDoraForCurrentTurn() {
    const player = getCurrentPlayer(this.state);
    while (canNukiDora(this.state, player.id)) {
      const flower = player.drawnTile && isFlowerTile(player.drawnTile) ? player.drawnTile : player.hand.find(isFlowerTile);
      if (!flower) break;
      const result = performNukiDoraDetailed(this.state, player.id, flower.id);
      if (result) appendHandLogEvent(this.state.handLog, { type: "nukiDora", playerId: player.id, tile: result.nukiTile, replacementTile: result.replacementTile, turnIndex: this.state.turnIndex, isAfterRiichi: player.isRiichi, ippatsuPreserved: true });
    }
  }
  beginFlowerAnnouncement(playerId, tileId, afterNuki = () => {}) {
    const player = this.getPlayer(playerId);
    const tile = player.drawnTile?.id === tileId ? player.drawnTile : player.hand.find((item) => item.id === tileId);
    if (!tile || !isFlowerTile(tile)) return false;
    this.state.pendingAction = null;
    this.state.phase = "showingFlowerAnnouncement";
    this.state.flowerAnnouncement = player.type === "human" ? "華" : `${player.name} 華`;
    this.state.isWaitingForHumanAction = false;
    this.stopAllClocks();
    this.emit();
    setTimeout(() => {
      if (this.state.phase !== "showingFlowerAnnouncement") return;
      const result = performNukiDoraDetailed(this.state, playerId, tileId);
      if (result) appendHandLogEvent(this.state.handLog, { type: "nukiDora", playerId, tile: result.nukiTile, replacementTile: result.replacementTile, turnIndex: this.state.turnIndex, isAfterRiichi: player.isRiichi, ippatsuPreserved: true });
      appendReplaySnapshot(this.state);
      this.state.flowerAnnouncement = null;
      this.state.phase = "playing";
      afterNuki();
      this.emit();
    }, 1000);
    return true;
  }
  maybeAnnounceFlowerForCurrentTurn() {
    const player = getCurrentPlayer(this.state);
    if (!canNukiDora(this.state, player.id)) return false;
    const flower = player.drawnTile && isFlowerTile(player.drawnTile) ? player.drawnTile : player.hand.find(isFlowerTile);
    if (!flower) return false;
    return this.beginFlowerAnnouncement(player.id, flower.id, () => {
      this.enterCurrentTurn();
      if (getCurrentPlayer(this.state).id === player.id && player.type === "cpu") this.advanceUntilHumanAction();
    });
  }
  revealAdditionalDoraIndicator(reason) {
    const tile = this.state.liveWall.shift();
    const ura = this.state.liveWall.shift();
    if (tile) {
      this.state.doraIndicators ??= [];
      this.state.uraDoraIndicators ??= [];
      this.state.doraIndicators.push(tile);
      if (ura) this.state.uraDoraIndicators.push(ura);
      appendHandLogEvent(this.state.handLog, { type: "doraReveal", tile, doraIndicators: [...this.state.doraIndicators], uraDoraIndicators: [...this.state.uraDoraIndicators], turnIndex: this.state.turnIndex, reason });
    }
  }
  endExhaustiveDraw() {
    if (this.state.handLog.result) return;
    const nagashiWinner = this.state.players.find(isNagashiYakumanPlayer);
    if (nagashiWinner) {
      const yaku = [{ name: "流し役満", han: 13, isYakuman: true }];
      const winningTiles = [...nagashiWinner.hand, ...(nagashiWinner.drawnTile ? [nagashiWinner.drawnTile] : []), ...nagashiWinner.melds.flatMap((meld) => meld.tiles ?? []), ...nagashiWinner.nukiDoraTiles];
      const score = this.ruleEngine.calculateScore(this.state, nagashiWinner, { winnerId: nagashiWinner.id, dealerPlayerId: this.state.round.dealerPlayerId, playerIds: this.state.players.map((p) => p.id), winType: "tsumo", yaku, winningTiles, nukiDoraCount: 0, selectedWait: nagashiWinner.discardedTiles.at(-1)?.tile, isIppatsu: false });
      applyWinPayments(this.state, nagashiWinner.id, "tsumo", score);
      for (const player of this.state.players) player.status = player.id === nagashiWinner.id ? "declared-win" : "waiting";
      this.state.pendingAction = null;
      this.state.phase = "showingWinAnnouncement";
      this.state.winAnnouncement = "ツモ";
      this.state.isWaitingForHumanAction = false;
      this.stopAllClocks();
      this.state.cpuThinkingPlayerId = null;
      this.state.cpuThinkingMessage = "";
      playGameSound("tsumo", { key: `local-nagashi:${this.state.handLog.result?.resultId || this.state.turnIndex}` });
      appendHandLogEvent(this.state.handLog, { type: "win", winnerId: nagashiWinner.id, winType: "tsumo", winningTile: nagashiWinner.discardedTiles.at(-1)?.tile, scoreResult: score, turnIndex: this.state.turnIndex });
      this.state.handLog.result = { resultId: createId("result"), createdAt: now(), type: "win", winnerId: nagashiWinner.id, winType: "tsumo", scoreResult: score, payments: score.paymentDeltas ?? Object.entries(score.payments ?? {}).map(([playerId, delta]) => ({ playerId, delta })) };
      this.state.resultCountdownStartedAt = null;
      this.state.resultCountdownSeconds = RESULT_COUNTDOWN_SECONDS;
      this.state.resultAutoCloseHandled = false;
      this.state.resultOkPlayerIds = [];
      this.state.resultOkSubmitted = false;
      this.state.resultOkSubmittedAt = null;
      this.state.resultOkSubmittedResultId = "";
      appendReplaySnapshot(this.state);
      this.saveReplayForCurrentHand();
      this.emit();
      setTimeout(() => {
        if (this.state.phase !== "showingWinAnnouncement") return;
        this.state.winAnnouncement = null;
        this.state.phase = "handEnded";
        this.state.resultCountdownStartedAt = Date.now();
        this.state.resultCountdownSeconds = RESULT_COUNTDOWN_SECONDS;
        this.state.resultAutoCloseHandled = false;
        this.emit();
      }, 2400);
      return;
    }
    const { tenpaiResults, tenpaiPlayerIds, notenPlayerIds, payments, paymentMap, finalScores } = calculateExhaustiveDrawPayments(this.state);
    const activeTable = this.state.activeTableId ? loadTables().find((table) => table.id === this.state.activeTableId) : null;
    const debugNoPointSettlement = isCpuDebugTable(activeTable);
    const effectivePayments = debugNoPointSettlement ? this.state.players.map((player) => ({ playerId: player.id, delta: 0 })) : payments;
    const effectiveFinalScores = debugNoPointSettlement ? Object.fromEntries(this.state.players.map((player) => [player.id, player.score])) : finalScores;
    if (!debugNoPointSettlement) for (const player of this.state.players) player.score += paymentMap[player.id] ?? 0;
    for (const player of this.state.players) player.status = "waiting";
    this.state.pendingAction = null; this.state.phase = "exhaustiveDraw"; this.state.isWaitingForHumanAction = false;
    this.stopAllClocks();
    this.state.cpuThinkingPlayerId = null;
    this.state.cpuThinkingMessage = "";
    appendHandLogEvent(this.state.handLog, { type: "exhaustiveDraw", turnIndex: this.state.turnIndex, reason: "liveWallEmpty" });
    this.state.handLog.result = { resultId: createId("result"), createdAt: now(), type: "exhaustiveDraw", reason: "liveWallEmpty", tenpaiResults, tenpaiPlayerIds, notenPlayerIds, payments: effectivePayments, finalScores: effectiveFinalScores, debugNoPointSettlement };
    this.state.resultCountdownStartedAt = Date.now();
    this.state.resultCountdownSeconds = RESULT_COUNTDOWN_SECONDS;
    this.state.resultAutoCloseHandled = false;
    this.state.resultOkPlayerIds = [];
    this.state.resultOkSubmitted = false;
    this.state.resultOkSubmittedAt = null;
    this.state.resultOkSubmittedResultId = "";
    appendReplaySnapshot(this.state);
    this.saveReplayForCurrentHand();
    this.state.lastScoreResult = null;
    console.log("[ExhaustiveDraw]", tenpaiResults, payments);
    console.log("[Result]", this.state.handLog.result);
  }
  performNukiDora(playerId, tileId) {
    if (isSocketAuthoritativeGame()) {
      submitOnlineGameAction("nukiDora", { tileId, localPlayerId: playerId }).catch((error) => {
        console.warn("[SocketGame] nukiDora failed", error);
        this.state.log.unshift(`オンライン華牌に失敗: ${error.message}`);
        this.emit();
      });
      return;
    }
    submitOnlineGameAction("nukiDora", { tileId, localPlayerId: playerId }).catch((error) => {
      console.warn("[OnlineSync] nukiDora event failed", error);
      this.state.log.unshift(`オンライン華牌同期に失敗: ${error.message}`);
      this.emit();
    });
    if (this.beginFlowerAnnouncement(playerId, tileId, () => this.queueTsumoKanRiichiDiscard(playerId))) return;
    const player = this.getPlayer(playerId);
    const result = performNukiDoraDetailed(this.state, playerId, tileId);
    if (result) appendHandLogEvent(this.state.handLog, { type: "nukiDora", playerId, tile: result.nukiTile, replacementTile: result.replacementTile, turnIndex: this.state.turnIndex, isAfterRiichi: player?.isRiichi, ippatsuPreserved: true });
    appendReplaySnapshot(this.state);
    this.emit();
  }
  emit() {
    this.onStateChanged(this.state);
    this.scheduleOnlineStatePublish("emit");
  }
}

const renderActionPrompt = (pending, state = null) => {
  const viewerId = state ? getLocalHumanPlayerId(state) : null;
  if (!pending?.options?.length) {
    return "";
  }
  if (viewerId && pending.playerId && pending.playerId !== viewerId) {
    return "";
  }
  if (pending.options.some((option) => option.type === "ron")) {
    console.log("[Ron] available", { playerId: pending.playerId, options: pending.options });
  }
  const labels = { ron: "ロン", tsumo: "ツモ", riichi: "リーチ", pon: "ポン", kan: "カン" };
  const options = pending.options.map((option) => `<button type="button" data-confirm-action="${option.type}">${labels[option.type] ?? option.type}</button>`).join("");
  const skipButton = isRiichiChoicePending(pending) ? "" : `<button type="button" data-skip-action>スキップ</button>`;
  return `<section class="action-prompt mobile-action-prompt"><div class="actions">${options}${skipButton}</div></section>`;
};
const renderNorthNukiButton = (state, viewerPlayerId) => {
  if (state?.pendingAction || !["waitingForHumanDiscard", "waitingForRiichiDiscard", "playing"].includes(state?.phase || "")) return "";
  const north = findManualNorthNukiTile(state, viewerPlayerId);
  if (!north) return "";
  return `<section class="action-prompt mobile-action-prompt north-nuki-prompt"><div class="actions"><button type="button" data-nuki-tile-id="${escapeHtml(north.id)}">北</button></div></section>`;
};
const renderHandLog = (state) => {
  const name = (id) => state.players.find((p) => p.id === id)?.name ?? id;
  const text = (event) => replayEventText(event, state, name);
  return `<section class="hand-log-viewer"><h2>牌譜</h2><p>${state.handLog.roundLabel}</p><ol>${state.handLog.events.map((event) => text(event)).filter(Boolean).map((label) => `<li>${label}</li>`).join("")}</ol></section>`;
};
const replayEventText = (event, state, nameFn = null) => {
  if (!event) return "開始状態";
  const name = nameFn || ((id) => state.players.find((p) => p.id === id)?.name ?? id);
    if (event.type === "draw") return "";
    if (event.type === "discard") return "";
    if (event.type === "ron") return `${name(event.playerId)} ロン ${formatTile(event.tile)}`;
    if (event.type === "tsumo") return `${name(event.playerId)} ツモ和了 ${formatTile(event.tile)}`;
    if (event.type === "riichi") return `${name(event.playerId)} リーチ`;
    if (event.type === "pon") return `${name(event.playerId)} ポン ${formatTile(event.tile)}`;
    if (event.type === "kan") return `${name(event.playerId)} カン`;
    if (event.type === "assistSettings") return "";
    if (event.type === "skipAction") return "";
    if (event.type === "nukiDora") return `${name(event.playerId)} 抜きドラ ${formatTile(event.tile)}`;
    if (event.type === "doraReveal") return `ドラ表示 ${formatTile(event.tile)}`;
    if (event.type === "win") return `${name(event.winnerId)} 和了 ${event.winType}`;
    return "流局";
};
const setRenderSeatMap = (state, seats) => {
  if (!state || !seats) return;
  const map = Object.fromEntries(
    Object.entries(seats)
      .map(([seat, seatView]) => [seatView?.playerId || seatView?.player?.id || "", seat])
      .filter(([playerId]) => playerId)
  );
  try {
    Object.defineProperty(state, "__renderSeatByPlayerId", { value: map, configurable: true });
  } catch {
    state.__renderSeatByPlayerId = map;
  }
};
const seatPositionForPlayer = (state, playerId) => {
  const renderSeat = state?.__renderSeatByPlayerId?.[playerId];
  if (renderSeat) return renderSeat;
  const human = state.players.find((player) => player.type === "human") ?? state.players[0];
  const cpus = state.players.filter((player) => player.id !== human.id);
  if (playerId === human?.id) return "bottom";
  if (playerId === cpus[0]?.id) return "right";
  if (playerId === cpus[1]?.id) return "top";
  return null;
};
const callFromForMeld = (state, ownerId, fromPlayerId) => {
  const ownerSeat = seatPositionForPlayer(state, ownerId);
  const fromSeat = seatPositionForPlayer(state, fromPlayerId);
  if (!ownerSeat || !fromSeat) return "toimen";
  const relation = {
    bottom: { top: "toimen", right: "shimocha" },
    right: { bottom: "kamicha", top: "shimocha" },
    top: { bottom: "toimen", right: "kamicha" },
  }[ownerSeat] ?? {};
  return relation[fromSeat] ?? "toimen";
};
const calledTileIndexForMeld = (state, ownerId, fromPlayerId, tileCount) => {
  if (!fromPlayerId) return -1;
  const callFrom = callFromForMeld(state, ownerId, fromPlayerId);
  if (callFrom === "kamicha") return 0;
  if (callFrom === "shimocha") return tileCount - 1;
  return tileCount === 4 ? 1 : Math.floor(tileCount / 2);
};
const meldRotationClass = (rotation) => rotation ? `meld-rotate-${rotation}` : "";
const MELD_ROTATION_DEGREES = { "": 0, "0": 0, ccw90: 270, "180": 180, cw90: 90 };
const meldRotationTokenFromDegrees = (degrees) => {
  const normalized = ((Number(degrees || 0) % 360) + 360) % 360;
  if (normalized === 90) return "cw90";
  if (normalized === 180) return "180";
  if (normalized === 270) return "ccw90";
  return "0";
};
const composeMeldRotation = (...rotations) => meldRotationTokenFromDegrees(
  rotations.reduce((sum, rotation) => sum + (MELD_ROTATION_DEGREES[rotation] ?? 0), 0)
);
const ownerMeldRotation = (ownerSeat) => {
  if (ownerSeat === "right") return "ccw90";
  if (ownerSeat === "top") return "180";
  return "0";
};
const meldDisplaySpec = (state, ownerId, meld, tileCount) => {
  const ownerSeat = seatPositionForPlayer(state, ownerId);
  const seatRotation = ownerMeldRotation(ownerSeat);
  const calledIndex = meld?.type === "ankan" ? -1 : calledTileIndexForMeld(state, ownerId, meld?.fromPlayerId, tileCount);
  return {
    calledIndex,
    setRotation: seatRotation,
    rotations: Array.from({ length: tileCount }, (_, index) =>
      index === calledIndex ? "cw90" : "0"
    ),
  };
};
const renderMeldSet = (state, ownerId, meld, extraClass = "", options = {}) => {
  const calledTile = meld.calledTile ?? (meld.fromPlayerId ? meld.tiles.at(-1) : null);
  const tileCount = meld.type === "minkan" ? 4 : 3;
  let displaySpec = meldDisplaySpec(state, ownerId, meld, tileCount);
  if (options.noSeatRotation) {
    displaySpec = {
      ...displaySpec,
      setRotation: "0",
      rotations: Array.from({ length: tileCount }, (_, index) =>
        index === displaySpec.calledIndex ? "cw90" : "0"
      ),
    };
  }
  const sidewaysIndex = displaySpec.calledIndex;
  let baseTiles = meld.type === "kakan" ? meld.tiles.slice(0, 3) : [...(meld.tiles || [])];
  if (calledTile && sidewaysIndex >= 0 && baseTiles.length > sidewaysIndex) {
    const otherTiles = baseTiles.filter((tile) => tile.id !== calledTile.id);
    baseTiles = [...otherTiles];
    baseTiles.splice(sidewaysIndex, 0, calledTile);
    baseTiles = baseTiles.slice(0, tileCount);
  }
  const tiles = baseTiles.map((tile, index) => {
    const sideways = index === sidewaysIndex;
    const rotationClass = meldRotationClass(displaySpec.rotations[index]);
    return `<span class="meld-tile ${sideways ? "sideways called-tile" : ""} ${rotationClass}">${renderTileView({ tile })}</span>`;
  }).join("");
  const added = meld.type === "kakan" ? (meld.addedTile ?? meld.tiles.at(-1)) : null;
  const addedRotationClass = meldRotationClass(sidewaysIndex >= 0 ? displaySpec.rotations[sidewaysIndex] : "");
  const setRotationClass = `meld-set-rotate-${displaySpec.setRotation || "0"}`;
  return `<span class="meld-set meld-${meld.type} ${setRotationClass} ${extraClass}" style="--called-index:${Math.max(0, sidewaysIndex)}">
    ${added ? `<span class="kakan-added ${addedRotationClass}">${renderTileView({ tile: added })}</span>` : ""}
    <span class="meld-tiles">${tiles}</span>
  </span>`;
};
const resultHand13Tiles = (score, winner, winningTile) => {
  const explicit = (score?.hand13Tiles ?? score?.tenpaiHandTiles ?? []).filter((tile) => tile && !isFlowerTile(tile));
  if (explicit.length) return sortHandTiles(explicit).slice(0, 13);
  const winnerHand = (winner?.hand ?? []).filter((tile) => tile && !isFlowerTile(tile));
  if (winnerHand.length >= 13) return sortHandTiles(winnerHand).slice(0, 13);
  const winningTileId = winningTile?.id;
  const winningKind = winningTile ? tileKindKey(winningTile) : "";
  let removedWinning = false;
  const fromWinningTiles = (score?.winningTiles ?? [])
    .filter((tile) => tile && !isFlowerTile(tile))
    .filter((tile) => {
      if (removedWinning) return true;
      if ((winningTileId && tile.id === winningTileId) || (!winningTileId && winningKind && tileKindKey(tile) === winningKind)) {
        removedWinning = true;
        return false;
      }
      return true;
    });
  return sortHandTiles(fromWinningTiles).slice(0, 13);
};
const resultMeldsView = (state, winner) => {
  const melds = (winner?.melds ?? []).map((meld) => renderMeldSet(state, winner.id, meld, "result-meld-set", { noSeatRotation: true })).join("");
  return melds ? `<div class="score-meld-block"><strong>副露</strong><div class="result-melds exposed-tiles">${melds}</div></div>` : "";
};
const resultMeldsInlineView = (state, winner) => {
  const melds = (winner?.melds ?? []).map((meld) => renderMeldSet(state, winner.id, meld, "result-meld-set", { noSeatRotation: true })).join("");
  return melds ? `<span class="result-hand-meld-separator"></span><span class="result-melds-inline exposed-tiles">${melds}</span>` : "";
};
class GameView {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    const resultOkClick = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const resultOk = event?.target?.closest?.("[data-result-ok]");
      this.handlers.onResultOk?.(resultOk?.dataset?.resultId || "");
    };
    globalThis.__anmikaResultOkClick = resultOkClick;
    if (typeof window !== "undefined") window.__anmikaResultOkClick = resultOkClick;
  }
  bindStaticControls(start, draw) {
    start?.addEventListener("click", this.handlers.onStart);
    draw?.addEventListener("click", this.handlers.onDraw);
  }
  render(state) {
    if (globalThis.document) {
      globalThis.document.title = state.screen === "replayViewer" ? "牌譜" : "アンミカロケット";
      globalThis.document.documentElement.dataset.gameScreen = state.screen === "game" ? "on" : "off";
      globalThis.document.body.dataset.gameScreen = state.screen === "game" ? "on" : "off";
    }
    if (state.screen !== "game") {
      this.root.innerHTML = this.appShell(state);
      this.bindAppControls();
      return;
    }
    globalThis.dispatchEvent?.(new CustomEvent("anmika-game-screen-active"));
    const current = getCurrentPlayer(state);
    const dealer = state.players.find((p) => p.id === state.round.dealerPlayerId);
    this.root.innerHTML = this.mahjongTableClean(state, current, dealer, getLocalHumanPlayerId(state));
    const bindFastButton = (selector, handler) => {
      this.root.querySelectorAll(selector).forEach((button) => {
        let handledAt = 0;
        const run = (event) => {
          if ((event.type === "pointerdown" || event.type === "mousedown") && event.button !== 0) return;
          if (event.type === "click" && event.button && event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const now = Date.now();
          if (now - handledAt < 180) return;
          handledAt = now;
          handler(button);
        };
        button.addEventListener("pointerdown", run);
        button.addEventListener("click", run);
      });
    };
    bindFastButton("[data-discard-tile-id]", (b) => this.handlers.onDiscard(b.dataset.discardTileId));
    bindFastButton("[data-nuki-tile-id]", (b) => this.handlers.onNuki(b.dataset.nukiTileId));
    bindFastButton("[data-confirm-action]", (b) => this.handlers.onConfirmAction(b.dataset.confirmAction));
    bindFastButton("[data-skip-action]", () => this.handlers.onSkipAction());
    bindFastButton("[data-force-discard-resync]", () => this.handlers.onForceDiscardResync?.());
    const handleResultOkPointer = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onResultOk(event.currentTarget?.dataset?.resultId || "");
    };
    this.root.querySelectorAll("[data-result-ok]").forEach((b) => {
      b.addEventListener("click", handleResultOkPointer);
    });
    this.root.querySelectorAll("[data-agari-yame]").forEach((b) => {
      b.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onAgariYame?.(event.currentTarget?.dataset?.resultId || "");
      });
    });
    this.root.onpointerdown = null;
    this.root.querySelectorAll("[data-final-result-ok]").forEach((b) => b.addEventListener("click", () => this.handlers.onFinalResultOk()));
    this.root.querySelectorAll("[data-leave-online-loading]").forEach((b) => b.addEventListener("click", () => this.handlers.onLeaveOnlineLoading?.()));
    this.root.querySelectorAll("[data-force-table-leave]").forEach((b) => b.addEventListener("click", () => this.handlers.onForceTableLeave?.()));
    this.root.querySelectorAll("[data-page-reload]").forEach((b) => b.addEventListener("click", () => window.location.reload()));
    this.root.querySelectorAll("[data-start-game]").forEach((b) => b.addEventListener("click", () => this.handlers.onStart()));
    this.root.querySelectorAll("[data-settings-toggle]").forEach((b) => b.addEventListener("click", () => this.handlers.onToggleSettings()));
    this.root.querySelectorAll("[data-last-hand]").forEach((input) => input.addEventListener("change", () => this.handlers.onUpdateSettings({ isLastHand: input.checked })));
    this.root.querySelectorAll("[data-assist-auto-win]").forEach((input) => input.addEventListener("change", () => this.handlers.onAssistSettings(input.dataset.playerId, { autoWin: input.checked })));
    this.root.querySelectorAll("[data-assist-no-call]").forEach((input) => input.addEventListener("change", () => this.handlers.onAssistSettings(input.dataset.playerId, { noCall: input.checked })));
    this.stabilizeTableLayout();
  }
  stabilizeTableLayout() {
    if (typeof window === "undefined") return;
    const table = this.root.querySelector(".mahjong-table");
    if (!table) return;
    window.requestAnimationFrame(() => {
      const center = table.querySelector(".center-info");
      const rightRiver = table.querySelector(".discard-right");
      const rightSeat = table.querySelector(".seat-right");
      const rightMelds = table.querySelector(".seat-right .meld-area .exposed-tiles");
      if (!center || !rightRiver || !rightSeat || !rightMelds) return;
      const intersects = (a, b, pad = 4) =>
        a.left < b.right + pad &&
        a.right > b.left - pad &&
        a.top < b.bottom + pad &&
        a.bottom > b.top - pad;
      table.classList.remove("layout-tight-right", "layout-ultra-tight-right");
      const seatBox = rightSeat.getBoundingClientRect();
      const meldBox = rightMelds.getBoundingClientRect();
      const centerBox = center.getBoundingClientRect();
      const riverBox = rightRiver.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const offscreen =
        meldBox.right > viewportWidth - 2 ||
        meldBox.left < 2 ||
        meldBox.top < 2 ||
        meldBox.bottom > viewportHeight - 2;
      const overlapping = intersects(meldBox, centerBox, 6) || intersects(meldBox, riverBox, 6) || intersects(seatBox, riverBox, 2);
      if (!offscreen && !overlapping) return;
      table.classList.add("layout-tight-right");
      window.requestAnimationFrame(() => {
        const nextMeldBox = rightMelds.getBoundingClientRect();
        const nextSeatBox = rightSeat.getBoundingClientRect();
        const nextCenterBox = center.getBoundingClientRect();
        const nextRiverBox = rightRiver.getBoundingClientRect();
        const stillBad =
          nextMeldBox.right > viewportWidth - 2 ||
          nextMeldBox.left < 2 ||
          nextMeldBox.top < 2 ||
          nextMeldBox.bottom > viewportHeight - 2 ||
          intersects(nextMeldBox, nextCenterBox, 4) ||
          intersects(nextMeldBox, nextRiverBox, 4) ||
          intersects(nextSeatBox, nextRiverBox, 2);
        if (stillBad) table.classList.add("layout-ultra-tight-right");
      });
    });
  }
  bindAppControls() {
    this.root.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => this.handlers.onNavigate(b.dataset.nav)));
    this.root.querySelectorAll("[data-debug-login]").forEach((b) => b.addEventListener("click", () => this.handlers.onDebugLogin()));
    this.root.querySelectorAll("[data-login-account]").forEach((b) => b.addEventListener("click", () => {
      this.handlers.onLoginAccount(this.root.querySelector("[data-login-user-id]")?.value ?? "", this.root.querySelector("[data-login-password]")?.value ?? "");
    }));
    this.root.querySelectorAll("[data-create-account]").forEach((b) => b.addEventListener("click", () => {
      this.handlers.onCreateAccount(this.root.querySelector("[data-create-display-name]")?.value ?? "プレイヤー", this.root.querySelector("[data-create-password]")?.value ?? "password");
    }));
    this.root.querySelectorAll("[data-update-account]").forEach((b) => b.addEventListener("click", () => {
      this.handlers.onUpdateAccount({
        displayName: this.root.querySelector("[data-account-display-name]")?.value ?? "",
        password: this.root.querySelector("[data-account-password]")?.value ?? "",
      });
    }));
    this.root.querySelectorAll("[data-account-icon]").forEach((input) => input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener("load", () => this.handlers.onUpdateAccount({ iconUrl: reader.result }));
      reader.readAsDataURL(file);
    }));
    this.root.querySelectorAll("[data-copy-user-id]").forEach((b) => b.addEventListener("click", () => this.handlers.onCopyText(b.dataset.copyUserId, "IDをコピーしました")));
    this.root.querySelectorAll("[data-copy-club-id]").forEach((b) => b.addEventListener("click", () => this.handlers.onCopyText(b.dataset.copyClubId, "クラブIDをコピーしました")));
    this.root.querySelectorAll("[data-copy-table-url]").forEach((b) => b.addEventListener("click", () => this.handlers.onCopyTableUrl(b.dataset.copyTableUrl)));
    this.root.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", () => this.handlers.onOpenLogoutConfirm()));
    this.root.querySelectorAll("[data-confirm-logout]").forEach((b) => b.addEventListener("click", () => this.handlers.onConfirmLogout()));
    this.root.querySelectorAll("[data-cancel-logout]").forEach((b) => b.addEventListener("click", () => this.handlers.onCancelLogout()));
    this.root.querySelectorAll("[data-enter-club]").forEach((b) => b.addEventListener("click", () => this.handlers.onEnterClub(b.dataset.enterClub)));
    this.root.querySelectorAll("[data-create-club]").forEach((b) => b.addEventListener("click", () => {
      const input = this.root.querySelector("[data-create-club-name]");
      this.handlers.onCreateClub(input?.value || "マイクラブ");
    }));
    this.root.querySelectorAll("[data-open-create-table]").forEach((b) => b.addEventListener("click", () => this.handlers.onOpenCreateTable()));
    this.root.querySelectorAll("[data-create-table-submit]").forEach((b) => b.addEventListener("click", () => this.handlers.onCreateTableSubmit()));
    this.root.querySelectorAll("[data-create-table-game]").forEach((input) => input.addEventListener("change", () => {
      if (!input.checked || input.disabled) return;
      this.handlers.onUpdateCreateTableSettings({ ruleId: input.value, gameType: input.value });
    }));
    this.root.querySelectorAll("[data-create-table-rake]").forEach((input) => input.addEventListener("input", () => this.handlers.onUpdateCreateTableSettings({ rakePercent: Number(input.value) })));
    this.root.querySelectorAll("[data-create-table-point-rate]").forEach((input) => input.addEventListener("input", () => this.handlers.onUpdateCreateTableSettings({ pointRate: Number(input.value) })));
    this.root.querySelectorAll("[data-rule-config-turquoise]").forEach((select) => select.addEventListener("change", () => this.handlers.onUpdateCreateTableSettings({ ruleConfig: { turquoise5pCount: Number(select.value) } })));
    this.root.querySelectorAll("[data-rule-config-key]").forEach((input) => input.addEventListener("change", () => {
      const key = input.dataset.ruleConfigKey;
      const value = input.type === "checkbox" ? input.checked : input.value;
      this.handlers.onUpdateCreateTableSettings({ ruleConfig: { [key]: value } });
    }));
    this.root.querySelectorAll("[data-rule-config-number]").forEach((input) => input.addEventListener("input", () => {
      const key = input.dataset.ruleConfigNumber;
      this.handlers.onUpdateCreateTableSettings({ ruleConfig: { [key]: Number(input.value) } });
    }));
    this.root.querySelectorAll("[data-create-table]").forEach((b) => b.addEventListener("click", () => this.handlers.onCreateTable()));
    this.root.querySelectorAll("[data-open-table]").forEach((b) => b.addEventListener("click", () => this.handlers.onOpenTable(b.dataset.openTable)));
    this.root.querySelectorAll("[data-rule-help]").forEach((b) => b.addEventListener("click", () => this.handlers.onOpenRuleHelp()));
    this.root.querySelectorAll("[data-close-rule-help]").forEach((b) => b.addEventListener("click", () => this.handlers.onCloseRuleHelp()));
    this.root.querySelectorAll("[data-join-seat]").forEach((b) => b.addEventListener("click", () => this.handlers.onJoinSeat(b.dataset.tableId, Number(b.dataset.joinSeat))));
    this.root.querySelectorAll("[data-fill-cpu]").forEach((b) => b.addEventListener("click", () => this.handlers.onFillCpu(b.dataset.fillCpu)));
    this.root.querySelectorAll("[data-leave-seat]").forEach((b) => b.addEventListener("click", () => this.handlers.onLeaveSeat(b.dataset.leaveSeat)));
    this.root.querySelectorAll("[data-delete-table]").forEach((b) => b.addEventListener("click", () => this.handlers.onDeleteTable(b.dataset.deleteTable)));
    this.root.querySelectorAll("[data-join-waiting]").forEach((b) => b.addEventListener("click", () => this.handlers.onJoinWaiting(b.dataset.joinWaiting)));
    this.root.querySelectorAll("[data-seat-last-hand]").forEach((input) => input.addEventListener("change", () => this.handlers.onSeatLastHand(input.dataset.tableId, input.checked)));
    this.root.querySelectorAll("[data-open-replay]").forEach((b) => b.addEventListener("click", (event) => {
      event.preventDefault();
      this.handlers.onOpenReplay(b.dataset.openReplay);
    }));
    this.root.querySelectorAll("[data-replay-card]").forEach((card) => card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      this.handlers.onOpenReplay(card.dataset.replayCard);
    }));
    this.root.querySelectorAll("[data-copy-replay-url]").forEach((b) => b.addEventListener("click", () => this.handlers.onCopyReplayUrl(b.dataset.copyReplayUrl)));
    const bindReplayHoldStep = (element, getDelta, { ignoreInteractive = false } = {}) => {
      let holdDelay = null;
      let holdInterval = null;
      let pointerHandledAt = 0;
      const stopHold = () => {
        if (holdDelay) clearTimeout(holdDelay);
        if (holdInterval) clearInterval(holdInterval);
        holdDelay = null;
        holdInterval = null;
      };
      const step = () => {
        if (element.disabled) {
          stopHold();
          return;
        }
        this.handlers.onReplayStep(Number(getDelta() || 0));
      };
      element.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (ignoreInteractive && event.target.closest("button, a, select, input, label, textarea, [data-replay-control]")) return;
        event.preventDefault();
        pointerHandledAt = Date.now();
        step();
        stopHold();
        window.addEventListener("pointerup", stopHold, { once: true });
        window.addEventListener("pointercancel", stopHold, { once: true });
        holdDelay = setTimeout(() => {
          holdInterval = setInterval(step, 170);
        }, 360);
      });
      ["pointerup", "pointercancel", "pointerleave", "blur"].forEach((type) => element.addEventListener(type, stopHold));
      element.addEventListener("click", (event) => {
        if (ignoreInteractive && event.target.closest("button, a, select, input, label, textarea, [data-replay-control]")) return;
        if (Date.now() - pointerHandledAt < 260) {
          event.preventDefault();
          return;
        }
        step();
      });
    };
    this.root.querySelectorAll("[data-replay-step]").forEach((b) => bindReplayHoldStep(b, () => Number(b.dataset.replayStep || 0)));
    this.root.querySelectorAll("[data-replay-hand-select]").forEach((select) => select.addEventListener("change", () => this.handlers.onReplayIndex(Number(select.value || 0))));
    this.root.querySelectorAll("[data-replay-viewer]").forEach((select) => select.addEventListener("change", () => this.handlers.onReplayViewer(select.value)));
    this.root.querySelectorAll("[data-replay-reveal-hands]").forEach((input) => input.addEventListener("change", () => this.handlers.onReplayRevealHands(input.checked)));
    this.root.querySelectorAll("[data-replay-screen]").forEach((screen) => {
      bindReplayHoldStep(screen, () => 1, { ignoreInteractive: true });
      screen.addEventListener("wheel", (event) => {
        event.preventDefault();
        if (event.deltaY > 1) this.handlers.onReplayNext();
        else if (event.deltaY < -1) this.handlers.onReplayPrev();
      }, { passive: false });
    });
    this.root.querySelectorAll("[data-club-search]").forEach((b) => b.addEventListener("click", () => {
      const input = this.root.querySelector("[data-club-search-input]");
      this.handlers.onClubSearch(input?.value ?? "");
    }));
    this.root.querySelectorAll("[data-open-club]").forEach((b) => b.addEventListener("click", () => this.handlers.onOpenClub(b.dataset.openClub)));
    this.root.querySelectorAll("[data-apply-club]").forEach((b) => b.addEventListener("click", () => this.handlers.onApplyClub(b.dataset.applyClub)));
    this.root.querySelectorAll("[data-approve-applicant]").forEach((b) => b.addEventListener("click", () => this.handlers.onApproveApplicant(b.dataset.clubId, b.dataset.approveApplicant)));
    this.root.querySelectorAll("[data-reject-applicant]").forEach((b) => b.addEventListener("click", () => this.handlers.onRejectApplicant(b.dataset.clubId, b.dataset.rejectApplicant)));
    this.root.querySelectorAll("[data-create-club-table]").forEach((b) => b.addEventListener("click", () => this.handlers.onCreateClubTable(b.dataset.createClubTable)));
    this.root.querySelectorAll("[data-transfer-points]").forEach((b) => b.addEventListener("click", () => this.handlers.onTransferPoints(b.dataset.clubId, b.dataset.transferPoints, 100)));
    this.root.querySelectorAll("[data-collect-points]").forEach((b) => b.addEventListener("click", () => this.handlers.onCollectPoints(b.dataset.clubId, b.dataset.collectPoints, 100)));
    this.root.querySelectorAll("[data-grant-club-admin]").forEach((b) => b.addEventListener("click", () => this.handlers.onGrantClubAdmin?.(b.dataset.clubId, b.dataset.grantClubAdmin)));
    this.root.querySelectorAll("[data-remove-club-member]").forEach((b) => b.addEventListener("click", () => this.handlers.onRemoveClubMember?.(b.dataset.clubId, b.dataset.removeClubMember)));
  }
  appShell(state) {
    if (state.screen === "replayViewer") return this.replayViewerScreen(state);
    const title = { auth: "ログイン", clubSelect: "クラブ選択", accountSettings: "アカウント設定", onlineTodo: "未決定仕様", clubHome: "クラブ内ホーム", clubTables: "クラブ内卓一覧", createTable: "卓作成", memberManagement: "メンバー管理", home: "ホーム", tableList: "卓一覧", tableRoom: "卓詳細", replayList: "牌譜一覧", replayViewer: "牌譜再生", clubList: "クラブ一覧", clubDetail: "クラブ詳細" }[state.screen] ?? "ホーム";
    return `<section class="lobby-shell">
      <header class="lobby-header"><h2>アンミカロケット</h2><p>${title}</p></header>
      ${state.screen === "auth" ? this.authScreen(state) : ""}
      ${state.screen === "clubSelect" ? this.clubSelectScreen(state) : ""}
      ${state.screen === "accountSettings" ? this.accountSettingsScreen(state) : ""}
      ${state.screen === "onlineTodo" ? this.onlineTodoScreen(state) : ""}
      ${state.screen === "clubHome" ? this.clubHomeScreen(state) : ""}
      ${state.screen === "clubTables" ? this.clubTableListScreen(state) : ""}
      ${state.screen === "createTable" ? this.createTableScreen(state) : ""}
      ${state.screen === "memberManagement" ? this.memberManagementScreen(state) : ""}
      ${state.screen === "home" ? this.homeScreen() : ""}
      ${state.screen === "tableList" ? this.tableListScreen(state) : ""}
      ${state.screen === "tableRoom" ? this.tableRoomScreen(state) : ""}
      ${state.screen === "replayList" ? this.replayListScreen(state) : ""}
      ${state.screen === "clubList" ? this.clubListScreen(state) : ""}
      ${state.screen === "clubDetail" ? this.clubDetailScreen(state) : ""}
      ${state.ruleHelpOpen ? this.ruleHelpModal() : ""}
      ${state.logoutConfirmOpen ? this.logoutConfirmModal() : ""}
      ${state.toastMessage ? `<div class="toast-message">${state.toastMessage}</div>` : ""}
    </section>`;
  }
  logoutConfirmModal() {
    return `<div class="result-backdrop">
      <section class="result-modal logout-confirm-modal">
        <h2>本当にログアウトしますか？</h2>
        <div class="screen-actions">
          <button type="button" class="danger-action" data-confirm-logout>はい</button>
          <button type="button" data-cancel-logout>いいえ</button>
        </div>
      </section>
    </div>`;
  }
  ruleHelpModal() {
    return `<div class="result-backdrop rule-help-backdrop">
      <section class="result-modal rule-help-modal">
        <h2>アンミカロケット ルール</h2>
        <h3>基本</h3>
        <ul>
          <li>3人麻雀</li><li>東場固定</li><li>和了者が次局の親</li><li>リーチ棒なし</li><li>独自点数表を採用</li>
        </ul>
        <h3>特殊牌</h3>
        <h4>白ぽっち</h4>
        <p>白は全て白ぽっちです。リーチ後にツモると、待ち牌の中で最も点数変動が大きい牌として扱われます。</p>
        <ul><li>赤ぽっち: 点数×-2</li><li>黄ぽっち: 点数×-1</li><li>緑ぽっち: 点数×1</li><li>青ぽっち: 点数×2</li></ul>
        <h4>白待ちと白ぽっち</h4>
        <p>待ち牌に白が含まれる場合、白ぽっちをツモった時は通常の白として扱う候補も含めて判定します。白待ちだから必ず白になるわけではなく、白・赤5p・青5pなどの候補を比較し、最終点数の絶対値が最大になるものを採用します。</p>
        <h4>華牌</h4>
        <p>華牌は抜きドラです。手牌から抜き、嶺上牌から補充し、和了時はドラ扱いです。</p>
        <h4>色付き牌</h4>
        <p>赤牌・金牌・ロケット牌（青牌）はドラです。金牌は+5点、ロケット牌（青牌）は+20点の追加点があります。</p>
        <h3>ロケット牌（青牌）</h3>
        <p>1・9牌ロケットON時、1m/9m/1p/9p/1s/9sにロケット牌（青牌）が入ります。和了形で使用すると+20点です。</p>
        <h3>ターコイズ5p</h3>
        <p>ターコイズ5pを使用している場合、副露していてもリーチ可能です。</p>
        <h3>フィーバーリーチ</h3>
        <p>7pまたは7sが完全暗刻の状態でリーチした場合、フィーバーリーチになります。フィーバーリーチ中は他家が強制ツモ切りになり、最大2回和了できます。2回目の和了では華牌・カン・ドラなどの増加分を再計算します。</p>
        <h3>漢気ルール</h3>
        <p>ONでは門前和了にリーチ必須です。例外は国士無双と人和です。OFFでは役があればダマテン和了できます。</p>
        <h3>本役満</h3>
        <ul><li>人和</li><li>萬子混一色</li><li>大車輪</li><li>流し役満</li><li>緑一色</li><li>大三元</li><li>地和</li><li>天和</li><li>九蓮宝燈</li><li>四暗刻</li><li>四槓子</li><li>国士無双</li></ul>
        <h3>点数</h3>
        <p>符計算は使わず、翻数だけで独自点数表を参照します。子4翻は8点、親4翻は12点の満貫です。</p>
        <button type="button" class="primary-action" data-close-rule-help>閉じる</button>
      </section>
    </div>`;
  }
  authScreen(_state) {
    return `<section class="lobby-panel auth-screen">
      <h2>アンミカロケット</h2>
      <p>ログイン済みの場合は次回起動時に自動でクラブ選択へ進みます。現在はlocalStorage認証です。</p>
      <div class="auth-grid">
        <section class="auth-box">
          <h3>ログイン</h3>
          <label>ユーザーID<input type="text" data-login-user-id placeholder="P-8F1D3A" /></label>
          <label>パスワード<input type="password" data-login-password /></label>
          <button type="button" data-login-account>ログイン</button>
        </section>
        <section class="auth-box">
          <h3>アカウント作成</h3>
          <label>プレイヤー名<input type="text" data-create-display-name placeholder="プレイヤー名" /></label>
          <label>パスワード<input type="password" data-create-password /></label>
          <button type="button" data-create-account>作成してログイン</button>
        </section>
      </div>
      <button type="button" data-debug-login>デバッグログイン</button>
    </section>`;
  }
  accountSettingsScreen(state) {
    const user = state.currentUser;
    if (!user) return this.authScreen(state);
    const clubs = clubRepository.listMyClubs(user.id);
    const clubList = clubs.map((club) => `<li><span>${club.name}</span><span class="inline-id">ID: ${club.id}</span><button type="button" data-copy-club-id="${club.id}">コピー</button></li>`).join("") || "<li>未所属</li>";
    return `<section class="lobby-panel">
      <div class="screen-actions"><button type="button" data-nav="clubSelect">クラブ選択へ</button></div>
      <h3>アカウント設定</h3>
      <label class="setting-row"><span>アイコン</span><input type="file" accept="image/*" data-account-icon /> <small>現在はlocalStorageに保存します</small></label>
      <label class="setting-row"><span>プレイヤー名</span><input type="text" data-account-display-name value="${user.displayName ?? ""}" /></label>
      <label class="setting-row"><span>新しいパスワード</span><input type="password" data-account-password placeholder="変更時のみ入力" /></label>
      <div class="screen-actions">
        <button type="button" data-update-account>保存</button>
      </div>
      <section class="settings-info-block">
        <h4>ID確認</h4>
        <p><strong>ID:</strong> <span class="inline-id">${user.id}</span> <button type="button" data-copy-user-id="${user.id}">コピー</button></p>
      </section>
      <section class="settings-info-block">
        <h4>クラブ情報</h4>
        <ul class="settings-club-list">${clubList}</ul>
      </section>
      <hr class="settings-divider" />
      <div class="settings-logout-row">
        <button type="button" class="danger-action" data-logout>ログアウト</button>
      </div>
    </section>`;
  }
  onlineTodoScreen(_state) {
    return `<section class="lobby-panel">
      <div class="screen-actions"><button type="button" data-nav="clubSelect">クラブ選択へ</button></div>
      <h3>未決定仕様 / オンライン移行TODO</h3>
      <ul>
        <li>切断: プレイヤーが落ちたらオートツモ切り</li>
        <li>再接続: 途中参加不可。局や半荘終了後、ラス半プレイヤーがいた時のみ参加可能</li>
        <li>観戦: 許可する</li>
        <li>同時ロン: 3人麻雀ではダブロン許可</li>
        <li>クラブポイント精算: ゲーム種別依存。アンミカロケットは局終了ごと、四人麻雀などは半荘終了後</li>
        <li>卓の最大保持数: 100卓まで</li>
        <li>同期方式: REST API / WebSocket / Firebase / Supabase / Node.jsへRepository差し替え</li>
      </ul>
    </section>`;
  }
  clubSelectScreen(state) {
    const user = state.currentUser;
    const myClubs = user ? clubRepository.listMyClubs(user.id) : [];
    const ownedClub = user ? loadClubs().find((club) => club.ownerUserId === user.id) : null;
    const pendingClubs = state.clubs.filter((club) => normalizeClub(club).pendingApplicants.includes(user?.id));
    const found = state.clubSearchResultId ? clubRepository.getClub(state.clubSearchResultId) : null;
    return `<section class="lobby-panel">
      <div class="screen-actions"><button type="button" data-nav="accountSettings">設定</button><button type="button" data-nav="onlineTodo">未決定仕様</button><button type="button" data-nav="auth">ログイン画面</button></div>
      <h3>所属クラブ</h3>
      <div class="card-grid">${myClubs.map((club) => `<article class="lobby-card">
        <h3>${club.name}</h3><p>ID: ${club.id} <button type="button" data-copy-club-id="${club.id}">コピー</button></p><p>${club.description ?? ""}</p>
        <button type="button" data-enter-club="${club.id}">入る</button>
      </article>`).join("") || "<p>所属クラブがありません。</p>"}</div>
      <h3>クラブIDで検索して加入申請</h3>
      <div class="club-search"><input type="text" data-club-search-input value="${state.clubSearchId ?? ""}" placeholder="club-demo" /><button type="button" data-club-search>検索</button></div>
      ${found ? `<article class="lobby-card"><h3>${found.name}</h3><p>ID: ${found.id} <button type="button" data-copy-club-id="${found.id}">コピー</button></p><p>${found.description ?? ""}</p>${isClubMember(user?.id, found) ? `<button type="button" data-enter-club="${found.id}">入る</button>` : `<button type="button" data-apply-club="${found.id}">加入申請</button>`}</article>` : ""}
      <h3>クラブ作成</h3>
      ${ownedClub ? `<p>クラブ作成は1アカウントにつき1つまでです。作成済み: ${ownedClub.name} (${ownedClub.id}) <button type="button" data-copy-club-id="${ownedClub.id}">コピー</button></p>` : `<div class="club-search"><input type="text" data-create-club-name placeholder="クラブ名" /><button type="button" data-create-club>クラブ作成</button></div>`}
      <h3>加入申請中</h3>
      <ul>${pendingClubs.map((club) => `<li>${club.name} (${club.id})</li>`).join("") || "<li>なし</li>"}</ul>
    </section>`;
  }
  selectedClub(state) {
    return state.selectedClubId ? clubRepository.getClub(state.selectedClubId) : null;
  }
  clubHomeScreen(state) {
    const club = this.selectedClub(state);
    if (!club || !state.currentUser || !isClubMember(state.currentUser.id, club)) return `<section class="lobby-panel"><button type="button" data-nav="clubSelect">クラブ選択へ</button><p>クラブを選択してください。</p></section>`;
    const role = getClubRole(state.currentUser.id, club);
    const replays = replayRepository.listReplaysByClub(club.id);
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="clubSelect">クラブ選択へ</button></div>
      <h2>${club.name}</h2>
      <p>ID: ${club.id} <button type="button" data-copy-club-id="${club.id}">コピー</button></p>
      <p>${club.description ?? ""}</p>
      <p>自分の権限: ${role === "admin" ? "管理者" : "メンバー"} / 自分のクラブポイント: ${getClubMemberPoint(state.currentUser.id, club)}</p>
      <p>クラブポイント: ${club.clubPointBalance} / レーキ残高: ${club.rakeBalance}</p>
      <div class="screen-actions">
        <button type="button" data-nav="clubTables">卓一覧</button>
        <button type="button" data-nav="replayList">牌譜一覧</button>
        <button type="button" data-nav="memberManagement">メンバー一覧</button>
        ${canCreateTable(state.currentUser.id, club) ? `<button type="button" data-open-create-table>卓作成</button>` : ""}
      </div>
      <h3>最近の牌譜</h3>
      <ul>${replays.slice(0, 5).map((summary) => `<li>${summary.resultLabel} <a href="${replayUrlFor(summary.replayId)}" data-open-replay="${summary.replayId}">再生</a></li>`).join("") || "<li>なし</li>"}</ul>
    </section>`;
  }
  clubTableListScreen(state) {
    const club = this.selectedClub(state);
    if (!club || !state.currentUser || !isClubMember(state.currentUser.id, club)) return `<section class="lobby-panel"><button type="button" data-nav="clubSelect">クラブ選択へ</button><p>このクラブの卓を見る権限がありません。</p></section>`;
    const tables = tableRepository.listTablesByClub(club.id);
    const currentUserId = state.currentUser.id;
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="clubHome">クラブホーム</button>${canCreateTable(state.currentUser.id, club) ? `<button type="button" data-open-create-table>卓作成</button>` : ""}</div>
      <h3>${club.name} の卓一覧</h3>
      <div class="card-grid">${tables.map((table) => {
        const seated = table.seats.some((seat) => seat.playerId === currentUserId);
        const emptySeat = getJoinableSeat(table);
        const waiting = table.waitingList?.includes(currentUserId);
        const rule = GAME_RULE_DEFINITIONS.find((item) => item.id === table.ruleId)?.name ?? table.ruleId;
        return `<article class="lobby-card"><h3>${table.name}</h3><p>${rule} / 1点=${Number(table.pointRate ?? 1).toFixed(1)}pt / レーキ ${table.rakePercent ?? 0}% / ${table.status}${isCpuDebugTable(table) ? " / CPUデバッグ" : ""}</p>
          <p>着席: ${table.seats.filter((seat) => seat.playerId).length} / 3</p>
          <div class="screen-actions"><button type="button" data-open-table="${table.id}">開く</button><button type="button" data-rule-help>ルール</button>
          ${seated ? `<button type="button" data-leave-seat="${table.id}">卓を抜ける</button>` : canSitAtTable(table) && emptySeat ? `<button type="button" data-table-id="${table.id}" data-join-seat="${emptySeat.seatIndex}">座る</button>` : ""}
          <button type="button" data-join-waiting="${table.id}">${waiting ? "ウェイティングを抜ける" : "ウェイティングに入る"}</button>
          ${canDeleteTableRoom(table) ? `<button type="button" data-delete-table="${table.id}">削除</button>` : ""}</div></article>`;
      }).join("") || "<p>卓がありません。</p>"}</div>
    </section>`;
  }
  createTableScreen(state) {
    const club = this.selectedClub(state);
    if (!club || !state.currentUser || !canCreateTable(state.currentUser.id, club)) return `<section class="lobby-panel"><button type="button" data-nav="clubHome">戻る</button><p>卓作成は管理者だけができます。</p></section>`;
    const settings = state.createTableSettings ?? createDefaultTableSettings();
    const isTsumoLossless = settings.ruleId === TSUMO_LOSSLESS_3MA_RULE_ID;
    const anmikaConfig = normalizeAnmikaRocketRuleConfig(settings.ruleConfig);
    const threeMaConfig = normalizeTsumoLossless3maRuleConfig(settings.ruleConfig);
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="clubTables">卓一覧へ</button></div>
      <h3>卓作成</h3>
      <fieldset class="setting-row rule-choice-group">
        <legend>ゲーム種別</legend>
        ${GAME_RULE_DEFINITIONS.map((rule) => `<label class="radio-row ${rule.implemented ? "" : "disabled"}">
          <input type="radio" name="create-table-game" value="${rule.id}" data-create-table-game ${settings.ruleId === rule.id ? "checked" : ""} ${rule.implemented ? "" : "disabled"} />
          ${rule.name}${rule.implemented ? "" : "（未実装）"}
        </label>`).join("")}
      </fieldset>
      <section class="rule-config-panel">
        <h4>ルール設定</h4>
        <label class="setting-row"><span>${isTsumoLossless ? "レート: 1000点 = " : "レート: 1点 = "}${Number(settings.pointRate ?? 1).toFixed(1)}ポイント</span><input type="range" min="0.1" max="10" step="0.1" value="${settings.pointRate ?? 1}" data-create-table-point-rate /></label>
        ${isTsumoLossless ? `
          <label class="setting-row"><span>5p・5sの内訳</span><select data-rule-config-key="fiveTileComposition">
            ${[["red3blue1", "赤赤赤青"], ["red4", "赤赤赤赤"], ["red2blue2", "赤赤青青"], ["blackBlackRedRed", "黒黒赤赤"]].map(([value, label]) => `<option value="${value}" ${threeMaConfig.fiveTileComposition === value ? "selected" : ""}>${label}</option>`).join("")}
          </select></label>
          <label class="setting-row"><span>華牌の構成</span><select data-rule-config-key="flowerComposition">
            ${[["red3blue1", "赤赤赤青"], ["red4", "赤赤赤赤"], ["red2blue2", "赤赤青青"]].map(([value, label]) => `<option value="${value}" ${threeMaConfig.flowerComposition === value ? "selected" : ""}>${label}</option>`).join("")}
          </select></label>
          <label class="setting-row"><span>開始時レーキ: ${Number(threeMaConfig.entryRakePoints).toFixed(1)}pt</span><input type="range" min="0.1" max="10" step="0.1" value="${threeMaConfig.entryRakePoints}" data-rule-config-number="entryRakePoints" /></label>
          <label class="setting-row"><span>ウマ</span><select data-rule-config-key="umaType">
            ${[["20-0--20", "20-0-▲20"], ["30-0--30", "30-0-▲30"], ["20-10--30", "20-10-▲30"]].map(([value, label]) => `<option value="${value}" ${threeMaConfig.umaType === value ? "selected" : ""}>${label}</option>`).join("")}
          </select></label>
          <label class="setting-row"><span>祝儀価値</span><select data-rule-config-number="chipValuePoints">
            ${[2000, 5000, 10000].map((value) => `<option value="${value}" ${threeMaConfig.chipValuePoints === value ? "selected" : ""}>${value.toLocaleString()}点</option>`).join("")}
          </select></label>
          <label class="setting-row checkbox-row"><input type="checkbox" data-rule-config-key="northNukiDoraEnabled" ${threeMaConfig.northNukiDoraEnabled ? "checked" : ""} /> 北を抜きドラにする</label>
        ` : `
          <label class="setting-row checkbox-row"><input type="checkbox" data-rule-config-key="rocket19Enabled" ${anmikaConfig.rocket19Enabled ? "checked" : ""} /> 1・9牌ロケット</label>
          <label class="setting-row checkbox-row"><input type="checkbox" data-rule-config-key="baibaEnabled" ${anmikaConfig.baibaEnabled ? "checked" : ""} /> 倍場</label>
          <label class="setting-row checkbox-row"><input type="checkbox" data-rule-config-key="otokogiEnabled" ${anmikaConfig.otokogiEnabled ? "checked" : ""} /> 漢気ルール</label>
          <label class="setting-row checkbox-row"><input type="checkbox" data-rule-config-key="feverRiichiEnabled" ${anmikaConfig.feverRiichiEnabled ? "checked" : ""} /> フィーバーリーチ</label>
          <label class="setting-row compact-select-row"><span>ターコイズ5p</span><select data-rule-config-turquoise>
            ${[0, 1, 2].map((count) => `<option value="${count}" ${anmikaConfig.turquoise5pCount === count ? "selected" : ""}>${count}枚</option>`).join("")}
          </select></label>
        `}
      </section>
      ${isTsumoLossless ? "" : `<label class="setting-row"><span>レーキ: ${Number(settings.rakePercent ?? 0).toFixed(1)}%</span><input type="range" min="0" max="10" step="0.5" value="${settings.rakePercent ?? 0}" data-create-table-rake /></label>`}
      <button type="button" class="primary-action" data-create-table-submit>作成</button>
    </section>`;
  }
  memberManagementScreen(state) {
    const club = this.selectedClub(state);
    if (!club || !state.currentUser || !isClubMember(state.currentUser.id, club)) return `<section class="lobby-panel"><button type="button" data-nav="clubSelect">クラブ選択へ</button><p>権限がありません。</p></section>`;
    const isAdmin = canCreateTable(state.currentUser.id, club);
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="clubHome">クラブホーム</button></div>
      <h3>メンバー</h3>
      <ul>${normalizeClub(club).members.map((member) => {
        const canRemove = isAdmin && member.role !== "admin" && member.userId !== state.currentUser.id;
        const canGrantAdmin = isAdmin && member.role !== "admin";
        return `<li>${getPlayerNameById(member.userId)} / ${member.role === "admin" ? "管理者権限" : "メンバー"} / ${member.pointBalance}pt ${isAdmin ? `<button type="button" data-club-id="${club.id}" data-transfer-points="${member.userId}">+100</button><button type="button" data-club-id="${club.id}" data-collect-points="${member.userId}">-100</button>${canGrantAdmin ? `<button type="button" data-club-id="${club.id}" data-grant-club-admin="${member.userId}">管理者権限を付与</button>` : ""}${canRemove ? `<button type="button" class="danger" data-club-id="${club.id}" data-remove-club-member="${member.userId}">削除</button>` : ""}` : ""}</li>`;
      }).join("")}</ul>
      <h3>加入申請</h3>
      <ul>${normalizeClub(club).pendingApplicants.map((id) => `<li>${getPlayerNameById(id)} ${isAdmin ? `<button type="button" data-club-id="${club.id}" data-approve-applicant="${id}">承認</button><button type="button" data-club-id="${club.id}" data-reject-applicant="${id}">拒否</button>` : ""}</li>`).join("") || "<li>なし</li>"}</ul>
    </section>`;
  }
  homeScreen() {
    return `<nav class="home-menu">
      <button type="button" data-nav="clubSelect">クラブ選択</button>
      <button type="button" data-nav="game">練習対局</button>
    </nav>`;
  }
  tableListScreen(state) {
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="home">ホーム</button><button type="button" data-create-table>フリー卓を作る</button></div>
      <div class="card-grid">${state.tables.map((table) => {
        const currentUserId = state.currentUser?.id ?? CURRENT_USER_ID;
        const seated = table.seats.find((seat) => seat.playerId === currentUserId);
        const emptySeat = getJoinableSeat(table);
        const waiting = table.waitingList?.includes(currentUserId);
        return `<article class="lobby-card">
          <h3>${table.name}</h3>
          <p>${table.clubId ? "クラブ卓" : "フリー卓"} / ${table.status}${isCpuDebugTable(table) ? " / CPUデバッグ" : ""}</p>
          <p>着席: ${table.seats.filter((seat) => seat.playerId).length} / 3</p>
          <p>待機: ${table.waitingList?.map(getPlayerNameById).join("、") || "なし"}</p>
          <div class="screen-actions">
            <button type="button" data-open-table="${table.id}">開く</button>
            <button type="button" data-rule-help>ルール</button>
            ${seated ? `<button type="button" data-leave-seat="${table.id}">卓を抜ける</button>` : canSitAtTable(table) && emptySeat ? `<button type="button" data-table-id="${table.id}" data-join-seat="${emptySeat.seatIndex}">座る</button>` : ""}
            ${!seated ? `<button type="button" data-join-waiting="${table.id}">${waiting ? "ウェイティングを抜ける" : "ウェイティングに入る"}</button>` : ""}
            ${canDeleteTableRoom(table) ? `<button type="button" data-delete-table="${table.id}">削除</button>` : ""}
          </div>
        </article>`;
      }).join("") || "<p>卓がありません。</p>"}</div>
    </section>`;
  }
  ruleConfigSummary(config) {
    const maybeRuleId = config?.ruleId || config?.gameType;
    if (maybeRuleId === TSUMO_LOSSLESS_3MA_RULE_ID || config?.fiveTileComposition || config?.flowerComposition) {
      const ruleConfig = normalizeTsumoLossless3maRuleConfig(config);
      const fiveLabel = { red3blue1: "赤赤赤青", red4: "赤赤赤赤", red2blue2: "赤赤青青", blackBlackRedRed: "黒黒赤赤" }[ruleConfig.fiveTileComposition];
      const flowerLabel = { red3blue1: "赤赤赤青", red4: "赤赤赤赤", red2blue2: "赤赤青青" }[ruleConfig.flowerComposition];
      const umaLabel = String(ruleConfig.umaType).replace("--", "-▲");
      return [
        `5の内訳 ${fiveLabel}`,
        `華牌 ${flowerLabel}`,
        `開始時レーキ ${Number(ruleConfig.entryRakePoints).toFixed(1)}pt`,
        `ウマ ${umaLabel}`,
        `祝儀 ${Number(ruleConfig.chipValuePoints).toLocaleString()}点`,
        ruleConfig.northNukiDoraEnabled ? "北抜きON" : "北抜きOFF",
      ].join(" / ");
    }
    const ruleConfig = normalizeAnmikaRocketRuleConfig(config);
    return [
      ruleConfig.rocket19Enabled ? "1・9牌ロケット" : null,
      ruleConfig.baibaEnabled ? "倍場" : null,
      ruleConfig.otokogiEnabled ? "漢気ON" : "漢気OFF",
      ruleConfig.feverRiichiEnabled ? "フィーバーリーチ" : null,
      `ターコイズ5p ${ruleConfig.turquoise5pCount}枚`,
    ].filter(Boolean).join(" / ");
  }
  tableRoomScreen(state) {
    const table = state.tables.find((item) => item.id === state.selectedTableId);
    if (!table) return `<section class="lobby-panel"><button type="button" data-nav="tableList">戻る</button><p>卓がありません。</p></section>`;
    const club = table.clubId ? clubRepository.getClub(table.clubId) : null;
    if (club && state.currentUser && !isClubMember(state.currentUser.id, club)) return `<section class="lobby-panel"><button type="button" data-nav="clubSelect">クラブ選択へ</button><p>この卓に参加する権限がありません</p></section>`;
    const currentUserId = state.currentUser?.id ?? CURRENT_USER_ID;
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="${table.clubId ? "clubTables" : "tableList"}">卓一覧へ</button><button type="button" data-copy-table-url="${table.id}">URLコピー</button><button type="button" data-fill-cpu="${table.id}">CPUで埋める</button></div>
      <h3>${table.name}</h3>
      <p class="replay-url">${tableUrlFor(table.id)}</p>
      <p>クラブ: ${club?.name ?? "未設定"} / ルール: ${GAME_RULE_DEFINITIONS.find((rule) => rule.id === table.ruleId)?.name ?? table.ruleId ?? "アンミカロケット"} / レート: 1点=${Number(table.pointRate ?? 1).toFixed(1)}pt / レーキ: ${table.rakePercent ?? 0}%</p>
      <p>設定: ${this.ruleConfigSummary(table.ruleConfig)}</p>
      <p>${table.status === "waiting" ? "待機中..." : table.status === "ended" ? "終了済み" : "対局中"}</p>
      <div class="seat-list">${table.seats.map((seat) => `<article class="seat-card">
        <h4>席${seat.seatIndex + 1}</h4>
        <p>${seat.playerId ? getPlayerNameById(seat.playerId) : "空席"}</p>
        ${seat.playerId === currentUserId ? "" : canSitAtTable(table, currentUserId) && (!seat.playerId || isCpuPlayerId(seat.playerId)) ? `<button type="button" data-table-id="${table.id}" data-join-seat="${seat.seatIndex}">座る</button>` : ""}
        ${seat.playerId === currentUserId ? `<button type="button" data-leave-seat="${table.id}">退席</button>
        <label><input type="checkbox" data-table-id="${table.id}" data-seat-last-hand ${seat.isLastHandDeclared ? "checked" : ""} /> ラス半</label>` : ""}
        ${seat.playerId ? `<p>ラス半: ${seat.isLastHandDeclared ? "ON" : "OFF"}</p>` : ""}
      </article>`).join("")}</div>
      <p>待機リスト: ${table.waitingList.map(getPlayerNameById).join("、") || "なし"}</p>
      <button type="button" data-join-waiting="${table.id}">${table.waitingList.includes(currentUserId) ? "ウェイティングを抜ける" : "ウェイティングに入る"}</button>
    </section>`;
  }
  replayListScreen(state) {
    state.replaySummaries = replayRepository.listReplays().slice(0, 300);
    const emptyMessage = `<div class="empty-replay-note">
      <p>保存された牌譜はまだありません。</p>
      <p>この画面では、クラブに関係なくログイン中アカウントで取得できる直近300本を表示します。</p>
    </div>`;
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="${state.selectedClubId ? "clubHome" : "clubSelect"}">${state.selectedClubId ? "クラブホーム" : "クラブ選択"}</button></div>
      <h3>牌譜一覧（直近300本）</h3>
      <div class="card-grid">${state.replaySummaries.map((summary) => `<article class="lobby-card replay-card" data-replay-card="${summary.replayId}">
        <h3>${summary.resultLabel}</h3>
        <p>${new Date(summary.endedAt).toLocaleString("ja-JP")}</p>
        <p>ルール: ${escapeHtml(summary.ruleName || summary.ruleId || "アンミカロケット")}</p>
        <p>対局者: ${summary.players.map((player) => `${escapeHtml(player.name)}${player.finalScore !== undefined ? ` ${player.finalScore}点` : ""}`).join(" / ")}</p>
        <p>結果: ${escapeHtml(summary.resultSummary || summary.resultLabel || "牌譜")}</p>
        <p class="replay-url">${summary.replayUrl ?? replayUrlFor(summary.replayId)}</p>
        <div class="screen-actions"><a class="button-link" href="${replayUrlFor(summary.replayId)}" data-open-replay="${summary.replayId}">再生</a><button type="button" data-copy-replay-url="${summary.replayId}">URLコピー</button></div>
      </article>`).join("") || emptyMessage}</div>
    </section>`;
  }
  replayViewerScreen(state) {
    const replay = replayRepository.getReplay(state.selectedReplayId);
    const fallbackBackUrl = onlineDebugReplayListUrl(state.selectedClubId || state.activeClubId || "");
    if (!replay && state.replayLoading) {
      return `<section class="lobby-panel replay-missing-panel"><a class="button-link" href="${fallbackBackUrl}">牌譜一覧へ戻る</a><p>牌譜を読み込み中です...</p></section>`;
    }
    if (!replay) {
      return `<section class="lobby-panel replay-missing-panel"><a class="button-link" href="${fallbackBackUrl}">牌譜一覧へ戻る</a><p>牌譜が見つかりません。</p>${state.replayLoadError ? `<p>${escapeHtml(state.replayLoadError)}</p>` : ""}</section>`;
    }
    const snapshots = getReplaySnapshots(replay);
    const index = Math.max(0, Math.min(state.replayIndex, snapshots.length - 1));
    const snapshot = getCurrentReplaySnapshot(replay, index);
    if (!snapshot) return `<section class="lobby-panel replay-missing-panel"><a class="button-link" href="${fallbackBackUrl}">牌譜一覧へ戻る</a><p>牌譜が見つかりません。</p></section>`;
    const displayState = {
      ...snapshot,
      screen: "game",
      pendingAction: null,
      serverAnnouncement: state.replayAnnouncement ?? snapshot.serverAnnouncement ?? null,
      cpuThinkingMessage: "",
      settingsOpen: false,
      isReplayView: true,
      isReplayRevealHands: Boolean(state.replayRevealHands),
      log: snapshot.log ?? [],
      handLog: snapshot.handLog ?? createEmptyHandLog(),
      settings: snapshot.settings ?? { isLastHand: false, rakePercent: 0, initialClockMs: INITIAL_TIME_MS },
      playerClocks: snapshot.playerClocks ?? createPlayerClocks(snapshot.players ?? [], snapshot.settings?.initialClockMs ?? INITIAL_TIME_MS),
      liveWall: snapshot.liveWall ?? [],
      rinshanWall: snapshot.rinshanWall ?? [],
      doraIndicators: snapshot.doraIndicators ?? [],
      uraDoraIndicators: snapshot.uraDoraIndicators ?? [],
      kanCount: snapshot.kanCount ?? 0,
      rakePool: snapshot.rakePool ?? 0,
    };
    const replayViewerId = getValidReplayViewerId(snapshot, state.replayViewerId, replay);
    const viewerOptions = (replay.summary?.players ?? displayState.players.map((player) => ({ playerId: player.id, name: player.name }))).map((player) => `<option value="${player.playerId}" ${replayViewerId === player.playerId ? "selected" : ""}>${player.name}</option>`).join("");
    const handMarkers = buildReplayHandMarkers(replay, snapshots);
    const handSelectOptions = handMarkers.map((marker, markerIndex) => {
      const nextIndex = handMarkers[markerIndex + 1]?.index ?? snapshots.length;
      const active = index >= marker.index && index < nextIndex;
      return `<option value="${marker.index}" ${active ? "selected" : ""}>${escapeHtml(marker.label)}</option>`;
    }).join("");
    const handSelect = handMarkers.length > 1
      ? `<label class="replay-hand-selector" data-replay-control><span class="replay-hand-selector-label">局</span><select class="replay-hand-select-menu" data-replay-hand-select aria-label="局を選択">${handSelectOptions}</select></label>`
      : "";
    const current = getCurrentPlayer(displayState);
    const dealer = displayState.players.find((player) => player.id === displayState.round.dealerPlayerId);
    const replayBackUrl = onlineDebugReplayListUrl(state.selectedClubId || state.activeClubId || replay.summary?.clubId || "");
    const visibleReplayPosition = getReplayVisiblePosition(replay, index);
    const isReplayFirstStep = visibleReplayPosition.position <= 0;
    const isReplayLastStep = visibleReplayPosition.position >= Math.max(0, visibleReplayPosition.visible.length - 1);
    return `<section class="replay-screen" data-replay-screen>
      ${this.mahjongTableClean(displayState, current, dealer, replayViewerId)}
      <div class="replay-toolbar replay-toolbar-bottom" data-replay-control>
        <a class="button-link" href="${replayBackUrl}">牌譜一覧へ戻る</a>
        <button type="button" data-replay-step="-1" ${isReplayFirstStep ? "disabled" : ""}>前へ</button>
        <strong>${index + 1} / ${snapshots.length}</strong>
        <button type="button" data-replay-step="1" ${isReplayLastStep ? "disabled" : ""}>次へ</button>
        ${handSelect}
        <label>視点: <select data-replay-viewer>${viewerOptions}</select></label>
        <label><input type="checkbox" data-replay-reveal-hands ${state.replayRevealHands ? "checked" : ""} /> 他家の手牌を開く</label>
        <button type="button" data-copy-replay-url="${replay.summary?.replayId ?? replay.replayId}">牌譜URLコピー</button>
      </div>
    </section>`;
  }
  clubListScreen(state) {
    const found = state.clubSearchResultId ? state.clubs.find((club) => club.id === state.clubSearchResultId) : null;
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="home">ホーム</button></div>
      <div class="club-search"><input type="text" data-club-search-input value="${state.clubSearchId ?? ""}" placeholder="クラブIDを入力" /><button type="button" data-club-search>検索</button></div>
      ${found ? `<article class="lobby-card"><h3>${found.name}</h3><p>ID: ${found.id} <button type="button" data-copy-club-id="${found.id}">コピー</button></p><p>${found.description ?? ""}</p><button type="button" data-apply-club="${found.id}">参加申請</button><button type="button" data-open-club="${found.id}">詳細</button></article>` : ""}
      <h3>クラブ一覧</h3>
      <div class="card-grid">${state.clubs.map((club) => `<article class="lobby-card"><h3>${club.name}</h3><p>ID: ${club.id} <button type="button" data-copy-club-id="${club.id}">コピー</button></p><p>${club.description ?? ""}</p>${club.memberUserIds.includes(state.currentUser?.id) ? "" : `<button type="button" data-apply-club="${club.id}">参加申請</button>`}<button type="button" data-open-club="${club.id}">開く</button></article>`).join("")}</div>
    </section>`;
  }
  clubDetailScreen(state) {
    const club = state.clubs.find((item) => item.id === state.selectedClubId) ?? state.clubs[0];
    if (!club) return `<section class="lobby-panel"><button type="button" data-nav="clubList">戻る</button><p>クラブがありません。</p></section>`;
    const currentUserId = state.currentUser?.id ?? CURRENT_USER_ID;
    const isAdmin = club.adminUserIds.includes(currentUserId);
    const points = state.clubMemberPoints.filter((item) => item.clubId === club.id);
    const isMember = club.memberUserIds.includes(currentUserId);
    return `<section class="lobby-panel"><div class="screen-actions"><button type="button" data-nav="clubList">クラブ一覧へ</button>${isMember ? `<button type="button" data-create-club-table="${club.id}">クラブ卓を作る</button>` : ""}</div>
      <h3>${club.name}</h3><p>ID: ${club.id} <button type="button" data-copy-club-id="${club.id}">コピー</button></p><p>${club.description ?? ""}</p>
      <p>クラブポイント: ${club.clubPointBalance} / レーキ: ${club.rakeBalance}</p>
      <h4>メンバー</h4><ul>${club.memberUserIds.map((id) => {
        const point = points.find((item) => item.userId === id)?.balance ?? 0;
        return `<li>${getPlayerNameById(id)}: ${point}pt ${isAdmin ? `<button type="button" data-club-id="${club.id}" data-transfer-points="${id}">+100</button><button type="button" data-club-id="${club.id}" data-collect-points="${id}">-100</button>` : ""}</li>`;
      }).join("")}</ul>
      <h4>申請者</h4><ul>${club.pendingApplicantUserIds.map((id) => `<li>${getPlayerNameById(id)} ${isAdmin ? `<button type="button" data-club-id="${club.id}" data-approve-applicant="${id}">承認</button><button type="button" data-club-id="${club.id}" data-reject-applicant="${id}">拒否</button>` : ""}</li>`).join("") || "<li>なし</li>"}</ul>
    </section>`;
  }
  mahjongTableClean(state, current, dealer, viewerPlayerId) {
    this.currentStateForClock = state;
    viewerPlayerId ??= getLocalHumanPlayerId(state);
    const viewer = state.players.find((player) => player.id === viewerPlayerId) ?? state.players.find((player) => player.type !== "cpu") ?? state.players[0];
    const viewState = buildViewStateForPlayer(state, viewer.id);
    setRenderSeatMap(state, viewState.seats);
    if (state.isReplayRevealHands) {
      for (const [seatName, seatView] of Object.entries(viewState.seats ?? {})) {
        seatView.handTiles = (seatView.handTiles ?? []).map((item) => ({ ...item, faceDown: false }));
        if (seatName === "right" || seatName === "top") seatView.handTiles.reverse();
        if (seatView.drawnTile) seatView.drawnTile = { ...seatView.drawnTile, faceDown: false };
        seatView.isViewer = true;
        seatView.isReplayRevealHands = true;
      }
    }
    const seats = viewState.seats;
    const showOnlineLoadingMessage = Boolean(
      state.onlineLoadingMessage &&
      (
        state.onlineLoadingVisible ||
        (state.onlineLoadingMessageStartedAt && Date.now() - state.onlineLoadingMessageStartedAt >= ONLINE_LOADING_DISPLAY_DELAY_MS)
      )
    );
    return `<section class="mahjong-table">
      <div class="table-frame"></div>
      ${this.centerInfoClean(state, dealer)}
      ${this.discardAreaClean(seats.bottom, "bottom")}
      ${this.discardAreaClean(seats.right, "right")}
      ${this.discardAreaClean(seats.top, "top")}
      ${this.playerSeatClean(seats.bottom, "bottom", current, dealer)}
      ${this.playerSeatClean(seats.right, "right", current, dealer)}
      ${this.playerSeatClean(seats.top, "top", current, dealer)}
      ${state.isReplayView ? "" : `<section class="bottom-actions">
        ${state.cpuThinkingMessage ? `<div class="thinking">${state.cpuThinkingMessage}</div>` : ""}
        ${renderActionPrompt(state.pendingAction, state)}
        ${renderNorthNukiButton(state, viewer.id)}
        ${state.discardDebugMessage ? `<div class="discard-debug-message">${escapeHtml(state.discardDebugMessage)}${state.discardRecoveryVisible ? ` <button type="button" data-force-discard-resync>再同期</button>` : ""}</div>` : ""}
      </section>`}
      ${state.phase === "idle" ? this.startOverlay() : ""}
      ${state.isReplayView ? "" : this.settingsButton(state)}
      ${state.settingsOpen ? this.settingsPanel(state) : ""}
      ${showOnlineLoadingMessage ? `<div class="online-loading-message">${escapeHtml(state.onlineLoadingMessage)}<div class="online-loading-actions"><button type="button" data-leave-online-loading>ロビーへ戻る</button><button type="button" onclick="location.reload()">再読み込み</button></div></div>` : ""}
      ${state.phase === "gameEnded" ? this.finalResult(state) : ""}
      ${state.phase === "showingWinAnnouncement" ? this.winAnnouncement(state) : ""}
      ${state.serverAnnouncement && state.phase !== "showingWinAnnouncement" ? this.serverAnnouncement(state) : ""}
      ${state.phase === "showingFlowerAnnouncement" ? this.flowerAnnouncement(state) : ""}
      ${state.handLog.result && state.phase !== "showingWinAnnouncement" ? this.result(state) : ""}
    </section>`;
  }
  winAnnouncement(state) {
    const announcement = state.serverAnnouncement || {};
    const lines = Array.isArray(announcement.lines) ? announcement.lines : [];
    const playerId = announcement.playerId || state.handLog?.result?.winnerId || state.handLog?.result?.winners?.[0]?.winnerId || "";
    const seatClass = this.announcementSeatClass(state, playerId);
    if (lines.length > 1) {
      return `<div class="win-announcement double-ron-announcement ${seatClass}"><div>${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div></div>`;
    }
    const className = announcementClassForKind(announcement.kind);
    return `<div class="win-announcement ${className} ${seatClass}"><div>${escapeHtml(state.winAnnouncement ?? "")}</div></div>`;
  }
  serverAnnouncement(state) {
    const announcement = state.serverAnnouncement || {};
    const lines = Array.isArray(announcement.lines) ? announcement.lines : [];
    const className = announcementClassForKind(announcement.kind);
    const seatClass = this.announcementSeatClass(state, announcement.playerId || announcement.winnerId || "");
    const content = lines.length > 1 ? lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("") : escapeHtml(announcement.text ?? "");
    return `<div class="win-announcement ${className} ${seatClass}"><div>${content}</div></div>`;
  }
  announcementSeatClass(state, playerId) {
    const seat = seatPositionForPlayer(state, playerId);
    if (seat === "right") return "announcement-seat-right";
    if (seat === "top") return "announcement-seat-top";
    return "";
  }
  flowerAnnouncement(state) {
    return `<div class="win-announcement flower-announcement"><div>${state.flowerAnnouncement ?? "華"}</div></div>`;
  }
  startOverlay() {
    return `<section class="start-overlay"><div class="start-card"><h2>特殊三人麻雀</h2><button type="button" class="primary-action" data-start-game>ゲーム開始</button></div></section>`;
  }
  settingsButton(_state) {
    return `<button type="button" class="settings-toggle" data-settings-toggle>設定</button>`;
  }
  settingsPanel(state) {
    const sync = loadOnlineSync();
    const showDebugLeave = Boolean(state.activeTableId || sync?.tableId || sync?.localTableId);
    const localPlayer = state.players?.find((player) => player.type === "human") ?? state.players?.[0];
    const declaredBy = Array.isArray(state.lastHandDeclaredBy) ? state.lastHandDeclaredBy : [];
    const localLastHandChecked = Boolean(localPlayer && declaredBy.includes(localPlayer.id));
    return `<aside class="settings-panel">
      <h2>設定</h2>
      ${!state.isReplayView && localPlayer ? `<label class="settings-check"><input type="checkbox" data-last-hand ${localLastHandChecked ? "checked" : ""} /> ラス半</label>` : ""}
      <button type="button" class="secondary" data-page-reload>画面更新</button>
      ${showDebugLeave ? `<button type="button" class="danger debug-force-leave" data-force-table-leave>強制退席</button>` : ""}
    </aside>`;
  }
  finalResult(state) {
    const roundPoint = (value) => {
      const numeric = Number(value || 0);
      if (!Number.isFinite(numeric)) return 0;
      const rounded = Math.round((numeric + Math.sign(numeric) * Number.EPSILON) * 10) / 10;
      return Object.is(rounded, -0) ? 0 : Number(rounded.toFixed(1));
    };
    const formatPoint = (value) => {
      const rounded = roundPoint(value);
      const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${rounded >= 0 ? "+" : ""}${text}pt`;
    };
    const umaValues = (() => {
      const umaType = state.settings?.ruleConfig?.umaType || "20-0--20";
      if (umaType === "30-0--30") return [30, 0, -30];
      if (umaType === "20-10--30") return [20, 10, -30];
      return [20, 0, -20];
    })();
    const seatOrder = state.round?.initialSeatOrder || state.players.map((player) => player.id);
    const ranked = [...state.players].sort((a, b) => {
      const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return seatOrder.indexOf(a.id) - seatOrder.indexOf(b.id);
    });
    const settlementPoints = {};
    let lowerTotal = 0;
    ranked.forEach((player, rankIndex) => {
      if (rankIndex === 0) return;
      const pointDelta = roundPoint(Number(player.score || 0) / 1000 - 40 + Number(umaValues[rankIndex] || 0));
      settlementPoints[player.id] = pointDelta;
      lowerTotal += pointDelta;
    });
    if (ranked[0]) settlementPoints[ranked[0].id] = roundPoint(-lowerTotal);
    return `<section class="score-result result-modal"><h2>最終結果</h2>
      ${isSocketAuthoritativeGame() ? `<button type="button" class="result-debug-force-leave" data-force-table-leave>強制退席</button>` : ""}
      <ul>${state.players.map((player) => `<li>${escapeHtml(player.name)}　${formatPointDisplay(player.score || 0)}点（${formatPoint(settlementPoints[player.id] || 0)}）</li>`).join("")}</ul>
      <button type="button" class="primary-action" data-final-result-ok>OK</button>
    </section>`;
  }
  seatPlayersClean(state) {
    const human = state.players.find((p) => p.type === "human") ?? state.players[0];
    const cpus = state.players.filter((p) => p.id !== human.id);
    return { bottom: human, right: cpus[0], top: cpus[1] };
  }
  centerInfoClean(state, dealer) {
    const baibaDetails = getVisibleBaibaMultiplierDetails(state);
    const roundLabel = `${formatCenterRoundLabel(state)}${baibaDetails.multiplier > 1 ? `（×${baibaDetails.multiplier}）` : ""}`;
    const playerRows = (state.players ?? []).map((player) => {
      const role = getSeatRoleLabel(state, player.id);
      return `<li><span class="center-player-name">${escapeHtml(player.name)}</span><strong>${formatPointDisplay(player.score)}点</strong><em>${role}</em></li>`;
    }).join("");
    const doraTiles = (state.doraIndicators ?? []).map((tile) => renderTileView({ tile })).join("");
    const liveWallCount = state.liveWall?.length ?? 0;
    const rinshanWallCount = state.rinshanWall?.length ?? 0;
    const riichiStickLine = isTsumoLossless3maState(state) ? `<div class="center-riichi-sticks">リーチ棒 x${Number(state.riichiStickCount || 0)}</div>` : "";
    const centerClass = `center-info${isTsumoLossless3maState(state) ? " center-info-allred" : ""}`;
    return `<section class="${centerClass}">
      <div class="round-label">${roundLabel}</div>
      <ul class="center-scores">${playerRows}</ul>
      ${riichiStickLine}
      <div class="center-bottom-info">
        <div class="center-wall"><span>山 ${liveWallCount}枚</span><span>嶺上 ${rinshanWallCount}枚</span></div>
        <div class="center-dora"><span>ドラ表示牌</span><div class="center-dora-tiles">${doraTiles || "なし"}</div></div>
      </div>
    </section>`;
  }
  playerSeatClean(player, seat, current, dealer) {
    if (!player) return "";
    const seatView = player.player ? player : null;
    player = seatView?.player ?? player;
    const isDisconnected = Boolean(seatView?.isDisconnected);
    const faceDown = seatView ? !seatView.isViewer : player.type === "cpu";
    const handTiles = seatView?.handTiles?.length ? seatView.handTiles : player.hand.map((tile) => ({ tile, faceDown }));
    const drawnTile = seatView?.drawnTile ?? (player.drawnTile ? { tile: player.drawnTile, faceDown } : undefined);
    const active = player.id === current.id;
    const isDealer = player.id === dealer?.id;
    const clockMs = this.currentStateForClock ? getClockRemainingMs(this.currentStateForClock, player.id) : null;
    const clockBadge = seat === "bottom" && clockMs !== null && !this.currentStateForClock?.isReplayView
      ? `<span class="hand-clock-badge ${clockMs <= 5000 ? "low" : ""}">${formatClock(this.currentStateForClock, player.id)}</span>`
      : "";
    const revealClass = seatView?.isReplayRevealHands && seat !== "bottom" ? `replay-reveal-hand replay-reveal-${seat}` : "";
    const hasMelds = (player.melds ?? []).length > 0;
    const handCount = Math.max(0, Math.min(13, handTiles.length));
    const handCountBucket = handCount <= 1 ? 1 : handCount <= 4 ? 4 : handCount <= 7 ? 7 : handCount <= 10 ? 10 : 13;
    const handRegion = `<span class="concealed-hand-tiles hand-region-slot">${handTiles.map((item) => this.hand(item.tile, active, false, Boolean(item.faceDown), player)).join("")}</span>`;
    const drawnRegion = `<span class="drawn-tile-slot ${drawnTile ? "" : "empty-tile-slot"}">${drawnTile ? `<span class="drawn-tile">${this.hand(drawnTile.tile, active, true, Boolean(drawnTile.faceDown), player)}</span>` : ""}</span>`;
    const meldRegion = this.meldAreaClean(player, true);
    const nukiRegion = this.nukiAreaClean(player, true);
    const layoutParts = seat === "bottom"
      ? [handRegion, drawnRegion, meldRegion, nukiRegion]
      : [nukiRegion, meldRegion, drawnRegion, handRegion];
    const playerInitial = escapeHtml((player.name || "?").trim().charAt(0) || "?");
    const avatarClass = player.type === "cpu"
      ? (player.id?.includes("2") || player.name?.includes("2") ? "avatar-cpu2" : "avatar-cpu1")
      : "avatar-human";
    return `<section class="player-seat seat-${seat} ${active ? "active" : ""} ${isDealer ? "dealer" : ""} ${isDisconnected ? "disconnected" : ""} ${revealClass}">
      <div class="seat-identity"><span class="seat-player-icon player-avatar ${avatarClass}" aria-hidden="true">${playerInitial}</span><div class="seat-mini-name">${escapeHtml(player.name)}${isDisconnected ? `<span class="disconnect-badge">回線落ち</span>` : ""}${player.isRiichi ? `<span class="riichi-badge ${player.feverRiichiActive ? "fever" : ""}">${player.feverRiichiActive ? "フィーバーリーチ" : "リーチ"}</span>` : ""}</div></div>
      <div class="hand-zone">${clockBadge}<div class="hand-row ${seat === "bottom" ? "human-hand" : "cpu-hand"} ${hasMelds ? "has-melds" : ""} hand-count-${handCountBucket}" style="--hand-count:${handCount};">${layoutParts.join("")}</div></div>
      ${player.type !== "cpu" && seat === "bottom" && !this.currentStateForClock?.isReplayView ? this.assistControls(player) : ""}
    </section>`;
  }
  assistControls(player) {
    const assist = player.assistSettings ?? {};
    const autoWinChecked = Boolean(assist.autoWin || player.isRiichi);
    const roleLabel = getSeatRoleLabel(this.currentStateForClock, player.id).replace(/家$/, "") || "";
    return `<div class="assist-controls">
      <div class="assist-seat-status"><span>${escapeHtml(roleLabel)}</span><strong>${formatPointDisplay(player.score)}点</strong></div>
      <label><input type="checkbox" data-player-id="${player.id}" data-assist-auto-win ${autoWinChecked ? "checked" : ""} ${player.isRiichi ? "disabled" : ""} /> 自動和了</label>
      <label><input type="checkbox" data-player-id="${player.id}" data-assist-no-call ${assist.noCall ? "checked" : ""} /> 鳴きなし</label>
    </div>`;
  }
  discardAreaClean(player, seat) {
    if (!player) return "";
    const seatView = player.player ? player : null;
    const playerName = seatView?.playerName ?? player.name;
    const discards = seatView?.discards ?? player.discardedTiles;
    const discardRows = [discards.slice(0, 6), discards.slice(6, 12), discards.slice(12)];
    const renderDiscard = (discard) => `<span class="discard ${discard.discardType === "tsumogiri" ? "tsumogiri" : "tedashi"} ${discard.isRiichiDiscard ? "riichi-discard" : ""}">${renderTileView({ tile: discard.tile, isTsumogiri: discard.discardType === "tsumogiri" })}</span>`;
    return `<section class="discard-area discard-${seat}" aria-label="${playerName}の捨て牌">
      <div class="discard-grid">${discardRows.map((row) => `<div class="discard-row">${row.map(renderDiscard).join("")}</div>`).join("")}</div>
    </section>`;
  }
  exposedAreaClean(player, inline = false, reserveSpace = false) {
    player = player.player ?? player;
    const melds = this.meldAreaClean(player, reserveSpace);
    const nuki = this.nukiAreaClean(player, reserveSpace);
    if (!melds && !nuki) return "";
    return `<div class="exposed-row ${inline ? "inline-exposed-row" : ""} ${reserveSpace ? "reserved-exposed-row" : ""} ${!melds && !nuki ? "empty-exposed-row" : ""}">
      ${melds}${nuki}
    </div>`;
  }
  meldAreaClean(player, reserveSpace = false) {
    player = player.player ?? player;
    const state = this.currentStateForClock;
    const melds = [...(player.melds ?? [])]
      .map((meld, meldIndex) => ({ meld, meldIndex }))
      .reverse()
      .map(({ meld, meldIndex }, displayIndex) => {
        const orderClass = displayIndex === 0 ? "newest-meld" : meldIndex === 0 ? "oldest-meld" : "";
        return state
          ? renderMeldSet(state, player.id, meld, orderClass)
          : `<span class="meld-set ${orderClass}">${meld.tiles.map((tile) => renderTileView({ tile })).join("")}</span>`;
      }).join("");
    if (!melds && !reserveSpace) return "";
    return `<div class="meld-area hand-region ${!melds ? "empty-hand-region" : ""}"><div class="exposed-tiles">${melds}</div></div>`;
  }
  nukiAreaClean(player, reserveSpace = false) {
    player = player.player ?? player;
    const nuki = (player.nukiDoraTiles ?? []).map((tile) => renderTileView({ tile })).join("");
    if (!nuki && !reserveSpace) return "";
    return `<div class="nuki-dora-area hand-region ${!nuki ? "empty-hand-region" : ""}"><div class="exposed-tiles">${nuki}</div></div>`;
  }
  mahjongTable(state, current, dealer) {
    return this.mahjongTableClean(state, current, dealer);
  }
  seatPlayers(state) {
    return this.seatPlayersClean(state);
  }
  centerInfo(state, dealer) {
    return this.centerInfoClean(state, dealer);
  }
  playerSeat(player, seat, current, dealer) {
    return this.playerSeatClean(player, seat, current, dealer);
  }
  discardArea(player, seat) {
    return this.discardAreaClean(player, seat);
  }
  exposedArea(player) {
    return this.exposedAreaClean(player);
  }
  player(player, active) {
    const faceDown = player.type === "cpu";
    return `<article class="player-panel"><h2>${player.name}</h2><div class="tiles">${player.hand.map((tile) => this.hand(tile, active, false, faceDown, player)).join("")}</div></article>`;
  }
  hand(tile, active, isDrawnTile, faceDown, player) {
    if (this.currentStateForClock?.isReplayView) return renderTileView({ tile, isDrawnTile, faceDown });
    if (player?.type === "cpu") return renderTileView({ tile, isDrawnTile, faceDown: faceDown || tile?.kind === "back" });
    if (!active || faceDown) return renderTileView({ tile, isDrawnTile, faceDown });
    const riichiDiscardIds = Array.isArray(player?.riichiDiscardTileIds) ? player.riichiDiscardTileIds : [];
    const currentStatePlayer = this.currentStateForClock?.players?.[this.currentStateForClock?.currentPlayerIndex ?? 0];
    const isRiichiDiscardSelection = this.currentStateForClock?.phase === "waitingForRiichiDiscard" && currentStatePlayer?.id === player?.id;
    if (isRiichiDiscardSelection && riichiDiscardIds.length > 0 && !riichiDiscardIds.includes(tile.id)) return renderTileView({ tile, isDrawnTile, disabledForRiichi: true });
    if (player?.isRiichi && !isDrawnTile) return renderTileView({ tile, isDrawnTile });
    return renderTileView({ tile, isDrawnTile, buttonTileId: tile.id, buttonAction: isFlowerTile(tile) ? "nuki" : "discard", isSelectedForDiscard: this.currentStateForClock?.selectedDiscardTileId === tile.id });
  }
  result(state) {
    const result = state.handLog.result;
    if (!result) return "";
    const content = result.type === "exhaustiveDraw" ? this.exhaustiveDrawResult(state, result) : this.scoreBreakdown(result.scoreResult, state);
    const forceLeave = isSocketAuthoritativeGame()
      ? `<button type="button" class="result-debug-force-leave" data-force-table-leave>強制退席</button>`
      : "";
    return `<div class="result-backdrop">${forceLeave}${content}</div>`;
  }
  paymentRows(state, payments) {
    const paymentMap = Array.isArray(payments) ? Object.fromEntries(payments.map((payment) => [payment.playerId, payment.delta])) : payments ?? {};
    return state.players.map((player) => `<li>${player.name}: ${signedPointDisplay(paymentMap[player.id] ?? 0)}</li>`).join("");
  }
  exhaustiveDrawResult(state, result) {
    const tenpaiResults = result.tenpaiResults ?? state.players.map((player) => ({
      playerId: player.id,
      isTenpai: (result.tenpaiPlayerIds ?? []).includes(player.id),
      waits: [],
      handTiles: getHand13ForTenpai(player),
    }));
    const tenpaiByPlayer = new Map(tenpaiResults.map((item) => [item.playerId, item]));
    const tenpaiCount = tenpaiResults.filter((item) => item.isTenpai).length;
    const hasPayment = Array.isArray(result.payments)
      ? result.payments.some((payment) => Number(payment.delta || 0) !== 0)
      : Object.values(result.payments || {}).some((delta) => Number(delta || 0) !== 0);
    return `<section class="score-result result-modal"><h2>流局</h2>
      <h3>テンパイ状況</h3>
      ${tenpaiCount === 0 ? `<p class="score-note">全員ノーテン</p>` : ""}
      <div class="tenpai-results">${state.players.map((player) => {
        const item = tenpaiByPlayer.get(player.id);
        const waits = item?.waits ?? [];
        const handTiles = item?.handTiles ?? [];
        return `<section class="tenpai-player">
          <h4>${player.name}: ${item?.isTenpai ? "テンパイ" : "ノーテン"}</h4>
          ${item?.isTenpai ? `<div><strong>手牌:</strong><div class="result-tiles">${handTiles.map((tile) => renderTileView({ tile })).join("")}</div></div>` : ""}
        </section>`;
      }).join("")}</div>
      <h3>点数移動</h3>
      ${hasPayment ? `<ul>${this.paymentRows(state, result.payments ?? {})}</ul>` : `<p>点数移動なし</p>`}
      <h3>現在点数</h3>
      <ul>${state.players.map((player) => `<li>${player.name}: ${formatPointDisplay(result.finalScores?.[player.id] ?? player.score)}点</li>`).join("")}</ul>
      ${renderAgariYameButton(state)}${renderResultOkButton(state)}
    </section>`;
  }
  scoreBreakdown(score, state) {
    const result = state.handLog.result;
    if (Array.isArray(result?.wins) && result.wins.length > 1) {
      const combinedPayments = Array.isArray(result.payments)
        ? Object.fromEntries(result.payments.map((payment) => [payment.playerId, payment.delta]))
        : result.payments ?? {};
      const signed = (value = 0) => `${signedPointDisplay(value)}点`;
      const winBlocks = result.wins.map((win, index) => {
        const winScore = win.scoreResult || {};
        const winner = state.players.find((player) => player.id === win.winnerId);
        const scoringTile = win.scoringWinningTile || winScore.selectedWait || win.winningTile || result.winningTile;
        const displayTile = winScore.displayWinningTile || win.winningTile || scoringTile;
        const handTiles = resultHand13Tiles(winScore, winner, scoringTile);
        const meldsInlineView = resultMeldsInlineView(state, winner);
        const yakuList = winScore.yakuList ?? winScore.yaku ?? [];
        const yakuRows = yakuList.map((yaku) => {
          const suffix = yaku.detail ? `（${escapeHtml(yaku.detail)}）` : "";
          const han = Number(yaku.han || 0) ? ` ${Number(yaku.han)}翻` : "";
          return `<li>${escapeHtml(yaku.name)}${suffix}${han}</li>`;
        }).join("");
        const scoreLabel = isTsumoLossless3maState(state)
          ? `${winScore.limitType && winScore.limitType !== "通常" ? winScore.limitType : `${Number(winScore.han ?? winScore.totalHan ?? 0)}翻`}ロン`
          : `${winScore.limitType ?? "通常"} ${formatPointDisplay(winScore.finalPoints ?? winScore.totalPoints ?? 0)}点`;
        return `<section class="double-ron-result-block">
          <h3>${index === 0 ? "上家取り" : "和了"}: ${escapeHtml(winner?.name || getPlayerNameById(win.winnerId))} ロン</h3>
          <div class="score-hand-win-row result-hand-win-nuki-row">
            <div class="score-hand-block"><div class="result-tiles result-hand-line">${handTiles.map((tile) => renderTileView({ tile })).join("")}${meldsInlineView}</div></div>
            <div class="score-winning-tile"><strong>和了牌</strong><div class="result-tiles result-winning-tile">${displayTile ? renderTileView({ tile: displayTile, isDrawnTile: true }) : ""}</div></div>
          </div>
          <ul class="score-yaku compact-yaku">${yakuRows || "<li>なし</li>"}</ul>
          <p class="final-score-line">${scoreLabel}</p>
        </section>`;
      }).join("");
      return `<section class="score-result result-modal win-result-modal compact-score-result double-ron-result"><h2>ダブロン</h2>
        ${winBlocks}
        ${renderResultOkButton(state)}
      </section>`;
    }
    const winner = result?.type === "win" ? state.players.find((p) => p.id === result.winnerId) : null;
    const playerName = (playerId) => state.players.find((player) => player.id === playerId)?.name || getPlayerNameById(playerId);
    const bonus = score.bonuses ?? {};
    const yakuList = score.yakuList ?? score.yaku ?? [];
    const displayWinningTile = score.displayWinningTile ?? result?.winningTile ?? score.winningTile ?? score.selectedWait ?? null;
    const scoringWinningTile = score.selectedWait ?? result?.scoringWinningTile ?? score.winningTile ?? displayWinningTile;
    const handTiles = resultHand13Tiles(score, winner, scoringWinningTile);
    const meldsInlineView = resultMeldsInlineView(state, winner);
    const nukiDoraTiles = Array.isArray(winner?.nukiDoraTiles) ? winner.nukiDoraTiles : [];
    const resultHandLineView = `<div class="score-hand-block"><div class="result-tiles result-hand-line">${handTiles.map((tile) => renderTileView({ tile })).join("")}${meldsInlineView}</div></div>`;
    const resultWinningTileView = `<div class="score-winning-tile"><strong>和了牌</strong><div class="result-tiles result-winning-tile">${displayWinningTile ? renderTileView({ tile: displayWinningTile, isDrawnTile: true }) : ""}</div></div>`;
    const resultNukiDoraTileView = `<div class="score-nuki-dora-tile"><strong>華牌</strong><div class="result-tiles result-nuki-dora-tiles">${nukiDoraTiles.map((tile) => renderTileView({ tile })).join("") || "なし"}</div></div>`;
    const resultHandWinNukiRow = `<div class="score-hand-win-row result-hand-win-nuki-row">${resultHandLineView}${resultWinningTileView}${resultNukiDoraTileView}</div>`;
    const winnerRiichi = Boolean(winner?.isRiichi || winner?.riichiTurnIndex !== null || result?.riichi);
    const payments = Array.isArray(score.paymentDeltas)
      ? Object.fromEntries(score.paymentDeltas.map((payment) => [payment.playerId, payment.delta]))
      : Array.isArray(score.payments)
        ? Object.fromEntries(score.payments.map((payment) => [payment.playerId, payment.delta]))
        : score.payments ?? {};
    const roundToTenth = (value) => {
      const numeric = Number(value || 0);
      if (!Number.isFinite(numeric)) return 0;
      const rounded = Math.round((numeric + Math.sign(numeric) * Number.EPSILON) * 10) / 10;
      return Object.is(rounded, -0) ? 0 : Number(rounded.toFixed(1));
    };
    const formatPoint = (value) => {
      const rounded = roundToTenth(value);
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    };
    const signed = (value = 0) => `${signedPointDisplay(value)}点`;
    if (isTsumoLossless3maState(state)) {
      const yakuRowsForAllRed = yakuList.map((yaku) => {
        const suffix = yaku.detail ? `（${escapeHtml(yaku.detail)}）` : "";
        return `<li>${escapeHtml(yaku.name)}${suffix}${Number(yaku.han || 0) && !yaku.isYakuman ? ` ${Number(yaku.han)}翻` : ""}</li>`;
      });
      const doraNormal = Number(score.dora?.normal ?? 0);
      const doraColored = Number(score.dora?.colored ?? 0);
      const doraNuki = Number(score.dora?.nuki ?? 0);
      const doraVisible = Number(score.dora?.visible ?? (doraNormal + doraColored + doraNuki));
      const doraUra = winnerRiichi ? Number(score.dora?.ura ?? 0) : 0;
      if (doraVisible > 0) yakuRowsForAllRed.push(`<li>ドラ${doraVisible}</li>`);
      if (doraUra > 0) yakuRowsForAllRed.push(`<li>裏ドラ${doraUra}</li>`);
      const chipSettlement = result?.chipSettlement || score.chipSettlement;
      const tobiPrize = result?.tobiPrize || score.tobiPrize;
      const settledChipPoint = chipSettlement?.chipPoint ?? tobiPrize?.chipPoint ?? null;
      const chipPoint = settledChipPoint !== null
        ? Number(settledChipPoint)
        : Number(state.settings?.ruleConfig?.chipValuePoints || 5000) / 1000 * Number(state.settings?.pointRate || 1);
      const currentChipPayments = Object.fromEntries(state.players.map((player) => [player.id, 0]));
      [chipSettlement?.payments, tobiPrize?.payments].forEach((paymentSource) => {
        Object.entries(paymentSource || {}).forEach(([playerId, delta]) => {
          currentChipPayments[playerId] = roundToTenth(Number(currentChipPayments[playerId] || 0) + Number(delta || 0));
        });
      });
      const totalChipPayments = state.hanchanClubPointPayments || currentChipPayments;
      const pointToChips = (points) => chipPoint ? roundToTenth(Number(points || 0) / chipPoint) : 0;
      const signedChips = (chips = 0) => `${Number(chips || 0) > 0 ? "+" : ""}${formatPoint(chips)}枚`;
      const allRedScoreRank = score.limitType && score.limitType !== "通常"
        ? score.limitType
        : `${Number(score.han ?? score.totalHan ?? 0)}翻`;
      const scoreLabel = `${allRedScoreRank}${score.isTsumo ? "ツモ" : "ロン"}`;
      const allRedFinalPoints = Number(score.finalPoints ?? score.totalPoints ?? 0);
      const allRedFinalScoreClass = allRedFinalPoints < 0 ? " final-score-negative" : "";
      return `<section class="score-result result-modal win-result-modal allred-score-result">
        <p class="score-winner-line">${winner?.name ?? ""} ${score.isTsumo ? "ツモ" : "ロン"}</p>
        <div class="allred-result-grid">
          <div class="allred-hand-win-row">${resultHandWinNukiRow}</div>
          <div><strong>表ドラ表示牌</strong><div class="result-tiles">${state.doraIndicators.map((tile) => renderTileView({ tile })).join("") || "なし"}</div></div>
          <div><strong>裏ドラ表示牌</strong><div class="result-tiles">${winnerRiichi ? state.uraDoraIndicators.map((tile) => renderTileView({ tile })).join("") || "なし" : "リーチなし"}</div></div>
        </div>
        <div class="score-summary-layout">
          <ul class="score-yaku vertical-yaku">${yakuRowsForAllRed.join("") || "<li>なし</li>"}</ul>
          <div class="score-big-panel">
            <p class="final-score-line big-final-score${allRedFinalScoreClass}">${scoreLabel}</p>
          </div>
        </div>
        ${renderAgariYameButton(state)}${renderResultOkButton(state)}
      </section>`;
    }
    const yakuRows = yakuList.map((yaku) => {
      const suffix = yaku.detail ? `（${escapeHtml(yaku.detail)}）` : "";
      return `<li>${escapeHtml(yaku.name)}${suffix}</li>`;
    });
    const doraNormal = Number(score.dora?.normal ?? 0);
    const doraColored = Number(score.dora?.colored ?? 0);
    const doraNuki = Number(score.dora?.nuki ?? 0);
    const doraVisible = Number(score.dora?.visible ?? (doraNormal + doraColored + doraNuki));
    const uraCount = winnerRiichi ? Math.floor(Number(bonus.uraDora ?? 0) / 5) : 0;
    if (doraVisible > 0) yakuRows.push(`<li>ドラ${doraVisible}</li>`);
    if (uraCount > 0) yakuRows.push(`<li>裏${uraCount}</li>`);
    yakuRows.push(`<li>${score.limitType ?? "通常"} ${formatPointDisplay(score.basePoints ?? 0)}点</li>`);
    const baibaMultiplier = Number(score.baibaMultiplier ?? 1);
    const pochiMultiplier = Number(score.pointMultiplier ?? 1);
    const multiplierTotal = baibaMultiplier * pochiMultiplier;
    const multiplierLabels = score.baibaDetails?.labels?.length ? `（${score.baibaDetails.labels.join("・")}）` : "";
    const pochiLabel = score.pochiColor ? (pochiText[score.pochiColor] ?? `${score.pochiColor}ぽっち`) : "";
    const selectedWaitLine = score.pochiActivated && scoringWinningTile
      ? `<p class="score-pochi-line">${escapeHtml(pochiLabel)}発動 / 採用待ち: ${escapeHtml(formatTile(scoringWinningTile))} / 白ぽっち倍率: ${pochiMultiplier}</p>`
      : "";
    const finalScoreValue = Number(score.finalPoints ?? score.totalPoints ?? 0);
    const finalScoreClass = finalScoreValue < 0 ? " final-score-negative" : "";
    return `<section class="score-result result-modal win-result-modal compact-score-result">
      <p class="score-winner-line">${winner?.name ?? ""} ${score.isTsumo ? "ツモ" : "ロン"}</p>
      ${selectedWaitLine}
      ${score.debugNoPointSettlement ? `<p class="score-note">CPUデバッグ卓: 点数・クラブポイント精算なし</p>` : ""}
      <div class="score-tile-section score-main-tiles">${resultHandWinNukiRow}</div>
      <div class="score-tile-section score-dora-section">
        <div><strong>表ドラ表示牌</strong><div class="result-tiles">${state.doraIndicators.map((tile) => renderTileView({ tile })).join("") || "なし"}</div></div>
        ${winnerRiichi ? `<div><strong>裏ドラ表示牌</strong><div class="result-tiles">${state.uraDoraIndicators.map((tile) => renderTileView({ tile })).join("") || "なし"}</div></div>` : ""}
      </div>
      <div class="score-summary-layout">
        <ul class="score-yaku vertical-yaku">${yakuRows.join("")}</ul>
        <div class="score-big-panel">
          <p class="final-score-line big-final-score${finalScoreClass}">${formatPoint(finalScoreValue)}点</p>
          <p>追加点合計 ${formatPoint(score.bonusPoints ?? 0)}</p>
          <p>倍率合計 ×${multiplierTotal}${multiplierLabels}</p>
        </div>
      </div>
      ${renderAgariYameButton(state)}${renderResultOkButton(state)}
    </section>`;
  }
  score(score, state) {
    return this.scoreBreakdown(score, state);
  }
}

const players = [createPlayer("p1", "プレイヤー1", "human"), createPlayer("p2", "CPU1", "cpu"), createPlayer("p3", "CPU2", "cpu")];
let view;
const controller = new GameController(players, new RuleEngine(), (state) => view.render(state));
globalThis.__anmikaController = controller;
if (typeof window !== "undefined") window.__anmikaController = controller;
view = new GameView(document.querySelector("#game-root"), {
  onStart: () => { controller.getState().screen = "game"; controller.startGame(); },
  onDraw: () => controller.advanceUntilHumanAction(),
  onDiscard: (id) => controller.handleDiscardTileClick(id),
  onAgariYame: (resultId = "") => controller.handleAgariYame({ resultId }),
  onForceDiscardResync: () => controller.resyncSocketGameState("manualDiscardResync"),
  onNuki: (id) => controller.performNukiDora(getCurrentPlayer(controller.getState()).id, id),
  onConfirmAction: (type) => controller.confirmPendingAction(type),
  onSkipAction: () => controller.skipPendingAction(),
  onResultOk: (resultId = "") => controller.handleResultOk({ resultId }),
  onFinalResultOk: () => controller.handleFinalResultOk(),
  onLeaveOnlineLoading: () => controller.leaveOnlineGameToLobby(),
  onForceTableLeave: () => controller.leaveOnlineGameToLobby(),
  onToggleSettings: () => controller.toggleSettings(),
  onUpdateSettings: (partial) => controller.updateSettings(partial),
  onAssistSettings: (playerId, partial) => controller.updateAssistSettings(playerId, partial),
  onOpenRuleHelp: () => controller.openRuleHelp(),
  onCloseRuleHelp: () => controller.closeRuleHelp(),
  onDebugLogin: () => controller.loginDebug(),
  onLoginAccount: (userId, password) => controller.loginWithPassword(userId, password),
  onCreateAccount: (displayName, password) => controller.createAccount(displayName, password),
  onUpdateAccount: (partial) => controller.updateAccountSettings(partial),
  onCopyText: (text, successMessage) => controller.copyText(text, successMessage),
  onOpenLogoutConfirm: () => controller.openLogoutConfirm(),
  onConfirmLogout: () => controller.confirmLogout(),
  onCancelLogout: () => controller.closeLogoutConfirm(),
  onEnterClub: (clubId) => controller.selectClubHome(clubId),
  onCreateClub: (name) => controller.createClub(name),
  onOpenCreateTable: () => controller.openCreateTable(),
  onUpdateCreateTableSettings: (partial) => controller.updateCreateTableSettings(partial),
  onCreateTableSubmit: () => controller.createClubTableFromSettings(),
  onNavigate: (screen) => controller.navigate(screen),
  onCreateTable: () => controller.createFreeTable(),
  onOpenTable: (tableId) => controller.selectTable(tableId),
  onJoinSeat: (tableId, seatIndex) => controller.joinSeat(tableId, seatIndex),
  onFillCpu: (tableId) => controller.fillTableWithCpu(tableId),
  onLeaveSeat: (tableId) => controller.leaveSeat(tableId),
  onDeleteTable: (tableId) => controller.deleteTable(tableId),
  onJoinWaiting: (tableId) => controller.joinWaitingList(tableId),
  onSeatLastHand: (tableId, checked) => controller.updateSeatLastHand(tableId, controller.currentUserId(), checked),
  onOpenReplay: (replayId) => controller.openReplay(replayId),
  onCopyReplayUrl: (replayId) => controller.copyReplayUrl(replayId),
  onCopyTableUrl: (tableId) => controller.copyTableUrl(tableId),
  onReplayStep: (delta) => controller.stepReplay(delta),
  onReplayIndex: (index) => controller.setReplayIndex(index),
  onReplayNext: () => controller.goNextReplayStep(),
  onReplayPrev: () => controller.goPrevReplayStep(),
  onReplayViewer: (viewerId) => controller.setReplayViewer(viewerId),
  onReplayRevealHands: (checked) => controller.setReplayRevealHands(checked),
  onClubSearch: (clubId) => controller.searchClub(clubId),
  onOpenClub: (clubId) => controller.openClub(clubId),
  onApplyClub: (clubId) => controller.applyToClub(clubId),
  onApproveApplicant: (clubId, applicantId) => controller.approveClubApplicant(clubId, controller.currentUserId(), applicantId),
  onRejectApplicant: (clubId, applicantId) => controller.rejectClubApplicant(clubId, controller.currentUserId(), applicantId),
  onCreateClubTable: (clubId) => controller.createClubTable(clubId),
  onTransferPoints: (clubId, memberId, amount) => controller.transferClubPointsToMember(clubId, controller.currentUserId(), memberId, amount),
  onCollectPoints: (clubId, memberId, amount) => controller.collectClubPointsFromMember(clubId, controller.currentUserId(), memberId, amount),
  onGrantClubAdmin: (clubId, memberId) => controller.grantClubAdminRole(clubId, controller.currentUserId(), memberId),
  onRemoveClubMember: (clubId, memberId) => controller.removeClubMember(clubId, controller.currentUserId(), memberId),
});
view.bindStaticControls(document.querySelector("#start-button"), document.querySelector("#draw-button"));
const routeFromHash = () => {
  const replayId = getReplayIdFromHash();
  if (replayId) {
    controller.openReplay(replayId, { updateHash: false });
    return true;
  }
  const tableId = getTableIdFromHash();
  if (tableId) {
    if (isOnlineDebugLocalTableId(tableId) && loadTables().some((table) => table.id === tableId)) {
      controller.startGameForTable(tableId);
      return true;
    }
    controller.selectTable(tableId);
    return true;
  }
  return false;
};
try {
  const pendingOnlineDebugLaunchTableId = getPendingOnlineDebugLaunchTableId();
  if (pendingOnlineDebugLaunchTableId && loadTables().some((table) => table.id === pendingOnlineDebugLaunchTableId)) {
    controller.startGameForTable(pendingOnlineDebugLaunchTableId);
  } else if (pendingOnlineDebugLaunchTableId) {
    renderStartupFallback("対局開始用の卓データが見つかりません。卓一覧に戻って、もう一度3人着席から開始してください。");
  } else if (!routeFromHash()) {
    goToOnlineDebugLobby(localStorage.getItem("anmikaOnlineDebug.returnClubId") || "", true);
  }
} catch (error) {
  console.error("[Startup] 麻雀画面の起動に失敗しました", error);
  renderStartupFallback(error?.message || String(error));
}
window.addEventListener("hashchange", () => {
  if (!routeFromHash()) {
    goToOnlineDebugLobby(controller.getState().selectedClubId || controller.getState().activeClubId || "", true);
  }
});
window.addEventListener("popstate", () => routeFromHash());
window.addEventListener("contextmenu", (event) => {
  if (event.target?.closest?.("input, textarea, [contenteditable='true']")) return;
  event.preventDefault();
  controller.handleContextMenuAction();
});
let lastTableTapAt = 0;
window.addEventListener("touchend", (event) => {
  if (event.target?.closest?.("button, a, input, textarea, select, label, [contenteditable='true'], .tile-button")) return;
  const nowMs = Date.now();
  if (nowMs - lastTableTapAt <= 360) {
    event.preventDefault();
    controller.handleContextMenuAction();
    lastTableTapAt = 0;
    return;
  }
  lastTableTapAt = nowMs;
}, { passive: false });
setInterval(() => controller.tickClock(), 500);
setInterval(() => {
  if (isSocketAuthoritativeGame()) return;
  refreshOnlineSyncFromServer().catch((error) => {
    console.warn("[OnlineSync] 最新局面の取得に失敗しました", error);
  });
}, 2500);
window.__mahjongDebug = { getWinningTilesForTenpai, canFormWinningShape, createVirtualTile, tileKindKey, formatTile, buildViewStateForPlayer, buildTableState, canUseTsumogiriShortcut, userRepository, tableRepository, clubRepository, replayRepository, replayUrlFor, tableUrlFor, canDeleteTableRoom, evaluateWinExplicit, createWallTiles, normalizeAnmikaRocketRuleConfig, isPureClosedTriplet, hasTurquoise5pInHandOrMelds };
