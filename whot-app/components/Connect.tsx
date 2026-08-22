"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useConnect, type Connector } from "wagmi";

/**
 * Wallet picker.
 *
 * Two things this has to get right that the default did not:
 *  - Name the wallets. EIP-6963 discovery gives real names and icons, so the
 *    generic "Injected" entry is hidden whenever a named wallet exists.
 *  - Work on a phone. A mobile browser has no extension, so the only reliable
 *    path without a WalletConnect project id is to reopen the page inside a
 *    wallet's own browser. The deep link below does exactly that.
 */
export function Connect() {
  const { connect, connectors, isPending, error, variables } = useConnect();
  const [isMobile, setIsMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  // Deep links carry the host, so read it rather than hardcoding production.
  const [host, setHost] = useState("");

  useEffect(() => {
    setHost(window.location.host + window.location.pathname);
    setIsMobile(
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
        !(window as unknown as { ethereum?: unknown }).ethereum,
    );
  }, []);

  // Named wallets come from EIP-6963 discovery. Drop the generic fallback when
  // at least one real wallet announced itself, so nobody has to guess what
  // "Injected" means.
  const wallets = useMemo(() => {
    const seen = new Set<string>();
    const named: Connector[] = [];
    let generic: Connector | null = null;

    for (const c of connectors) {
      if (c.id === "injected" && c.name.toLowerCase() === "injected") {
        generic = c;
        continue;
      }
      const key = c.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      named.push(c);
    }

    return named.length > 0 ? named : generic ? [generic] : [];
  }, [connectors]);

  const share = typeof window === "undefined" ? "" : window.location.href;

  return (
    <div className="felt rounded-2xl p-10 md:p-12 text-center border border-black/20">
      <Image
        src="/whot/wordmark.png"
        alt="Whot"
        width={720}
        height={345}
        priority
        className="mx-auto w-56 h-auto brightness-0 invert opacity-95"
      />
      <div className="gold-rule h-px w-44 mx-auto my-4" />
      <p className="text-white/65 mb-8">
        Nigerian Whot on Monad. Every card is a transaction.
      </p>

      {isMobile ? (
        <div className="space-y-4">
          <p className="text-white/75 text-sm max-w-sm mx-auto">
            Phone browsers can&apos;t reach a wallet directly. Open this page
            inside your wallet&apos;s browser.
          </p>
          <a
            href={`https://metamask.app.link/dapp/${host}`}
            className="inline-block rounded-xl bg-[var(--gold)] text-[#2a1a14] px-7 py-3 font-bold hover:brightness-110 transition shadow"
          >
            Open in MetaMask
          </a>
          <div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(share);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="text-xs underline text-white/55 hover:text-white"
            >
              {copied ? "link copied" : "or copy the link for another wallet"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-3">
          {wallets.length === 0 ? (
            <div className="max-w-sm mx-auto space-y-3">
              <p className="text-white/75 text-sm">
                No wallet detected in this browser.
              </p>
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noreferrer"
                className="inline-block rounded-xl bg-[var(--gold)] text-[#2a1a14] px-7 py-3 font-bold hover:brightness-110 transition shadow"
              >
                Install MetaMask
              </a>
            </div>
          ) : (
            wallets.map((c) => {
              const busy = isPending && variables?.connector === c;
              return (
                <button
                  key={c.uid}
                  type="button"
                  disabled={isPending}
                  onClick={() => connect({ connector: c })}
                  className="flex items-center gap-3 rounded-xl bg-[var(--gold)] text-[#2a1a14] px-6 py-3 font-bold hover:brightness-110 transition shadow disabled:opacity-50"
                >
                  {c.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.icon}
                      alt=""
                      width={20}
                      height={20}
                      className="rounded"
                    />
                  )}
                  {busy ? "check your wallet…" : c.name}
                </button>
              );
            })
          )}
        </div>
      )}

      {error && (
        <p className="mt-5 text-sm text-white/70 max-w-sm mx-auto">
          {error.message.split("\n")[0].slice(0, 140)}
        </p>
      )}

      <p className="mt-8 text-xs text-white/40">
        Monad Testnet · chain 10143 · testnet MON only
      </p>
    </div>
  );
}
