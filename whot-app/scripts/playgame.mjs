// Drives a real multi-player Whot game against live Monad testnet.
// Unit tests prove the rules; this proves the chain, the RPC, and the timing.
//
//   node scripts/playgame.mjs

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Read the same .env.local the app uses, so the RPC lives in exactly one place.
function envFromLocal(key) {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = txt.split("\n").find((l) => l.trim().startsWith(key + "="));
    return line ? line.slice(line.indexOf("=") + 1).trim() : "";
  } catch {
    return "";
  }
}
const RPC =
  process.env.MONAD_RPC ||
  envFromLocal("NEXT_PUBLIC_MONAD_RPC") ||
  "https://testnet-rpc.monad.xyz";
const ADDRESS = "0x646427253c1169bba8707f08187cd2fbfe223158";
const BURNERS = "/Users/MAC/Documents/HACKATHONS/monad/whot-onchain/.burners";
const ARTIFACT =
  "/Users/MAC/Documents/HACKATHONS/monad/whot-onchain/out/Whot.sol/Whot.json";

const abi = JSON.parse(readFileSync(ARTIFACT, "utf8")).abi;

const chain = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const pub = createPublicClient({ chain, transport: http(RPC) });

const players = readFileSync(BURNERS, "utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const [, key] = line.trim().split(/\s+/);
    const account = privateKeyToAccount(key);
    return {
      account,
      addr: account.address,
      wallet: createWalletClient({ account, chain, transport: http(RPC) }),
    };
  });

const NO_SHAPE = 0xff;
const WHOT = 5;
const STAR = 4;
const SHAPE = ["Ball", "Angle", "Cross", "Carpet", "Star", "Whot"];
const EFFECT = [
  "",
  "HOLD ON",
  "PICK TWO",
  "PICK THREE",
  "SUSPENSION",
  "GENERAL MARKET",
  "WHOT",
];

const shapeOf = (c) => c >> 5;
const numOf = (c) => c & 31;
const name = (c) => (shapeOf(c) === WHOT ? "Whot 20" : `${SHAPE[shapeOf(c)]} ${numOf(c)}`);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const stats = { plays: 0, draws: 0, gas: [], latency: [] };

function byAddr(a) {
  return players.find((p) => p.addr.toLowerCase() === a.toLowerCase());
}

/** Mirrors _matches() in the contract. */
function firstLegal(hand, s) {
  for (let i = 0; i < hand.length; i++) {
    const c = Number(hand[i]);
    const shp = shapeOf(c);
    const num = numOf(c);
    let ok;
    if (s.pendingDraw > 0) ok = num === s.pendingKind;
    else if (shp === WHOT) ok = true;
    else if (s.calledShape !== NO_SHAPE) ok = shp === s.calledShape;
    else ok = shp === shapeOf(s.topCard) || num === numOf(s.topCard);
    if (ok) return { index: i, card: c, call: shp === WHOT ? STAR : NO_SHAPE };
  }
  return null;
}

async function send(player, functionName, args) {
  const t0 = Date.now();
  const hash = await player.wallet.writeContract({ address: ADDRESS, abi, functionName, args });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  const ms = Date.now() - t0;
  stats.gas.push(Number(rcpt.gasUsed));
  stats.latency.push(ms);
  if (rcpt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return { rcpt, ms };
}

const state = (gameId, viewer) =>
  pub.readContract({ address: ADDRESS, abi, functionName: "getTableState", args: [gameId, viewer] });

async function main() {
  console.log(`contract ${ADDRESS}`);
  console.log(`players  ${players.map((p) => short(p.addr)).join("  ")}\n`);

  // 1. create
  console.log("── creating table");
  const { rcpt, ms } = await send(players[0], "createTable", []);
  const [log] = parseEventLogs({ abi, eventName: "TableCreated", logs: rcpt.logs });
  const gameId = log.args.gameId;
  console.log(`   game #${gameId} created in ${ms}ms (gas ${rcpt.gasUsed})`);

  // 2. both others join IN THE SAME MOMENT, to shake out seat races
  console.log("── players 2 and 3 joining simultaneously");
  const joins = await Promise.all([
    send(players[1], "joinTable", [gameId]),
    send(players[2], "joinTable", [gameId]),
  ]);
  console.log(`   both joined (${joins.map((j) => j.ms + "ms").join(", ")})`);

  let s = await state(gameId, players[0].addr);
  console.log(`   seats: ${s.players.map(short).join(", ")}`);
  if (s.players.length !== 3) throw new Error(`SEAT RACE: expected 3, got ${s.players.length}`);

  // 3. deal
  console.log("── dealing");
  const deal = await send(players[0], "startTable", [gameId]);
  s = await state(gameId, players[0].addr);
  console.log(`   dealt in ${deal.ms}ms (gas ${deal.rcpt.gasUsed}), top card ${name(s.topCard)}`);
  console.log(`   hands: ${s.counts.join("/")}, market ${s.cardsLeft}\n`);

  // 4. play it out
  const started = Date.now();
  for (let move = 1; move <= 400; move++) {
    s = await state(gameId, players[0].addr);
    if (s.status !== 1) break;

    const cur = byAddr(s.turnAddress);
    const view = await state(gameId, cur.addr);
    const pick = firstLegal(view.yourHand, view);

    const chain = view.pendingDraw > 0 ? ` [owes ${view.pendingDraw}]` : "";
    if (pick) {
      const r = await send(cur, "playCard", [gameId, pick.index, pick.call]);
      stats.plays++;
      const after = await state(gameId, cur.addr);
      const eff = EFFECT[Number(after.topCard) === pick.card ? 0 : 0];
      console.log(
        `${String(move).padStart(3)} ${short(cur.addr)} plays ${name(pick.card).padEnd(12)}` +
          `${chain} → ${after.counts.join("/")} (${r.ms}ms, ${r.rcpt.gasUsed} gas)${eff}`,
      );
    } else {
      const r = await send(cur, "drawCard", [gameId]);
      stats.draws++;
      const after = await state(gameId, cur.addr);
      console.log(
        `${String(move).padStart(3)} ${short(cur.addr)} goes to market${chain}` +
          ` → ${after.counts.join("/")} (${r.ms}ms, ${r.rcpt.gasUsed} gas)`,
      );
    }
  }

  const wall = ((Date.now() - started) / 1000).toFixed(1);
  s = await state(gameId, players[0].addr);

  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const max = (a) => Math.max(...a);

  console.log(`\n── result`);
  console.log(`   status      ${["Open", "Playing", "Won", "Drawn"][s.status]}`);
  if (s.status === 2) console.log(`   winner      ${short(s.winner)}`);
  console.log(`   game #${gameId}, ${stats.plays} plays + ${stats.draws} draws in ${wall}s`);
  console.log(`   gas/move    avg ${avg(stats.gas)}  max ${max(stats.gas)}`);
  console.log(`   latency     avg ${avg(stats.latency)}ms  max ${max(stats.latency)}ms`);
  console.log(`   final hands ${s.counts.join("/")}, market ${s.cardsLeft}`);
}

main().catch((e) => {
  console.error("\nFAILED:", e.shortMessage ?? e.message);
  process.exit(1);
});
