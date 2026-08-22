#!/usr/bin/env node
/**
 * Build a stats seed snapshot.
 *
 * A full backfill from the deploy block is ~200 getLogs calls and takes about
 * two minutes, which is far too slow for a first page load. So we do it here,
 * offline, and ship the result as public/stats-seed.json. The browser applies
 * the seed instantly and then only indexes blocks newer than it.
 *
 * This writes RAW decoded logs rather than folded stats on purpose: the fold
 * lives in exactly one place (lib/stats.ts applyLogs) and is applied by the
 * browser, so the two can never drift apart.
 *
 * Re-run before the demo to refresh:  npm run seed
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseEventLogs } from "viem";

const root = new URL("..", import.meta.url);

function env(key, fallback = "") {
  try {
    const txt = readFileSync(new URL(".env.local", root), "utf8");
    const line = txt.split("\n").find((l) => l.trim().startsWith(key + "="));
    return line ? line.slice(line.indexOf("=") + 1).trim() || fallback : fallback;
  } catch {
    return fallback;
  }
}

const RPC =
  process.env.MONAD_LOGS_RPC ||
  env("NEXT_PUBLIC_MONAD_LOGS_RPC") ||
  "https://testnet-rpc.monad.xyz";
const ADDRESS = env("NEXT_PUBLIC_WHOT_ADDRESS");
const DEPLOY = BigInt(env("NEXT_PUBLIC_WHOT_DEPLOY_BLOCK", "55918624"));
const SPAN = BigInt(env("NEXT_PUBLIC_MONAD_LOGS_SPAN", "90"));

if (!ADDRESS) {
  console.error("NEXT_PUBLIC_WHOT_ADDRESS is not set in .env.local");
  process.exit(1);
}

const abi = JSON.parse(
  readFileSync(
    new URL("../../whot-onchain/out/Whot.sol/Whot.json", import.meta.url),
    "utf8",
  ),
).abi;

const client = createPublicClient({ transport: http(RPC) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BigInts do not survive JSON. Stringify them; applyLogs reads these fields
// through String()/Number() so string values are handled identically.
const plain = (v) =>
  typeof v === "bigint"
    ? String(v)
    : Array.isArray(v)
      ? v.map(plain)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
        : v;

const head = await client.getBlockNumber();
const chunks = Math.ceil(Number(head - DEPLOY) / Number(SPAN));
console.log(
  `indexing ${ADDRESS}\n  ${DEPLOY} -> ${head} (${head - DEPLOY} blocks, ~${chunks} chunks)`,
);

const out = [];
let cur = DEPLOY;
let done = 0;
let failed = 0;
const t0 = Date.now();

while (cur <= head) {
  const span = cur + SPAN - 1n;
  const to = span > head ? head : span;

  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    try {
      const raw = await client.getLogs({
        address: ADDRESS,
        fromBlock: cur,
        toBlock: to,
      });
      if (raw.length) {
        for (const l of parseEventLogs({ abi, logs: raw })) {
          out.push({ eventName: l.eventName, args: plain(l.args) });
        }
      }
      ok = true;
    } catch {
      await sleep(300 * (attempt + 1));
    }
  }

  if (!ok) {
    // Stop at the gap rather than skipping it, so the seed is contiguous and
    // the browser can safely resume from toBlock.
    failed++;
    console.error(`  failed at block ${cur}, stopping here`);
    break;
  }

  cur = to + 1n;
  done++;
  if (done % 40 === 0) {
    process.stdout.write(
      `  ${done}/${chunks} chunks, ${out.length} logs, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
    );
  }
  await sleep(45);
}

const seed = {
  address: ADDRESS,
  fromBlock: String(DEPLOY),
  toBlock: String(cur), // first block NOT covered by this seed
  builtAt: new Date().toISOString(),
  logs: out,
};

const dest = new URL("public/stats-seed.json", root);
writeFileSync(dest, JSON.stringify(seed));
console.log(
  `\nwrote public/stats-seed.json  ${out.length} logs, covers ${DEPLOY}..${cur - 1n}` +
    `${failed ? "  (INCOMPLETE)" : ""}\n  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
