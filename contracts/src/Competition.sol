// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {SongRegistry} from "./SongRegistry.sol";

/// @title Competition
/// @notice One contract that hosts every prediction competition. Fans pay a fixed USDC entry fee
///         and predict a song's metric at window close. After the oracle submits the real value,
///         the closest predictions split the winners' share of the pot and the artist is paid
///         their share in the same transaction.
/// @dev Scaling notes:
///      - New competitions are new ids, not new deployments, so the frontend and the QuickNode
///        Stream only ever watch one address.
///      - Entries per competition are capped (MAX_ENTRIES) so settlement stays bounded in gas.
///      - Only the winners are ranked onchain. The full leaderboard is derived offchain from
///        `EntrySubmitted` events plus `finalMetric`, using the same rule (smaller error ranks
///        higher; ties go to the earlier entry).
///      - USDC amounts use the 6-decimal ERC-20 interface. Never mix in msg.value (18 decimals on Arc).
contract Competition {
    // ------------------------------------------------------------------ types

    enum Status {
        None,
        Open,
        Settled,
        Cancelled
    }

    struct Config {
        uint256 songId;
        uint256 entryFee; // USDC, 6 decimals (1_000_000 = $1)
        uint64 closesAt; // entries accepted while block.timestamp < closesAt
        uint32 minEntries; // below this at settlement => everyone refunded
        uint32 maxEntries; // hard cap, <= MAX_ENTRIES
        uint16 artistBps; // artist share of the pot
        uint16 platformBps; // treasury share of the pot (may be 0)
        uint16[] payoutBps; // winner shares by rank: [rank1, rank2, ...]
        string metric; // human label, e.g. "YouTube views at close"
    }

    struct Entry {
        address player;
        uint256 prediction;
    }

    struct Round {
        Config cfg;
        Status status;
        uint256 pot;
        uint256 finalMetric;
    }

    // -------------------------------------------------------------- constants

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_ENTRIES = 500;
    uint256 public constant MAX_WINNERS = 10;

    // ------------------------------------------------------------------ state

    IERC20 public immutable usdc;
    SongRegistry public immutable registry;

    address public owner; // creates competitions, sets roles
    address public oracle; // submits final metrics
    address public treasury; // receives platformBps

    uint256 public competitionCount;
    mapping(uint256 id => Round) private _rounds;
    mapping(uint256 id => Entry[]) private _entries;
    mapping(uint256 id => mapping(address player => bool)) public hasEntered;

    /// @notice Payments that could not be pushed (e.g. recipient blocklisted). Claim with withdraw().
    mapping(address account => uint256) public owed;

    // ----------------------------------------------------------------- events

    event CompetitionCreated(
        uint256 indexed id,
        uint256 indexed songId,
        uint256 entryFee,
        uint64 closesAt,
        uint32 minEntries,
        uint32 maxEntries,
        string metric
    );
    event EntrySubmitted(
        uint256 indexed id, address indexed player, uint256 prediction, uint256 entryIndex
    );
    event CompetitionSettled(uint256 indexed id, uint256 finalMetric, uint256 pot);
    event WinnerPaid(
        uint256 indexed id, address indexed player, uint256 rank, uint256 prediction, uint256 amount
    );
    event ArtistPaid(uint256 indexed id, address indexed artist, uint256 amount);
    event PlatformPaid(uint256 indexed id, address indexed treasury, uint256 amount);
    event CompetitionCancelled(uint256 indexed id, uint256 entryCount);
    event Refunded(uint256 indexed id, address indexed player, uint256 amount);
    event PaymentDeferred(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event OracleSet(address indexed oracle);
    event TreasurySet(address indexed treasury);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ----------------------------------------------------------------- errors

    error NotOwner();
    error NotOracle();
    error ZeroAddress();
    error InvalidConfig();
    error SongNotActive();
    error NotOpen();
    error EntriesClosed();
    error StillOpen();
    error CompetitionFull();
    error AlreadyEntered();
    error ArtistAffiliated();
    error TransferFailed();
    error NothingOwed();

    // -------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    constructor(IERC20 usdc_, SongRegistry registry_, address owner_, address oracle_, address treasury_) {
        if (
            address(usdc_) == address(0) || address(registry_) == address(0) || owner_ == address(0)
                || oracle_ == address(0) || treasury_ == address(0)
        ) revert ZeroAddress();
        usdc = usdc_;
        registry = registry_;
        owner = owner_;
        oracle = oracle_;
        treasury = treasury_;
        emit OwnershipTransferred(address(0), owner_);
        emit OracleSet(oracle_);
        emit TreasurySet(treasury_);
    }

    // ------------------------------------------------------------------ admin

    function createCompetition(Config calldata cfg) external onlyOwner returns (uint256 id) {
        if (!registry.isActive(cfg.songId)) revert SongNotActive();
        _validate(cfg);

        id = ++competitionCount;
        Round storage r = _rounds[id];
        // Field-by-field copy keeps us off via-IR for calldata -> storage struct copies.
        r.cfg.songId = cfg.songId;
        r.cfg.entryFee = cfg.entryFee;
        r.cfg.closesAt = cfg.closesAt;
        r.cfg.minEntries = cfg.minEntries;
        r.cfg.maxEntries = cfg.maxEntries;
        r.cfg.artistBps = cfg.artistBps;
        r.cfg.platformBps = cfg.platformBps;
        r.cfg.payoutBps = cfg.payoutBps;
        r.cfg.metric = cfg.metric;
        r.status = Status.Open;

        emit CompetitionCreated(
            id, cfg.songId, cfg.entryFee, cfg.closesAt, cfg.minEntries, cfg.maxEntries, cfg.metric
        );
    }

    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleSet(oracle_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ------------------------------------------------------------------- fans

    /// @notice Enter competition `id` with `prediction`. Caller must have approved `entryFee` USDC.
    function enter(uint256 id, uint256 prediction) external {
        Round storage r = _rounds[id];
        if (r.status != Status.Open) revert NotOpen();
        if (block.timestamp >= r.cfg.closesAt) revert EntriesClosed();
        if (_entries[id].length >= r.cfg.maxEntries) revert CompetitionFull();
        if (hasEntered[id][msg.sender]) revert AlreadyEntered();
        if (registry.isBlocked(r.cfg.songId, msg.sender)) revert ArtistAffiliated();

        hasEntered[id][msg.sender] = true;
        uint256 index = _entries[id].length;
        _entries[id].push(Entry({player: msg.sender, prediction: prediction}));
        r.pot += r.cfg.entryFee;

        if (!usdc.transferFrom(msg.sender, address(this), r.cfg.entryFee)) revert TransferFailed();

        emit EntrySubmitted(id, msg.sender, prediction, index);
    }

    /// @notice Pull any payment that could not be pushed during settlement or refund.
    function withdraw() external {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ----------------------------------------------------------------- oracle

    /// @notice Submit the real metric and settle in one transaction. If fewer than `minEntries`
    ///         entered, the competition is cancelled and everyone is refunded instead.
    function settle(uint256 id, uint256 finalMetric) external onlyOracle {
        Round storage r = _rounds[id];
        if (r.status != Status.Open) revert NotOpen();
        if (block.timestamp < r.cfg.closesAt) revert StillOpen();

        Entry[] storage list = _entries[id];
        if (list.length < r.cfg.minEntries) {
            _cancel(id, r);
            return;
        }

        r.status = Status.Settled;
        r.finalMetric = finalMetric;
        uint256 pot = r.pot;
        emit CompetitionSettled(id, finalMetric, pot);

        // Pick winners: repeated "closest not yet chosen" scan. Strict `<` means ties go to the
        // earlier entry. O(winners * entries), both capped.
        uint256 n = list.length;
        uint256 winners = r.cfg.payoutBps.length;
        bool[] memory chosen = new bool[](n);
        uint256 paid;

        for (uint256 rank = 0; rank < winners; ++rank) {
            uint256 best = type(uint256).max;
            uint256 bestErr = type(uint256).max;
            for (uint256 i = 0; i < n; ++i) {
                if (chosen[i]) continue;
                uint256 err = _absDiff(list[i].prediction, finalMetric);
                if (err < bestErr) {
                    bestErr = err;
                    best = i;
                }
            }
            chosen[best] = true;
            uint256 amount = (pot * r.cfg.payoutBps[rank]) / BPS;
            paid += amount;
            _pay(list[best].player, amount);
            emit WinnerPaid(id, list[best].player, rank + 1, list[best].prediction, amount);
        }

        uint256 platformAmount = (pot * r.cfg.platformBps) / BPS;
        paid += platformAmount;
        _pay(treasury, platformAmount);
        emit PlatformPaid(id, treasury, platformAmount);

        // Artist gets their share plus any rounding dust, so the pot always empties exactly.
        address artist = registry.artistOf(r.cfg.songId);
        uint256 artistAmount = pot - paid;
        _pay(artist, artistAmount);
        emit ArtistPaid(id, artist, artistAmount);
    }

    /// @notice Owner or oracle can cancel an open competition at any time; everyone is refunded.
    function cancel(uint256 id) external {
        if (msg.sender != owner && msg.sender != oracle) revert NotOwner();
        Round storage r = _rounds[id];
        if (r.status != Status.Open) revert NotOpen();
        _cancel(id, r);
    }

    // ------------------------------------------------------------------ views

    function getCompetition(uint256 id)
        external
        view
        returns (Config memory cfg, Status status, uint256 pot, uint256 finalMetric, uint256 numEntries)
    {
        Round storage r = _rounds[id];
        return (r.cfg, r.status, r.pot, r.finalMetric, _entries[id].length);
    }

    function getEntries(uint256 id) external view returns (Entry[] memory) {
        return _entries[id];
    }

    function entryCount(uint256 id) external view returns (uint256) {
        return _entries[id].length;
    }

    // --------------------------------------------------------------- internal

    function _validate(Config calldata cfg) private view {
        uint256 winners = cfg.payoutBps.length;
        if (cfg.entryFee == 0) revert InvalidConfig();
        if (cfg.closesAt <= block.timestamp) revert InvalidConfig();
        if (winners == 0 || winners > MAX_WINNERS) revert InvalidConfig();
        if (cfg.minEntries < winners) revert InvalidConfig(); // every rank must be fillable
        if (cfg.maxEntries < cfg.minEntries || cfg.maxEntries > MAX_ENTRIES) revert InvalidConfig();

        uint256 total = uint256(cfg.artistBps) + cfg.platformBps;
        for (uint256 i = 0; i < winners; ++i) {
            total += cfg.payoutBps[i];
        }
        if (total != BPS) revert InvalidConfig();
    }

    function _cancel(uint256 id, Round storage r) private {
        r.status = Status.Cancelled;
        Entry[] storage list = _entries[id];
        uint256 fee = r.cfg.entryFee;
        emit CompetitionCancelled(id, list.length);
        for (uint256 i = 0; i < list.length; ++i) {
            _pay(list[i].player, fee);
            emit Refunded(id, list[i].player, fee);
        }
    }

    /// @dev Push USDC; if the transfer fails (e.g. Arc blocklist), credit `owed` instead so one bad
    ///      recipient can never block settlement for everyone else.
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory data) =
            address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            owed[to] += amount;
            emit PaymentDeferred(to, amount);
        }
    }

    function _absDiff(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : b - a;
    }
}
