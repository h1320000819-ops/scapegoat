import type { DiscardType } from "../domain/Player";
import type { Tile } from "../domain/Tile";
import type { PaymentDelta, ScoreResult } from "../scoring/ScoreTypes";

export type HandResult =
  | { type: "win"; winnerId: string; loserId?: string; winType: "ron" | "tsumo"; scoreResult: ScoreResult; payments?: PaymentDelta[] }
  | {
      type: "exhaustiveDraw";
      reason: "liveWallEmpty";
      tenpaiPlayerIds?: string[];
      notenPlayerIds?: string[];
      payments?: PaymentDelta[];
      finalScores?: Record<string, number>;
    };

export type DrawEvent = {
  type: "draw";
  playerId: string;
  tile: Tile;
  from: "liveWall" | "rinshanWall";
  turnIndex: number;
};

export type DiscardEvent = {
  type: "discard";
  playerId: string;
  tile: Tile;
  discardType: DiscardType;
  turnIndex: number;
  isCpuAction: boolean;
};

export type NukiDoraEvent = {
  type: "nukiDora";
  playerId: string;
  tile: Tile;
  replacementTile?: Tile;
  turnIndex: number;
  isAfterRiichi: boolean;
  ippatsuPreserved: boolean;
};

export type RiichiEvent = {
  type: "riichi";
  playerId: string;
  turnIndex: number;
};

export type WinEvent = {
  type: "win";
  winnerId: string;
  loserId?: string;
  winType: "ron" | "tsumo";
  winningTile: Tile;
  scoreResult: ScoreResult;
  turnIndex: number;
};

export type RonEvent = {
  type: "ron";
  playerId: string;
  fromPlayerId: string;
  tile: Tile;
  scoreResult: ScoreResult;
  turnIndex: number;
};

export type TsumoEvent = {
  type: "tsumo";
  playerId: string;
  tile: Tile;
  scoreResult: ScoreResult;
  turnIndex: number;
};

export type PonEvent = {
  type: "pon";
  playerId: string;
  fromPlayerId: string;
  tile: Tile;
  consumedTiles: Tile[];
  turnIndex: number;
};

export type SkipActionEvent = {
  type: "skipAction";
  playerId: string;
  actionType: "ron" | "tsumo" | "riichi" | "pon" | "kan";
  turnIndex: number;
};

export type ExhaustiveDrawEvent = {
  type: "exhaustiveDraw";
  turnIndex: number;
  reason: "liveWallEmpty";
};

export type KanEvent = {
  type: "kan";
  playerId: string;
  fromPlayerId?: string;
  tiles: Tile[];
  kanType: "ankan" | "minkan" | "kakan";
  turnIndex: number;
};

export type DoraRevealEvent = {
  type: "doraReveal";
  tile: Tile;
  doraIndicators: Tile[];
  turnIndex: number;
  reason: "initial" | "kan";
};

export type HandLogEvent =
  | DrawEvent
  | DiscardEvent
  | NukiDoraEvent
  | RiichiEvent
  | WinEvent
  | RonEvent
  | TsumoEvent
  | PonEvent
  | SkipActionEvent
  | ExhaustiveDrawEvent
  | KanEvent
  | DoraRevealEvent;

export type HandLog = {
  handId: string;
  roundLabel: string;
  dealerId: string;
  events: HandLogEvent[];
  initialHands: Record<string, Tile[]>;
  initialDoraIndicators: Tile[];
  initialScores: Record<string, number>;
  result?: HandResult;
};

export function createEmptyHandLog(): HandLog {
  return {
    handId: "not-started",
    roundLabel: "東場 第1局",
    dealerId: "",
    events: [],
    initialHands: {},
    initialDoraIndicators: [],
    initialScores: {},
  };
}

export function appendHandLogEvent(handLog: HandLog, event: HandLogEvent): void {
  handLog.events.push(event);
}
