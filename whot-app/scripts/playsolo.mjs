#!/usr/bin/env node
/** Play a solo game against the live contract with a burner wallet. */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = (k, d = "") => {
  try {
    const t = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const l = t.split("\n").find((x) => x.trim().startsWith(k + "="));
    return l ? l.slice(l.indexOf("=") + 1).trim() || d : d;
  } catch { return d; }
};

const RPC = env("NEXT_PUBLIC_MONAD_RPC") || "https://testnet-rpc.monad.xyz";
const ADDRESS = env("NEXT_PUBLIC_WHOT_ADDRESS");
const abi = JSON.parse(readFileSync(new URL("../../whot-onchain/out/Whot.sol/Whot.json", import.meta.url), "utf8")).abi;

const chain = { id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });

const burners = readFileSync(new URL("../../whot-onchain/.burners", import.meta.url), "utf8")
  .trim().split("\n").map((l) => l.trim().split(/\s+/));
const [addr, key] = burners[0];
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const WAGER = parseEther(process.argv[2] || "0.01");
const NAMES = ["Ball", "Angle", "Cross", "Carpet", "Star", "Whot"];
const card = (c) => (c >> 5) === 5 ? "Whot 20" : `${NAMES[c >> 5]} ${c & 31}`;

const send = async (fn, args = [], value = 0n) => {
  const { request } = await pub.simulateContract({ account, address: ADDRESS, abi, functionName: fn, args, value });
  const hash = await wallet.writeContract(request);
  return pub.waitForTransactionReceipt({ hash });
};

console.log(`contract ${ADDRESS}\nplayer   ${addr}`);
const before = await pub.getBalance({ address: addr });
const houseBefore = await pub.readContract({ address: ADDRESS, abi, functionName: "treasuryFree" });
console.log(`balance  ${formatEther(before)} MON | house ${formatEther(houseBefore)} MON`);
console.log(`\n── staking ${formatEther(WAGER)} MON`);

const t0 = Date.now();
const rc = await send("createSoloGame", [], WAGER);
const started = rc.logs.map((l) => { try { return pub.constructor; } catch { return null; } });
const gameId = await pub.readContract({ address: ADDRESS, abi, functionName: "nextGameId" }).then((n) => n - 1n);
console.log(`   game #${gameId} dealt in ${Date.now() - t0}ms (gas ${rc.gasUsed})`);

const state = () => pub.readContract({ address: ADDRESS, abi, functionName: "getTableState", args: [gameId, addr] });

let move = 0;
for (;;) {
  const s = await state();
  if (Number(s.status) !== 1) break;
  if (s.turnAddress.toLowerCase() !== addr.toLowerCase()) { console.log("   ! not our turn, bot stuck"); break; }

  const hand = [...s.yourHand].map(Number);
  const top = Number(s.topCard), called = Number(s.calledShape), pend = Number(s.pendingDraw), kind = Number(s.pendingKind);
  let idx = -1, call = 0xff;
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i], shp = c >> 5, num = c & 31;
    const ok = pend > 0 ? num === kind : shp === 5 ? true : called !== 0xff ? shp === called : (shp === (top >> 5) || num === (top & 31));
    if (ok) { idx = i; call = shp === 5 ? 4 : 0xff; break; }
  }

  const m0 = Date.now();
  const r = idx >= 0 ? await send("playCard", [gameId, idx, call]) : await send("drawCard", [gameId]);
  const after = await state();
  const you = after.yourHand.length, them = Number(after.counts[1]);
  console.log(`  ${String(++move).padStart(2)} ${idx >= 0 ? "play " + card(hand[idx]).padEnd(12) : "market      "} → you ${you} / house ${them} (${Date.now() - m0}ms, ${r.gasUsed} gas)`);
  if (move > 120) { console.log("   ! move cap"); break; }
}

const s = await state();
const bal = await pub.getBalance({ address: addr });
const houseAfter = await pub.readContract({ address: ADDRESS, abi, functionName: "treasuryFree" });
const locked = await pub.readContract({ address: ADDRESS, abi, functionName: "lockedStake" });
const st = ["Open", "Playing", "Won", "Drawn"][Number(s.status)];
const won = s.winner.toLowerCase() === addr.toLowerCase();

console.log(`\n── result`);
console.log(`   status      ${st}${st === "Won" ? (won ? " — PLAYER" : " — HOUSE") : ""}`);
console.log(`   moves       ${move} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`   balance     ${formatEther(before)} → ${formatEther(bal)} MON`);
console.log(`   house       ${formatEther(houseBefore)} → ${formatEther(houseAfter)} MON`);
console.log(`   lockedStake ${formatEther(locked)} MON (must be 0)`);
