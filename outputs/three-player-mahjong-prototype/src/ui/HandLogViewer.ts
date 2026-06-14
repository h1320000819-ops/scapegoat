import { formatTile } from "../domain/Tile";
import type { GameState } from "../domain/GameState";
import type { HandLogEvent } from "../hand-log/HandLog";

export function renderHandLogViewer(state: GameState): string {
  const log = state.handLog;
  const playerName = (playerId: string): string => state.players.find((player) => player.id === playerId)?.name ?? playerId;
  const initialDora = log.initialDoraIndicators.map(formatTile).join("、") || "なし";
  const openDetails = state.phase === "handEnded" || state.phase === "exhaustiveDraw";

  return `
    <section class="hand-log-viewer">
      <h2>牌譜</h2>
      <p>${log.roundLabel}</p>
      <p>初期ドラ: ${initialDora}</p>
      <details ${openDetails ? "open" : ""}>
        <summary>初期手牌を確認</summary>
        ${Object.entries(log.initialHands).map(([playerId, tiles]) => `
          <p>${playerName(playerId)}: ${tiles.map(formatTile).join(" ")}</p>
        `).join("")}
      </details>
      <ol>
        ${log.events.map((event) => `<li>${renderHandLogEvent(event, playerName)}</li>`).join("")}
      </ol>
    </section>
  `;
}

function renderHandLogEvent(event: HandLogEvent, playerName: (playerId: string) => string): string {
  switch (event.type) {
    case "draw":
      return `${playerName(event.playerId)} ツモ ${formatTile(event.tile)}${event.from === "rinshanWall" ? " 嶺上" : ""}`;
    case "discard":
      return `${playerName(event.playerId)} 打 ${formatTile(event.tile)} ${event.discardType === "tsumogiri" ? "ツモ切り" : "手出し"}${event.isCpuAction ? " CPU" : ""}`;
    case "nukiDora":
      return `${playerName(event.playerId)} 抜きドラ ${formatTile(event.tile)}${event.replacementTile ? ` / 補充 ${formatTile(event.replacementTile)}` : ""}`;
    case "riichi":
      return `${playerName(event.playerId)} リーチ`;
    case "win":
      return `${playerName(event.winnerId)} 和了 ${event.winType} ${formatTile(event.winningTile)} 合計 ${event.scoreResult.totalPoints}`;
    case "ron":
      return `${playerName(event.playerId)} ロン ${formatTile(event.tile)} / 放銃 ${playerName(event.fromPlayerId)}`;
    case "tsumo":
      return `${playerName(event.playerId)} ツモ和了 ${formatTile(event.tile)}`;
    case "pon":
      return `${playerName(event.playerId)} ポン ${formatTile(event.tile)} / from ${playerName(event.fromPlayerId)}`;
    case "skipAction":
      return `${playerName(event.playerId)} ${event.actionType}をスキップ`;
    case "exhaustiveDraw":
      return `流局 ${event.reason}`;
    case "kan":
      return `${playerName(event.playerId)} カン ${event.kanType}`;
    case "doraReveal":
      return `ドラ表示 ${formatTile(event.tile)} ${event.reason === "kan" ? "カン" : "初期"}`;
  }
}
