import type { GameState } from "../domain/GameState";
import type { Player } from "../domain/Player";
import type { Tile } from "../domain/Tile";
import type { ScoreCalculationInput, ScoreResult, YakuResult } from "../scoring/ScoreTypes";

export type WinCheckResult = {
  canWin: boolean;
  yaku?: YakuResult[];
  han?: number;
  handType?: "standard" | "sevenPairs" | "kokushi";
  reason?: string;
};

export type CallCheckResult = {
  canCall: boolean;
  callTypes: string[];
  reason?: string;
};

export type KanCheckResult = {
  canKan: boolean;
  reason?: string;
};

/**
 * 独自ルールの差し替え境界です。
 * 役、鳴き、点数、ツモ可否などはGameControllerへ直書きせず、必ずここを通します。
 */
export interface RuleEngine {
  canDraw(state: GameState, player: Player): boolean;
  canDiscard(state: GameState, player: Player, tile: Tile): boolean;
  canWin(state: GameState, player: Player, tile: Tile | null): WinCheckResult;
  canCall(state: GameState, player: Player, discardedTile: Tile): CallCheckResult;
  canKan(state: GameState, player: Player): KanCheckResult;
  calculateScore(state: GameState, winner: Player, input: ScoreCalculationInput): ScoreResult;
}
