import { createPublicClient, createWalletClient, http, type Hash } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RPC_URL, monadTestnet } from "./chain";

/**
 * Session wallet.
 *
 * Whot is 60-100 moves and every one is a real transaction, which is the whole
 * point. But confirming each one in a wallet popup destroys the game. So we
 * generate a throwaway key in the browser, fund it once with a single
 * confirmation from the player's real wallet, and sign every move locally.
 *
 * Every move is still a transaction on Monad. The player just stops clicking.
 *
 * SECURITY: the key lives in localStorage in plain text. That is acceptable
 * only because this is a testnet burner holding play money the user tops up
 * deliberately and can sweep back at any time. Never do this with a wallet
 * that holds anything real.
 */

const KEY = "whot-session-key-v1";

export function loadSessionKey(): `0x${string}` | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY) as `0x${string}` | null;
  } catch {
    return null;
  }
}

export function ensureSessionKey(): `0x${string}` {
  const existing = loadSessionKey();
  if (existing) return existing;
  const fresh = generatePrivateKey();
  window.localStorage.setItem(KEY, fresh);
  return fresh;
}

export function clearSessionKey() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

export function sessionAddress(): `0x${string}` | null {
  const k = loadSessionKey();
  return k ? privateKeyToAccount(k).address : null;
}

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL),
});

function wallet() {
  const key = ensureSessionKey();
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: monadTestnet,
    transport: http(RPC_URL),
  });
}

/**
 * Send a contract call from the session wallet. No popup.
 *
 * Nonces are managed explicitly: a player can click faster than a receipt
 * arrives, and letting the node pick would collide and drop moves.
 */
let pending: Promise<unknown> = Promise.resolve();

export function sessionSend(
  address: `0x${string}`,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
  value?: bigint,
): Promise<Hash> {
  // Serialise sends so consecutive moves cannot race for the same nonce.
  const run = pending.then(async () => {
    const w = wallet();
    const nonce = await publicClient.getTransactionCount({
      address: w.account.address,
      blockTag: "pending",
    });
    return w.writeContract({
      address,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      abi: abi as any,
      functionName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: args as any,
      value,
      nonce,
      chain: monadTestnet,
    });
  });
  pending = run.catch(() => undefined);
  return run as Promise<Hash>;
}

export async function sessionBalance(): Promise<bigint> {
  const a = sessionAddress();
  if (!a) return 0n;
  return publicClient.getBalance({ address: a });
}

/** Roughly what one move costs, used to warn before the session runs dry. */
export const MOVE_COST_ESTIMATE = 15_000_000_000_000_000n; // 0.015 MON

/** Send everything back to `to`, minus the gas for the sweep itself. */
export async function sweepTo(to: `0x${string}`): Promise<Hash | null> {
  const w = wallet();
  const bal = await publicClient.getBalance({ address: w.account.address });
  const gasPrice = await publicClient.getGasPrice();
  const fee = gasPrice * 21000n * 2n; // headroom for price movement
  if (bal <= fee) return null;

  return w.sendTransaction({
    to,
    value: bal - fee,
    chain: monadTestnet,
  });
}
