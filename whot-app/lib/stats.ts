import { parseEventLogs } from "viem";
import type { PublicClient } from "viem";
import { whotAbi } from "./whotAbi";

/**
 * Structural view of a decoded log. viem's own return type loses eventName and
 * args once the abi generic is erased, and we only ever read those two fields.
 */
export type DecodedLog = {
  eventName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
};

/** Block the live contract was deployed in. Indexing starts here. */
export const DEPLOY_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_WHOT_DEPLOY_BLOCK || "55942788",
);

const CACHE_KEY = "whot-stats-v1";

export type PlayerStats = {
  addr: `0x${string}`;
  games: number;
  wins: number;
  played: number; // cards played
  market: number; // single cards taken from market
  eaten: number; // cards taken from a pick chain
  dealt: number; // cards inflicted on others via 2s and 5s
  holdOns: number;
  suspensions: number;
  generalMarkets: number;
  whots: number;
  longestStreak: number; // consecutive plays without losing the turn
  worstDraw: number; // biggest single helping from the market
};

export type StatsIndex = {
  lastBlock: string; // stringified bigint, for JSON
  players: Record<string, PlayerStats>;
  totalEvents: number;
  totalGames: number;
};

function blank(addr: `0x${string}`): PlayerStats {
  return {
    addr,
    games: 0,
    wins: 0,
    played: 0,
    market: 0,
    eaten: 0,
    dealt: 0,
    holdOns: 0,
    suspensions: 0,
    generalMarkets: 0,
    whots: 0,
    longestStreak: 0,
    worstDraw: 0,
  };
}

export function emptyIndex(): StatsIndex {
  return {
    lastBlock: String(DEPLOY_BLOCK),
    players: {},
    totalEvents: 0,
    totalGames: 0,
  };
}

export type Seed = {
  address: string;
  fromBlock: string;
  toBlock: string;
  builtAt: string;
  logs: DecodedLog[];
};

/**
 * Fetch the pre-built snapshot shipped in public/. A full backfill from the
 * deploy block is ~200 requests and about two minutes, so the browser applies
 * this instead and only indexes blocks newer than `toBlock`.
 *
 * Rebuild with `npm run seed`.
 */
export async function loadSeed(): Promise<Seed | null> {
  try {
    const res = await fetch("/stats-seed.json", { cache: "no-store" });
    if (!res.ok) return null;
    const seed = (await res.json()) as Seed;
    return seed?.logs && seed?.toBlock ? seed : null;
  } catch {
    return null;
  }
}

export function loadCache(): StatsIndex {
  if (typeof window === "undefined") return emptyIndex();
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return emptyIndex();
    const parsed = JSON.parse(raw) as StatsIndex;
    if (!parsed.players || !parsed.lastBlock) return emptyIndex();
    return parsed;
  } catch {
    return emptyIndex();
  }
}

export function saveCache(idx: StatsIndex) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(idx));
  } catch {
    /* quota or private mode; stats just re-index next time */
  }
}

// Effect codes, mirroring the contract.
const EFF_HOLD_ON = 1;
const EFF_PICK_TWO = 2;
const EFF_PICK_THREE = 3;
const EFF_SUSPENSION = 4;
const EFF_GENERAL_MARKET = 5;
const EFF_WHOT = 6;

/**
 * Fold a batch of decoded logs into the running index.
 *
 * Streak tracking needs per-game memory of who played last, which is why this
 * takes a scratch map the caller keeps across batches.
 */
export function applyLogs(
  idx: StatsIndex,
  logs: DecodedLog[],
  scratch: Map<string, { last: string; run: number }>,
) {
  const get = (a: string) => {
    const key = a.toLowerCase();
    if (!idx.players[key]) idx.players[key] = blank(a as `0x${string}`);
    return idx.players[key];
  };

  for (const l of logs) {
    const a = l.args;
    idx.totalEvents++;

    if (l.eventName === "GameStarted") {
      idx.totalGames++;
      continue;
    }

    if (l.eventName === "PlayerJoined") {
      get(a.player).games++;
      continue;
    }

    if (l.eventName === "GameWon") {
      get(a.winner).wins++;
      continue;
    }

    if (l.eventName === "CardPlayed") {
      const p = get(a.player);
      const effect = Number(a.effect);
      p.played++;

      if (effect === EFF_HOLD_ON) p.holdOns++;
      if (effect === EFF_SUSPENSION) p.suspensions++;
      if (effect === EFF_GENERAL_MARKET) p.generalMarkets++;
      if (effect === EFF_WHOT) p.whots++;
      if (effect === EFF_PICK_TWO) p.dealt += 2;
      if (effect === EFF_PICK_THREE) p.dealt += 3;

      // consecutive plays by the same player in the same game
      const gid = String(a.gameId);
      const s = scratch.get(gid) ?? { last: "", run: 0 };
      const me = String(a.player).toLowerCase();
      s.run = s.last === me ? s.run + 1 : 1;
      s.last = me;
      scratch.set(gid, s);
      if (s.run > p.longestStreak) p.longestStreak = s.run;
      continue;
    }

    if (l.eventName === "CardsDrawn") {
      const p = get(a.player);
      const n = Number(a.count);
      if (n >= 2) p.eaten += n;
      else p.market += n;
      if (n > p.worstDraw) p.worstDraw = n;

      // drawing always ends your turn, so the streak breaks
      const gid = String(a.gameId);
      scratch.set(gid, { last: "", run: 0 });
      continue;
    }
  }
}

