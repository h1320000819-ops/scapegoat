import type { PochiColor, Tile } from "../domain/Tile";
import { createCandidateFiveTile, createPlainWhiteTile } from "../domain/TileSet";
import { applyPointMultiplier, calculateCustomScore } from "../scoring/ScoringCalculator";
import type { ScoreCalculationInput, ScoreResult } from "../scoring/ScoreTypes";

type PochiCandidate = {
  wait: Tile;
  scoreResult: ScoreResult;
};

export function shouldActivatePochi(input: ScoreCalculationInput): boolean {
  return Boolean(input.isRiichi && input.drawnTile && isPochiTile(input.drawnTile) && input.waitingTiles?.length);
}

export function isPochiTile(tile: Tile): boolean {
  return tile.suit === "honor" && tile.kind === "white" && tile.isPochi === true && Boolean(tile.pochiColor);
}

export function resolvePochiScore(input: ScoreCalculationInput): ScoreResult {
  if (!input.drawnTile || !isPochiTile(input.drawnTile)) {
    throw new Error("Pochi resolution requires a drawn pochi tile.");
  }

  const multiplier = getPochiMultiplier(input.drawnTile.pochiColor);
  const candidates = createPochiCandidates(input).map((candidateInput) => {
    if (!candidateInput.selectedWait) {
      throw new Error("Pochi candidate requires selectedWait.");
    }
    const normalScore = calculateCustomScore(candidateInput);
    const scoreResult: ScoreResult = {
      ...applyPointMultiplier(normalScore, multiplier),
      pochiActivated: true,
      ...(input.drawnTile?.pochiColor ? { pochiColor: input.drawnTile.pochiColor } : {}),
    };
    return {
      wait: candidateInput.selectedWait,
      scoreResult,
    };
  });

  if (candidates.length === 0) {
    throw new Error("Pochi resolution requires at least one waiting tile.");
  }

  const best = candidates.reduce((currentBest, candidate) => {
    return Math.abs(candidate.scoreResult.finalPoints) > Math.abs(currentBest.scoreResult.finalPoints) ? candidate : currentBest;
  });

  return {
    ...best.scoreResult,
    selectedWait: best.wait,
  };
}

function createPochiCandidates(input: ScoreCalculationInput): ScoreCalculationInput[] {
  const waitingTiles = input.waitingTiles ?? [];

  return waitingTiles.map((wait) => {
    const selectedWait = convertWaitForPochi(wait, input.drawnTile);
    const { waitingTiles: _waitingTiles, ...restInput } = input;
    void _waitingTiles;
    return {
      ...restInput,
      selectedWait,
      winningTiles: replaceDrawnPochiWithSelectedWait(input.winningTiles, input.drawnTile, selectedWait),
      drawnTile: selectedWait,
    };
  });
}

function convertWaitForPochi(wait: Tile, drawnPochiTile: Tile | undefined): Tile {
  if (isWhiteWait(wait)) {
    return createPlainWhiteTile();
  }

  if (isFivePinzuOrSouzu(wait)) {
    const color = drawnPochiTile?.pochiColor === "red" || drawnPochiTile?.pochiColor === "blue" ? "blue" : "red";
    return createCandidateFiveTile(wait.suit, color);
  }

  const { pochiColor: _pochiColor, ...plainWait } = wait;
  void _pochiColor;
  return {
    ...plainWait,
    id: `candidate-${wait.id}`,
    isPochi: false,
  };
}

function replaceDrawnPochiWithSelectedWait(tiles: Tile[], drawnPochiTile: Tile | undefined, selectedWait: Tile): Tile[] {
  if (!drawnPochiTile) {
    return [...tiles, selectedWait];
  }

  let replaced = false;
  const replacedTiles = tiles.map((tile) => {
    if (!replaced && tile.id === drawnPochiTile.id) {
      replaced = true;
      return selectedWait;
    }
    return tile;
  });

  return replaced ? replacedTiles : [...tiles, selectedWait];
}

function isWhiteWait(tile: Tile): boolean {
  return tile.suit === "honor" && tile.kind === "white";
}

function isFivePinzuOrSouzu(tile: Tile): tile is Tile & { suit: "pinzu" | "souzu"; rank: 5 } {
  return (tile.suit === "pinzu" || tile.suit === "souzu") && tile.rank === 5;
}

function getPochiMultiplier(pochiColor: PochiColor | undefined): number {
  switch (pochiColor) {
    case "red":
      return -2;
    case "yellow":
      return -1;
    case "blue":
      return 2;
    case "green":
    default:
      return 1;
  }
}
