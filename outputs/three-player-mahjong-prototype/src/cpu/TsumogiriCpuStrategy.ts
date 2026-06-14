import type { GameState } from "../domain/GameState";
import type { Player } from "../domain/Player";
import type { CpuStrategy } from "./CpuStrategy";

export class TsumogiriCpuStrategy implements CpuStrategy {
  chooseDiscard(_gameState: GameState, player: Player): string {
    if (!player.drawnTile) {
      throw new Error(`CPU player ${player.id} has no drawnTile to discard.`);
    }

    return player.drawnTile.id;
  }
}
