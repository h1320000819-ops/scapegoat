import type { HonorTileKind, PochiColor, Tile, TileColor, TileSuit } from "./Tile";

const COPIES_PER_TILE = 4;
export const THREE_PLAYER_MAHJONG_WALL_SIZE = 112;

type NumberTileSpec = {
  suit: Extract<TileSuit, "manzu" | "pinzu" | "souzu">;
  ranks: number[];
};

const NUMBER_TILE_SPECS: NumberTileSpec[] = [
  { suit: "manzu", ranks: [1, 9] },
  { suit: "pinzu", ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { suit: "souzu", ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
];

const HONOR_TILE_KINDS: HonorTileKind[] = ["east", "south", "west", "north", "white", "green", "red"];
const POCHI_COLORS: PochiColor[] = ["red", "yellow", "green", "blue"];

/**
 * 現在の独自3人麻雀で唯一正しい牌構成を生成します。
 * 白4枚はすべて白ぽっちで、通常時は白として扱います。
 */
export function createWallTiles(): Tile[] {
  const tiles: Tile[] = [];

  for (const spec of NUMBER_TILE_SPECS) {
    for (const rank of spec.ranks) {
      for (let copy = 1; copy <= COPIES_PER_TILE; copy += 1) {
        tiles.push({
          id: `${spec.suit}-${rank}-${copy}`,
          suit: spec.suit,
          rank,
          color: getNumberTileColor(spec.suit, rank, copy),
          isPochi: false,
        });
      }
    }
  }

  for (const kind of HONOR_TILE_KINDS) {
    for (let copy = 1; copy <= COPIES_PER_TILE; copy += 1) {
      tiles.push(createHonorTile(kind, copy));
    }
  }

  for (let copy = 1; copy <= COPIES_PER_TILE; copy += 1) {
    tiles.push({
      id: `flower-hua-${copy}`,
      suit: "flower",
      kind: "flower",
      color: copy <= 3 ? "red" : "blue",
      isPochi: false,
    });
  }

  if (tiles.length !== THREE_PLAYER_MAHJONG_WALL_SIZE) {
    throw new Error(`Invalid wall size: expected ${THREE_PLAYER_MAHJONG_WALL_SIZE}, got ${tiles.length}`);
  }

  return tiles;
}

export function createShuffledWall(): Tile[] {
  return shuffleTiles(createWallTiles());
}

export function shuffleTiles<T>(items: T[]): T[] {
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
}

export function createPlainWhiteTile(): Tile {
  return {
    id: "candidate-honor-white",
    suit: "honor",
    kind: "white",
    color: "normal",
    isPochi: false,
  };
}

export function createCandidateFiveTile(
  suit: Extract<TileSuit, "pinzu" | "souzu">,
  color: Extract<TileColor, "red" | "gold" | "blue">,
): Tile {
  return {
    id: `candidate-${color}-5-${suit}`,
    suit,
    rank: 5,
    color,
    isPochi: false,
  };
}

function createHonorTile(kind: HonorTileKind, copy: number): Tile {
  if (kind === "white") {
    const pochiColor = POCHI_COLORS[copy - 1];
    if (!pochiColor) {
      throw new Error(`Invalid pochi copy: ${copy}`);
    }

    return {
      id: `honor-white-${copy}`,
      suit: "honor",
      kind: "white",
      color: "normal",
      isPochi: true,
      pochiColor,
    };
  }

  return {
    id: `honor-${kind}-${copy}`,
    suit: "honor",
    kind,
    color: "normal",
    isPochi: false,
  };
}

function getNumberTileColor(suit: TileSuit, rank: number, copy: number): TileColor {
  const isColoredFive = rank === 5 && (suit === "pinzu" || suit === "souzu");
  if (!isColoredFive) {
    return "normal";
  }

  if (copy <= 2) {
    return "red";
  }

  if (copy === 3) {
    return "gold";
  }

  return "blue";
}
