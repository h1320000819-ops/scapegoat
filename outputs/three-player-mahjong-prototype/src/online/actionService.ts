import type { GameState } from "../domain/GameState";
import type { AppRepositories } from "./repositories";
import type { GameAction } from "./types";

export type ActionPriority = "win" | "kan" | "call" | "selfTurn";

export const ACTION_PRIORITY: Record<GameAction["type"], number> = {
  ron: 100,
  tsumo: 100,
  kan: 80,
  pon: 70,
  riichi: 50,
  nukiDora: 40,
  discard: 30,
  skip: 10,
};

export type PendingActionDeadline = {
  actionId: string;
  expiresAt: number;
  turnVersion: number;
};

export function validateActionVersion(state: Pick<GameState, "version">, action: Pick<GameAction, "turnVersion">): void {
  if (action.turnVersion !== state.version) {
    throw new Error(`stale action rejected: action=${action.turnVersion}, state=${state.version}`);
  }
}

export function sortActionsByPriority(actions: GameAction[]): GameAction[] {
  return [...actions].sort((a, b) => ACTION_PRIORITY[b.type] - ACTION_PRIORITY[a.type]);
}

export function createPendingActionDeadline(actionId: string, state: Pick<GameState, "version">, timeoutMs = 8000): PendingActionDeadline {
  return {
    actionId,
    turnVersion: state.version,
    expiresAt: Date.now() + timeoutMs,
  };
}

export function isPendingActionExpired(deadline: PendingActionDeadline, now = Date.now()): boolean {
  return deadline.expiresAt <= now;
}

// TODO: connect this to the full RuleEngine so the authoritative writer validates
// tile ownership, furiten, riichi restrictions, call priority, and simultaneous ron.
export function assertActionShape(action: GameAction): void {
  if (!action.gameId || !action.tableId || !action.playerId || !action.type) {
    throw new Error("invalid action payload");
  }
}

export async function submitOnlineAction(
  repositories: AppRepositories,
  state: Pick<GameState, "version">,
  action: GameAction,
): Promise<GameAction> {
  assertActionShape(action);
  validateActionVersion(state, action);
  return repositories.gameStates.submitAction(action);
}

export function toJapaneseActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("stale") || message.includes("turn_version")) {
    return "局面が更新されています。最新の状態を読み込んでから操作してください。";
  }
  if (message.includes("not seated")) return "この卓に着席していないため操作できません。";
  if (message.includes("not club member")) return "このクラブのメンバーではないため操作できません。";
  if (message.includes("not current player")) return "現在の手番ではありません。";
  if (message.includes("invalid action")) return "この操作は現在の局面では実行できません。";
  return message || "操作に失敗しました。";
}
