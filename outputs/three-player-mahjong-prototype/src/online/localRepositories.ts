import type { AppRepositories, Unsubscribe } from "./repositories";
import type {
  Club,
  ClubMember,
  ClubPointDelta,
  GameAction,
  GameStateEnvelope,
  PendingActionChoiceRecord,
  PlayerConnection,
  ReplayData,
  TableRoom,
  TableSeat,
  UserAccount,
} from "./types";

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = <T>(key: string, value: T): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

const keys = {
  currentUser: "anmikaRocket.currentUser",
  users: "anmikaRocket.users",
  clubs: "anmikaRocket.clubs",
  clubMembers: "anmikaRocket.clubMembers",
  tables: "anmikaRocket.tables",
  seats: "anmikaRocket.tableSeats",
  waiting: "anmikaRocket.tableWaitingList",
  connections: "anmikaRocket.playerConnections",
  pendingActions: "anmikaRocket.pendingActions",
  games: "anmikaRocket.gameStates",
  actions: "anmikaRocket.gameActions",
  replays: "anmikaRocket.replays",
  points: "anmikaRocket.clubPoints",
};

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => Date.now();

export function createLocalRepositories(): AppRepositories {
  return {
    users: {
      async getCurrentUser() { return readJson<UserAccount | null>(keys.currentUser, null); },
      async signUp(displayName) {
        const users = readJson<UserAccount[]>(keys.users, []);
        const user = { id: id("P"), displayName, createdAt: now() };
        users.push(user);
        writeJson(keys.users, users);
        writeJson(keys.currentUser, user);
        return user;
      },
      async signIn(userId) {
        const user = readJson<UserAccount[]>(keys.users, []).find((item) => item.id === userId);
        if (!user) throw new Error("user not found");
        writeJson(keys.currentUser, user);
        return user;
      },
      async signOut() { localStorage.removeItem(keys.currentUser); },
      async getUser(userId) { return readJson<UserAccount[]>(keys.users, []).find((user) => user.id === userId) ?? null; },
      async updateUser(userId, patch) {
        const users = readJson<UserAccount[]>(keys.users, []);
        const index = users.findIndex((user) => user.id === userId);
        if (index < 0) throw new Error("user not found");
        users[index] = { ...users[index]!, ...patch };
        writeJson(keys.users, users);
        writeJson(keys.currentUser, users[index]);
        return users[index]!;
      },
    },
    clubs: {
      async listMyClubs(userId) {
        const clubs = readJson<Club[]>(keys.clubs, []);
        const members = readJson<ClubMember[]>(keys.clubMembers, []);
        return clubs
          .map((club) => ({ club, member: members.find((item) => item.clubId === club.id && item.userId === userId) }))
          .filter((item): item is { club: Club; member: ClubMember } => Boolean(item.member))
          .map(({ club, member }) => ({ ...club, myRole: member.role }));
      },
      async createClub(input) {
        const clubs = readJson<Club[]>(keys.clubs, []);
        if (clubs.some((club) => club.ownerUserId === input.ownerUserId)) throw new Error("club creation limit exceeded");
        const club = { id: id("C"), name: input.name, ownerUserId: input.ownerUserId, createdAt: now() };
        clubs.push(club);
        writeJson(keys.clubs, clubs);
        const members = readJson<ClubMember[]>(keys.clubMembers, []);
        members.push({ clubId: club.id, userId: input.ownerUserId, role: "admin", pointBalance: 0, joinedAt: now() });
        writeJson(keys.clubMembers, members);
        return club;
      },
      async getClub(clubId) { return readJson<Club[]>(keys.clubs, []).find((club) => club.id === clubId) ?? null; },
      async searchClub(clubId) { return this.getClub(clubId); },
      async requestJoin() {},
      async approveJoinRequest(clubId, applicantUserId) {
        const members = readJson<ClubMember[]>(keys.clubMembers, []);
        if (!members.some((member) => member.clubId === clubId && member.userId === applicantUserId)) {
          members.push({ clubId, userId: applicantUserId, role: "member", pointBalance: 0, joinedAt: now() });
          writeJson(keys.clubMembers, members);
        }
      },
      async rejectJoinRequest() {},
      async listMembers(clubId) { return readJson<ClubMember[]>(keys.clubMembers, []).filter((member) => member.clubId === clubId); },
    },
    tables: {
      async listTablesByClub(clubId) { return readJson<TableRoom[]>(keys.tables, []).filter((table) => table.clubId === clubId); },
      async getTable(tableId) { return readJson<TableRoom[]>(keys.tables, []).find((table) => table.id === tableId) ?? null; },
      async createTable(table) {
        const tables = readJson<TableRoom[]>(keys.tables, []);
        const created = { ...table, id: id("table"), status: "waiting" as const, createdAt: now() };
        tables.unshift(created);
        writeJson(keys.tables, tables);
        const seats = readJson<TableSeat[]>(keys.seats, []);
        for (const seatIndex of [0, 1, 2] as const) {
          seats.push({ tableId: created.id, seatIndex, playerType: "empty", isLastHandDeclared: false, updatedAt: now() });
        }
        writeJson(keys.seats, seats);
        return created;
      },
      async updateTable(tableId, patch) {
        const tables = readJson<TableRoom[]>(keys.tables, []);
        const index = tables.findIndex((table) => table.id === tableId);
        if (index < 0) throw new Error("table not found");
        tables[index] = { ...tables[index]!, ...patch };
        writeJson(keys.tables, tables);
        return tables[index]!;
      },
      async deleteTable(tableId) { writeJson(keys.tables, readJson<TableRoom[]>(keys.tables, []).filter((table) => table.id !== tableId)); },
      async listSeats(tableId) { return readJson<TableSeat[]>(keys.seats, []).filter((seat) => seat.tableId === tableId); },
      async sit(tableId, seatIndex, userId) {
        const seats = readJson<TableSeat[]>(keys.seats, []);
        const seat = seats.find((item) => item.tableId === tableId && item.seatIndex === seatIndex);
        if (!seat || (seat.userId && seat.playerType !== "cpu")) throw new Error("seat unavailable");
        seat.userId = userId;
        seat.playerType = "human";
        delete seat.displayName;
        seat.updatedAt = now();
        writeJson(keys.seats, seats);
      },
      async leave(tableId, userId) {
        const seats = readJson<TableSeat[]>(keys.seats, []);
        for (const seat of seats) {
          if (seat.tableId === tableId && seat.userId === userId) {
            delete seat.userId;
            seat.playerType = "empty";
            delete seat.displayName;
            seat.isLastHandDeclared = false;
            seat.updatedAt = now();
          }
        }
        writeJson(keys.seats, seats);
      },
      async setLastHand(tableId, userId, isLastHandDeclared) {
        const seats = readJson<TableSeat[]>(keys.seats, []);
        const seat = seats.find((item) => item.tableId === tableId && item.userId === userId);
        if (seat) seat.isLastHandDeclared = isLastHandDeclared;
        writeJson(keys.seats, seats);
      },
      async joinWaitingList(tableId, userId) {
        const list = readJson<Array<{ tableId: string; userId: string }>>(keys.waiting, []);
        if (!list.some((item) => item.tableId === tableId && item.userId === userId)) list.push({ tableId, userId });
        writeJson(keys.waiting, list);
      },
      async leaveWaitingList(tableId, userId) {
        writeJson(keys.waiting, readJson<Array<{ tableId: string; userId: string }>>(keys.waiting, []).filter((item) => !(item.tableId === tableId && item.userId === userId)));
      },
      async tryStartGame(tableId) {
        const tables = readJson<TableRoom[]>(keys.tables, []);
        const table = tables.find((item) => item.id === tableId);
        if (!table || table.status !== "waiting") return null;
        const seats = readJson<TableSeat[]>(keys.seats, []).filter((seat) => seat.tableId === tableId);
        if (seats.some((seat) => seat.playerType === "cpu")) return null;
        if (seats.filter((seat) => seat.userId && seat.playerType === "human").length !== 3) return null;
        table.status = "playing";
        writeJson(keys.tables, tables);
        const existing = readJson<GameStateEnvelope[]>(keys.games, []).find((game) => game.tableId === tableId);
        if (existing) return existing;
        const envelope: GameStateEnvelope = {
          gameId: id("game"),
          tableId,
          version: 0,
          state: { version: 0, phase: "waitingForServerDeal", players: seats } as unknown as GameStateEnvelope["state"],
          updatedAt: now(),
        };
        writeJson(keys.games, [...readJson<GameStateEnvelope[]>(keys.games, []), envelope]);
        return envelope;
      },
      async upsertConnection(tableId, userId, status) {
        const connections = readJson<PlayerConnection[]>(keys.connections, []);
        const existing = connections.find((item) => item.tableId === tableId && item.userId === userId);
        if (existing) {
          existing.status = status;
          existing.lastSeenAt = now();
        } else {
          connections.push({ tableId, userId, status, lastSeenAt: now() });
        }
        writeJson(keys.connections, connections);
      },
      async listConnections(tableId) {
        return readJson<PlayerConnection[]>(keys.connections, []).filter((item) => item.tableId === tableId);
      },
      subscribeTable(): Unsubscribe { return () => {}; },
    },
    gameStates: {
      async getActiveGame(tableId) { return readJson<GameStateEnvelope[]>(keys.games, []).find((game) => game.tableId === tableId) ?? null; },
      async createGame(tableId, initialState) {
        const games = readJson<GameStateEnvelope[]>(keys.games, []);
        const game = { gameId: id("game"), tableId, version: initialState.version ?? 0, state: initialState, updatedAt: now() };
        games.push(game);
        writeJson(keys.games, games);
        return game;
      },
      async saveState(envelope) {
        const games = readJson<GameStateEnvelope[]>(keys.games, []);
        const index = games.findIndex((game) => game.gameId === envelope.gameId);
        if (index >= 0) games[index] = envelope;
        else games.push(envelope);
        writeJson(keys.games, games);
        return envelope;
      },
      async appendAction(action) {
        const actions = readJson<GameAction[]>(keys.actions, []);
        const saved = { ...action, id: action.id ?? id("event"), createdAt: now() };
        actions.push(saved);
        writeJson(keys.actions, actions);
        return saved;
      },
      async submitAction(action) {
        const games = readJson<GameStateEnvelope[]>(keys.games, []);
        const game = games.find((item) => item.gameId === action.gameId && item.tableId === action.tableId);
        if (!game) throw new Error("active game not found");
        if (game.version !== action.turnVersion) throw new Error("stale turn_version");
        const actions = readJson<GameAction[]>(keys.actions, []);
        const saved = { ...action, id: action.id ?? id("event"), createdAt: now() };
        actions.push(saved);
        writeJson(keys.actions, actions);
        game.version += 1;
        game.state = { ...game.state, version: game.version, lastAction: saved } as GameStateEnvelope["state"];
        game.updatedAt = now();
        writeJson(keys.games, games);
        return saved;
      },
      async listActions(gameId) { return readJson<GameAction[]>(keys.actions, []).filter((action) => action.gameId === gameId); },
      async listPendingActions(gameId) {
        return readJson<PendingActionChoiceRecord[]>(keys.pendingActions, []).filter((item) => item.gameId === gameId && !item.selectedActionId);
      },
      subscribeGame(): Unsubscribe { return () => {}; },
    },
    replays: {
      async saveReplay(replay) {
        const replays = [replay, ...readJson<ReplayData[]>(keys.replays, [])].slice(0, 200);
        writeJson(keys.replays, replays);
        return replay;
      },
      async getReplay(replayId) { return readJson<ReplayData[]>(keys.replays, []).find((replay) => replay.replayId === replayId) ?? null; },
      async listReplays(clubId) { return readJson<ReplayData[]>(keys.replays, []).filter((replay) => !clubId || replay.clubId === clubId); },
    },
    clubPoints: {
      async applyDeltas(deltas) { writeJson(keys.points, [...deltas, ...readJson<ClubPointDelta[]>(keys.points, [])]); },
      async listPointDeltas(clubId) { return readJson<ClubPointDelta[]>(keys.points, []).filter((delta) => delta.clubId === clubId); },
    },
  };
}
