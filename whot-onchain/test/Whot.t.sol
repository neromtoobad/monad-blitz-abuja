// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Whot} from "../src/Whot.sol";

/// @dev Forces exact hands and board state so the rules can be tested
///      deterministically instead of hoping the shuffle cooperates.
contract WhotHarness is Whot {
    function tSetHand(uint256 gameId, address who, uint8[] memory cards) external {
        delete _hands[gameId][who];
        for (uint256 i = 0; i < cards.length; i++) {
            _hands[gameId][who].push(cards[i]);
        }
    }

    function tSetTop(uint256 gameId, uint8 card) external {
        _games[gameId].topCard = card;
        _games[gameId].calledShape = NO_SHAPE;
    }

    function tSetTurn(uint256 gameId, uint8 seat) external {
        _games[gameId].turn = seat;
    }

    function tSetDrawPtr(uint256 gameId, uint8 ptr) external {
        _games[gameId].drawPtr = ptr;
    }

    function tPending(uint256 gameId) external view returns (uint8 amount, uint8 kind) {
        return (_games[gameId].pendingDraw, _games[gameId].pendingKind);
    }

    function tFreshDeck() external pure returns (uint8[54] memory) {
        return _freshDeck();
    }
}

contract WhotTest is Test {
    // Local copies, deliberately NOT read from the contract. Reading `w.STAR()`
    // inside an argument list burns the pending vm.prank on that view call, so
    // the transaction under test runs as the wrong sender.
    uint8 constant CIRCLE = 0;
    uint8 constant TRIANGLE = 1;
    uint8 constant CROSS = 2;
    uint8 constant SQUARE = 3;
    uint8 constant STAR = 4;
    uint8 constant WHOTS = 5;
    uint8 constant NONE = 0xFF;

    WhotHarness w;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCAC0);
    address dave = address(0xDA7E);

    uint256 gid;

    function setUp() public {
        w = new WhotHarness();
    }

    // ------------------------------------------------------------ helpers

    function _card(uint8 shape, uint8 num) internal pure returns (uint8) {
        return (shape << 5) | num;
    }

    function _one(uint8 c) internal pure returns (uint8[] memory a) {
        a = new uint8[](1);
        a[0] = c;
    }

    function _two(uint8 c0, uint8 c1) internal pure returns (uint8[] memory a) {
        a = new uint8[](2);
        a[0] = c0;
        a[1] = c1;
    }

    /// Seats `n` players, starts, then clears the board so tests set their own.
    function _table(uint8 n) internal returns (uint256 id) {
        vm.prank(alice);
        id = w.createTable();
        if (n > 1) {
            vm.prank(bob);
            w.joinTable(id);
        }
        if (n > 2) {
            vm.prank(carol);
            w.joinTable(id);
        }
        if (n > 3) {
            vm.prank(dave);
            w.joinTable(id);
        }
        vm.prank(alice);
        w.startTable(id);
        w.tSetTurn(id, 0);
    }

    function _turnAddr(uint256 id) internal view returns (address a) {
        (,, a,,,,,,,) = w.getGame(id);
    }

    function _top(uint256 id) internal view returns (uint8 c) {
        (,,, c,,,,,,) = w.getGame(id);
    }

    function _called(uint256 id) internal view returns (uint8 c) {
        (,,,, c,,,,,) = w.getGame(id);
    }

    function _status(uint256 id) internal view returns (Whot.Status s) {
        (s,,,,,,,,,) = w.getGame(id);
    }

    // -------------------------------------------------------------- deck

    function test_DeckIs54CardsWithCorrectComposition() public view {
        uint8[54] memory d = w.tFreshDeck();

        uint256[6] memory perShape;
        uint256 sixesAndNines;

        for (uint256 i = 0; i < 54; i++) {
            uint8 shape = w.shapeOf(d[i]);
            uint8 num = w.numberOf(d[i]);
            perShape[shape]++;
            if (num == 6 || num == 9) sixesAndNines++;
        }

        assertEq(perShape[0], 12, "circle");
        assertEq(perShape[1], 12, "triangle");
        assertEq(perShape[2], 9, "cross");
        assertEq(perShape[3], 9, "square");
        assertEq(perShape[4], 7, "star");
        assertEq(perShape[5], 5, "whot");
        assertEq(sixesAndNines, 0, "no 6s or 9s in a Whot deck");
    }

    function test_DealGivesEveryoneFiveCards() public {
        gid = _table(4);
        assertEq(w.handCount(gid, alice), 5);
        assertEq(w.handCount(gid, bob), 5);
        assertEq(w.handCount(gid, carol), 5);
        assertEq(w.handCount(gid, dave), 5);
    }

    function test_StartingCardIsNeverSpecial() public {
        // Run a spread of tables; the flip-past-specials loop should hold every time.
        for (uint256 i = 0; i < 25; i++) {
            vm.roll(block.number + 1);
            uint256 id = _table(2);
            uint8 num = w.numberOf(_top(id));
            assertTrue(
                num != 1 && num != 2 && num != 5 && num != 8 && num != 14 && num != 20,
                "game opened on a special card"
            );
        }
    }

    // ---------------------------------------------------------- matching

    function test_MatchesOnShape() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _one(_card(CIRCLE, 13)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);
        assertEq(_top(gid), _card(CIRCLE, 13));
    }

    function test_MatchesOnNumber() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _one(_card(STAR, 7)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);
        assertEq(_top(gid), _card(STAR, 7));
    }

    function test_RevertsOnIllegalPlay() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(STAR, 13), _card(CROSS, 3)));

        vm.prank(alice);
        vm.expectRevert(Whot.IllegalPlay.selector);
        w.playCard(gid, 0, NONE);
    }

    function test_RevertsWhenNotYourTurn() public {
        gid = _table(2);
        w.tSetHand(gid, bob, _one(_card(CIRCLE, 3)));

        vm.prank(bob);
        vm.expectRevert(Whot.NotYourTurn.selector);
        w.playCard(gid, 0, NONE);
    }

    // ------------------------------------------------------------- whot 20

    function test_Whot20IsAlwaysPlayableAndForcesCalledShape() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(WHOTS, 20), _card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _two(_card(CROSS, 13), _card(STAR, 11)));

        vm.prank(alice);
        w.playCard(gid, 0, STAR);
        assertEq(_called(gid), STAR);

        // bob must follow the called shape, not the Whot's own shape
        vm.prank(bob);
        vm.expectRevert(Whot.IllegalPlay.selector);
        w.playCard(gid, 0, NONE);

        vm.prank(bob);
        w.playCard(gid, 1, NONE);
        assertEq(_called(gid), NONE, "called shape clears once answered");
    }

    // ------------------------------------------------------------- hold on

    function test_HoldOnKeepsTheTurn() public {
        gid = _table(3);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 1), _card(CIRCLE, 3)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);
        assertEq(_turnAddr(gid), alice, "hold on: same player plays again");
    }

    // --------------------------------------------------------- suspension

    function test_SuspensionSkipsOnePlayer() public {
        gid = _table(3); // alice, bob, carol
        w.tSetTop(gid, _card(CIRCLE, 7));
        // two cards, so playing the 8 does not also win the game
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 8), _card(CIRCLE, 3)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);
        assertEq(_turnAddr(gid), carol, "bob is suspended");
    }

    function test_StarEightSkipsTwoPlayers() public {
        gid = _table(4); // alice, bob, carol, dave
        w.tSetTop(gid, _card(STAR, 7));
        w.tSetHand(gid, alice, _two(_card(STAR, 8), _card(STAR, 3)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);
        assertEq(_turnAddr(gid), dave, "star 8 suspends bob and carol");
    }

    // ----------------------------------------------------- general market

    function test_GeneralMarketMakesEveryoneElseDrawOne() public {
        gid = _table(4);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _one(_card(CIRCLE, 14)));

        uint256 bobBefore = w.handCount(gid, bob);
        uint256 carolBefore = w.handCount(gid, carol);
        uint256 daveBefore = w.handCount(gid, dave);

        vm.prank(alice);
        w.playCard(gid, 0, NONE);

        assertEq(w.handCount(gid, bob), bobBefore + 1);
        assertEq(w.handCount(gid, carol), carolBefore + 1);
        assertEq(w.handCount(gid, dave), daveBefore + 1);
        assertEq(w.handCount(gid, alice), 0, "player of the 14 draws nothing");
    }

    // -------------------------------------------------------- pick chains

    function test_SinglePickTwoCostsTwoCards() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 2), _card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _one(_card(STAR, 13)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);

        (uint8 amt, uint8 kind) = w.tPending(gid);
        assertEq(amt, 2);
        assertEq(kind, 2);

        vm.prank(bob);
        w.drawCard(gid);
        assertEq(w.handCount(gid, bob), 3, "1 held + 2 eaten");
    }

    function test_TwoStackedPickTwosCostFourCards() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 2), _card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _two(_card(STAR, 2), _card(STAR, 13)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE); // pick two
        vm.prank(bob);
        w.playCard(gid, 0, NONE); // answered with another two

        (uint8 amt,) = w.tPending(gid);
        assertEq(amt, 4, "two twos = four cards");

        uint256 before = w.handCount(gid, alice);
        vm.prank(alice);
        w.drawCard(gid);
        assertEq(w.handCount(gid, alice), before + 4);
    }

    function test_ThreeStackedPickTwosCostSixCards() public {
        gid = _table(3);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 2), _card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _two(_card(STAR, 2), _card(STAR, 13)));
        w.tSetHand(gid, carol, _two(_card(CROSS, 2), _card(CROSS, 13)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);
        vm.prank(bob);
        w.playCard(gid, 0, NONE);
        vm.prank(carol);
        w.playCard(gid, 0, NONE);

        (uint8 amt,) = w.tPending(gid);
        assertEq(amt, 6, "three twos = six cards");
    }

    function test_TwoStackedPickThreesCostSixCards() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 5), _card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _two(_card(STAR, 5), _card(STAR, 13)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);
        vm.prank(bob);
        w.playCard(gid, 0, NONE);

        (uint8 amt, uint8 kind) = w.tPending(gid);
        assertEq(amt, 6, "two fives = six cards");
        assertEq(kind, 5);
    }

    function test_NoCrossDefence_FiveCannotAnswerATwo() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 2), _card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _one(_card(CIRCLE, 5)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Whot.MustAnswerChain.selector, uint8(2)));
        w.playCard(gid, 0, NONE);
    }

    function test_NoCrossDefence_Whot20CannotAnswerATwo() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 2), _card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _one(_card(WHOTS, 20)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Whot.MustAnswerChain.selector, uint8(2)));
        w.playCard(gid, 0, STAR);
    }

    function test_ChainClearsAfterItIsEaten() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 2), _card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _one(_card(STAR, 13)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);
        vm.prank(bob);
        w.drawCard(gid);

        (uint8 amt, uint8 kind) = w.tPending(gid);
        assertEq(amt, 0);
        assertEq(kind, 0);
        assertEq(_turnAddr(gid), alice, "turn passes on after eating");
    }

    // ------------------------------------------------------------ drawing

    function test_GoingToMarketEndsYourTurn() public {
        gid = _table(2);
        w.tSetHand(gid, alice, _one(_card(CROSS, 13)));

        vm.prank(alice);
        w.drawCard(gid);
        assertEq(w.handCount(gid, alice), 2);
        assertEq(_turnAddr(gid), bob);
    }

    function test_MarketExhaustionWithEqualHandsIsADraw() public {
        gid = _table(2);
        w.tSetDrawPtr(gid, w.DECK_SIZE());

        vm.prank(alice);
        w.drawCard(gid);
        assertTrue(_status(gid) == Whot.Status.Drawn);
    }

    // ------------------------------------------------------------ winning

    function test_EmptyingYourHandWinsTheGame() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _one(_card(CIRCLE, 13)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);

        assertTrue(_status(gid) == Whot.Status.Won);
        (,,,,,,,,, address winner) = w.getGame(gid);
        assertEq(winner, alice);
    }

    function test_CannotPlayOnAFinishedGame() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _one(_card(CIRCLE, 13)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE);

        w.tSetHand(gid, bob, _one(_card(CIRCLE, 3)));
        vm.prank(bob);
        vm.expectRevert(Whot.NotPlaying.selector);
        w.playCard(gid, 0, NONE);
    }

    // ------------------------------------------------------------ timeout

    function test_ForceDrawRevertsBeforeTheTimeout() public {
        gid = _table(2);
        vm.roll(block.number + 10);

        vm.prank(bob);
        vm.expectRevert(Whot.NotStalled.selector);
        w.forceDraw(gid);
    }

    function test_ForceDrawProdsAStalledTable() public {
        gid = _table(2);
        uint256 before = w.handCount(gid, alice);

        vm.roll(block.number + uint256(w.TURN_TIMEOUT_BLOCKS()) + 1);
        assertTrue(w.isStalled(gid));

        vm.prank(bob);
        w.forceDraw(gid);

        assertEq(w.handCount(gid, alice), before + 1, "stalled player eats one");
        assertEq(_turnAddr(gid), bob, "turn moves on");
    }

    function test_ForceDrawEatsALivePickChain() public {
        gid = _table(2);
        w.tSetTop(gid, _card(CIRCLE, 7));
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 2), _card(CIRCLE, 3)));

        vm.prank(alice);
        w.playCard(gid, 0, NONE); // bob now owes 2

        uint256 before = w.handCount(gid, bob);
        vm.roll(block.number + uint256(w.TURN_TIMEOUT_BLOCKS()) + 1);

        vm.prank(alice);
        w.forceDraw(gid);
        assertEq(w.handCount(gid, bob), before + 2, "AFK does not dodge the chain");
    }

    // ------------------------------------------------- full game simulation

    /// Picks the first legal card, mirroring _matches() in the contract.
    /// Every read happens here, BEFORE any vm.prank, so the prank is not
    /// burned on a view call.
    function _pick(uint256 id, uint8[] memory hand) internal view returns (int256, uint8) {
        (,,, uint8 top, uint8 called, uint8 pend, uint8 kind,,,) = w.getGame(id);

        for (uint256 i = 0; i < hand.length; i++) {
            uint8 c = hand[i];
            uint8 shp = c >> 5;
            uint8 num = c & 31;

            bool ok;
            if (pend > 0) {
                ok = num == kind;
            } else if (shp == WHOTS) {
                ok = true;
            } else if (called != NONE) {
                ok = shp == called;
            } else {
                ok = shp == (top >> 5) || num == (top & 31);
            }

            if (ok) return (int256(i), shp == WHOTS ? STAR : NONE);
        }
        return (-1, NONE);
    }

    function _playOut(uint256 id, uint256 maxMoves) internal returns (uint256 moves) {
        for (moves = 0; moves < maxMoves; moves++) {
            (Whot.Status st,, address who,,,,,,,) = w.getGame(id);
            if (st != Whot.Status.Playing) return moves;

            uint8[] memory hand = w.getHand(id, who);
            (int256 idx, uint8 call) = _pick(id, hand);

            vm.prank(who);
            if (idx >= 0) {
                w.playCard(id, uint8(uint256(idx)), call);
            } else {
                w.drawCard(id);
            }
        }
    }

    function test_FullFourPlayerGamesAlwaysTerminate() public {
        for (uint256 run = 0; run < 12; run++) {
            vm.roll(block.number + 1);
            uint256 id = _table(4);
            _playOut(id, 600);

            Whot.Status st = _status(id);
            assertTrue(
                st == Whot.Status.Won || st == Whot.Status.Drawn,
                "game neither won nor drawn: possible stuck state"
            );
        }
    }

    function test_FullTwoPlayerGamesAlwaysTerminate() public {
        for (uint256 run = 0; run < 12; run++) {
            vm.roll(block.number + 1);
            uint256 id = _table(2);
            _playOut(id, 600);

            Whot.Status st = _status(id);
            assertTrue(st == Whot.Status.Won || st == Whot.Status.Drawn, "stuck state");
        }
    }

    function test_AWonGameHasAValidWinner() public {
        uint256 wins;
        for (uint256 run = 0; run < 12; run++) {
            vm.roll(block.number + 1);
            uint256 id = _table(3);
            _playOut(id, 600);

            (,,,,,,,,, address winner) = w.getGame(id);
            if (_status(id) != Whot.Status.Won) continue;
            wins++;

            assertTrue(winner != address(0), "won game with no winner");

            // Two ways to win: empty your hand, or hold the fewest when the
            // market finishes.
            uint256 held = w.handCount(id, winner);
            if (held != 0) {
                address[] memory ps = w.getPlayers(id);
                for (uint256 i = 0; i < ps.length; i++) {
                    if (ps[i] == winner) continue;
                    assertLt(held, w.handCount(id, ps[i]), "winner did not hold fewest");
                }
            }
        }
        assertGt(wins, 0, "no game was ever won across 12 runs");
    }

    // ------------------------------------------------- market finish scoring

    function test_MarketFinishAwardsTheFewestCards() public {
        gid = _table(3);
        w.tSetDrawPtr(gid, w.DECK_SIZE());

        // carol is clearly ahead on count
        uint8[] memory four = new uint8[](4);
        for (uint8 i = 0; i < 4; i++) four[i] = _card(CIRCLE, 3);
        w.tSetHand(gid, alice, four);
        w.tSetHand(gid, bob, four);
        w.tSetHand(gid, carol, _one(_card(STAR, 11)));

        vm.prank(alice);
        w.drawCard(gid); // market is empty, forces settlement

        assertTrue(_status(gid) == Whot.Status.Won, "should award a winner, not draw");
        (,,,,,,,,, address winner) = w.getGame(gid);
        assertEq(winner, carol, "fewest cards takes it");
    }

    function test_MarketFinishEmitsTheCountItWasWonOn() public {
        gid = _table(2);
        w.tSetDrawPtr(gid, w.DECK_SIZE());
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 3), _card(CIRCLE, 4)));
        w.tSetHand(gid, bob, _one(_card(STAR, 11)));

        vm.expectEmit(true, true, false, true);
        emit Whot.MarketFinished(gid, bob, 1);

        vm.prank(alice);
        w.drawCard(gid);
    }

    function test_MarketFinishStillDrawsOnATie() public {
        gid = _table(2);
        w.tSetDrawPtr(gid, w.DECK_SIZE());
        w.tSetHand(gid, alice, _one(_card(CIRCLE, 3)));
        w.tSetHand(gid, bob, _one(_card(STAR, 11)));

        vm.prank(alice);
        w.drawCard(gid);
        assertTrue(_status(gid) == Whot.Status.Drawn, "a genuine tie is still a draw");
    }

    // --------------------------------------------------------- packed views

    function test_GetTableStateMatchesTheIndividualViews() public {
        gid = _table(3);

        Whot.TableState memory s = w.getTableState(gid, alice);

        assertEq(s.players.length, 3);
        assertEq(s.counts.length, 3);
        assertEq(s.yourHand.length, w.handCount(gid, alice));
        assertEq(s.turnAddress, _turnAddr(gid));
        assertEq(s.topCard, _top(gid));
        assertFalse(s.stalled);

        // Not a fixed number: the opening flip skips past any special, so the
        // deal consumes 16 cards or more. Compare against the real view.
        (,,,,,,, uint8 cardsLeft,,) = w.getGame(gid);
        assertEq(s.cardsLeft, cardsLeft);
        assertLe(s.cardsLeft, w.DECK_SIZE() - (5 * 3 + 1));
    }

    function test_GetTableStateShowsTheViewersOwnHandOnly() public {
        gid = _table(2);
        w.tSetHand(gid, alice, _two(_card(CIRCLE, 3), _card(STAR, 7)));
        w.tSetHand(gid, bob, _one(_card(CROSS, 11)));

        Whot.TableState memory sa = w.getTableState(gid, alice);
        Whot.TableState memory sb = w.getTableState(gid, bob);

        assertEq(sa.yourHand.length, 2);
        assertEq(sb.yourHand.length, 1);
        assertEq(sb.yourHand[0], _card(CROSS, 11));
    }

    function test_GetOpenTablesListsWaitingTablesNewestFirst() public {
        vm.prank(alice);
        uint256 a = w.createTable();
        vm.prank(bob);
        uint256 b = w.createTable();

        uint256[] memory open = w.getOpenTables(10);
        assertEq(open.length, 2);
        assertEq(open[0], b, "newest first");
        assertEq(open[1], a);
    }

    function test_GetOpenTablesHidesStartedTables() public {
        uint256 started = _table(2); // created and started
        vm.prank(carol);
        uint256 waiting = w.createTable();

        uint256[] memory open = w.getOpenTables(10);
        assertEq(open.length, 1);
        assertEq(open[0], waiting);
        assertTrue(open[0] != started);
    }

    function test_GetOpenTablesHidesFullTables() public {
        vm.prank(alice);
        uint256 id = w.createTable();
        vm.prank(bob);
        w.joinTable(id);
        vm.prank(carol);
        w.joinTable(id);
        vm.prank(dave);
        w.joinTable(id);

        assertEq(w.getOpenTables(10).length, 0, "a full table is not joinable");
    }

    // -------------------------------------------------------------- lobby

    function test_CannotJoinTwice() public {
        vm.prank(alice);
        gid = w.createTable();
        vm.prank(alice);
        vm.expectRevert(Whot.AlreadySeated.selector);
        w.joinTable(gid);
    }

    function test_CannotSeatAFifthPlayer() public {
        vm.prank(alice);
        gid = w.createTable();
        vm.prank(bob);
        w.joinTable(gid);
        vm.prank(carol);
        w.joinTable(gid);
        vm.prank(dave);
        w.joinTable(gid);

        vm.prank(address(0xEEEE));
        vm.expectRevert(Whot.TableFull.selector);
        w.joinTable(gid);
    }

    function test_CannotStartAlone() public {
        vm.prank(alice);
        gid = w.createTable();
        vm.prank(alice);
        vm.expectRevert(Whot.NotEnoughPlayers.selector);
        w.startTable(gid);
    }

    function test_TablesAreIndependent() public {
        uint256 a = _table(2);
        uint256 b = _table(2);
        assertTrue(a != b);
        assertEq(w.getPlayers(a).length, 2);
        assertEq(w.getPlayers(b).length, 2);
    }
}
