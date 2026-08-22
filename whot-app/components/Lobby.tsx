"use client";

import { parseEventLogs } from "viem";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useEffect } from "react";
import Image from "next/image";
import { WHOT_ADDRESS, whotAbi } from "@/lib/whot";

export function Lobby({ onOpen }: { onOpen: (id: bigint) => void }) {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  const open = useReadContract({
    abi: whotAbi,
    address: WHOT_ADDRESS,
    functionName: "getOpenTables",
    args: [BigInt(20)],
    query: { refetchInterval: 2000 },
  });

  // Pull the real gameId out of the TableCreated log rather than guessing it
  // from "newest open table". With a room full of people creating tables at
  // once, guessing lands you on someone else's game.
  useEffect(() => {
    if (!receipt.data) return;
    const logs = parseEventLogs({
      abi: whotAbi,
      eventName: "TableCreated",
      logs: receipt.data.logs,
    });
    const created = logs[0]?.args as { gameId?: bigint } | undefined;
    if (created?.gameId !== undefined) onOpen(created.gameId);
  }, [receipt.data, onOpen]);

  const openIds = (open.data as readonly bigint[] | undefined) ?? [];
  const creating = isPending || receipt.isLoading;

  return (
    <div className="rounded-2xl bg-[var(--cream)] p-8 shadow-sm border border-[var(--ink)]/10 space-y-8">
      <div className="text-center pb-2">
        <Image
          src="/whot/wordmark.png"
          alt="Whot"
          width={720}
          height={345}
          priority
          className="mx-auto w-56 h-auto"
        />
        <div className="gold-rule h-px w-40 mx-auto my-3" />
        <p className="text-[var(--ink)]/60 text-sm tracking-wide">
          Nigerian Whot on Monad. Every card is a transaction.
        </p>
      </div>

      <button
        type="button"
        disabled={creating}
        onClick={() =>
          writeContract({
            abi: whotAbi,
            address: WHOT_ADDRESS,
            functionName: "createTable",
            args: [],
          })
        }
        className="rounded-xl bg-[var(--ink)] text-[var(--cream)] px-6 py-3 font-bold hover:bg-[var(--ink-soft)] shadow transition disabled:opacity-40"
      >
        {creating ? "creating table…" : "Create a table"}
      </button>

      <div className="border-t border-[var(--ink)]/10 pt-6">
        <h2 className="font-bold mb-3">
          Open tables
          <span className="ml-2 text-sm font-normal text-[var(--ink)]/50">
            {openIds.length} waiting
          </span>
        </h2>

        {openIds.length === 0 ? (
          <p className="text-sm text-[var(--ink)]/55">
            No tables waiting. Create one and share the link.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {openIds.map((id) => (
              <button
                key={String(id)}
                type="button"
                onClick={() => onOpen(id)}
                className="rounded-xl border-2 border-[var(--ink)]/25 bg-[var(--card)] px-5 py-3 font-mono font-bold text-[var(--ink)] hover:border-[var(--gold)] transition"
              >
                #{String(id)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