export type Title = {
  key: string;
  label: string;
  blurb: string;
  holder?: PlayerStats;
  value: number;
  unit: string;
};

/** One holder per title, decided by the stat it is named for. */
export function titles(players: PlayerStats[]): Title[] {
  const top = (pick: (p: PlayerStats) => number) => {
    let best: PlayerStats | undefined;
    let val = 0;
    for (const p of players) {
      const v = pick(p);
      if (v > val) {
        val = v;
        best = p;
      }
    }
    return { holder: best, value: val };
  };

  const defs: Omit<Title, "holder" | "value">[] = [
    {
      key: "market-man",
      label: "Market Man",
      blurb: "Most trips to the market",
      unit: "cards",
    },
    {
      key: "wicked",
      label: "Wicked",
      blurb: "Most cards inflicted with 2s and 5s",
      unit: "dealt",
    },
    {
      key: "chairman",
      label: "Chairman",
      blurb: "Most Hold Ons played",
      unit: "hold ons",
    },
    {
      key: "joker",
      label: "Joker",
      blurb: "Most Whot 20s played",
      unit: "whots",
    },
    {
      key: "sufferhead",
      label: "Sufferhead",
      blurb: "Biggest single helping from the market",
      unit: "in one go",
    },
    {
      key: "unstoppable",
      label: "Unstoppable",
      blurb: "Longest run of cards without losing the turn",
      unit: "in a row",
    },
    {
      key: "champion",
      label: "Champion",
      blurb: "Most games won",
      unit: "wins",
    },
  ];

  const picks: Record<string, (p: PlayerStats) => number> = {
    "market-man": (p) => p.market,
    wicked: (p) => p.dealt,
    chairman: (p) => p.holdOns,
    joker: (p) => p.whots,
    sufferhead: (p) => p.worstDraw,
    unstoppable: (p) => p.longestStreak,
    champion: (p) => p.wins,
  };

  return defs.map((d) => ({ ...d, ...top(picks[d.key]) }));
}

/** Outcome of an indexing pass. */
export type IndexResult = {
  /** First block NOT yet indexed. Only advances past chunks that succeeded. */
  reached: bigint;
  /** Chunks that failed after retries. Non-zero means the index is incomplete. */
  failed: number;
  head: bigint;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Page through logs from `fromBlock` to head in bounded chunks.
 *
 * Contiguous progress only: if a chunk cannot be fetched after retries we stop
 * and report where we got to, rather than skipping ahead. Skipping would let a
 * caller persist a cursor past events it never saw, and the gap would never be
 * revisited.
 */
export async function indexFrom(
  client: PublicClient,
  address: `0x${string}`,
  fromBlock: bigint,
  maxSpan: bigint,
  onBatch: (logs: DecodedLog[]) => void,
  onProgress?: (done: bigint, total: bigint) => void,
  throttleMs = 45,
): Promise<IndexResult> {
  const head = await client.getBlockNumber();
  let cur = fromBlock;
  let failed = 0;
  const total = head > fromBlock ? head - fromBlock : 1n;

  while (cur <= head) {
    const span = cur + maxSpan - 1n;
    const to = span > head ? head : span;

    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const raw = await client.getLogs({
          address,
          fromBlock: cur,
          toBlock: to,
        });
        if (raw.length) {
          onBatch(
            parseEventLogs({ abi: whotAbi, logs: raw }) as unknown as DecodedLog[],
          );
        }
        ok = true;
      } catch {
        // Almost always rate limiting. Back off and try the same chunk again.
        await sleep(250 * (attempt + 1));
      }
    }

    if (!ok) {
      failed++;
      break; // stop at the gap; the caller keeps its cursor here
    }

    cur = to + 1n;
    onProgress?.(cur - fromBlock > total ? total : cur - fromBlock, total);

    // A full backfill is hundreds of requests. Pace them so the public RPC
    // does not start refusing partway through.
    if (throttleMs) await sleep(throttleMs);
  }

  return { reached: cur, failed, head };
}
