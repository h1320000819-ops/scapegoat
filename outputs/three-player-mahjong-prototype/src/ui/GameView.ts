import { getCurrentPlayer, type ActionOption, type GameState, type PendingActionState, type PendingActionType } from "../domain/GameState";
import type { DiscardedTile, Player } from "../domain/Player";
import type { Tile } from "../domain/Tile";
import { isFlowerTile } from "../domain/TileUtils";
import type { ScoreResult } from "../scoring/ScoreTypes";
import { renderHandLogViewer } from "./HandLogViewer";
import { renderTileView } from "./TileView";

type ViewHandlers = {
  onStart: () => void;
  onDraw: () => void;
  onScoreDemo: () => void;
  onDiscard: (tileId: string) => void;
  onNuki: (tileId: string) => void;
  onConfirmAction: (actionType: PendingActionType) => void;
  onSkipAction: () => void;
  onResultOk: () => void;
};

const actionLabels: Record<PendingActionType, string> = {
  ron: "ロン",
  tsumo: "ツモ",
  riichi: "リーチ",
  pon: "ポン",
  kan: "カン",
};

function getActionOptions(action: PendingActionState | null): ActionOption[] {
  if (!action) return [];
  return Array.isArray(action.options) ? action.options : [action as ActionOption];
}

export class GameView {
  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: ViewHandlers,
  ) {}

  bindStaticControls(startButton: HTMLButtonElement, drawButton: HTMLButtonElement, scoreDemoButton: HTMLButtonElement): void {
    startButton.addEventListener("click", this.handlers.onStart);
    drawButton.addEventListener("click", this.handlers.onDraw);
    scoreDemoButton.addEventListener("click", this.handlers.onScoreDemo);
  }

  render(state: GameState): void {
    const currentPlayer = getCurrentPlayer(state);
    const dealer = state.players.find((player) => player.id === state.round.dealerPlayerId);
    this.root.innerHTML = `
      <section class="status-band">
        <div class="status-item"><span class="label">局</span>東場 第${state.round.handNumber}局</div>
        <div class="status-item"><span class="label">親</span>${dealer?.name ?? ""}</div>
        <div class="status-item"><span class="label">現在ターン</span>${currentPlayer.name}</div>
        <div class="status-item"><span class="label">状態</span>${state.cpuThinkingMessage || state.phase}</div>
        <div class="status-item"><span class="label">山</span>${state.liveWall.length}枚</div>
        <div class="status-item"><span class="label">嶺上牌</span>${state.rinshanWall.length}枚</div>
        <div class="status-item"><span class="label">カン回数</span>${state.kanCount} / 4</div>
        <div class="status-item"><span class="label">ドラ表示牌</span>${state.doraIndicators.map((tile) => this.renderTile(tile)).join("") || "なし"}</div>
      </section>
      ${state.cpuThinkingMessage ? `<section class="action-prompt"><h2>${state.cpuThinkingMessage}</h2></section>` : ""}
      ${this.renderActionPrompt(state.pendingAction)}
      <section class="players">
        ${state.players.map((player) => this.renderPlayerPanel(player, player.id === currentPlayer.id)).join("")}
      </section>
      ${state.lastScoreResult ? this.renderScoreResult(state.lastScoreResult) : ""}
      ${renderHandLogViewer(state)}
      <section class="log">
        <h2>ログ</h2>
        <ul>${state.log.slice(0, 8).map((entry) => `<li>${entry}</li>`).join("")}</ul>
      </section>
    `;

    this.root.querySelectorAll<HTMLButtonElement>("[data-discard-tile-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const tileId = button.dataset.discardTileId;
        if (tileId) this.handlers.onDiscard(tileId);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-nuki-tile-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const tileId = button.dataset.nukiTileId;
        if (tileId) this.handlers.onNuki(tileId);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-confirm-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const actionType = button.dataset.confirmAction as PendingActionType | undefined;
        if (actionType) this.handlers.onConfirmAction(actionType);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-skip-action]").forEach((button) => {
      button.addEventListener("click", () => this.handlers.onSkipAction());
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-result-ok]").forEach((button) => {
      button.addEventListener("click", () => this.handlers.onResultOk());
    });
  }

  private renderPlayerPanel(player: Player, isActive: boolean): string {
    return `
      <article class="player-panel player-area ${isActive ? "active" : ""}">
        <div class="player-header">
          <h2>${player.name}</h2>
          <span class="score">${player.score}点</span>
        </div>
        <div><span class="label">種別</span>${player.type === "human" ? "自分" : "CPU"}</div>
        <div><span class="label">状態</span>${player.status}${player.isRiichi ? " / リーチ中" : ""}</div>
        <p class="section-title">手牌</p>
        <div class="tiles tile-zone">${this.renderDisplayHand(player, isActive)}</div>
        <p class="section-title">副露・カン</p>
        <div class="tiles tile-zone">${player.melds.map((meld) => meld.tiles.map((tile) => this.renderTile(tile)).join("")).join("") || "なし"}</div>
        <p class="section-title">抜きドラ</p>
        <div class="tiles tile-zone">${player.nukiDoraTiles.map((tile) => this.renderTile(tile)).join("") || "なし"}</div>
        <p class="section-title">捨て牌</p>
        <div class="tiles tile-zone">${player.discardedTiles.map((discard) => this.renderDiscard(discard)).join("")}</div>
      </article>
    `;
  }

  private renderActionPrompt(action: PendingActionState | null): string {
    const options = getActionOptions(action);
    if (options.length === 0) return "";
    const title = options.map((option) => actionLabels[option.type]).join(" / ");
    return `
      <section class="action-prompt">
        <h2>${title}できます</h2>
        <div class="actions">
          ${options.map((option) => `<button type="button" data-confirm-action="${option.type}">${actionLabels[option.type]}</button>`).join("")}
          <button type="button" data-skip-action>スキップ</button>
        </div>
      </section>
    `;
  }

  private renderDisplayHand(player: Player, isActive: boolean): string {
    const faceDown = player.type === "cpu";
    const handTiles = player.hand.map((tile) => this.renderHandTile(tile, player, isActive, false, faceDown)).join("");
    const drawnTile = player.drawnTile ? `<span class="drawn-tile">${this.renderHandTile(player.drawnTile, player, isActive, true, faceDown)}</span>` : "";
    return `${handTiles}${drawnTile}`;
  }

  private renderHandTile(tile: Tile, player: Player, isActive: boolean, isDrawnTile: boolean, faceDown: boolean): string {
    if (!isActive || faceDown) return renderTileView({ tile, isDrawnTile, faceDown });
    if (player.riichiDiscardTileIds.length > 0 && !player.riichiDiscardTileIds.includes(tile.id)) return renderTileView({ tile, isDrawnTile });
    if (player.isRiichi && !isDrawnTile) return renderTileView({ tile, isDrawnTile });
    return renderTileView({
      tile,
      isDrawnTile,
      buttonTileId: tile.id,
      buttonAction: isFlowerTile(tile) ? "nuki" : "discard",
    });
  }

  private renderTile(tile: Tile): string {
    return renderTileView({ tile });
  }

  private renderDiscard(discard: DiscardedTile): string {
    return renderTileView({ tile: discard.tile, isTsumogiri: discard.discardType === "tsumogiri" });
  }

  private renderScoreResult(score: ScoreResult): string {
    const doraLines = [
      score.dora.normal > 0 ? `<li>ドラ${score.dora.normal}</li>` : "",
      score.dora.colored > 0 ? `<li>色付き牌ドラ${score.dora.colored}</li>` : "",
      score.dora.nuki > 0 ? `<li>抜きドラ${score.dora.nuki}</li>` : "",
      score.dora.ura > 0 ? `<li>裏ドラ${score.dora.ura}</li>` : "",
    ].join("");

    return `
      <section class="score-result">
        <h2>${score.limitType === "通常" ? "点数計算" : score.limitType}</h2>
        <ul class="score-yaku">
          ${score.yaku.map((yaku) => `<li>${yaku.name}${yaku.isYakuman ? "" : ` ${yaku.han}翻`}</li>`).join("")}
          ${doraLines}
        </ul>
        <p>${score.han}翻</p>
        <dl>
          <dt>基本点</dt><dd>${score.basePoints}</dd>
          <dt>追加点</dt><dd>${score.bonusPoints}</dd>
          <dt>合計</dt><dd>${score.totalPoints}</dd>
          <dt>ランク</dt><dd>${score.limitType === "通常" ? "なし" : score.limitType}</dd>
          <dt>和了方法</dt><dd>${score.isTsumo ? "ツモ" : "ロン"}</dd>
          <dt>和了者収支</dt><dd>${score.winnerGain >= 0 ? "+" : ""}${score.winnerGain}</dd>
        </dl>
        <button type="button" class="primary-action" data-result-ok>OK</button>
      </section>
    `;
  }
}
