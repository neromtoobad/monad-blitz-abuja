import { whotAbi } from "./whotAbi";

export { whotAbi };

/** Live deployment on Monad Testnet. Override via env for a different one. */
export const WHOT_ADDRESS = (process.env.NEXT_PUBLIC_WHOT_ADDRESS ||
  "0x8B3bd77d873C7283dC3Af984daDEa4CecA22DEf8") as `0x${string}`;

// ---------------------------------------------------------------- card codec
// card = (shape << 5) | number, matching src/Whot.sol

export const CIRCLE = 0;
export const TRIANGLE = 1;
export const CROSS = 2;
export const SQUARE = 3;
export const STAR = 4;
export const WHOT = 5;
export const NO_SHAPE = 0xff;

export const SHAPES = [CIRCLE, TRIANGLE, CROSS, SQUARE, STAR] as const;

/** Nigerian shape names. These are what people in the room actually say. */
export const SHAPE_NAME: Record<number, string> = {
  [CIRCLE]: "Ball",
  [TRIANGLE]: "Angle",
  [CROSS]: "Cross",
  [SQUARE]: "Carpet",
  [STAR]: "Star",
  [WHOT]: "Whot",
};

/** Deck palette. Oxblood and gold are the deck's own ink; the rest are warm
 *  neighbours chosen so five shapes stay distinguishable at a glance on the
 *  dark projector feed. */
export const SHAPE_COLOR: Record<number, string> = {
  [CIRCLE]: "#c85a3f",
  [TRIANGLE]: "#d8a33a",
  [CROSS]: "#5e9c6b",
  [SQUARE]: "#c98a2e",
  [STAR]: "#b8607f",
  [WHOT]: "#e8dcc0",
};

export const shapeOf = (card: number) => card >> 5;
export const numberOf = (card: number) => card & 31;
export const encode = (shape: number, num: number) => (shape << 5) | num;

export const isWhot = (card: number) => shapeOf(card) === WHOT;

export function cardName(card: number) {
  const s = shapeOf(card);
  const n = numberOf(card);
  return s === WHOT ? "Whot 20" : `${SHAPE_NAME[s]} ${n}`;
}

// -------------------------------------------------------------- game status

export const Status = {
  Open: 0,
  Playing: 1,
  Won: 2,
  Drawn: 3,
} as const;

export type GameView = {
  status: number;
  turn: number;
  turnAddress: `0x${string}`;
  topCard: number;
  calledShape: number;
  pendingDraw: number;
  pendingKind: number;
  cardsLeft: number;
  lastMoveBlock: bigint;
  winner: `0x${string}`;
};

/** getGame returns a positional tuple; name it so the UI stays readable. */
export function toGameView(raw: readonly unknown[]): GameView {
  return {
    status: Number(raw[0]),
    turn: Number(raw[1]),
    turnAddress: raw[2] as `0x${string}`,
    topCard: Number(raw[3]),
    calledShape: Number(raw[4]),
    pendingDraw: Number(raw[5]),
    pendingKind: Number(raw[6]),
    cardsLeft: Number(raw[7]),
    lastMoveBlock: raw[8] as bigint,
    winner: raw[9] as `0x${string}`,
  };
}

// ------------------------------------------------------------- rule helpers
// Mirrors _matches() in the contract so we can grey out illegal cards locally
// instead of making the player discover it via a failed transaction.

export function isPlayable(card: number, g: GameView): boolean {
  if (g.pendingDraw > 0) {
    // A live chain can only be answered with the same number. No cross-defence,
    // and a Whot 20 does not escape it.
    return numberOf(card) === g.pendingKind;
  }
  if (isWhot(card)) return true;
  if (g.calledShape !== NO_SHAPE) return shapeOf(card) === g.calledShape;
  return (
    shapeOf(card) === shapeOf(g.topCard) ||
    numberOf(card) === numberOf(g.topCard)
  );
}

export const EFFECT_LABEL: Record<number, string> = {
  0: "",
  1: "Hold on",
  2: "Pick two",
  3: "Pick three",
  4: "Suspension",
  5: "General market",
  6: "Whot",
};

export function shortAddr(a?: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
