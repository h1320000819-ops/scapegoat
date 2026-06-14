import type { PochiColor, Tile } from "../domain/Tile";

export type LimitType = "通常" | "満貫" | "跳満" | "倍満" | "三倍満" | "役満";
export type WinType = "ron" | "tsumo";

export type PaymentDelta = {
  playerId: string;
  delta: number;
};

export type YakuResult = {
  name: string;
  han: number;
  isYakuman?: boolean;
  detail?: string;
};

export type DoraDetail = {
  name: string;
  han: number;
};

export type ScoreCalculationInput = {
  winnerId: string;
  dealerPlayerId: string;
  playerIds: string[];
  winType: WinType;
  discarderId?: string;
  yaku: YakuResult[];
  winningTiles: Tile[];
  doraCount?: number;
  nukiDoraCount?: number;
  uraDoraCount?: number;
  honba?: number;
  isIppatsu?: boolean;
  isCountedYakuman?: boolean;
  selectedWait?: Tile;
  isRiichi?: boolean;
  drawnTile?: Tile;
  waitingTiles?: Tile[];
};

export type ScoreResult = {
  yakuHan: number;
  doraHan: number;
  totalHan: number;
  han: number;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  finalPoints: number;
  beforeMultiplierPoints?: number;
  afterMultiplierPoints?: number;
  limitType: LimitType;
  isDealer: boolean;
  isTsumo: boolean;
  paymentPerPlayer?: number;
  winnerGain: number;
  payments: Record<string, number>;
  paymentDeltas?: PaymentDelta[];
  selectedWait: Tile;
  pochiActivated: boolean;
  pochiColor?: PochiColor;
  pointMultiplier: number;
  yaku: YakuResult[];
  yakuList: YakuResult[];
  doraDetails: DoraDetail[];
  dora: {
    normal: number;
    colored: number;
    nuki: number;
    ura: number;
  };
  bonuses: {
    goldTile: number;
    blueTile: number;
    uraDora: number;
    honba: number;
    ippatsu: number;
    countedYakuman: number;
    realYakuman: number;
  };
};
