import { formatTile, getTileColorClass, type Tile } from "../domain/Tile";
import { getTileImagePath } from "../domain/TileImage";

export type TileViewProps = {
  tile: Tile;
  isDrawnTile?: boolean;
  isTsumogiri?: boolean;
  faceDown?: boolean;
  buttonTileId?: string;
  buttonAction?: "discard" | "nuki";
};

export function renderTileView(props: TileViewProps): string {
  const classes = [
    "tile",
    getTileColorClass(props.tile),
    props.isDrawnTile ? "drawn" : "",
    props.isTsumogiri ? "tsumogiri" : "",
  ].filter(Boolean).join(" ");
  const label = props.faceDown ? "■" : formatTile(props.tile);
  const imagePath = getTileImagePath(props.tile, props.faceDown);
  const content = `
    <img class="tile-image" src="${imagePath}" alt="${label}" onerror="this.hidden=true; this.nextElementSibling.hidden=false;" />
    <span class="tile-fallback" hidden>${label}</span>
  `;

  if (props.buttonTileId) {
    const dataAttribute = props.buttonAction === "nuki" ? "data-nuki-tile-id" : "data-discard-tile-id";
    return `<button class="${classes} tile-button" type="button" ${dataAttribute}="${props.buttonTileId}">${content}</button>`;
  }

  return `<span class="${classes}">${content}</span>`;
}
