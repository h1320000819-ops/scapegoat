export type TileSuit = "manzu" | "pinzu" | "souzu" | "honor" | "flower";
export type TileColor = "normal" | "red" | "gold" | "blue" | "turquoise";
export type HonorTileKind = "east" | "south" | "west" | "north" | "white" | "green" | "red";
export type PochiColor = "red" | "yellow" | "green" | "blue";

export type Tile = {
  /** Physical tile instance id. Copies of the same tile kind still need unique ids. */
  id: string;
  suit: TileSuit;
  /** Number tiles use rank. Honor and flower tiles use kind. */
  rank?: number;
  kind?: HonorTileKind | "flower";
  color: TileColor;
  isPochi: boolean;
  pochiColor?: PochiColor;
  isRocket?: boolean;
};

export function formatTile(tile: Tile): string {
  if (tile.suit === "honor") {
    if (tile.kind === "white" && tile.pochiColor) {
      const pochiLabels: Record<PochiColor, string> = {
        red: "赤ぽっち",
        yellow: "黄ぽっち",
        green: "緑ぽっち",
        blue: "青ぽっち",
      };
      return pochiLabels[tile.pochiColor];
    }

    const honorLabels: Record<HonorTileKind, string> = {
      east: "東",
      south: "南",
      west: "西",
      north: "北",
      white: "白",
      green: "發",
      red: "中",
    };
    return honorLabels[tile.kind as HonorTileKind];
  }

  if (tile.suit === "flower") {
    const colorPrefix = tile.color === "normal" ? "" : getColorLabel(tile.color);
    return `${colorPrefix}華`;
  }

  const suitLabels: Record<Exclude<TileSuit, "honor" | "flower">, string> = {
    manzu: "萬",
    pinzu: "筒",
    souzu: "索",
  };
  const colorPrefix = tile.color === "normal" ? "" : getColorLabel(tile.color);
  return `${tile.isRocket ? "ロケット" : colorPrefix}${tile.rank}${suitLabels[tile.suit]}`;
}

export function getTileColorClass(tile: Tile): string {
  if (tile.color === "red") return "tile-red";
  if (tile.color === "blue") return "tile-blue";
  if (tile.color === "gold") return "tile-gold";
  if (tile.color === "turquoise") return "tile-turquoise";
  if (tile.isPochi && tile.pochiColor) return `tile-pochi-${tile.pochiColor}`;
  return "tile-normal";
}

function getColorLabel(color: TileColor): string {
  const labels: Record<TileColor, string> = {
    normal: "",
    red: "赤",
    gold: "金",
    blue: "青",
    turquoise: "ターコイズ",
  };
  return labels[color];
}
