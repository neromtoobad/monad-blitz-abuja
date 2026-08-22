"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { formatEther, parseEther, parseEventLogs } from "viem";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { WHOT_ADDRESS, whotAbi } from "@/lib/whot";
import { rememberWager } from "@/lib/solo";

const STAKES = ["0.001", "0.01", "0.1"] as const;

export function SoloLobby({
  onOpen,
  onMultiplayer,
}: {
  onOpen: (id: bigint) => void;
  onMultiplayer: () => void;
}) {
  const [stake, setStake] = useState<string>("0.01");
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  const bankroll = useReadContract({
    abi: whotAbi,
    address: WHOT_ADDRESS,
    functionName: "treasuryFree",
    query: { refetchInterval: 5000 },
  });

  const free = (bankroll.data as bigint | undefined) ?? 0n;
  const wei = (() => {
    try {
      return parseEther(stake);
    } catch {
      return 0n;
    }
  })();
  const houseCanMatch = free >= wei;

  useEffect(() => {
    if (!receipt.data) return;
    const logs = parseEventLogs({
      abi: whotAbi,
      eventName: "SoloStarted",
      logs: receipt.data.logs,
    });
    const started = logs[0]?.args as
      | { gameId?: bigint; wager?: bigint }
      | undefined;
    if (started?.gameId !== undefined) {
      // The wager is not in getTableState, so keep it locally for the pot display.
      rememberWager(started.gameId, started.wager ?? wei);
      onOpen(started.gameId);
    }
  }, [receipt.data, onOpen, wei]);

  const busy = isPending || receipt.isLoading;

  return (
    <div className="rounded-2xl bg-[var(--cream)] p-8 shadow-sm border border-[var(--ink)]/10 space-y-7">
      <div className="text-center">
        <Image
          src="/whot/wordmark.png"
          alt="Whot"
          width={720}
          height={345}
          priority
          className="mx-auto w-52 h-auto"
        />
        <div className="gold-rule h-px w-40 mx-auto my-3" />
        <p className="text-[var(--ink)]/65 text-sm">
          Play the house heads-up. You stake, it matches, winner takes the pot.
        </p>
      </div>

      <div>
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--ink)]/50 mb-2">
          Your stake
        </div>
        <div className="flex flex-wrap gap-2">
          {STAKES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStake(s)}
              className={[
                "rounded-xl px-5 py-3 font-bold font-mono border-2 transition",
                stake === s
                  ? "bg-[var(--ink)] text-[var(--cream)] border-[var(--ink)]"
                  : "bg-[var(--card)] text-[var(--ink)] border-[var(--ink)]/20 hover:border-[var(--gold)]",
              ].join(" ")}
            >
              {s} MON
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-[var(--ink)]/[0.05] border border-[var(--ink)]/12 p-5 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--ink)]/50">
            Pot if you win
          </div>
          <div className="font-serif text-3xl font-black text-[var(--ink)]">
            {formatEther(wei * 2n)}
            <span className="ml-1 text-sm font-sans font-normal">MON</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--ink)]/50">
            House bankroll
          </div>
          <div className="font-mono text-lg text-[var(--ink)]">
            {formatEther(free)} MON
          </div>
        </div>
      </div>

      {!houseCanMatch ? (
        <div className="rounded-xl bg-[var(--cream)] border-2 border-[var(--gold)] p-4 text-sm text-[var(--ink)]">
          The house cannot match {stake} MON right now. Pick a smaller stake, or
          fund the bankroll with{" "}
          <code className="font-mono text-xs">fundTreasury()</code>.
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || wei === 0n}
          onClick={() =>
            writeContract({
              abi: whotAbi,
              address: WHOT_ADDRESS,
              functionName: "createSoloGame",
              args: [],
              value: wei,
            })
          }
          className="w-full rounded-xl bg-[var(--ink)] text-[var(--cream)] px-6 py-4 font-bold text-lg hover:bg-[var(--ink-soft)] shadow transition disabled:opacity-40"
        >
          {busy ? "dealing…" : `Play for ${stake} MON`}
        </button>
      )}

      {error && (
        <p className="text-sm text-[var(--ink)]">
          {error.message.split("\n")[0].slice(0, 160)}
        </p>
      )}

      <div className="border-t border-[var(--ink)]/10 pt-5 text-center">
        <button
          type="button"
          onClick={onMultiplayer}
          className="text-sm underline text-[var(--ink)]/55 hover:text-[var(--ink)]"
        >
          or play a table with friends
        </button>
      </div>
    </div>
  );
}
