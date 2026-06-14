import { getCurrentPlayer, type GameState } from "../domain/GameState";
import type { CpuStrategy } from "./CpuStrategy";

export type CpuTurnActions = {
  drawTileForCpu: () => void;
  autoNukiDoraForCurrentTurn: () => void;
  discardTileForCpu: (tileId: string) => void;
};

export function processCpuTurn(gameState: GameState, strategy: CpuStrategy, actions: CpuTurnActions): void {
  const player = getCurrentPlayer(gameState);
  if (player.type !== "cpu") {
    return;
  }

  if (!player.drawnTile) {
    actions.drawTileForCpu();
  }
  actions.autoNukiDoraForCurrentTurn();

  if (player.drawnTile) {
    actions.discardTileForCpu(strategy.chooseDiscard(gameState, player));
  }
}
