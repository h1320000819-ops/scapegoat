import type { Tile } from "./Tile";

export type PlayerStatus = "waiting" | "active" | "declared-win" | "disconnected";
export type DiscardType = "tedashi" | "tsumogiri";
export type PlayerType = "human" | "cpu";

export type DiscardedTile = {
  tile: Tile;
  discardType: DiscardType;
  turnIndex: number;
};

export type MeldType = "pon" | "ankan" | "minkan" | "kakan";

export type Meld = {
  type: MeldType;
  tiles: Tile[];
  fromPlayerId?: string;
};

export type Player = {
  id: string;
  name: string;
  type: PlayerType;
  score: number;
  hand: Tile[];
  drawnTile: Tile | null;
  discardedTiles: DiscardedTile[];
  nukiDoraTiles: Tile[];
  melds: Meld[];
  status: PlayerStatus;
  isRiichi: boolean;
  ippatsu: boolean;
  riichiTurnIndex: number | null;
  ippatsuOwnDrawStarted: boolean;
  sameTurnFuriten: boolean;
  riichiDiscardTileIds: string[];
};

export function createPlayer(id: string, name: string, type: PlayerType = "human", initialScore = 0): Player {
  return {
    id,
    name,
    type,
    score: initialScore,
    hand: [],
    drawnTile: null,
    discardedTiles: [],
    nukiDoraTiles: [],
    melds: [],
    status: "waiting",
    isRiichi: false,
    ippatsu: false,
    riichiTurnIndex: null,
    ippatsuOwnDrawStarted: false,
    sameTurnFuriten: false,
    riichiDiscardTileIds: [],
  };
}
