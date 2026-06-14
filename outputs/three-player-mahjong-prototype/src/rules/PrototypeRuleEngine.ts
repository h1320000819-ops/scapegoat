import type { GameState } from "../domain/GameState";
import type { Player } from "../domain/Player";
import type { Tile } from "../domain/Tile";
import { resolvePochiScore, shouldActivatePochi } from "../pochi/PochiResolver";
import { calculateCustomScore } from "../scoring/ScoringCalculator";
import type { ScoreCalculationInput, ScoreResult } from "../scoring/ScoreTypes";
import { evaluateRiichiMahjongWin } from "./RiichiMahjongYaku";
import type { CallCheckResult, KanCheckResult, RuleEngine, WinCheckResult } from "./RuleEngine";

export class PrototypeRuleEngine implements RuleEngine {
  canDraw(state: GameState, player: Player): boolean {
    return (
      (state.phase === "playing" || state.phase === "waitingForHumanDiscard") &&
      state.liveWall.length > 0 &&
      player.status === "active" &&
      !player.drawnTile
    );
  }

  canDiscard(_state: GameState, player: Player, tile: Tile): boolean {
    return player.hand.some((handTile) => handTile.id === tile.id) || player.drawnTile?.id === tile.id;
  }

  canWin(state: GameState, player: Player, tile: Tile | null): WinCheckResult {
    return evaluateRiichiMahjongWin(state, player, tile);
  }

  canCall(_state: GameState, _player: Player, _discardedTile: Tile): CallCheckResult {
    return { canCall: false, callTypes: [], reason: "鳴き判定は未実装です" };
  }

  canKan(state: GameState, _player: Player): KanCheckResult {
    if (state.kanCount >= 4) {
      return { canKan: false, reason: "カンは1局4回までです" };
    }

    return { canKan: true };
  }

  calculateScore(_state: GameState, _winner: Player, input: ScoreCalculationInput): ScoreResult {
    if (shouldActivatePochi(input)) {
      return resolvePochiScore(input);
    }

    return calculateCustomScore({
      ...input,
      doraCount: input.doraCount ?? countIndicatorDora(_state.doraIndicators, input.winningTiles),
    });
  }
}

function getDoraTileTypeFromIndicator(indicator: Tile): string {
  if (indicator.suit === "pinzu" || indicator.suit === "souzu") return `${indicator.suit}-${indicator.rank === 9 ? 1 : (indicator.rank ?? 0) + 1}`;
  if (indicator.suit === "manzu") return `manzu-${indicator.rank === 1 ? 9 : 1}`;
  if (indicator.suit === "flower") return "flower-flower";

  const winds = ["east", "south", "west", "north"];
  const dragons = ["white", "green", "red"];
  if (indicator.kind && winds.includes(indicator.kind)) return `honor-${winds[(winds.indexOf(indicator.kind) + 1) % winds.length]}`;
  if (indicator.kind && dragons.includes(indicator.kind)) return `honor-${dragons[(dragons.indexOf(indicator.kind) + 1) % dragons.length]}`;
  return tileKindKey(indicator);
}

function countIndicatorDora(indicators: Tile[], tiles: Tile[]): number {
  const doraTypes = indicators.map(getDoraTileTypeFromIndicator);
  return tiles.reduce((count, tile) => count + doraTypes.filter((type) => type === tileKindKey(tile)).length, 0);
}

function tileKindKey(tile: Tile): string {
  if (tile.suit === "manzu" || tile.suit === "pinzu" || tile.suit === "souzu") return `${tile.suit}-${tile.rank}`;
  return `${tile.suit}-${tile.kind}`;
}
