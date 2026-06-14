import type { GameState } from "../domain/GameState";

export type OnlineViewState = Omit<GameState, "players"> & {
  players: Array<GameState["players"][number] & { handTileCount?: number; hand?: GameState["players"][number]["hand"] }>;
};

export function buildOnlineViewState(state: GameState, viewerPlayerId: string): OnlineViewState {
  return {
    ...state,
    players: state.players.map((player) => {
      if (player.id === viewerPlayerId) return player;
      return {
        ...player,
        handTileCount: player.hand.length,
        hand: [],
        drawnTile: player.drawnTile ? { ...player.drawnTile, id: `hidden-${player.id}-drawn` } : null,
      };
    }),
  };
}
