import type { GameState } from "../domain/GameState";
import type { Meld as PlayerMeld, Player } from "../domain/Player";
import type { Tile } from "../domain/Tile";
import { getHandTilesForHandEvaluation } from "../domain/TileUtils";
import type { YakuResult } from "../scoring/ScoreTypes";
import type { WinCheckResult } from "./RuleEngine";

type TileKey = string;

type ShapeMeld =
  | { type: "sequence"; suit: "manzu" | "pinzu" | "souzu"; start: number; keys: TileKey[]; source: "concealed" }
  | { type: "triplet"; key: TileKey; keys: TileKey[]; source: "concealed" | "pon" | "ankan" | "minkan" | "kakan" };

type StandardShape = {
  pairKey: TileKey;
  melds: ShapeMeld[];
};

const TERMINAL_HONOR_KEYS = new Set([
  "manzu-1",
  "manzu-9",
  "pinzu-1",
  "pinzu-9",
  "souzu-1",
  "souzu-9",
  "honor-east",
  "honor-south",
  "honor-west",
  "honor-north",
  "honor-white",
  "honor-green",
  "honor-red",
]);

const KOKUSHI_KEYS = TERMINAL_HONOR_KEYS;
const DRAGON_KEYS = new Set(["honor-white", "honor-green", "honor-red"]);
const WIND_KEYS = new Set(["honor-east", "honor-south", "honor-west", "honor-north"]);

export function evaluateRiichiMahjongWin(state: GameState, player: Player, winningTile: Tile | null): WinCheckResult {
  const concealedTiles = getHandTilesForHandEvaluation([
    ...player.hand,
    ...(winningTile ? [winningTile] : player.drawnTile ? [player.drawnTile] : []),
  ]);
  const fixedMelds = getFixedMelds(player.melds);
  const meldCount = fixedMelds.length;
  const isClosed = isMenzen(player);
  const isTsumo = Boolean(player.drawnTile && (!winningTile || player.drawnTile.id === winningTile.id));
  const winningKey = winningTile ? tileKey(winningTile) : player.drawnTile ? tileKey(player.drawnTile) : null;

  if (concealedTiles.length + meldCount * 3 !== 14) {
    return { canWin: false, reason: "和了判定には14枚相当の牌が必要です" };
  }

  const concealedCounts = countTiles(concealedTiles);
  const allTiles = [...concealedTiles, ...player.melds.flatMap((meld) => meld.tiles)];
  const allCounts = countTiles(allTiles);

  if (meldCount === 0 && isKokushi(concealedCounts)) {
    return {
      canWin: true,
      handType: "kokushi",
      yaku: [{ name: "国士無双", han: 13, isYakuman: true, detail: isKokushiThirteenWait(player.hand) ? "13面待ち" : undefined }],
      han: 13,
    };
  }

  const baseYaku = getSituationYaku({ player, isClosed, isTsumo });

  if (meldCount === 0 && isSevenPairs(concealedCounts)) {
    const yaku = [
      ...baseYaku,
      { name: "七対子", han: 2 },
      ...getTerminalYakuForSevenPairs(allTiles),
      ...getColorYaku(allTiles, isClosed),
    ];
    return finalizeYaku("sevenPairs", dedupeYaku(yaku));
  }

  const concealedShapes = findStandardShapes(concealedCounts, 4 - meldCount);
  if (concealedShapes.length === 0) {
    return { canWin: false, reason: "4面子1雀頭、七対子、国士無双のいずれにも該当しません" };
  }

  const candidates = concealedShapes.map((shape) => {
    const completeShape: StandardShape = { pairKey: shape.pairKey, melds: [...shape.melds, ...fixedMelds] };
    const yaku = [
      ...baseYaku,
      ...getStandardYaku({ state, player, allTiles, allCounts, isClosed, isTsumo, winningKey }, completeShape),
    ];
    return { shape: completeShape, yaku: dedupeYaku(applyYakumanPolicy(yaku)) };
  });

  const best = candidates.sort((left, right) => sumHan(right.yaku) - sumHan(left.yaku))[0];
  return finalizeYaku("standard", best?.yaku ?? []);
}

