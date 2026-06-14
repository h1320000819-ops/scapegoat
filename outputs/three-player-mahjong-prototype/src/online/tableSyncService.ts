import type { AppRepositories } from "./repositories";
import type { TableId, UserId } from "./types";

export async function canJoinTable(repositories: AppRepositories, tableId: TableId, userId: UserId): Promise<boolean> {
  const table = await repositories.tables.getTable(tableId);
  if (!table || table.status === "playing") return false;
  const clubs = await repositories.clubs.listMyClubs(userId);
  if (!clubs.some((club) => club.id === table.clubId)) return false;
  const seats = await repositories.tables.listSeats(tableId);
  return seats.some((seat) => !seat.userId);
}

export async function sitFirstAvailableSeat(repositories: AppRepositories, tableId: TableId, userId: UserId): Promise<void> {
  if (!(await canJoinTable(repositories, tableId, userId))) {
    throw new Error("table is not joinable");
  }
  const seats = await repositories.tables.listSeats(tableId);
  const seat = seats.find((item) => !item.userId);
  if (!seat) throw new Error("no empty seat");
  await repositories.tables.sit(tableId, seat.seatIndex, userId);
  await maybeStartOnlineTable(repositories, tableId);
}

export async function maybeStartOnlineTable(repositories: AppRepositories, tableId: TableId): Promise<boolean> {
  const table = await repositories.tables.getTable(tableId);
  if (!table || table.status !== "waiting") return false;
  const seats = await repositories.tables.listSeats(tableId);
  const realPlayers = seats.filter((seat) => seat.userId && seat.playerType === "human");
  const hasDebugCpu = seats.some((seat) => seat.playerType === "cpu");
  if (hasDebugCpu) {
    // CPU seats are for local/debug verification only. Production online tables
    // must wait for three real club members and must not create rake/point flow.
    return false;
  }
  if (realPlayers.length !== 3) return false;

  const activeGame = await repositories.tables.tryStartGame(tableId);
  if (!activeGame) return false;
  return true;
}

export function subscribeTablePresence(repositories: AppRepositories, tableId: TableId, onChange: () => void) {
  return repositories.tables.subscribeTable(tableId, onChange);
}

export async function markOnline(repositories: AppRepositories, tableId: TableId, userId: UserId): Promise<void> {
  await repositories.tables.upsertConnection(tableId, userId, "online");
}

export async function markReconnecting(repositories: AppRepositories, tableId: TableId, userId: UserId): Promise<void> {
  await repositories.tables.upsertConnection(tableId, userId, "reconnecting");
}
