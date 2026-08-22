// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Whot - Nigerian Whot, fully onchain, one transaction per card.
/// @notice Every play, every draw, every skip is a transaction. Built for Monad Blitz Abuja.
///
/// Rule set (Set A, the main Nigerian table):
///   1  HOLD ON         - the same player plays again
///   2  PICK TWO        - next player plays a 2 or draws 2 per 2 in the chain
///   5  PICK THREE      - next player plays a 5 or draws 3 per 5 in the chain
///   8  SUSPENSION      - next player skipped. STAR 8 skips the next two.
///   14 GENERAL MARKET  - every other player draws 1
///   20 WHOT            - wild, the player calls the shape that must follow
///
/// No cross-defence: a 5 does not stop a 2, and a Whot 20 stops neither.
///
/// KNOWN LIMITATION (v1): hands are stored onchain in plaintext, so they are
/// readable by anyone reading state directly. The UI does not show them, but
/// this is not real hidden information. Doing that properly needs per-card
/// commit-reveal or FHE. It is the first thing on the v2 list.
contract Whot {
    // ---------------------------------------------------------------- config

    uint8 public constant DECK_SIZE = 54;
    uint8 public constant HAND_SIZE = 5;
    uint8 public constant MAX_PLAYERS = 4;
    uint8 public constant MIN_PLAYERS = 2;

    /// @dev ~30 seconds at 400ms blocks. A block-denominated timeout is only
    ///      meaningful because Monad blocks are fast and regular.
    uint64 public constant TURN_TIMEOUT_BLOCKS = 75;

    /// Solo wager bounds. Capped so one game can never drain the treasury.
    uint256 public constant MIN_WAGER = 0.001 ether;
    uint256 public constant MAX_WAGER = 1 ether;

    /// Bot moves executed inside one player transaction. Hold On lets the bot
    /// play repeatedly, so this bounds worst-case gas.
    uint8 private constant MAX_BOT_MOVES = 16;

    // shapes
    uint8 public constant CIRCLE = 0; // ball
    uint8 public constant TRIANGLE = 1; // angle
    uint8 public constant CROSS = 2;
    uint8 public constant SQUARE = 3; // carpet
    uint8 public constant STAR = 4;
    uint8 public constant WHOT_SHAPE = 5;

    uint8 public constant NO_SHAPE = 0xFF;

    // effect codes, emitted for client-side stats
    uint8 public constant EFF_NONE = 0;
    uint8 public constant EFF_HOLD_ON = 1;
    uint8 public constant EFF_PICK_TWO = 2;
    uint8 public constant EFF_PICK_THREE = 3;
    uint8 public constant EFF_SUSPENSION = 4;
    uint8 public constant EFF_GENERAL_MARKET = 5;
    uint8 public constant EFF_WHOT = 6;

    // ----------------------------------------------------------------- types

    enum Status {
        Open,
        Playing,
        Won,
        Drawn
    }

    /// @dev Everything a table UI needs, in one call. The frontend polls this
    ///      hard, and four separate reads per player per tick does not survive
    ///      a room full of concurrent tables on a public RPC.
    struct TableState {
        Status status;
        uint8 turn;
        address turnAddress;
        uint8 topCard;
        uint8 calledShape;
        uint8 pendingDraw;
        uint8 pendingKind;
        uint8 cardsLeft;
        uint64 lastMoveBlock;
        address winner;
        bool stalled;
        address[] players;
        uint256[] counts;
        uint8[] yourHand;
    }

    struct Game {
        Status status;
        uint8 turn; // index into players
        uint8 drawPtr; // next unused card in deck
        uint8 topCard; // current discard top
        uint8 calledShape; // shape called by a Whot 20, else NO_SHAPE
        uint8 pendingDraw; // accumulated pick-two / pick-three penalty
        uint8 pendingKind; // 2 or 5 while a chain is live, else 0
        uint64 lastMoveBlock;
        address winner;
        bool solo; // seat 1 is this contract, playing itself
        bool paid; // solo payout already settled
        uint256 wager; // per-side stake; pot is 2x this
    }

    // ---------------------------------------------------------------- storage

    uint256 public nextGameId = 1;

    constructor() {
        owner = msg.sender;
    }

    // internal, not private, so the test harness can force exact hands
    mapping(uint256 => Game) internal _games;
    mapping(uint256 => address[]) internal _players;
    mapping(uint256 => uint8[DECK_SIZE]) internal _deck;
    mapping(uint256 => mapping(address => uint8[])) internal _hands;
    mapping(uint256 => mapping(address => bool)) internal _seated;

    /// @dev Whoever deployed the contract. Only used to recover the bankroll;
    ///      it has no power over any game in progress.
    address public immutable owner;

    /// @dev Stake escrowed against live solo games: the player's wager plus the
    ///      house's matching side. Never lend it out to a new game.
    uint256 public lockedStake;

    // ---------------------------------------------------------------- events

    event TableCreated(uint256 indexed gameId, address indexed creator);
    event PlayerJoined(uint256 indexed gameId, address indexed player, uint8 seat);
    event GameStarted(uint256 indexed gameId, uint8 playerCount, uint8 firstCard);
    event CardPlayed(
        uint256 indexed gameId,
        address indexed player,
        uint8 card,
        uint8 effect,
        uint8 calledShape,
        uint8 handCount
    );
    event CardsDrawn(uint256 indexed gameId, address indexed player, uint8 count, uint8 handCount);
    event TurnForced(uint256 indexed gameId, address indexed stalled, address indexed prodder);
    event GameWon(uint256 indexed gameId, address indexed winner);
    /// @dev Won on a card count rather than by emptying a hand.
    event MarketFinished(uint256 indexed gameId, address indexed winner, uint8 cardsHeld);
    event GameDrawn(uint256 indexed gameId);
    event TreasuryFunded(address indexed from, uint256 amount);
    event SoloStarted(uint256 indexed gameId, address indexed player, uint256 wager);
    event SoloSettled(uint256 indexed gameId, address indexed player, uint256 payout, bool playerWon);

    // ---------------------------------------------------------------- errors

    error NotOpen();
    error NotPlaying();
    error AlreadySeated();
    error TableFull();
    error NotEnoughPlayers();
    error NotYourTurn();
    error BadHandIndex();
    error IllegalPlay();
    error MustAnswerChain(uint8 kind);
    error MustCallShape();
    error NotStalled();
    error WagerOutOfRange();
    error TreasuryTooThin(uint256 available, uint256 needed);
    error PayoutFailed();
    error NotOwner();

    // ------------------------------------------------------------ card codec

    function encode(uint8 shape, uint8 number) public pure returns (uint8) {
        return (shape << 5) | number;
    }

    function shapeOf(uint8 card) public pure returns (uint8) {
        return card >> 5;
    }

    function numberOf(uint8 card) public pure returns (uint8) {
        return card & 31;
    }

    // ----------------------------------------------------------------- table

    function createTable() external returns (uint256 gameId) {
        gameId = nextGameId++;

        Game storage g = _games[gameId];
        g.status = Status.Open;
        g.calledShape = NO_SHAPE;
        g.lastMoveBlock = uint64(block.number);

        _players[gameId].push(msg.sender);
        _seated[gameId][msg.sender] = true;

        emit TableCreated(gameId, msg.sender);
        emit PlayerJoined(gameId, msg.sender, 0);
    }

    function joinTable(uint256 gameId) external {
        Game storage g = _games[gameId];
        if (g.status != Status.Open) revert NotOpen();
        if (_seated[gameId][msg.sender]) revert AlreadySeated();

        address[] storage p = _players[gameId];
        if (p.length >= MAX_PLAYERS) revert TableFull();

        p.push(msg.sender);
        _seated[gameId][msg.sender] = true;

        emit PlayerJoined(gameId, msg.sender, uint8(p.length - 1));
    }

    /// @notice Deal and start. Callable by any seated player once two are in.
    function startTable(uint256 gameId) external {
        Game storage g = _games[gameId];
        if (g.status != Status.Open) revert NotOpen();

        address[] storage p = _players[gameId];
        if (p.length < MIN_PLAYERS) revert NotEnoughPlayers();

        _deal(gameId, g, p);
    }

    /// @dev Shuffle, deal, flip the opening card. Shared by open tables and
    ///      solo games so both start from identical state.
    function _deal(uint256 gameId, Game storage g, address[] storage p) private {
        uint8 n = uint8(p.length);

        // Shuffle in memory, write once.
        //
        // v1 seed. Not manipulation-proof: a validator could in principle grind
        // the blockhash. Swapping this for a per-player commit-reveal salt is a
        // drop-in change and is on the v2 list.
        uint256 seed = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), gameId, block.timestamp, p.length))
        );
        uint8[DECK_SIZE] memory d = _freshDeck();
        for (uint256 i = DECK_SIZE - 1; i > 0; i--) {
            uint256 j = uint256(keccak256(abi.encodePacked(seed, i))) % (i + 1);
            (d[i], d[j]) = (d[j], d[i]);
        }
        _deck[gameId] = d;

        // Deal.
        uint8 ptr = 0;
        for (uint8 h = 0; h < HAND_SIZE; h++) {
            for (uint8 i = 0; i < n; i++) {
                _hands[gameId][p[i]].push(d[ptr++]);
            }
        }

        // Flip the starting card. Keep flipping past specials so the game never
        // opens mid-effect. With 54 cards and 5 hands dealt this always lands.
        uint8 first = d[ptr++];
        while (_isSpecial(numberOf(first)) && ptr < DECK_SIZE) {
            first = d[ptr++];
        }

        g.status = Status.Playing;
        g.turn = 0;
        g.drawPtr = ptr;
        g.topCard = first;
        g.calledShape = NO_SHAPE;
        g.pendingDraw = 0;
        g.pendingKind = 0;
        g.lastMoveBlock = uint64(block.number);

        emit GameStarted(gameId, n, first);
    }

    // ------------------------------------------------------------------ play

    /// @param handIndex index into the caller's hand
    /// @param callShape shape to call, required when playing a Whot 20, else ignored
    function playCard(uint256 gameId, uint8 handIndex, uint8 callShape) external {
        Game storage g = _games[gameId];
        if (g.status != Status.Playing) revert NotPlaying();

        address[] storage p = _players[gameId];
        if (p[g.turn] != msg.sender) revert NotYourTurn();

        _play(gameId, g, p, msg.sender, handIndex, callShape);
        _runBot(gameId);
        _settle(gameId);
    }

    /// @dev The rules themselves, with the actor passed in rather than assumed
    ///      to be msg.sender, so the in-contract opponent can use them too.
    function _play(
        uint256 gameId,
        Game storage g,
        address[] storage p,
        address actor,
        uint8 handIndex,
        uint8 callShape
    ) private {
        uint8[] storage hand = _hands[gameId][actor];
        if (handIndex >= hand.length) revert BadHandIndex();

        uint8 card = hand[handIndex];
        uint8 num = numberOf(card);
        uint8 shp = shapeOf(card);

        // A live pick-chain can only be answered with the same number.
        // No cross-defence, no Whot 20 escape.
        if (g.pendingDraw > 0) {
            if (num != g.pendingKind) revert MustAnswerChain(g.pendingKind);
        } else if (!_matches(g, card)) {
            revert IllegalPlay();
        }

        if (num == 20 && callShape > STAR) revert MustCallShape();

        _removeAt(hand, handIndex);
        g.topCard = card;
        g.calledShape = NO_SHAPE;

        // Winning on the last card still applies its effect to everyone else,
        // which matters for General Market and the pick cards.
        bool won = hand.length == 0;

        uint8 effect = EFF_NONE;
        bool advance = true;
        uint8 step = 1;

        if (num == 1) {
            effect = EFF_HOLD_ON;
            advance = false; // same player plays again
        } else if (num == 2) {
            effect = EFF_PICK_TWO;
            g.pendingDraw += 2;
            g.pendingKind = 2;
        } else if (num == 5) {
            effect = EFF_PICK_THREE;
            g.pendingDraw += 3;
            g.pendingKind = 5;
        } else if (num == 8) {
            effect = EFF_SUSPENSION;
            step = shp == STAR ? 3 : 2; // skip 1 or 2, then land on the next live player
        } else if (num == 14) {
            effect = EFF_GENERAL_MARKET;
            uint8 n = uint8(p.length);
            for (uint8 i = 0; i < n; i++) {
                if (p[i] == actor) continue;
                if (!_draw(gameId, g, p[i], 1)) return; // deck died, game drawn
            }
        } else if (num == 20) {
            effect = EFF_WHOT;
            g.calledShape = callShape;
        }

        emit CardPlayed(gameId, actor, card, effect, g.calledShape, uint8(hand.length));

        if (won) {
            g.status = Status.Won;
            g.winner = actor;
            g.lastMoveBlock = uint64(block.number);
            emit GameWon(gameId, actor);
            return;
        }

        if (advance) g.turn = uint8((uint256(g.turn) + step) % p.length);
        g.lastMoveBlock = uint64(block.number);
    }

    /// @notice Go to market. Eats any live pick-chain. Either way your turn ends.
    function drawCard(uint256 gameId) external {
        Game storage g = _games[gameId];
        if (g.status != Status.Playing) revert NotPlaying();

        address[] storage p = _players[gameId];
        if (p[g.turn] != msg.sender) revert NotYourTurn();

        _takeTurnByDrawing(gameId, g, p, msg.sender);
        _runBot(gameId);
        _settle(gameId);
    }

    /// @notice Prod a stalled table. Anyone can call once the timeout passes.
    /// @dev This is what stops one flaky laptop from freezing a table mid-demo.
    function forceDraw(uint256 gameId) external {
        Game storage g = _games[gameId];
        if (g.status != Status.Playing) revert NotPlaying();
        if (block.number - g.lastMoveBlock <= TURN_TIMEOUT_BLOCKS) revert NotStalled();

        address[] storage p = _players[gameId];
        address stalled = p[g.turn];

        emit TurnForced(gameId, stalled, msg.sender);
        _takeTurnByDrawing(gameId, g, p, stalled);
    }

    // -------------------------------------------------------------- internals

    function _takeTurnByDrawing(uint256 gameId, Game storage g, address[] storage p, address who) private {
        uint8 count = g.pendingDraw > 0 ? g.pendingDraw : 1;

        g.pendingDraw = 0;
        g.pendingKind = 0;

        if (!_draw(gameId, g, who, count)) return; // deck died, game drawn

        g.turn = uint8((uint256(g.turn) + 1) % p.length);
        g.lastMoveBlock = uint64(block.number);
    }

    /// @return alive false if the market ran dry and the game was drawn
    function _draw(uint256 gameId, Game storage g, address who, uint8 count) private returns (bool alive) {
        uint8[] storage hand = _hands[gameId][who];
        uint8[DECK_SIZE] storage d = _deck[gameId];

        for (uint8 i = 0; i < count; i++) {
            if (g.drawPtr >= DECK_SIZE) {
                // Market finished. Rather than reshuffle the discard pile
                // (which would mean tracking every played card, at gas cost on
                // every single move), we count: fewest cards wins. This is a
                // real house rule, and it means a game always has a winner.
                _settleOnEmptyMarket(gameId, g);
                return false;
            }
            hand.push(d[g.drawPtr++]);
        }

        emit CardsDrawn(gameId, who, count, uint8(hand.length));
        return true;
    }

    /// @dev Market finished: lowest card count takes it. A genuine tie for
    ///      lowest is the only way this game ends without a winner.
    function _settleOnEmptyMarket(uint256 gameId, Game storage g) private {
        address[] storage p = _players[gameId];

        uint256 best = type(uint256).max;
        address leader;
        bool tied;

        for (uint256 i = 0; i < p.length; i++) {
            uint256 n = _hands[gameId][p[i]].length;
            if (n < best) {
                best = n;
                leader = p[i];
                tied = false;
            } else if (n == best) {
                tied = true;
            }
        }

        g.lastMoveBlock = uint64(block.number);

        if (tied) {
            g.status = Status.Drawn;
            emit GameDrawn(gameId);
        } else {
            g.status = Status.Won;
            g.winner = leader;
            emit MarketFinished(gameId, leader, uint8(best));
            emit GameWon(gameId, leader);
        }
    }

    function _matches(Game storage g, uint8 card) private view returns (bool) {
        uint8 shp = shapeOf(card);
        if (shp == WHOT_SHAPE) return true; // a Whot 20 is always playable

        if (g.calledShape != NO_SHAPE) return shp == g.calledShape;

        return shp == shapeOf(g.topCard) || numberOf(card) == numberOf(g.topCard);
    }

    function _isSpecial(uint8 num) private pure returns (bool) {
        return num == 1 || num == 2 || num == 5 || num == 8 || num == 14 || num == 20;
    }

    function _removeAt(uint8[] storage arr, uint8 i) private {
        arr[i] = arr[arr.length - 1];
        arr.pop();
    }

    function _freshDeck() internal pure returns (uint8[DECK_SIZE] memory d) {
        uint8[12] memory twelve = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14];
        uint8[9] memory nine = [1, 2, 3, 5, 7, 10, 11, 13, 14];
        uint8[7] memory seven = [1, 2, 3, 4, 5, 7, 8];

        uint8 k = 0;
        for (uint8 i = 0; i < 12; i++) d[k++] = encode(CIRCLE, twelve[i]);
        for (uint8 i = 0; i < 12; i++) d[k++] = encode(TRIANGLE, twelve[i]);
        for (uint8 i = 0; i < 9; i++) d[k++] = encode(CROSS, nine[i]);
        for (uint8 i = 0; i < 9; i++) d[k++] = encode(SQUARE, nine[i]);
        for (uint8 i = 0; i < 7; i++) d[k++] = encode(STAR, seven[i]);
        for (uint8 i = 0; i < 5; i++) d[k++] = encode(WHOT_SHAPE, 20);
    }

    // ------------------------------------------------------------- solo mode

    /// @notice Add MON to the house bankroll. Anyone may fund it.
    function fundTreasury() external payable {
        emit TreasuryFunded(msg.sender, msg.value);
    }

    /// @notice Bankroll not already escrowed against a live game.
    function treasuryFree() public view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > lockedStake ? bal - lockedStake : 0;
    }

    /// @notice Play heads-up against the contract. You stake, the house matches,
    ///         and the winner takes the pot.
    /// @dev The opponent is this contract: seat 1 is address(this) and its moves
    ///      run inside your transaction, so a game needs no second signer.
    function createSoloGame() external payable returns (uint256 gameId) {
        uint256 wager = msg.value;
        if (wager < MIN_WAGER || wager > MAX_WAGER) revert WagerOutOfRange();

        // treasuryFree() already excludes this call's msg.value? No: balance
        // includes it, so subtract it before checking the house can match.
        uint256 free = treasuryFree();
        free = free > wager ? free - wager : 0;
        if (free < wager) revert TreasuryTooThin(free, wager);

        gameId = nextGameId++;
        lockedStake += wager * 2;

        Game storage g = _games[gameId];
        g.status = Status.Open;
        g.calledShape = NO_SHAPE;
        g.lastMoveBlock = uint64(block.number);
        g.solo = true;
        g.wager = wager;

        address[] storage p = _players[gameId];
        p.push(msg.sender); // seat 0 always moves first
        p.push(address(this)); // the house
        _seated[gameId][msg.sender] = true;

        emit TableCreated(gameId, msg.sender);
        emit PlayerJoined(gameId, msg.sender, 0);
        emit PlayerJoined(gameId, address(this), 1);
        emit SoloStarted(gameId, msg.sender, wager);

        _deal(gameId, g, p);
        _runBot(gameId); // in case the opening card hands the bot the turn
        _settle(gameId);
    }

    /// @dev Runs the house's turn(s) until the move is back with the player.
    function _runBot(uint256 gameId) private {
        Game storage g = _games[gameId];
        if (!g.solo) return;

        address[] storage p = _players[gameId];

        for (uint8 i = 0; i < MAX_BOT_MOVES; i++) {
            if (g.status != Status.Playing) return;
            if (p[g.turn] != address(this)) return;

            (bool found, uint8 idx, uint8 call) = _botPick(gameId, g);
            if (found) {
                _play(gameId, g, p, address(this), idx, call);
            } else {
                _takeTurnByDrawing(gameId, g, p, address(this));
            }
        }
    }

    /// @dev Choose the house's card. Answers a live chain if it can, otherwise
    ///      prefers cards that hurt: pick-twos first, Whot 20 only as a last
    ///      resort so it keeps its wild card for when nothing else is legal.
    function _botPick(uint256 gameId, Game storage g)
        private
        view
        returns (bool found, uint8 index, uint8 callShape)
    {
        uint8[] storage hand = _hands[gameId][address(this)];
        uint256 best;
        callShape = NO_SHAPE;

        for (uint8 i = 0; i < hand.length; i++) {
            uint8 card = hand[i];
            uint8 num = numberOf(card);

            if (g.pendingDraw > 0) {
                // only the same number answers a chain
                if (num != g.pendingKind) continue;
            } else if (!_matches(g, card)) {
                continue;
            }

            uint256 score = 50;
            if (num == 2) score = 100;
            else if (num == 5) score = 95;
            else if (num == 8) score = shapeOf(card) == STAR ? 92 : 90;
            else if (num == 14) score = 85;
            else if (num == 1) score = 80;
            else if (num == 20) score = 10; // hold the wild until it is needed

            if (!found || score > best) {
                found = true;
                best = score;
                index = i;
            }
        }

        // When playing the wild, call whichever shape the house holds most of.
        if (found && numberOf(hand[index]) == 20) {
            uint8[6] memory tally;
            for (uint8 i = 0; i < hand.length; i++) {
                uint8 sh = shapeOf(hand[i]);
                if (sh < WHOT_SHAPE) tally[sh]++;
            }
            uint8 pick = CIRCLE;
            for (uint8 sh = 1; sh <= STAR; sh++) {
                if (tally[sh] > tally[pick]) pick = sh;
            }
            callShape = pick;
        }
    }

    /// @dev Pay out a finished solo game exactly once.
    function _settle(uint256 gameId) private {
        Game storage g = _games[gameId];
        if (!g.solo || g.paid) return;
        if (g.status != Status.Won && g.status != Status.Drawn) return;

        g.paid = true;
        uint256 wager = g.wager;
        uint256 pot = wager * 2;
        lockedStake -= pot;

        address player = _players[gameId][0];
        bool playerWon = g.status == Status.Won && g.winner == player;

        // A drawn game returns the player's own stake and nothing more.
        uint256 payout = playerWon ? pot : (g.status == Status.Drawn ? wager : 0);

        emit SoloSettled(gameId, player, payout, playerWon);

        if (payout > 0) {
            (bool ok, ) = payable(player).call{value: payout}("");
            if (!ok) revert PayoutFailed();
        }
    }

    /// @notice Recover bankroll that is not escrowed against a live game.
    /// @dev Deliberately cannot touch lockedStake, so a withdrawal can never
    ///      strand a game that is still owed a payout.
    function withdrawTreasury(uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();

        uint256 free = treasuryFree();
        uint256 take = amount == 0 || amount > free ? free : amount;

        (bool ok, ) = payable(owner).call{value: take}("");
        if (!ok) revert PayoutFailed();
    }

    receive() external payable {
        emit TreasuryFunded(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------ views

    function getGame(uint256 gameId)
        external
        view
        returns (
            Status status,
            uint8 turn,
            address turnAddress,
            uint8 topCard,
            uint8 calledShape,
            uint8 pendingDraw,
            uint8 pendingKind,
            uint8 cardsLeft,
            uint64 lastMoveBlock,
            address winner
        )
    {
        Game storage g = _games[gameId];
        address[] storage p = _players[gameId];
        return (
            g.status,
            g.turn,
            p.length == 0 ? address(0) : p[g.turn],
            g.topCard,
            g.calledShape,
            g.pendingDraw,
            g.pendingKind,
            DECK_SIZE - g.drawPtr,
            g.lastMoveBlock,
            g.winner
        );
    }

    function getPlayers(uint256 gameId) external view returns (address[] memory) {
        return _players[gameId];
    }

    function getHand(uint256 gameId, address player) external view returns (uint8[] memory) {
        return _hands[gameId][player];
    }

    function handCount(uint256 gameId, address player) external view returns (uint256) {
        return _hands[gameId][player].length;
    }

    /// @notice Every opponent's card count in seat order, for the table UI.
    function handCounts(uint256 gameId) external view returns (uint256[] memory counts) {
        address[] storage p = _players[gameId];
        counts = new uint256[](p.length);
        for (uint256 i = 0; i < p.length; i++) {
            counts[i] = _hands[gameId][p[i]].length;
        }
    }

    /// @notice True once anyone may call forceDraw on this table.
    function isStalled(uint256 gameId) public view returns (bool) {
        Game storage g = _games[gameId];
        if (g.status != Status.Playing) return false;
        return block.number - g.lastMoveBlock > TURN_TIMEOUT_BLOCKS;
    }

    /// @notice One call, everything a table UI needs. Use this instead of
    ///         getGame + getPlayers + handCounts + getHand.
    function getTableState(uint256 gameId, address viewer)
        external
        view
        returns (TableState memory s)
    {
        Game storage g = _games[gameId];
        address[] storage p = _players[gameId];

        s.status = g.status;
        s.turn = g.turn;
        s.turnAddress = p.length == 0 ? address(0) : p[g.turn];
        s.topCard = g.topCard;
        s.calledShape = g.calledShape;
        s.pendingDraw = g.pendingDraw;
        s.pendingKind = g.pendingKind;
        s.cardsLeft = DECK_SIZE - g.drawPtr;
        s.lastMoveBlock = g.lastMoveBlock;
        s.winner = g.winner;
        s.stalled = isStalled(gameId);
        s.players = p;

        s.counts = new uint256[](p.length);
        for (uint256 i = 0; i < p.length; i++) {
            s.counts[i] = _hands[gameId][p[i]].length;
        }

        s.yourHand = _hands[gameId][viewer];
    }

    /// @notice Most recent tables still waiting for players, newest first.
    /// @dev Lets the lobby list real tables instead of asking people to paste
    ///      a game id they had to dig out of the explorer.
    function getOpenTables(uint256 limit) external view returns (uint256[] memory ids) {
        uint256[] memory buf = new uint256[](limit);
        uint256 found;

        for (uint256 id = nextGameId - 1; id > 0 && found < limit; id--) {
            if (_games[id].status == Status.Open && _players[id].length < MAX_PLAYERS) {
                buf[found++] = id;
            }
        }

        ids = new uint256[](found);
        for (uint256 i = 0; i < found; i++) {
            ids[i] = buf[i];
        }
    }
}