function finalizeYaku(handType: WinCheckResult["handType"], yaku: YakuResult[]): WinCheckResult {
  if (yaku.length === 0) return { canWin: false, handType, reason: "和了形ですが役がありません" };
  return { canWin: true, handType, yaku, han: sumHan(yaku) };
}

function getSituationYaku(context: { player: Player; isClosed: boolean; isTsumo: boolean }): YakuResult[] {
  const yaku: YakuResult[] = [];
  if (!context.isClosed) return yaku;
  if (context.player.isRiichi) yaku.push({ name: "リーチ", han: 1 });
  if (context.player.ippatsu) yaku.push({ name: "一発", han: 1 });
  if (context.isTsumo) yaku.push({ name: "門前清自摸和", han: 1 });
  return yaku;
}

function getStandardYaku(
  context: {
    state: GameState;
    player: Player;
    allTiles: Tile[];
    allCounts: Map<TileKey, number>;
    isClosed: boolean;
    isTsumo: boolean;
    winningKey: TileKey | null;
  },
  shape: StandardShape,
): YakuResult[] {
  const yaku: YakuResult[] = [];
  const sequences = shape.melds.filter((meld): meld is Extract<ShapeMeld, { type: "sequence" }> => meld.type === "sequence");
  const triplets = shape.melds.filter((meld): meld is Extract<ShapeMeld, { type: "triplet" }> => meld.type === "triplet");
  const isOpen = !context.isClosed;

  yaku.push(...getYakumanYaku(context, shape, triplets));
  if (yaku.some((item) => item.isYakuman)) return yaku;

  if (isTanyao(context.allTiles)) yaku.push({ name: "タンヤオ", han: 1 });

  for (const triplet of triplets) {
    const han = getYakuhaiHan(triplet.key, getSeatWind(context.state, context.player.id), context.state.round.roundWind);
    if (han > 0) {
      yaku.push({
        name: `役牌 ${labelKey(triplet.key)}`,
        han,
        detail: han === 2 ? "常時役牌 + 自風" : undefined,
      });
    }
  }

  if (context.isClosed && isPinfu(shape, context)) yaku.push({ name: "平和", han: 1 });

  if (context.isClosed) {
    const iipeikouCount = countIipeikouPairs(sequences);
    if (iipeikouCount >= 2) yaku.push({ name: "二盃口", han: 3 });
    else if (iipeikouCount === 1) yaku.push({ name: "一盃口", han: 1 });
  }

  if (triplets.length === 4) yaku.push({ name: "対々和", han: 2 });

  const ankouCount = countAnkou(triplets, context);
  if (ankouCount >= 3) yaku.push({ name: "三暗刻", han: 2 });

  const kanCount = context.player.melds.filter((meld) => meld.type === "ankan" || meld.type === "minkan" || meld.type === "kakan").length;
  if (kanCount >= 3) yaku.push({ name: "三槓子", han: 2 });

  if (isShousangen(shape, triplets)) yaku.push({ name: "小三元", han: 2 });
  if (isHonroutou(context.allTiles)) yaku.push({ name: "混老頭", han: 2 });
  if (hasSanshokuDoujun(sequences)) yaku.push({ name: "三色同順", han: isOpen ? 1 : 2 });
  if (hasIttsu(sequences)) yaku.push({ name: "一気通貫", han: isOpen ? 1 : 2 });

  const terminalYaku = getChantaOrJunchan(context.allTiles, shape, isOpen);
  if (terminalYaku) yaku.push(terminalYaku);

  yaku.push(...getColorYaku(context.allTiles, context.isClosed));

  return yaku;
}

