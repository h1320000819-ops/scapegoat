import type { LimitType } from "./ScoreTypes";

export type ScoreTableEntry = {
  basePoints: number;
  limitType: LimitType;
};

const CHILD_SCORE_TABLE: Record<number, ScoreTableEntry> = {
  1: { basePoints: 1, limitType: "通常" },
  2: { basePoints: 2, limitType: "通常" },
  3: { basePoints: 4, limitType: "通常" },
  4: { basePoints: 8, limitType: "満貫" },
  5: { basePoints: 8, limitType: "満貫" },
  6: { basePoints: 12, limitType: "跳満" },
  7: { basePoints: 12, limitType: "跳満" },
  8: { basePoints: 16, limitType: "倍満" },
  9: { basePoints: 16, limitType: "倍満" },
  10: { basePoints: 16, limitType: "倍満" },
  11: { basePoints: 24, limitType: "三倍満" },
  12: { basePoints: 24, limitType: "三倍満" },
  13: { basePoints: 24, limitType: "三倍満" },
};

const DEALER_SCORE_TABLE: Record<number, ScoreTableEntry> = {
  1: { basePoints: 2, limitType: "通常" },
  2: { basePoints: 3, limitType: "通常" },
  3: { basePoints: 6, limitType: "通常" },
  4: { basePoints: 12, limitType: "満貫" },
  5: { basePoints: 12, limitType: "満貫" },
  6: { basePoints: 18, limitType: "跳満" },
  7: { basePoints: 18, limitType: "跳満" },
  8: { basePoints: 24, limitType: "倍満" },
  9: { basePoints: 24, limitType: "倍満" },
  10: { basePoints: 24, limitType: "倍満" },
  11: { basePoints: 36, limitType: "三倍満" },
  12: { basePoints: 36, limitType: "三倍満" },
  13: { basePoints: 36, limitType: "三倍満" },
};

const CHILD_YAKUMAN_ENTRY: ScoreTableEntry = { basePoints: 32, limitType: "役満" };
const DEALER_YAKUMAN_ENTRY: ScoreTableEntry = { basePoints: 48, limitType: "役満" };

export function getBaseScoreFromHan(han: number, isDealer: boolean): ScoreTableEntry {
  if (han <= 0) return { basePoints: 0, limitType: "通常" };
  if (han >= 14) return isDealer ? DEALER_YAKUMAN_ENTRY : CHILD_YAKUMAN_ENTRY;
  const table = isDealer ? DEALER_SCORE_TABLE : CHILD_SCORE_TABLE;
  return table[han] ?? (isDealer ? DEALER_YAKUMAN_ENTRY : CHILD_YAKUMAN_ENTRY);
}

export const getScoreTableEntry = getBaseScoreFromHan;
