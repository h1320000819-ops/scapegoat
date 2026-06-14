import type { GameState } from "../domain/GameState";

export type GameEvent =
  | { type: "game-started"; state: GameState }
  | { type: "tile-drawn"; playerId: string }
  | { type: "tile-discarded"; playerId: string; tileId: string }
  | { type: "state-synced"; state: GameState };

export interface NetworkTransport {
  /**
   * 将来オンライン対戦にするときの境界です。
   * 現時点のControllerはローカルで動きますが、イベント送受信をここに逃がせます。
   */
  publish(event: GameEvent): void;
  subscribe(handler: (event: GameEvent) => void): () => void;
}
