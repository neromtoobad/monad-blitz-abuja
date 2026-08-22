"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Card, CardBack, Shape } from "./Card";
import {
  NO_SHAPE,
  SHAPES,
  SHAPE_NAME,
  Status,
  WHOT_ADDRESS,
  EFFECT_LABEL,
  cardName,
  isPlayable,
  isWhot,
  shortAddr,
  toGameView,
  whotAbi,
} from "@/lib/whot";
import { formatEther, parseEventLogs } from "viem";
import { HOUSE_LABEL, isSoloTable, recallWager } from "@/lib/solo";
import { sessionAddress, sessionSend } from "@/lib/session";

// Blocks are ~400ms, so poll fast enough that the table feels live.
const POLL = { refetchInterval: 800 } as const;

type Move = { house: boolean; text: string; effect: number; left: number };

export function Table({ gameId }: { gameId: bigint }) {
  const { address: eoa } = useAccount();
  // Moves are signed by the session wallet, so it is the player as far as the
  // contract is concerned. The connected wallet only funds it.
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The game id lives in the URL hash, so the current address is the invite.
  const [inviteUrl, setInviteUrl] = useState("");

  useEffect(() => {
    setInviteUrl(
      `${window.location.origin}${window.location.pathname}#${gameId}`,
    );
  }, [gameId]);

  useEffect(() => {
    setAddress(sessionAddress());
  }, [eoa]);
  const [picked, setPicked] = useState<number | null>(null);

  // The house replies inside the player's transaction, so its move never gets
  // its own turn on screen. Without this the game reads as if nobody is there.
  const [log, setLog] = useState<Move[]>([]);
  const seenTx = useRef<string | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  // One call for the whole table. Four separate polled reads per player does
  // not survive a room full of concurrent tables on a public RPC.
  const table = useReadContract({
    abi: whotAbi,
    address: WHOT_ADDRESS,
    functionName: "getTableState",
    args: address ? [gameId, address] : undefined,
    query: { ...POLL, enabled: !!address },
  });

  const t = table.data as
    | {
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
        stalled: boolean;
        players: readonly `0x${string}`[];
        counts: readonly bigint[];
        yourHand: readonly number[];
      }
    | undefined;

  // A new table starts with a clean slate.
  useEffect(() => {
    setLog([]);
    seenTx.current = null;
  }, [gameId]);

  useEffect(() => {
    if (!receipt.data || seenTx.current === receipt.data.transactionHash) return;
    seenTx.current = receipt.data.transactionHash;

    const parsed = parseEventLogs({ abi: whotAbi, logs: receipt.data.logs });
    const moves: Move[] = [];

    for (const l of parsed) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = l.args as any;
      if (String(a.gameId) !== String(gameId)) continue;

      const who = String(a.player ?? "").toLowerCase();
      const house = who === WHOT_ADDRESS.toLowerCase();

      if (l.eventName === "CardPlayed") {
        moves.push({
          house,
          text: cardName(Number(a.card)),
          effect: Number(a.effect),
          left: Number(a.handCount),
        });
      } else if (l.eventName === "CardsDrawn") {
        moves.push({
          house,
          text: `went to market, took ${Number(a.count)}`,
          effect: 0,
          left: Number(a.handCount),
        });
      }
    }

    if (moves.length) setLog(moves);
  }, [receipt.data, gameId]);

  const g = useMemo(
    () =>
      t
        ? toGameView([
            t.status,
            t.turn,
            t.turnAddress,
            t.topCard,
            t.calledShape,
            t.pendingDraw,
            t.pendingKind,
            t.cardsLeft,
            t.lastMoveBlock,
            t.winner,
          ])
        : null,
    [t],
  );

  const seats = (t?.players ?? []) as `0x${string}`[];
  const handCounts = (t?.counts ?? []) as readonly bigint[];
  const myCards = ((t?.yourHand ?? []) as readonly number[]).map(Number);
  const stalled = !!t?.stalled;
  const solo = isSoloTable(seats);
  const wager = solo ? recallWager(gameId) : null;
  const pot = wager !== null ? wager * 2n : null;

  if (!g) {
    return <p className="text-neutral-500">Loading table {String(gameId)}…</p>;
  }

  const isMyTurn =
    !!address && g.turnAddress.toLowerCase() === address.toLowerCase();
  const seated = seats.some((s) => s.toLowerCase() === address?.toLowerCase());

  // No wallet popup: the session key signs locally.
  const send = async (functionName: string, args: readonly unknown[]) => {
    setIsPending(true);
    setSendError(null);
    try {
      const hash = await sessionSend(WHOT_ADDRESS, whotAbi, functionName, args);
      setTxHash(hash);
    } catch (e) {
      setSendError(
        (e as Error).message.split("\n")[0].slice(0, 150) || "move failed",
      );
    } finally {
      setIsPending(false);
    }
  };

  // ------------------------------------------------------------ open table

  if (g.status === Status.Open) {
    return (
      <div className="space-y-6">
        <Header gameId={gameId} />
        <div className="rounded-2xl bg-[var(--cream)] p-6 shadow-sm border border-[var(--ink)]/10">
          <h2 className="font-bold text-lg mb-3">
            Waiting for players ({seats.length}/4)
          </h2>
          <ul className="space-y-1 mb-5 text-sm">
            {seats.map((s, i) => (
              <li key={s} className="font-mono">
                Seat {i + 1} · {shortAddr(s)}
                {s.toLowerCase() === address?.toLowerCase() && " (you)"}
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            {!seated && (
              <Btn onClick={() => send("joinTable", [gameId])} busy={isPending}>
                Take a seat
              </Btn>
            )}
            {seated && seats.length >= 2 && (
              <Btn onClick={() => send("startTable", [gameId])} busy={isPending}>
                Deal
              </Btn>
            )}
          </div>
          <div className="mt-6 border-t border-[var(--ink)]/10 pt-5">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--ink)]/50 mb-2">
              Invite players
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm bg-[var(--ink)]/[0.06] rounded-lg px-3 py-2 text-[var(--ink)] break-all">
                {inviteUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(inviteUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
                className="rounded-xl bg-[var(--ink)] text-[var(--cream)] px-5 py-2.5 font-bold hover:bg-[var(--ink-soft)] transition"
              >
                {copied ? "copied!" : "Copy invite link"}
              </button>
            </div>
            <p className="mt-3 text-sm text-[var(--ink)]/55">
              Send it to anyone. The link opens this exact table on their
              device, whatever they are on.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------- finished table

  if (g.status === Status.Won || g.status === Status.Drawn) {
    const iWon = g.winner.toLowerCase() === address?.toLowerCase();
    return (
      <div className="space-y-6">
        <Header gameId={gameId} />
        <div className="felt rounded-2xl p-12 text-center border border-black/20">
          <h2 className="text-4xl font-black font-serif mb-2 text-[var(--cream)]">
            {g.status === Status.Drawn
              ? "Market finished — draw"
              : iWon
                ? "You win!"
                : solo
                  ? "The house wins"
                  : `${shortAddr(g.winner)} wins`}
          </h2>
          {solo && pot !== null ? (
            <p className="text-white/70">
              {g.status === Status.Drawn ? (
                <>Market finished. Your {formatEther(wager!)} MON stake was returned.</>
              ) : iWon ? (
                <>You took the {formatEther(pot)} MON pot.</>
              ) : (
                <>The house took the {formatEther(pot)} MON pot.</>
              )}
            </p>
          ) : (
            <p className="text-white/60">Game #{String(gameId)} is over.</p>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ live table

  const chainLive = g.pendingDraw > 0;

  return (
    <div className="space-y-6">
      <Header gameId={gameId} />

      {/* opponents */}
      <div className="flex flex-wrap gap-3">
        {seats.map((s, i) => {
          const you = s.toLowerCase() === address?.toLowerCase();
          const theirTurn = i === g.turn;
          return (
            <div
              key={s}
              className={[
                "rounded-xl px-4 py-3 bg-[var(--cream)] shadow-sm border-2 min-w-[9.5rem] transition",
                theirTurn
                  ? "border-[var(--gold)] shadow-md"
                  : "border-transparent",
              ].join(" ")}
            >
              <div className="text-xs text-neutral-500 font-mono">
                {you ? "You" : solo ? "Opponent" : `Seat ${i + 1}`}
              </div>
              <div className="font-mono text-sm">
                {solo && !you ? HOUSE_LABEL : shortAddr(s)}
              </div>
              <div className="text-3xl font-black font-serif text-[var(--ink)]">
                {handCounts[i] !== undefined ? String(handCounts[i]) : "–"}
                <span className="text-xs font-normal text-neutral-500 ml-1">
                  cards
                </span>
              </div>
              <LastCall count={Number(handCounts[i] ?? 0)} />
              {theirTurn && (
                <div className="text-[0.6rem] font-bold uppercase tracking-[0.18em] mt-1 text-[var(--ink-soft)]">
                  playing
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* board */}
      <div className="felt rounded-2xl p-7 flex items-center gap-9 shadow-[inset_0_2px_18px_rgba(0,0,0,0.35)] border border-black/20">
        <div className="text-center">
          <div className="text-[0.65rem] uppercase tracking-[0.18em] text-white/55 mb-2">
            Market
          </div>
          <CardBack />
          <div className="mt-2 text-sm font-bold text-white/85">{g.cardsLeft} left</div>
        </div>

        <div className="text-center">
          <div className="text-[0.65rem] uppercase tracking-[0.18em] text-white/55 mb-2">
            Top card
          </div>
          <Card card={g.topCard} />
          <div className="mt-2 text-sm font-bold text-white/85">{cardName(g.topCard)}</div>
        </div>

        {g.calledShape !== NO_SHAPE && (
          <div className="text-center">
            <div className="text-[0.65rem] uppercase tracking-[0.18em] text-white/55 mb-2">
              Called shape
            </div>
            <Shape shape={g.calledShape} size={56} />
            <div className="mt-2 text-sm font-bold text-[var(--gold)]">
              {SHAPE_NAME[g.calledShape]}
            </div>
          </div>
        )}

        {pot !== null && (
          <div className="text-center">
            <div className="text-[0.65rem] uppercase tracking-[0.18em] text-white/55 mb-2">
              Pot
            </div>
            <div className="font-serif text-4xl font-black text-[var(--gold)]">
              {formatEther(pot)}
            </div>
            <div className="mt-1 text-xs text-white/60">MON · winner takes all</div>
          </div>
        )}

        {chainLive && (
          <div className="ml-auto rounded-xl bg-[var(--ink)] border-2 border-[var(--gold)] px-6 py-4 text-center shadow-lg">
            <div className="text-[0.65rem] uppercase tracking-[0.18em] text-[var(--gold)]">
              {g.pendingKind === 2 ? "Pick two" : "Pick three"} chain
            </div>
            <div className="text-5xl font-black font-serif text-cream text-[#f7f1e1]">
              {g.pendingDraw}
            </div>
            <div className="text-xs text-white/70">
              play a {g.pendingKind} or eat them
            </div>
          </div>
        )}
      </div>

      {/* what just happened — the house's reply lives here */}
      {log.length > 0 && (
        <div className="rounded-2xl bg-[var(--cream)] border border-[var(--ink)]/12 p-4">
          <div className="text-[0.65rem] uppercase tracking-[0.18em] text-[var(--ink)]/45 mb-2">
            Last exchange
          </div>
          <div className="space-y-1.5">
            {log.map((m, i) => (
              <div key={i} className="flex items-baseline gap-2 text-sm">
                <span
                  className={[
                    "rounded px-2 py-0.5 text-[0.6rem] font-black uppercase tracking-[0.12em] shrink-0",
                    m.house
                      ? "bg-[var(--ink)] text-[var(--cream)]"
                      : "bg-[var(--gold)]/30 text-[var(--ink)]",
                  ].join(" ")}
                >
                  {m.house ? HOUSE_LABEL : "You"}
                </span>
                <span className="font-mono text-[var(--ink)]">{m.text}</span>
                {m.effect > 0 && (
                  <span className="text-[0.7rem] uppercase tracking-wider font-bold text-[var(--ink-soft)]">
                    {EFFECT_LABEL[m.effect]}
                  </span>
                )}
                <span className="ml-auto font-mono text-xs text-[var(--ink)]/45">
                  {m.left} left
                </span>
              </div>
            ))}
            {solo && !log.some((m) => m.house) && (
              <div className="text-xs text-[var(--ink)]/55 pt-1">
                {HOUSE_LABEL} did not move — it was skipped.
              </div>
            )}
          </div>
        </div>
      )}

      {/* your hand */}
      <div className="rounded-2xl bg-[var(--cream)] p-6 shadow-sm border border-[var(--ink)]/10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">
            Your hand
            <span className="ml-2 text-sm font-normal text-neutral-500">
              {myCards.length} cards
            </span>
          </h2>
          <div className="flex items-center gap-3">
            {(myCards.length === 1 || myCards.length === 2) && (
              <span
                className={[
                  "rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.14em]",
                  myCards.length === 1
                    ? "bg-[var(--ink)] text-[var(--cream)] animate-pulse"
                    : "bg-[var(--gold)]/25 text-[var(--ink)] border border-[var(--gold)]",
                ].join(" ")}
              >
                {myCards.length === 1 ? "Last card!" : "Semi last card"}
              </span>
            )}
            <div className="text-sm font-bold">
              {isMyTurn
                ? "Your turn"
                : solo
                  ? `${HOUSE_LABEL} is playing…`
                  : `${shortAddr(g.turnAddress)} to play`}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          {myCards.map((c, i) => {
            const ok = isPlayable(c, g);
            return (
              <Card
                key={`${c}-${i}`}
                card={c}
                selected={picked === i}
                disabled={!isMyTurn || !ok}
                onClick={() => setPicked(picked === i ? null : i)}
              />
            );
          })}
          {myCards.length === 0 && (
            <p className="text-neutral-500 text-sm">No cards.</p>
          )}
        </div>

        {/* whot 20 shape picker */}
        {picked !== null && isWhot(myCards[picked]) && (
          <div className="mb-4 rounded-xl bg-[var(--ink)]/[0.06] border border-[var(--ink)]/15 p-4">
            <div className="text-sm font-bold mb-2">Call a shape</div>
            <div className="flex gap-2">
              {SHAPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    send("playCard", [gameId, picked, s]);
                    setPicked(null);
                  }}
                  className="rounded-lg border-2 border-[var(--ink)]/20 bg-[var(--card)] px-4 py-3 hover:border-[var(--gold)] transition flex flex-col items-center gap-1"
                >
                  <Shape shape={s} size={28} />
                  <span className="text-xs font-bold">{SHAPE_NAME[s]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {sendError && (
          <p className="mb-3 text-sm text-[var(--ink)]">{sendError}</p>
        )}

        <div className="flex gap-3">
          <Btn
            busy={isPending}
            disabled={
              !isMyTurn || picked === null || isWhot(myCards[picked] ?? 0)
            }
            onClick={() => {
              if (picked === null) return;
              send("playCard", [gameId, picked, NO_SHAPE]);
              setPicked(null);
            }}
          >
            Play {picked !== null ? cardName(myCards[picked]) : "card"}
          </Btn>

          <Btn
            variant="ghost"
            busy={isPending}
            disabled={!isMyTurn}
            onClick={() => send("drawCard", [gameId])}
          >
            {chainLive ? `Eat ${g.pendingDraw} cards` : "Go to market"}
          </Btn>

          {stalled && !solo && (
            <Btn
              variant="ghost"
              busy={isPending}
              onClick={() => send("forceDraw", [gameId])}
            >
              Prod stalled table
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * "Semi last card" at two, "last card" at one. Announced by the interface
 * rather than enforced onchain: the contract has no notion of declaring, so
 * there is nothing to catch. Adding the catch is a v2 change.
 */
function LastCall({ count }: { count: number }) {
  if (count !== 1 && count !== 2) return null;
  const last = count === 1;
  return (
    <div
      className={[
        "mt-1.5 inline-block rounded px-2 py-0.5",
        "text-[0.6rem] font-black uppercase tracking-[0.14em]",
        last
          ? "bg-[var(--ink)] text-[var(--cream)] animate-pulse"
          : "bg-[var(--gold)]/25 text-[var(--ink)] border border-[var(--gold)]",
      ].join(" ")}
    >
      {last ? "Last card!" : "Semi last card"}
    </div>
  );
}

function Header({ gameId }: { gameId: bigint }) {
  return (
    <div className="flex items-baseline justify-between">
      <h1 className="text-3xl font-black font-serif text-[var(--ink)]">
        Whot <span className="text-[var(--ink)]/35">#{String(gameId)}</span>
      </h1>
      <a
        className="text-sm underline text-neutral-500"
        href={`https://testnet.monadexplorer.com/address/${WHOT_ADDRESS}`}
        target="_blank"
        rel="noreferrer"
      >
        contract
      </a>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  busy,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "solid" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={[
        "rounded-xl px-5 py-3 font-bold transition disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "solid"
          ? "bg-[var(--ink)] text-[var(--cream)] hover:bg-[var(--ink-soft)] shadow"
          : "bg-[var(--ink)]/10 text-[var(--ink)] hover:bg-[var(--ink)]/20",
      ].join(" ")}
    >
      {busy ? "confirming…" : children}
    </button>
  );
}
