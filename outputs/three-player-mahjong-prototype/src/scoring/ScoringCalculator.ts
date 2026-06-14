import type { Tile } from "../domain/Tile";
import { getBaseScoreFromHan } from "./ScoreTables";
import type { DoraDetail, ScoreCalculationInput, ScoreResult } from "./ScoreTypes";

const GOLD_TILE_BONUS = 5;
const BLUE_TILE_BONUS = 20;
const URA_DORA_BONUS = 5;
const HONBA_BONUS = 5;
const IPPATSU_BONUS = 5;
const COUNTED_YAKUMAN_BONUS = 20;
const REAL_YAKUMAN_BONUS = 40;

export function calculateCustomScore(input: ScoreCalculationInput): ScoreResult {
  const normalDoraCount = input.doraCount ?? 0;
  const nukiDoraCount = input.nukiDoraCount ?? 0;
  const uraDoraCount = input.uraDoraCount ?? 0;
  const coloredDoraCount = countColoredDora(input.winningTiles);
  const hasRealYakuman = input.yaku.some((yaku) => yaku.isYakuman);
  const yakuHan = hasRealYakuman ? 14 : input.yaku.reduce((total, yaku) => total + yaku.han, 0);
  const doraHan = hasRealYakuman ? 0 : normalDoraCount + coloredDoraCount + nukiDoraCount;
  const totalHan = hasRealYakuman ? 14 : yakuHan + doraHan;
  const isCountedYakuman = input.isCountedYakuman ?? (!hasRealYakuman && totalHan >= 14);
  const isDealer = input.winnerId === input.dealerPlayerId;
  const isTsumo = input.winType === "tsumo";
  const tableEntry = getBaseScoreFromHan(totalHan, isDealer);
  const bonuses = calculateBonusPoints(input.winningTiles, {
    uraDoraCount,
    honba: input.honba ?? 0,
    isIppatsu: input.isIppatsu ?? false,
    isCountedYakuman,
    hasRealYakuman,
  });
  const bonusPoints = Object.values(bonuses).reduce((total, points) => total + points, 0);
  const totalPoints = tableEntry.basePoints + bonusPoints;
  const selectedWait = input.selectedWait ?? input.winningTiles[input.winningTiles.length - 1];
  if (!selectedWait) {
    throw new Error("Score calculation requires at least one winning tile or selectedWait.");
  }
  const payments = calculatePayments({
    playerIds: input.playerIds,
    winnerId: input.winnerId,
    isTsumo,
    totalPoints,
    ...(input.discarderId ? { discarderId: input.discarderId } : {}),
  });

  const result: ScoreResult = {
    yakuHan,
    doraHan,
    totalHan,
    han: totalHan,
    basePoints: tableEntry.basePoints,
    bonusPoints,
    totalPoints,
    finalPoints: totalPoints,
    limitType: tableEntry.limitType,
    isDealer,
    isTsumo,
    winnerGain: payments[input.winnerId] ?? 0,
    payments,
    selectedWait,
    pochiActivated: false,
    pointMultiplier: 1,
    yaku: input.yaku,
    yakuList: input.yaku,
    doraDetails: createDoraDetails({ normalDoraCount, coloredDoraCount, nukiDoraCount }),
    dora: {
      normal: normalDoraCount,
      colored: coloredDoraCount,
      nuki: nukiDoraCount,
      ura: uraDoraCount,
    },
    bonuses,
  };

  if (isTsumo) {
    result.paymentPerPlayer = totalPoints;
  }

  return result;
}

function createDoraDetails(options: {
  normalDoraCount: number;
  coloredDoraCount: number;
  nukiDoraCount: number;
}): DoraDetail[] {
  return [
    options.normalDoraCount > 0 ? { name: "ドラ", han: options.normalDoraCount } : null,
    options.coloredDoraCount > 0 ? { name: "色付き牌ドラ", han: options.coloredDoraCount } : null,
    options.nukiDoraCount > 0 ? { name: "抜きドラ", han: options.nukiDoraCount } : null,
  ].filter((detail): detail is DoraDetail => Boolean(detail));
}

export function applyPointMultiplier(score: ScoreResult, pointMultiplier: number): ScoreResult {
  const payments = Object.fromEntries(
    Object.entries(score.payments).map(([playerId, payment]) => [playerId, payment * pointMultiplier]),
  );
  const winnerGain = score.winnerGain * pointMultiplier;
  const finalPoints = score.totalPoints * pointMultiplier;
  const result: ScoreResult = {
    ...score,
    finalPoints,
    pointMultiplier,
    winnerGain,
    payments,
  };

  if (score.paymentPerPlayer !== undefined) {
    result.paymentPerPlayer = score.paymentPerPlayer * pointMultiplier;
  }

  return result;
}

function countColoredDora(tiles: Tile[]): number {
  return tiles.filter((tile) => tile.color === "red" || tile.color === "blue" || tile.color === "gold").length;
}

function calculateBonusPoints(
  tiles: Tile[],
  options: {
    uraDoraCount: number;
    honba: number;
    isIppatsu: boolean;
    isCountedYakuman: boolean;
    hasRealYakuman: boolean;
  },
): ScoreResult["bonuses"] {
  const goldTileCount = tiles.filter((tile) => tile.color === "gold").length;
  const blueTileCount = tiles.filter((tile) => tile.color === "blue" && !tile.isPochi).length;

  return {
    goldTile: goldTileCount * GOLD_TILE_BONUS,
    blueTile: blueTileCount * BLUE_TILE_BONUS,
    uraDora: options.uraDoraCount * URA_DORA_BONUS,
    honba: options.honba * HONBA_BONUS,
    ippatsu: options.isIppatsu ? IPPATSU_BONUS : 0,
    countedYakuman: options.isCountedYakuman ? COUNTED_YAKUMAN_BONUS : 0,
    realYakuman: options.hasRealYakuman ? REAL_YAKUMAN_BONUS : 0,
  };
}

function calculatePayments(options: {
  playerIds: string[];
  winnerId: string;
  discarderId?: string;
  isTsumo: boolean;
  totalPoints: number;
}): Record<string, number> {
  const payments = Object.fromEntries(options.playerIds.map((playerId) => [playerId, 0]));

  if (options.isTsumo) {
    for (const playerId of options.playerIds) {
      if (playerId !== options.winnerId) {
        payments[playerId] = -options.totalPoints;
      }
    }
    payments[options.winnerId] = options.totalPoints * (options.playerIds.length - 1);
    return payments;
  }

  if (!options.discarderId) {
    throw new Error("Ron scoring requires discarderId.");
  }

  payments[options.winnerId] = options.totalPoints;
  payments[options.discarderId] = -options.totalPoints;
  return payments;
}
