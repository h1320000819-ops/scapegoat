import { processCpuTurn } from "../cpu/processCpuTurn";
import type { CpuStrategy } from "../cpu/CpuStrategy";
import { TsumogiriCpuStrategy } from "../cpu/TsumogiriCpuStrategy";
import { createInitialGameState, getCurrentPlayer, type ActionOption, type GameState, type PendingAction, type PendingActionState, type PendingActionType } from "../domain/GameState";
import type { Meld, Player } from "../domain/Player";
import type { Tile } from "../domain/Tile";
import { createShuffledWall } from "../domain/TileSet";
import { getHandTilesForHandEvaluation, isFlowerTile, sortHandTiles } from "../domain/TileUtils";
import { appendHandLogEvent, type HandLog } from "../hand-log/HandLog";
import { canNukiDora, performNukiDoraDetailed, splitStartingWalls } from "../nuki-dora/NukiDoraService";
import type { RuleEngine } from "../rules/RuleEngine";
import type { ScoreCalculationInput, ScoreResult, YakuResult } from "../scoring/ScoreTypes";

type ActionOptions = {
  isCpuAction?: boolean;
  suppressEmit?: boolean;
  suppressCpuAutoProgress?: boolean;
};

const MAX_AUTO_TURNS = 200;
const STOP_PHASES = new Set(["waitingForAction", "waitingForHumanDiscard", "waitingForRiichiDiscard", "handEnded", "exhaustiveDraw"]);

function getActionOptions(pendingAction: PendingActionState | null): ActionOption[] {
  if (!pendingAction) return [];
  return Array.isArray(pendingAction.options) ? pendingAction.options : [pendingAction as ActionOption];
}

export class GameController {
  private state: GameState;
  private lastDiscardContext: { playerId: string; tile: Tile } | null = null;

  constructor(
    players: Player[],
    private readonly ruleEngine: RuleEngine,
    private readonly onStateChanged: (state: GameState) => void = () => undefined,
    private readonly cpuStrategy: CpuStrategy = new TsumogiriCpuStrategy(),
  ) {
    this.state = createInitialGameState(players);
  }

  getState(): GameState {
    return this.state;
  }

  startGame(options: { preserveScores?: boolean } = {}): void {
    const preserveScores = options.preserveScores ?? false;
    const split = splitStartingWalls(createShuffledWall());
    this.state.liveWall = split.liveWall;
    this.state.rinshanWall = split.rinshanWall;
    this.state.doraIndicators = split.doraIndicators;
    this.state.uraDoraIndicators = split.uraDoraIndicators;
    this.state.kanCount = 0;
    this.state.turnIndex = 0;
    this.state.pendingAction = null;
    this.state.lastScoreResult = null;
    this.state.lastDrawnTile = null;
    this.state.log = [];
    this.lastDiscardContext = null;
    if (!preserveScores) {
      this.state.round.handNumber = 1;
      this.state.round.dealerPlayerId = this.state.players[0]?.id ?? "";
    }

    for (const player of this.state.players) {
      player.hand = [];
      player.drawnTile = null;
      player.discardedTiles = [];
      player.nukiDoraTiles = [];
      player.melds = [];
      player.status = "waiting";
      player.score = preserveScores ? player.score : 0;
      player.isRiichi = false;
      player.ippatsu = false;
      player.riichiTurnIndex = null;
      player.ippatsuOwnDrawStarted = false;
      player.sameTurnFuriten = false;
      player.riichiDiscardTileIds = [];
    }

    this.dealInitialHands();
    this.sortAllHands();
    this.state.handLog = this.createHandLog();
    for (const tile of this.state.doraIndicators) {
      appendHandLogEvent(this.state.handLog, {
        type: "doraReveal",
        tile,
        doraIndicators: [...this.state.doraIndicators],
        turnIndex: this.state.turnIndex,
        reason: "initial",
      });
    }

    const dealerIndex = Math.max(0, this.state.players.findIndex((player) => player.id === this.state.round.dealerPlayerId));
    this.state.currentPlayerIndex = dealerIndex;
    getCurrentPlayer(this.state).status = "active";
    this.state.phase = "playing";
    this.state.log.unshift("ゲームを開始しました");
    this.advanceUntilHumanAction();
    this.assertAllHandSizes();
    this.emitChange();
  }

  startNextHand(): void {
    const result = this.state.handLog.result;
    const nextDealerId = result?.type === "win" ? result.winnerId : this.state.round.dealerPlayerId;
    this.state.round.dealerPlayerId = nextDealerId;
    this.state.round.handNumber += 1;
    console.log("[NextHand]", nextDealerId);
    this.startGame({ preserveScores: true });
  }

