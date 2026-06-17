import assert from "node:assert/strict";
import { __testHooks } from "./game-server.mjs";

const { getWinningTilesForServerTenpai, tileKindKey } = __testHooks;

const suitMap = { m: "manzu", p: "pinzu", s: "souzu" };
const honorMap = {
  東: "east",
  南: "south",
  西: "west",
  北: "north",
  白: "white",
  發: "green",
  発: "green",
  中: "red",
};

const normalizeDigits = (text) => String(text || "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

const parseTiles = (input) => {
  const text = normalizeDigits(input).replace(/\s+/g, "");
  const tiles = [];
  let digits = "";
  let serial = 0;
  for (const char of text) {
    if (/\d/.test(char)) {
      digits += char;
      continue;
    }
    if (suitMap[char]) {
      for (const digit of digits) {
        tiles.push({ id: `test-${serial++}-${digit}${char}`, suit: suitMap[char], rank: Number(digit), color: "normal", isPochi: false });
      }
      digits = "";
      continue;
    }
    if (honorMap[char]) {
      tiles.push({ id: `test-${serial++}-${char}`, suit: "honor", kind: honorMap[char], color: "normal", isPochi: false });
      continue;
    }
    throw new Error(`Unsupported tile notation: ${char}`);
  }
  if (digits) throw new Error(`Dangling digits without suit: ${digits}`);
  return tiles;
};

const labelFromKey = (key) => {
  const [suit, value] = key.split(":");
  if (suit === "manzu") return `${value}m`;
  if (suit === "pinzu") return `${value}p`;
  if (suit === "souzu") return `${value}s`;
  return { east: "東", south: "南", west: "西", north: "北", white: "白", green: "發", red: "中" }[value] || key;
};

const waitsFor = (handText) => getWinningTilesForServerTenpai({ hand: parseTiles(handText), drawnTile: null, melds: [] })
  .map((tile) => labelFromKey(tileKindKey(tile)))
  .sort((a, b) => a.localeCompare(b, "ja"));

const expectWaits = (handText, expected) => {
  assert.deepEqual(waitsFor(handText), [...expected].sort((a, b) => a.localeCompare(b, "ja")), handText);
};

expectWaits("11m23478p123456s", ["6p", "9p"]);
expectWaits("11m24567p123456s", ["3p"]);
expectWaits("111m2244567p123s", ["2p", "4p"]);
expectWaits("22234p12345688s", ["2p", "5p", "8s"]);
expectWaits("11m23456p123456s", ["1p", "4p", "7p"]);
expectWaits("111m22334455p88s", ["1m", "2p", "5p", "8s"]);
expectWaits("2223456p123456s", ["1p", "3p", "4p", "6p", "7p"]);
expectWaits("4445678899p123s", ["7p", "8p", "9p"]);
expectWaits("1233456778999p", ["2p", "5p", "7p", "8p"]);

console.log("wait-detection tests passed");
