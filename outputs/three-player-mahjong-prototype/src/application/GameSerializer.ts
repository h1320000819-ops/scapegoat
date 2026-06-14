import type { GameState } from "../domain/GameState";

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGameState(serialized: string): GameState {
  return JSON.parse(serialized) as GameState;
}
