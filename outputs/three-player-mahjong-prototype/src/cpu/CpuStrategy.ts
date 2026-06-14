import type { GameState } from "../domain/GameState";
import type { Player } from "../domain/Player";

export type CpuStrategy = {
  chooseDiscard(gameState: GameState, player: Player): string;
  shouldDeclareRiichi?(gameState: GameState, player: Player): boolean;
  shouldCall?(gameState: GameState, player: Player): boolean;
  shouldKan?(gameState: GameState, player: Player): boolean;
};
