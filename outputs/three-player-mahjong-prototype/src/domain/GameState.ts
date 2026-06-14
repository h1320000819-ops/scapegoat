import type { Player } from "./Player";
import type { Tile } from "./Tile";
import type { ScoreResult } from "../scoring/ScoreTypes";
import type { HandLog } from "../hand-log/HandLog";
import { createEmptyHandLog } from "../hand-log/HandLog";

export type GamePhase =
  | "idle"
  | "dealing"
  | "playing"
  | "waitingForAction"
  | "waitingForHumanDiscard"
  | "waitingForRiichiDiscard"
  | "handEnded"
  | "exhaustiveDraw";

export type PendingActionType = "ron" | "tsumo" | "riichi" | "pon" | "kan";

export type PendingActionOptionPayload = {
  kanType?: "ankan" | "minkan" | "kakan";
  consumedTileIds?: string[];
  allowedDiscardIds?: string[];
  yaku?: import("../scoring/ScoreTypes").YakuResult[];
};

export type ActionOption = {
  type: PendingActionType;
  playerId: string;
  sourceTile?: Tile;
  fromPlayerId?: string;
  options?: PendingActionOptionPayload;
};

export type PendingActionChoice = {
  playerId: string;
  options: ActionOption[];
};

export type PendingAction = ActionOption;

export type PendingActionState = PendingAction | PendingActionChoice;

export type RoundState = {
  roundWind: "east";
  handNumber: number;
  dealerPlayerId: string;
};

export type GameState = {
  players: Player[];
  version: number;
  liveWall: Tile[];
  rinshanWall: Tile[];
  doraIndicators: Tile[];
  uraDoraIndicators: Tile[];
  kanCount: number;
  round: RoundState;
  currentPlayerIndex: number;
  turnIndex: number;
  isWaitingForHumanAction: boolean;
  phase: GamePhase;
  pendingAction: PendingActionState | null;
  lastDrawnTile: Tile | null;
  lastScoreResult: ScoreResult | null;
  cpuThinkingPlayerId: string | null;
  cpuThinkingMessage: string;
  handLog: HandLog;
  log: string[];
};

export function getCurrentPlayer(state: GameState): Player {
  const player = state.players[state.currentPlayerIndex];
  if (!player) {
    throw new Error(`currentPlayerIndex is out of range: ${state.currentPlayerIndex}`);
  }
  return player;
}

export function createInitialGameState(players: Player[]): GameState {
  return {
    players,
    version: 0,
    liveWall: [],
    rinshanWall: [],
    doraIndicators: [],
    uraDoraIndicators: [],
    kanCount: 0,
    round: {
      roundWind: "east",
      handNumber: 1,
      dealerPlayerId: players[0]?.id ?? "",
    },
    currentPlayerIndex: 0,
    turnIndex: 0,
    isWaitingForHumanAction: false,
    phase: "idle",
    pendingAction: null,
    lastDrawnTile: null,
    lastScoreResult: null,
    cpuThinkingPlayerId: null,
    cpuThinkingMessage: "",
    handLog: createEmptyHandLog(),
    log: [],
  };
}