function getYakumanYaku(
  context: { allTiles: Tile[]; player: Player; isClosed: boolean; isTsumo: boolean; winningKey: TileKey | null },
  shape: StandardShape,
  triplets: Extract<ShapeMeld, { type: "triplet" }>[],
): YakuResult[] {
  const yaku: YakuResult[] = [];
  const tripletKeys = new Set(triplets.map((meld) => meld.key));
  const pairKey = shape.pairKey;
  const ankouCount = countAnkou(triplets, context);
  const kanCount = context.player.melds.filter((meld) => meld.type === "ankan" || meld.type === "minkan" || meld.type === "kakan").length;

  if (context.isClosed && ankouCount === 4) {
    yaku.push({ name: "四暗刻", han: 13, isYakuman: true, detail: context.winningKey === pairKey ? "単騎" : undefined });
  }
  if (["honor-white", "honor-green", "honor-red"].every((key) => tripletKeys.has(key))) yaku.push({ name: "大三元", han: 13, isYakuman: true });
  if (context.allTiles.every((tile) => tile.suit === "honor")) yaku.push({ name: "字一色", han: 13, isYakuman: true });

  const windTripletCount = ["honor-east", "honor-south", "honor-west", "honor-north"].filter((key) => tripletKeys.has(key)).length;
  if (windTripletCount === 4) yaku.push({ name: "大四喜", han: 13, isYakuman: true });
  else if (windTripletCount === 3 && WIND_KEYS.has(pairKey)) yaku.push({ name: "小四喜", han: 13, isYakuman: true });

  if (context.allTiles.every((tile) => tile.suit !== "honor" && (tile.rank === 1 || tile.rank === 9))) {
    yaku.push({ name: "清老頭", han: 13, isYakuman: true });
  }
  if (kanCount === 4) yaku.push({ name: "四槓子", han: 13, isYakuman: true });

  return yaku;
}

function applyYakumanPolicy(yaku: YakuResult[]): YakuResult[] {
  const yakuman = yaku.filter((item) => item.isYakuman);
  return yakuman.length > 0 ? yakuman : yaku;
}

function getColorYaku(tiles: Tile[], isClosed: boolean): YakuResult[] {
  const numberTiles = tiles.filter((tile) => tile.suit === "manzu" || tile.suit === "pinzu" || tile.suit === "souzu");
  const suits = new Set(numberTiles.map((tile) => tile.suit));
  const hasHonor = tiles.some((tile) => tile.suit === "honor");
  if (suits.size === 1 && !hasHonor) return [{ name: "清一色", han: isClosed ? 6 : 5 }];
  if (suits.size === 1 && hasHonor) return [{ name: "混一色", han: isClosed ? 3 : 2 }];
  return [];
}

function getTerminalYakuForSevenPairs(tiles: Tile[]): YakuResult[] {
  return isHonroutou(tiles) ? [{ name: "混老頭", han: 2 }] : [];
}

function getChantaOrJunchan(tiles: Tile[], shape: StandardShape, isOpen: boolean): YakuResult | null {
  if (isHonroutou(tiles)) return null;
  const hasSequence = shape.melds.some((meld) => meld.type === "sequence");
  if (!hasSequence) return null;
  const everySetHasTerminalOrHonor = [shape.pairKey, ...shape.melds.map((meld) => setTerminalCheckKey(meld))]
    .every((key) => key === "terminal-set" || TERMINAL_HONOR_KEYS.has(key));
  if (!everySetHasTerminalOrHonor) return null;
  const hasHonor = tiles.some((tile) => tile.suit === "honor");
  if (hasHonor) return { name: "チャンタ", han: isOpen ? 1 : 2 };
  return { name: "純チャン", han: isOpen ? 2 : 3 };
}

function setTerminalCheckKey(meld: ShapeMeld): TileKey | "terminal-set" {
  if (meld.type === "triplet") return meld.key;
  return meld.start === 1 || meld.start === 7 ? "terminal-set" : `${meld.suit}-${meld.start}`;
}

function countAnkou(triplets: Extract<ShapeMeld, { type: "triplet" }>[], context: { isTsumo: boolean; winningKey: TileKey | null }): number {
  return triplets.filter((triplet) => {
    if (triplet.source === "ankan") return true;
    if (triplet.source !== "concealed") return false;
    if (!context.isTsumo && triplet.key === context.winningKey) return false;
    return true;
  }).length;
}

function isPinfu(shape: StandardShape, context: { state: GameState; player: Player; winningKey: TileKey | null }): boolean {
  if (!shape.melds.every((meld) => meld.type === "sequence")) return false;
  if (getYakuhaiHan(shape.pairKey, getSeatWind(context.state, context.player.id), context.state.round.roundWind) > 0) return false;
  return isRyanmenWait(shape, context.winningKey);
}

