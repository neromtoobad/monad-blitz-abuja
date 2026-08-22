# Whot Onchain

**Nigerian Whot, fully onchain on Monad. Every card played is a transaction.**

Built at Monad Blitz Abuja, 22 August 2026.

Contract: [`0x8B3bd77d873C7283dC3Af984daDEa4CecA22DEf8`](https://testnet.monadexplorer.com/address/0x8B3bd77d873C7283dC3Af984daDEa4CecA22DEf8) on Monad Testnet (chain 10143)

---

## Why this needs Monad

A game of Whot is 60 to 100 moves. **We put every single one onchain** — every
play, every trip to market, every suspension. A full game still finishes in
about ninety seconds.

On a 12-second chain the same game takes twenty minutes. The game does not
exist there.

Three more things fall out of fast blocks:

- **The opponent is the contract.** In solo mode seat 1 is `address(this)`, and
  the house plays its entire turn *inside your transaction*. No bot server, no
  bot key, no waiting. You click once and the reply is already there.
- **Block-denominated timeouts.** A stalled multiplayer table can be prodded by
  anyone after 75 blocks (~30s). That is only a meaningful unit when blocks are
  fast and regular.
- **Many tables at once.** Tables are independent by `gameId`, so a whole room
  can play simultaneously and every card still lands in under a second.

## Modes

**Solo** — stake MON, the house matches from its bankroll, winner takes the pot.
A draw returns your stake exactly.

**Table** — 2 to 4 players, open lobby, shareable game id.

## Rules (Set A, the main Nigerian table)

54 cards. No 6s, no 9s.

| Shape | Numbers | Count |
|---|---|---|
| Circle (ball) | 1,2,3,4,5,7,8,10,11,12,13,14 | 12 |
| Triangle (angle) | 1,2,3,4,5,7,8,10,11,12,13,14 | 12 |
| Cross | 1,2,3,5,7,10,11,13,14 | 9 |
| Square (carpet) | 1,2,3,5,7,10,11,13,14 | 9 |
| Star | 1,2,3,4,5,7,8 | 7 |
| Whot | 20 | 5 |

Play matches the top card by **shape** or by **number**. A Whot 20 is always playable.

| Card | Effect |
|---|---|
| **1** Hold On | The same player plays again. |
| **2** Pick Two | Next player plays a 2 or draws 2 per 2 in the chain. |
| **5** Pick Three | Next player plays a 5 or draws 3 per 5 in the chain. |
| **8** Suspension | Next player skipped. **Star 8 skips the next two.** |
| **14** General Market | Every other player draws 1. |
| **20** Whot | Wild. The player calls the shape that must follow. |

**No cross-defence.** A 5 does not stop a 2, and a Whot 20 stops neither.

House decisions, so nobody argues mid-game:
- Stacking is same-card only.
- The opening card is flipped past any special, so no game starts mid-effect.
- If the market runs dry, the player holding the fewest cards wins.
- "Semi last card" and "last card" are announced by the interface, not enforced onchain.

## Layout

```
whot-onchain/   Foundry project — src/Whot.sol, 56 tests
whot-app/       Next.js app — game, projector feed, career stats
```

Routes: `/` play · `/feed` projector view · `/stats` career record · `/preview` deck reference

## Known limitations

Called out rather than hidden:

1. **Hands are stored in plaintext.** Anyone reading state directly can see them.
   The UI does not show them, but this is not real hidden information. Doing it
   properly needs per-card commit-reveal or FHE.
2. **The shuffle seed uses `blockhash`.** Not manipulation-proof against a
   validator, and with a wager on the line there is a theoretical edge in
   fishing for a good deal. Swapping in a per-player commit-reveal salt is a
   drop-in change.
3. **No discard reshuffle.** Market exhaustion ends the game on card count.
4. Gas per move (~130k in solo) exceeds small wagers. The stake is there for
   tension, not economics.

## Build and test

```bash
cd whot-onchain && forge test -vv
```

56 tests: deck composition, all six special cards, stacking maths for chained
2s and 5s, no-cross-defence, called shapes, turn timeouts, the lobby, plus full
simulated games and the solo money paths — payout, escrow, fund conservation,
and idempotent settlement.

```bash
cd whot-app && npm install && npm run dev
```

Everything needed is baked in as defaults; no env file required to run against
the live deployment.