  confirmPendingAction(actionType?: PendingActionType): void {
    const action = actionType
      ? getActionOptions(this.state.pendingAction).find((option) => option.type === actionType)
      : getActionOptions(this.state.pendingAction)[0];
    if (!action) return;

    if (action.type === "tsumo") this.confirmTsumo(action);
    else if (action.type === "ron") this.confirmRon(action);
    else if (action.type === "riichi") this.confirmRiichi(action);
    else if (action.type === "pon") this.confirmPon(action);
    else if (action.type === "kan") this.confirmKan(action);
  }

  skipPendingAction(): void {
    const options = getActionOptions(this.state.pendingAction);
    const action = options[0];
    if (!action) return;
    for (const option of options) {
      appendHandLogEvent(this.state.handLog, {
        type: "skipAction",
        playerId: option.playerId,
        actionType: option.type,
        turnIndex: this.state.turnIndex,
      });
    }
    this.state.pendingAction = null;

    if (options.some((option) => option.type === "ron")) {
      this.getPlayer(action.playerId).sameTurnFuriten = true;
    }
    if (options.some((option) => ["ron", "pon", "kan"].includes(option.type) && option.fromPlayerId)) {
      this.continueAfterDiscardCallWindow();
      this.continueGameFlow();
    } else {
      this.waitForHumanDiscard(action.playerId);
      this.emitChange();
    }
    return;

    if (action.type === "tsumo") {
      this.queueKanOrRiichiOrDiscard(action.playerId);
      this.emitChange();
      return;
    }
    if (action.type === "kan") {
      this.queueRiichiOrDiscard(action.playerId);
      this.emitChange();
      return;
    }
    if (action.type === "riichi") {
      this.waitForHumanDiscard(action.playerId);
      this.emitChange();
      return;
    }
    if (action.type === "ron") {
      this.getPlayer(action.playerId).sameTurnFuriten = true;
      this.queueCallAfterDiscard(action.sourceTile, action.fromPlayerId, { skipRon: true });
      this.emitChange();
      return;
    }
    if (action.type === "pon") {
      this.continueAfterDiscardCallWindow();
      this.continueGameFlow();
      this.emitChange();
    }
  }

  finishHand(input: Omit<ScoreCalculationInput, "winnerId" | "dealerPlayerId" | "playerIds"> & { winnerId?: string }): ScoreResult {
    const winnerId = input.winnerId ?? getCurrentPlayer(this.state).id;
    const winner = this.getPlayer(winnerId);
    const { winnerId: _ignoredWinnerId, ...scoreOptions } = input;
    void _ignoredWinnerId;
    const meldTiles = winner.melds.flatMap((meld) => meld.tiles);
    const winningTiles = getHandTilesForHandEvaluation([...scoreOptions.winningTiles, ...(scoreOptions.drawnTile ? [scoreOptions.drawnTile] : []), ...meldTiles]);
    const scoreInput: ScoreCalculationInput = {
      ...scoreOptions,
      winnerId,
      dealerPlayerId: this.state.round.dealerPlayerId,
      playerIds: this.state.players.map((player) => player.id),
      winningTiles,
      nukiDoraCount: winner.nukiDoraTiles.length,
    };
    const scoreResult = this.ruleEngine.calculateScore(this.state, winner, scoreInput);

    this.applyWinPayments(winnerId, scoreInput.winType, scoreResult, scoreInput.discarderId);
    for (const player of this.state.players) player.status = player.id === winner.id ? "declared-win" : "waiting";

    const winningTile = scoreResult.selectedWait ?? scoreInput.selectedWait ?? winningTiles[winningTiles.length - 1];
    appendHandLogEvent(this.state.handLog, {
      type: "win",
      winnerId,
      winType: scoreInput.winType,
      winningTile,
      scoreResult,
      turnIndex: this.state.turnIndex,
      ...(scoreInput.discarderId ? { loserId: scoreInput.discarderId } : {}),
    });
    if (scoreInput.winType === "tsumo") {
      appendHandLogEvent(this.state.handLog, {
        type: "tsumo",
        playerId: winnerId,
        tile: winningTile,
        scoreResult,
        turnIndex: this.state.turnIndex,
      });
    } else if (scoreInput.discarderId) {
      appendHandLogEvent(this.state.handLog, {
        type: "ron",
        playerId: winnerId,
        fromPlayerId: scoreInput.discarderId,
        tile: winningTile,
        scoreResult,
        turnIndex: this.state.turnIndex,
      });
    }
    this.state.handLog.result = {
      type: "win",
      winnerId,
      winType: scoreInput.winType,
      scoreResult,
      payments: scoreResult.paymentDeltas,
      ...(scoreInput.discarderId ? { loserId: scoreInput.discarderId } : {}),
    };

    this.state.lastScoreResult = scoreResult;
    this.state.pendingAction = null;
    this.state.phase = "handEnded";
    this.state.isWaitingForHumanAction = false;
    console.log("[Result]", this.state.handLog.result);
    this.state.log.unshift(`${winner.name} が和了しました`);
    this.emitChange();
    return scoreResult;
  }

