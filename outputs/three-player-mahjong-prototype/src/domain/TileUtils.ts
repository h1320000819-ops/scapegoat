import type { HonorTileKind, Tile, TileSuit } from "./Tile";

const SUIT_ORDER: Record<TileSuit, number> = {
  manzu: 0,
  pinzu: 1,
  souzu: 2,
  honor: 3,
  flower: 4,
};

const HONOR_ORDER: Record<HonorTileKind, number> = {
  east: 0,
  south: 1,
  west: 2,
  north: 3,
  white: 4,
  green: 5,
  red: 6,
};

export function isFlowerTile(tile: Tile): boolean {
  return tile.suit === "flower" && tile.kind === "flower";
}

export function getHandTilesForHandEvaluation(hand: Tile[]): Tile[] {
  return hand.filter((tile) => !isFlowerTile(tile));
}

export function sortHandTiles(hand: Tile[]): Tile[] {
  return [...hand].sort(compareTilesForHand);
}

function compareTilesForHand(left: Tile, right: Tile): number {
  const suitDiff = SUIT_ORDER[left.suit] - SUIT_ORDER[right.suit];
  if (suitDiff !== 0) {
    return suitDiff;
  }

  if (left.suit === "honor" && right.suit === "honor") {
    const leftOrder = left.kind ? HONOR_ORDER[left.kind as HonorTileKind] : 99;
    const rightOrder = right.kind ? HONOR_ORDER[right.kind as HonorTileKind] : 99;
    return leftOrder - rightOrder;
  }

  return (left.rank ?? 0) - (right.rank ?? 0);
}
