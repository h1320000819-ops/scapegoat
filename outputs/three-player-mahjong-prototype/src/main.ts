import { GameController } from "./application/GameController";
import { createPlayer } from "./domain/Player";
import type { Tile } from "./domain/Tile";
import { getCurrentPlayer } from "./domain/GameState";
import { PrototypeRuleEngine } from "./rules/PrototypeRuleEngine";
import { GameView } from "./ui/GameView";

const players = [
  createPlayer("p1", "自分", "human"),
  createPlayer("p2", "CPU1", "cpu"),
  createPlayer("p3", "CPU2", "cpu"),
];

const root = document.querySelector<HTMLElement>("#game-root");
const startButton = document.querySelector<HTMLButtonElement>("#start-button");
const scoreDemoButton = document.querySelector<HTMLButtonElement>("#score-demo-button");

if (!root || !startButton || !scoreDemoButton) {
  throw new Error("必要なHTML要素が見つかりません");
}

const ruleEngine = new PrototypeRuleEngine();
let controller: GameController;

const view = new GameView(root, {
  onStart: () => controller.startGame(),
  onDraw: () => controller.advanceUntilHumanAction(),
  onNuki: (tileId) => {
    const currentPlayer = getCurrentPlayer(controller.getState());
    controller.performNukiDora(currentPlayer.id, tileId);
  },
  onConfirmAction: (actionType) => controller.confirmPendingAction(actionType),
  onSkipAction: () => controller.skipPendingAction(),
  onResultOk: () => controller.startNextHand(),
  onScoreDemo: () => {
    const currentPlayer = getCurrentPlayer(controller.getState());
    const redPochi: Tile = {
      id: "demo-red-pochi",
      suit: "honor",
      kind: "white",
      color: "normal",
      isPochi: true,
      pochiColor: "red",
    };

    controller.finishHand({
      winnerId: currentPlayer.id,
      winType: "tsumo",
      yaku: [{ name: "タンヤオ", han: 1 }],
      winningTiles: [...currentPlayer.hand, redPochi],
      selectedWait: redPochi,
      drawnTile: redPochi,
      waitingTiles: [
        { id: "wait-5p", suit: "pinzu", rank: 5, color: "red", isPochi: false },
        { id: "wait-white", suit: "honor", kind: "white", color: "normal", isPochi: false },
      ],
      isRiichi: true,
      doraCount: 0,
      uraDoraCount: 0,
      honba: 0,
      isIppatsu: false,
    });
  },
  onDiscard: (tileId) => controller.discardTile(tileId),
});

controller = new GameController(players, ruleEngine, (state) => view.render(state));
view.bindStaticControls(startButton, document.createElement("button"), scoreDemoButton);
view.render(controller.getState());