  private applyWinPayments(winnerId: string, winType: "ron" | "tsumo", scoreResult: ScoreResult, loserId?: string): void {
    const totalPoints = scoreResult.finalPoints ?? scoreResult.totalPoints;
    const payments = Object.fromEntries(this.state.players.map((player) => [player.id, 0]));
    if (winType === "tsumo") {
      for (const player of this.state.players) {
        if (player.id !== winnerId) payments[player.id] = -totalPoints;
      }
      payments[winnerId] = totalPoints * (this.state.players.length - 1);
      scoreResult.paymentPerPlayer = totalPoints;
    } else if (loserId) {
      payments[winnerId] = totalPoints;
      payments[loserId] = -totalPoints;
      delete scoreResult.paymentPerPlayer;
    }
    scoreResult.payments = payments;
    scoreResult.winnerGain = payments[winnerId] ?? 0;
    scoreResult.paymentDeltas = Object.entries(payments).map(([playerId, delta]) => ({ playerId, delta }));
    for (const player of this.state.players) player.score += payments[player.id] ?? 0;
  }

  drawTile(options: ActionOptions = {}): Tile | null {
    const player = getCurrentPlayer(this.state);
    if (!this.ruleEngine.canDraw(this.state, player)) {
      if (!options.suppressEmit) this.emitChange();
      return null;
    }

    const tile = this.state.liveWall.shift() ?? null;
    if (!tile) {
      this.endExhaustiveDraw();
      if (!options.suppressEmit) this.emitChange();
      return null;
    }

    player.drawnTile = tile;
    player.sameTurnFuriten = false;
    if (player.isRiichi && player.ippatsu && player.riichiTurnIndex !== null && this.state.turnIndex > player.riichiTurnIndex) {
      player.ippatsuOwnDrawStarted = true;
    }
    this.state.lastDrawnTile = tile;
    appendHandLogEvent(this.state.handLog, {
      type: "draw",
      playerId: player.id,
      tile,
      from: "liveWall",
      turnIndex: this.state.turnIndex,
    });
    console.log("[Draw]", player.id, tile);
    console.log("[Wall]", this.state.liveWall.length);
    this.assertPlayerHandSize(player);
    if (!options.suppressEmit) this.emitChange();
    return tile;
  }

  performNukiDora(playerId: string, tileId: string, options: ActionOptions = {}): void {
    const result = performNukiDoraDetailed(this.state, playerId, tileId);
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (result && player) {
      appendHandLogEvent(this.state.handLog, {
        type: "nukiDora",
        playerId,
        tile: result.nukiTile,
        turnIndex: this.state.turnIndex,
        isAfterRiichi: player.isRiichi,
        ippatsuPreserved: true,
        ...(result.replacementTile ? { replacementTile: result.replacementTile } : {}),
      });
      if (result.replacementTile) {
        appendHandLogEvent(this.state.handLog, {
          type: "draw",
          playerId,
          tile: result.replacementTile,
          from: "rinshanWall",
          turnIndex: this.state.turnIndex,
        });
      }
      this.assertPlayerHandSize(player);
    }
    if (!options.suppressEmit) this.emitChange();
  }

  canNukiDora(playerId: string): boolean {
    return canNukiDora(this.state, playerId);
  }

  declareRiichi(playerId: string): void {
    this.setPendingAction({ type: "riichi", playerId, options: { allowedDiscardIds: this.getRiichiDiscardIds(playerId) } });
    this.confirmPendingAction();
  }

  performKan(playerId: string): void {
    const action = this.findKanAction(playerId);
    if (!action) return;
    this.setPendingAction(action);
    this.confirmPendingAction();
  }

  discardTile(tileId: string, options: ActionOptions = {}): void {
    if (this.state.pendingAction) return;
    const player = getCurrentPlayer(this.state);
    const isRiichiDiscardPhase = this.state.phase === "waitingForRiichiDiscard";
    const handTile = player.hand.find((candidate) => candidate.id === tileId);
    const drawnTile = player.drawnTile?.id === tileId ? player.drawnTile : null;
    const tile = handTile ?? drawnTile;
    if (!tile || !this.ruleEngine.canDiscard(this.state, player, tile)) return;
    if (player.isRiichi && !drawnTile && !isRiichiDiscardPhase) {
      this.state.log.unshift("リーチ後はツモ切りのみ可能です");
      if (!options.suppressEmit) this.emitChange();
      return;
    }
    if (isRiichiDiscardPhase && !player.riichiDiscardTileIds.includes(tileId)) {
      this.state.log.unshift("リーチ宣言後はテンパイ維持できる牌だけ切れます");
      if (!options.suppressEmit) this.emitChange();
      return;
    }

    const discardType = drawnTile ? "tsumogiri" : "tedashi";
    if (drawnTile) {
      player.drawnTile = null;
    } else {
      player.hand = player.hand.filter((candidate) => candidate.id !== tileId);
      if (player.drawnTile) {
        player.hand.push(player.drawnTile);
        player.drawnTile = null;
        player.hand = sortHandTiles(player.hand);
      }
    }
    player.discardedTiles.push({ tile, discardType, turnIndex: this.state.turnIndex });
    appendHandLogEvent(this.state.handLog, {
      type: "discard",
      playerId: player.id,
      tile,
      discardType,
      turnIndex: this.state.turnIndex,
      isCpuAction: options.isCpuAction ?? player.type === "cpu",
    });
    console.log("[Discard]", player.id, tile, discardType);
    if (isRiichiDiscardPhase) {
      player.isRiichi = true;
      player.ippatsu = true;
      player.riichiTurnIndex = this.state.turnIndex;
      player.ippatsuOwnDrawStarted = false;
      appendHandLogEvent(this.state.handLog, { type: "riichi", playerId: player.id, turnIndex: this.state.turnIndex });
      this.state.log.unshift(`${player.name} リーチ`);
    }
    player.riichiDiscardTileIds = [];
    this.state.lastDrawnTile = null;
    this.state.turnIndex += 1;
    this.assertPlayerHandSize(player);
    this.lastDiscardContext = { playerId: player.id, tile };

    if (!this.queueResponseAfterDiscard(player.id, tile)) {
      this.continueAfterDiscardCallWindow();
    }

    if (!options.suppressCpuAutoProgress) this.advanceUntilHumanAction();
    this.assertAllHandSizes();
    if (!options.suppressEmit) this.emitChange();
  }

