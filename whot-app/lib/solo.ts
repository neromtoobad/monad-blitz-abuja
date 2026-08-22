import { WHOT_ADDRESS } from "./whot";

/**
 * The wager is stored on the Game struct but not returned by getTableState,
 * so the UI keeps its own note of it to show the pot. Purely cosmetic: the
 * contract is the authority on what actually gets paid.
 */
const KEY = "whot-wagers-v1";

function all(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function rememberWager(gameId: bigint, wei: bigint) {
  if (typeof window === "undefined") return;
  try {
    const m = all();
    m[String(gameId)] = String(wei);
    window.localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode; the pot display just falls back to unknown */
  }
}

export function recallWager(gameId: bigint): bigint | null {
  const v = all()[String(gameId)];
  return v ? BigInt(v) : null;
}

/** Seat 1 being the contract itself is what makes a game solo. */
export function isSoloTable(players: readonly string[]): boolean {
  return (
    players.length === 2 &&
    players[1]?.toLowerCase() === WHOT_ADDRESS.toLowerCase()
  );
}

export const HOUSE_LABEL = "The House";
