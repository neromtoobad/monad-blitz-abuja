import { defineChain } from "viem";

/**
 * Set NEXT_PUBLIC_MONAD_RPC in .env.local to use a dedicated endpoint.
 * Falls back to the public RPC, which rate-limits hard under load.
 *
 * NOTE: NEXT_PUBLIC_ values are compiled into the browser bundle and are
 * readable by anyone who opens the app. Only put an endpoint here that you
 * are comfortable being public.
 */
export const RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_RPC?.trim() || "https://testnet-rpc.monad.xyz";

/**
 * Separate endpoint for eth_getLogs, because providers cap log ranges very
 * differently. Alchemy's free tier allows 10 blocks; the public Monad RPC
 * allows 100. The projector feed streams logs, so it wants the wider window,
 * while the game itself wants the dedicated endpoint that will not 429.
 *
 * Override only if your provider allows a wide log range.
 */
export const LOGS_RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_LOGS_RPC?.trim() ||
  "https://testnet-rpc.monad.xyz";

/** Largest block span the logs endpoint will accept, minus headroom. */
export const LOGS_MAX_SPAN = BigInt(
  process.env.NEXT_PUBLIC_MONAD_LOGS_SPAN || "90",
);

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  // Deliberately the PUBLIC endpoint, not RPC_URL. These values are what a
  // wallet stores when it adds the network via wallet_addEthereumChain, so a
  // private/keyed URL here would be copied into every player's wallet and
  // spend the key owner's quota. The app's own traffic uses RPC_URL through
  // the wagmi transport instead.
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://testnet.monadexplorer.com",
    },
  },
  testnet: true,
});