  advanceTurn(): void {
    getCurrentPlayer(this.state).status = "waiting";
    this.state.currentPlayerIndex = (this.state.currentPlayerIndex + 1) % this.state.players.length;
    const nextPlayer = getCurrentPlayer(this.state);
    nextPlayer.status = "active";
    console.log("[NextPlayer]", nextPlayer.id);
    this.enterCurrentTurn();
    console.log("[Phase]", this.state.phase);
  }

  runCpuTurns(): void {
    this.advanceUntilHumanAction();
    this.emitChange();
  }

  continueGameFlow(): GameState {
    console.log("[Flow] continueGameFlow");
    return this.advanceUntilHumanAction();
  }

  advanceUntilHumanAction(): GameState {
    let guard = 0;
    while (!STOP_PHASES.has(this.state.phase)) {
      guard += 1;
      if (guard > MAX_AUTO_TURNS) throw new Error("Auto progress exceeded safety limit.");
      const currentPlayer = getCurrentPlayer(this.state);
      console.log("[Turn]", currentPlayer.id, currentPlayer.type);

      if (this.state.liveWall.length === 0 && !currentPlayer.drawnTile) {
        this.endExhaustiveDraw();
        break;
      }
      if (currentPlayer.type === "human") {
        this.enterCurrentTurn();
        break;
      }

      processCpuTurn(this.state, this.cpuStrategy, {
        drawTileForCpu: () => void this.drawTile({ isCpuAction: true, suppressEmit: true }),
        autoNukiDoraForCurrentTurn: () => this.autoNukiDoraForCurrentTurn(),
        discardTileForCpu: (tileId) => this.discardTile(tileId, {
          isCpuAction: true,
          suppressEmit: true,
          suppressCpuAutoProgress: true,
        }),
      });
    }

    this.assertAllHandSizes();
    console.log("[Phase]", this.state.phase);
    return this.state;
  }

  private enterCurrentTurn(): void {
    if (this.state.phase !== "playing") return;
    const player = getCurrentPlayer(this.state);
    console.log("[Turn]", player.id, player.type);
    if (!player.drawnTile) this.drawTile({ suppressEmit: true });
    if (this.state.phase === "exhaustiveDraw") return;
    this.autoNukiDoraForCurrentTurn();

    if (player.type === "cpu") {
      this.state.phase = "playing";
      this.updateHumanActionFlag();
      this.assertPlayerHandSize(player);
      return;
    }

    this.queueTsumoKanRiichiOrDiscard(player.id);
    this.assertPlayerHandSize(player);
  }

  private queueTsumoKanRiichiOrDiscard(playerId: string): void {
    const player = this.getPlayer(playerId);
    const options: PendingAction[] = [];
    if (player.drawnTile) {
      const winCheck = this.ruleEngine.canWin(this.state, player, player.drawnTile);
      if (winCheck.canWin && winCheck.yaku?.length) {
        options.push({
          type: "tsumo",
          playerId,
          sourceTile: player.drawnTile,
          options: { yaku: winCheck.yaku },
        });
      }
    }
    const kanAction = this.findKanAction(playerId);
    if (kanAction) options.push(kanAction);
    const allowedDiscardIds = this.getRiichiDiscardIds(playerId);
    if (allowedDiscardIds.length > 0) options.push({ type: "riichi", playerId, options: { allowedDiscardIds } });
    if (options.length > 0) {
      this.setPendingActions(playerId, options);
      return;
    }
    this.waitForHumanDiscard(playerId);
  }

