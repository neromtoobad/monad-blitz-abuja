# Whot Onchain

Nigerian Whot, fully onchain on Monad. **Every card played is a transaction.**

Built at Monad Blitz Abuja, 22 August 2026.

## Why this needs Monad

A game of Whot is 60 to 100 moves. We put every single one onchain — every play,
every trip to market, every suspension. That's 60 to 100 transactions per game,
and a game still finishes in about ninety seconds.

On a 12-second chain the same game takes twenty minutes and costs real money.
The game does not exist there.

Two other things fall out of fast blocks:

- **Block-denominated turn timeouts.** A stalled table can be prodded by anyone
  after 75 blocks (~30 seconds). A timeout measured in blocks is only meaningful
  when blocks are fast and regular.
- **Many tables at once.** Tables are independent by `gameId`, so the whole room
  plays simultaneously and every card lands in under a second.

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
| **1** Hold On | The same player plays again. The next card still has to match normally. |
| **2** Pick Two | Next player plays a 2 or draws 2 per 2 in the chain. |
| **5** Pick Three | Next player plays a 5 or draws 3 per 5 in the chain. |
| **8** Suspension | Next player skipped. **Star 8 skips the next two.** |
| **14** General Market | Every other player draws 1. |
| **20** Whot | Wild. The player calls the shape that must follow. |

**No cross-defence.** A 5 does not stop a 2, and a Whot 20 stops neither. You
play the matching number or you eat the chain.

Eating a chain ends your turn. Going to market ends your turn. Empty your hand to win.

House decisions we made, so nobody has to argue mid-game:
- Stacking is same-card only, per the rules above.
- The opening card is flipped past any special, so no game starts mid-effect.
- If the market runs dry the game is a draw. We do not reshuffle the discard pile.
- "Semi last card" and "last card" are announced by the UI, not enforced onchain.

## Contract

`src/Whot.sol`

| Function | Purpose |
|---|---|
| `createTable()` | Open a table, seat yourself, returns `gameId` |
| `joinTable(gameId)` | Take a seat, up to 4 |
| `startTable(gameId)` | Shuffle, deal 5 each, flip the first card |
| `playCard(gameId, handIndex, callShape)` | Play. `callShape` only matters for a Whot 20 |
| `drawCard(gameId)` | Go to market, or eat a live pick chain |
| `forceDraw(gameId)` | Prod a table stalled more than 75 blocks. Anyone may call. |

Views: `getGame`, `getPlayers`, `getHand`, `handCount`, `handCounts`, `isStalled`.

Every action emits an event, so all player metrics are computed client-side from
logs rather than stored onchain.

### Known limitations

Called out honestly rather than hidden:

1. **Hands are stored in plaintext.** Anyone reading state directly can see them.
   The UI doesn't show them, but this is not real hidden information. Doing it
   properly needs per-card commit-reveal or FHE. First item on the v2 list.
2. **The shuffle seed uses `blockhash`.** Not manipulation-proof against a
   validator. Swapping in a per-player commit-reveal salt is a drop-in change.
3. **No discard reshuffle.** Market exhaustion ends the game in a draw.

## Build and test

```bash
forge test -vv
```

30 tests, covering deck composition, all six special cards, the stacking maths
for chained 2s and 5s, no-cross-defence, called shapes, turn timeouts, and the
lobby.

## Deploy to Monad Testnet

Chain ID **10143**, RPC `https://testnet-rpc.monad.xyz`.

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast --interactive
```
