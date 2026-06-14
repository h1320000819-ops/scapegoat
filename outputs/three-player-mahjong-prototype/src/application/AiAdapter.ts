import type { GameState } from "../domain/GameState";
import type { Player } from "../domain/Player";
import type { Tile } from "../domain/Tile";

export type AiDecision =
  | { type: "discard"; tile: Tile }
  | { type: "pass" };

export interface AiPlayerAdapter {
  /**
   * 将来AIを差し込むための境界です。
   * GameStateを入力にして判断させることで、ローカルAIにもサーバーAIにも置き換えられます。
   */
  decide(state: GameState, player: Player): Promise<AiDecision>;
}