  private queueKanOrRiichiOrDiscard(playerId: string): void {
    const kanAction = this.findKanAction(playerId);
    if (kanAction) {
      this.setPendingAction(kanAction);
      return;
    }
    this.queueRiichiOrDiscard(playerId);
  }

  private queueRiichiOrDiscard(playerId: string): void {
    const allowedDiscardIds = this.getRiichiDiscardIds(playerId);
    if (allowedDiscardIds.length > 0) {
      this.setPendingAction({ type: "riichi", playerId, options: { allowedDiscardIds } });
      return;
    }
    this.waitForHumanDiscard(playerId);
  }

  private waitForHumanDiscard(playerId: string): void {
    this.state.pendingAction = null;
    this.state.phase = "waitingForHumanDiscard";
    this.state.currentPlayerIndex = this.state.players.findIndex((player) => player.id === playerId);
    const player = this.getPlayer(playerId);
    if (player.ippatsuOwnDrawStarted) {
      player.ippatsu = false;
      player.ippatsuOwnDrawStarted = false;
    }
    player.status = "active";
    this.updateHumanActionFlag();
  }

  private queueResponseAfterDiscard(fromPlayerId: string, tile: Tile): boolean {
    const human = this.state.players.find((player) => player.type === "human" && player.id !== fromPlayerId);
    if (!human) return false;

    const options: PendingAction[] = [];
    const ronCheck = this.ruleEngine.canWin(this.state, human, tile);
    if (ronCheck.canWin && ronCheck.yaku?.length && !human.sameTurnFuriten && !this.isPermanentFuriten(human)) {
      options.push({
        type: "ron",
        playerId: human.id,
        fromPlayerId,
        sourceTile: tile,
        options: { yaku: ronCheck.yaku },
      });
    }
    if (this.canMinkan(human.id, tile)) {
      options.push({ type: "kan", playerId: human.id, fromPlayerId, sourceTile: tile, options: { kanType: "minkan" } });
    }
    if (this.canPon(human.id, tile)) {
      options.push({ type: "pon", playerId: human.id, fromPlayerId, sourceTile: tile });
    }
    if (options.length > 0) {
      this.setPendingActions(human.id, options);
      return true;
    }
    return false;
  }

  private queueCallAfterDiscard(tile: Tile | undefined, fromPlayerId: string | undefined, options: { skipRon?: boolean } = {}): boolean {
    if (!tile || !fromPlayerId) return false;
    const human = this.state.players.find((player) => player.type === "human" && player.id !== fromPlayerId);
    if (!human) return false;
    if (this.canMinkan(human.id, tile)) {
      this.setPendingAction({ type: "kan", playerId: human.id, fromPlayerId, sourceTile: tile, options: { kanType: "minkan" } });
      return true;
    }
    if (this.canPon(human.id, tile)) {
      this.setPendingAction({ type: "pon", playerId: human.id, fromPlayerId, sourceTile: tile });
      return true;
    }
    if (options.skipRon) this.continueAfterDiscardCallWindow();
    return false;
  }

  private continueAfterDiscardCallWindow(): void {
    this.state.pendingAction = null;
    this.state.phase = "playing";
    this.advanceTurn();
  }

  private confirmTsumo(action: PendingAction): void {
    const player = this.getPlayer(action.playerId);
    const tile = player.drawnTile ?? action.sourceTile;
    if (!tile) return;
    this.finishHand({
      winnerId: player.id,
      winType: "tsumo",
      yaku: action.options?.yaku ?? this.ruleEngine.canWin(this.state, player, tile).yaku ?? [],
      winningTiles: player.hand,
      selectedWait: tile,
      drawnTile: tile,
      isRiichi: player.isRiichi,
      isIppatsu: player.ippatsu,
    });
  }

  private confirmRon(action: PendingAction): void {
    if (!action.sourceTile || !action.fromPlayerId) return;
    const player = this.getPlayer(action.playerId);
    this.finishHand({
      winnerId: player.id,
      winType: "ron",
      discarderId: action.fromPlayerId,
      yaku: action.options?.yaku ?? this.ruleEngine.canWin(this.state, player, action.sourceTile).yaku ?? [],
      winningTiles: [...player.hand, action.sourceTile],
      selectedWait: action.sourceTile,
      isRiichi: player.isRiichi,
      isIppatsu: player.ippatsu,
    });
  }

  private confirmRiichi(action: PendingAction): void {
    const player = this.getPlayer(action.playerId);
    player.riichiDiscardTileIds = action.options?.allowedDiscardIds ?? this.getRiichiDiscardIds(player.id);
    console.log("[RiichiCandidates]", player.id, player.riichiDiscardTileIds);
    if (player.riichiDiscardTileIds.length === 0) {
      this.waitForHumanDiscard(player.id);
      return;
    }
    this.state.pendingAction = null;
    this.state.phase = "waitingForRiichiDiscard";
    this.state.currentPlayerIndex = this.state.players.findIndex((candidate) => candidate.id === player.id);
    for (const candidate of this.state.players) candidate.status = candidate.id === player.id ? "active" : "waiting";
    this.updateHumanActionFlag();
    this.emitChange();
    return;
    player.isRiichi = true;
    player.ippatsu = true;
    appendHandLogEvent(this.state.handLog, { type: "riichi", playerId: player.id, turnIndex: this.state.turnIndex });
    this.state.log.unshift(`${player.name} がリーチしました`);
    this.queueKanOrRiichiOrDiscard(player.id);
  }

