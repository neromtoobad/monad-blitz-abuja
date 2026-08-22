"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, useSendTransaction } from "wagmi";
import {
  MOVE_COST_ESTIMATE,
  ensureSessionKey,
  sessionAddress,
  sessionBalance,
  sweepTo,
} from "@/lib/session";

const TOP_UP = "1"; // MON, roughly 60+ moves

/**
 * Funds the session wallet and shows what is left in it.
 *
 * One confirmation here buys a whole session of popup-free moves.
 */
export function SessionBar({ onReady }: { onReady: (ready: boolean) => void }) {
  const { address } = useAccount();
  const { sendTransaction, isPending } = useSendTransaction();
  const [addr, setAddr] = useState<`0x${string}` | null>(null);
  const [bal, setBal] = useState<bigint>(0n);
  const [sweeping, setSweeping] = useState(false);

  useEffect(() => {
    ensureSessionKey();
    setAddr(sessionAddress());
  }, []);

  const refresh = useCallback(async () => {
    const b = await sessionBalance();
    setBal(b);
    onReady(b > MOVE_COST_ESTIMATE * 3n);
  }, [onReady]);

  useEffect(() => {
    if (!addr) return;
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [addr, refresh]);

  if (!addr) return null;

  const movesLeft = Number(bal / MOVE_COST_ESTIMATE);
  const dry = bal <= MOVE_COST_ESTIMATE * 3n;

  return (
    <div
      className={[
        "rounded-2xl p-4 mb-4 border-2 flex flex-wrap items-center gap-x-5 gap-y-3",
        dry
          ? "bg-[var(--cream)] border-[var(--gold)]"
          : "bg-[var(--cream)] border-[var(--ink)]/12",
      ].join(" ")}
    >
      <div>
        <div className="text-[0.6rem] uppercase tracking-[0.16em] text-[var(--ink)]/50">
          Session wallet
        </div>
        <div className="font-serif text-2xl font-black text-[var(--ink)] leading-tight">
          {Number(formatEther(bal)).toFixed(3)}
          <span className="ml-1 text-xs font-sans font-normal">MON</span>
        </div>
      </div>

      <div className="text-sm text-[var(--ink)]/65 max-w-xs">
        {dry ? (
          <>
            <b>Top up to play without popups.</b> One confirmation covers the
            whole session.
          </>
        ) : (
          <>
            ~{movesLeft} moves left. No wallet popups while this has funds.
          </>
        )}
      </div>

      <div className="ml-auto flex gap-2">
        <button
          type="button"
          disabled={isPending || !address}
          onClick={() =>
            sendTransaction(
              { to: addr, value: parseEther(TOP_UP) },
              { onSuccess: () => setTimeout(refresh, 2500) },
            )
          }
          className="rounded-xl bg-[var(--ink)] text-[var(--cream)] px-5 py-2.5 font-bold hover:bg-[var(--ink-soft)] transition disabled:opacity-40"
        >
          {isPending ? "confirming…" : `Top up ${TOP_UP} MON`}
        </button>

        {bal > 0n && (
          <button
            type="button"
            disabled={sweeping || !address}
            onClick={async () => {
              if (!address) return;
              setSweeping(true);
              try {
                await sweepTo(address);
                setTimeout(refresh, 2500);
              } finally {
                setSweeping(false);
              }
            }}
            className="rounded-xl bg-[var(--ink)]/10 text-[var(--ink)] px-4 py-2.5 font-bold hover:bg-[var(--ink)]/20 transition disabled:opacity-40"
          >
            {sweeping ? "…" : "Cash out"}
          </button>
        )}
      </div>
    </div>
  );
}