function isRyanmenWait(shape: StandardShape, winningKey: TileKey | null): boolean {
  if (!winningKey || shape.pairKey === winningKey) return false;
  const parsed = parseNumberKey(winningKey);
  if (!parsed) return false;
  return shape.melds.some((meld) => {
    if (meld.type !== "sequence" || meld.suit !== parsed.suit) return false;
    if (parsed.rank === meld.start) return meld.start !== 7;
    if (parsed.rank === meld.start + 2) return meld.start !== 1;
    return false;
  });
}

function isTanyao(tiles: Tile[]): boolean {
  return tiles.every((tile) => tile.suit !== "honor" && tile.suit !== "flower" && tile.rank !== 1 && tile.rank !== 9);
}

function isSevenPairs(counts: Map<TileKey, number>): boolean {
  let pairCount = 0;
  for (const count of counts.values()) {
    if (count === 2) pairCount += 1;
    else if (count === 4) pairCount += 2;
    else return false;
  }
  return pairCount === 7;
}

function isKokushi(counts: Map<TileKey, number>): boolean {
  return [...KOKUSHI_KEYS].every((key) => (counts.get(key) ?? 0) >= 1) &&
    [...counts.keys()].every((key) => KOKUSHI_KEYS.has(key)) &&
    [...counts.values()].some((count) => count >= 2);
}

function isKokushiThirteenWait(handTiles: Tile[]): boolean {
  const counts = countTiles(getHandTilesForHandEvaluation(handTiles));
  return counts.size === 13 && [...KOKUSHI_KEYS].every((key) => (counts.get(key) ?? 0) === 1);
}

function isHonroutou(tiles: Tile[]): boolean {
  return tiles.every((tile) => TERMINAL_HONOR_KEYS.has(tileKey(tile)));
}

function isShousangen(shape: StandardShape, triplets: Extract<ShapeMeld, { type: "triplet" }>[]): boolean {
  const dragonTriplets = triplets.filter((meld) => DRAGON_KEYS.has(meld.key)).length;
  return dragonTriplets === 2 && DRAGON_KEYS.has(shape.pairKey);
}