  private confirmPon(action: PendingAction): void {
    if (!action.sourceTile || !action.fromPlayerId) return;
    const player = this.getPlayer(action.playerId);
    const consumedTiles = takeMatchingTiles(player.hand, action.sourceTile, 2);
    if (consumedTiles.length !== 2) return;
    player.melds.push({ type: "pon", tiles: [...consumedTiles, action.sourceTile], fromPlayerId: action.fromPlayerId });
    appendHandLogEvent(this.state.handLog, {
      type: "pon",
      playerId: player.id,
      fromPlayerId: action.fromPlayerId,
      tile: action.sourceTile,
      consumedTiles,
      turnIndex: this.state.turnIndex,
    });
    this.clearAllIppatsu();
    this.state.pendingAction = null;
    this.state.currentPlayerIndex = this.state.players.findIndex((candidate) => candidate.id === player.id);
    for (const candidate of this.state.players) candidate.status = candidate.id === player.id ? "active" : "waiting";
    this.waitForHumanDiscard(player.id);
    this.emitChange();
  }

  private confirmKan(action: PendingAction): void {
    const player = this.getPlayer(action.playerId);
    const kanType = action.options?.kanType ?? "ankan";
    let tiles: Tile[] = [];
    if (kanType === "minkan" && action.sourceTile && action.fromPlayerId) {
      const consumed = takeMatchingTiles(player.hand, action.sourceTile, 3);
      if (consumed.length !== 3) return;
      tiles = [...consumed, action.sourceTile];
      player.melds.push({ type: "minkan", tiles, fromPlayerId: action.fromPlayerId });
    } else if (kanType === "kakan") {
      const concealedTiles = [...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])];
      const pon = player.melds.find((meld) => meld.type === "pon" && Boolean(findMatchingTile(concealedTiles, meld.tiles[0])));
      const addTile = pon ? findMatchingTile(concealedTiles, pon.tiles[0]) : null;
      if (!pon || !addTile) return;
      removeTileById(player, addTile.id);
      pon.type = "kakan";
      pon.tiles.push(addTile);
      tiles = [...pon.tiles];
    } else {
      const group = findFourOfAKind([...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])]);
      if (!group) return;
      for (const tile of group) removeTileById(player, tile.id);
      tiles = group;
      player.melds.push({ type: "ankan", tiles });
    }

    this.state.kanCount += 1;
    appendHandLogEvent(this.state.handLog, {
      type: "kan",
      playerId: player.id,
      ...(action.fromPlayerId ? { fromPlayerId: action.fromPlayerId } : {}),
      tiles,
      kanType,
      turnIndex: this.state.turnIndex,
    });
    this.revealAdditionalDoraIndicator("kan");
    const rinshanTile = this.state.rinshanWall.shift() ?? null;
    if (rinshanTile) {
      player.drawnTile = rinshanTile;
      this.state.lastDrawnTile = rinshanTile;
      appendHandLogEvent(this.state.handLog, {
        type: "draw",
        playerId: player.id,
        tile: rinshanTile,
        from: "rinshanWall",
        turnIndex: this.state.turnIndex,
      });
    }
    this.clearAllIppatsu();
    this.state.pendingAction = null;
    if (player.type === "human") this.queueTsumoKanRiichiOrDiscard(player.id);
    else this.state.phase = "playing";
    this.emitChange();
  }

  private canRiichi(playerId: string): boolean {
    const player = this.getPlayer(playerId);
    if (player.isRiichi || player.melds.some((meld) => meld.type === "pon" || meld.type === "minkan" || meld.type === "kakan")) return false;
    const tiles = getHandTilesForHandEvaluation([...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])]);
    if (tiles.length !== 14) return false;
    const candidates = this.getCandidateWinningTiles();
    return tiles.some((discardCandidate) => {
      const remaining = [...tiles];
      const index = remaining.findIndex((tile) => tile.id === discardCandidate.id);
      if (index < 0) return false;
      remaining.splice(index, 1);
      const simulatedPlayer: Player = {
        ...player,
        hand: remaining,
        drawnTile: null,
        isRiichi: true,
      };
      return candidates.some((tile) => this.ruleEngine.canWin(this.state, simulatedPlayer, tile).canWin);
    });
  }

  private canPon(playerId: string, tile: Tile): boolean {
    const player = this.getPlayer(playerId);
    return !player.isRiichi && this.state.phase !== "handEnded" && player.hand.filter((handTile) => sameTileKind(handTile, tile)).length >= 2;
  }

  private canMinkan(playerId: string, tile: Tile): boolean {
    const player = this.getPlayer(playerId);
    return !player.isRiichi && this.state.kanCount < 4 && player.hand.filter((handTile) => sameTileKind(handTile, tile)).length >= 3;
  }

  private findKanAction(playerId: string): PendingAction | null {
    if (this.state.kanCount >= 4) return null;
    const player = this.getPlayer(playerId);
    // 簡易実装: リーチ後の暗槓は待ち変化判定が必要なため、現時点では禁止する。
    if (player.isRiichi) return null;
    const four = findFourOfAKind([...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])]);
    if (four) return { type: "kan", playerId, options: { kanType: "ankan" } };
    for (const meld of player.melds) {
      if (meld.type !== "pon") continue;
      const addTile = findMatchingTile([...player.hand, ...(player.drawnTile ? [player.drawnTile] : [])], meld.tiles[0]);
      if (addTile) return { type: "kan", playerId, options: { kanType: "kakan" } };
    }
    return null;
  }

  private autoNukiDoraForCurrentTurn(): void {
    const player = getCurrentPlayer(this.state);
    while (canNukiDora(this.state, player.id)) {
      const flowerTile = player.drawnTile?.suit === "flower" ? player.drawnTile : player.hand.find((tile) => tile.suit === "flower");
      if (!flowerTile) break;
      this.performNukiDora(player.id, flowerTile.id, { suppressEmit: true });
    }
  }

  private revealAdditionalDoraIndicator(reason: "kan"): void {
    const doraIndicator = this.state.liveWall.pop();
    if (doraIndicator) {
      this.state.doraIndicators.push(doraIndicator);
      appendHandLogEvent(this.state.handLog, {
        type: "doraReveal",
        tile: doraIndicator,
        doraIndicators: [...this.state.doraIndicators],
        turnIndex: this.state.turnIndex,
        reason,
      });
    }
    const uraDoraIndicator = this.state.liveWall.pop();
    if (uraDoraIndicator) this.state.uraDoraIndicators.push(uraDoraIndicator);
  }

  private setPendingAction(action: PendingAction): void {
    const player = this.getPlayer(action.playerId);
    if (player.type === "cpu") return;
    this.state.pendingAction = { playerId: action.playerId, options: [action] };
    this.state.phase = "waitingForAction";
    this.state.isWaitingForHumanAction = true;
  }

  private setPendingActions(playerId: string, options: PendingAction[]): void {
    const player = this.getPlayer(playerId);
    if (player.type === "cpu" || options.length === 0) return;
    this.state.pendingAction = { playerId, options };
    this.state.phase = "waitingForAction";
    this.state.isWaitingForHumanAction = true;
  }

  private getCandidateWinningTiles(): Tile[] {
    return getAllWinningCheckTiles();
  }

  private getPlayer(playerId: string): Player {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error(`Player not found: ${playerId}`);
    return player;
  }

  private clearAllIppatsu(): void {
    for (const player of this.state.players) {
      player.ippatsu = false;
      player.ippatsuOwnDrawStarted = false;
    }
  }

  private clearIppatsuForOthers(playerId: string): void {
    for (const player of this.state.players) {
      if (player.id !== playerId) {
        player.ippatsu = false;
        player.ippatsuOwnDrawStarted = false;
      }
    }
  }

  private dealInitialHands(): void {
    for (let tileIndex = 0; tileIndex < 13; tileIndex += 1) {
      for (const player of this.state.players) {
        const tile = this.state.liveWall.shift();
        if (tile) player.hand.push(tile);
      }
    }
  }

  private sortAllHands(): void {
    for (const player of this.state.players) player.hand = sortHandTiles(player.hand);
  }

  private createHandLog(): HandLog {
    return {
      handId: `east-${this.state.round.handNumber}-${Date.now()}`,
      roundLabel: `東場 第${this.state.round.handNumber}局`,
      dealerId: this.state.round.dealerPlayerId,
      events: [],
      initialHands: Object.fromEntries(this.state.players.map((player) => [player.id, [...player.hand]])),
      initialDoraIndicators: [...this.state.doraIndicators],
      initialScores: Object.fromEntries(this.state.players.map((player) => [player.id, player.score])),
    };
  }

  private updateHumanActionFlag(): void {
    this.state.isWaitingForHumanAction =
      (this.state.phase === "waitingForAction" && Boolean(this.state.pendingAction)) ||
      (this.state.phase === "waitingForHumanDiscard" && getCurrentPlayer(this.state).type === "human");
  }

  private assertAllHandSizes(): void {
    for (const player of this.state.players) this.assertPlayerHandSize(player);
  }

  private assertPlayerHandSize(player: Player): void {
    const concealed = player.hand.length + (player.drawnTile ? 1 : 0);
    const meldTiles = player.melds.reduce((sum, meld) => sum + (meld.type === "pon" ? 3 : 3), 0);
    const total = concealed + meldTiles;
    console.log("[HandCount]", player.id, player.hand.length, Boolean(player.drawnTile));
    if ((this.state.phase === "playing" || this.state.phase === "waitingForHumanDiscard" || this.state.phase === "waitingForRiichiDiscard" || this.state.phase === "waitingForAction") && (total < 13 || total > 14)) {
      console.error(`Invalid hand size for ${player.id}: concealed=${concealed}, meld=${meldTiles}`);
    }
  }

  private endExhaustiveDraw(): void {
    if (this.state.phase === "exhaustiveDraw") return;
    const tenpaiPlayerIds = this.state.players
      .filter((player) => this.getCandidateWinningTiles().some((tile) => this.ruleEngine.canWin(this.state, { ...player, hand: player.hand.slice(0, 13), drawnTile: null, isRiichi: true }, tile).canWin))
      .map((player) => player.id);
    const notenPlayerIds = this.state.players.filter((player) => !tenpaiPlayerIds.includes(player.id)).map((player) => player.id);
    const paymentMap = Object.fromEntries(this.state.players.map((player) => [player.id, 0]));
    if (tenpaiPlayerIds.length === 1) {
      paymentMap[tenpaiPlayerIds[0]] = 30;
      for (const id of notenPlayerIds) paymentMap[id] = -15;
    } else if (tenpaiPlayerIds.length === 2) {
      for (const id of tenpaiPlayerIds) paymentMap[id] = 15;
      for (const id of notenPlayerIds) paymentMap[id] = -30;
    }
    for (const player of this.state.players) player.score += paymentMap[player.id] ?? 0;
    const payments = Object.entries(paymentMap).map(([playerId, delta]) => ({ playerId, delta }));
    const finalScores = Object.fromEntries(this.state.players.map((player) => [player.id, player.score]));
    this.state.pendingAction = null;
    this.state.phase = "exhaustiveDraw";
    this.state.isWaitingForHumanAction = false;
    appendHandLogEvent(this.state.handLog, { type: "exhaustiveDraw", turnIndex: this.state.turnIndex, reason: "liveWallEmpty" });
    this.state.handLog.result = { type: "exhaustiveDraw", reason: "liveWallEmpty", tenpaiPlayerIds, notenPlayerIds, payments, finalScores };
    console.log("[Phase]", this.state.phase);
  }

  private emitChange(): void {
    this.updateHumanActionFlag();
    this.onStateChanged(this.state);
  }
}

