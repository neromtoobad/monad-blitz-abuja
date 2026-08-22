"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http, parseEventLogs } from "viem";
import {
  LOGS_MAX_SPAN,
  LOGS_RPC_URL,
  RPC_URL,
  monadTestnet,
} from "@/lib/chain";
import {
  EFFECT_LABEL,
  SHAPE_COLOR,
  SHAPE_NAME,
  WHOT,
  WHOT_ADDRESS,
  cardName,
  shapeOf,
  shortAddr,
  whotAbi,
} from "@/lib/whot";

/**
 * Projector view. One eth_getLogs call picks up every card played across every
 * table, so the feed cost does not scale with table count.
 */

// Contract reads (the table grid) go to the dedicated endpoint.
const client = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL),
});

// Log streaming goes to whichever endpoint allows the widest block range.
const logsClient = createPublicClient({
  chain: monadTestnet,
  transport: http(LOGS_RPC_URL),
});

const MAX_TABLES = 12;
const MAX_TICKER = 26;

// Providers cap eth_getLogs ranges differently, so the span is configurable
// and we always page through history in chunks rather than one wide request.
const MAX_SPAN = LOGS_MAX_SPAN;
// If we ever fall further behind than this, skip forward rather than wedging
// on a range we can never satisfy. A wedged feed is silent, which is worse.
const MAX_LAG = MAX_SPAN * 4n;

type Move = {
  key: string;
  block: bigint;
  gameId: bigint;
  player: `0x${string}`;
  kind: "play" | "draw" | "won" | "market" | "created" | "started";
  card?: number;
  effect?: number;
  count?: number;
};

type TableRow = {
  gameId: bigint;
  status: number;
  players: readonly `0x${string}`[];
  counts: readonly bigint[];
  turn: number;
  topCard: number;
  cardsLeft: number;
  winner: `0x${string}`;
  stalled: boolean;
};

