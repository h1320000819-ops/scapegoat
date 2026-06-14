export type HandResult =
  | { type: "win"; winnerId: string }
  | { type: "draw" };

export function determineNextDealer(result: HandResult, currentDealerId: string): string {
  if (result.type === "win") {
    return result.winnerId;
  }

  return currentDealerId;
}