function sameTileKind(left: Tile, right: Tile): boolean {
  return tileKindKey(left) === tileKindKey(right);
}

function tileKindKey(tile: Tile): string {
  if (tile.suit === "manzu" || tile.suit === "pinzu" || tile.suit === "souzu") return `${tile.suit}-${tile.rank}`;
  return `${tile.suit}-${tile.kind}`;
}

function getAllTileTypesForWinningCheck(): string[] {
  return [
    "manzu-1",
    "manzu-9",
    ...Array.from({ length: 9 }, (_, index) => `pinzu-${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `souzu-${index + 1}`),
    "honor-east",
    "honor-south",
    "honor-west",
    "honor-north",
    "honor-white",
    "honor-green",
    "honor-red",
  ];
}

function createVirtualTile(tileType: string): Tile {
  const [suit, value] = tileType.split("-");
  if (suit === "honor") {
    return { id: `virtual-${tileType}`, suit: "honor", kind: value as Tile["kind"], color: "normal", isPochi: false };
  }
  return { id: `virtual-${tileType}`, suit: suit as Tile["suit"], rank: Number(value), color: "normal", isPochi: false };
}

function getAllWinningCheckTiles(): Tile[] {
  return getAllTileTypesForWinningCheck().map(createVirtualTile);
}

function takeMatchingTiles(hand: Tile[], target: Tile, count: number): Tile[] {
  const consumed: Tile[] = [];
  for (const tile of [...hand]) {
    if (consumed.length >= count) break;
    if (sameTileKind(tile, target)) {
      consumed.push(tile);
      const index = hand.findIndex((candidate) => candidate.id === tile.id);
      if (index >= 0) hand.splice(index, 1);
    }
  }
  return consumed;
}

function findMatchingTile(tiles: Tile[], target: Tile): Tile | null {
  return tiles.find((tile) => sameTileKind(tile, target)) ?? null;
}

function findFourOfAKind(tiles: Tile[]): Tile[] | null {
  const groups = new Map<string, Tile[]>();
  for (const tile of tiles) {
    const key = tileKindKey(tile);
    const group = groups.get(key) ?? [];
    group.push(tile);
    groups.set(key, group);
  }
  return [...groups.values()].find((group) => group.length >= 4)?.slice(0, 4) ?? null;
}

function removeTileById(player: Player, tileId: string): void {
  if (player.drawnTile?.id === tileId) {
    player.drawnTile = null;
    return;
  }
  player.hand = player.hand.filter((tile) => tile.id !== tileId);
}