export default function Feed() {
  const [moves, setMoves] = useState<Move[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [head, setHead] = useState<bigint>(0n);
  const [totalTx, setTotalTx] = useState(0);
  const cursor = useRef<bigint | null>(null);
  const startedAt = useRef<number>(Date.now());
  // getLogs can outlast the poll interval. Without this guard two ticks read
  // the same cursor, fetch the same range, and double-count every event.
  const busy = useRef(false);
  // Belt and braces: a log is only ever counted once, whatever the cursor does.
  const seen = useRef<Set<string>>(new Set());

  // ---- event stream
  useEffect(() => {
    if (!WHOT_ADDRESS) return;
    let alive = true;

    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const latest = await logsClient.getBlockNumber();
        if (!alive) return;
        setHead(latest);

        if (cursor.current === null) {
          cursor.current = latest > MAX_SPAN ? latest - MAX_SPAN : 0n;
        }

        // Local copy so TS can narrow it through the loop.
        let from: bigint = cursor.current;
        if (from > latest) return;

        const fresh: Move[] = [];

        // Catch up in bounded chunks. The cursor only advances on a successful
        // chunk, so nothing is skipped, but the lag check stops a sustained
        // failure from pinning us on a range we can never satisfy.
        let guard = 0;
        while (from <= latest && guard++ < 5) {
          const span = from + MAX_SPAN - 1n;
          const to: bigint = span > latest ? latest : span;

          let logs;
          try {
            logs = await logsClient.getLogs({
              address: WHOT_ADDRESS,
              fromBlock: from,
              toBlock: to,
            });
          } catch {
            if (latest - from > MAX_LAG) {
              from = latest - MAX_SPAN;
              cursor.current = from;
            }
            break;
          }

          from = to + 1n;
          cursor.current = from;
          if (!alive) return;
          if (logs.length === 0) continue;

          const parsed = parseEventLogs({ abi: whotAbi, logs });

          for (const l of parsed) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const a = l.args as any;
            const base = {
              key: `${l.transactionHash}-${l.logIndex}`,
              block: l.blockNumber ?? 0n,
              gameId: a.gameId as bigint,
            };
            if (l.eventName === "CardPlayed") {
              fresh.push({
                ...base,
                player: a.player,
                kind: "play",
                card: Number(a.card),
                effect: Number(a.effect),
                count: Number(a.handCount),
              });
            } else if (l.eventName === "CardsDrawn") {
              fresh.push({
                ...base,
                player: a.player,
                kind: "draw",
                count: Number(a.count),
              });
            } else if (l.eventName === "GameWon") {
              fresh.push({ ...base, player: a.winner, kind: "won" });
            } else if (l.eventName === "MarketFinished") {
              fresh.push({
                ...base,
                player: a.winner,
                kind: "market",
                count: Number(a.cardsHeld),
              });
            } else if (l.eventName === "TableCreated") {
              fresh.push({ ...base, player: a.creator, kind: "created" });
            } else if (l.eventName === "GameStarted") {
              fresh.push({
                ...base,
                player: "0x0" as `0x${string}`,
                kind: "started",
                count: Number(a.playerCount),
              });
            }
          }
        }

        const unseen = fresh.filter((m) => !seen.current.has(m.key));
        if (unseen.length) {
          unseen.forEach((m) => seen.current.add(m.key));
          setTotalTx((n) => n + unseen.length);
          setMoves((prev) =>
            [...unseen.reverse(), ...prev].slice(0, MAX_TICKER),
          );
        }
      } catch {
        // transient RPC hiccup; next tick picks up from the same cursor
      } finally {
        busy.current = false;
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ---- table grid
  useEffect(() => {
    if (!WHOT_ADDRESS) return;
    let alive = true;

    const tick = async () => {
      try {
        const next = (await client.readContract({
          address: WHOT_ADDRESS,
          abi: whotAbi,
          functionName: "nextGameId",
        })) as bigint;

        const ids: bigint[] = [];
        for (let id = next - 1n; id > 0n && ids.length < MAX_TABLES; id--) {
          ids.push(id);
        }

        const rows = await Promise.all(
          ids.map(async (gameId) => {
            const s = (await client.readContract({
              address: WHOT_ADDRESS,
              abi: whotAbi,
              functionName: "getTableState",
              args: [gameId, "0x0000000000000000000000000000000000000000"],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            })) as any;
            return {
              gameId,
              status: Number(s.status),
              players: s.players,
              counts: s.counts,
              turn: Number(s.turn),
              topCard: Number(s.topCard),
              cardsLeft: Number(s.cardsLeft),
              winner: s.winner,
              stalled: Boolean(s.stalled),
            } as TableRow;
          }),
        );

        if (alive) setTables(rows);
      } catch {
        /* transient */
      }
    };

    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const live = tables.filter((t) => t.status === 1 && !t.stalled);
  const perMin = useMemo(() => {
    const mins = (Date.now() - startedAt.current) / 60000;
    return mins > 0.15 ? Math.round(totalTx / mins) : 0;
  }, [totalTx]);

  if (!WHOT_ADDRESS) {
    return (
      <main className="min-h-screen bg-neutral-950 text-amber-300 p-10">
        No contract address set.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0e1a15] text-neutral-100 p-8">
      <header className="flex items-end justify-between mb-8">
        <div>
          <Image
            src="/whot/wordmark.png"
            alt="Whot"
            width={720}
            height={345}
            priority
            className="w-64 h-auto brightness-0 invert opacity-95"
          />
          <p className="text-neutral-400 mt-1 tracking-wide">
            Every card is a transaction on Monad
          </p>
        </div>
        <div className="flex gap-10 text-right">
          <Stat label="live tables" value={String(live.length)} />
          <Stat label="onchain events" value={String(totalTx)} accent />
          <Stat label="per minute" value={String(perMin)} />
          <Stat label="block" value={String(head)} dim />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_34rem] gap-8">
        {/* tables */}
        <section>
          <h2 className="text-xs uppercase tracking-widest text-neutral-500 mb-3">
            Tables
          </h2>
          {tables.length === 0 ? (
            <p className="text-neutral-600">No tables yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {tables.map((t) => (
                <TableCard key={String(t.gameId)} t={t} />
              ))}
            </div>
          )}
        </section>

        {/* ticker */}
        <section>
          <h2 className="text-xs uppercase tracking-widest text-neutral-500 mb-3">
            Live feed
          </h2>
          <div className="space-y-1.5 font-mono text-lg">
            {moves.length === 0 && (
              <p className="text-neutral-600 font-sans">
                Waiting for the first card…
              </p>
            )}
            {moves.map((m, i) => (
              <Line key={m.key} m={m} fresh={i === 0} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
  dim,
}: {
  label: string;
  value: string;
  accent?: boolean;
  dim?: boolean;
}) {
  return (
    <div>
      <div
        className={[
          "text-4xl font-black tabular-nums",
          accent ? "text-[var(--gold)]" : dim ? "text-neutral-600" : "",
        ].join(" ")}
      >
        {value}
      </div>
      <div className="text-[0.65rem] uppercase tracking-widest text-neutral-500">
        {label}
      </div>
    </div>
  );
}

function TableCard({ t }: { t: TableRow }) {
  const statusLabel = t.stalled
    ? "stalled"
    : ["waiting", "playing", "won", "drawn"][t.status];
  const border =
    t.status === 1 && !t.stalled
      ? "border-emerald-500/60"
      : t.stalled
        ? "border-amber-600/50"
        : t.status === 0
          ? "border-neutral-700"
          : "border-neutral-800";

  return (
    <div className={`rounded-xl border-2 ${border} bg-[#16241d] p-5`}>
      <div className="flex items-baseline justify-between mb-3">
        <span className="font-black text-3xl">#{String(t.gameId)}</span>
        <span
          className={[
            "text-[0.6rem] uppercase tracking-widest",
            t.stalled
              ? "text-amber-500"
              : t.status === 1
                ? "text-emerald-400"
                : "text-neutral-500",
          ].join(" ")}
        >
          {statusLabel}
        </span>
      </div>

      <div className="space-y-1 mb-3">
        {t.players.map((p, i) => (
          <div
            key={p}
            className={[
              "flex justify-between text-base font-mono",
              i === t.turn && t.status === 1 && !t.stalled
                ? "text-emerald-400 font-bold"
                : "text-neutral-400",
            ].join(" ")}
          >
            <span>{shortAddr(p)}</span>
            <span className="tabular-nums">
              {t.counts[i] !== undefined ? String(t.counts[i]) : "–"}
            </span>
          </div>
        ))}
      </div>

      {t.status === 1 && (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: SHAPE_COLOR[shapeOf(t.topCard)] }}
          />
          {cardName(t.topCard)} · market {t.cardsLeft}
        </div>
      )}
      {t.status >= 2 && t.winner !== "0x0000000000000000000000000000000000000000" && (
        <div className="text-base text-amber-400 font-mono">
          won by {shortAddr(t.winner)}
        </div>
      )}
    </div>
  );
}

function Line({ m, fresh }: { m: Move; fresh: boolean }) {
  const cls = fresh ? "opacity-100" : "opacity-70";
  const tag = <span className="text-neutral-600">#{String(m.gameId)}</span>;

  if (m.kind === "play") {
    const shp = shapeOf(m.card!);
    const eff = m.effect ? EFFECT_LABEL[m.effect] : "";
    return (
      <div className={`${cls} flex gap-2 items-baseline`}>
        {tag}
        <span className="text-neutral-400">{shortAddr(m.player)}</span>
        <span
          className="font-bold"
          style={{ color: shp === WHOT ? "#a78bfa" : SHAPE_COLOR[shp] }}
        >
          {cardName(m.card!)}
        </span>
        {eff && (
          <span className="text-sm uppercase tracking-wider text-amber-400 font-bold">
            {eff}
          </span>
        )}
        <span className="ml-auto text-neutral-600 tabular-nums">{m.count}</span>
      </div>
    );
  }
  if (m.kind === "draw") {
    return (
      <div className={`${cls} flex gap-2`}>
        {tag}
        <span className="text-neutral-400">{shortAddr(m.player)}</span>
        <span className="text-red-400">market +{m.count}</span>
      </div>
    );
  }
  if (m.kind === "won") {
    return (
      <div className={`${cls} flex gap-2 text-emerald-400 font-bold`}>
        {tag}
        <span>{shortAddr(m.player)} WINS</span>
      </div>
    );
  }
  if (m.kind === "market") {
    return (
      <div className={`${cls} flex gap-2 text-amber-400`}>
        {tag}
        <span>
          market finished · {shortAddr(m.player)} on {m.count}
        </span>
      </div>
    );
  }
  if (m.kind === "started") {
    return (
      <div className={`${cls} flex gap-2 text-neutral-500`}>
        {tag}
        <span>dealt to {m.count} players</span>
      </div>
    );
  }
  return (
    <div className={`${cls} flex gap-2 text-neutral-600`}>
      {tag}
      <span>table opened</span>
    </div>
  );
}

export { SHAPE_NAME };
