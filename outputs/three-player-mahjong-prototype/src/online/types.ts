import type { GameState } from "../domain/GameState";

export type UserId = string;
export type ClubId = string;
export type TableId = string;
export type GameId = string;
export type ReplayId = string;

export type UserAccount = {
  id: UserId;
  displayName: string;
  iconUrl?: string;
  createdAt: number;
};

export type ClubRole = "admin" | "member";

export type Club = {
  id: ClubId;
  name: string;
  ownerUserId: UserId;
  createdAt: number;
};

export type ClubMember = {
  clubId: ClubId;
  userId: UserId;
  role: ClubRole;
  pointBalance: number;
  joinedAt: number;
};

export type TableStatus = "waiting" | "playing" | "ended";

export type TableSeat = {
  tableId: TableId;
  seatIndex: 0 | 1 | 2;
  userId?: UserId;
  playerType: "empty" | "human" | "cpu";
  displayName?: string;
  isLastHandDeclared: boolean;
  updatedAt: number;
};

export type TableRoom = {
  id: TableId;
  clubId: ClubId;
  name: string;
  status: TableStatus;
  ruleId: string;
  pointRate: number;
  rakePercent: number;
  createdBy: UserId;
  createdAt: number;
};

export type GameActionType =
  | "discard"
  | "ron"
  | "tsumo"
  | "pon"
  | "kan"
  | "riichi"
  | "skip"
  | "nukiDora";

export type GameAction = {
  id?: string;
  gameId: GameId;
  tableId: TableId;
  playerId: UserId;
  type: GameActionType;
  turnVersion: number;
  payload?: Record<string, unknown>;
  createdAt?: number;
};

export type PendingActionChoiceRecord = {
  id: string;
  gameId: GameId;
  tableId: TableId;
  playerId: UserId;
  turnVersion: number;
  options: Array<{
    type: GameActionType;
    payload?: Record<string, unknown>;
  }>;
  selectedActionId?: string;
  expiresAt: number;
  createdAt: number;
};

export type GameStateEnvelope = {
  gameId: GameId;
  tableId: TableId;
  version: number;
  state: GameState;
  updatedAt: number;
};

export type PlayerConnectionStatus = "online" | "reconnecting" | "offline";

export type PlayerConnection = {
  tableId: TableId;
  userId: UserId;
  status: PlayerConnectionStatus;
  lastSeenAt: number;
};

export type TableRealtimeStatus = {
  connected: boolean;
  lastSyncedAt?: number;
  lastError?: string;
};

export type ReplayData = {
  replayId: ReplayId;
  clubId?: ClubId;
  tableId?: TableId;
  gameId?: GameId;
  summary: Record<string, unknown>;
  initialState: unknown;
  events: unknown[];
  snapshots: unknown[];
  createdAt: number;
};

export type ClubPointDelta = {
  clubId: ClubId;
  userId: UserId;
  amount: number;
  reason: string;
  gameId?: GameId;
  createdAt: number;
};
