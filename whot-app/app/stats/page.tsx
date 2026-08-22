"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http } from "viem";
import { LOGS_MAX_SPAN, LOGS_RPC_URL, monadTestnet } from "@/lib/chain";
import { WHOT_ADDRESS, shortAddr } from "@/lib/whot";
import {
  DEPLOY_BLOCK,
  applyLogs,
  emptyIndex,
  indexFrom,
  loadCache,
  loadSeed,
  saveCache,
  titles,
  type PlayerStats,
  type StatsIndex,
} from "@/lib/stats";

const logsClient = createPublicClient({
  chain: monadTestnet,
  transport: http(LOGS_RPC_URL),
});

export default function Stats() {
  const [idx, setIdx] = useState<StatsIndex>(emptyIndex);
  const [progress, setProgress] = useState<number | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const running = useRef(false);

  const sync = useCallback(async () => {
    if (running.current || !WHOT_ADDRESS) return;
    running.current = true;
    try {
      // Resume from cache so only the first visit pays for any indexing.
      const base = loadCache();
      const working: StatsIndex = {
        ...base,
        players: { ...base.players },
      };
      const scratch = new Map<string, { last: string; run: number }>();

      let from =
        BigInt(working.lastBlock) > DEPLOY_BLOCK
          ? BigInt(working.lastBlock)
          : DEPLOY_BLOCK;

      // Cold start: apply the shipped snapshot instead of replaying ~200
      // requests worth of history.
      if (from <= DEPLOY_BLOCK) {
        const seed = await loadSeed();
        if (seed) {
          applyLogs(working, seed.logs, scratch);
          from = BigInt(seed.toBlock);
          working.lastBlock = seed.toBlock;
          setIdx({ ...working, players: { ...working.players } });
        }
      }

      const { reached, failed } = await indexFrom(
        logsClient,
        WHOT_ADDRESS,
        from,
        LOGS_MAX_SPAN,
        (logs) => applyLogs(working, logs, scratch),
        (done, total) =>
          setProgress(
            Math.min(100, Math.round((Number(done) / Number(total)) * 100)),
          ),
      );

      // Persist only as far as we actually got. A cursor written past a failed
      // chunk would permanently hide those events from every later run.
      working.lastBlock = String(reached);
      saveCache(working);
      setIdx(working);
      setIncomplete(failed > 0);
      setProgress(null);
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    setIdx(loadCache());
    sync();
    const t = setInterval(sync, 15000);
    return () => clearInterval(t);
  }, [sync]);

  const players = useMemo(
    () =>
      Object.values(idx.players)
        .filter((p) => p.played > 0 || p.market > 0 || p.games > 0)
        .sort((a, b) => b.wins - a.wins || b.played - a.played),
    [idx],
  );

  const crowns = useMemo(() => titles(players), [players]);

  const reset = () => {
    window.localStorage.removeItem("whot-stats-v1");
    setIdx(emptyIndex());
    sync();
  };

  return (
    <main className="min-h-screen p-8 md:p-12">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="text-center">
          <Image
            src="/whot/wordmark.png"
            alt="Whot"
            width={720}
            height={345}
            priority
            className="mx-auto w-48 h-auto"
          />
          <div className="gold-rule h-px w-40 mx-auto my-3" />
          <p className="text-[var(--ink)]/60 text-sm">
            Career record · every stat read from onchain events
          </p>
          {progress !== null && (
            <p className="mt-3 text-xs font-mono text-[var(--ink)]/50">
              indexing chain… {progress}%
            </p>
          )}
          {progress === null && incomplete && (
            <p className="mt-3 text-xs font-mono text-[var(--ink)]">
              index incomplete — the RPC refused a chunk. It will resume on the
              next pass.
            </p>
          )}
        </header>

        {/* headline */}
        <div className="flex flex-wrap justify-center gap-10 text-center">
          <Big value={idx.totalGames} label="games dealt" />
          <Big value={idx.totalEvents} label="onchain events" accent />
          <Big value={players.length} label="players" />
        </div>

        {/* titles */}
        <section>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink)] mb-4">
            Titles
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {crowns.map((t) => (
              <div
                key={t.key}
                className={[
                  "rounded-xl p-5 border-2 transition",
                  t.holder
                    ? "bg-[var(--cream)] border-[var(--gold)]"
                    : "bg-[var(--cream)]/50 border-[var(--ink)]/10",
                ].join(" ")}
              >
                <div className="font-serif text-xl font-bold text-[var(--ink)]">
                  {t.label}
                </div>
                <div className="text-xs text-[var(--ink)]/55 mb-3">{t.blurb}</div>
                {t.holder ? (
                  <>
                    <div className="font-mono text-sm text-[var(--ink)]">
                      {shortAddr(t.holder.addr)}
                    </div>
                    <div className="font-serif text-3xl font-black text-[var(--ink)]">
                      {t.value}
                      <span className="ml-2 text-xs font-sans font-normal text-[var(--ink)]/50">
                        {t.unit}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[var(--ink)]/40">unclaimed</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* table */}
        <section>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink)] mb-4">
            Every player
          </h2>
          {players.length === 0 ? (
            <p className="text-[var(--ink)]/50 text-sm">
              No games indexed yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--ink)]/12 bg-[var(--cream)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[0.65rem] uppercase tracking-[0.14em] text-[var(--ink)]/50 border-b border-[var(--ink)]/12">
                    <Th>Player</Th>
                    <Th right>Games</Th>
                    <Th right>Won</Th>
                    <Th right>Played</Th>
                    <Th right>Market</Th>
                    <Th right>Eaten</Th>
                    <Th right>Dealt</Th>
                    <Th right>Hold on</Th>
                    <Th right>Whot</Th>
                    <Th right>Streak</Th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {players.map((p) => (
                    <Row key={p.addr} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="text-center pt-4">
          <button
            type="button"
            onClick={reset}
            className="text-xs underline text-[var(--ink)]/40 hover:text-[var(--ink)]"
          >
            rebuild index from chain
          </button>
        </footer>
      </div>
    </main>
  );
}

function Big({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className={[
          "font-serif text-5xl font-black tabular-nums",
          accent ? "text-[var(--gold)]" : "text-[var(--ink)]",
        ].join(" ")}
      >
        {value}
      </div>
      <div className="text-[0.65rem] uppercase tracking-[0.18em] text-[var(--ink)]/50">
        {label}
      </div>
    </div>
  );
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th className={`px-3 py-3 font-semibold ${right ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

function Row({ p }: { p: PlayerStats }) {
  const td = "px-3 py-2 text-right tabular-nums";
  return (
    <tr className="border-b border-[var(--ink)]/8 last:border-0">
      <td className="px-3 py-2 text-[var(--ink)]">{shortAddr(p.addr)}</td>
      <td className={td}>{p.games}</td>
      <td className={`${td} font-bold text-[var(--ink)]`}>{p.wins}</td>
      <td className={td}>{p.played}</td>
      <td className={td}>{p.market}</td>
      <td className={td}>{p.eaten}</td>
      <td className={`${td} text-[var(--ink)]`}>{p.dealt}</td>
      <td className={td}>{p.holdOns}</td>
      <td className={td}>{p.whots}</td>
      <td className={td}>{p.longestStreak}</td>
    </tr>
  );
}
