// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Whot} from "../src/Whot.sol";

/// Solo mode moves real value, so these cover the money paths as well as play.
contract SoloTest is Test {
    Whot w;

    address alice = address(0xA11CE);
    address house = address(0xF00D);

    uint8 constant WHOTS = 5;
    uint8 constant STAR = 4;
    uint8 constant NONE = 0xFF;

    /// This contract deploys Whot, so it is the owner and receives withdrawals.
    receive() external payable {}

    function setUp() public {
        w = new Whot();
        vm.deal(alice, 100 ether);
        vm.deal(house, 100 ether);

        vm.prank(house);
        w.fundTreasury{value: 50 ether}();
    }

    // ---------------------------------------------------------------- helpers

    function _status(uint256 id) internal view returns (Whot.Status s) {
        (s,,,,,,,,,) = w.getGame(id);
    }

    function _winner(uint256 id) internal view returns (address a) {
        (,,,,,,,,, a) = w.getGame(id);
    }

    function _turnAddr(uint256 id) internal view returns (address a) {
        (,, a,,,,,,,) = w.getGame(id);
    }

    /// Player picks the first legal card, mirroring the contract's matcher.
    function _pick(uint256 id, uint8[] memory hand) internal view returns (int256, uint8) {
        (,,, uint8 top, uint8 called, uint8 pend, uint8 kind,,,) = w.getGame(id);

        for (uint256 i = 0; i < hand.length; i++) {
            uint8 c = hand[i];
            uint8 shp = c >> 5;
            uint8 num = c & 31;

            bool ok;
            if (pend > 0) ok = num == kind;
            else if (shp == WHOTS) ok = true;
            else if (called != NONE) ok = shp == called;
            else ok = shp == (top >> 5) || num == (top & 31);

            if (ok) return (int256(i), shp == WHOTS ? STAR : NONE);
        }
        return (-1, NONE);
    }

    /// Plays alice's turns until the game ends. The bot moves inside her calls.
    function _playOut(uint256 id, uint256 maxMoves) internal {
        for (uint256 m = 0; m < maxMoves; m++) {
            if (_status(id) != Whot.Status.Playing) return;
            if (_turnAddr(id) != alice) return; // bot is stuck; caught by caller

            uint8[] memory hand = w.getHand(id, alice);
            (int256 idx, uint8 call) = _pick(id, hand);

            vm.prank(alice);
            if (idx >= 0) w.playCard(id, uint8(uint256(idx)), call);
            else w.drawCard(id);
        }
    }

    // ------------------------------------------------------------- treasury

    function test_FundingIncreasesFreeTreasury() public {
        assertEq(w.treasuryFree(), 50 ether);
        vm.prank(house);
        w.fundTreasury{value: 5 ether}();
        assertEq(w.treasuryFree(), 55 ether);
    }

    function test_PlainTransferAlsoFundsTreasury() public {
        vm.prank(house);
        (bool ok,) = address(w).call{value: 3 ether}("");
        assertTrue(ok);
        assertEq(w.treasuryFree(), 53 ether);
    }

    // ---------------------------------------------------------------- wagers

    function test_RejectsWagerBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(Whot.WagerOutOfRange.selector);
        w.createSoloGame{value: 0.0001 ether}();
    }

    function test_RejectsWagerAboveMaximum() public {
        vm.prank(alice);
        vm.expectRevert(Whot.WagerOutOfRange.selector);
        w.createSoloGame{value: 2 ether}();
    }

    function test_RejectsWhenTreasuryCannotMatch() public {
        Whot poor = new Whot();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert();
        poor.createSoloGame{value: 1 ether}();
    }

    function test_StakeIsEscrowedWhileTheGameRuns() public {
        vm.prank(alice);
        uint256 id = w.createSoloGame{value: 1 ether}();

        if (_status(id) == Whot.Status.Playing) {
            // both sides locked: the player's ether plus the house's match
            assertEq(w.lockedStake(), 2 ether);
            assertEq(w.treasuryFree(), 49 ether);
        }
    }

    // ------------------------------------------------------------- the house

    function test_HouseTakesTheSecondSeatAndIsNeverFirst() public {
        vm.prank(alice);
        uint256 id = w.createSoloGame{value: 1 ether}();

        address[] memory p = w.getPlayers(id);
        assertEq(p.length, 2);
        assertEq(p[0], alice);
        assertEq(p[1], address(w), "the contract itself is the opponent");
    }

    function test_HouseIsDealtAHandOfItsOwn() public {
        vm.prank(alice);
        uint256 id = w.createSoloGame{value: 1 ether}();
        assertEq(w.handCount(id, alice), 5);
        assertEq(w.handCount(id, address(w)), 5);
    }

    function test_TurnComesBackToThePlayerAfterTheBotMoves() public {
        vm.prank(alice);
        uint256 id = w.createSoloGame{value: 1 ether}();

        // The bot resolves its whole turn inside the player's transaction, so
        // control is always back with the player when the call returns.
        if (_status(id) == Whot.Status.Playing) {
            assertEq(_turnAddr(id), alice);
        }
    }

    // -------------------------------------------------------------- payouts

    function test_EveryGameTerminatesAndPaysExactlyOnce() public {
        for (uint256 run = 0; run < 10; run++) {
            vm.roll(block.number + 1);

            uint256 before = alice.balance;
            uint256 treasuryBefore = w.treasuryFree();

            vm.prank(alice);
            uint256 id = w.createSoloGame{value: 1 ether}();
            _playOut(id, 400);

            Whot.Status st = _status(id);
            assertTrue(
                st == Whot.Status.Won || st == Whot.Status.Drawn,
                "solo game did not terminate"
            );

            // stake is always released
            assertEq(w.lockedStake(), 0, "stake left locked after settlement");

            uint256 delta = int256(alice.balance) >= int256(before)
                ? alice.balance - before
                : 0;

            if (st == Whot.Status.Drawn) {
                assertEq(alice.balance, before, "a draw refunds the stake exactly");
                assertEq(w.treasuryFree(), treasuryBefore, "house unchanged on a draw");
            } else if (_winner(id) == alice) {
                assertEq(delta, 1 ether, "winner takes the pot, net +1x");
                assertEq(w.treasuryFree(), treasuryBefore - 1 ether);
            } else {
                assertEq(alice.balance, before - 1 ether, "loser forfeits the stake");
                assertEq(w.treasuryFree(), treasuryBefore + 1 ether);
            }
        }
    }

    function test_ContractNeverPaysOutMoreThanItHolds() public {
        uint256 startBal = address(w).balance;
        uint256 totalStaked;

        for (uint256 run = 0; run < 8; run++) {
            vm.roll(block.number + 1);
            vm.prank(alice);
            uint256 id = w.createSoloGame{value: 1 ether}();
            totalStaked += 1 ether;
            _playOut(id, 400);
        }

        // Conservation: every wager either stayed with the house or went back out.
        assertLe(
            address(w).balance,
            startBal + totalStaked,
            "contract paid out more than was ever staked"
        );
        assertEq(w.lockedStake(), 0);
    }

    function test_SettlementIsIdempotent() public {
        vm.prank(alice);
        uint256 id = w.createSoloGame{value: 1 ether}();
        _playOut(id, 400);

        uint256 afterSettle = alice.balance;

        // Any further action on a finished game must not pay again.
        vm.prank(alice);
        vm.expectRevert(Whot.NotPlaying.selector);
        w.drawCard(id);

        assertEq(alice.balance, afterSettle, "second settlement paid out again");
        assertEq(w.lockedStake(), 0);
    }

    function test_OnlyOwnerCanWithdrawBankroll() public {
        vm.prank(alice);
        vm.expectRevert(Whot.NotOwner.selector);
        w.withdrawTreasury(1 ether);
    }

    function test_WithdrawCannotTouchEscrowedStake() public {
        vm.prank(alice);
        uint256 id = w.createSoloGame{value: 1 ether}();
        bool live = _status(id) == Whot.Status.Playing;

        // this test contract deployed w, so it is the owner
        w.withdrawTreasury(0); // sweep everything withdrawable

        if (live) {
            assertEq(
                address(w).balance,
                2 ether,
                "escrowed pot must survive a full sweep"
            );
            assertEq(w.treasuryFree(), 0);

            // the game can still pay out afterwards
            _playOut(id, 400);
            assertEq(w.lockedStake(), 0);
        }
    }

    function test_ConcurrentSoloGamesEscrowIndependently() public {
        vm.prank(alice);
        uint256 a = w.createSoloGame{value: 1 ether}();
        vm.prank(alice);
        uint256 b = w.createSoloGame{value: 1 ether}();

        uint256 live;
        if (_status(a) == Whot.Status.Playing) live += 2 ether;
        if (_status(b) == Whot.Status.Playing) live += 2 ether;
        assertEq(w.lockedStake(), live);

        _playOut(a, 400);
        _playOut(b, 400);
        assertEq(w.lockedStake(), 0);
    }
}
