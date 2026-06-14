import type { PochiColor, Tile } from "./Tile";

const POCHI_IMAGE_NAMES: Record<PochiColor, string> = {
  red: "haku_red",
  yellow: "haku_yellow",
  green: "haku_green",
  blue: "haku_blue",
};

function getTileAssetPath(fileName: string): string {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return `./public/tiles/${fileName}`;
  }

  return `/tiles/${fileName}`;
}

export function getTileImagePath(tile: Tile, faceDown = false): string {
  if (faceDown) {
    return getTileAssetPath("tile_back.png");
  }

  if (tile.isRocket && tile.suit === "manzu") {
    return getTileAssetPath(`man${tile.rank}_rocket.jpg`);
  }

  if (tile.isRocket && tile.suit === "pinzu") {
    return getTileAssetPath(`pin${tile.rank}_rocket.jpg`);
  }

  if (tile.isRocket && tile.suit === "souzu") {
    return getTileAssetPath(`sou${tile.rank}_rocket.jpg`);
  }

  if (tile.suit === "manzu") {
    return getTileAssetPath(`man${tile.rank}.png`);
  }

  if (tile.suit === "pinzu" && tile.color === "turquoise") {
    return getTileAssetPath(`pin${tile.rank}_turquoise.jpg`);
  }

  if (tile.suit === "pinzu") {
    return getTileAssetPath(`pin${tile.rank}${getColorSuffix(tile)}.png`);
  }

  if (tile.suit === "souzu") {
    return getTileAssetPath(`sou${tile.rank}${getColorSuffix(tile)}.png`);
  }

  if (tile.suit === "flower") {
    return getTileAssetPath(`flower${getColorSuffix(tile)}.png`);
  }

  if (tile.kind === "white" && tile.pochiColor) {
    return getTileAssetPath(`${POCHI_IMAGE_NAMES[tile.pochiColor]}.png`);
  }

  const honorNames = {
    east: "east",
    south: "south",
    west: "west",
    north: "north",
    white: "haku",
    green: "hatsu",
    red: "chun",
  } as const;

  return getTileAssetPath(`${honorNames[tile.kind as keyof typeof honorNames]}.png`);
}

function getColorSuffix(tile: Tile): string {
  if (tile.color === "normal") {
    return "";
  }

  return `_${tile.color}`;
}
