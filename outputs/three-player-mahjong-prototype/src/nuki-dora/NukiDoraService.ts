import type { GameState } from "../domain/GameState";
import type { Tile } from "../domain/Tile";
import { isFlowerTile, sortHandTiles } from "../domain/TileUtils";

export const RINSHAN_WALL_SIZE = 8;
export const INITIAL_DORA_INDICATOR_SIZE = 1;
export const INITIAL_URA_DORA_INDICATOR_SIZE = 1;

export type NukiDoraResult = {
  nukiTile: Tile;
  replacementTile?: Tile;
};

export function splitStartingWalls(wall: Tile[]): {
  liveWall: Tile[];
  rinshanWall: Tile[];
  doraIndicators: Tile[];
  uraDoraIndicators: Tile[];
} {
  const copied = [...wall];
  const rinshanWall = copied.splice(-RINSHAN_WALL_SIZE);
  const doraIndicators = copied.splice(-INITIAL_DORA_INDICATOR_SIZE);
  const uraDoraIndicators = copied.splice(-INITIAL_URA_DORA_INDICATOR_SIZE);

  return {
    liveWall: copied,
    rinshanWall,
    doraIndicators,
    uraDoraIndicators,
  };
}

export function canNukiDora(state: GameState, playerId: string, options: { requireCurrentTurn?: boolean } = {}): boolean {
  const requireCurrentTurn = options.requireCurrentTurn ?? true;
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  if (requireCurrentTurn && state.players[state.currentPlayerIndex]?.id !== playerId) {
    return false;
  }

  return player.hand.some(isFlowerTile) || Boolean(player.drawnTile && isFlowerTile(player.drawnTile));
}

export function performNukiDora(state: GameState, playerId: string, tileId: string, options: { requireCurrentTurn?: boolean } = {}): boolean {
  return Boolean(performNukiDoraDetailed(state, playerId, tileId, options));
}

export function performNukiDoraDetailed(state: GameState, playerId: string, tileId: string, options: { requireCurrentTurn?: boolean } = {}): NukiDoraResult | null {
  if (!canNukiDora(state, playerId, options)) {
    return null;
  }

  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  const fromDrawnTile = player.drawnTile?.id === tileId && isFlowerTile(player.drawnTile);
  const handTile = player.hand.find((candidate) => candidate.id === tileId);
  const fromHand = Boolean(handTile && isFlowerTile(handTile));

  if (!fromDrawnTile && !fromHand) {
    return null;
  }

  const nukiTile = fromDrawnTile ? player.drawnTile : handTile;
  if (!nukiTile) {
    return null;
  }

  if (fromDrawnTile) {
    player.drawnTile = null;
  } else {
    player.hand = player.hand.filter((candidate) => candidate.id !== tileId);
  }

  player.nukiDoraTiles.push(nukiTile);

  const replacementTile = state.rinshanWall.shift();
  if (replacementTile) {
    if (fromDrawnTile) {
      player.drawnTile = replacementTile;
    } else {
      player.hand.push(replacementTile);
    }
    state.lastDrawnTile = replacementTile;
  }

  player.hand = sortHandTiles(player.hand);
  return replacementTile ? { nukiTile, replacementTile } : { nukiTile };
}

export function autoNukiDora(state: GameState, playerId: string, options: { requireCurrentTurn?: boolean } = {}): number {
  let nukiCount = 0;
  let player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  while (canNukiDora(state, playerId, options)) {
    const flowerTile = player.drawnTile && isFlowerTile(player.drawnTile) ? player.drawnTile : player.hand.find(isFlowerTile);
    if (!flowerTile || !performNukiDoraDetailed(state, playerId, flowerTile.id, options)) {
      break;
    }

    nukiCount += 1;
    player = state.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      break;
    }
  }

  return nukiCount;
}
