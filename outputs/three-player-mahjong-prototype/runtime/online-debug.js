(function () {
  const JA_MESSAGES = {
    actionFailed: "操作に失敗しました",
    cause: "原因",
    passwordRequired: "パスワードを入力してください。",
    passwordTooShort: "パスワードは6文字以上で入力してください。",
    displayNameRequired: "プレイヤー名を入力してください。",
    userIdRequired: "ログインIDを入力してください。",
    invalidLogin: "メールアドレスまたはパスワードが違います。",
    profileNotFound: "ユーザー情報が見つかりません。",
    selectClub: "クラブを選択してください。",
    selectTable: "卓を選択してください。",
    signInRequired: "先にログインしてください。",
  };

  const config = window.ANMIKA_SUPABASE_CONFIG || {};
  const SUPER_CLUB_CREATOR_USER_ID = "3cda7884-9464-4b26-b7a2-bd79cc5ab65f";
  const SUPER_CLUB_CREATOR_EMAIL = "h1320000819@gamil.com";
  const TSUMO_LOSSLESS_3MA_RULE_ID = "tsumo-lossless-red-3ma";
  const TSUMO_LOSSLESS_3MA_LABEL = "全赤三麻";
  const RULE_LABELS = {
    "anmika-rocket": "アンミカロケット",
    [TSUMO_LOSSLESS_3MA_RULE_ID]: TSUMO_LOSSLESS_3MA_LABEL,
  };
  const DEBUG_RENDER_MS = 5000;
  const GAME_SERVER_PROBE_MS = 120000;
  const GAME_SERVER_STARTUP_TIMEOUT_MS = 60000;
  const GAME_SERVER_STARTUP_RETRY_MS = 2500;
  const GAME_SERVER_HEALTH_TIMEOUT_MS = 6000;
  const DEBUG_LAUNCHING_TABLE_KEY = "anmikaOnlineDebug.launchingTable";
  const DEBUG_AUTO_OPENED_TABLES_KEY = "anmikaOnlineDebug.autoOpenedTables";
  const DEBUG_AUTO_START_FAILED_TABLES_KEY = "anmikaOnlineDebug.autoStartFailedTables";
  const DEBUG_RECENTLY_LEFT_TABLE_KEY = "anmikaOnlineDebug.recentlyLeftTable";
  const DEBUG_LAUNCHING_SUPPRESS_MS = 90000;
  const DEBUG_AUTO_OPEN_SUPPRESS_MS = 10 * 60 * 1000;
  const DEBUG_AUTO_START_FAILURE_SUPPRESS_MS = 45000;
  const DEBUG_RETURN_CLUB_KEY = "anmikaOnlineDebug.returnClubId";
  const ENABLE_AUTO_TABLE_START = true;
  const LOBBY_AUTO_REFRESH_MS = 3000;
  const GAME_AUTO_REFRESH_MS = 2500;

  const initialParams = new URLSearchParams(location.search);
  const initialRecentlyLeft = (() => {
    try { return JSON.parse(sessionStorage.getItem(DEBUG_RECENTLY_LEFT_TABLE_KEY) || "null") || {}; } catch { return {}; }
  })();
  const initialReturnClubId = initialParams.get("returnClubId") || localStorage.getItem(DEBUG_RETURN_CLUB_KEY) || sessionStorage.getItem("anmikaOnlineDebugActiveClubId") || "";
  const initialSettingsPage = initialParams.get("settings") || "";
  const shouldOpenTableListOnBoot = Boolean(initialReturnClubId || initialParams.get("leftTableId"));
  const state = {
    accessToken: localStorage.getItem("anmikaAccessToken") || "",
    refreshToken: localStorage.getItem("anmikaRefreshToken") || "",
    user: JSON.parse(localStorage.getItem("anmikaDebugUser") || "null"),
    clubs: [],
    memberships: [],
    joinRequests: [],
    adminJoinRequests: [],
    clubCreationStatus: null,
    tables: [],
    activeGameState: null,
    activeGameEvents: [],
    lastGameSyncAt: "",
    onlineGameOpened: false,
    autoStartingTableIds: new Set(),
    autoStartFailedTableIds: new Set(),
    autoOpenedPlayingTableIds: new Set(),
    gameServerProbe: { status: "未確認", lastError: "", checkedAt: "" },
    activeClubId: initialReturnClubId,
    activeTableId: initialParams.get("tableId") || sessionStorage.getItem("anmikaOnlineDebugActiveTableId") || "",
    recentlyLeftTableId: initialParams.get("leftTableId") || initialRecentlyLeft.tableId || "",
    recentlyLeftAt: Number(initialParams.get("leftAt") || initialRecentlyLeft.leftAt || 0),
    searchedClub: null,
    localSeatsByTable: JSON.parse(sessionStorage.getItem("anmikaOnlineDebugSeats") || "{}"),
    pollTimer: 0,
    clubPollTimer: 0,
    lobbyRefreshInFlight: false,
    lobbyRefreshPending: false,
    tablePostRefreshInFlight: false,
  };

  const $ = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error("missing element: " + id);
    return element;
  };
  const has = (id) => !!document.getElementById(id);
  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");
  const isOnlineDebugLocalTableId = (value) => String(value || "").startsWith("online-debug-");
  const sourceTableIdFromLocalDebugId = (value) => {
    const text = String(value || "");
    return isOnlineDebugLocalTableId(text) ? text.replace(/^online-debug-/, "") : text;
  };
  const normalizeRemoteTableId = (value) => {
    const tableId = sourceTableIdFromLocalDebugId(value);
    return isUuid(tableId) ? tableId : "";
  };
  const extractClubSearchText = (input) => {
    const raw = String(input || "").trim();
    if (!raw) return "";
    const codeMatch = raw.match(/C-[A-Za-z0-9]{6,20}/);
    if (codeMatch) return codeMatch[0].toUpperCase();
    const uuidMatch = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) return uuidMatch[0];
    return raw.replace(/^クラブID\s*[:：]\s*/i, "").trim();
  };
  const selectedClubId = () => state.activeClubId || (has("clubSelect") ? $("clubSelect").value : "") || "";
  const selectedTableId = () => normalizeRemoteTableId(state.activeTableId || (has("tableSelect") ? $("tableSelect").value : "") || new URLSearchParams(location.search).get("tableId") || "");
  const selectedMembership = () => state.memberships.find((row) => row.clubs && row.clubs.club_id === selectedClubId());
  const membershipForClub = (clubId) => state.memberships.find((row) => row.clubs && row.clubs.club_id === clubId);
  const isAdmin = () => selectedMembership()?.role === "admin";
  const isSuperClubCreator = () => state.user?.id === SUPER_CLUB_CREATOR_USER_ID || String(state.user?.email || "").toLowerCase() === SUPER_CLUB_CREATOR_EMAIL;
  const canViewSuperRakeShare = () => isAdmin() || isSuperClubCreator();
  const canCreateClub = () => Boolean(state.clubCreationStatus?.can_create || state.clubCreationStatus?.canCreate || isSuperClubCreator());
  const formatPointShort = (value) => {
    const number = Math.round(Number(value || 0) * 10) / 10;
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
  };
  const requiredSeatPointBalance = (table) => {
    const rate = Math.max(0, Number(table?.point_rate || 1));
    return (table?.rule_id || "anmika-rocket") === TSUMO_LOSSLESS_3MA_RULE_ID ? 150 * rate : 1000 * rate;
  };
  const tableById = (tableId) => state.tables.find((item) => item?.table_id === tableId) || null;
  const loadTableForSeatCheck = async (tableId) => {
    const known = tableById(tableId);
    if (known) return known;
    const rows = await rest(
      "/tables?select=table_id,club_id,rule_id,point_rate&table_id=eq." + encodeURIComponent(tableId) + "&limit=1"
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  };
  const loadMyPointBalanceForClub = async (clubId) => {
    const user = requireUser();
    try {
      const rows = await rest(
        "/club_members?select=point_balance&club_id=eq." + encodeURIComponent(clubId) +
          "&user_id=eq." + encodeURIComponent(user.id) +
          "&limit=1"
      );
      if (Array.isArray(rows) && rows[0]) {
        const balance = Number(rows[0].point_balance || 0);
        state.memberships = state.memberships.map((row) =>
          row.clubs?.club_id === clubId ? { ...row, point_balance: balance } : row
        );
        return balance;
      }
    } catch (error) {
      log("着席前のポイント残高確認に失敗したため、画面上の残高で判定します。", rawErrorText(error));
    }
    return Number(membershipForClub(clubId)?.point_balance || 0);
  };
  const ensureEnoughClubPointsForSeat = async (tableId) => {
    const table = await loadTableForSeatCheck(tableId);
    const clubId = table?.club_id || selectedClubId();
    if (!table || !clubId) throw new Error("着席に必要な卓情報を取得できませんでした。更新してからもう一度お試しください。");
    const required = requiredSeatPointBalance(table);
    const balance = await loadMyPointBalanceForClub(clubId);
    if (balance + 1e-9 < required) {
      const ruleLabel = RULE_LABELS[table.rule_id || "anmika-rocket"] || "この卓";
      throw new Error(`残高が足りません。${ruleLabel}に着席するには ${formatPointShort(required)} pt 必要です。現在の残高: ${formatPointShort(balance)} pt`);
    }
  };
  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const asArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const readJsonStorage = (key, fallback = null) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  };
  const loadSocketDebugStatus = () => readJsonStorage("anmikaRocket.socketDebug", {});
  const loadClubIconCache = () => {
    try {
      return JSON.parse(localStorage.getItem("anmikaClubIconCache") || "{}") || {};
    } catch {
      return {};
    }
  };
  const saveClubIconCache = (clubId, iconUrl) => {
    if (!clubId) return;
    const cache = loadClubIconCache();
    if (iconUrl) cache[clubId] = iconUrl;
    else delete cache[clubId];
    localStorage.setItem("anmikaClubIconCache", JSON.stringify(cache));
  };
  const cachedClubIcon = (clubId) => loadClubIconCache()[clubId] || "";
  const mergeClubIcon = (club) => {
    if (!club?.club_id) return club;
    return { ...club, icon_url: club.icon_url || cachedClubIcon(club.club_id) || "" };
  };
  const leftClubCacheKey = () => `anmikaLeftClubIds:${state.user?.id || "anonymous"}`;
  const loadLeftClubIds = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(leftClubCacheKey()) || "[]"));
    } catch {
      return new Set();
    }
  };
  const saveLeftClubIds = (ids) => {
    localStorage.setItem(leftClubCacheKey(), JSON.stringify([...ids].filter(Boolean)));
  };
  const markClubLeft = (clubId) => {
    const ids = loadLeftClubIds();
    ids.add(clubId);
    saveLeftClubIds(ids);
  };
  const clearClubLeft = (clubId) => {
    const ids = loadLeftClubIds();
    ids.delete(clubId);
    saveLeftClubIds(ids);
  };
  const isClubLeft = (clubId) => loadLeftClubIds().has(clubId);
  const profileToUser = (profile) => ({
    id: profile.user_id,
    loginId: profile.login_id || profile.user_id,
    displayName: profile.display_name || "Player",
    iconUrl: profile.icon_url || "",
  });
  const uniqueMembershipRows = (rows) => {
    const byClub = new Map();
    (rows || []).forEach((row) => {
      const club = row?.clubs;
      if (!club?.club_id) return;
      const existing = byClub.get(club.club_id);
      if (!existing || existing.role !== "admin") byClub.set(club.club_id, row);
      if (existing && row.role === "admin") byClub.set(club.club_id, row);
    });
    return [...byClub.values()];
  };
  const localSeatKey = (tableId) => String(tableId || "default");
  const launchingTablePayload = () => readJsonStorage(DEBUG_LAUNCHING_TABLE_KEY, null);
  const clearLaunchingTable = () => sessionStorage.removeItem(DEBUG_LAUNCHING_TABLE_KEY);
  const markLaunchingTable = (tableId) => {
    sessionStorage.setItem(DEBUG_LAUNCHING_TABLE_KEY, JSON.stringify({ tableId, startedAt: Date.now() }));
  };
  const autoOpenedTables = () => readJsonStorage(DEBUG_AUTO_OPENED_TABLES_KEY, {});
  const saveAutoOpenedTables = (value) => sessionStorage.setItem(DEBUG_AUTO_OPENED_TABLES_KEY, JSON.stringify(value || {}));
  const autoStartFailedTables = () => readJsonStorage(DEBUG_AUTO_START_FAILED_TABLES_KEY, {});
  const saveAutoStartFailedTables = (value) => sessionStorage.setItem(DEBUG_AUTO_START_FAILED_TABLES_KEY, JSON.stringify(value || {}));
  const markAutoOpenedTable = (tableId) => {
    if (!tableId) return;
    const opened = autoOpenedTables();
    opened[String(tableId)] = Date.now();
    saveAutoOpenedTables(opened);
  };
  const clearAutoOpenedTable = (tableId) => {
    if (!tableId) return;
    const opened = autoOpenedTables();
    delete opened[String(tableId)];
    saveAutoOpenedTables(opened);
  };
  const wasAutoOpenedRecently = (tableId) => {
    const opened = autoOpenedTables();
    const at = Number(opened[String(tableId)] || 0);
    if (!at) return false;
    if (Date.now() - at > DEBUG_AUTO_OPEN_SUPPRESS_MS) {
      clearAutoOpenedTable(tableId);
      return false;
    }
    return true;
  };
  const markAutoStartFailedTable = (tableId) => {
    if (!tableId) return;
    const failed = autoStartFailedTables();
    failed[String(tableId)] = Date.now();
    saveAutoStartFailedTables(failed);
  };
  const clearAutoStartFailedTable = (tableId) => {
    if (!tableId) return;
    const failed = autoStartFailedTables();
    delete failed[String(tableId)];
    saveAutoStartFailedTables(failed);
  };
  const wasAutoStartFailedRecently = (tableId) => {
    if (!tableId) return false;
    const failed = autoStartFailedTables();
    const at = Number(failed[String(tableId)] || 0);
    if (!at) return false;
    if (Date.now() - at > DEBUG_AUTO_START_FAILURE_SUPPRESS_MS) {
      clearAutoStartFailedTable(tableId);
      return false;
    }
    return true;
  };
  const isLaunchInProgress = (tableId = "") => {
    const payload = launchingTablePayload();
    if (!payload?.tableId || !payload?.startedAt) return false;
    if (Date.now() - Number(payload.startedAt) > DEBUG_LAUNCHING_SUPPRESS_MS) {
      clearLaunchingTable();
      return false;
    }
    return !tableId || String(payload.tableId) === String(tableId);
  };
  const RECENTLY_LEFT_SUPPRESS_MS = 180000;
  const isRecentlyLeftTable = (tableId) =>
    Boolean(
      tableId &&
      state.recentlyLeftTableId &&
      String(tableId) === String(state.recentlyLeftTableId) &&
      Date.now() - Number(state.recentlyLeftAt || 0) < RECENTLY_LEFT_SUPPRESS_MS
    );
  const clearRecentlyLeftTableIfExpired = () => {
    if (!state.recentlyLeftTableId) return;
    if (isRecentlyLeftTable(state.recentlyLeftTableId)) return;
    state.recentlyLeftTableId = "";
    state.recentlyLeftAt = 0;
    sessionStorage.removeItem(DEBUG_RECENTLY_LEFT_TABLE_KEY);
  };
  const clearRecentlyLeftTable = (tableId = "") => {
    if (!state.recentlyLeftTableId) return;
    if (tableId && String(state.recentlyLeftTableId) !== String(tableId)) return;
    state.recentlyLeftTableId = "";
    state.recentlyLeftAt = 0;
    sessionStorage.removeItem(DEBUG_RECENTLY_LEFT_TABLE_KEY);
  };
  const markRecentlyLeftTable = (tableId, leftAt = Date.now()) => {
    tableId = normalizeRemoteTableId(tableId);
    if (!tableId) return;
    state.recentlyLeftTableId = tableId;
    state.recentlyLeftAt = Number(leftAt || Date.now());
    try {
      sessionStorage.setItem(DEBUG_RECENTLY_LEFT_TABLE_KEY, JSON.stringify({ tableId, leftAt: state.recentlyLeftAt }));
    } catch {}
  };
  const maskRecentlyLeftTable = (table) => {
    if (!table?.table_id || !isRecentlyLeftTable(table.table_id)) return table;
    const tableSeats = Array.isArray(table.table_seats)
      ? table.table_seats.map((seat) => seat?.user_id === state.user?.id
        ? { ...seat, user_id: null, player_type: "empty", display_name: null, is_last_hand_declared: false }
        : { ...seat, is_last_hand_declared: false })
      : table.table_seats;
    return { ...table, status: "waiting", table_seats: tableSeats };
  };
  const emptySeatRows = (tableId) =>
    [0, 1, 2].map((seatIndex) => ({
      table_id: tableId,
      seat_index: seatIndex,
      user_id: null,
      player_type: "empty",
      display_name: null,
    }));
  const parseSeatRows = (rows) => {
    if (Array.isArray(rows)) return rows;
    if (typeof rows === "string") {
      try {
        const parsed = JSON.parse(rows);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  const normalizeSeats = (rows, tableId) => {
    const byIndex = new Map(parseSeatRows(rows).map((seat) => [Number(seat.seat_index ?? seat.seatIndex), {
      ...seat,
      table_id: seat.table_id ?? seat.tableId ?? tableId,
      seat_index: Number(seat.seat_index ?? seat.seatIndex),
      user_id: seat.user_id ?? seat.userId ?? null,
      player_type: seat.player_type ?? seat.playerType ?? "empty",
      display_name: seat.display_name ?? seat.displayName ?? null,
      is_last_hand_declared: Boolean(seat.is_last_hand_declared ?? seat.isLastHandDeclared),
    }]));
    return emptySeatRows(tableId).map((emptySeat) => ({ ...emptySeat, ...(byIndex.get(emptySeat.seat_index) || {}) }));
  };
  const getLocalSeats = (tableId) => normalizeSeats(state.localSeatsByTable[localSeatKey(tableId)] || [], tableId);
  const getKnownSeats = (tableId) => {
    const table = state.tables.find((item) => item.table_id === tableId);
    const tableSeats = parseSeatRows(table?.table_seats || table?.seats || table?.tableSeats);
    if (tableSeats.length) return normalizeSeats(tableSeats, tableId);
    return getLocalSeats(tableId);
  };
  const saveLocalSeats = (tableId, rows) => {
    state.localSeatsByTable[localSeatKey(tableId)] = normalizeSeats(rows, tableId);
    sessionStorage.setItem("anmikaOnlineDebugSeats", JSON.stringify(state.localSeatsByTable));
  };
  const saveLocalSeatsCache = () => {
    sessionStorage.setItem("anmikaOnlineDebugSeats", JSON.stringify(state.localSeatsByTable || {}));
  };
  const clearLocalUserSeatsExcept = (tableId, seatIndex) => {
    if (!state.user?.id) return;
    Object.entries(state.localSeatsByTable || {}).forEach(([key, rows]) => {
      state.localSeatsByTable[key] = normalizeSeats(rows, key).map((seat) => {
        if (seat.user_id !== state.user.id) return seat;
        if (String(seat.table_id || key) === String(tableId) && Number(seat.seat_index) === Number(seatIndex)) return seat;
        return {
          ...seat,
          user_id: null,
          player_type: "empty",
          display_name: null,
          is_last_hand_declared: false,
        };
      });
    });
    saveLocalSeatsCache();
  };
  const clearLocalUserSeatsForTable = (tableId, userId = state.user?.id) => {
    if (!userId || !tableId) return;
    const key = localSeatKey(tableId);
    state.localSeatsByTable[key] = normalizeSeats(state.localSeatsByTable[key] || [], tableId).map((seat) => {
      if (seat.user_id !== userId) return seat;
      return {
        ...seat,
        user_id: null,
        player_type: "empty",
        display_name: null,
        is_last_hand_declared: false,
      };
    });
    saveLocalSeatsCache();
  };
  const clearLocalUserLastHandFlagForTable = (tableId, userId = state.user?.id) => {
    if (!userId || !tableId) return;
    const key = localSeatKey(tableId);
    state.localSeatsByTable[key] = normalizeSeats(state.localSeatsByTable[key] || [], tableId).map((seat) =>
      seat.user_id === userId ? { ...seat, is_last_hand_declared: false } : seat
    );
    saveLocalSeatsCache();
  };
  const filledSeatCount = (rows) => rows.filter((seat) => seat.user_id || seat.player_type === "cpu").length;
  const hasCpuSeat = (rows) => rows.some((seat) => seat.player_type === "cpu");
  const visibleTableSeats = (table) => normalizeSeats(
    table?.table_seats || table?.seats || table?.tableSeats || state.localSeatsByTable[localSeatKey(table?.table_id)] || [],
    table?.table_id
  );
  const enforceOneVisibleSeatForCurrentUser = (preferredTableId = state.activeTableId, preferredSeatIndex = null) => {
    if (!state.user?.id || !Array.isArray(state.tables)) return;
    const userId = state.user.id;
    const ownSeats = [];
    for (const table of state.tables) {
      const seats = visibleTableSeats(table);
      seats.forEach((seat) => {
        if (seat.user_id === userId) ownSeats.push({ tableId: table.table_id, seatIndex: seat.seat_index });
      });
    }
    if (ownSeats.length <= 1) return;
    const keep =
      ownSeats.find((seat) => String(seat.tableId) === String(preferredTableId) && (preferredSeatIndex === null || preferredSeatIndex === undefined || Number(seat.seatIndex) === Number(preferredSeatIndex))) ||
      ownSeats.find((seat) => String(seat.tableId) === String(preferredTableId)) ||
      ownSeats[ownSeats.length - 1];
    state.tables = state.tables.map((table) => ({
      ...table,
      table_seats: visibleTableSeats(table).map((seat) => {
        if (seat.user_id !== userId) return seat;
        if (String(table.table_id) === String(keep.tableId) && Number(seat.seat_index) === Number(keep.seatIndex)) return seat;
        return {
          ...seat,
          user_id: null,
          player_type: "empty",
          display_name: null,
          is_last_hand_declared: false,
        };
      }),
    }));
    clearLocalUserSeatsExcept(keep.tableId, keep.seatIndex);
  };
  const visibleTableWaiting = (table) => Array.isArray(table?.table_waiting_list)
    ? [...table.table_waiting_list].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    : [];
  const waitingUserName = (row) => {
    const profile = Array.isArray(row.users) ? row.users[0] : row.users;
    if (row.user_id === state.user?.id) return state.user.displayName || "あなた";
    return profile?.display_name || row.display_name || `Player ${String(row.user_id || "").slice(0, 8)}`;
  };
  const isCurrentUserWaitingForTable = (table) =>
    Boolean(state.user?.id && visibleTableWaiting(table).some((row) => row.user_id === state.user.id));
  const formatSeatName = (seat) => {
    if (seat.player_type === "cpu") return seat.display_name || `CPU${Number(seat.seat_index) + 1}`;
    if (seat.user_id) {
      if (state.user?.id === seat.user_id) return state.user.displayName || "あなた";
      return seat.display_name || `Player ${String(seat.user_id).slice(0, 8)}`;
    }
    return "空席";
  };
  const requireTableId = (tableId, actionName = "操作") => {
    if (!tableId) throw new Error(`${actionName}に失敗しました。原因: tableId が取得できません。`);
    return tableId;
  };
  const getStartableTableId = () => {
    const direct =
      normalizeRemoteTableId(state.activeTableId) ||
      normalizeRemoteTableId(has("tableSelect") ? $("tableSelect").value : "") ||
      normalizeRemoteTableId(new URLSearchParams(location.search).get("tableId"));
    if (direct) return direct;
    const tables = Array.isArray(state.tables) ? state.tables : [];
    const ownTable = tables.find((table) => isCurrentUserSeatedAt(visibleTableSeats(table)));
    if (ownTable?.table_id) return normalizeRemoteTableId(ownTable.table_id);
    const fullTable = tables.find((table) => filledSeatCount(visibleTableSeats(table)) >= 3);
    if (fullTable?.table_id) return normalizeRemoteTableId(fullTable.table_id);
    return normalizeRemoteTableId(tables.find((table) => table?.table_id)?.table_id);
  };
  const setActiveTableId = (tableId) => {
    tableId = normalizeRemoteTableId(tableId);
    if (!tableId) {
      state.activeTableId = "";
      sessionStorage.removeItem("anmikaOnlineDebugActiveTableId");
      return;
    }
    state.activeTableId = tableId;
    sessionStorage.setItem("anmikaOnlineDebugActiveTableId", tableId);
    if (!has("tableSelect")) return;
    if (![...$("tableSelect").options].some((option) => option.value === tableId)) {
      const option = document.createElement("option");
      option.value = tableId;
      option.textContent = tableId;
      $("tableSelect").append(option);
    }
    $("tableSelect").value = tableId;
  };
  const setActiveClubId = (clubId) => {
    if (!clubId) return;
    state.activeClubId = clubId;
    sessionStorage.setItem("anmikaOnlineDebugActiveClubId", clubId);
    if (!has("clubSelect")) return;
    if (![...$("clubSelect").options].some((option) => option.value === clubId)) {
      const option = document.createElement("option");
      option.value = clubId;
      option.textContent = clubId;
      $("clubSelect").append(option);
    }
    $("clubSelect").value = clubId;
  };

  const stringify = (value) => {
    if (value instanceof Error) return value.message;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const rawErrorText = (error) => {
    if (!error) return "";
    const data = error.data || {};
    const parts = [
      error.message,
      error.status,
      data.message,
      data.code || error.code,
      data.details || error.details,
      data.hint || error.hint,
      data.error_description,
      data.error,
    ].filter(Boolean);
    if (parts.length) return [...new Set(parts.map(String))].join("\n");
    return stringify(error);
  };
  const isMissingRpcError = (error, rpcName = "") => {
    const raw = rawErrorText(error);
    return (
      Number(error?.status) === 404 ||
      raw.includes("PGRST202") ||
      raw.includes("schema cache") ||
      raw.includes("Could not find the function") ||
      (rpcName && raw.includes(rpcName))
    );
  };

  const toJapaneseError = (message) => {
    if (!message) return "詳細不明のエラーです。";
    if (message.includes("invalid input syntax for type uuid")) return "空のIDが送信されました。クラブまたは卓を選択してから操作してください。";
    if (message.includes("no empty seat")) return "空席がありません。";
    if (message.includes("not club member")) return "クラブに所属していないため着席できません。";
    if (message.includes("admin required")) return "管理者権限がありません。";
    if (message.includes("table not found")) return "卓が見つかりません。";
    if (message.includes("debug start")) return "デバッグ対局を開始できません。3席を埋めてから開始してください。";
    if (message.includes("new row violates row-level security policy for table \"tables\"")) return "卓作成がDBの保護ルールにより拒否されました。patch_create_table_with_seats.sql を実行してください。";
    if (message.includes("create_table_with_seats") && message.includes("schema cache")) return "卓作成用のDB関数が見つかりません。patch_create_table_with_seats.sql を実行してください。";
    if (message.includes("Password should be at least") || message.includes("at least 6")) return JA_MESSAGES.passwordTooShort;
    if (message.includes("Invalid login credentials")) return JA_MESSAGES.invalidLogin;
    if (message.includes("User already registered")) return "このユーザーはすでに登録されています。";
    if (message.includes("get_login_email") && message.includes("schema cache")) return "ログイン用のDB関数が見つかりません。最新版の schema.sql または該当パッチSQLを実行してください。";
    if (message.includes("ensure_user_profile") && message.includes("schema cache")) return "ユーザー情報作成用のDB関数が見つかりません。patch_auth_profile.sql を実行してください。";
    if (message.includes("create_club_with_owner") && message.includes("schema cache")) return "クラブ作成用のDB関数が見つかりません。patch_club_owner_membership.sql を実行してください。";
    if (message.includes("get_my_clubs") && message.includes("schema cache")) return "アカウントに紐づくクラブ取得用のDB関数が見つかりません。patch_account_persistent_data.sql を実行してください。";
    if (message.includes("find_club_for_join") && message.includes("schema cache")) return "クラブ検索用のDB関数が見つかりません。patch_club_search_join_rpc.sql を実行してください。";
    if (message.includes("request_join_club_by_code") && message.includes("schema cache")) return "クラブ加入申請用のDB関数が見つかりません。patch_club_search_join_rpc.sql を実行してください。";
    if (message.includes("ensure_online_game_for_table") && message.includes("schema cache")) return "オンライン対局開始用のDB関数が見つかりません。patch_online_game_sync_safe.sql を実行してください。";
    if (message.includes("submit_game_action") && message.includes("schema cache")) return "オンライン対局イベント用のDB関数が見つかりません。patch_online_game_sync_safe.sql を実行してください。";
    if (message.includes("club not found")) return "そのクラブは見つかりません。クラブID（C-XXXXXX）を確認してください。";
    if (message.includes("shared_sit_at_table") && message.includes("schema cache")) return "共有着席用のDB関数が見つかりません。patch_one_user_one_global_seat.sql を実行してください。";
    if (message.includes("sit_at_table") && message.includes("schema cache")) return "着席用のDB関数が見つかりません。patch_one_user_one_global_seat.sql を実行してください。";
    if (message.includes("JWT expired") || message.includes("PGRST303")) return "ログイン期限が切れました。自動更新に失敗した場合は、いったんログアウトして再ログインしてください。";
    if (message.includes("ByteString") || message.includes("greater than 255")) return "ログイン情報または通信ヘッダーが壊れています。いったんログアウトして再ログインしてください。";
    if (message.includes("duplicate key") && message.includes("owner_user_id")) return "このアカウントではすでにクラブを作成済みです。加入済みクラブ一覧を更新してください。";
    if (message.includes("club creation not permitted")) return "このアカウントにはクラブ作成権限がありません。";
    if (message.includes("club creation limit reached")) return "このアカウントで作成できるクラブ数は1つまでです。";
    if (message.includes("club creation grant admin required")) return "クラブ作成権限を付与できるのは特権アカウントだけです。";
    if (message.includes("super account required")) return "この設定を変更できるのは特権アカウントだけです。";
    if (message.includes("percent must be between 0 and 100")) return "割合は0%から100%の間で入力してください。";
    if (message.includes("login id already used") || message.includes("users_login_id_unique")) return "このログインIDはすでに使われています。別のIDを入力してください。";
    if (message.includes("amount exceeds club point limit")) return "一度に操作できるポイントは10,000,000ポイント以下です。";
    if (message.includes("club reserve would be negative")) return "クラブ保管ポイントが不足しています。送信でクラブ保管ポイントをマイナスにはできません。";
    if (message.includes("member balance would be negative")) return "対象プレイヤーのポイントが不足しています。送信・回収で残高をマイナスにはできません。";
    if (message.includes("amount must be positive")) return "ポイント数は1以上で入力してください。";
    return message;
  };

  const getErrorText = (error) => {
    const raw = rawErrorText(error);
    const mapped = toJapaneseError(raw);
    return mapped === raw ? raw : mapped + "\n\nSupabase詳細:\n" + raw;
  };
  const toJapaneseAuthError = toJapaneseError;

  const log = (message, detail) => {
    if (!has("logOutput")) return;
    const extra = detail === undefined ? "" : "\n" + stringify(detail);
    $("logOutput").textContent = new Date().toLocaleTimeString() + " " + message + extra + "\n\n" + ($("logOutput").textContent || "");
  };
  const uiLog = (label, detail) => {
    console.log(`[UI] ${label}`, detail || "");
    log(`[UI] ${label}`, detail);
  };
  const copyText = async (text, successMessage = "コピーしました") => {
    if (!text) throw new Error("コピーする文字列がありません。");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    log(successMessage, text);
  };
  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      if (!file) return reject(new Error("画像ファイルを選択してください。"));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
      reader.readAsDataURL(file);
    });
  const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");
  const isLocalHostName = (hostname) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const isPublicOrigin = () => location.protocol === "https:" && !isLocalHostName(location.hostname);
  const pcOrigin = () => {
    if (location.protocol === "file:") return "http://localhost:5173";
    return location.origin;
  };
  const mobileOrigin = () => {
    if (isPublicOrigin()) return location.origin;
    return trimTrailingSlash(config.devLanOrigin) || "http://192.168.x.x:5173";
  };
  const buildAppUrl = (path = "/online-debug") => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${mobileOrigin()}${normalizedPath}`;
  };
  const buildTableShareUrl = (tableId) => buildAppUrl(`/table/${encodeURIComponent(tableId)}`);
  const fetchWithTimeout = async (url, options = {}, timeoutMs = GAME_SERVER_HEALTH_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  const probeGameServer = async () => {
    if (location.protocol === "file:") {
      state.gameServerProbe = { status: "NG", lastError: "file://ではゲームサーバー疎通確認ができません", checkedAt: new Date().toLocaleString("ja-JP") };
      return state.gameServerProbe;
    }
    try {
      const response = await fetchWithTimeout(`${location.origin}/health`, { cache: "no-store" });
      const diagnostic = await response.json().catch(() => null);
      state.gameServerProbe = {
        status: response.ok ? "OK" : "NG",
        lastError: response.ok ? "" : `HTTP ${response.status}`,
        checkedAt: new Date().toLocaleString("ja-JP"),
        diagnostics: diagnostic,
        lastException: diagnostic?.lastException || null,
        lastGameStateSyncFailure: diagnostic?.lastGameStateSyncFailure || null,
        memoryMb: diagnostic?.memoryMb || null,
      };
    } catch (error) {
      state.gameServerProbe = { status: "NG", lastError: error?.message || String(error), checkedAt: new Date().toLocaleString("ja-JP") };
    }
    renderDebug();
    return state.gameServerProbe;
  };
  const waitForGameServerReady = async () => {
    if (location.protocol === "file:") return;
    const startedAt = Date.now();
    let lastError = "";
    while (Date.now() - startedAt < GAME_SERVER_STARTUP_TIMEOUT_MS) {
      const probe = await probeGameServer();
      if (probe.status === "OK") return;
      lastError = probe.lastError || "未応答";
      log("ゲームサーバー起動待ちです。少し待ってから再確認します。", { lastError });
      await new Promise((resolve) => setTimeout(resolve, GAME_SERVER_STARTUP_RETRY_MS));
    }
    throw new Error(`ゲームサーバーが応答しません。しばらく待ってからもう一度開始してください。最後の状態: ${lastError || "未応答"}`);
  };
  const buildOnlineDebugReturnUrl = () => {
    const clubId = selectedClubId();
    const query = clubId ? `?returnClubId=${encodeURIComponent(clubId)}` : "";
    if (location.protocol === "file:") {
      const path = String(location.pathname || "").replace(/\\/g, "/");
      if (path.includes("/online-debug/")) return new URL(`./index.html${query}`, window.location.href).href;
      return new URL(`online-debug/index.html${query}`, window.location.href).href;
    }
    return `${location.origin}/online-debug/index.html${query}`;
  };
  const debugTileAssetPath = (fileName) => (location.protocol === "file:" ? `../public/tiles/${fileName}` : `/tiles/${fileName}`);
  const canLoadImage = (src) =>
    new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = src;
    });
  const runTileImageCheck = async () => {};
  const clearError = () => {
    if (!has("errorBox")) return;
    $("errorBox").textContent = "";
    $("errorBox").classList.remove("visible");
  };
  const showError = (title, error) => {
    const text = title + "\n\n" + JA_MESSAGES.cause + ":\n" + getErrorText(error);
    $("errorBox").textContent = text;
    $("errorBox").classList.add("visible");
    log(text);
  };
  const requireConfig = () => {
    if (!config.url || !config.anonKey) throw new Error("Supabase設定が不足しています。runtime/supabase-public-config.js を確認してください。");
  };
  const isByteStringHeaderValue = (value) => /^[\u0000-\u00ff]*$/.test(String(value ?? ""));
  const isSafeHeaderName = (value) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(String(value ?? ""));
  const isByteStringFetchError = (error) => {
    const raw = rawErrorText(error);
    return raw.includes("ByteString") || raw.includes("greater than 255") || raw.includes("Cannot convert argument");
  };
  const isLikelyJwt = (value) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value || ""));
  const removeStoredValue = (storage, key) => {
    try {
      storage?.removeItem?.(key);
    } catch {}
  };
  const clearStoredSession = () => {
    state.accessToken = "";
    state.refreshToken = "";
    state.user = null;
    state.clubs = [];
    state.memberships = [];
    state.tables = [];
    removeStoredValue(localStorage, "anmikaAccessToken");
    removeStoredValue(localStorage, "anmikaRefreshToken");
    removeStoredValue(localStorage, "anmikaDebugUser");
    removeStoredValue(localStorage, "anmikaRocket.onlineSync");
    removeStoredValue(localStorage, "anmikaRocket.socketDebug");
    removeStoredValue(sessionStorage, "anmikaOnlineDebugActiveClubId");
    removeStoredValue(sessionStorage, "anmikaOnlineDebugActiveTableId");
    removeStoredValue(sessionStorage, "anmikaOnlineDebug.launchingTable");
    document.body.dataset.screen = "auth";
  };
  const invalidateBrokenSession = (reason = "broken auth header") => {
    console.warn("[Auth] session cleared", { reason });
    clearStoredSession();
    if (has("currentUser")) $("currentUser").textContent = "未ログイン";
    clearError();
  };
  const isValidAccessToken = (value) => !value || (isByteStringHeaderValue(value) && isLikelyJwt(value));
  const isValidRefreshToken = (value) => !value || isByteStringHeaderValue(value);
  const sanitizeStoredSession = () => {
    const storedAccessToken = localStorage.getItem("anmikaAccessToken") || "";
    const storedRefreshToken = localStorage.getItem("anmikaRefreshToken") || "";
    if (!isValidAccessToken(storedAccessToken) || !isValidRefreshToken(storedRefreshToken)) {
      invalidateBrokenSession("invalid stored token");
      return false;
    }
    if (state.accessToken && !isValidAccessToken(state.accessToken)) {
      invalidateBrokenSession("invalid state access token");
      return false;
    }
    if (state.refreshToken && !isValidRefreshToken(state.refreshToken)) {
      invalidateBrokenSession("invalid state refresh token");
      return false;
    }
    return true;
  };
  const assertHeaderValue = (name, value) => {
    if (!isSafeHeaderName(name)) {
      console.warn("[Headers] unsafe header name blocked", { name });
      throw new Error("通信ヘッダーが壊れています。ページを更新してもう一度試してください。");
    }
    const text = String(value ?? "");
    if (!isByteStringHeaderValue(text)) {
      console.warn("[Headers] non ByteString header blocked", { name, length: text.length });
      if (name.toLowerCase() === "authorization") invalidateBrokenSession("non ByteString authorization");
      throw new Error("ログイン情報が壊れています。いったんログアウトして再ログインしてください。");
    }
    return text;
  };
  const buildSafeHeaders = (extraHeaders = {}, { auth = true } = {}) => {
    const headers = {
      apikey: config.anonKey,
      "Content-Type": "application/json",
    };
    for (const [key, value] of Object.entries(extraHeaders || {})) {
      if (value === undefined || value === null) continue;
      headers[key] = value;
    }
    if (auth && state.accessToken) {
      if (!isLikelyJwt(state.accessToken) || !isByteStringHeaderValue(state.accessToken)) {
        invalidateBrokenSession("invalid access token format");
        throw new Error("ログイン情報が壊れています。いったん再ログインしてください。");
      }
      headers.Authorization = "Bearer " + state.accessToken;
    }
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, assertHeaderValue(key, value)]));
  };
  const buildSafeAuthHeaders = () => {
    if (!state.accessToken) return {};
    if (!isLikelyJwt(state.accessToken) || !isByteStringHeaderValue(state.accessToken)) {
      invalidateBrokenSession("invalid access token format");
      throw new Error("ログイン情報が壊れています。いったん再ログインしてください。");
    }
    return { Authorization: assertHeaderValue("Authorization", "Bearer " + state.accessToken) };
  };

  const request = async (path, options = {}, retry = true) => {
    requireConfig();
    const url = config.url.replace(/\/$/, "") + path;
    let response;
    try {
      const headers = buildSafeHeaders(options.headers, { auth: options.auth !== false });
      response = await fetch(url, { ...options, headers });
    } catch (error) {
      if (isByteStringFetchError(error)) {
        invalidateBrokenSession("fetch rejected non ByteString header");
        render();
        throw new Error("ログイン情報または通信ヘッダーが壊れていたため、ログイン状態をクリアしました。もう一度ログインしてください。");
      }
      throw error;
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(data?.message || response.statusText);
      error.status = response.status;
      error.data = data;
      if (retry && (response.status === 401 || data?.code === "PGRST303") && state.refreshToken) {
        await refreshSession();
        return request(path, options, false);
      }
      throw error;
    }
    return data;
  };
  const rest = (path, options = {}) => request("/rest/v1" + path, options);
  const auth = (path, options = {}) => request("/auth/v1" + path, { ...options, auth: false });
  const settleRecentlyLeftTable = async () => {
    const tableId = normalizeRemoteTableId(state.recentlyLeftTableId);
    if (!tableId || !state.user?.id || !state.accessToken) {
      if (state.recentlyLeftTableId && !tableId) {
        log("ラス半終了後の退席処理をスキップしました。卓IDがDB用UUIDではありません。", state.recentlyLeftTableId);
        state.recentlyLeftTableId = "";
        state.recentlyLeftAt = 0;
      }
      return;
    }
    state.recentlyLeftTableId = tableId;
    console.log("[LastHand] settle recently left table", { tableId, userId: state.user.id });
    markRecentlyLeftTable(tableId, state.recentlyLeftAt || Date.now());
    clearLocalUserSeatsForTable(tableId, state.user.id);
    state.autoOpenedPlayingTableIds.delete(tableId);
    clearAutoOpenedTable(tableId);
    clearAutoStartFailedTable(tableId);
    clearLaunchingTable();
    state.autoStartingTableIds.delete(tableId);
    state.onlineGameOpened = false;
    state.activeGameState = null;
    if (state.activeTableId === tableId) {
      state.activeTableId = "";
      sessionStorage.removeItem("anmikaOnlineDebugActiveTableId");
    }
    await rest("/table_waiting_list?user_id=eq." + encodeURIComponent(state.user.id), {
      method: "DELETE",
    }).catch((error) => log("ラス半終了後のウェイティング解除に失敗しました。", rawErrorText(error)));
    await rest("/rpc/leave_table_after_last_hand", {
      method: "POST",
      body: JSON.stringify({ p_table_id: tableId }),
    }).catch(async (rpcError) => {
      const raw = rawErrorText(rpcError);
      if (!raw.includes("leave_table_after_last_hand") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("ラス半終了後の退席RPCに失敗しました。直接退席へ切り替えます。", raw);
      }
    });
    await rest(
      "/table_seats?table_id=eq." + encodeURIComponent(tableId) + "&user_id=eq." + encodeURIComponent(state.user.id),
      {
        method: "PATCH",
        body: JSON.stringify({
          user_id: null,
          player_type: "empty",
          display_name: null,
          is_last_hand_declared: false,
        }),
      }
    ).catch((error) => log("ラス半終了後の直接退席に失敗しました。", rawErrorText(error)));
    await rest("/tables?table_id=eq." + encodeURIComponent(tableId), {
      method: "PATCH",
      body: JSON.stringify({ status: "waiting" }),
    }).catch((error) => log("ラス半終了後の卓状態更新に失敗しました。", rawErrorText(error)));
    await rest("/games?table_id=eq." + encodeURIComponent(tableId) + "&status=eq.playing", {
      method: "PATCH",
      body: JSON.stringify({ status: "ended", ended_at: new Date().toISOString() }),
    }).catch(() => {});
    await rest("/game_states?table_id=eq." + encodeURIComponent(tableId) + "&is_active=eq.true", {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    }).catch(() => {});
    await rest("/rpc/resolve_last_hand_and_waiting_queue", {
      method: "POST",
      body: JSON.stringify({ p_table_id: tableId }),
    }).catch((error) => {
      const raw = rawErrorText(error);
      if (!raw.includes("resolve_last_hand_and_waiting_queue") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("ラス半終了後のウェイティング処理に失敗しました。", raw);
      }
    });
    document.body.dataset.screen = "club-home";
  };
  const CLUB_POINT_FIXED_TOTAL = 10000000;
  const normalizeSignedZero = (value) => Object.is(value, -0) ? 0 : value;
  const roundToTenth = (value) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    const rounded = Math.round((numeric + Math.sign(numeric) * Number.EPSILON) * 10) / 10;
    return normalizeSignedZero(Number(rounded.toFixed(1)));
  };
  const formatPoint = (value) => {
    const rounded = roundToTenth(value);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  const formatSignedPoint = (value) => `${roundToTenth(value) >= 0 ? "+" : ""}${formatPoint(value)}`;
  const clubPointSummaryFromMembers = (members = []) => {
    const memberTotal = roundToTenth(members.reduce((sum, member) => sum + Number(member.point_balance || 0), 0));
    return {
      fixedTotal: CLUB_POINT_FIXED_TOTAL,
      memberTotal,
      clubReserve: roundToTenth(CLUB_POINT_FIXED_TOTAL - memberTotal),
    };
  };
  const readPointAmount = (value, label = "ポイント数") => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) throw new Error(`${label}は整数で入力してください。`);
    if (amount <= 0) throw new Error(`${label}は1以上で入力してください。`);
    if (amount > CLUB_POINT_FIXED_TOTAL) throw new Error(`${label}は${CLUB_POINT_FIXED_TOTAL}ポイント以下にしてください。`);
    return amount;
  };
  const loadActiveGameState = async (tableId = selectedTableId()) => {
    tableId = normalizeRemoteTableId(tableId);
    if (!tableId || !state.accessToken) return null;
    const rows = await rest(`/game_states?select=*&table_id=eq.${encodeURIComponent(tableId)}&is_active=eq.true&order=updated_at.desc&limit=1`);
    state.activeGameState = rows[0] || null;
    const activeState = state.activeGameState?.state || null;
    const activeEnded = Boolean(activeState?.phase === "gameEnded" || (activeState?.handLog?.result && ["handEnded", "exhaustiveDraw"].includes(activeState?.phase)) || activeState?.finalResult || activeState?.handLog?.result?.finalResult);
    if (state.activeGameState && activeEnded) {
      await deactivateTableActiveGameState(tableId, "終了済みGameStateを無効化").catch((error) => log("終了済みGameStateの無効化に失敗しました。", rawErrorText(error)));
      state.activeGameState = null;
      state.activeGameEvents = [];
      renderOnlineGamePanel();
      renderDebug("終了済みGameStateを無効化しました");
      return null;
    }
    if (state.activeGameState?.game_id) {
      state.activeGameEvents = await rest(`/game_events?select=event_id,action_type,turn_version,player_id,created_at,payload&game_id=eq.${encodeURIComponent(state.activeGameState.game_id)}&order=created_at.asc&limit=200`);
    } else {
      state.activeGameEvents = [];
    }
    state.lastGameSyncAt = new Date().toLocaleTimeString();
    renderOnlineGamePanel();
    renderDebug("GameState同期済み");
    return state.activeGameState;
  };
  const newSocketGameId = (tableId) => `socket-game-${tableId}`;
  const deactivateTableActiveGameState = async (tableId, reason = "新規対局開始") => {
    tableId = normalizeRemoteTableId(tableId);
    if (!tableId || !state.accessToken) return;
    await rest("/game_states?table_id=eq." + encodeURIComponent(tableId) + "&is_active=eq.true", {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    }).catch((error) => log(`${reason}: 古いGameStateの無効化に失敗しました。`, rawErrorText(error)));
    if (state.activeGameState?.table_id === tableId) state.activeGameState = null;
    state.activeGameEvents = [];
  };
  const ensureOnlineGameForTable = async (tableId = selectedTableId()) => {
    tableId = requireTableId(normalizeRemoteTableId(tableId), "オンライン対局準備");
    const gameState = await rest("/rpc/ensure_online_game_for_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
    const nextGameState = Array.isArray(gameState) ? gameState[0] : gameState;
    if (!nextGameState?.game_id) {
      throw new Error("オンライン対局を開始できませんでした。3席が埋まっているか確認してください。");
    }
    state.activeGameState = nextGameState;
    const latest = await loadActiveGameState(tableId).catch((error) => {
      log("オンラインGameStateの再取得に失敗しました。作成済みの局面で続行します。", rawErrorText(error));
      return null;
    });
    return latest || state.activeGameState;
  };
  const submitOnlineGameAction = async (actionType, payload = {}, tableId = selectedTableId()) => {
    const gameState = state.activeGameState || await loadActiveGameState(tableId);
    if (!gameState?.game_id) throw new Error("オンラインGameStateがありません。先に対局を開始してください。");
    const event = await rest("/rpc/submit_game_action", {
      method: "POST",
      body: JSON.stringify({
        p_game_id: gameState.game_id,
        p_table_id: tableId,
        p_player_id: state.user.id,
        p_action_type: actionType,
        p_turn_version: gameState.version,
        p_payload: payload,
      }),
    });
    await loadActiveGameState(tableId);
    renderOnlineGamePanel();
    return event;
  };

  const onlineState = () => state.activeGameState?.state || {};
  const onlinePlayers = () => Array.isArray(onlineState().players) ? onlineState().players : [];
  const formatOnlinePlayer = (player) => {
    if (!player) return "不明";
    if (player.playerType === "cpu") return player.displayName || `CPU${Number(player.seatIndex) + 1}`;
    if (player.userId === state.user?.id) return `${player.displayName || state.user?.displayName || "あなた"}（あなた）`;
    return player.displayName || `Player ${String(player.userId || "").slice(0, 8)}`;
  };
  const formatOnlineAction = (action) => {
    const player = onlinePlayers().find((item) => Number(item.seatIndex) === Number(action.seatIndex));
    const typeLabels = {
      draw: "ツモ",
      discard: "打牌",
      ron: "ロン",
      tsumo: "ツモ和了",
      pon: "ポン",
      kan: "カン",
      riichi: "リーチ",
      skip: "スキップ",
      flower: "華",
      nukiDora: "抜きドラ",
    };
    const payload = action.payload || {};
    const tile = payload.tileLabel || payload.tileId || payload.tile || "";
    return `${formatOnlinePlayer(player)} ${typeLabels[action.type] || action.type}${tile ? ` ${tile}` : ""}`;
  };
  const renderOnlineGamePanel = () => {
    if (!has("onlineGamePanel")) return;
    const panel = $("onlineGamePanel");
    const gameState = state.activeGameState;
    const sharedState = onlineState();
    panel.classList.toggle("open", !!gameState && state.onlineGameOpened);
    if (!gameState) {
      $("onlineGameBoard").innerHTML = "<p class=\"muted\">まだオンライン対局は開始されていません。</p>";
      return;
    }
    const players = onlinePlayers();
    const discards = sharedState.discards || {};
    const actionLog = Array.isArray(sharedState.actionLog) ? sharedState.actionLog : [];
    const currentSeat = Number(sharedState.currentTurnSeatIndex ?? 0);
    const rows = players
      .map((player) => {
        const seatDiscards = Array.isArray(discards[String(player.seatIndex)]) ? discards[String(player.seatIndex)] : [];
        const discardText = seatDiscards.map((item) => item.tileLabel || item.tileId || item.tile || "?").join(" ");
        return `
          <div class="online-player-row ${Number(player.seatIndex) === currentSeat ? "current" : ""}">
            <strong>席${Number(player.seatIndex) + 1}: ${formatOnlinePlayer(player)}</strong>
            <span>${player.playerType === "cpu" ? "CPU" : "実プレイヤー"}</span>
            <span>河: ${discardText || "なし"}</span>
          </div>
        `;
      })
      .join("");
    $("onlineGameBoard").innerHTML = `
      <div class="online-state-summary">
        <strong>gameId:</strong> ${gameState.game_id}<br>
        <strong>version:</strong> ${gameState.version}<br>
        <strong>phase:</strong> ${sharedState.phase || "onlinePlaying"}<br>
        <strong>現在手番:</strong> 席${currentSeat + 1}
      </div>
      <div class="online-player-list">${rows}</div>
      <h4>イベントログ</h4>
      <ol class="online-action-log">
        ${actionLog.slice(-30).map((action) => `<li>${formatOnlineAction(action)}</li>`).join("") || "<li>なし</li>"}
      </ol>
    `;
  };
  const openOnlineGame = async (tableId = selectedTableId()) => {
    tableId = requireTableId(tableId, "オンライン対局開始");
    setActiveTableId(tableId);
    state.onlineGameOpened = true;
    if (has("onlineGamePanel")) $("onlineGamePanel").classList.add("open");
    startPolling();
    renderOnlineGamePanel();
  };
  const sendOnlineActionFromUi = async (actionType) => {
    const tileLabel = has("onlineTileLabel") ? $("onlineTileLabel").value.trim() : "";
    const payload = tileLabel ? { tileLabel } : {};
    await submitOnlineGameAction(actionType, payload);
  };

  const refreshSession = async () => {
    if (!state.refreshToken) throw new Error("ログイン期限が切れました。再ログインしてください。");
    if (!isValidRefreshToken(state.refreshToken)) {
      invalidateBrokenSession("invalid refresh token");
      throw new Error("ログイン情報が壊れています。いったん再ログインしてください。");
    }
    const data = await auth("/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: state.refreshToken }) });
    saveSession(data, null);
    return data;
  };
  const saveSession = (session, profile) => {
    if (session?.access_token) {
      if (!isValidAccessToken(session.access_token) || (session.refresh_token && !isValidRefreshToken(session.refresh_token))) {
        invalidateBrokenSession("invalid session token from auth response");
        throw new Error("ログイン情報が壊れています。いったん再ログインしてください。");
      }
      state.accessToken = session.access_token;
      state.refreshToken = session.refresh_token || state.refreshToken || "";
      localStorage.setItem("anmikaAccessToken", state.accessToken);
      localStorage.setItem("anmikaRefreshToken", state.refreshToken);
    }
    if (profile) {
      state.user = profileToUser(profile);
      localStorage.setItem("anmikaDebugUser", JSON.stringify(state.user));
    }
    render();
  };
  const requireUser = () => {
    if (!state.user || !state.accessToken) throw new Error(JA_MESSAGES.signInRequired);
    return state.user;
  };
  const randomEmail = () => crypto.randomUUID() + "@anmika.local";
  const authRedirectUrl = () => {
    if (location.protocol === "file:") return buildAppUrl("/online-debug/index.html");
    return `${location.origin}/online-debug/index.html`;
  };
  const getProfile = async (idOrLoginId) => {
    if (isUuid(idOrLoginId)) {
      const rows = await rest("/users?select=*&user_id=eq." + encodeURIComponent(idOrLoginId));
      return rows[0] || null;
    }
    const rows = await rest("/users?select=*&login_id=eq." + encodeURIComponent(String(idOrLoginId).toUpperCase()));
    return rows[0] || null;
  };
  const getLoginEmail = async (loginId) => {
    const data = await rest("/rpc/get_login_email", { method: "POST", body: JSON.stringify({ p_user_id: loginId }) });
    return Array.isArray(data) ? data[0] : data;
  };
  const ensureProfileForAuthUser = async (authUser, displayName = "") => {
    if (!authUser?.id) throw new Error("認証ユーザー情報を取得できませんでした。");
    const email = authUser.email || `${authUser.id}@anmika.local`;
    const name =
      displayName ||
      authUser.user_metadata?.display_name ||
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      (email.includes("@") ? email.split("@")[0] : "Player");
    const profile = await rest("/rpc/ensure_user_profile", {
      method: "POST",
      body: JSON.stringify({ p_user_id: authUser.id, p_auth_email: email, p_display_name: name }),
    });
    return Array.isArray(profile) ? profile[0] : profile;
  };
  const completeOAuthRedirectIfNeeded = async () => {
    const hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    if (!accessToken) return false;
    const session = {
      access_token: accessToken,
      refresh_token: hash.get("refresh_token") || "",
    };
    saveSession(session, null);
    const authUser = await request("/auth/v1/user");
    const profile = await ensureProfileForAuthUser(authUser);
    saveSession(session, profile);
    history.replaceState(null, "", location.pathname + location.search);
    log("外部アカウントでログインしました。", profile);
    await loadClubs().catch(() => {});
    startClubPolling();
    return true;
  };
  const startOAuthLogin = async (provider) => {
    requireConfig();
    const redirectTo = encodeURIComponent(authRedirectUrl());
    window.location.href = `${config.url.replace(/\/$/, "")}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${redirectTo}`;
  };

  const signUp = async () => {
    console.log("[Auth] create account start");
    log("アカウント作成を開始しました。");
    const displayName = $("displayName").value.trim();
    const password = $("password").value;
    if (!displayName) throw new Error(JA_MESSAGES.displayNameRequired);
    if (!password) throw new Error(JA_MESSAGES.passwordRequired);
    if (password.length < 6) throw new Error(JA_MESSAGES.passwordTooShort);
    const email = has("email") ? $("email").value.trim() : "";
    if (!email) throw new Error("メールアドレスを入力してください。");
    try {
      const signUpData = await auth("/signup", { method: "POST", body: JSON.stringify({ email, password, data: { display_name: displayName } }) });
      const authUserId = signUpData.user?.id;
      if (!signUpData.access_token || !authUserId) throw new Error("アカウント作成後の認証情報を取得できませんでした。メール確認OFF設定を確認してください。");
      saveSession(signUpData, null);
      const profile = await rest("/rpc/ensure_user_profile", { method: "POST", body: JSON.stringify({ p_user_id: authUserId, p_auth_email: email, p_display_name: displayName }) });
      const nextProfile = Array.isArray(profile) ? profile[0] : profile;
      saveSession(signUpData, nextProfile);
      if (has("userId")) $("userId").value = nextProfile.login_id || nextProfile.user_id;
      console.log("[Auth] create account success", nextProfile);
      log("アカウントを作成しました", nextProfile);
      await loadClubs().catch(() => {});
    } catch (error) {
      console.error("[Auth] create account failed", error);
      log("アカウント作成に失敗しました。", rawErrorText(error));
      throw error;
    }
  };
  // DEBUG ACCOUNT START: 本番前に削除しやすいよう、このブロックと debugSignInButton だけで完結させる。
  const createDebugAccount = async () => {
    console.log("[Auth][Debug] create debug account start");
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const displayName = `デバッグ${suffix}`;
    const email = `debug-${suffix.toLowerCase()}@anmika.local`;
    const password = `debug-${suffix}`;
    if (has("displayName")) $("displayName").value = displayName;
    if (has("email")) $("email").value = email;
    if (has("password")) $("password").value = password;
    const signUpData = await auth("/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, data: { display_name: displayName, is_debug_account: true } }),
    });
    const authUserId = signUpData.user?.id;
    if (!signUpData.access_token || !authUserId) throw new Error("デバッグアカウント作成後の認証情報を取得できませんでした。メール確認OFF設定を確認してください。");
    saveSession(signUpData, null);
    const profile = await rest("/rpc/ensure_user_profile", {
      method: "POST",
      body: JSON.stringify({ p_user_id: authUserId, p_auth_email: email, p_display_name: displayName }),
    });
    const nextProfile = Array.isArray(profile) ? profile[0] : profile;
    saveSession(signUpData, nextProfile);
    console.log("[Auth][Debug] create debug account success", { email, password, profile: nextProfile });
    log("デバッグアカウントを作成してログインしました。", { email, password, loginId: nextProfile?.login_id });
    await loadClubs().catch(() => {});
    startClubPolling();
  };
  // DEBUG ACCOUNT END
  const signIn = async () => {
    await signInWithEmail();
  };
  const signInWithEmail = async () => {
    const email = has("email") ? $("email").value.trim() : "";
    const password = $("password").value;
    if (!email) throw new Error("メールアドレスを入力してください。");
    if (!password) throw new Error(JA_MESSAGES.passwordRequired);
    const session = await auth("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    saveSession(session, null);
    const authUser = session.user || await request("/auth/v1/user");
    const profile = await ensureProfileForAuthUser(authUser, has("displayName") ? $("displayName").value.trim() : "");
    saveSession(session, profile);
    log("メールアドレスでログインしました", state.user);
    await loadClubs();
    startClubPolling();
  };
  const signOut = async () => {
    const token = state.accessToken;
    clearInterval(state.pollTimer);
    clearInterval(state.clubPollTimer);
    if (token && isLikelyJwt(token) && isByteStringHeaderValue(token)) {
      await request("/auth/v1/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        auth: false,
      }).catch((error) => log("Supabaseログアウト通知に失敗しました。ローカル状態は削除します。", rawErrorText(error)));
    }
    clearStoredSession();
    render();
  };

  const changeLoginId = async () => {
    const user = requireUser();
    const newLoginId = $("newLoginId").value.trim().toUpperCase();
    const password = $("confirmPassword").value;
    if (!newLoginId) throw new Error("新しいログインIDを入力してください。");
    if (!password) throw new Error("本人確認のため、現在のパスワードを入力してください。");
    const email = await getLoginEmail(user.loginId || user.id);
    await auth("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
    const profile = await rest("/rpc/change_my_login_id", { method: "POST", body: JSON.stringify({ p_new_login_id: newLoginId }) });
    const nextProfile = Array.isArray(profile) ? profile[0] : profile;
    saveSession({ access_token: state.accessToken, refresh_token: state.refreshToken }, nextProfile);
    if (has("userId")) $("userId").value = nextProfile.login_id;
    $("newLoginId").value = "";
    $("confirmPassword").value = "";
  };
  const findClubForJoin = async (clubInput) => {
    const value = extractClubSearchText(clubInput);
    if (!value) throw new Error("クラブIDを入力してください。");
    try {
      const rows = await rest("/rpc/find_club_for_join", { method: "POST", body: JSON.stringify({ p_club_code_or_id: value }) });
      const club = Array.isArray(rows) ? rows[0] : rows;
      if (club?.club_id) return club;
      throw new Error("そのクラブは見つかりません。入力したID: " + value);
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("find_club_for_join") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw error;
      log("RPC検索に失敗したため、直接検索へフォールバックします。", raw);
    }
    if (isUuid(value)) return value;
    const normalized = value.toUpperCase();
    const rows = await rest("/clubs?select=club_id,club_code,name&club_code=eq." + encodeURIComponent(normalized));
    if (!rows.length) {
      throw new Error(
        "クラブIDが見つかりません。入力したID: " + normalized +
        "\n別アカウントから検索する場合は、Supabase SQL Editorで patch_club_search_join_rpc.sql を実行してください。" +
        "\nクラブ作成者の画面に表示される C-XXXXXX 形式のクラブIDをコピーして入力してください。"
      );
    }
    return rows[0];
  };
  const resolveClubId = async (clubInput) => {
    const club = await findClubForJoin(clubInput);
    return club.club_id;
  };
  const renderClubSearchResult = (club) => {
    if (!has("clubSearchResult")) return;
    if (!club) {
      $("clubSearchResult").textContent = "クラブIDを入力して検索してください。";
      $("clubSearchResult").classList.add("muted");
      return;
    }
    const isAlreadyMember = state.clubs.some((item) => item.club_id === club.club_id);
    const existingRequest = state.joinRequests.find((request) => request.clubs?.club_id === club.club_id || request.club_id === club.club_id);
    const statusText = existingRequest?.status === "approved" ? "承認済み" : existingRequest?.status === "rejected" ? "拒否されました" : existingRequest?.status === "pending" ? "承認待ち" : "";
    const actionHtml = isAlreadyMember
      ? `<button type="button" disabled>参加済み</button>`
      : existingRequest?.status === "pending"
        ? `<button type="button" disabled>申請済み</button>`
        : existingRequest?.status === "rejected"
          ? `<button type="button" id="requestJoinFromSearchButton">再申請</button>`
          : `<button type="button" id="requestJoinFromSearchButton">加入申請</button>`;
    $("clubSearchResult").classList.remove("muted");
    $("clubSearchResult").innerHTML = [
      "<strong>見つかりました</strong>",
      `<br>クラブ名: ${club.name || "名称未設定"}`,
      `<br>クラブID: ${club.club_code || club.club_id}`,
      `<br>管理者: ${club.owner_user_id || "未取得"}`,
      statusText ? `<br>状態: ${statusText}` : "",
      `<div class="row">${actionHtml}</div>`,
      `<div id="joinRequestStatus" class="muted"></div>`,
    ].join("");
    document.getElementById("requestJoinFromSearchButton")?.addEventListener("click", () => {
      requestJoin(club).catch((error) => showError("加入申請に失敗しました", error));
    });
  };
  const searchClubForJoin = async () => {
    const club = await findClubForJoin($("clubId").value);
    state.searchedClub = club;
    await loadMyJoinRequests().catch(() => {});
    renderClubSearchResult(club);
    log("クラブを見つけました。", { clubId: club.club_id, clubCode: club.club_code, name: club.name });
  };
  const loadMyJoinRequests = async () => {
    const user = requireUser();
    try {
      const rows = await rest("/rpc/list_my_join_requests", { method: "POST", body: JSON.stringify({}) });
      state.joinRequests = (rows || []).map((row) => ({
        ...row,
        clubs: {
          club_id: row.club_id,
          club_code: row.club_code,
          name: row.club_name,
        },
      }));
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("list_my_join_requests") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("加入申請状態RPCの取得に失敗しました。直接取得へ切り替えます。", raw);
      }
      try {
        state.joinRequests = await rest("/club_join_requests?select=club_id,status,created_at,updated_at,clubs(*)&user_id=eq." + encodeURIComponent(user.id) + "&order=created_at.desc");
      } catch (fallbackError) {
        state.joinRequests = [];
        log("加入申請状態の取得に失敗しました。", rawErrorText(fallbackError));
      }
    }
  };
  const fetchClubById = async (clubId) => {
    if (!clubId) return null;
    const rows = await rest("/clubs?select=*&club_id=eq." + encodeURIComponent(clubId) + "&limit=1");
    return rows[0] || null;
  };
  const addMembershipIfMissing = (membership) => {
    const club = membership?.clubs;
    if (!club?.club_id) return false;
    if (state.clubs.some((item) => item.club_id === club.club_id)) return false;
    state.memberships.push(membership);
    state.clubs.push(club);
    return true;
  };
  const applyApprovedJoinRequestsToClubList = async () => {
    const approved = (state.joinRequests || []).filter((request) => request.status === "approved");
    const knownClubIds = new Set(state.clubs.map((club) => club.club_id));
    for (const request of approved) {
      const clubId = request.clubs?.club_id || request.club_id;
      if (isClubLeft(clubId)) continue;
      if (!clubId || knownClubIds.has(clubId)) continue;
      const club = request.clubs?.club_id ? request.clubs : await fetchClubById(clubId).catch(() => null);
      if (club?.club_id) {
        addMembershipIfMissing({ role: "member", point_balance: 0, clubs: club });
        knownClubIds.add(club.club_id);
      }
    }
  };
  const findMyJoinRequestForClub = async (clubId) => {
    const user = requireUser();
    if (!clubId) throw new Error("加入申請先のclubIdが取得できません。");
    const rows = await rest(
      "/club_join_requests?select=request_id,club_id,user_id,status,created_at,updated_at,applicant_display_name,applicant_login_id,club_name" +
      "&club_id=eq." + encodeURIComponent(clubId) +
      "&user_id=eq." + encodeURIComponent(user.id) +
      "&order=created_at.desc&limit=1"
    );
    return rows[0] || null;
  };
  const saveJoinRequestDirectly = async (clubId, clubName = "") => {
    const user = requireUser();
    const body = {
      club_id: clubId,
      user_id: user.id,
      status: "pending",
      applicant_display_name: state.profile?.display_name || state.profile?.login_id || user.email || "",
      applicant_login_id: state.profile?.login_id || "",
      club_name: clubName || "",
    };
    console.log("[JoinRequest] direct insert body =", body);
    return rest("/club_join_requests?select=request_id,club_id,user_id,status,created_at,updated_at,applicant_display_name,applicant_login_id,club_name", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
  };
  const joinRequestSqlSetupError = () => new Error("加入申請用RPCが申請を作成できませんでした。Supabase SQL Editorで patch_join_requests_reliable.sql を実行してください。");
  const normalizeMembershipRows = (rows = []) => rows.map((row) => {
    if (row?.clubs) return { ...row, clubs: mergeClubIcon(row.clubs) };
    return {
      role: row.role || "member",
      point_balance: row.point_balance || 0,
      clubs: {
        club_id: row.club_id,
        club_code: row.club_code,
        name: row.name,
        icon_url: row.icon_url || cachedClubIcon(row.club_id) || "",
        owner_user_id: row.owner_user_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    };
  }).filter((row) => row.clubs?.club_id);
  const normalizeClubCreationStatus = (row) => {
    const source = Array.isArray(row) ? row[0] : row;
    if (!source) {
      return {
        can_create: isSuperClubCreator(),
        is_super_creator: isSuperClubCreator(),
        has_permission: false,
        owned_club_count: state.clubs.filter((club) => club.owner_user_id === state.user?.id).length,
        create_limit: isSuperClubCreator() ? null : 1,
      };
    }
    return {
      ...source,
      can_create: Boolean(source.can_create ?? source.canCreate),
      is_super_creator: Boolean(source.is_super_creator ?? source.isSuperCreator),
      has_permission: Boolean(source.has_permission ?? source.hasPermission),
      owned_club_count: Number(source.owned_club_count ?? source.ownedClubCount ?? 0),
      create_limit: source.create_limit ?? source.createLimit ?? null,
    };
  };
  const loadClubCreationStatus = async () => {
    if (!state.user?.id || !state.accessToken) {
      state.clubCreationStatus = null;
      return null;
    }
    try {
      const rows = await rest("/rpc/get_my_club_creation_status", { method: "POST", body: JSON.stringify({}) });
      state.clubCreationStatus = normalizeClubCreationStatus(rows);
    } catch (error) {
      if (!isMissingRpcError(error, "get_my_club_creation_status")) {
        log("クラブ作成権限の取得に失敗しました。", rawErrorText(error));
      }
      state.clubCreationStatus = normalizeClubCreationStatus(null);
    }
    return state.clubCreationStatus;
  };
  const ensureSuperClubMemberships = async () => {
    if (!state.user?.id || !state.accessToken || !isSuperClubCreator()) return;
    try {
      await rest("/rpc/ensure_super_club_memberships", { method: "POST", body: JSON.stringify({}) });
    } catch (error) {
      if (!isMissingRpcError(error, "ensure_super_club_memberships")) {
        log("特権アカウントのクラブ自動参加処理に失敗しました。", rawErrorText(error));
      }
    }
  };
  const loadClubSuperRakeShare = async (clubId) => {
    if (!canViewSuperRakeShare()) return { percent: 0 };
    if (!clubId) return { percent: 0 };
    try {
      const rows = await rest("/rpc/get_club_super_rake_share", { method: "POST", body: JSON.stringify({ p_club_id: clubId }) });
      const row = Array.isArray(rows) ? rows[0] : rows;
      return { percent: Number(row?.percent || 0), updatedAt: row?.updated_at || "" };
    } catch (error) {
      if (!isMissingRpcError(error, "get_club_super_rake_share")) {
        log("特権アカウント配分率の取得に失敗しました。", rawErrorText(error));
      }
      return { percent: 0 };
    }
  };
  const saveClubSuperRakeShare = async (clubId, percent) => {
    if (!isSuperClubCreator()) throw new Error("super account required");
    const value = Number(percent);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("percent must be between 0 and 100");
    try {
      await rest("/rpc/set_club_super_rake_share", {
        method: "POST",
        body: JSON.stringify({ p_club_id: clubId, p_percent: value }),
      });
    } catch (error) {
      if (isMissingRpcError(error, "set_club_super_rake_share")) {
        throw new Error("特権アカウント配分率設定用のDB関数が見つかりません。supabase/patch_super_club_rake_share.sql を実行してください。");
      }
      throw new Error(toJapaneseError(rawErrorText(error)));
    }
  };
  const loadClubs = async () => {
    const user = requireUser();
    const rows = [];
    await loadClubCreationStatus().catch(() => {});
    await ensureSuperClubMemberships();
    try {
      const repairedRows = await rest("/rpc/repair_my_approved_join_memberships", { method: "POST", body: JSON.stringify({}) });
      rows.push(...normalizeMembershipRows(repairedRows || []));
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("repair_my_approved_join_memberships") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("承認済みクラブ所属の修復に失敗しました。", raw);
      }
    }
    try {
      const visibleRows = await rest("/rpc/get_my_clubs_visible", { method: "POST", body: JSON.stringify({}) });
      rows.push(...normalizeMembershipRows(visibleRows || []));
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("get_my_clubs_visible") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("加入済みクラブ可視化RPC取得に失敗しました。別経路で取得します。", raw);
      }
    }
    try {
      const persistentRows = await rest("/rpc/get_my_clubs", { method: "POST", body: JSON.stringify({}) });
      rows.push(...(persistentRows || []).map((row) => ({
        role: row.role,
        point_balance: row.point_balance || 0,
        clubs: {
          club_id: row.club_id,
          club_code: row.club_code,
          name: row.name,
          icon_url: row.icon_url || cachedClubIcon(row.club_id) || "",
          owner_user_id: row.owner_user_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      })));
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("get_my_clubs") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("加入済みクラブRPC取得に失敗しました。別経路で取得します。", raw);
      }
    }
    try {
      const memberRows = await rest("/club_members?select=role,point_balance,clubs(*)&user_id=eq." + encodeURIComponent(user.id));
      rows.push(...normalizeMembershipRows(memberRows));
    } catch (error) {
      log("club_members基準の加入済みクラブ取得に失敗しました。", rawErrorText(error));
    }
    try {
      await rest("/rpc/repair_my_owner_memberships", { method: "POST", body: JSON.stringify({}) });
      const repairedRows = await rest("/club_members?select=role,point_balance,clubs(*)&user_id=eq." + encodeURIComponent(user.id));
      rows.push(...normalizeMembershipRows(repairedRows));
    } catch (error) {
      log("作成者クラブの自動修復はスキップしました。", rawErrorText(error));
    }
    try {
      const ownedClubs = await rest("/clubs?select=*&owner_user_id=eq." + encodeURIComponent(user.id) + "&order=created_at.desc");
      rows.push(...ownedClubs.map((club) => ({ role: "admin", point_balance: 0, clubs: mergeClubIcon(club) })));
    } catch (error) {
      log("作成したクラブの取得に失敗しました。", rawErrorText(error));
    }
    const leftClubIds = loadLeftClubIds();
    const merged = uniqueMembershipRows(rows).filter((row) => !leftClubIds.has(row.clubs?.club_id));
    if (!merged.length && state.memberships.length) {
      log("クラブ取得が空だったため、直前の加入済みクラブ表示を維持します。");
      await loadMyJoinRequests().catch(() => {});
      state.memberships = state.memberships.filter((row) => !leftClubIds.has(row.clubs?.club_id));
      state.clubs = state.clubs.filter((club) => !leftClubIds.has(club.club_id));
      await applyApprovedJoinRequestsToClubList().catch((error) => log("承認済み申請の反映に失敗しました。", rawErrorText(error)));
      render();
      return;
    }
    state.memberships = merged;
    state.clubs = merged.map((row) => mergeClubIcon(row.clubs)).filter(Boolean);
    await loadMyJoinRequests();
    await applyApprovedJoinRequestsToClubList();
    render();
  };
  const createClub = async () => {
    await loadClubCreationStatus().catch(() => {});
    if (!canCreateClub()) {
      throw new Error(state.clubCreationStatus?.owned_club_count
        ? "club creation limit reached"
        : "club creation not permitted");
    }
    let result;
    try {
      result = await rest("/rpc/create_club_with_owner", { method: "POST", body: JSON.stringify({ p_name: $("clubName").value.trim() || "Test Club" }) });
    } catch (error) {
      const text = rawErrorText(error);
      if (!text.includes("clubs_one_owner_idx") && !text.includes("owner_user_id")) throw error;
      await loadClubs();
      document.body.dataset.screen = "clubs";
      render();
      return;
    }
    const club = Array.isArray(result) ? result[0] : result;
    $("clubId").value = club.club_code || club.club_id;
    if (club?.club_id) clearClubLeft(club.club_id);
    await loadClubs();
    if (club?.club_id && !state.clubs.some((item) => item.club_id === club.club_id)) {
      state.memberships = [{ role: "admin", point_balance: 0, clubs: club }, ...state.memberships];
      state.clubs = [club, ...state.clubs];
    }
    document.body.dataset.screen = "clubs";
    await loadClubCreationStatus().catch(() => {});
    render();
  };
  const requestJoin = async (targetClub) => {
    const user = requireUser();
    const input = targetClub?.club_id || extractClubSearchText($("clubId").value);
    if (!input) throw new Error("クラブIDを入力してください。");
    const searched = targetClub || state.searchedClub;
    const clubIdForRequest = searched?.club_id || await resolveClubId(input);
    console.log("[JoinRequest] submit start");
    console.log("[JoinRequest] clubId =", clubIdForRequest);
    console.log("[JoinRequest] applicantUserId =", user.id);
    if (clubIdForRequest && state.clubs.some((club) => club.club_id === clubIdForRequest)) {
      throw new Error("すでにこのクラブに参加しています。");
    }
    if (clubIdForRequest && state.joinRequests.some((request) => (request.clubs?.club_id === clubIdForRequest || request.club_id === clubIdForRequest) && request.status === "pending")) {
      throw new Error("すでに加入申請済みです。");
    }
    const targetInput = clubIdForRequest || input;
    if (has("joinRequestStatus")) $("joinRequestStatus").textContent = "加入申請中...";
    try {
      let request;
      try {
        request = await rest("/rpc/submit_join_request", { method: "POST", body: JSON.stringify({ p_club_code_or_id: targetInput }) });
      } catch (newRpcError) {
        const rawNew = rawErrorText(newRpcError);
        if (!rawNew.includes("submit_join_request") && !rawNew.includes("schema cache") && !rawNew.includes("Could not find the function")) throw newRpcError;
        request = await rest("/rpc/request_join_club_by_code", { method: "POST", body: JSON.stringify({ p_club_code_or_id: targetInput }) });
      }
      console.log("[JoinRequest] insert result =", request);
      const rpcRows = Array.isArray(request) ? request : (request ? [request] : []);
      let savedRequest = rpcRows[0] || await findMyJoinRequestForClub(clubIdForRequest).catch(() => null);
      if (!savedRequest || savedRequest.status !== "pending") {
        console.warn("[JoinRequest] RPC did not create pending request.", { request, savedRequest });
        const existing = await findMyJoinRequestForClub(clubIdForRequest).catch(() => null);
        if (existing?.status === "pending") {
          savedRequest = existing;
        } else if (existing?.status === "approved") {
          throw new Error("すでにこのクラブに参加しています。");
        } else {
          throw joinRequestSqlSetupError();
        }
      }
      if (!savedRequest || savedRequest.status !== "pending") {
        throw new Error("加入申請をDBに保存できませんでした。Supabaseの club_join_requests を確認してください。");
      }
      if (clubIdForRequest) clearClubLeft(clubIdForRequest);
      console.log("[JoinRequest] verified pending request =", savedRequest);
      log("加入申請を送信しました。管理者にこのユーザーIDを伝えて承認してもらってください。", { userId: user.id, club: searched || input, request });
      await loadMyJoinRequests().catch(() => {});
      if (searched) renderClubSearchResult(searched);
      if (has("joinRequestStatus")) $("joinRequestStatus").textContent = "加入申請を送信しました。管理者の承認をお待ちください。";
      render();
      return;
    } catch (error) {
      console.log("[JoinRequest] error =", error);
      const raw = rawErrorText(error);
      if (!raw.includes("submit_join_request") && !raw.includes("request_join_club_by_code") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw error;
      throw joinRequestSqlSetupError();
    }
  };
  const approveJoin = async () => {
    const user = requireUser();
    const clubId = selectedClubId();
    const applicantUserId = $("applicantUserId").value.trim();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!applicantUserId) throw new Error("申請者ユーザーIDを入力してください。");
    await rest("/rpc/approve_club_join_request", { method: "POST", body: JSON.stringify({ p_club_id: clubId, p_user_id: applicantUserId, p_admin_user_id: user.id }) });
    await loadAdminJoinRequests(clubId);
    await loadClubs();
  };
  const normalizeJoinRequest = (row) => {
    const userRow = row.users || row.user_accounts || {};
    const applicantUserId = row.user_id || row.applicant_user_id;
    return {
      ...row,
      user_id: applicantUserId,
      applicant_user_id: applicantUserId,
      request_id: row.request_id || row.id || null,
      request_key: row.request_id || row.id || `${row.club_id}:${applicantUserId}`,
      users: {
        user_id: userRow.user_id || applicantUserId,
        display_name: userRow.display_name || row.applicant_display_name || row.display_name || "",
        login_id: userRow.login_id || row.applicant_login_id || row.login_id || "",
      },
    };
  };
  const enrichJoinRequestsWithUsers = async (rows) => {
    const sourceRows = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const normalized = sourceRows.map(normalizeJoinRequest);
    const userIds = [...new Set(normalized.map((row) => row.user_id).filter(Boolean))];
    if (!userIds.length) return normalized;
    try {
      const filter = `(${userIds.map(encodeURIComponent).join(",")})`;
      const users = await rest("/users?select=user_id,display_name,login_id&user_id=in." + filter);
      const byId = new Map((users || []).map((user) => [user.user_id, user]));
      return normalized.map((row) => ({
        ...row,
        users: {
          ...row.users,
          ...(byId.get(row.user_id) || {}),
        },
      }));
    } catch (usersError) {
      log("加入申請者情報の取得に失敗しました。申請IDだけで表示します。", rawErrorText(usersError));
      return normalized;
    }
  };
  const loadAdminJoinRequests = async (clubId = selectedClubId()) => {
    if (!clubId) return [];
    console.log("[JoinRequest] list start");
    console.log("[JoinRequest] adminUserId =", state.user?.id);
    console.log("[JoinRequest] clubId =", clubId);
    let rows = [];
    try {
      rows = await rest("/rpc/list_join_requests_for_club", { method: "POST", body: JSON.stringify({ p_club_id: clubId }) });
    } catch (rpcError) {
      const raw = rawErrorText(rpcError);
      if (!raw.includes("list_join_requests_for_club") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("加入申請RPC取得に失敗しました。直接取得へ切り替えます。", raw);
      }
      try {
        rows = await rest("/club_join_requests?select=club_id,user_id,status,created_at&club_id=eq." + encodeURIComponent(clubId) + "&status=eq.pending&order=created_at.asc");
      } catch (error) {
        state.adminJoinRequests = [];
        console.log("[JoinRequest] fetched count =", 0);
        console.log("[JoinRequest] requests =", []);
        console.log("[JoinRequest] error =", error);
        log("加入申請一覧の取得に失敗しました。", rawErrorText(error));
        return [];
      }
    }
    try {
      const enriched = await enrichJoinRequestsWithUsers(rows);
      state.adminJoinRequests = enriched;
      console.log("[JoinRequest] fetched count =", enriched.length);
      console.log("[JoinRequest] requests =", enriched);
      return enriched;
    } catch (error) {
      state.adminJoinRequests = [];
      console.log("[JoinRequest] fetched count =", 0);
      console.log("[JoinRequest] requests =", []);
      console.log("[JoinRequest] error =", error);
      log("加入申請一覧の取得に失敗しました。", rawErrorText(error));
      return [];
    }
  };
  const approveJoinRequest = async (request) => {
    const user = requireUser();
    const applicantUserId = request.user_id || request.applicant_user_id;
    console.log("[JoinRequest] approve start");
    console.log("[JoinRequest] requestId =", request.request_id);
    console.log("[JoinRequest] applicantUserId =", applicantUserId);
    console.log("[JoinRequest] clubId =", request.club_id);
    try {
      if (request.request_id) {
        const result = await rest("/rpc/approve_join_request", { method: "POST", body: JSON.stringify({ p_request_id: request.request_id }) });
        console.log("[JoinRequest] result =", result);
      } else {
        throw new Error("request_id unavailable");
      }
    } catch (newRpcError) {
      const raw = rawErrorText(newRpcError);
      if (!raw.includes("approve_join_request") && !raw.includes("request_id unavailable") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        console.log("[JoinRequest] error =", newRpcError);
        throw newRpcError;
      }
      const result = await rest("/rpc/approve_club_join_request", { method: "POST", body: JSON.stringify({ p_club_id: request.club_id, p_user_id: applicantUserId, p_admin_user_id: user.id }) });
      console.log("[JoinRequest] result =", result);
    }
    try {
      const members = await rest("/rpc/list_club_members_for_admin", { method: "POST", body: JSON.stringify({ p_club_id: request.club_id }) });
      const found = (members || []).some((member) => member.user_id === applicantUserId);
      if (!found) log("承認後のメンバー確認ではまだ見つかりませんでした。数秒後の再取得で反映される場合があります。", { clubId: request.club_id, userId: applicantUserId });
    } catch (verifyError) {
      log("承認後のメンバー確認をスキップしました。", rawErrorText(verifyError));
    }
    state.adminJoinRequests = state.adminJoinRequests.filter((row) => (row.user_id || row.applicant_user_id) !== applicantUserId || row.club_id !== request.club_id);
    await loadAdminJoinRequests(request.club_id).catch((error) => log("承認後の加入申請一覧再取得に失敗しました。", rawErrorText(error)));
    log("加入申請を承認しました。", { clubId: request.club_id, userId: applicantUserId });
  };
  const rejectJoinRequest = async (request) => {
    const user = requireUser();
    const applicantUserId = request.user_id || request.applicant_user_id;
    console.log("[JoinRequest] reject start");
    console.log("[JoinRequest] requestId =", request.request_id);
    console.log("[JoinRequest] applicantUserId =", applicantUserId);
    console.log("[JoinRequest] clubId =", request.club_id);
    try {
      if (request.request_id) {
        const result = await rest("/rpc/reject_join_request", { method: "POST", body: JSON.stringify({ p_request_id: request.request_id }) });
        console.log("[JoinRequest] result =", result);
      } else {
        throw new Error("request_id unavailable");
      }
    } catch (newRpcError) {
      const raw = rawErrorText(newRpcError);
      if (!raw.includes("reject_join_request") && !raw.includes("request_id unavailable") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        console.log("[JoinRequest] error =", newRpcError);
        throw newRpcError;
      }
      const result = await rest("/rpc/reject_club_join_request", { method: "POST", body: JSON.stringify({ p_club_id: request.club_id, p_user_id: applicantUserId, p_admin_user_id: user.id }) });
      console.log("[JoinRequest] result =", result);
    }
    state.adminJoinRequests = state.adminJoinRequests.filter((row) => (row.user_id || row.applicant_user_id) !== applicantUserId || row.club_id !== request.club_id);
    await loadAdminJoinRequests(request.club_id).catch((error) => log("拒否後の加入申請一覧再取得に失敗しました。", rawErrorText(error)));
    log("加入申請を拒否しました。", { clubId: request.club_id, userId: applicantUserId });
  };
  const grantClubAdminRole = async (member) => {
    const clubId = selectedClubId();
    const targetUserId = member.user_id || member.users?.user_id;
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) throw new Error("管理者権限がありません。");
    if (!targetUserId) throw new Error("対象ユーザーが見つかりません。");
    const name = member.display_name || member.users?.display_name || targetUserId;
    if (!confirm(`${name} に管理者権限を付与しますか？\n卓作成、加入承認、クラブポイント管理ができるようになります。`)) return;
    uiLog("grant admin clicked", { clubId, targetUserId });
    try {
      const result = await rest("/rpc/grant_club_admin_role", { method: "POST", body: JSON.stringify({ p_club_id: clubId, p_member_user_id: targetUserId }) });
      if (result && result.ok === false) throw new Error(result.message || "管理者権限を付与できませんでした。");
    } catch (error) {
      const raw = rawErrorText(error);
      if (raw.includes("grant_club_admin_role") || raw.includes("schema cache") || raw.includes("Could not find the function")) {
        throw new Error("管理者権限付与用のDB関数が見つかりません。supabase/patch_grant_club_admin_role.sql を実行してください。");
      }
      throw error;
    }
    log(`${name} に管理者権限を付与しました。`);
    await loadClubs();
  };
  const grantClubCreationPermission = async (member) => {
    if (!isSuperClubCreator()) throw new Error("club creation grant admin required");
    const targetUserId = member.user_id || member.users?.user_id;
    if (!targetUserId) throw new Error("対象ユーザーが見つかりません。");
    const name = member.display_name || member.users?.display_name || member.login_id || member.users?.login_id || targetUserId;
    if (!confirm(`${name} にクラブ作成権限を付与しますか？\n付与されたアカウントは1つだけクラブを作成できます。`)) return;
    try {
      await rest("/rpc/grant_club_creation_permission", { method: "POST", body: JSON.stringify({ p_user_id: targetUserId }) });
    } catch (error) {
      const raw = rawErrorText(error);
      if (isMissingRpcError(error, "grant_club_creation_permission")) {
        throw new Error("クラブ作成権限付与用のDB関数が見つかりません。supabase/patch_club_creation_permissions.sql を実行してください。");
      }
      throw new Error(toJapaneseError(raw));
    }
    log(`${name} にクラブ作成権限を付与しました。`);
  };
  const removeClubMember = async (member) => {
    const clubId = selectedClubId();
    const targetUserId = member.user_id || member.users?.user_id;
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) throw new Error("管理者権限がありません。");
    if (!targetUserId) throw new Error("対象ユーザーが見つかりません。");
    if (targetUserId === state.user?.id) throw new Error("自分自身は削除できません。");
    if (member.role === "admin") throw new Error("管理者権限を持つメンバーは削除できません。");
    const name = member.display_name || member.users?.display_name || targetUserId;
    if (!confirm(`${name} をクラブから削除しますか？\nこのメンバーのクラブポイントはクラブ側へ戻ります。`)) return;
    uiLog("remove member clicked", { clubId, targetUserId });
    try {
      const result = await rest("/rpc/remove_club_member", { method: "POST", body: JSON.stringify({ p_club_id: clubId, p_member_user_id: targetUserId }) });
      if (result && result.ok === false) throw new Error(result.message || "メンバーを削除できませんでした。");
    } catch (error) {
      const raw = rawErrorText(error);
      if (raw.includes("remove_club_member") || raw.includes("schema cache") || raw.includes("Could not find the function")) {
        throw new Error("メンバー削除用のDB関数が見つかりません。supabase/patch_remove_club_member_rpc.sql を実行してください。");
      }
      throw error;
    }
    log(`${name} をクラブから削除しました。`);
    await loadClubs();
  };
  const deleteClub = async (clubId = selectedClubId()) => {
    const club = state.clubs.find((item) => item.club_id === clubId) || selectedMembership()?.clubs || {};
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isSuperClubCreator()) throw new Error("クラブ削除ができるのは特権アカウントだけです。");
    const clubName = club.name || "このクラブ";
    if (!window.confirm(`${clubName} を削除しますか？\n卓、席、メンバー、加入申請などクラブ内のデータが削除されます。`)) return;
    const typed = window.prompt(`確認のため、クラブ名「${clubName}」を入力してください。`);
    if (typed !== clubName) {
      throw new Error("クラブ名が一致しなかったため削除を中止しました。");
    }
    try {
      const result = await rest("/rpc/delete_club_for_admin", { method: "POST", body: JSON.stringify({ p_club_id: clubId }) });
      if (result && result.ok === false) throw new Error(result.message || "クラブ削除に失敗しました。");
      const remaining = await rest("/clubs?select=club_id&club_id=eq." + encodeURIComponent(clubId) + "&limit=1").catch(() => []);
      if (Array.isArray(remaining) && remaining.some((row) => row?.club_id === clubId)) {
        throw new Error("削除RPC実行後もクラブ行が残っています。supabase/patch_delete_club_for_admin.sql をSupabase SQL Editorで再実行してください。");
      }
    } catch (error) {
      const raw = rawErrorText(error);
      if (isMissingRpcError(error, "delete_club_for_admin")) {
        throw new Error("クラブ削除用のDB関数が見つかりません。supabase/patch_delete_club_for_admin.sql を実行してください。");
      }
      throw new Error(toJapaneseError(raw));
    }
    markClubLeft(clubId);
    state.activeClubId = "";
    sessionStorage.removeItem("anmikaOnlineDebugActiveClubId");
    state.memberships = state.memberships.filter((row) => row.clubs?.club_id !== clubId);
    state.clubs = state.clubs.filter((item) => item.club_id !== clubId);
    state.tables = [];
    document.body.dataset.screen = "clubs";
    await loadClubs().catch(() => {});
    render();
    log("クラブを削除しました。", { clubId, clubName });
  };

  const openClubHome = async (clubId) => {
    setActiveClubId(clubId);
    document.body.dataset.screen = "club-home";
    ["settingsDrawer", "tableCreatePanel", "tableRoomPanel"].forEach((id) => has(id) && $(id).classList.remove("open"));
    render();
    await loadTables();
    await loadClubStats();
    if (isAdmin()) {
      await loadAdminJoinRequests(clubId);
      render();
    }
  };
  const isCurrentUserSeatedAt = (seats) => {
    if (!state.user?.id) return false;
    return seats.some((seat) => seat.user_id === state.user.id);
  };
  const openPlayingTableIfNeeded = async (table, seatRows = null, { navigate = true, onlineGameState: preferredOnlineGameState = null, forceOpen = false } = {}) => {
    if (!ENABLE_AUTO_TABLE_START) return;
    if (!navigate) return;
    if (!table?.table_id || table.status !== "playing") return;
    if (!forceOpen && isLaunchInProgress(table.table_id)) return;
    if (!forceOpen && wasAutoOpenedRecently(table.table_id)) return;
    if (forceOpen) clearRecentlyLeftTable(table.table_id);
    else clearRecentlyLeftTableIfExpired();
    if (!forceOpen && isRecentlyLeftTable(table.table_id)) {
      console.log("[LastHand] recently left table: suppress auto-open", table.table_id);
      clearLocalUserSeatsForTable(table.table_id);
      state.autoOpenedPlayingTableIds.delete(table.table_id);
      state.autoStartingTableIds.delete(table.table_id);
      if (state.activeTableId === table.table_id) {
        state.activeTableId = "";
        sessionStorage.removeItem("anmikaOnlineDebugActiveTableId");
      }
      return;
    }
    const seats = normalizeSeats(seatRows || table.table_seats || state.localSeatsByTable[localSeatKey(table.table_id)] || [], table.table_id);
    if (!isCurrentUserSeatedAt(seats)) return;
    if (!forceOpen && state.autoOpenedPlayingTableIds.has(table.table_id) && state.onlineGameOpened) return;
    setActiveTableId(table.table_id);
    const onlineGameState = preferredOnlineGameState || { game_id: newSocketGameId(table.table_id), version: 0, resetRoom: false };
    state.autoOpenedPlayingTableIds.add(table.table_id);
    state.onlineGameOpened = true;
    markAutoOpenedTable(table.table_id);
    startLocalDebugMahjong(table.table_id, seats, onlineGameState, {
      autoReloadAfterLaunch: false,
      launchReloadKey: `${table.table_id}:${onlineGameState.game_id || ""}:auto-open`,
    });
  };
  const getOrCreateTableRecord = (tableId, seats = null) => {
    let table = state.tables.find((item) => item?.table_id === tableId);
    if (!table) {
      table = {
        table_id: tableId,
        club_id: selectedClubId(),
        status: "waiting",
        is_debug: hasCpuSeat(seats || []),
        table_seats: seats || [],
      };
      state.tables = [table, ...state.tables];
    } else if (seats) {
      table.table_seats = seats;
    }
    return table;
  };
  const tryAutoStartTableFromSeats = async (tableId, seatRows = null, { forceNewGame = false } = {}) => {
    if (!ENABLE_AUTO_TABLE_START) return null;
    tableId = requireTableId(tableId, "自動対局開始");
    if (!forceNewGame && isLaunchInProgress(tableId)) return null;
    if (!forceNewGame && wasAutoOpenedRecently(tableId)) return null;
    if (!forceNewGame && wasAutoStartFailedRecently(tableId)) return null;
    const seats = normalizeSeats(seatRows || getKnownSeats(tableId), tableId);
    if (forceNewGame) clearRecentlyLeftTable(tableId);
    else clearRecentlyLeftTableIfExpired();
    if (!forceNewGame && isRecentlyLeftTable(tableId)) {
      console.log("[LastHand] recently left table: suppress auto-start", tableId);
      clearLocalUserSeatsForTable(tableId);
      state.autoOpenedPlayingTableIds.delete(tableId);
      state.autoStartingTableIds.delete(tableId);
      if (state.activeTableId === tableId) {
        state.activeTableId = "";
        sessionStorage.removeItem("anmikaOnlineDebugActiveTableId");
      }
      return null;
    }
    if (filledSeatCount(seats) < 3) return null;
    if (!isCurrentUserSeatedAt(seats)) return null;

    const table = getOrCreateTableRecord(tableId, seats);
    const isDebugTable = hasCpuSeat(seats) || table.is_debug;

    if (table.status === "playing") {
      table.is_debug = isDebugTable;
      table.table_seats = seats;
      if (!forceNewGame) {
        await openPlayingTableIfNeeded(table, seats, { navigate: true });
        return state.activeGameState;
      }
    }

    if (state.autoStartingTableIds.has(tableId)) return null;
    state.autoStartingTableIds.add(tableId);
    try {
      await deactivateTableActiveGameState(tableId, "自動新規対局開始前").catch(() => {});
      const onlineGameState = { game_id: newSocketGameId(tableId), version: 0, resetRoom: true };
      table.status = "playing";
      table.is_debug = isDebugTable;
      table.table_seats = seats;
      clearAutoStartFailedTable(tableId);
      clearLocalUserLastHandFlagForTable(tableId);
      clearOwnLastHandFlag(tableId).catch((error) => log("自動対局開始前のラス半解除をスキップしました。", rawErrorText(error)));
      rest("/tables?table_id=eq." + encodeURIComponent(tableId), {
        method: "PATCH",
        body: JSON.stringify({ status: "playing" }),
      }).catch((error) => log("自動開始時の卓ステータス更新はスキップしました。", rawErrorText(error)));
      log(isDebugTable ? "CPU入りデバッグ卓を自動開始しました。" : "実プレイヤー3人が揃ったため、対局を自動開始しました。", { tableId });
      await openPlayingTableIfNeeded(table, seats, { navigate: true, onlineGameState, forceOpen: forceNewGame });
      return onlineGameState;
    } catch (error) {
      markAutoStartFailedTable(tableId);
      showError("自動対局開始に失敗しました", error);
      log("3人着席後の自動開始に失敗しました。", rawErrorText(error));
      return null;
    } finally {
      state.autoStartingTableIds.delete(tableId);
    }
  };
  const maybeAutoStartTables = async () => {
    if (!ENABLE_AUTO_TABLE_START) return;
    if (document.body.dataset.screen !== "club-home") return;
    if (state.onlineGameOpened || isLaunchInProgress()) return;
    clearRecentlyLeftTableIfExpired();
    for (const table of state.tables || []) {
      if (!table?.table_id || table.status === "ended") continue;
      if (isRecentlyLeftTable(table.table_id)) continue;
      const seats = visibleTableSeats(table);
      if (filledSeatCount(seats) < 3) continue;
      await tryAutoStartTableFromSeats(table.table_id, seats).catch((error) => log("対局画面の自動表示に失敗しました。", rawErrorText(error)));
    }
  };
  const scheduleAutoStartFromVisibleTables = () => {
    if (!ENABLE_AUTO_TABLE_START) return;
    if (document.body.dataset.screen !== "club-home") return;
    if (state.onlineGameOpened || isLaunchInProgress()) return;
    if (state.autoStartRenderScheduled) return;
    state.autoStartRenderScheduled = true;
    window.setTimeout(async () => {
      state.autoStartRenderScheduled = false;
      clearRecentlyLeftTableIfExpired();
      for (const table of state.tables || []) {
        if (!table?.table_id || table.status === "ended") continue;
        if (isRecentlyLeftTable(table.table_id)) continue;
        const seats = visibleTableSeats(table);
        if (filledSeatCount(seats) < 3) continue;
        console.log("[AutoStart] visible table filled", { tableId: table.table_id, seats });
        await tryAutoStartTableFromSeats(table.table_id, seats).catch((error) => {
          console.error("[AutoStart] failed", error);
          showError("自動対局開始に失敗しました", error);
        });
      }
    }, 0);
  };
  const hasActiveGameForTable = async (tableId) => {
    if (!tableId) return false;
    const rows = await rest(
      "/game_states?select=game_id&table_id=eq." + encodeURIComponent(tableId) + "&is_active=eq.true&limit=1"
    ).catch((error) => {
      log("進行中局面の確認に失敗しました。", rawErrorText(error));
      return [{ unknown: true }];
    });
    return Array.isArray(rows) && rows.length > 0;
  };
  const markTableWaitingIfNoActiveGame = async (tableId) => {
    if (!tableId) return false;
    try {
      const result = await rest("/rpc/mark_table_waiting_if_no_active_game", {
        method: "POST",
        body: JSON.stringify({ p_table_id: tableId }),
      });
      const updated = Array.isArray(result) ? result[0] : result;
      if (!updated?.table_id) return false;
      state.tables = state.tables.map((item) =>
        item.table_id === tableId ? { ...item, ...(updated || {}), status: "waiting" } : item
      );
      return true;
    } catch (rpcError) {
      const raw = rawErrorText(rpcError);
      if (raw.includes("table is currently playing")) return false;
      if (!raw.includes("mark_table_waiting_if_no_active_game") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("卓状態の復帰RPCに失敗したため直接確認します。", raw);
      }
    }
    if (await hasActiveGameForTable(tableId)) return false;
    await rest("/games?table_id=eq." + encodeURIComponent(tableId) + "&status=eq.playing", {
      method: "PATCH",
      body: JSON.stringify({ status: "ended", ended_at: new Date().toISOString() }),
    }).catch(() => {});
    await rest("/tables?table_id=eq." + encodeURIComponent(tableId), {
      method: "PATCH",
      body: JSON.stringify({ status: "waiting" }),
    });
    state.tables = state.tables.map((item) =>
      item.table_id === tableId ? { ...item, status: "waiting" } : item
    );
    return true;
  };
  const syncTablePlayingStatus = async (tableId) => {
    if (!tableId) return null;
    try {
      const result = await rest("/rpc/sync_table_playing_status", {
        method: "POST",
        body: JSON.stringify({ p_table_id: tableId }),
      });
      const updated = Array.isArray(result) ? result[0] : result;
      if (!updated?.table_id) return null;
      state.tables = state.tables.map((item) => (item.table_id === tableId ? { ...item, ...updated } : item));
      return updated;
    } catch (rpcError) {
      const raw = rawErrorText(rpcError);
      if (!raw.includes("sync_table_playing_status") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("卓状態の自動同期RPCに失敗しました。", raw);
      }
      if (await hasActiveGameForTable(tableId)) {
        state.tables = state.tables.map((item) => (item.table_id === tableId ? { ...item, status: "playing" } : item));
        return state.tables.find((item) => item.table_id === tableId) || null;
      }
      await markTableWaitingIfNoActiveGame(tableId).catch(() => false);
      return state.tables.find((item) => item.table_id === tableId) || null;
    }
  };
  const reconcileTablePlayingStatuses = async () => {
    clearRecentlyLeftTableIfExpired();
    for (const table of state.tables || []) {
      if (!table?.table_id || table.status === "ended") continue;
      if (isRecentlyLeftTable(table.table_id)) {
        state.tables = state.tables.map((item) => item.table_id === table.table_id ? maskRecentlyLeftTable(item) : item);
        continue;
      }
      await syncTablePlayingStatus(table.table_id).catch((error) =>
        log("卓状態の自動同期に失敗しました。", rawErrorText(error))
      );
    }
  };
  const loadWaitingForTables = async () => {
    const tableIds = [...new Set((state.tables || []).map((table) => table?.table_id).filter(Boolean))];
    state.tables = state.tables.map((table) => ({ ...table, table_waiting_list: table.table_waiting_list || [] }));
    if (!tableIds.length) return;
    const inClause = tableIds.join(",");
    let rows = [];
    try {
      rows = await rest(
        "/table_waiting_list?select=table_id,user_id,created_at,users(user_id,display_name,login_id)&table_id=in.(" +
          inClause +
          ")&order=created_at.asc"
      );
    } catch (joinError) {
      log("ウェイティング一覧のユーザー情報取得に失敗したため、ID表示で取得します。", rawErrorText(joinError));
      rows = await rest(
        "/table_waiting_list?select=table_id,user_id,created_at&table_id=in.(" + inClause + ")&order=created_at.asc"
      );
    }
    const byTable = new Map();
    (rows || []).forEach((row) => {
      const list = byTable.get(row.table_id) || [];
      list.push(row);
      byTable.set(row.table_id, list);
    });
    state.tables = state.tables.map((table) => ({
      ...table,
      table_waiting_list: byTable.get(table.table_id) || [],
    }));
  };
  const runTablePostRefresh = async (reason = "loadTables") => {
    if (state.tablePostRefreshInFlight) return;
    state.tablePostRefreshInFlight = true;
    try {
      await loadWaitingForTables().catch((error) => log("ウェイティング一覧の取得に失敗しました。", rawErrorText(error)));
      enforceOneVisibleSeatForCurrentUser();
      render();
      window.setTimeout(() => {
        reconcileTablePlayingStatuses()
          .then(() => {
            render();
            return maybeAutoStartTables();
          })
          .catch((error) => log(`卓状態の後追い更新に失敗しました。(${reason})`, rawErrorText(error)))
          .finally(() => {
            state.tablePostRefreshInFlight = false;
          });
      }, 0);
    } catch (error) {
      state.tablePostRefreshInFlight = false;
      log(`卓一覧の後追い更新に失敗しました。(${reason})`, rawErrorText(error));
    }
  };
  const loadTables = async ({ withPostRefresh = true } = {}) => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    try {
      state.tables = await rest("/rpc/shared_list_tables_for_club", { method: "POST", body: JSON.stringify({ p_club_id: clubId }) });
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("shared_list_tables_for_club") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw error;
      state.tables = await rest("/tables?select=*,table_seats(*),table_waiting_list(*)&club_id=eq." + encodeURIComponent(clubId) + "&order=created_at.desc");
    }
    clearRecentlyLeftTableIfExpired();
    state.tables = state.tables.map(maskRecentlyLeftTable);
    enforceOneVisibleSeatForCurrentUser();
    render();
    if (withPostRefresh) runTablePostRefresh("loadTables");
  };
  const createTable = async () => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) throw new Error("卓作成権限がありません。クラブ管理者のみ卓を作成できます。");
    ensureTsumoLossless3maCreateUi();
    const ruleId = selectedCreateRuleId();
    const defaultName = ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? "全赤三麻卓" : "アンミカロケット卓";
    const tableName = $("tableName").value.trim() || `${defaultName} ${String(state.tables.length + 1).padStart(3, "0")}`;
    const rpcBody = {
        p_club_id: clubId,
        p_name: tableName,
        p_rule_id: ruleId,
        p_point_rate: has("pointRate") ? Number($("pointRate").value || 1) : 1,
        p_rake_percent: ruleId === TSUMO_LOSSLESS_3MA_RULE_ID ? 0 : (has("rakePercent") ? Number($("rakePercent").value || 5) : 5),
        p_rule_config: readCreateTableRuleConfig(),
    };
    let created;
    try {
      created = await rest("/rpc/create_table_with_seats", {
        method: "POST",
        body: JSON.stringify(rpcBody),
      });
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("create_table_with_seats") && !raw.includes("schema cache") && !raw.includes("p_rule_config")) throw error;
      if (ruleId === TSUMO_LOSSLESS_3MA_RULE_ID) {
        throw new Error("全赤三麻の卓設定保存に必要なDB関数が未更新です。Supabase SQL Editorで patch_tsumo_lossless_3ma_rule.sql を実行してください。");
      }
      created = await rest("/rpc/create_table_with_seats", {
        method: "POST",
        body: JSON.stringify({
          p_club_id: rpcBody.p_club_id,
          p_name: rpcBody.p_name,
          p_rule_id: rpcBody.p_rule_id,
          p_point_rate: rpcBody.p_point_rate,
          p_rake_percent: rpcBody.p_rake_percent,
        }),
      });
    }
    const table = Array.isArray(created) ? created[0] : created;
    if (!table?.table_id) throw new Error("卓作成に成功しましたが、tableId を取得できませんでした。卓一覧を更新してください。");
    setActiveTableId(table.table_id);
    await loadTables();
    if (has("tableCreatePanel")) $("tableCreatePanel").classList.remove("open");
    render();
    startPolling();
  };
  const renderSeatRows = (rows, tableId = selectedTableId()) => {
    const normalized = normalizeSeats(rows, tableId);
    $("seatsOutput").textContent = JSON.stringify(normalized, null, 2);
    if (!has("seatRows")) return normalized;
    $("seatRows").innerHTML = "";
    normalized.forEach((seat) => {
      const row = document.createElement("div");
      row.className = "seat-row";
      row.innerHTML = `<span>席${Number(seat.seat_index) + 1}</span><strong>${formatSeatName(seat)}</strong><span>${seat.player_type || "empty"}</span>`;
      $("seatRows").append(row);
    });
    return normalized;
  };
  const clearMyWaiting = async () => {
    const user = requireUser();
    try {
      await rest("/rpc/clear_my_table_waiting", { method: "POST", body: JSON.stringify({}) });
    } catch (rpcError) {
      const raw = rawErrorText(rpcError);
      if (!raw.includes("clear_my_table_waiting") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
      await rest("/table_waiting_list?user_id=eq." + encodeURIComponent(user.id), { method: "DELETE" }).catch(() => {});
    }
  };
  const toggleWaiting = async (tableId) => {
    tableId = requireTableId(tableId, "ウェイティング切替");
    requireUser();
    try {
      await rest("/rpc/toggle_table_waiting", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
    } catch (rpcError) {
      const raw = rawErrorText(rpcError);
      if (!raw.includes("toggle_table_waiting") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
      const existing = await rest(
        "/table_waiting_list?select=table_id&table_id=eq." + encodeURIComponent(tableId) + "&user_id=eq." + encodeURIComponent(state.user.id) + "&limit=1"
      );
      if (Array.isArray(existing) && existing.length) {
        await rest("/table_waiting_list?table_id=eq." + encodeURIComponent(tableId) + "&user_id=eq." + encodeURIComponent(state.user.id), { method: "DELETE" });
      } else {
        await rest("/table_waiting_list", {
          method: "POST",
          body: JSON.stringify({ table_id: tableId, user_id: state.user.id }),
        });
      }
    }
    await loadTables();
  };
  const loadSeats = async () => {
    const tableId = selectedTableId();
    if (!tableId) throw new Error(JA_MESSAGES.selectTable);
    if (!isUuid(tableId)) throw new Error(`卓IDが不正です: ${tableId}`);
    try {
      let rows;
      try {
        rows = await rest("/rpc/shared_get_table_seats", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
      } catch (rpcError) {
        const raw = rawErrorText(rpcError);
        if (!raw.includes("shared_get_table_seats") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
        rows = await rest("/table_seats?select=*&table_id=eq." + encodeURIComponent(tableId) + "&order=seat_index.asc");
      }
      const normalizedFromDb = normalizeSeats(rows, tableId);
      renderSeatRows(normalizedFromDb, tableId);
      saveLocalSeats(tableId, normalizedFromDb);
      renderDebug();
      return normalizedFromDb;
    } catch (error) {
      const rows = getLocalSeats(tableId);
      renderSeatRows(rows, tableId);
      log("DBの席取得に失敗したため、ローカルデバッグ席を表示しました。", rawErrorText(error));
      renderDebug();
      return rows;
    }
  };
  const clearOwnLastHandFlag = async (tableId) => {
    if (!tableId || !state.user?.id) return;
    try {
      await rest("/rpc/shared_set_last_hand", {
        method: "POST",
        body: JSON.stringify({ p_table_id: tableId, p_is_last_hand: false }),
      });
    } catch (rpcError) {
      const raw = rawErrorText(rpcError);
      if (!raw.includes("shared_set_last_hand") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) {
        log("ラス半解除RPCに失敗しました。直接解除します。", raw);
      }
      await rest(
        "/table_seats?table_id=eq." + encodeURIComponent(tableId) + "&user_id=eq." + encodeURIComponent(state.user.id),
        {
          method: "PATCH",
          body: JSON.stringify({ is_last_hand_declared: false }),
        }
      ).catch((error) => log("ラス半の直接解除に失敗しました。", rawErrorText(error)));
    }
    clearLocalUserLastHandFlagForTable(tableId, state.user.id);
  };
  const clearRemoteUserSeatsExcept = async (tableId, keepSeatIndex = null) => {
    const user = requireUser();
    const ownSeats = await rest("/table_seats?select=table_id,seat_index&user_id=eq." + encodeURIComponent(user.id)).catch(() => []);
    for (const seat of ownSeats || []) {
      const otherTableId = seat.table_id;
      const otherSeatIndex = seat.seat_index;
      if (!otherTableId && otherTableId !== 0) continue;
      if (
        String(otherTableId) === String(tableId) &&
        keepSeatIndex !== null &&
        keepSeatIndex !== undefined &&
        Number(otherSeatIndex) === Number(keepSeatIndex)
      ) {
        continue;
      }
      await rest(
        "/table_seats?table_id=eq." + encodeURIComponent(otherTableId) + "&seat_index=eq." + encodeURIComponent(String(otherSeatIndex)) + "&user_id=eq." + encodeURIComponent(user.id),
        {
        method: "PATCH",
        body: JSON.stringify({
          user_id: null,
          player_type: "empty",
          display_name: null,
          is_last_hand_declared: false,
        }),
        }
      ).catch((error) => log("重複席の解除に失敗しました。", rawErrorText(error)));
    }
  };
  const sit = async (tableId = selectedTableId(), seatIndex = undefined) => {
    tableId = requireTableId(tableId, "着席");
    setActiveTableId(tableId);
    clearRecentlyLeftTable(tableId);
    state.autoOpenedPlayingTableIds.delete(tableId);
    clearAutoOpenedTable(tableId);
    clearLaunchingTable();
    await ensureEnoughClubPointsForSeat(tableId);
    try {
      await clearRemoteUserSeatsExcept(tableId, null).catch((error) => log("着席前の既存席解除に失敗しました。", rawErrorText(error)));
      try {
        await rest("/rpc/shared_sit_at_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId, p_seat_index: Number.isInteger(seatIndex) ? Number(seatIndex) : null }) });
      } catch (sharedError) {
        const raw = rawErrorText(sharedError);
        if (!raw.includes("shared_sit_at_table") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw sharedError;
        await clearRemoteUserSeatsExcept(tableId, null).catch((error) => log("着席前の重複席解除に失敗しました。", rawErrorText(error)));
        try {
          await rest("/rpc/sit_at_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId, p_seat_index: seatIndex }) });
        } catch (seatRpcError) {
          if (seatIndex === undefined) throw seatRpcError;
          await rest("/rpc/sit_at_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
        }
      }
      await clearOwnLastHandFlag(tableId);
      await clearMyWaiting().catch((error) => log("着席後のウェイティング解除に失敗しました。", rawErrorText(error)));
      await loadTables();
      const rows = await loadSeats();
      await tryAutoStartTableFromSeats(tableId, rows, { forceNewGame: true }).catch((error) => log("着席後の自動開始確認に失敗しました。", rawErrorText(error)));
      const ownSeat = rows.find((seat) => seat.user_id === state.user?.id);
      if (ownSeat) {
        await clearRemoteUserSeatsExcept(tableId, ownSeat.seat_index).catch((error) => log("着席後の重複席解除に失敗しました。", rawErrorText(error)));
        clearLocalUserSeatsExcept(tableId, ownSeat.seat_index);
        await loadTables();
        enforceOneVisibleSeatForCurrentUser(tableId, ownSeat.seat_index);
        await loadSeats();
      }
      return;
    } catch (error) {
      log("DB着席に失敗したため、ローカルデバッグ着席に切り替えました。", rawErrorText(error));
      const rows = getKnownSeats(tableId);
      const target = Number.isInteger(seatIndex)
        ? rows.find((seat) => Number(seat.seat_index) === Number(seatIndex))
        : rows.find((seat) => !seat.user_id && seat.player_type !== "cpu") || rows.find((seat) => seat.player_type === "cpu") || rows.find((seat) => seat.user_id === state.user?.id);
      if (!target) throw new Error("着席に失敗しました。原因: 指定された席が見つかりません。");
      if (target.user_id && target.user_id !== state.user?.id && target.player_type !== "cpu") throw new Error("着席に失敗しました。原因: この席はすでに埋まっています。");
      clearLocalUserSeatsExcept(tableId, target.seat_index);
      await clearRemoteUserSeatsExcept(tableId, null).catch(() => {});
      target.user_id = requireUser().id;
      target.player_type = "human";
      target.display_name = requireUser().displayName || "あなた";
      target.is_last_hand_declared = false;
      await clearMyWaiting().catch(() => {});
      saveLocalSeats(tableId, rows);
      enforceOneVisibleSeatForCurrentUser(tableId, target.seat_index);
      renderSeatRows(rows, tableId);
      await loadTables().catch(() => render());
      await tryAutoStartTableFromSeats(tableId, rows, { forceNewGame: true }).catch((startError) => log("ローカル着席後の自動開始確認に失敗しました。", rawErrorText(startError)));
    }
  };
  const leave = async (tableId = selectedTableId()) => {
    tableId = requireTableId(tableId, "退席");
    setActiveTableId(tableId);
    try {
      await clearOwnLastHandFlag(tableId);
      await rest("/rpc/leave_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
      await loadTables();
      await loadSeats().catch(() => {});
    } catch (error) {
      log("DB退席に失敗したため、ローカル席状態を更新しました。", rawErrorText(error));
      const rows = getKnownSeats(tableId).map((seat) =>
        seat.user_id === state.user?.id
          ? { ...seat, user_id: null, player_type: "empty", display_name: null, is_last_hand_declared: false }
          : seat
      );
      saveLocalSeats(tableId, rows);
      renderSeatRows(rows, tableId);
      await loadTables().catch(() => render());
    }
  };
  const addCpu = async (tableId = selectedTableId()) => {
    tableId = requireTableId(tableId, "CPU追加");
    setActiveTableId(tableId);
    try {
      try {
        await rest("/rpc/shared_add_debug_cpu_to_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
      } catch (sharedError) {
        const raw = rawErrorText(sharedError);
        if (!raw.includes("shared_add_debug_cpu_to_table") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw sharedError;
        await rest("/rpc/add_debug_cpu_to_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
      }
      await loadTables();
      const rows = await loadSeats();
      await tryAutoStartTableFromSeats(tableId, rows).catch((error) => log("CPU追加後の自動開始確認に失敗しました。", rawErrorText(error)));
      return;
    } catch (error) {
      log("DBのCPU追加に失敗したため、ローカルデバッグCPUを追加しました。", rawErrorText(error));
      const rows = getKnownSeats(tableId);
      const target = rows.find((seat) => !seat.user_id && seat.player_type !== "cpu");
      if (!target) throw new Error("CPU追加に失敗しました。原因: 空席がありません。");
      const cpuNumber = rows.filter((seat) => seat.player_type === "cpu").length + 1;
      target.user_id = null;
      target.player_type = "cpu";
      target.display_name = `CPU${cpuNumber}`;
      saveLocalSeats(tableId, rows);
      renderSeatRows(rows, tableId);
      render();
    }
  };
  const removeCpu = async (tableId = selectedTableId()) => {
    tableId = requireTableId(tableId, "CPU削除");
    setActiveTableId(tableId);
    try {
      try {
        await rest("/rpc/shared_remove_debug_cpu_from_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
      } catch (sharedError) {
        const raw = rawErrorText(sharedError);
        if (!raw.includes("shared_remove_debug_cpu_from_table") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw sharedError;
        await rest("/rpc/remove_debug_cpu_from_table", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
      }
      await loadTables();
      await loadSeats();
      return;
    } catch (error) {
      log("DBのCPU削除に失敗したため、ローカルデバッグCPUを削除しました。", rawErrorText(error));
      const rows = getKnownSeats(tableId);
      const target = [...rows].reverse().find((seat) => seat.player_type === "cpu");
      if (!target) throw new Error("CPU削除に失敗しました。原因: CPU席がありません。");
      target.user_id = null;
      target.player_type = "empty";
      target.display_name = null;
      saveLocalSeats(tableId, rows);
      renderSeatRows(rows, tableId);
      render();
    }
  };
  const deleteTable = async (tableId = selectedTableId()) => {
    tableId = requireTableId(tableId, "卓削除");
    if (!isAdmin()) throw new Error("卓削除権限がありません。クラブ管理者のみ削除できます。");
    const syncedTable = await syncTablePlayingStatus(tableId).catch(() => null);
    const table = syncedTable || state.tables.find((item) => item.table_id === tableId);
    const tableName = table?.name || "この卓";
    const statusNote = table?.status === "playing" ? "\nこの卓が対局中表示の場合、対局状態も中断して削除します。" : "";
    if (!window.confirm(`${tableName} を削除しますか？\n牌譜や履歴は削除しません。${statusNote}`)) return;
    setActiveTableId(tableId);
    try {
      try {
        const deleteResult = await rest("/rpc/delete_table_for_admin", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
        if (deleteResult && deleteResult.ok === false) {
          throw new Error(deleteResult.message || "卓が見つからない、または削除権限がありません。");
        }
      } catch (rpcError) {
        const raw = rawErrorText(rpcError);
        if (!raw.includes("delete_table_for_admin") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
        try {
          await rest("/rpc/delete_table_if_not_started", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
        } catch (legacyRpcError) {
          const legacyRaw = rawErrorText(legacyRpcError);
          if (
            !legacyRaw.includes("delete_table_if_not_started") &&
            !legacyRaw.includes("schema cache") &&
            !legacyRaw.includes("Could not find the function") &&
            !legacyRaw.includes("table already started") &&
            !legacyRaw.includes("table is currently playing")
          ) throw legacyRpcError;
          await rest("/table_waiting_list?table_id=eq." + encodeURIComponent(tableId), { method: "DELETE" }).catch(() => {});
          await rest("/table_seats?table_id=eq." + encodeURIComponent(tableId), { method: "DELETE" }).catch(() => {});
          await rest("/game_events?table_id=eq." + encodeURIComponent(tableId), { method: "DELETE" }).catch(() => {});
          await rest("/game_states?table_id=eq." + encodeURIComponent(tableId), { method: "DELETE" }).catch(() => {});
          await rest("/games?table_id=eq." + encodeURIComponent(tableId), { method: "DELETE" }).catch(() => {});
          await rest("/tables?table_id=eq." + encodeURIComponent(tableId), { method: "DELETE" });
        }
      }
      if (state.activeTableId === tableId) setActiveTableId("");
      state.tables = state.tables.filter((item) => item.table_id !== tableId);
      delete state.localSeatsByTable[localSeatKey(tableId)];
      saveLocalSeatsCache();
      await loadTables();
    } catch (error) {
      const stillExists = await rest("/tables?select=table_id&table_id=eq." + encodeURIComponent(tableId))
        .then((rows) => Array.isArray(rows) && rows.length > 0)
        .catch(() => true);
      if (!stillExists) {
        if (state.activeTableId === tableId) setActiveTableId("");
        state.tables = state.tables.filter((item) => item.table_id !== tableId);
        delete state.localSeatsByTable[localSeatKey(tableId)];
        saveLocalSeatsCache();
        render();
        log("卓を削除しました。", { tableId });
        return;
      }
      throw new Error(`卓削除に失敗しました。原因: ${toJapaneseAuthError(rawErrorText(error))}`);
    }
  };
  const leaveClub = async (clubId) => {
    const user = requireUser();
    if (!clubId) throw new Error("脱退するクラブを選択できませんでした。");
    const club = state.clubs.find((item) => item.club_id === clubId);
    const membership = state.memberships.find((row) => row.clubs?.club_id === clubId);
    if (membership?.role === "admin") throw new Error("管理者のクラブからは脱退できません。先に管理者を変更してください。");
    const clubName = club?.name || "このクラブ";
    if (!window.confirm(`${clubName} から本当に脱退しますか？`)) return;
    markClubLeft(clubId);
    state.memberships = state.memberships.filter((row) => row.clubs?.club_id !== clubId);
    state.clubs = state.clubs.filter((item) => item.club_id !== clubId);
    state.joinRequests = state.joinRequests.filter((request) => (request.clubs?.club_id || request.club_id) !== clubId);
    render();
    try {
      try {
        const leaveResult = await rest("/rpc/leave_club", { method: "POST", body: JSON.stringify({ p_club_id: clubId }) });
        if (leaveResult && leaveResult.ok === false) {
          throw new Error(leaveResult.message || "クラブ脱退に失敗しました。");
        }
      } catch (rpcError) {
        const raw = rawErrorText(rpcError);
        if (!raw.includes("leave_club") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
        const clubTables = await rest("/tables?select=table_id&club_id=eq." + encodeURIComponent(clubId)).catch(() => []);
        for (const row of clubTables || []) {
          if (!row.table_id) continue;
          await rest("/table_waiting_list?table_id=eq." + encodeURIComponent(row.table_id) + "&user_id=eq." + encodeURIComponent(user.id), { method: "DELETE" }).catch(() => {});
          await rest("/table_seats?table_id=eq." + encodeURIComponent(row.table_id) + "&user_id=eq." + encodeURIComponent(user.id), { method: "DELETE" }).catch(() => {});
        }
        await rest("/club_members?club_id=eq." + encodeURIComponent(clubId) + "&user_id=eq." + encodeURIComponent(user.id), { method: "DELETE" });
      }
      await rest(
        "/club_join_requests?club_id=eq." + encodeURIComponent(clubId) + "&user_id=eq." + encodeURIComponent(user.id),
        { method: "PATCH", body: JSON.stringify({ status: "rejected", updated_at: new Date().toISOString() }) }
      ).catch(() => {});
      if (selectedClubId() === clubId) {
        setActiveClubId("");
        state.tables = [];
        if (has("tableCards")) $("tableCards").innerHTML = "";
      }
      await loadClubs();
      document.body.dataset.screen = "clubs";
      render();
    } catch (error) {
      throw new Error(`クラブ脱退に失敗しました。原因: ${toJapaneseAuthError(rawErrorText(error))}`);
    }
  };
  const updateClubName = async (clubId, name) => {
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) throw new Error("クラブ設定を変更できるのは管理者だけです。");
    const nextName = String(name || "").trim();
    if (!nextName) throw new Error("クラブ名を入力してください。");
    try {
      try {
        await rest("/rpc/update_club_name", {
          method: "POST",
          body: JSON.stringify({ p_club_id: clubId, p_name: nextName }),
        });
      } catch (rpcError) {
        const raw = rawErrorText(rpcError);
        if (!raw.includes("update_club_name") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
        await rest("/clubs?club_id=eq." + encodeURIComponent(clubId), {
          method: "PATCH",
          body: JSON.stringify({ name: nextName, updated_at: new Date().toISOString() }),
        });
      }
      state.clubs = state.clubs.map((club) => (club.club_id === clubId ? { ...club, name: nextName } : club));
      state.memberships = state.memberships.map((row) =>
        row.clubs?.club_id === clubId ? { ...row, clubs: { ...row.clubs, name: nextName } } : row
      );
      await loadClubs().catch(() => {});
      render();
      log("クラブ名を変更しました。", { clubId, name: nextName });
    } catch (error) {
      throw new Error(`クラブ名変更に失敗しました。原因: ${toJapaneseAuthError(rawErrorText(error))}`);
    }
  };
  const updateUserIcon = async (file) => {
    const user = requireUser();
    const iconUrl = await fileToDataUrl(file);
    try {
      let latestProfile = null;
      try {
        const result = await rest("/rpc/update_my_icon", {
          method: "POST",
          body: JSON.stringify({ p_icon_url: iconUrl }),
        });
        const profile = Array.isArray(result) ? result[0] : result;
        if (profile?.user_id) latestProfile = profile;
      } catch (rpcError) {
        const raw = rawErrorText(rpcError);
        if (!raw.includes("update_my_icon") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
        await rest("/users?user_id=eq." + encodeURIComponent(user.id), {
          method: "PATCH",
          body: JSON.stringify({ icon_url: iconUrl, updated_at: new Date().toISOString() }),
        });
      }
      latestProfile = latestProfile || await getProfile(user.id).catch(() => null);
      state.user = latestProfile?.user_id ? profileToUser(latestProfile) : { ...state.user, iconUrl };
      localStorage.setItem("anmikaDebugUser", JSON.stringify(state.user));
      await loadClubs().catch(() => {});
      render();
      log("アカウントアイコンを変更しました。");
    } catch (error) {
      throw new Error(`アイコン変更に失敗しました。原因: ${toJapaneseAuthError(rawErrorText(error))}`);
    }
  };
  const updateDisplayName = async (displayName) => {
    const user = requireUser();
    const nextName = String(displayName || "").trim();
    if (!nextName) throw new Error("名前を入力してください。");
    console.log("[Account] update display name start", { userId: user.id, displayName: nextName });
    await request("/auth/v1/user", {
      method: "PUT",
      body: JSON.stringify({ data: { display_name: nextName } }),
    }).catch((error) => log("Supabase Authの名前更新に失敗しました。プロフィール側は更新します。", rawErrorText(error)));
    let profile = null;
    try {
      const result = await rest("/rpc/update_my_display_name", {
        method: "POST",
        body: JSON.stringify({ p_display_name: nextName }),
      });
      profile = Array.isArray(result) ? result[0] : result;
    } catch (rpcError) {
      const raw = rawErrorText(rpcError);
      if (!raw.includes("update_my_display_name") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
      await rest("/users?user_id=eq." + encodeURIComponent(user.id), {
        method: "PATCH",
        body: JSON.stringify({ display_name: nextName, updated_at: new Date().toISOString() }),
      });
    }
    profile = profile?.user_id ? profile : await getProfile(user.id);
    if (profile?.display_name !== nextName) {
      throw new Error("名前変更用のDB関数が未適用です。Supabase SQL Editorで supabase/patch_account_display_name_rpc.sql を実行してください。");
    }
    saveSession({ access_token: state.accessToken, refresh_token: state.refreshToken }, profile);
    await loadClubs().catch(() => {});
    log("名前を変更しました。", profile);
    console.log("[Account] update display name success", profile);
    render();
    return profile;
  };
  const updateEmailAddress = async (email) => {
    const user = requireUser();
    const nextEmail = String(email || "").trim();
    if (!nextEmail) throw new Error("メールアドレスを入力してください。");
    await request("/auth/v1/user", {
      method: "PUT",
      body: JSON.stringify({ email: nextEmail }),
    });
    await rest("/users?user_id=eq." + encodeURIComponent(user.id), {
      method: "PATCH",
      body: JSON.stringify({ auth_email: nextEmail, updated_at: new Date().toISOString() }),
    }).catch((error) => log("プロフィール側メール更新に失敗しました。Auth側の変更は送信済みです。", rawErrorText(error)));
    const profile = await getProfile(user.id).catch(() => state.profile);
    saveSession({ access_token: state.accessToken, refresh_token: state.refreshToken }, profile);
    log("メールアドレス変更を送信しました。確認メールが必要な設定の場合は、メール内のリンクを開いてください。");
    render();
    return profile;
  };
  const updatePassword = async (password) => {
    const nextPassword = String(password || "");
    if (!nextPassword) throw new Error("新しいパスワードを入力してください。");
    if (nextPassword.length < 6) throw new Error(JA_MESSAGES.passwordTooShort);
    await request("/auth/v1/user", {
      method: "PUT",
      body: JSON.stringify({ password: nextPassword }),
    });
    log("パスワードを変更しました。");
  };
  const updateClubIcon = async (clubId, file) => {
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) throw new Error("クラブアイコンを変更できるのは管理者だけです。");
    const iconUrl = await fileToDataUrl(file);
    let savedIconUrl = iconUrl;
    try {
      try {
        const result = await rest("/rpc/update_club_icon", {
          method: "POST",
          body: JSON.stringify({ p_club_id: clubId, p_icon_url: iconUrl }),
        });
        const updatedClub = Array.isArray(result) ? result[0] : result;
        if (!updatedClub?.club_id && !updatedClub?.icon_url) throw new Error("クラブアイコンの保存結果を取得できませんでした。");
        savedIconUrl = updatedClub.icon_url || iconUrl;
      } catch (rpcError) {
        const raw = rawErrorText(rpcError);
        if (!raw.includes("update_club_icon") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw rpcError;
        await rest("/clubs?club_id=eq." + encodeURIComponent(clubId), {
          method: "PATCH",
          body: JSON.stringify({ icon_url: iconUrl, updated_at: new Date().toISOString() }),
        });
      }
      const latestClub = await fetchClubById(clubId).catch(() => null);
      savedIconUrl = latestClub?.icon_url || savedIconUrl;
      saveClubIconCache(clubId, savedIconUrl);
      state.clubs = state.clubs.map((club) => (club.club_id === clubId ? { ...club, ...(latestClub || {}), icon_url: savedIconUrl } : club));
      state.memberships = state.memberships.map((row) =>
        row.clubs?.club_id === clubId ? { ...row, clubs: { ...row.clubs, ...(latestClub || {}), icon_url: savedIconUrl } } : row
      );
      await loadClubs().catch(() => {});
      render();
      log("クラブアイコンを変更しました。");
    } catch (error) {
      throw new Error(`クラブアイコン変更に失敗しました。原因: ${toJapaneseAuthError(rawErrorText(error))}`);
    }
  };
  const setSeatLastHand = async (tableId, isLastHand) => {
    tableId = requireTableId(tableId, "ラス半切替");
    setActiveTableId(tableId);
    await rest("/rpc/shared_set_last_hand", {
      method: "POST",
      body: JSON.stringify({ p_table_id: tableId, p_is_last_hand: Boolean(isLastHand) }),
    });
    await loadTables();
    if (selectedTableId() === tableId) await loadSeats();
    log(isLastHand ? "ラス半を入れました。" : "ラス半を解除しました。", { tableId });
  };
  const getGameServerUrl = () => {
    if (window.location.protocol === "file:") return "http://127.0.0.1:8787";
    return window.location.origin;
  };
  const startLocalDebugMahjong = (tableId, sourceRows, onlineGameState = null, launchOptions = {}) => {
    if (isLaunchInProgress(tableId)) return;
    const rows = normalizeSeats(sourceRows?.length ? sourceRows : getLocalSeats(tableId), tableId)
      .map((seat) => ({ ...seat, is_last_hand_declared: false, isLastHandDeclared: false }));
    if (filledSeatCount(rows) < 3) {
      throw new Error("3席が埋まっていません。CPUを追加するか、プレイヤーが着席してください。");
    }
    const table = state.tables.find((item) => item.table_id === tableId) || {};
    const tableRuleConfig = parseRuleConfig(table.rule_config);
    const localTableId = `online-debug-${tableId}`;
    const gameId = onlineGameState?.game_id || `socket-game-${tableId}`;
    const currentUser = requireUser();
    const localUsers = JSON.parse(localStorage.getItem("anmikaRocket.users") || "[]");
    const humanUser = {
      id: currentUser.id,
      displayName: currentUser.displayName || "プレイヤー1",
      createdAt: Date.now(),
      ownedClubIds: [],
      joinedClubIds: [],
    };
    const remoteUsers = rows
      .filter((seat) => seat.player_type !== "cpu" && seat.user_id && seat.user_id !== currentUser.id)
      .map((seat) => ({
        id: seat.user_id,
        displayName: seat.display_name || `Player ${String(seat.user_id).slice(0, 8)}`,
        createdAt: Date.now(),
        ownedClubIds: [],
        joinedClubIds: [],
      }));
    const launchUsers = [humanUser, ...remoteUsers];
    const nextUsers = [...launchUsers, ...localUsers.filter((user) => !launchUsers.some((launchUser) => launchUser.id === user.id))];
    const seats = rows.map((seat, index) => {
      const isOwnHumanSeat = seat.player_type !== "cpu" && seat.user_id === currentUser.id;
      const isRealPlayerSeat = seat.player_type !== "cpu" && seat.user_id;
      return {
        seatIndex: index,
        playerId: isRealPlayerSeat ? seat.user_id : `cpu${index}`,
        playerType: seat.player_type === "cpu" ? "cpu" : isOwnHumanSeat ? "human" : "remote",
        isOccupied: true,
        isReady: true,
        isLastHandDeclared: false,
      };
    });
    const localTable = {
      id: localTableId,
      sourceTableId: tableId,
      clubId: selectedClubId() || "online-debug-club",
      name: table.name || "オンラインデバッグ卓",
      ruleId: table.rule_id || "anmika-rocket",
      gameType: table.rule_id || "anmika-rocket",
      pointRate: Number(table.point_rate || 1),
      rakePercent: Number(table.rake_percent || 0),
      ruleConfig: table.rule_id === TSUMO_LOSSLESS_3MA_RULE_ID ? tableRuleConfig : {
        rocket19Enabled: Boolean(tableRuleConfig.rocket19Enabled),
        baibaEnabled: Boolean(tableRuleConfig.baibaEnabled),
        otokogiEnabled: tableRuleConfig.otokogiEnabled !== false,
        feverRiichiEnabled: Boolean(tableRuleConfig.feverRiichiEnabled),
        turquoise5pCount: Number(tableRuleConfig.turquoise5pCount ?? 0),
      },
      createdBy: currentUser.id,
      seats,
      waitingList: [],
      status: "playing",
      isDebug: hasCpuSeat(rows),
      createdAt: Date.now(),
    };
    const storedTables = JSON.parse(localStorage.getItem("anmikaRocket.tables") || "[]");
    const nextTables = [localTable, ...storedTables.filter((item) => item.id !== localTableId)];
    localStorage.setItem("anmikaRocket.users", JSON.stringify(nextUsers));
    localStorage.setItem("anmikaRocket.currentUserId", currentUser.id);
    localStorage.setItem("anmikaRocket.currentUser", JSON.stringify(humanUser));
    localStorage.setItem("anmikaRocket.tables", JSON.stringify(nextTables));
    if (selectedClubId()) localStorage.setItem(DEBUG_RETURN_CLUB_KEY, selectedClubId());
    const onlineSync = {
      enabled: true,
      transport: "socketio",
      tableId,
      localTableId,
      gameId,
      version: 0,
      resetRoom: Boolean(onlineGameState?.resetRoom),
      userId: currentUser.id,
      supabaseUrl: config.url,
      anonKey: config.anonKey,
      accessToken: state.accessToken,
      socketUrl: getGameServerUrl(),
      returnUrl: buildOnlineDebugReturnUrl(),
      lastServerState: null,
      lastSyncedAt: 0,
      autoReloadAfterLaunch: Boolean(launchOptions.autoReloadAfterLaunch),
      launchReloadKey: launchOptions.launchReloadKey || `${tableId}:${gameId}:launch`,
    };
    localStorage.setItem("anmikaRocket.onlineSync", JSON.stringify(onlineSync));
    window.name = JSON.stringify({
      type: "anmika-debug-table-launch",
      table: localTable,
      users: nextUsers,
      currentUser: humanUser,
      onlineSync,
    });
    log("デバッグ対局を開始します。", localTable);
    const tableHash = `#/table/${encodeURIComponent(localTableId)}`;
    const targetUrl =
      window.location.protocol === "file:"
        ? new URL(`../index.html${tableHash}`, window.location.href).href
        : `${window.location.origin}/${tableHash}`;
    markLaunchingTable(tableId);
    window.location.href = targetUrl;
  };
  const startDebugGame = async (tableId = selectedTableId()) => {
    tableId = requireTableId(normalizeRemoteTableId(tableId) || getStartableTableId(), "デバッグ対局開始");
    setActiveTableId(tableId);
    clearLocalUserLastHandFlagForTable(tableId);
    await clearOwnLastHandFlag(tableId).catch((error) => log("新規対局開始前のラス半解除をスキップしました。", rawErrorText(error)));
    let rows = [];
    await deactivateTableActiveGameState(tableId, "デバッグ新規対局開始前").catch(() => {});
    let onlineGameState = { game_id: newSocketGameId(tableId), version: 0, resetRoom: true };
    try {
      await rest("/rpc/shared_start_debug_table_game", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
      log("DBの対局開始RPCを実行しました。", { tableId });
    } catch (sharedError) {
      try {
        await rest("/rpc/start_debug_table_game", { method: "POST", body: JSON.stringify({ p_table_id: tableId }) });
        log("旧DBの対局開始RPCを実行しました。", { tableId });
      } catch (legacyError) {
        const sharedMissing = isMissingRpcError(sharedError, "shared_start_debug_table_game");
        const legacyMissing = isMissingRpcError(legacyError, "start_debug_table_game");
        const detail = `${rawErrorText(sharedError)}\n${rawErrorText(legacyError)}`;
        if (!sharedMissing && !legacyMissing) {
          log("DBの対局開始RPCに失敗しました。Socket.IO対局として続行します。", detail);
        } else {
          log("DBの対局開始RPCが未適用です。Socket.IO対局として続行します。", detail);
        }
        await rest("/tables?table_id=eq." + encodeURIComponent(tableId), {
          method: "PATCH",
          body: JSON.stringify({ status: "playing" }),
        }).catch((error) => log("卓ステータス更新はスキップしました。", rawErrorText(error)));
      }
    }
    rows = await loadSeats().catch((error) => {
      log("席情報の再取得に失敗しました。表示中の席情報で続行します。", rawErrorText(error));
      return getKnownSeats(tableId);
    });
    loadTables().catch((error) => log("卓一覧の再取得に失敗しました。対局開始は続行します。", rawErrorText(error)));
    state.onlineGameOpened = true;
    if (has("onlineGamePanel")) $("onlineGamePanel").classList.add("open");
    renderOnlineGamePanel();
    log("ゲームサーバーの起動状態を確認しています。");
    await waitForGameServerReady();
    log("Socket.IO対局を開始します。局面はNode.jsゲームサーバーのメモリで同期します。", onlineGameState);
    clearLaunchingTable();
    startLocalDebugMahjong(tableId, rows, onlineGameState);
  };
  const enterPlayingGame = async (tableId) => {
    tableId = requireTableId(normalizeRemoteTableId(tableId), "対局参加");
    setActiveTableId(tableId);
    clearLocalUserLastHandFlagForTable(tableId);
    await clearOwnLastHandFlag(tableId).catch((error) => log("対局参加前のラス半解除をスキップしました。", rawErrorText(error)));
    const rows = await loadSeats().catch((error) => {
      log("席情報の再取得に失敗しました。表示中の席情報で対局へ入ります。", rawErrorText(error));
      return getKnownSeats(tableId);
    });
    log("ゲームサーバーの起動状態を確認しています。");
    await waitForGameServerReady();
    clearLaunchingTable();
    const lastState = state.activeGameState?.table_id === tableId ? state.activeGameState?.state : null;
    const endedState = Boolean(lastState?.phase === "gameEnded" || (lastState?.handLog?.result && ["handEnded", "exhaustiveDraw"].includes(lastState?.phase)) || lastState?.finalResult || lastState?.handLog?.result?.finalResult);
    const gameId = newSocketGameId(tableId);
    if (endedState) await deactivateTableActiveGameState(tableId, "終了済み対局への再参加前").catch(() => {});
    startLocalDebugMahjong(tableId, rows, { game_id: gameId, version: 0, resetRoom: endedState });
  };
  const copyTableUrl = async () => {
    const text = $("tableUrl").textContent;
    if (!text || text === "なし") return;
    await copyText(text, "卓URLをコピーしました");
  };
  const isMissingClubRakeLogsTableError = (error) => {
    const raw = rawErrorText(error);
    return raw.includes("club_rake_logs") && (raw.includes("schema cache") || raw.includes("Could not find the table") || raw.includes("PGRST205"));
  };
  const clubRakeLogsMissingMessage = "レーキ履歴テーブルがまだSupabaseに作成されていません。\nsupabase/patch_club_rake_logs.sql を実行してください。";
  const restOptionalClubRakeLogs = async (path) => {
    try {
      return await rest(path);
    } catch (error) {
      if (isMissingClubRakeLogsTableError(error)) {
        log(clubRakeLogsMissingMessage, rawErrorText(error));
        return null;
      }
      throw error;
    }
  };
  const rakeAmountOf = (row) => roundToTenth(row?.rake_amount ?? row?.amount ?? 0);
  const fetchClubRakeRows = async (clubId) => {
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    const apiUrl = `${window.location.origin}/api/club-rake/${encodeURIComponent(clubId)}`;
    const response = await fetch(apiUrl, {
      headers: buildSafeAuthHeaders(),
      cache: "no-store",
    }).catch(() => null);
    if (response?.ok) {
      const data = await response.json();
      return data?.rows || [];
    }
    if (response && response.status !== 404) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error || "レーキ履歴の取得に失敗しました。");
    }
    return restOptionalClubRakeLogs("/club_rake_logs?select=*&club_id=eq." + encodeURIComponent(clubId) + "&order=created_at.desc");
  };
  const rakeTotalsByUser = (rows = []) => rows.reduce((totals, row) => {
    const userId = row.user_id || row.userId;
    if (!userId) return totals;
    totals[userId] = roundToTenth(Number(totals[userId] || 0) + rakeAmountOf(row));
    return totals;
  }, {});
  const rakeLogLabel = (row = {}) => {
    if (row.win_type === "tsumo") return "ツモ和了";
    if (row.win_type === "ron") return "ロン和了";
    if (Number(row.original_gain || 0) === 0 && Number(row.rake_percent || 0) === 0) return "開始時レーキ";
    return "レーキ";
  };
  const loadClubMembersForView = async (clubId) => {
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    try {
      const rows = await rest("/rpc/list_club_members_for_admin", { method: "POST", body: JSON.stringify({ p_club_id: clubId }) });
      return (rows || []).map((member) => ({
        ...member,
        users: {
          user_id: member.user_id,
          display_name: member.display_name,
          login_id: member.login_id,
          icon_url: member.icon_url || "",
        },
      }));
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("list_club_members_for_admin") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw error;
      return rest("/club_members?select=role,point_balance,joined_at,users(user_id,display_name,login_id,icon_url)&club_id=eq." + encodeURIComponent(clubId) + "&order=joined_at.asc");
    }
  };
  const loadClubStats = async () => {
    const clubId = selectedClubId();
    if (!clubId || !has("clubDetails")) return;
    const members = await loadClubMembersForView(clubId);
    const selectedClub = state.clubs.find((club) => club.club_id === clubId);
    const pointSummary = clubPointSummaryFromMembers(members);
    const adminCount = members.filter((member) => member.role === "admin").length;
    let totalRake = "管理者のみ";
    if (isAdmin()) {
      const rows = await fetchClubRakeRows(clubId);
      totalRake = rows ? `${formatPoint(rows.reduce((sum, row) => sum + rakeAmountOf(row), 0))} pt` : "未作成";
    }
    $("clubDetails").innerHTML = [
      `<strong>クラブID:</strong> ${selectedClub?.club_code || clubId}`,
      `<br><strong>内部ID:</strong> ${clubId}`,
      `<br><strong>あなたの権限:</strong> ${isAdmin() ? "管理者" : "メンバー"}`,
      `<br><strong>会員数:</strong> ${members.length}`,
      `<br><strong>管理者数:</strong> ${adminCount}`,
      `<br><strong>クラブポイント固定総量:</strong> ${formatPoint(pointSummary.fixedTotal)} pt`,
      `<br><strong>クラブ保管ポイント:</strong> ${formatPoint(pointSummary.clubReserve)} pt`,
      `<br><strong>メンバー保有ポイント合計:</strong> ${formatPoint(pointSummary.memberTotal)} pt`,
      `<br><strong>累積レーキ:</strong> ${totalRake}`,
    ].join("");
    document.body.dataset.role = isAdmin() ? "admin" : "member";
    renderDebug();
  };
  const loadRake = async () => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) {
      $("rakeSummary").textContent = "権限がありません。";
      $("rakeHistory").textContent = "";
      return;
    }
    const rows = await fetchClubRakeRows(clubId);
    if (!rows) {
      $("rakeSummary").textContent = "レーキ履歴: 未作成";
      $("rakeHistory").textContent = clubRakeLogsMissingMessage;
      return;
    }
    const total = roundToTenth(rows.reduce((sum, row) => sum + rakeAmountOf(row), 0));
    $("rakeSummary").textContent = "レーキ総額: " + formatPoint(total) + " pt";
    $("rakeHistory").textContent = JSON.stringify(rows, null, 2);
  };
  const ensureTsumoLossless3maCreateUi = () => {
    if (!has("ruleId")) return;
    const ruleSelect = $("ruleId");
    if (![...ruleSelect.options].some((option) => option.value === TSUMO_LOSSLESS_3MA_RULE_ID)) {
      const option = document.createElement("option");
      option.value = TSUMO_LOSSLESS_3MA_RULE_ID;
      option.textContent = TSUMO_LOSSLESS_3MA_LABEL;
      ruleSelect.append(option);
    }
    const settingsHost = has("tsumoLossless3maFields") ? $("tsumoLossless3maFields") : null;
    if (!has("tsumoLossless3maSettings") && settingsHost) {
      settingsHost.innerHTML = `
        <section id="tsumoLossless3maSettings" hidden>
          <h4>全赤三麻 詳細ルール</h4>
          <div class="row">
            <label>5p・5sの内訳
              <select id="threeMaFiveComposition">
                <option value="red3blue1">赤赤赤青</option>
                <option value="red4">赤赤赤赤</option>
                <option value="red2blue2">赤赤青青</option>
                <option value="blackBlackRedRed">黒黒赤赤</option>
              </select>
            </label>
            <label>華牌の構成
              <select id="threeMaFlowerComposition">
                <option value="red3blue1">赤赤赤青</option>
                <option value="red4">赤赤赤赤</option>
                <option value="red2blue2">赤赤青青</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label>開始時レーキ: <span id="threeMaEntryRakeValue">5.0</span>pt
              <input id="threeMaEntryRake" type="range" min="0.1" max="10" step="0.1" value="5.0" />
            </label>
            <label>ウマ
              <select id="threeMaUma">
                <option value="20-0--20">20-0-▲20</option>
                <option value="30-0--30">30-0-▲30</option>
                <option value="20-10--30">20-10-▲30</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label>祝儀価値
              <select id="threeMaChipValue">
                <option value="2000">2000点</option>
                <option value="5000" selected>5000点</option>
                <option value="10000">10000点</option>
              </select>
            </label>
            <label><input id="threeMaNorthNukiDora" type="checkbox" /> 北を抜きドラにする</label>
          </div>
        </section>
      `;
      if (has("threeMaEntryRake")) $("threeMaEntryRake").addEventListener("input", updateRangeLabels);
    }
    if (has("threeMaFiveComposition")) {
      const selected = $("threeMaFiveComposition").value || "red3blue1";
      $("threeMaFiveComposition").innerHTML = [
        ["red3blue1", "赤赤赤青"],
        ["red4", "赤赤赤赤"],
        ["red2blue2", "赤赤青青"],
        ["blackBlackRedRed", "黒黒赤赤"],
      ].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
      $("threeMaFiveComposition").value = ["red3blue1", "red4", "red2blue2", "blackBlackRedRed"].includes(selected) ? selected : "red3blue1";
    }
    if (has("threeMaFlowerComposition")) {
      const selected = $("threeMaFlowerComposition").value || "red3blue1";
      $("threeMaFlowerComposition").innerHTML = [
        ["red3blue1", "赤赤赤青"],
        ["red4", "赤赤赤赤"],
        ["red2blue2", "赤赤青青"],
      ].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
      $("threeMaFlowerComposition").value = ["red3blue1", "red4", "red2blue2"].includes(selected) ? selected : "red3blue1";
    }
  };
  const selectedCreateRuleId = () => (has("ruleId") ? $("ruleId").value : "anmika-rocket");
  const isTsumoLossless3maSelected = () => selectedCreateRuleId() === TSUMO_LOSSLESS_3MA_RULE_ID;
  const readAnmikaRuleConfig = () => ({
    rocket19Enabled: has("rocket19Enabled") ? $("rocket19Enabled").checked : true,
    baibaEnabled: has("baibaEnabled") ? $("baibaEnabled").checked : true,
    otokogiEnabled: has("otokogiEnabled") ? $("otokogiEnabled").checked : true,
    feverRiichiEnabled: has("feverRiichiEnabled") ? $("feverRiichiEnabled").checked : true,
    turquoise5pCount: has("turquoise5pCount") ? Number($("turquoise5pCount").value || 2) : 2,
  });
  const readTsumoLossless3maRuleConfig = () => ({
    fiveTileComposition: has("threeMaFiveComposition") ? $("threeMaFiveComposition").value : "red3blue1",
    flowerComposition: has("threeMaFlowerComposition") ? $("threeMaFlowerComposition").value : "red3blue1",
    entryRakePoints: has("threeMaEntryRake") ? Number($("threeMaEntryRake").value || 5) : 5,
    pointRateUnit: "per1000",
    northNukiDoraEnabled: has("threeMaNorthNukiDora") ? $("threeMaNorthNukiDora").checked : false,
    umaType: has("threeMaUma") ? $("threeMaUma").value : "20-0--20",
    chipValuePoints: has("threeMaChipValue") ? Number($("threeMaChipValue").value || 5000) : 5000,
    startingScore: 35000,
    rounds: ["east1", "east2", "east3", "south1", "south2", "south3"],
    noTsumoLoss: true,
    settlementTiming: "hanchan",
    disabledSpecialRules: ["otokogi", "rocket19", "feverRiichi"],
  });
  const readCreateTableRuleConfig = () => (
    isTsumoLossless3maSelected() ? readTsumoLossless3maRuleConfig() : readAnmikaRuleConfig()
  );
  const parseRuleConfig = (value) => {
    if (!value) return {};
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value;
  };
  const formatRuleSummary = (table) => {
    const ruleId = table.rule_id || "anmika-rocket";
    const configValue = parseRuleConfig(table.rule_config);
    if (ruleId !== TSUMO_LOSSLESS_3MA_RULE_ID) {
      const onOff = (value) => value ? "ON" : "OFF";
      return [
        `レート: 1点 = ${Number(table.point_rate || 1).toFixed(1)}pt`,
        `レーキ: ${table.rake_percent ?? 0}%`,
        `1・9牌ロケット ${onOff(Boolean(configValue.rocket19Enabled))}`,
        `倍場 ${onOff(Boolean(configValue.baibaEnabled))}`,
        `フィーバーリーチ ${onOff(Boolean(configValue.feverRiichiEnabled))}`,
        `男気ルール ${onOff(configValue.otokogiEnabled !== false)}`,
        `ターコイズ5p ${Number(configValue.turquoise5pCount ?? 0)}枚`,
      ].join(" / ");
    }
    const entryRake = Number(table.entry_rake_points ?? configValue.entryRakePoints ?? 5).toFixed(1);
    const chip = Number(configValue.chipValuePoints || 5000).toLocaleString();
    const umaLabel = String(configValue.umaType || "20-0--20").replace("--", "-▲");
    const fiveLabel = { red3blue1: "赤赤赤青", red4: "赤赤赤赤", red2blue2: "赤赤青青", blackBlackRedRed: "黒黒赤赤" }[configValue.fiveTileComposition || "red3blue1"];
    const flowerLabel = { red3blue1: "赤赤赤青", red4: "赤赤赤赤", red2blue2: "赤赤青青" }[configValue.flowerComposition || "red3blue1"];
    return [
      `レート: 1000点 = ${Number(table.point_rate || 1).toFixed(1)}pt`,
      `開始時レーキ: ${entryRake}pt`,
      `5の内訳: ${fiveLabel}`,
      `華牌: ${flowerLabel}`,
      `祝儀: ${chip}点相当`,
      `ウマ: ${umaLabel}`,
      configValue.northNukiDoraEnabled ? "北抜きON" : "北抜きOFF",
    ].join(" / ");
  };
  const updateRangeLabels = () => {
    ensureTsumoLossless3maCreateUi();
    const tsumoLossless3ma = isTsumoLossless3maSelected();
    const anmikaRow = has("turquoise5pCount") ? $("turquoise5pCount").closest(".row") : null;
    if (anmikaRow) {
      anmikaRow.hidden = tsumoLossless3ma;
      anmikaRow.style.display = tsumoLossless3ma ? "none" : "";
      if (anmikaRow.previousElementSibling?.tagName === "H4") anmikaRow.previousElementSibling.hidden = tsumoLossless3ma;
      if (anmikaRow.previousElementSibling?.tagName === "H4") anmikaRow.previousElementSibling.style.display = tsumoLossless3ma ? "none" : "";
    }
    ["rocket19Enabled", "baibaEnabled", "otokogiEnabled", "feverRiichiEnabled", "turquoise5pCount"].forEach((id) => {
      if (!has(id)) return;
      const wrapper = $(id).closest("label");
      if (!wrapper) return;
      wrapper.hidden = tsumoLossless3ma;
      wrapper.style.display = tsumoLossless3ma ? "none" : "";
    });
    if (has("tsumoLossless3maSettings")) $("tsumoLossless3maSettings").hidden = !tsumoLossless3ma;
    if (has("tsumoLossless3maSettings")) $("tsumoLossless3maSettings").style.display = tsumoLossless3ma ? "" : "none";
    if (has("rakePercent")) {
      const rakeLabel = $("rakePercent").closest("label");
      if (rakeLabel) {
        rakeLabel.hidden = tsumoLossless3ma;
        rakeLabel.style.display = tsumoLossless3ma ? "none" : "";
      }
    }
    if (has("pointRate")) {
      const pointRateLabel = $("pointRate").closest("label");
      if (pointRateLabel?.childNodes?.length) {
        pointRateLabel.childNodes[0].textContent = tsumoLossless3ma ? "レート: 1000点 = " : "レート: 1点 = ";
      }
    }
    if (has("pointRateValue") && has("pointRate")) $("pointRateValue").textContent = Number($("pointRate").value || 1).toFixed(1);
    if (has("rakePercentValue") && has("rakePercent")) $("rakePercentValue").textContent = Number($("rakePercent").value || 0).toFixed(1);
    if (has("threeMaEntryRakeValue") && has("threeMaEntryRake")) $("threeMaEntryRakeValue").textContent = Number($("threeMaEntryRake").value || 5).toFixed(1);
  };
  const toggleSettings = async () => {
    if (!has("settingsDrawer")) return;
    uiLog("gear clicked");
    const drawer = $("settingsDrawer");
    drawer.classList.toggle("open");
    drawer.style.display = drawer.classList.contains("open") ? "grid" : "";
    if (drawer.classList.contains("open")) await loadClubStats().catch(() => {});
  };
  const renderClubPointsPage = async (body) => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    const members = await loadClubMembersForView(clubId);
    const rakeRows = await fetchClubRakeRows(clubId).catch((error) => {
      log("レーキ支払い集計の取得をスキップしました。", rawErrorText(error));
      return [];
    });
    const paidRakeByUser = rakeTotalsByUser(rakeRows);
    const pointSummary = clubPointSummaryFromMembers(members);
    const visibleMembers = members.filter((member) => isAdmin() || member.users?.user_id === requireUser().id);
    body.innerHTML = `
      <p class="muted">${isAdmin() ? "管理者用: クラブ保管ポイントの送信・回収ができます。" : "自分のポイントを確認できます。"}</p>
      <div class="card">
        <div class="point-reserve">
          <span class="muted">クラブ側の保有ポイント</span>
          <strong>${formatPoint(pointSummary.clubReserve)} pt</strong>
        </div>
        <span>クラブポイント固定総量: ${formatPoint(pointSummary.fixedTotal)} pt</span><br>
        <span>メンバー保有ポイント合計: ${formatPoint(pointSummary.memberTotal)} pt</span><br>
        <span class="muted">送る・回収では支払う側がマイナスになる操作はできません。ゲーム結果によるマイナスとは別扱いです。</span>
      </div>
      <div id="settingsPointUserRows" class="point-user-list"></div>
    `;
    const container = document.getElementById("settingsPointUserRows");
    visibleMembers.forEach((member) => {
      const userId = member.users?.user_id || "";
      const name = member.users?.display_name || userId || "Player";
      const paidRake = roundToTenth(paidRakeByUser[userId] || 0);
      const row = document.createElement("div");
      row.className = "point-user-row";
      row.innerHTML = `<strong>${name}</strong><span>${formatPoint(member.point_balance)} pt</span><span>支払レーキ ${formatPoint(paidRake)} pt</span>${isAdmin() ? '<button type="button" data-action="send">送る</button><button type="button" data-action="collect" class="secondary">回収</button>' : ""}`;
      const sendButton = row.querySelector('[data-action="send"]');
      if (sendButton) {
        sendButton.addEventListener("click", async () => {
          try {
            const amount = readPointAmount(prompt(`${name}へ送るポイント数`, "100"), "送信ポイント");
            if (pointSummary.clubReserve < amount) throw new Error("クラブ保管ポイントが不足しています。");
            await rest("/rpc/admin_grant_club_points", {
              method: "POST",
              body: JSON.stringify({ p_club_id: clubId, p_to_user_id: userId, p_amount: amount }),
            });
            await renderClubPointsPage(body);
          } catch (error) {
            showError("ポイント送信に失敗しました", error);
          }
        });
      }
      const collectButton = row.querySelector('[data-action="collect"]');
      if (collectButton) {
        collectButton.addEventListener("click", async () => {
          try {
            const amount = readPointAmount(prompt(`${name}から回収するポイント数`, "100"), "回収ポイント");
            if (Number(member.point_balance || 0) < amount) throw new Error("対象プレイヤーのポイントが不足しています。回収で残高をマイナスにはできません。");
            await rest("/rpc/admin_collect_club_points", {
              method: "POST",
              body: JSON.stringify({ p_club_id: clubId, p_from_user_id: userId, p_amount: amount }),
            });
            await renderClubPointsPage(body);
          } catch (error) {
            showError("ポイント回収に失敗しました", error);
          }
        });
      }
      container.append(row);
    });
  };
  const pointReasonLabel = (reason) => {
    const labels = {
      game_settlement: "対局精算",
      game_win: "対局収入",
      game_loss: "対局支払い",
      rake: "レーキ",
      rake_payment: "レーキ",
      tip: "祝儀",
      fly_bonus: "飛び賞",
    };
    return labels[reason] || reason || "対局収支";
  };
  const isGamePointReason = (reason) => {
    const value = String(reason || "").toLowerCase();
    if (["admin_grant", "admin_collect", "user_transfer"].includes(value)) return false;
    return (
      value.includes("game") ||
      value.includes("settlement") ||
      value.includes("rake") ||
      value.includes("tip") ||
      value.includes("bonus") ||
      value.includes("mahjong") ||
      value === "対局精算" ||
      value === "レーキ" ||
      value === "祝儀" ||
      value === "飛び賞"
    );
  };
  const renderPointHistoryChart = (series) => {
    const width = 720;
    const height = 280;
    const pad = { left: 58, right: 24, top: 22, bottom: 44 };
    const values = [0, ...series.map((item) => roundToTenth(item.cumulative))];
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = Math.max(1, maxValue - minValue);
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const xFor = (index) => pad.left + (series.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (series.length - 1));
    const yFor = (value) => pad.top + chartHeight - ((value - minValue) / range) * chartHeight;
    const zeroY = yFor(0);
    const points = series.map((item, index) => `${xFor(index).toFixed(1)},${yFor(item.cumulative).toFixed(1)}`).join(" ");
    const circles = series
      .map((item, index) => `<circle cx="${xFor(index).toFixed(1)}" cy="${yFor(item.cumulative).toFixed(1)}" r="4"><title>${escapeHtml(item.dateLabel)} ${formatSignedPoint(item.amount)}pt / 累計 ${formatPoint(item.cumulative)}pt</title></circle>`)
      .join("");
    return `
      <svg class="point-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="ゲーム収支の折れ線グラフ">
        <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="rgba(255,255,255,.06)"></rect>
        <line x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${width - pad.right}" y2="${zeroY.toFixed(1)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="5 5"></line>
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="rgba(255,255,255,.35)"></line>
        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="rgba(255,255,255,.35)"></line>
        <text x="10" y="${yFor(maxValue).toFixed(1)}" fill="rgba(255,255,255,.78)" font-size="13">${formatPoint(maxValue)}pt</text>
        <text x="10" y="${yFor(minValue).toFixed(1)}" fill="rgba(255,255,255,.78)" font-size="13">${formatPoint(minValue)}pt</text>
        <text x="${pad.left}" y="${height - 14}" fill="rgba(255,255,255,.7)" font-size="13">${escapeHtml(series[0]?.dateLabel || "")}</text>
        <text x="${width - pad.right}" y="${height - 14}" fill="rgba(255,255,255,.7)" font-size="13" text-anchor="end">${escapeHtml(series[series.length - 1]?.dateLabel || "")}</text>
        <polyline points="${points}" fill="none" stroke="#56d8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
        <g fill="#ffffff" stroke="#56d8ff" stroke-width="2">${circles}</g>
      </svg>
    `;
  };
  const renderPointHistoryPage = async (body) => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    try {
      const user = requireUser();
      let rows;
      try {
        rows = await rest("/rpc/get_my_club_point_history", { method: "POST", body: JSON.stringify({ p_club_id: clubId }) });
      } catch (error) {
        const raw = rawErrorText(error);
        if (!raw.includes("get_my_club_point_history") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw error;
        rows = await rest("/club_points?select=*&club_id=eq." + encodeURIComponent(clubId) + "&order=created_at.asc&limit=500");
      }
      const gameRows = (rows || [])
        .filter((row) => {
          const rowUserId = row.user_id || row.userId || row.actor_user_id || row.actorUserId;
          const isMine = !rowUserId || rowUserId === user.id;
          return isMine && (isGamePointReason(row.reason) || Boolean(row.game_id || row.gameId));
        })
        .sort((a, b) => new Date(a.created_at || a.createdAt || 0).getTime() - new Date(b.created_at || b.createdAt || 0).getTime());
      const rakeRows = (await fetchClubRakeRows(clubId).catch((error) => {
        log("自分のレーキ履歴取得をスキップしました。", rawErrorText(error));
        return [];
      })).filter((row) => (row.user_id || row.userId) === user.id);
      const paidRakeTotal = roundToTenth(rakeRows.reduce((sum, row) => sum + rakeAmountOf(row), 0));
      const rakeHistoryHtml = rakeRows.length
        ? `<section class="card">
            <h4>支払レーキ</h4>
            <div class="point-summary"><strong>合計: ${formatPoint(paidRakeTotal)} pt</strong><span>対象件数: ${rakeRows.length}件</span></div>
            ${rakeRows.slice(0, 50).map((row) => `
              <div class="table-seat-line">
                <span>${escapeHtml(new Date(row.created_at || row.createdAt || Date.now()).toLocaleString())}</span>
                <strong>${formatPoint(rakeAmountOf(row))} pt</strong>
                <span>${escapeHtml(rakeLogLabel(row))}</span>
                <span class="muted">元収入 ${formatPoint(row.original_gain || 0)} / ${formatPoint(row.rake_percent || 0)}%</span>
              </div>`).join("")}
          </section>`
        : `<section class="card"><h4>支払レーキ</h4><p class="muted">支払レーキはまだありません。</p></section>`;
      if (!gameRows.length) {
        body.innerHTML = `
          <section class="card">
            <h4>ゲーム収支グラフ</h4>
            <p class="muted">ゲーム由来のポイント収支はまだありません。</p>
            <p class="muted">管理者の送る・回収、ユーザー間送信はこの画面では集計しません。</p>
          </section>
          ${rakeHistoryHtml}`;
        return;
      }
      let cumulative = 0;
      const series = gameRows.map((row) => {
        const amount = roundToTenth(row.amount || 0);
        cumulative = roundToTenth(cumulative + amount);
        const createdAt = row.created_at || row.createdAt || Date.now();
        return {
          amount,
          cumulative,
          reason: row.reason,
          dateLabel: new Date(createdAt).toLocaleDateString(),
          dateTimeLabel: new Date(createdAt).toLocaleString(),
        };
      });
      body.innerHTML = `
        <section class="card">
          <h4>ゲーム収支グラフ</h4>
          <p class="muted">自分の対局精算・レーキ・祝儀など、ゲーム上で発生したポイントだけを累積表示しています。</p>
          <p class="muted">管理者の送る・回収、ユーザー間送信は除外しています。</p>
          <div class="point-summary">
            <strong>累計収支: ${formatSignedPoint(cumulative)} pt</strong>
            <span>対象件数: ${series.length}件</span>
            <span>支払レーキ合計: ${formatPoint(paidRakeTotal)} pt</span>
          </div>
          ${renderPointHistoryChart(series)}
        </section>
        ${rakeHistoryHtml}
        <section class="card">
          <h4>対象履歴</h4>
          ${series
            .slice()
            .reverse()
            .map((row) => `
              <div class="table-seat-line">
                <span>${escapeHtml(row.dateTimeLabel)}</span>
                <strong>${formatSignedPoint(row.amount)} pt</strong>
                <span>${escapeHtml(pointReasonLabel(row.reason))}</span>
                <span class="muted">累計 ${formatSignedPoint(row.cumulative)} pt</span>
              </div>`)
            .join("")}
        </section>`;
    } catch (error) {
      body.innerHTML = `<p class="muted">ポイント履歴テーブルはまだ連携されていません。</p><pre>${getErrorText(error)}</pre>`;
    }
  };
  const statPayload = (row) => row?.stat_payload || row?.statPayload || {};
  const statNumber = (value) => {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
  };
  const statPercent = (value, total) => total > 0 ? `${(statNumber(value) / total * 100).toFixed(1)}%` : "-";
  const statSigned = (value, unit = "") => {
    const numeric = roundToTenth(value);
    const text = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
    return `${numeric >= 0 ? "+" : ""}${text}${unit}`;
  };
  const statRowHtml = (label, value) => `<div class="table-seat-line"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`;
  const fetchMyReplayStats = async (clubId = selectedClubId()) => {
    const user = requireUser();
    if (!clubId) throw new Error("スタッツを見るクラブを選択してください。");
    const clubFilter = `&club_id=eq.${encodeURIComponent(clubId)}`;
    try {
      return await rest(`/player_replay_stats?select=*&user_id=eq.${encodeURIComponent(user.id)}&is_cpu=eq.false${clubFilter}&order=created_at.asc&limit=5000`);
    } catch (error) {
      const raw = rawErrorText(error);
      if (raw.includes("player_replay_stats") || raw.includes("schema cache") || raw.includes("Could not find the table")) {
        throw new Error("スタッツ集計テーブルが未作成です。supabase/patch_player_replay_stats.sql を実行してください。");
      }
      throw error;
    }
  };
  const aggregateHandStats = (rows) => rows.reduce((stats, row) => {
    const payload = statPayload(row);
    const handCount = Math.max(0, statNumber(row.hand_count || 1));
    const savedCallHands = payload.handWithCallCount ?? payload.hand_with_call_count;
    const fallbackCallHands = Math.max(0, statNumber(row.call_count) - statNumber(payload.nukiDoraCount ?? payload.nuki_dora_count ?? 0));
    const callHands = savedCallHands === undefined || savedCallHands === null
      ? (fallbackCallHands > 0 ? Math.min(fallbackCallHands, handCount) : 0)
      : Math.min(Math.max(0, statNumber(savedCallHands)), handCount);
    const savedRiichiHands = payload.handWithRiichiCount ?? payload.hand_with_riichi_count;
    const riichiHands = savedRiichiHands === undefined || savedRiichiHands === null
      ? (statNumber(row.riichi_count) > 0 ? Math.min(statNumber(row.riichi_count), handCount) : 0)
      : Math.min(Math.max(0, statNumber(savedRiichiHands)), handCount);
    stats.hands += handCount;
    stats.scoreDelta += statNumber(row.score_delta);
    stats.wins += statNumber(row.win_count);
    stats.dealIns += statNumber(payload.dealInCount ?? payload.deal_in_count ?? 0);
    stats.callHands += callHands;
    stats.riichiHands += riichiHands;
    return stats;
  }, { hands: 0, scoreDelta: 0, wins: 0, dealIns: 0, callHands: 0, riichiHands: 0 });
  const renderStatsPage = async (body) => {
    try {
      const clubId = selectedClubId();
      const selectedClub = state.clubs.find((club) => club.club_id === clubId) || selectedMembership()?.clubs || null;
      const rows = await fetchMyReplayStats(clubId);
      const anmikaRows = rows.filter((row) => row.rule_id !== TSUMO_LOSSLESS_3MA_RULE_ID && row.scope !== "hanchan");
      const anmika = aggregateHandStats(anmikaRows);
      const allRedHanchans = rows.filter((row) => row.rule_id === TSUMO_LOSSLESS_3MA_RULE_ID && row.scope === "hanchan");
      const allRedHandRows = rows.filter((row) => row.rule_id === TSUMO_LOSSLESS_3MA_RULE_ID && row.scope !== "hanchan");
      const allRedHands = aggregateHandStats(allRedHandRows.length ? allRedHandRows : allRedHanchans);
      const allRedHalfCount = allRedHanchans.length;
      const rankCounts = { 1: 0, 2: 0, 3: 0 };
      let tobiCount = 0;
      let allRedScoreDelta = 0;
      allRedHanchans.forEach((row) => {
        const payload = statPayload(row);
        const rank = Number(payload.hanchanRank || payload.rank || 0);
        if (rankCounts[rank] !== undefined) rankCounts[rank] += 1;
        if (payload.isTobi === true || payload.isTobi === "true" || statNumber(row.final_score) <= 0) tobiCount += 1;
        allRedScoreDelta += statNumber(row.final_score) - 35000;
      });
      body.innerHTML = `
        <p class="muted">現在のクラブ: ${escapeHtml(selectedClub?.name || selectedClub?.club_code || clubId)}</p>
        <section class="card">
          <h4>アンミカロケット</h4>
          ${statRowHtml("総局数（局）", `${anmika.hands}局`)}
          ${statRowHtml("平均収支（点）", anmika.hands ? statSigned(anmika.scoreDelta / anmika.hands, "点") : "-")}
          ${statRowHtml("和了率（％）", statPercent(anmika.wins, anmika.hands))}
          ${statRowHtml("放銃率（％）", statPercent(anmika.dealIns, anmika.hands))}
          ${statRowHtml("副露率（％）", statPercent(anmika.callHands, anmika.hands))}
          ${statRowHtml("リーチ率（％）", statPercent(anmika.riichiHands, anmika.hands))}
        </section>
        <section class="card">
          <h4>全赤三麻</h4>
          ${statRowHtml("半荘数（半荘）", `${allRedHalfCount}半荘`)}
          ${statRowHtml("1着率（％）", statPercent(rankCounts[1], allRedHalfCount))}
          ${statRowHtml("2着率（％）", statPercent(rankCounts[2], allRedHalfCount))}
          ${statRowHtml("3着率（％）", statPercent(rankCounts[3], allRedHalfCount))}
          ${statRowHtml("飛び率（％）", statPercent(tobiCount, allRedHalfCount))}
          ${statRowHtml("平均収支（pt）", allRedHalfCount ? statSigned((allRedScoreDelta / allRedHalfCount) / 1000, "pt") : "-")}
          ${statRowHtml("和了率（％）", statPercent(allRedHands.wins, allRedHands.hands))}
          ${statRowHtml("放銃率（％）", statPercent(allRedHands.dealIns, allRedHands.hands))}
          ${statRowHtml("副露率（％）", statPercent(allRedHands.callHands, allRedHands.hands))}
          ${statRowHtml("リーチ率（％）", statPercent(allRedHands.riichiHands, allRedHands.hands))}
        </section>
        <p class="muted">スタッツは保存済み牌譜から集計します。古い牌譜では放銃率や副露局数など一部が未記録の場合があります。</p>
      `;
    } catch (error) {
      body.innerHTML = `<p class="muted">スタッツの取得に失敗しました。</p><pre>${getErrorText(error)}</pre>`;
    }
  };
  const renderDeletePointLogsPage = async (body) => {
    if (!isSuperClubCreator()) {
      body.innerHTML = `<p class="muted">このログを見られるのは特権アカウントだけです。</p>`;
      return;
    }
    try {
      const rows = await rest("/club_delete_point_logs?select=*&order=created_at.desc&limit=300");
      const grouped = new Map();
      (rows || []).forEach((row) => {
        const key = row.deleted_club_id || row.log_id;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
      });
      if (!rows?.length) {
        body.innerHTML = `<section class="card"><h4>削除ログ</h4><p class="muted">クラブ削除ログはまだありません。</p></section>`;
        return;
      }
      body.innerHTML = [...grouped.entries()].map(([, group]) => {
        const head = group[0] || {};
        const memberRows = group.filter((row) => row.entry_type === "member_balance");
        const reserveRow = group.find((row) => row.entry_type === "club_reserve") || head;
        return `
          <section class="card">
            <h4>${escapeHtml(head.club_name || "削除済みクラブ")}</h4>
            <p class="muted">
              削除日時: ${escapeHtml(new Date(head.created_at || Date.now()).toLocaleString())}<br>
              クラブID: ${escapeHtml(head.deleted_club_id || "")}<br>
              クラブコード: ${escapeHtml(head.club_code || "")}<br>
              削除者: ${escapeHtml(head.deleted_by || "")}<br>
              クラブ保管ポイント: ${formatPoint(reserveRow.club_reserve_balance || 0)} pt
            </p>
            ${memberRows.map((row) => `
              <div class="table-seat-line">
                <span>${escapeHtml(row.member_name || row.member_user_id || "不明")}</span>
                <strong>${formatPoint(row.point_balance || 0)} pt</strong>
                <span>${escapeHtml(row.member_role || "")}</span>
                <span class="muted">${escapeHtml(row.member_user_id || "")}</span>
              </div>
            `).join("") || `<p class="muted">メンバー残高ログなし</p>`}
          </section>
        `;
      }).join("");
    } catch (error) {
      body.innerHTML = `<p class="muted">削除ログを取得できませんでした。supabase/patch_delete_club_for_admin.sql を実行してください。</p><pre>${getErrorText(error)}</pre>`;
    }
  };
  const replayRuleName = (summary = {}) => {
    const ruleId = summary.ruleId || summary.rule_id || summary.gameType || "";
    if (ruleId === "tsumo-lossless-3ma") return "全赤三麻";
    if (ruleId === "anmika-rocket") return "アンミカロケット";
    return summary.ruleName || summary.rule_name || ruleId || "ルール不明";
  };
  const replayResultSummary = (summary = {}) => {
    if (summary.resultSummary) return summary.resultSummary;
    const result = summary.result || summary.finalResult || {};
    if (result.label) return result.label;
    if (summary.resultLabel) return summary.resultLabel;
    const payments = result.payments || result.pointPayments || summary.payments || {};
    const entries = Object.entries(payments).filter(([, value]) => Number(value));
    if (entries.length) {
      return entries.map(([name, value]) => `${name} ${Number(value) > 0 ? "+" : ""}${value}`).join(" / ");
    }
    return summary.roundLabel || summary.scope || "結果未記録";
  };
  const replayPlayersText = (summary = {}) => asArray(summary.players)
    .map((player) => player.name || player.displayName || player.id)
    .filter(Boolean)
    .join(" / ") || "対局者不明";
  const replayOpenUrl = (replayId) => {
    const encoded = encodeURIComponent(replayId);
    if (window.location.protocol === "file:") return `../replay.html#/replay/${encoded}`;
    return `${window.location.origin}/replay/${encoded}`;
  };
  const makeReplayWallPlaceholders = (prefix, count) =>
    Array.from({ length: Math.max(0, Number(count || 0)) }, (_, index) => ({ id: `${prefix}-${index}`, hidden: true }));
  const pickReplaySnapshotsForCache = (snapshots = [], maxSnapshots = 80) => {
    const list = asArray(snapshots).filter(Boolean);
    if (maxSnapshots <= 0) return [];
    if (list.length <= maxSnapshots) return list;
    if (maxSnapshots === 1) return [list[0]];
    const picked = [];
    const lastIndex = list.length - 1;
    for (let index = 0; index < maxSnapshots; index += 1) {
      picked.push(list[Math.round((lastIndex * index) / (maxSnapshots - 1))]);
    }
    return picked;
  };
  const compactReplaySnapshotForCache = (snapshot) => {
    if (!snapshot) return snapshot;
    return {
      ...snapshot,
      liveWall: makeReplayWallPlaceholders("live-wall", snapshot.liveWall?.length ?? 0),
      rinshanWall: makeReplayWallPlaceholders("rinshan-wall", snapshot.rinshanWall?.length ?? 0),
      pendingAction: null,
      handLog: snapshot.handLog ? { ...snapshot.handLog, events: [] } : snapshot.handLog,
      replaySnapshots: undefined,
    };
  };
  const compactReplayForViewerCache = (replay, maxSnapshots = 80) => {
    const snapshots = pickReplaySnapshotsForCache(replay.snapshots?.length ? replay.snapshots : [replay.initialState].filter(Boolean), maxSnapshots)
      .map(compactReplaySnapshotForCache);
    const initialState = compactReplaySnapshotForCache(replay.initialState || snapshots[0]);
    return {
      ...replay,
      initialState,
      snapshots,
      events: maxSnapshots < 10 ? asArray(replay.events).slice(-Math.max(0, maxSnapshots)) : asArray(replay.events),
      simpleReplay: replay.simpleReplay || {
        format: "anmika-simple-replay-v1",
        initialState,
        events: asArray(replay.events),
        result: replay.initialState?.handLog?.result || null,
      },
    };
  };
  const saveReplayForViewerCache = (replay) => {
    const key = "anmikaRocket.replays";
    const replayId = replay.replayId || replay.summary?.replayId;
    const snapshotLimits = [160, 120, 80, 40, 20, 8, 2, 1, 0];
    const current = (() => {
      try { return asArray(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return []; }
    })();
    const oldSummaries = current
      .filter((item) => (item.replayId || item.summary?.replayId) !== replayId)
      .map((item) => ({
        replayId: item.replayId || item.summary?.replayId,
        summary: item.summary || {},
        initialState: null,
        events: [],
        snapshots: [],
      }))
      .filter((item) => item.replayId);
    for (const snapshotLimit of snapshotLimits) {
      const compactReplay = compactReplayForViewerCache(replay, snapshotLimit);
      const candidates = [
        [compactReplay, ...oldSummaries.slice(0, 20)],
        [compactReplay, ...oldSummaries.slice(0, 5)],
        [compactReplay],
      ];
      for (const candidate of candidates) {
        try {
          localStorage.setItem(key, JSON.stringify(candidate));
          return compactReplay;
        } catch (error) {
          if (!String(error?.name || error?.message || error).includes("Quota")) continue;
        }
      }
    }
    try { localStorage.removeItem(key); } catch {}
    const minimalReplay = compactReplayForViewerCache({ ...replay, snapshots: [] }, 0);
    localStorage.setItem(key, JSON.stringify([minimalReplay]));
    return minimalReplay;
  };
  const cacheReplayForViewer = async (replayId) => {
    if (!replayId) throw new Error("牌譜IDがありません。");
    let rows;
    try {
      const serverResponse = await fetch(`${window.location.origin}/api/replay/${encodeURIComponent(replayId)}`, {
        headers: buildSafeAuthHeaders(),
        cache: "no-store",
      }).catch(() => null);
      if (serverResponse?.ok) {
        const data = await serverResponse.json();
        rows = data?.replay ? [data.replay] : [];
      } else {
        rows = await rest("/rpc/get_my_replay", { method: "POST", body: JSON.stringify({ p_replay_id: replayId }) });
      }
    } catch (error) {
      const raw = rawErrorText(error);
      if (!raw.includes("get_my_replay") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw error;
      rows = await rest(`/replays?select=replay_id,club_id,table_id,game_id,summary,initial_state,events,snapshots,created_at&replay_id=eq.${encodeURIComponent(replayId)}&limit=1`);
    }
    const row = asArray(rows)[0];
    if (!row?.replay_id && !row?.id) throw new Error("牌譜本体を取得できませんでした。");
    const id = row.replay_id || row.id;
    const replay = {
      replayId: id,
      summary: {
        ...(row.summary || {}),
        replayId: id,
        replayUrl: replayOpenUrl(id),
        clubId: row.club_id || row.summary?.clubId,
        tableId: row.table_id || row.summary?.tableId,
        gameId: row.game_id || row.summary?.gameId,
        endedAt: row.summary?.endedAt || Date.parse(row.created_at || "") || Date.now(),
      },
      initialState: row.initial_state,
      events: row.events || [],
      snapshots: row.snapshots || [],
      simpleReplay: row.summary?.replayFormat === "anmika-simple-replay-v1" ? {
        format: "anmika-simple-replay-v1",
        initialState: row.initial_state,
        events: row.events || [],
        result: row.initial_state?.handLog?.result || null,
      } : row.summary?.simpleReplay || null,
    };
    return saveReplayForViewerCache(replay);
  };
  const renderReplayListPage = async (body) => {
    try {
      let rows;
      try {
        rows = await rest("/rpc/get_my_replays", { method: "POST", body: JSON.stringify({}) });
      } catch (error) {
        const raw = rawErrorText(error);
        if (!raw.includes("get_my_replays") && !raw.includes("schema cache") && !raw.includes("Could not find the function")) throw error;
        rows = await rest("/replays?select=replay_id,club_id,table_id,game_id,summary,created_at&order=created_at.desc&limit=100");
      }
      rows = asArray(rows).slice(0, 100);
      if (!rows.length) {
        body.innerHTML = `
          <p class="muted">牌譜はまだありません。</p>
          <p class="muted">対局終了時に保存されます。対局後も増えない場合は、ゲームサーバー側の Supabase 書き込み設定を確認してください。</p>
        `;
        return;
      }
      body.innerHTML = `<p class="muted">クラブに関係なく、このアカウントで取得できる直近100本を表示しています。</p>` + rows
        .map((row) => {
          const replayId = row.replay_id || row.id;
          const summary = row.summary || {};
          return `<div class="table-seat-line replay-list-row">
            <strong>${new Date(row.created_at || summary.endedAt || Date.now()).toLocaleString()}</strong>
            <span>${escapeHtml(replayRuleName(summary))}</span>
            <span>${escapeHtml(replayPlayersText(summary))}</span>
            <span>${escapeHtml(replayResultSummary(summary))}</span>
            <button type="button" data-replay-id="${escapeHtml(replayId)}">再生</button>
            <button type="button" class="secondary" data-copy-replay-url="${escapeHtml(replayId)}">URLコピー</button>
          </div>`;
        })
        .join("");
      body.querySelectorAll("[data-replay-id]").forEach((button) => {
        button.addEventListener("click", async () => {
          const replayId = button.dataset.replayId;
          button.disabled = true;
          const previousText = button.textContent;
          button.textContent = "読み込み中...";
          try {
            await cacheReplayForViewer(replayId);
            window.location.href = replayOpenUrl(replayId);
          } catch (error) {
            button.disabled = false;
            button.textContent = previousText;
            body.insertAdjacentHTML("afterbegin", `<p class="error-box visible">牌譜本体の取得に失敗しました: ${escapeHtml(getErrorText(error))}</p>`);
          }
        });
      });
      body.querySelectorAll("[data-copy-replay-url]").forEach((button) => {
        button.addEventListener("click", async () => {
          const url = replayOpenUrl(button.dataset.copyReplayUrl);
          await copyText(url);
          log("牌譜URLをコピーしました。");
        });
      });
    } catch (error) {
      body.innerHTML = `<p class="muted">牌譜一覧の取得に失敗しました。</p><pre>${getErrorText(error)}</pre><p class="muted">Supabase SQL Editorで supabase/patch_my_replays_rpc.sql を実行してください。</p>`;
    }
  };
  const clubManagementNavHtml = (activePage) => `
    <div class="primary-actions">
      <button type="button" class="${activePage === "joinRequests" ? "" : "secondary"}" ${activePage === "joinRequests" ? "disabled" : 'data-management-page="joinRequests"'}>加入申請一覧</button>
      <button type="button" class="${activePage === "members" ? "" : "secondary"}" ${activePage === "members" ? "disabled" : 'data-management-page="members"'}>メンバー管理</button>
      <button type="button" class="${activePage === "clubSettings" ? "" : "secondary"}" ${activePage === "clubSettings" ? "disabled" : 'data-management-page="clubSettings"'}>クラブ設定</button>
      ${isSuperClubCreator() ? `<button type="button" class="danger" data-delete-club-management>クラブ削除</button>` : ""}
    </div>
  `;
  const bindClubManagementNav = (root, clubId) => {
    root.querySelectorAll("[data-management-page]").forEach((button) => {
      button.addEventListener("click", () => openSettingsPage(button.dataset.managementPage).catch((error) => showError(JA_MESSAGES.actionFailed, error)));
    });
    root.querySelector("[data-delete-club-management]")?.addEventListener("click", async () => {
      try {
        await deleteClub(clubId);
      } catch (error) {
        showError("クラブ削除に失敗しました", error);
      }
    });
  };
  const renderJoinRequestsPage = async (body) => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) {
      body.innerHTML = `<p class="muted">権限がありません。クラブ管理者だけが加入申請を確認できます。</p>`;
      return;
    }
    const rows = await loadAdminJoinRequests(clubId);
    const managementHeader = `
      ${clubManagementNavHtml("joinRequests")}
      <h4>加入申請一覧</h4>
      <p class="muted">現在のclubId: ${clubId}<br>取得した申請数: <span id="joinRequestCountDebug">${rows.length}</span></p>
    `;
    if (!rows.length) {
      body.innerHTML = `${managementHeader}<p class="muted">現在、加入申請はありません。</p>`;
      bindClubManagementNav(body, clubId);
      return;
    }
    body.innerHTML = `${managementHeader}<div id="joinRequestRows" class="point-user-list"></div>`;
    bindClubManagementNav(body, clubId);
    const container = document.getElementById("joinRequestRows");
    rows.forEach((request) => {
      const name = request.users?.display_name || request.user_id;
      const loginId = request.users?.login_id || String(request.user_id || "").slice(0, 8);
      const row = document.createElement("div");
      row.className = "point-user-row";
      row.innerHTML = `
        <strong>${name}</strong>
        <span>ID: ${loginId}</span>
        <span>申請日時: ${new Date(request.created_at || Date.now()).toLocaleString()}</span>
        <button type="button" data-action="approve">承認</button>
        <button type="button" data-action="reject" class="secondary">拒否</button>
      `;
      row.querySelector('[data-action="approve"]').addEventListener("click", async () => {
        const buttons = row.querySelectorAll("button");
        try {
          uiLog("approve clicked", { requestId: request.request_id, userId: request.user_id, clubId: request.club_id });
          buttons.forEach((button) => (button.disabled = true));
          await approveJoinRequest(request);
          row.remove();
          const remaining = container.querySelectorAll(".point-user-row").length;
          const count = document.getElementById("joinRequestCountDebug");
          if (count) count.textContent = String(remaining);
          if (!remaining) await renderJoinRequestsPage(body);
        } catch (error) {
          buttons.forEach((button) => (button.disabled = false));
          showError("承認に失敗しました", error);
        }
      });
      row.querySelector('[data-action="reject"]').addEventListener("click", async () => {
        const buttons = row.querySelectorAll("button");
        try {
          uiLog("reject clicked", { requestId: request.request_id, userId: request.user_id, clubId: request.club_id });
          buttons.forEach((button) => (button.disabled = true));
          await rejectJoinRequest(request);
          row.remove();
          const remaining = container.querySelectorAll(".point-user-row").length;
          const count = document.getElementById("joinRequestCountDebug");
          if (count) count.textContent = String(remaining);
          if (!remaining) await renderJoinRequestsPage(body);
        } catch (error) {
          buttons.forEach((button) => (button.disabled = false));
          showError("拒否に失敗しました", error);
        }
      });
      container.append(row);
    });
  };
  const renderClubMembersPage = async (body) => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) {
      body.innerHTML = `<p class="muted">権限がありません。クラブ管理者だけがメンバー管理できます。</p>`;
      return;
    }
    let members = [];
    try {
      members = await loadClubMembersForView(clubId);
    } catch (error) {
      body.innerHTML = `<p class="muted">メンバー一覧の取得に失敗しました。</p><pre>${getErrorText(error)}</pre>`;
      return;
    }
    body.innerHTML = `
      ${clubManagementNavHtml("members")}
      <h4>メンバー一覧</h4>
      <p class="muted">現在のclubId: ${clubId}<br>メンバー数: ${members.length}</p>
      <div id="clubMemberRows" class="point-user-list"></div>
    `;
    bindClubManagementNav(body, clubId);
    const container = document.getElementById("clubMemberRows");
    if (!members.length) {
      container.innerHTML = `<p class="muted">メンバーはいません。</p>`;
      return;
    }
    members.forEach((member) => {
      const userInfo = member.users || {};
      const memberUserId = member.user_id || userInfo.user_id || "";
      const club = state.clubs.find((item) => item.club_id === clubId) || selectedMembership()?.clubs || {};
      const roleLabel = memberUserId && club.owner_user_id === memberUserId
        ? "クラブ作成者"
        : member.role === "admin"
          ? "管理者権限"
          : "メンバー";
      const memberIcon = member.icon_url || userInfo.icon_url || "";
      const memberIconHtml = memberIcon
        ? `<img class="club-list-icon" src="${escapeHtml(memberIcon)}" alt="メンバーアイコン" />`
        : `<div class="club-list-icon club-list-icon-placeholder" aria-label="メンバーアイコン未設定">${escapeHtml((member.display_name || userInfo.display_name || "P").slice(0, 1))}</div>`;
      const clubCreationGrantHtml = isSuperClubCreator() && memberUserId !== SUPER_CLUB_CREATOR_USER_ID
        ? '<button type="button" data-action="grantClubCreation">クラブ作成権限を付与</button>'
        : "";
      const row = document.createElement("div");
      row.className = "point-user-row";
      row.innerHTML = `
        ${memberIconHtml}
        <strong>${member.display_name || userInfo.display_name || member.login_id || userInfo.login_id || member.user_id || userInfo.user_id || "名前未設定"}</strong>
        <span>ID: ${member.login_id || userInfo.login_id || member.user_id || userInfo.user_id || "不明"}</span>
        <span>権限: ${roleLabel}</span>
        <span>ポイント: ${formatPoint(member.point_balance)}</span>
        <span>加入: ${new Date(member.joined_at || Date.now()).toLocaleString()}</span>
        ${clubCreationGrantHtml}
        ${member.role !== "admin" ? '<button type="button" data-action="grantAdmin">管理者権限を付与</button><button type="button" data-action="removeMember" class="danger">削除</button>' : ""}
      `;
      row.querySelector('[data-action="grantClubCreation"]')?.addEventListener("click", async () => {
        try {
          await grantClubCreationPermission(member);
          await renderClubMembersPage(body);
        } catch (error) {
          showError("クラブ作成権限の付与に失敗しました", error);
        }
      });
      row.querySelector('[data-action="grantAdmin"]')?.addEventListener("click", async () => {
        try {
          await grantClubAdminRole(member);
          await renderClubMembersPage(body);
        } catch (error) {
          showError("管理者権限の付与に失敗しました", error);
        }
      });
      row.querySelector('[data-action="removeMember"]')?.addEventListener("click", async () => {
        try {
          await removeClubMember(member);
          await renderClubMembersPage(body);
        } catch (error) {
          showError("メンバー削除に失敗しました", error);
        }
      });
      container.append(row);
    });
  };
  const renderClubSettingsPage = async (body) => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!isAdmin()) {
      body.innerHTML = `<p class="muted">権限がありません。クラブ設定を変更できるのは管理者だけです。</p>`;
      return;
    }
    const club = state.clubs.find((item) => item.club_id === clubId) || selectedMembership()?.clubs || {};
    const clubIcon = club.icon_url || "";
    const superRakeShare = await loadClubSuperRakeShare(clubId);
    const superRakeSharePercent = Number(superRakeShare.percent || 0);
    const superShareControls = isSuperClubCreator()
      ? `
        <label>特権アカウントへのレーキ配分率
          <input id="superRakeSharePercentInput" type="number" min="0" max="100" step="0.1" value="${superRakeSharePercent}" />
        </label>
        <p class="muted">このクラブがレーキ機能で回収したクラブポイントのうち、設定した割合を特権アカウントへ自動付与します。</p>
        <button type="button" id="saveSuperRakeShareButton" class="secondary">レーキ配分率を保存</button>
      `
      : `<p class="muted">特権アカウントへのレーキ配分率: ${formatPoint(superRakeSharePercent)}%</p>`;
    body.innerHTML = `
      ${clubManagementNavHtml("clubSettings")}
      <h4>クラブ設定</h4>
      <div class="row">
        ${clubIcon ? `<img src="${escapeHtml(clubIcon)}" alt="クラブアイコン" style="width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,.35);" />` : `<span class="muted">クラブアイコン未設定</span>`}
      </div>
      <p class="muted">クラブID: ${club.club_code || club.club_id || clubId}</p>
      <label>クラブ名
        <input id="clubSettingsNameInput" value="${escapeHtml(club.name || "")}" />
      </label>
      <label>クラブアイコン変更
        <input id="clubIconInput" type="file" accept="image/*" />
      </label>
      <div class="row">
        <button type="button" id="saveClubNameButton">クラブ名を変更</button>
        <button type="button" id="saveClubIconButton" class="secondary">クラブアイコンを変更</button>
      </div>
      <section class="card">
        <h4>特権アカウント配分</h4>
        ${superShareControls}
      </section>
      <section class="card">
        <h4>危険な操作</h4>
        <p class="muted">クラブ削除は特権アカウントのみ実行できます。削除時にはポイント残高ログを保存します。</p>
        ${isSuperClubCreator() ? `<button type="button" id="deleteClubButton" class="danger">クラブ削除</button>` : `<p class="muted">このアカウントではクラブ削除できません。</p>`}
      </section>
    `;
    bindClubManagementNav(body, clubId);
    document.getElementById("saveClubNameButton")?.addEventListener("click", async () => {
      try {
        await updateClubName(clubId, document.getElementById("clubSettingsNameInput")?.value || "");
        await renderClubSettingsPage(body);
      } catch (error) {
        showError("クラブ名変更に失敗しました", error);
      }
    });
    document.getElementById("saveClubIconButton")?.addEventListener("click", async () => {
      try {
        const file = document.getElementById("clubIconInput")?.files?.[0];
        await updateClubIcon(clubId, file);
        await renderClubSettingsPage(body);
      } catch (error) {
        showError("クラブアイコン変更に失敗しました", error);
      }
    });
    document.getElementById("saveSuperRakeShareButton")?.addEventListener("click", async () => {
      try {
        const percent = Number(document.getElementById("superRakeSharePercentInput")?.value || 0);
        await saveClubSuperRakeShare(clubId, percent);
        await renderClubSettingsPage(body);
      } catch (error) {
        showError("レーキ配分率の保存に失敗しました", error);
      }
    });
    document.getElementById("deleteClubButton")?.addEventListener("click", async () => {
      try {
        await deleteClub(clubId);
      } catch (error) {
        showError("クラブ削除に失敗しました", error);
      }
    });
  };
  const showSettingsPage = async (page) => {
    if (has("settingsDrawer")) $("settingsDrawer").classList.remove("open");
    if (!has("settingsPagePanel")) return;
    const panel = $("settingsPagePanel");
    const title = $("settingsPageTitle");
    const body = $("settingsPageBody");
    panel.classList.add("open");
    if (page === "account") {
      title.textContent = "アカウント設定";
      const userIcon = state.user?.iconUrl || "";
      body.innerHTML = `
        <section class="card">
          <h4>名前の変更</h4>
          <label>プレイヤー名
            <input id="settingsDisplayName" value="${escapeHtml(state.user?.displayName || "")}" autocomplete="name" />
          </label>
          <button type="button" id="saveDisplayNameButton">名前を変更</button>
        </section>
        <section class="card">
          <h4>アイコンの設定</h4>
          <div class="row">
            ${userIcon ? `<img src="${escapeHtml(userIcon)}" alt="アカウントアイコン" style="width:64px;height:64px;object-fit:cover;border-radius:50%;border:1px solid rgba(255,255,255,.35);" />` : `<span class="muted">アイコン未設定</span>`}
          </div>
          <label>画像を選択
            <input id="accountIconInput" type="file" accept="image/*" />
          </label>
          <button type="button" id="saveAccountIconButton">アイコンを変更</button>
        </section>
        <section class="card">
          <h4>メールアドレスの変更</h4>
          <label>新しいメールアドレス
            <input id="settingsEmail" type="email" autocomplete="email" placeholder="mail@example.com" />
          </label>
          <button type="button" id="saveEmailButton">メールアドレスを変更</button>
        </section>
        <section class="card">
          <h4>パスワードの変更</h4>
          <label>新しいパスワード
            <input id="settingsNewPassword" type="password" autocomplete="new-password" />
          </label>
          <button type="button" id="savePasswordButton">パスワードを変更</button>
        </section>
        <section class="card">
          <h4>ログアウト</h4>
          <button type="button" id="logoutFromSettings" class="secondary">ログアウト</button>
        </section>
      `;
      document.getElementById("saveDisplayNameButton")?.addEventListener("click", async () => {
        try {
          await updateDisplayName(document.getElementById("settingsDisplayName")?.value);
          await showSettingsPage("account");
        } catch (error) {
          showError("名前変更に失敗しました", error);
        }
      });
      document.getElementById("saveAccountIconButton")?.addEventListener("click", async () => {
        try {
          const file = document.getElementById("accountIconInput")?.files?.[0];
          await updateUserIcon(file);
          await showSettingsPage("account");
        } catch (error) {
          showError("アイコン変更に失敗しました", error);
        }
      });
      document.getElementById("saveEmailButton")?.addEventListener("click", async () => {
        try {
          await updateEmailAddress(document.getElementById("settingsEmail")?.value);
          await showSettingsPage("account");
        } catch (error) {
          showError("メールアドレス変更に失敗しました", error);
        }
      });
      document.getElementById("savePasswordButton")?.addEventListener("click", async () => {
        try {
          await updatePassword(document.getElementById("settingsNewPassword")?.value);
          document.getElementById("settingsNewPassword").value = "";
          log("パスワードを変更しました。");
        } catch (error) {
          showError("パスワード変更に失敗しました", error);
        }
      });
      document.getElementById("logoutFromSettings")?.addEventListener("click", () => {
        if (confirm("本当にログアウトしますか？")) signOut().catch((error) => showError("ログアウトに失敗しました", error));
      });
      return;
    }
    if (page === "points") {
      title.textContent = "クラブポイント";
      body.innerHTML = `<p class="muted">ポイント情報を読み込み中...</p>`;
      await renderClubPointsPage(body);
      return;
    }
    if (page === "joinRequests") {
      title.textContent = "クラブ管理 - 加入申請";
      body.innerHTML = `<p class="muted">加入申請を読み込み中...</p>`;
      await renderJoinRequestsPage(body);
      return;
    }
    if (page === "members") {
      title.textContent = "クラブ管理 - メンバー管理";
      body.innerHTML = `<p class="muted">メンバー一覧を読み込み中...</p>`;
      await renderClubMembersPage(body);
      return;
    }
    if (page === "clubSettings") {
      title.textContent = "クラブ管理 - クラブ設定";
      body.innerHTML = `<p class="muted">クラブ設定を読み込み中...</p>`;
      await renderClubSettingsPage(body);
      return;
    }
    if (page === "history") {
      title.textContent = "ポイント収支";
      await renderPointHistoryPage(body);
      return;
    }
    if (page === "stats") {
      title.textContent = "スタッツ";
      body.innerHTML = `<p class="muted">スタッツを集計中...</p>`;
      await renderStatsPage(body);
      return;
    }
    if (page === "deletePointLogs") {
      title.textContent = "クラブ削除ログ";
      await renderDeletePointLogsPage(body);
      return;
    }
    if (page === "replays") {
      title.textContent = "牌譜一覧";
      await renderReplayListPage(body);
    }
  };
  const openSettingsPage = showSettingsPage;
  const showCreateTablePanel = () => {
    if (!isAdmin()) throw new Error("卓作成権限がありません。");
    if (has("tableCreatePanel")) $("tableCreatePanel").classList.add("open");
  };
  const hideCreateTablePanel = () => has("tableCreatePanel") && $("tableCreatePanel").classList.remove("open");
  const closeOpenPanels = () => {
    let closed = false;
    ["settingsDrawer", "tableCreatePanel", "tableRoomPanel", "settingsPagePanel", "onlineGamePanel", "clubPointPanel"].forEach((id) => {
      if (has(id) && $(id).classList.contains("open")) {
        $(id).classList.remove("open");
        closed = true;
      }
    });
    if (closed) {
      state.onlineGameOpened = false;
    }
    return closed;
  };
  const goBack = async () => {
    clearError();
    if (closeOpenPanels()) {
      render();
      return;
    }
    if (document.body.dataset.screen === "club-home") {
      state.activeTableId = "";
      state.activeGameState = null;
      state.activeGameEvents = [];
      state.onlineGameOpened = false;
      sessionStorage.removeItem("anmikaOnlineDebugActiveTableId");
      document.body.dataset.screen = "clubs";
      await loadClubs().catch(() => {});
      render();
      return;
    }
    if (document.body.dataset.screen === "clubs") {
      log("すでにクラブ選択画面です。");
      return;
    }
    if (state.user) {
      document.body.dataset.screen = "clubs";
      render();
    }
  };
  const loadClubPoints = async () => {
    const clubId = selectedClubId();
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    const members = await loadClubMembersForView(clubId);
    const rakeRows = await fetchClubRakeRows(clubId).catch((error) => {
      log("レーキ支払い集計の取得をスキップしました。", rawErrorText(error));
      return [];
    });
    const paidRakeByUser = rakeTotalsByUser(rakeRows);
    const pointSummary = clubPointSummaryFromMembers(members);
    const visibleMembers = members.filter((member) => isAdmin() || member.users?.user_id === requireUser().id);
    const showAdminPointControls = isAdmin();
    ["pointTargetUserId", "pointAmount", "sendPointButton", "collectPointButton"].forEach((id) => {
      if (has(id)) $(id).style.display = showAdminPointControls ? "" : "none";
    });
    if (has("pointSummary")) {
      const lines = visibleMembers.map((member) => {
        const userId = member.users?.user_id || "";
        const name = member.users?.display_name || userId || "Player";
        const paidRake = roundToTenth(paidRakeByUser[userId] || 0);
        return `${name}\n  現在ポイント: ${formatPoint(member.point_balance)}\n  支払レーキ: ${formatPoint(paidRake)}\n  権限: ${member.role}`;
      });
      $("pointSummary").textContent = [
        `クラブポイント固定総量: ${formatPoint(pointSummary.fixedTotal)}`,
        `クラブ保管ポイント: ${formatPoint(pointSummary.clubReserve)}`,
        `メンバー保有ポイント合計: ${formatPoint(pointSummary.memberTotal)}`,
        "",
        lines.length ? lines.join("\n\n") : "ポイント情報がありません。",
      ].join("\n");
    }
    if (has("pointUserRows")) {
      $("pointUserRows").innerHTML = "";
      visibleMembers.forEach((member) => {
        const userId = member.users?.user_id || "";
        const name = member.users?.display_name || userId || "Player";
        const paidRake = roundToTenth(paidRakeByUser[userId] || 0);
        const row = document.createElement("div");
        row.className = "point-user-row";
        row.innerHTML = `<strong>${name}</strong><span>${formatPoint(member.point_balance)} pt</span><span>支払レーキ ${formatPoint(paidRake)} pt</span>${isAdmin() ? '<button type="button" data-action="send">送る</button><button type="button" data-action="collect" class="secondary">回収</button>' : ""}`;
        const sendButton = row.querySelector('[data-action="send"]');
        if (sendButton) {
          sendButton.addEventListener("click", async () => {
            try {
              const amount = readPointAmount(prompt(`${name}へ送るポイント数`, "100"), "送信ポイント");
              if (pointSummary.clubReserve < amount) throw new Error("クラブ保管ポイントが不足しています。");
              await rest("/rpc/admin_grant_club_points", {
                method: "POST",
                body: JSON.stringify({ p_club_id: clubId, p_to_user_id: userId, p_amount: amount }),
              });
              await loadClubPoints();
            } catch (error) {
              showError("ポイント送信に失敗しました", error);
            }
          });
        }
        const collectButton = row.querySelector('[data-action="collect"]');
        if (collectButton) {
          collectButton.addEventListener("click", async () => {
            try {
              const amount = readPointAmount(prompt(`${name}から回収するポイント数`, "100"), "回収ポイント");
              if (Number(member.point_balance || 0) < amount) throw new Error("対象プレイヤーのポイントが不足しています。回収で残高をマイナスにはできません。");
              await rest("/rpc/admin_collect_club_points", {
                method: "POST",
                body: JSON.stringify({ p_club_id: clubId, p_from_user_id: userId, p_amount: amount }),
              });
              await loadClubPoints();
            } catch (error) {
              showError("ポイント回収に失敗しました", error);
            }
          });
        }
        $("pointUserRows").append(row);
      });
    }
  };
  const showClubPoints = async () => {
    if (!has("clubPointPanel")) return;
    $("clubPointPanel").classList.toggle("open");
    if ($("clubPointPanel").classList.contains("open")) await loadClubPoints();
  };
  const sendPoint = async () => {
    if (!isAdmin()) throw new Error("ポイント送信権限がありません。");
    const clubId = selectedClubId();
    const targetUserId = $("pointTargetUserId").value.trim();
    const amount = readPointAmount($("pointAmount").value, "送信ポイント");
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!targetUserId) throw new Error("対象ユーザーIDを入力してください。");
    const members = await loadClubMembersForView(clubId);
    const targetMember = members.find((item) => item.users?.user_id === targetUserId || item.user_id === targetUserId);
    if (!targetMember) throw new Error("対象ユーザーはこのクラブのメンバーではありません。");
    const pointSummary = clubPointSummaryFromMembers(members);
    if (pointSummary.clubReserve < amount) throw new Error("クラブ保管ポイントが不足しています。");
    await rest("/rpc/admin_grant_club_points", {
      method: "POST",
      body: JSON.stringify({ p_club_id: clubId, p_to_user_id: targetUserId, p_amount: amount }),
    });
    await loadClubPoints();
  };
  const collectPoint = async () => {
    if (!isAdmin()) throw new Error("ポイント回収権限がありません。");
    const clubId = selectedClubId();
    const targetUserId = $("pointTargetUserId").value.trim();
    const amount = readPointAmount($("pointAmount").value, "回収ポイント");
    if (!clubId) throw new Error(JA_MESSAGES.selectClub);
    if (!targetUserId) throw new Error("対象ユーザーIDを入力してください。");
    const members = await loadClubMembersForView(clubId);
    const targetMember = members.find((item) => item.users?.user_id === targetUserId || item.user_id === targetUserId);
    if (!targetMember) throw new Error("対象ユーザーはこのクラブのメンバーではありません。");
    if (Number(targetMember.point_balance || 0) < amount) throw new Error("対象プレイヤーのポイントが不足しています。回収で残高をマイナスにはできません。");
    await rest("/rpc/admin_collect_club_points", { method: "POST", body: JSON.stringify({ p_club_id: clubId, p_from_user_id: targetUserId, p_amount: amount }) });
    await loadClubPoints();
  };
  const refreshLobbyNow = async (reason = "auto") => {
    if (!state.accessToken || !state.user) return;
    if (document.visibilityState !== "visible") return;
    if (document.body.dataset.screen !== "club-home") return;
    if (state.lobbyRefreshInFlight) {
      state.lobbyRefreshPending = true;
      return;
    }
    state.lobbyRefreshInFlight = true;
    try {
      await loadTables();
      const tableId = selectedTableId();
      if (tableId && state.onlineGameOpened) {
        await loadSeats().catch((error) => log(`席の自動更新に失敗しました。(${reason})`, rawErrorText(error)));
        await loadActiveGameState(tableId).catch((error) => log(`対局状態の自動更新に失敗しました。(${reason})`, rawErrorText(error)));
        renderOnlineGamePanel();
      }
    } finally {
      state.lobbyRefreshInFlight = false;
      if (state.lobbyRefreshPending) {
        state.lobbyRefreshPending = false;
        window.setTimeout(() => refreshLobbyNow("pending").catch((error) => log("保留中の自動更新に失敗しました。", rawErrorText(error))), 150);
      }
    }
  };
  const startPolling = () => {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.body.dataset.screen === "club-home") refreshLobbyNow("gamePoll").catch((error) => log("卓状況の自動更新に失敗しました。", rawErrorText(error)));
    }, GAME_AUTO_REFRESH_MS);
    renderDebug("ポーリング中");
  };
  const startClubPolling = () => {
    clearInterval(state.clubPollTimer);
    state.clubPollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!state.accessToken || !state.user) return;
      if (document.body.dataset.screen === "clubs") {
        loadClubs().catch((error) => log("クラブ自動更新に失敗しました。", rawErrorText(error)));
        return;
      }
      if (document.body.dataset.screen === "club-home") {
        refreshLobbyNow("clubPoll").catch((error) => log("卓状況の自動更新に失敗しました。", rawErrorText(error)));
      }
    }, LOBBY_AUTO_REFRESH_MS);
  };
  const render = () => {
    const activeClubId = selectedClubId();
    const activeTableId = state.activeTableId || selectedTableId();
    $("currentUser").textContent = state.user ? `${state.user.displayName} / ${state.user.loginId || state.user.id}` : "未ログイン";
    if (has("loginIdDisplay")) $("loginIdDisplay").textContent = state.user ? state.user.loginId || state.user.id : "未設定";
    if (state.user && has("userId")) $("userId").value = state.user.loginId || state.user.id;
    if (!state.user || !state.accessToken) document.body.dataset.screen = "auth";
    else if (document.body.dataset.screen === "auth") document.body.dataset.screen = shouldOpenTableListOnBoot ? "club-home" : "clubs";
    document.body.dataset.super = isSuperClubCreator() ? "true" : "false";
    const selectedClub = state.clubs.find((club) => club.club_id === activeClubId) || null;
    if (has("clubHomeTitle")) $("clubHomeTitle").textContent = selectedClub ? selectedClub.name : "クラブ";
    if (has("createClubButton")) {
      const button = $("createClubButton");
      const status = state.clubCreationStatus;
      const allowed = canCreateClub();
      const clubNameLabel = has("clubName") ? $("clubName").closest("label") : null;
      button.style.display = allowed ? "" : "none";
      if (clubNameLabel) clubNameLabel.style.display = allowed ? "" : "none";
      button.disabled = !allowed;
      button.title = allowed ? "" : "このアカウントにはクラブ作成権限がありません。";
      if (!has("clubCreationStatus")) {
        button.closest(".row")?.insertAdjacentHTML("afterend", '<p id="clubCreationStatus" class="muted"></p>');
      }
      if (has("clubCreationStatus")) {
        $("clubCreationStatus").style.display = allowed || status?.is_super_creator || status?.has_permission ? "" : "none";
        const ownedCount = Number(status?.owned_club_count ?? state.clubs.filter((club) => club.owner_user_id === state.user?.id).length);
        $("clubCreationStatus").textContent = status?.is_super_creator || isSuperClubCreator()
          ? `クラブ作成: 特権アカウントのため複数作成できます（作成済み ${ownedCount}件）。`
          : status?.has_permission
            ? (allowed ? "クラブ作成: 権限あり。1つだけ作成できます。" : `クラブ作成: 作成済みです（${ownedCount}件）。`)
            : "クラブ作成: 権限がありません。";
      }
    }
    if (has("createTableButton")) {
      $("createTableButton").disabled = !isAdmin();
      $("createTableButton").title = isAdmin() ? "" : "卓作成権限がありません。";
    }
    if (has("showCreateTableButton")) {
      $("showCreateTableButton").disabled = !isAdmin();
      $("showCreateTableButton").title = isAdmin() ? "" : "卓作成権限がありません。";
    }
    const joinRequestMenuButton = document.querySelector('[data-settings-page="joinRequests"]');
    if (joinRequestMenuButton) {
      const pendingCount = isAdmin() ? state.adminJoinRequests.length : 0;
      joinRequestMenuButton.textContent = pendingCount ? `クラブ管理（加入申請 ${pendingCount}件）` : "クラブ管理";
      joinRequestMenuButton.style.display = isAdmin() ? "" : "none";
    }
    $("clubSelect").innerHTML = "";
    if (has("clubCards")) $("clubCards").innerHTML = "";
    state.clubs.forEach((club) => {
      const option = document.createElement("option");
      option.value = club.club_id;
      option.textContent = `${club.name} (${club.club_code || club.club_id})`;
      $("clubSelect").append(option);
      if (has("clubCards")) {
        const membership = state.memberships.find((row) => row.clubs && row.clubs.club_id === club.club_id);
        const card = document.createElement("div");
        card.className = "card club-card";
        const clubCode = club.club_code || club.club_id;
        const leaveButtonHtml = membership?.role === "admin" ? "" : '<button type="button" class="danger" data-action="leave">脱退</button>';
        const iconHtml = club.icon_url
          ? `<img class="club-list-icon" src="${escapeHtml(club.icon_url)}" alt="クラブアイコン" />`
          : `<div class="club-list-icon club-list-icon-placeholder" aria-label="クラブアイコン未設定">${escapeHtml((club.name || "C").slice(0, 1))}</div>`;
        card.innerHTML = `
          ${iconHtml}
          <div class="club-card-body">
            <strong>${escapeHtml(club.name)}</strong><br>
            クラブID: <span class="muted">${escapeHtml(clubCode)}</span><br>
            権限: ${membership?.role === "admin" ? "管理者" : "メンバー"}<br>
            <div class="row"><button type="button" data-action="open">クラブに入る</button><button type="button" class="secondary" data-action="copy">クラブIDコピー</button>${leaveButtonHtml}</div>
          </div>`;
        card.querySelector('[data-action="open"]').addEventListener("click", () => openClubHome(club.club_id).catch((error) => showError(JA_MESSAGES.actionFailed, error)));
        card.querySelector('[data-action="copy"]').addEventListener("click", () => copyText(clubCode, "クラブIDをコピーしました").catch((error) => showError(JA_MESSAGES.actionFailed, error)));
        card.querySelector('[data-action="leave"]')?.addEventListener("click", () => {
          uiLog("leave club clicked", { clubId: club.club_id });
          clearError();
          leaveClub(club.club_id).catch((error) => showError("クラブ脱退に失敗しました", error));
        });
        $("clubCards").append(card);
      }
    });
    if (has("clubCards")) {
      const memberClubIds = new Set(state.clubs.map((club) => club.club_id));
      state.joinRequests
        .filter((request) => request.clubs && !memberClubIds.has(request.clubs.club_id))
        .forEach((request) => {
          const card = document.createElement("div");
          card.className = "card";
          const statusText = request.status === "approved" ? "承認済み" : request.status === "rejected" ? "拒否されました" : "承認待ち";
          card.innerHTML = `<strong>${request.clubs.name}</strong><br>クラブID: <span class="muted">${request.clubs.club_code || request.clubs.club_id}</span><br>状態: ${statusText}<br><span class="muted">申請日時: ${new Date(request.created_at || Date.now()).toLocaleString()}</span>`;
          $("clubCards").append(card);
        });
    }
    if (activeClubId && state.clubs.some((club) => club.club_id === activeClubId)) $("clubSelect").value = activeClubId;
    $("tableSelect").innerHTML = "";
    if (has("tableCards")) $("tableCards").innerHTML = "";
    const urlTableId = normalizeRemoteTableId(new URLSearchParams(location.search).get("tableId"));
    if (urlTableId && !state.tables.some((table) => table.table_id === urlTableId)) {
      const option = document.createElement("option");
      option.value = urlTableId;
      option.textContent = `URL指定卓 (${urlTableId})`;
      $("tableSelect").append(option);
    }
    state.tables.forEach((table) => {
      const option = document.createElement("option");
      option.value = table.table_id;
      option.textContent = `${table.name} (${table.status})`;
      $("tableSelect").append(option);
      if (has("tableCards")) {
        const seats = visibleTableSeats(table);
        const filled = filledSeatCount(seats);
        const hasCpu = hasCpuSeat(seats) || table.is_debug;
        const waitingRows = visibleTableWaiting(table);
        const isOwnWaiting = isCurrentUserWaitingForTable(table);
        const isOwnSeatInTable = isCurrentUserSeatedAt(seats);
        const card = document.createElement("div");
        card.className = "card table-card";
        const ruleLabel = RULE_LABELS[table.rule_id || "anmika-rocket"] || table.rule_id || "アンミカロケット";
        card.innerHTML = `
          <strong>${table.name || "アンミカロケット卓"}</strong>${hasCpu ? ' <span class="warn">デバッグ卓</span>' : ""}
          <span class="muted">ルール: ${ruleLabel}</span>
          <div>${formatRuleSummary({ ...table, is_debug: hasCpu })}</div>
          <div>状態: ${table.status || "waiting"} / 参加人数: ${filled}/3</div>
          <div class="table-seats"></div>
          <div class="table-waiting-list"></div>
          <div class="table-card-actions">
            ${table.status === "playing" ? '<button type="button" data-action="enterGame" class="primary">対局へ入る</button>' : ""}
            <button type="button" data-action="toggleWaiting" class="secondary"></button>
            <button type="button" data-action="addCpu" class="admin-only">CPU追加</button>
            <button type="button" data-action="removeCpu" class="admin-only secondary">CPU削除</button>
            <button type="button" data-action="deleteTable" class="admin-only danger">卓削除</button>
          </div>
        `;
        const seatContainer = card.querySelector(".table-seats");
        seats.forEach((seat) => {
          const line = document.createElement("div");
          line.className = "table-seat-line";
          const isOwnSeat = seat.user_id === state.user?.id;
          const canSit = !seat.user_id || seat.player_type === "cpu";
          line.innerHTML = `<strong>席${Number(seat.seat_index) + 1}</strong><span>${formatSeatName(seat)}</span>`;
          if (seat.user_id || seat.player_type === "cpu") {
            const lastHandLabel = document.createElement("span");
            lastHandLabel.className = "last-hand-chip";
            lastHandLabel.textContent = seat.is_last_hand_declared ? "ラス半ON" : "ラス半OFF";
            line.append(lastHandLabel);
          }
          if (isOwnSeat) {
            const lastHandControl = document.createElement("label");
            lastHandControl.className = "inline-check";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = Boolean(seat.is_last_hand_declared);
            checkbox.addEventListener("change", () => {
              uiLog("last hand toggled", { tableId: table.table_id, checked: checkbox.checked });
              clearError();
              setSeatLastHand(table.table_id, checkbox.checked).catch((error) => showError("ラス半切替に失敗しました", error));
            });
            lastHandControl.append(checkbox, document.createTextNode("ラス半"));
            line.append(lastHandControl);
          }
          if (isOwnSeat) {
            const leaveButton = document.createElement("button");
            leaveButton.type = "button";
            leaveButton.textContent = "立つ";
            leaveButton.className = "secondary";
            leaveButton.addEventListener("click", () => {
              uiLog("leave seat clicked", { tableId: table.table_id, seatIndex: Number(seat.seat_index) });
              clearError();
              leave(table.table_id).catch((error) => showError("退席に失敗しました", error));
            });
            line.append(leaveButton);
          } else if (canSit) {
            const sitButton = document.createElement("button");
            sitButton.type = "button";
            sitButton.textContent = "座る";
            sitButton.addEventListener("click", () => {
              uiLog("seat clicked", { tableId: table.table_id, seatIndex: Number(seat.seat_index) });
              clearError();
              sit(table.table_id, Number(seat.seat_index)).catch((error) => showError("着席に失敗しました", error));
            });
            line.append(sitButton);
          }
          seatContainer.append(line);
        });
        const waitingContainer = card.querySelector(".table-waiting-list");
        waitingContainer.textContent = waitingRows.length
          ? `ウェイティング: ${waitingRows.map((row, index) => `${index + 1}. ${waitingUserName(row)}`).join(" / ")}`
          : "ウェイティング: なし";
        const waitingButton = card.querySelector('[data-action="toggleWaiting"]');
        waitingButton.textContent = isOwnWaiting ? "ウェイティング解除" : "ウェイティング";
        waitingButton.disabled = isOwnSeatInTable;
        waitingButton.title = isOwnSeatInTable ? "着席中の卓ではウェイティングできません" : "";
        waitingButton.addEventListener("click", () => {
          uiLog("waiting toggled", { tableId: table.table_id });
          clearError();
          toggleWaiting(table.table_id).catch((error) => showError("ウェイティング切替に失敗しました", error));
        });
        card.querySelector('[data-action="enterGame"]')?.addEventListener("click", () => {
          uiLog("enter game clicked", { tableId: table.table_id });
          clearError();
          enterPlayingGame(table.table_id).catch((error) => showError("対局参加に失敗しました", error));
        });
        card.querySelector('[data-action="addCpu"]').addEventListener("click", () => {
          uiLog("add cpu clicked", { tableId: table.table_id });
          clearError();
          addCpu(table.table_id).catch((error) => showError("CPU追加に失敗しました", error));
        });
        card.querySelector('[data-action="removeCpu"]').addEventListener("click", () => {
          uiLog("remove cpu clicked", { tableId: table.table_id });
          clearError();
          removeCpu(table.table_id).catch((error) => showError("CPU削除に失敗しました", error));
        });
        card.querySelector('[data-action="deleteTable"]').addEventListener("click", () => {
          uiLog("delete table clicked", { tableId: table.table_id });
          clearError();
          deleteTable(table.table_id).catch((error) => showError("卓削除に失敗しました", error));
        });
        $("tableCards").append(card);
      }
    });
    const nextTableId = normalizeRemoteTableId(activeTableId) || urlTableId || getStartableTableId();
    if (nextTableId) setActiveTableId(nextTableId);
    const tableId = selectedTableId();
    $("tableUrl").textContent = tableId ? buildTableShareUrl(tableId) : "なし";
    document.body.dataset.role = isAdmin() ? "admin" : "member";
    updateRangeLabels();
    scheduleAutoStartFromVisibleTables();
    renderDebug();
  };
  const renderDebug = (realtimeStatus) => {
    if (!has("debugSummary")) return;
    const socketDebug = loadSocketDebugStatus();
    const socketUpdatedAt = socketDebug.updatedAt ? new Date(socketDebug.updatedAt).toLocaleString("ja-JP") : "なし";
    const serverException = state.gameServerProbe.lastException;
    const serverSyncFailure = state.gameServerProbe.lastGameStateSyncFailure;
    const socketExceptionAt = socketDebug.lastExceptionAt ? new Date(socketDebug.lastExceptionAt).toLocaleString("ja-JP") : "";
    const memory = state.gameServerProbe.memoryMb;
    const serverExceptionLine = serverException
      ? `${serverException.exceptionId || "no-id"} ${serverException.source || ""}: ${serverException.error?.message || ""}`
      : "なし";
    const socketExceptionLine = socketDebug.lastExceptionId
      ? `${socketDebug.lastExceptionId}: ${socketDebug.lastException || socketDebug.lastError || ""}${socketExceptionAt ? ` (${socketExceptionAt})` : ""}`
      : "なし";
    const syncFailureLine = serverSyncFailure
      ? `${serverSyncFailure.source || ""}: gameId=${serverSyncFailure.gameId || "なし"} playerId=${serverSyncFailure.playerId || "なし"} version=${serverSyncFailure.version ?? "なし"} ${serverSyncFailure.error?.message || ""}`
      : "なし";
    const memoryLine = memory
      ? `rss=${memory.rss ?? "?"}MB heapUsed=${memory.heapUsed ?? "?"}MB external=${memory.external ?? "?"}MB`
      : "未取得";
    $("debugSummary").textContent = [
      `Server Status: ${state.gameServerProbe.status || "NG"}`,
      `Socket Status: ${socketDebug.socket || "DISCONNECTED"}`,
      `Last Error: ${socketDebug.lastError || state.gameServerProbe.lastError || "なし"}`,
      `Last Exception: ${socketExceptionLine}`,
      `Server Last Exception: ${serverExceptionLine}`,
      `GameState Sync Failure: ${syncFailureLine}`,
      `Server Memory: ${memoryLine}`,
      "",
      `Supabase URL: ${config.url || "未設定"}`,
      `Supabase: ${config.url && config.anonKey ? "OK" : "設定不足"}`,
      `Socket: ${socketDebug.socket || "DISCONNECTED"}`,
      `Game Server: ${state.gameServerProbe.status || socketDebug.gameServer || "NG"}`,
      `Game Server確認: ${state.gameServerProbe.checkedAt || "なし"} ${state.gameServerProbe.lastError ? `(${state.gameServerProbe.lastError})` : ""}`,
      `Socket URL: ${socketDebug.socketUrl || "未接続"}`,
      `認証状態: ${state.user ? "ログイン済み" : "未ログイン"}`,
      `現在ユーザー: ${state.user ? `${state.user.displayName} / ${state.user.id}` : "なし"}`,
      `現在クラブ: ${selectedClubId() || "なし"}`,
      `権限: ${selectedMembership() ? (selectedMembership().role === "admin" ? "管理者" : "メンバー") : "なし"}`,
      `読み込み済み卓数: ${state.tables.length}`,
      `現在卓: ${selectedTableId() || "なし"}`,
      `Current Game: ${socketDebug.gameId || state.activeGameState?.game_id || "なし"}`,
      `Version: client=${socketDebug.clientVersion ?? state.activeGameState?.version ?? "なし"} / server=${socketDebug.serverVersion ?? state.activeGameState?.version ?? "なし"}`,
      `Last Action: ${socketDebug.lastAction || "なし"}`,
      `Last Error: ${socketDebug.lastError || "なし"}`,
      `切断理由: ${socketDebug.lastDisconnectReason || "なし"}`,
      `再接続理由: ${socketDebug.lastReconnectReason || "なし"}`,
      `Socket状態更新: ${socketUpdatedAt}`,
      `現在version: ${state.activeGameState?.version ?? "なし"}`,
      `イベント数: ${state.activeGameEvents.length}`,
      `最終同期: ${state.lastGameSyncAt || "なし"}`,
      `Realtime接続: 短周期ポーリングでGameState同期中`,
      `ロビー共有: Supabase tables / table_seats`,
      `複数アカウント検証: ロビー着席とGameState/versionは共有対象`,
      `対局同期: game_states / game_events でイベント同期`,
      `同期状態: ${realtimeStatus || (state.pollTimer ? "ポーリング中" : "未接続")}`,
    ].join("\n");
  };
  const showLanHint = () => {
    const pcUrl = `${pcOrigin()}/online-debug`;
    const mobileUrl = buildAppUrl("/online-debug");
    if (has("pcDebugUrl")) $("pcDebugUrl").textContent = pcUrl;
    if (has("mobileDebugUrl")) $("mobileDebugUrl").textContent = mobileUrl;
    if (isPublicOrigin()) {
      $("lanHint").textContent = "公開URLで動作中です。スマホや別端末でもこのURLを開けます。";
    } else if (location.protocol === "file:") {
      $("lanHint").textContent = "fileで開いている画面はスマホ共有できません。PCで npm run dev を起動し、スマホでは下のスマホ用URLを開いてください。";
    } else if (isLocalHostName(location.hostname)) {
      $("lanHint").textContent = "スマホで開く場合は、PCとスマホを同じWi-Fiに接続してください。localhost のURLはスマホでは使えません。";
    } else {
      $("lanHint").textContent = "別端末では下のスマホ用URLを開いてください。";
    }
  };
  const bind = (id, handler) => {
    if (!has(id)) return;
    $(id).addEventListener("click", () => {
      uiLog(`${id} clicked`);
      clearError();
      handler().catch((error) => showError(JA_MESSAGES.actionFailed, error));
    });
  };
  const init = async () => {
    sanitizeStoredSession();
    await completeOAuthRedirectIfNeeded().catch((error) => showError("外部ログイン処理に失敗しました", error));
    showLanHint();
    ensureTsumoLossless3maCreateUi();
    $("configStatus").textContent = config.url && config.anonKey ? "Supabase接続: OK" : "Supabase設定が不足しています。";
    $("configStatus").className = config.url && config.anonKey ? "ok" : "warn";
    bind("signUpButton", signUp);
    bind("signInButton", signInWithEmail);
    bind("debugSignInButton", createDebugAccount);
    bind("signOutButton", async () => {
      if (confirm("本当にログアウトしますか？")) await signOut();
    });
    bind("createClubButton", createClub);
    bind("loadClubsButton", loadClubs);
    bind("searchClubButton", searchClubForJoin);
    if (has("requestJoinButton")) $("requestJoinButton").style.display = "none";
    bind("changeLoginIdButton", changeLoginId);
    bind("approveJoinButton", approveJoin);
    bind("createTableButton", createTable);
    bind("loadTablesButton", loadTables);
    bind("loadSeatsButton", loadSeats);
    bind("copyTableUrlButton", copyTableUrl);
    bind("copyMobileUrlButton", async () => copyText(buildAppUrl("/online-debug"), "スマホ用URLをコピーしました"));
    bind("sitButton", sit);
    bind("leaveButton", leave);
    bind("addCpuButton", addCpu);
    bind("removeCpuButton", removeCpu);
    bind("startDebugGameButton", startDebugGame);
    bind("openOnlineGameButton", openOnlineGame);
    document.querySelectorAll("[data-online-action]").forEach((button) => {
      button.addEventListener("click", () => {
        uiLog(`${button.getAttribute("data-online-action")} clicked`);
        clearError();
        sendOnlineActionFromUi(button.getAttribute("data-online-action")).catch((error) => showError("オンライン行動の送信に失敗しました", error));
      });
    });
    bind("loadRakeButton", loadRake);
    bind("settingsGearButton", toggleSettings);
    bind("settingsToggleButton", toggleSettings);
    bind("showCreateTableButton", async () => showCreateTablePanel());
    bind("cancelCreateTableButton", async () => hideCreateTablePanel());
    bind("showClubPointsButton", showClubPoints);
    bind("sendPointButton", sendPoint);
    bind("collectPointButton", collectPoint);
    bind("globalBackButton", goBack);
    bind("backToClubsButton", goBack);
    bind("backFromCreateTableButton", goBack);
    bind("backFromTableRoomButton", goBack);
    bind("backFromOnlineGameButton", goBack);
    bind("backFromSettingsPageButton", goBack);
    document.querySelectorAll("[data-settings-page]").forEach((button) => {
      button.addEventListener("click", () => {
        uiLog(`${button.dataset.settingsPage} menu clicked`);
        clearError();
        showSettingsPage(button.dataset.settingsPage).catch((error) => showError(JA_MESSAGES.actionFailed, error));
      });
    });
    bind("loadClubHomeButton", async () => {
      await loadClubs();
      await loadTables();
      await loadClubStats();
    });
    if (has("tableSelect")) {
      $("tableSelect").addEventListener("change", () => {
        setActiveTableId($("tableSelect").value);
        render();
        loadSeats().catch(() => {});
        startPolling();
      });
    }
    if (has("clubSelect")) {
      $("clubSelect").addEventListener("change", () => {
        setActiveClubId($("clubSelect").value);
        render();
        loadClubStats().catch(() => {});
        refreshLobbyNow("clubChange").catch(() => {});
      });
    }
    if (has("clubId")) {
      $("clubId").addEventListener("input", () => {
        state.searchedClub = null;
        renderClubSearchResult(null);
      });
    }
    if (has("ruleId")) $("ruleId").addEventListener("change", updateRangeLabels);
    if (has("pointRate")) $("pointRate").addEventListener("input", updateRangeLabels);
    if (has("rakePercent")) $("rakePercent").addEventListener("input", updateRangeLabels);
    if (has("threeMaEntryRake")) $("threeMaEntryRake").addEventListener("input", updateRangeLabels);
    updateRangeLabels();
    probeGameServer().catch(() => {});
    const returnClubId = initialReturnClubId || state.activeClubId;
    if (state.user && state.accessToken && returnClubId) {
      setActiveClubId(returnClubId);
      localStorage.setItem(DEBUG_RETURN_CLUB_KEY, returnClubId);
      document.body.dataset.screen = "club-home";
    }
    render();
    if (state.user && state.accessToken) {
      await loadClubs().catch((error) => showError(JA_MESSAGES.actionFailed, error));
      await settleRecentlyLeftTable().catch((error) => showError("ラス半終了後の退席処理に失敗しました", error));
      startClubPolling();
      refreshLobbyNow("boot").catch(() => {});
      if (returnClubId) {
        setActiveClubId(returnClubId);
        localStorage.setItem(DEBUG_RETURN_CLUB_KEY, returnClubId);
        document.body.dataset.screen = "club-home";
        await loadTables().catch((error) => showError(JA_MESSAGES.actionFailed, error));
        render();
      }
      const tableIdFromUrl = normalizeRemoteTableId(new URLSearchParams(location.search).get("tableId"));
      if (tableIdFromUrl) {
        setActiveTableId(tableIdFromUrl);
        document.body.dataset.screen = "club-home";
        await loadSeats().catch((error) => showError(JA_MESSAGES.actionFailed, error));
        startPolling();
      }
      if (initialSettingsPage === "replays") {
        await showSettingsPage("replays").catch((error) => showError(JA_MESSAGES.actionFailed, error));
      }
    }
    renderOnlineGamePanel();
    window.setInterval(() => renderDebug(), DEBUG_RENDER_MS);
    window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      probeGameServer().catch(() => {});
    }, GAME_SERVER_PROBE_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      renderDebug();
      probeGameServer().catch(() => {});
    });
  };
  init().catch((error) => showError(JA_MESSAGES.actionFailed, error));
})();
