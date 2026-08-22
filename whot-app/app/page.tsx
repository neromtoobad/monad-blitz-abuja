"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  useAccount,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { Connect } from "@/components/Connect";
import { SessionBar } from "@/components/SessionBar";
import { Lobby } from "@/components/Lobby";
import { SoloLobby } from "@/components/SoloLobby";
import { Table } from "@/components/Table";
import { WHOT_ADDRESS, shortAddr } from "@/lib/whot";
import { monadTestnet } from "@/lib/chain";

export default function Home() {
  const { address, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();

  const [gameId, setGameId] = useState<bigint | null>(null);
  // Solo is the front door; the multiplayer lobby sits behind a link.
  const [mode, setMode] = useState<"solo" | "table">("solo");
  const [, setSessionReady] = useState(false);

  // Keep the table in the URL hash so a game is shareable by link.
  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "");
    if (fromHash && /^\d+$/.test(fromHash)) setGameId(BigInt(fromHash));
  }, []);

  useEffect(() => {
    if (gameId !== null) window.location.hash = String(gameId);
  }, [gameId]);

  if (!WHOT_ADDRESS) {
    return (
      <Shell>
        <Warn>
          <b>No contract address set.</b> Deploy the contract, then put the
          address in <code className="font-mono">.env.local</code> as{" "}
          <code className="font-mono">NEXT_PUBLIC_WHOT_ADDRESS</code> and
          restart the dev server.
        </Warn>
      </Shell>
    );
  }

  if (!address) {
    return (
      <Shell>
        <Connect />
      </Shell>
    );
  }

  if (chainId !== monadTestnet.id) {
    return (
      <Shell>
        <div className="felt rounded-2xl p-12 text-center border border-black/20">
          <Image
            src="/whot/wordmark.png"
            alt="Whot"
            width={720}
            height={345}
            priority
            className="mx-auto w-56 h-auto brightness-0 invert opacity-95"
          />
          <div className="gold-rule h-px w-44 mx-auto my-4" />
          <p className="text-white/75 mb-2 font-bold">
            Your wallet is on the wrong network.
          </p>
          <p className="text-white/50 text-sm mb-7">
            This game runs on Monad Testnet (chain {monadTestnet.id}).
            {chainId ? ` You are on chain ${chainId}.` : ""}
          </p>

          {/* One click: switches if the chain is known, prompts to add it if not. */}
          <button
            type="button"
            disabled={switching}
            onClick={() => switchChain({ chainId: monadTestnet.id })}
            className="rounded-xl bg-[var(--gold)] text-[#2a1a14] px-7 py-3 font-bold hover:brightness-110 transition shadow disabled:opacity-50"
          >
            {switching ? "check your wallet…" : "Switch to Monad Testnet"}
          </button>

          {switchError && (
            <p className="mt-5 text-xs text-white/60 max-w-md mx-auto">
              Your wallet refused the switch. Add the network by hand: RPC{" "}
              <span className="font-mono">https://testnet-rpc.monad.xyz</span>,
              chain id <span className="font-mono">{monadTestnet.id}</span>,
              symbol <span className="font-mono">MON</span>.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <SessionBar onReady={setSessionReady} />

      <div className="flex justify-end mb-4 text-sm">
        <span className="font-mono text-[var(--ink)]/55 mr-3">
          {shortAddr(address)}
        </span>
        <button
          type="button"
          className="underline text-[var(--ink)]/55"
          onClick={() => disconnect()}
        >
          disconnect
        </button>
      </div>

      {gameId === null ? (
        mode === "solo" ? (
          <SoloLobby onOpen={setGameId} onMultiplayer={() => setMode("table")} />
        ) : (
          <>
            <button
              type="button"
              className="text-sm underline text-[var(--ink)]/55 mb-4"
              onClick={() => setMode("solo")}
            >
              ← play the house instead
            </button>
            <Lobby onOpen={setGameId} />
          </>
        )
      ) : (
        <>
          <button
            type="button"
            className="text-sm underline text-[var(--ink)]/55 mb-4"
            onClick={() => setGameId(null)}
          >
            ← back to lobby
          </button>
          <Table gameId={gameId} />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-5xl">{children}</div>
    </main>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-[var(--cream)] border-2 border-[var(--gold)] p-6 text-[var(--ink)]">
      {children}
    </div>
  );
}
