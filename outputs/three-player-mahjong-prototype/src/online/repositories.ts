import type {
  Club,
  ClubId,
  ClubMember,
  ClubPointDelta,
  GameAction,
  GameId,
  GameStateEnvelope,
  PendingActionChoiceRecord,
  PlayerConnection,
  ReplayData,
  ReplayId,
  TableId,
  TableRoom,
  TableSeat,
  UserAccount,
  UserId,
} from "./types";

export type Unsubscribe = () => void;

export interface UserRepository {
  getCurrentUser(): Promise<UserAccount | null>;
  signUp(displayName: string, password: string): Promise<UserAccount>;
  signIn(userId: UserId, password: string): Promise<UserAccount>;
  signOut(): Promise<void>;
  getUser(id: UserId): Promise<UserAccount | null>;
  updateUser(id: UserId, patch: Partial<Pick<UserAccount, "displayName" | "iconUrl">>): Promise<UserAccount>;
}

export interface ClubRepository {
  listMyClubs(userId: UserId): Promise<Array<Club & { myRole: ClubMember["role"] }>>;
  createClub(input: { name: string; ownerUserId: UserId }): Promise<Club>;
  getClub(id: ClubId): Promise<Club | null>;
  searchClub(id: ClubId): Promise<Club | null>;
  requestJoin(clubId: ClubId, userId: UserId): Promise<void>;
  approveJoinRequest(clubId: ClubId, applicantUserId: UserId, adminUserId: UserId): Promise<void>;
  rejectJoinRequest(clubId: ClubId, applicantUserId: UserId, adminUserId: UserId): Promise<void>;
  listMembers(clubId: ClubId): Promise<ClubMember[]>;
}

export interface TableRepository {
  listTablesByClub(clubId: ClubId): Promise<TableRoom[]>;
  getTable(id: TableId): Promise<TableRoom | null>;
  createTable(table: Omit<TableRoom, "id" | "createdAt" | "status">): Promise<TableRoom>;
  updateTable(id: TableId, patch: Partial<TableRoom>): Promise<TableRoom>;
  deleteTable(id: TableId): Promise<void>;
  listSeats(tableId: TableId): Promise<TableSeat[]>;
  sit(tableId: TableId, seatIndex: 0 | 1 | 2, userId: UserId): Promise<void>;
  leave(tableId: TableId, userId: UserId): Promise<void>;
  setLastHand(tableId: TableId, userId: UserId, isLastHandDeclared: boolean): Promise<void>;
  joinWaitingList(tableId: TableId, userId: UserId): Promise<void>;
  leaveWaitingList(tableId: TableId, userId: UserId): Promise<void>;
  tryStartGame(tableId: TableId): Promise<GameStateEnvelope | null>;
  upsertConnection(tableId: TableId, userId: UserId, status: PlayerConnection["status"]): Promise<void>;
  listConnections(tableId: TableId): Promise<PlayerConnection[]>;
  subscribeTable(tableId: TableId, onChange: () => void): Unsubscribe;
}

export interface GameStateRepository {
  getActiveGame(tableId: TableId): Promise<GameStateEnvelope | null>;
  createGame(tableId: TableId, initialState: GameStateEnvelope["state"]): Promise<GameStateEnvelope>;
  saveState(envelope: GameStateEnvelope): Promise<GameStateEnvelope>;
  appendAction(action: GameAction): Promise<GameAction>;
  submitAction(action: GameAction): Promise<GameAction>;
  listActions(gameId: GameId): Promise<GameAction[]>;
  listPendingActions(gameId: GameId): Promise<PendingActionChoiceRecord[]>;
  subscribeGame(gameId: GameId, onChange: (state: GameStateEnvelope) => void): Unsubscribe;
}

export interface ReplayRepository {
  saveReplay(replay: ReplayData): Promise<ReplayData>;
  getReplay(id: ReplayId): Promise<ReplayData | null>;
  listReplays(clubId?: ClubId): Promise<ReplayData[]>;
}

export interface ClubPointRepository {
  applyDeltas(deltas: ClubPointDelta[]): Promise<void>;
  listPointDeltas(clubId: ClubId): Promise<ClubPointDelta[]>;
}

export type AppRepositories = {
  users: UserRepository;
  clubs: ClubRepository;
  tables: TableRepository;
  gameStates: GameStateRepository;
  replays: ReplayRepository;
  clubPoints: ClubPointRepository;
};