function countIipeikouPairs(sequences: Extract<ShapeMeld, { type: "sequence" }>[]): number {
  const counts = new Map<string, number>();
  for (const sequence of sequences) {
    const key = `${sequence.suit}-${sequence.start}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.floor(count / 2), 0);
}

function hasSanshokuDoujun(sequences: Extract<ShapeMeld, { type: "sequence" }>[]): boolean {
  for (let start = 1; start <= 7; start += 1) {
    const suits = new Set(sequences.filter((meld) => meld.start === start).map((meld) => meld.suit));
    if (suits.has("manzu") && suits.has("pinzu") && suits.has("souzu")) return true;
  }
  return false;
}

function hasIttsu(sequences: Extract<ShapeMeld, { type: "sequence" }>[]): boolean {
  for (const suit of ["manzu", "pinzu", "souzu"] as const) {
    const starts = new Set(sequences.filter((meld) => meld.suit === suit).map((meld) => meld.start));
    if (starts.has(1) && starts.has(4) && starts.has(7)) return true;
  }
  return false;
}

function findStandardShapes(counts: Map<TileKey, number>, neededMelds = 4): StandardShape[] {
  const shapes: StandardShape[] = [];
  for (const [pairKey, count] of counts) {
    if (count < 2) continue;
    const remaining = new Map(counts);
    remaining.set(pairKey, count - 2);
    for (const melds of extractMelds(remaining)) {
      if (melds.length === neededMelds) shapes.push({ pairKey, melds });
    }
  }
  return shapes;
}

function extractMelds(counts: Map<TileKey, number>): ShapeMeld[][] {
  const first = firstPositiveCountEntry(counts);
  if (!first) return [[]];
  const [key, count] = first;
  const results: ShapeMeld[][] = [];

  if (count >= 3) {
    const next = new Map(counts);
    next.set(key, count - 3);
    for (const rest of extractMelds(next)) results.push([{ type: "triplet", key, keys: [key, key, key], source: "concealed" }, ...rest]);
  }

  const parsed = parseNumberKey(key);
  if (parsed && parsed.rank <= 7) {
    const second = `${parsed.suit}-${parsed.rank + 1}`;
    const third = `${parsed.suit}-${parsed.rank + 2}`;
    if ((counts.get(second) ?? 0) > 0 && (counts.get(third) ?? 0) > 0) {
      const next = new Map(counts);
      next.set(key, (next.get(key) ?? 0) - 1);
      next.set(second, (next.get(second) ?? 0) - 1);
      next.set(third, (next.get(third) ?? 0) - 1);
      for (const rest of extractMelds(next)) {
        results.push([{ type: "sequence", suit: parsed.suit, start: parsed.rank, keys: [key, second, third], source: "concealed" }, ...rest]);
      }
    }
  }

  return results;
}

function firstPositiveCountEntry(counts: Map<TileKey, number>): [TileKey, number] | undefined {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => tileTypeSortValue(left) - tileTypeSortValue(right))[0];
}

function tileTypeSortValue(key: TileKey): number {
  const parsed = parseNumberKey(key);
  if (parsed) return ({ manzu: 0, pinzu: 10, souzu: 20 }[parsed.suit] ?? 90) + parsed.rank;
  const honorOrder: Record<string, number> = {
    "honor-east": 30,
    "honor-south": 31,
    "honor-west": 32,
    "honor-north": 33,
    "honor-white": 34,
    "honor-green": 35,
    "honor-red": 36,
  };
  return honorOrder[key] ?? 99;
}

function getFixedMelds(playerMelds: PlayerMeld[]): ShapeMeld[] {
  return playerMelds.map((meld) => ({
    type: "triplet",
    key: tileKey(meld.tiles[0]),
    keys: meld.tiles.map(tileKey),
    source: meld.type,
  }));
}

function isMenzen(player: Player): boolean {
  return !player.melds.some((meld) => meld.type === "pon" || meld.type === "minkan" || meld.type === "kakan");
}

function getSeatWind(state: GameState, playerId: string): "east" | "south" | "west" {
  const dealerIndex = Math.max(0, state.players.findIndex((player) => player.id === state.round.dealerPlayerId));
  const playerIndex = Math.max(0, state.players.findIndex((player) => player.id === playerId));
  return ["east", "south", "west"][(playerIndex - dealerIndex + state.players.length) % state.players.length] as "east" | "south" | "west";
}

export function getYakuhaiHan(tripletTileType: TileKey, playerSeatWind: "east" | "south" | "west", _roundWind: "east"): number {
  const alwaysYakuhai = new Set(["honor-white", "honor-green", "honor-red", "honor-east", "honor-north"]);
  let han = alwaysYakuhai.has(tripletTileType) ? 1 : 0;
  if (tripletTileType === `honor-${playerSeatWind}`) han += 1;
  return han;
}

function countTiles(tiles: Tile[]): Map<TileKey, number> {
  const counts = new Map<TileKey, number>();
  for (const tile of tiles) {
    const key = tileKey(tile);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function tileKey(tile: Tile): TileKey {
  if (tile.suit === "manzu" || tile.suit === "pinzu" || tile.suit === "souzu") return `${tile.suit}-${tile.rank}`;
  return `honor-${tile.kind}`;
}

function parseNumberKey(key: TileKey): { suit: "manzu" | "pinzu" | "souzu"; rank: number } | null {
  const [suit, rankText] = key.split("-");
  const rank = Number(rankText);
  if (!["manzu", "pinzu", "souzu"].includes(suit) || !Number.isInteger(rank)) return null;
  return { suit: suit as "manzu" | "pinzu" | "souzu", rank };
}

function labelKey(key: TileKey): string {
  const labels: Record<string, string> = {
    "honor-east": "東",
    "honor-south": "南",
    "honor-west": "西",
    "honor-north": "北",
    "honor-white": "白",
    "honor-green": "發",
    "honor-red": "中",
  };
  return labels[key] ?? key;
}

function dedupeYaku(yaku: YakuResult[]): YakuResult[] {
  const result: YakuResult[] = [];
  const seen = new Set<string>();
  for (const item of yaku) {
    const key = `${item.name}-${item.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function sumHan(yaku: YakuResult[]): number {
  return yaku.reduce((total, item) => total + item.han, 0);
}
