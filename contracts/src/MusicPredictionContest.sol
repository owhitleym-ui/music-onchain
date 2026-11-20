// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RewardCurve} from "./RewardCurve.sol";

/// @notice Native-USDC music prediction contests for Arc Testnet.
/// @dev The authorized oracle attests external view counts. The contract verifies
/// the complete ticket order and calculates all financial allocations itself.
contract MusicPredictionContest is Ownable2Step, ReentrancyGuard {
    uint256 public constant SPOT_PRICE = 5e18;
    uint256 public constant BUNDLE_PRICE = 50e18;
    uint256 public constant FOUR_SPOT_PRICE = 20e18;
    uint256 public constant BUNDLE_RESERVE = 2.5e18;
    uint256 public constant MAX_ORDER_BATCH = 32;
    uint256 public constant MAX_SCAN_BATCH = 32;
    uint256 public constant MAX_PAIR_BATCH = 16;
    uint256 public constant RESULT_GRACE = 48 hours;

    enum Phase { Open, Ordering, TimeRanks, Allocation, Finalized, Cancelled }

    struct Round {
        bytes32 songId;
        string musicId;
        address artist;
        uint64 start;
        bool exists;
    }

    struct Pool {
        uint256 roundId;
        uint8 horizon;
        Phase phase;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 refundAt;
        uint256 spotCount;
        uint256 entryCount;
        uint256 peopleCount;
        uint256 totalDeposits;
        uint256 lockedBonus;
        uint256 actualViews;
        bytes32 evidenceHash;
        uint256 epoch;
        uint256 orderCount;
        uint256 lastTicket;
        uint256 lastError;
        uint256 lastRank;
        uint256 scanCursor;
        uint256 loserCount;
        uint256 pairCursor;
        bool middleCredited;
        uint256 totalReturns;
        uint256 artistFees;
        uint256 appFees;
        uint256 subsidyUsed;
        uint256 claimedReturns;
    }

    struct Entry {
        uint256 roundId;
        uint8 horizon;
        bytes32 pool;
        address payer;
        uint256 guess;
        uint256 paid;
        uint64 purchasedAt;
        uint8 spots;
        uint16 multiplierBps;
        uint256 firstTicketId;
        bool claimed;
    }

    struct Ticket { uint256 entryId; uint8 offset; }

    struct TicketOutcome {
        uint256 mainRank;
        uint256 timeRank;
        bool winner;
        bool neutral;
        uint256 baseWinnings;
        uint256 bonus;
        uint256 loss;
        uint256 artistFee;
        uint256 appFee;
        uint256 reserveContribution;
        uint256 returned;
    }

    struct EntryOutcome {
        uint256 mainRank;
        uint256 winningSpots;
        uint256 losingSpots;
        uint256 neutralSpots;
        uint256 firstTimeRank;
        uint256 lastTimeRank;
        uint256 baseWinnings;
        uint256 bonus;
        uint256 loss;
        uint256 artistFee;
        uint256 appFee;
        uint256 reserveContribution;
        uint256 returned;
    }

    struct PairAmounts {
        uint256 base;
        uint256 bonus;
        uint256 loss;
        uint256 subsidy;
        uint256 artistFee;
        uint256 appFee;
        uint256 winnerReturn;
        uint256 loserReturn;
    }

    error InvalidAddress();
    error InvalidRound();
    error InvalidHorizon();
    error InvalidStart();
    error DuplicateRound();
    error EntriesClosed();
    error WalletNotApproved();
    error ArtistExcluded();
    error InvalidPayment();
    error InsufficientReserve();
    error UnauthorizedOracle();
    error InvalidPhase();
    error ResultTooEarly();
    error SettlementExpired();
    error InvalidBatch();
    error InvalidTicket();
    error InvalidOrder();
    error DuplicateTicket();
    error InvalidEntry();
    error NotPayer();
    error AlreadyClaimed();
    error NotClaimable();
    error RefundTooEarly();
    error TransferFailed();
    error AccountingMismatch();
    error BarePayment();

    event RoundCreated(uint256 indexed roundId, bytes32 indexed songId, string musicId, address indexed artist, uint64 start);
    event WalletApproval(address indexed wallet, bool approved);
    event OracleChanged(address indexed oracle);
    event ExclusionChanged(uint256 indexed roundId, address indexed wallet, bool excluded);
    event EntryRecorded(uint256 indexed entryId, bytes32 indexed pool, address indexed payer, uint256 guess, uint256 paid, uint256 firstTicketId, uint8 spots, uint64 purchasedAt);
    event ResultSubmitted(bytes32 indexed pool, uint256 actualViews, bytes32 evidenceHash);
    event OrderRestarted(bytes32 indexed pool, uint256 epoch);
    event OrderBatchAccepted(bytes32 indexed pool, uint256 epoch, uint256 verified, uint256 total);
    event SettlementProgress(bytes32 indexed pool, Phase phase, uint256 scanCursor, uint256 pairCursor);
    event PoolFinalized(bytes32 indexed pool, uint256 totalReturns, uint256 artistFees, uint256 appFees, uint256 subsidy);
    event PoolCancelled(bytes32 indexed pool, bool timedOut);
    event EntryClaimed(uint256 indexed entryId, address indexed recipient, uint256 amount, bool refund);
    event FeesClaimed(address indexed beneficiary, address indexed recipient, uint256 amount);
    event ReserveFunded(address indexed funder, uint256 amount);
    event ReserveWithdrawn(address indexed recipient, uint256 amount);

    address public oracle;
    address public immutable platformRecipient;
    uint256 public nextRoundId = 1;
    uint256 public nextEntryId = 1;
    uint256 public escrowLiability;
    uint256 public returnLiability;
    uint256 public feeLiability;
    uint256 public bonusReserveBalance;
    uint256 public reservedBonus;
    mapping(address => bool) public walletApproved;
    mapping(address => uint256) public feeCredits;
    mapping(uint256 => mapping(address => bool)) public excluded;
    mapping(bytes32 => bool) private _roundKeys;
    mapping(uint256 => Round) private _rounds;
    mapping(bytes32 => Pool) private _pools;
    mapping(uint256 => Entry) private _entries;
    mapping(bytes32 => mapping(uint256 => Ticket)) private _tickets;
    mapping(bytes32 => uint256[]) private _poolEntries;
    mapping(bytes32 => mapping(address => bool)) private _people;
    // Epoch-scoped scratch records allow O(1) restart/cancellation without deletes.
    mapping(bytes32 => mapping(uint256 => uint256)) private _order;
    mapping(bytes32 => mapping(uint256 => bool)) private _seen;
    mapping(bytes32 => mapping(uint256 => uint256)) private _positions;
    mapping(bytes32 => mapping(uint256 => TicketOutcome)) private _outcomes;
    mapping(bytes32 => mapping(uint256 => EntryOutcome)) private _entryOutcomes;

    constructor(address initialOwner, address initialOracle, address appRecipient) Ownable(initialOwner) {
        if (initialOracle == address(0) || appRecipient == address(0)) revert InvalidAddress();
        oracle = initialOracle;
        platformRecipient = appRecipient;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert UnauthorizedOracle();
        _;
    }

    modifier onlyOrderingOperator() {
        if (msg.sender != oracle && msg.sender != owner()) revert UnauthorizedOracle();
        _;
    }

    function approveWallet(address wallet, bool approved) external onlyOwner {
        if (wallet == address(0)) revert InvalidAddress();
        walletApproved[wallet] = approved;
        emit WalletApproval(wallet, approved);
    }

    function setOracle(address nextOracle) external onlyOwner {
        if (nextOracle == address(0)) revert InvalidAddress();
        oracle = nextOracle;
        emit OracleChanged(nextOracle);
    }

    function createRound(bytes32 songId, string calldata musicId, address artist, uint64 roundStart)
        external onlyOwner returns (uint256 roundId)
    {
        if (songId == bytes32(0) || bytes(musicId).length == 0 || bytes(musicId).length > 128) revert InvalidRound();
        if (artist == address(0)) revert InvalidAddress();
        if (roundStart <= block.timestamp || roundStart % 1 hours != 0 || roundStart > type(uint64).max - 216 hours) revert InvalidStart();
        bytes32 unique = keccak256(abi.encode(songId, roundStart));
        if (_roundKeys[unique]) revert DuplicateRound();
        _roundKeys[unique] = true;
        roundId = nextRoundId++;
        _rounds[roundId] = Round(songId, musicId, artist, roundStart, true);
        for (uint8 h; h < 3; ++h) {
            (uint64 start, uint64 end) = _window(roundStart, h);
            Pool storage pool = _pools[poolId(roundId, h)];
            pool.roundId = roundId;
            pool.horizon = h;
            pool.windowStart = start;
            pool.windowEnd = end;
            pool.refundAt = end + uint64(RESULT_GRACE);
        }
        emit RoundCreated(roundId, songId, musicId, artist, roundStart);
    }

    function setExclusion(uint256 roundId, address wallet, bool value) external onlyOwner {
        Round storage round = _round(roundId);
        if (wallet == address(0)) revert InvalidAddress();
        if (block.timestamp >= round.start) revert EntriesClosed();
        excluded[roundId][wallet] = value;
        emit ExclusionChanged(roundId, wallet, value);
    }

    function enter(uint256 roundId, uint8 horizon, uint256 guess) external payable nonReentrant returns (uint256 entryId) {
        bytes32 id = _entryPool(roundId, horizon);
        bool bundle = msg.value == BUNDLE_PRICE;
        if (!bundle && msg.value != SPOT_PRICE) revert InvalidPayment();
        if (bundle) {
            if (freeBonusReserve() < BUNDLE_RESERVE) revert InsufficientReserve();
            reservedBonus += BUNDLE_RESERVE;
            _pools[id].lockedBonus += BUNDLE_RESERVE;
        }
        return _recordEntry(roundId, horizon, id, guess, msg.value, bundle ? 10 : 1, bundle ? 10500 : 10000);
    }

    /// @notice One atomic payment creates four separate, ordinary entries; no bundle bonus.
    function enterFour(uint256 roundId, uint8 horizon, uint256 guess)
        external payable nonReentrant returns (uint256[4] memory entryIds)
    {
        bytes32 id = _entryPool(roundId, horizon);
        if (msg.value != FOUR_SPOT_PRICE) revert InvalidPayment();
        for (uint256 i; i < 4; ++i) {
            entryIds[i] = _recordEntry(roundId, horizon, id, guess, SPOT_PRICE, 1, 10000);
        }
    }

    function _entryPool(uint256 roundId, uint8 horizon) private view returns (bytes32 id) {
        Round storage round = _round(roundId);
        id = _validPoolId(roundId, horizon);
        if (_pools[id].phase != Phase.Open || block.timestamp < round.start || block.timestamp >= uint256(round.start) + 1 hours) revert EntriesClosed();
        if (!walletApproved[msg.sender]) revert WalletNotApproved();
        if (msg.sender == round.artist || excluded[roundId][msg.sender]) revert ArtistExcluded();
    }

    function _recordEntry(uint256 roundId, uint8 horizon, bytes32 id, uint256 guess, uint256 paid, uint8 spots, uint16 multiplier)
        private returns (uint256 entryId)
    {
        Pool storage pool = _pools[id];
        entryId = nextEntryId++;
        uint256 first = pool.spotCount;
        _entries[entryId] = Entry(roundId, horizon, id, msg.sender, guess, paid, uint64(block.timestamp), spots, multiplier, first, false);
        for (uint8 i; i < spots; ++i) _tickets[id][first + i] = Ticket(entryId, i);
        pool.spotCount += spots;
        pool.entryCount += 1;
        pool.totalDeposits += paid;
        _poolEntries[id].push(entryId);
        if (!_people[id][msg.sender]) { _people[id][msg.sender] = true; ++pool.peopleCount; }
        escrowLiability += paid;
        emit EntryRecorded(entryId, id, msg.sender, guess, paid, first, spots, uint64(block.timestamp));
    }

    function submitResult(uint256 roundId, uint8 horizon, uint256 actualViews, bytes32 evidenceHash) external onlyOracle {
        bytes32 id = _validPoolId(roundId, horizon);
        Pool storage pool = _pools[id];
        if (pool.phase != Phase.Open) revert InvalidPhase();
        if (block.timestamp < pool.windowEnd) revert ResultTooEarly();
        _notExpired(pool);
        pool.actualViews = actualViews;
        pool.evidenceHash = evidenceHash;
        pool.epoch = 1;
        pool.phase = Phase.Ordering;
        emit ResultSubmitted(id, actualViews, evidenceHash);
        if (pool.spotCount == 0) _finalize(id, pool);
    }

    function submitOrder(uint256 roundId, uint8 horizon, uint256[] calldata ticketIds) external onlyOrderingOperator {
        bytes32 id = _validPoolId(roundId, horizon);
        Pool storage pool = _pools[id];
        if (pool.phase != Phase.Ordering) revert InvalidPhase();
        _notExpired(pool);
        if (ticketIds.length == 0 || ticketIds.length > MAX_ORDER_BATCH || pool.orderCount + ticketIds.length > pool.spotCount) revert InvalidBatch();
        bytes32 key = _epochKey(id, pool.epoch);
        for (uint256 i; i < ticketIds.length; ++i) _acceptOrderedTicket(id, key, ticketIds[i]);
        if (pool.orderCount == pool.spotCount) pool.phase = Phase.TimeRanks;
        emit OrderBatchAccepted(id, pool.epoch, pool.orderCount, pool.spotCount);
    }

    function _acceptOrderedTicket(bytes32 id, bytes32 key, uint256 localId) private {
        Pool storage pool = _pools[id];
        if (localId >= pool.spotCount) revert InvalidTicket();
        if (_seen[key][localId]) revert DuplicateTicket();
        uint256 entryId = _tickets[id][localId].entryId;
        uint256 error = _error(_entries[entryId].guess, pool.actualViews);
        if (pool.orderCount != 0 && !_before(id, pool.lastTicket, localId, pool.lastError, error)) revert InvalidOrder();
        if (pool.orderCount == 0 || error != pool.lastError) ++pool.lastRank;
        _seen[key][localId] = true;
        _order[key][pool.orderCount] = localId;
        _positions[key][localId] = pool.orderCount;
        _outcomes[key][localId].mainRank = pool.lastRank;
        _entryOutcomes[key][entryId].mainRank = pool.lastRank;
        ++pool.orderCount;
        pool.lastTicket = localId;
        pool.lastError = error;
    }

    function restartOrder(uint256 roundId, uint8 horizon) external onlyOrderingOperator {
        bytes32 id = _validPoolId(roundId, horizon);
        Pool storage pool = _pools[id];
        if (pool.phase != Phase.Ordering || pool.orderCount == pool.spotCount) revert InvalidPhase();
        _notExpired(pool);
        ++pool.epoch;
        pool.orderCount = 0;
        pool.lastTicket = 0;
        pool.lastError = 0;
        pool.lastRank = 0;
        emit OrderRestarted(id, pool.epoch);
    }

    function advanceSettlement(uint256 roundId, uint8 horizon, uint256 maxSteps) external {
        bytes32 id = _validPoolId(roundId, horizon);
        Pool storage pool = _pools[id];
        _notExpired(pool);
        bytes32 key = _epochKey(id, pool.epoch);
        if (pool.phase == Phase.TimeRanks) {
            if (maxSteps == 0 || maxSteps > MAX_SCAN_BATCH) revert InvalidBatch();
            uint256 stop = _min(pool.scanCursor + maxSteps, pool.spotCount);
            for (uint256 localId = pool.scanCursor; localId < stop; ++localId) {
                if (_positions[key][localId] >= pool.spotCount - pool.spotCount / 2) {
                    uint256 rank = ++pool.loserCount;
                    _outcomes[key][localId].timeRank = rank;
                    EntryOutcome storage entryOutcome = _entryOutcomes[key][_tickets[id][localId].entryId];
                    if (entryOutcome.firstTimeRank == 0) entryOutcome.firstTimeRank = rank;
                    entryOutcome.lastTimeRank = rank;
                }
            }
            pool.scanCursor = stop;
            if (stop == pool.spotCount) pool.phase = Phase.Allocation;
        } else if (pool.phase == Phase.Allocation) {
            if (maxSteps == 0 || maxSteps > MAX_PAIR_BATCH) revert InvalidBatch();
            uint256 pairs = pool.spotCount / 2;
            uint256 stop = _min(pool.pairCursor + maxSteps, pairs);
            for (uint256 i = pool.pairCursor; i < stop; ++i) _allocatePair(id, key, pool, i);
            pool.pairCursor = stop;
            if (stop == pairs) {
                if (pool.spotCount % 2 != 0 && !pool.middleCredited) {
                    uint256 middle = _order[key][pairs];
                    TicketOutcome storage outcome = _outcomes[key][middle];
                    outcome.neutral = true;
                    outcome.returned = SPOT_PRICE;
                    EntryOutcome storage entryOutcome = _entryOutcomes[key][_tickets[id][middle].entryId];
                    ++entryOutcome.neutralSpots;
                    entryOutcome.returned += SPOT_PRICE;
                    pool.totalReturns += SPOT_PRICE;
                    pool.middleCredited = true;
                }
                _finalize(id, pool);
            }
        } else revert InvalidPhase();
        emit SettlementProgress(id, pool.phase, pool.scanCursor, pool.pairCursor);
    }

    function _allocatePair(bytes32 id, bytes32 key, Pool storage pool, uint256 index) private {
        uint256 winner = _order[key][index];
        uint256 loser = _order[key][pool.spotCount - 1 - index];
        TicketOutcome storage won = _outcomes[key][winner];
        TicketOutcome storage lost = _outcomes[key][loser];
        uint256 winnerEntryId = _tickets[id][winner].entryId;
        uint256 loserEntryId = _tickets[id][loser].entryId;
        PairAmounts memory amounts;
        amounts.base = SPOT_PRICE * RewardCurve.ratioWad(won.mainRank, pool.spotCount) / 1e18;
        bool independentWallets = _entries[winnerEntryId].payer != _entries[loserEntryId].payer;
        amounts.bonus = _entries[winnerEntryId].spots == 10 && independentWallets ? amounts.base / 20 : 0;
        uint256 gross = amounts.base + amounts.bonus;
        amounts.loss = _min(gross, SPOT_PRICE);
        amounts.subsidy = gross - amounts.loss;
        amounts.artistFee = gross / 50;
        amounts.appFee = won.mainRank <= 2 ? 0 : gross / 50;
        amounts.winnerReturn = SPOT_PRICE + gross - amounts.artistFee - amounts.appFee;
        amounts.loserReturn = SPOT_PRICE - amounts.loss;
        won.winner = true;
        won.baseWinnings = amounts.base;
        won.bonus = amounts.bonus;
        won.artistFee = amounts.artistFee;
        won.appFee = amounts.appFee;
        won.reserveContribution = amounts.subsidy;
        won.returned = amounts.winnerReturn;
        lost.loss = amounts.loss;
        lost.returned = amounts.loserReturn;
        EntryOutcome storage winningEntry = _entryOutcomes[key][winnerEntryId];
        ++winningEntry.winningSpots;
        winningEntry.baseWinnings += amounts.base;
        winningEntry.bonus += amounts.bonus;
        winningEntry.artistFee += amounts.artistFee;
        winningEntry.appFee += amounts.appFee;
        winningEntry.reserveContribution += amounts.subsidy;
        winningEntry.returned += amounts.winnerReturn;
        EntryOutcome storage losingEntry = _entryOutcomes[key][loserEntryId];
        ++losingEntry.losingSpots;
        losingEntry.loss += amounts.loss;
        losingEntry.returned += amounts.loserReturn;
        pool.totalReturns += amounts.winnerReturn + amounts.loserReturn;
        pool.artistFees += amounts.artistFee;
        pool.appFees += amounts.appFee;
        pool.subsidyUsed += amounts.subsidy;
        if (pool.subsidyUsed > pool.lockedBonus) revert InsufficientReserve();
    }

    function _finalize(bytes32 id, Pool storage pool) private {
        if (pool.orderCount != pool.spotCount || pool.scanCursor != pool.spotCount || pool.pairCursor != pool.spotCount / 2 || (pool.spotCount % 2 != 0 && !pool.middleCredited)) revert AccountingMismatch();
        if (pool.totalReturns + pool.artistFees + pool.appFees != pool.totalDeposits + pool.subsidyUsed || pool.subsidyUsed > pool.lockedBonus) revert AccountingMismatch();
        pool.phase = Phase.Finalized;
        escrowLiability -= pool.totalDeposits;
        returnLiability += pool.totalReturns;
        feeLiability += pool.artistFees + pool.appFees;
        feeCredits[_rounds[pool.roundId].artist] += pool.artistFees;
        feeCredits[platformRecipient] += pool.appFees;
        bonusReserveBalance -= pool.subsidyUsed;
        reservedBonus -= pool.lockedBonus;
        pool.lockedBonus = 0;
        emit PoolFinalized(id, pool.totalReturns, pool.artistFees, pool.appFees, pool.subsidyUsed);
    }

    function cancelPool(uint256 roundId, uint8 horizon) external onlyOwner {
        bytes32 id = _validPoolId(roundId, horizon);
        _cancel(id, _pools[id], false);
    }

    function activateRefunds(uint256 roundId, uint8 horizon) external {
        bytes32 id = _validPoolId(roundId, horizon);
        Pool storage pool = _pools[id];
        if (block.timestamp < pool.refundAt) revert RefundTooEarly();
        _cancel(id, pool, true);
    }

    function _cancel(bytes32 id, Pool storage pool, bool timedOut) private {
        if (pool.phase == Phase.Finalized || pool.phase == Phase.Cancelled) revert InvalidPhase();
        pool.phase = Phase.Cancelled;
        reservedBonus -= pool.lockedBonus;
        pool.lockedBonus = 0;
        pool.totalReturns = 0;
        pool.artistFees = 0;
        pool.appFees = 0;
        pool.subsidyUsed = 0;
        emit PoolCancelled(id, timedOut);
    }

    function claimEntry(uint256 entryId, address payable recipient) external nonReentrant returns (uint256 amount) {
        Entry storage entry = _entry(entryId);
        if (msg.sender != entry.payer) revert NotPayer();
        if (entry.claimed) revert AlreadyClaimed();
        if (recipient == address(0)) revert InvalidAddress();
        Pool storage pool = _pools[entry.pool];
        if (pool.phase != Phase.Finalized && pool.phase != Phase.Cancelled && block.timestamp >= pool.refundAt) _cancel(entry.pool, pool, true);
        bool refund = pool.phase == Phase.Cancelled;
        if (refund) { amount = entry.paid; escrowLiability -= amount; }
        else if (pool.phase == Phase.Finalized) {
            amount = _entryOutcomes[_epochKey(entry.pool, pool.epoch)][entryId].returned;
            returnLiability -= amount;
        } else revert NotClaimable();
        entry.claimed = true;
        pool.claimedReturns += amount;
        _send(recipient, amount);
        emit EntryClaimed(entryId, recipient, amount, refund);
    }

    function claimFees(address payable recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        amount = feeCredits[msg.sender];
        if (amount == 0) revert NotClaimable();
        feeCredits[msg.sender] = 0;
        feeLiability -= amount;
        _send(recipient, amount);
        emit FeesClaimed(msg.sender, recipient, amount);
    }

    function fundBonusReserve() external payable nonReentrant {
        if (msg.value == 0) revert InvalidPayment();
        bonusReserveBalance += msg.value;
        emit ReserveFunded(msg.sender, msg.value);
    }

    function withdrawFreeReserve(uint256 amount, address payable recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0 || amount > freeBonusReserve()) revert InsufficientReserve();
        bonusReserveBalance -= amount;
        _send(recipient, amount);
        emit ReserveWithdrawn(recipient, amount);
    }

    function poolId(uint256 roundId, uint8 horizon) public pure returns (bytes32) {
        return keccak256(abi.encode(roundId, horizon));
    }

    function getRound(uint256 roundId) external view returns (Round memory) { return _round(roundId); }
    function getPool(uint256 roundId, uint8 horizon) external view returns (Pool memory) { return _pools[_validPoolId(roundId, horizon)]; }
    function getEntry(uint256 entryId) external view returns (Entry memory) { return _entry(entryId); }

    function getTicket(uint256 roundId, uint8 horizon, uint256 localId) external view returns (Ticket memory) {
        bytes32 id = _validPoolId(roundId, horizon);
        if (localId >= _pools[id].spotCount) revert InvalidTicket();
        return _tickets[id][localId];
    }

    function getTicketOutcome(uint256 roundId, uint8 horizon, uint256 localId) external view returns (TicketOutcome memory) {
        bytes32 id = _validPoolId(roundId, horizon);
        Pool storage pool = _pools[id];
        if (pool.phase != Phase.Finalized) revert NotClaimable();
        if (localId >= pool.spotCount) revert InvalidTicket();
        return _outcomes[_epochKey(id, pool.epoch)][localId];
    }

    function getEntryOutcome(uint256 entryId) external view returns (EntryOutcome memory) {
        Entry storage entry = _entry(entryId);
        Pool storage pool = _pools[entry.pool];
        if (pool.phase != Phase.Finalized) revert NotClaimable();
        return _entryOutcomes[_epochKey(entry.pool, pool.epoch)][entryId];
    }

    function getPoolEntries(uint256 roundId, uint8 horizon, uint256 offset, uint256 limit) external view returns (uint256[] memory ids) {
        bytes32 id = _validPoolId(roundId, horizon);
        if (limit > 100 || offset > _poolEntries[id].length) revert InvalidBatch();
        uint256 stop = _min(offset + limit, _poolEntries[id].length);
        ids = new uint256[](stop - offset);
        for (uint256 i = offset; i < stop; ++i) ids[i - offset] = _poolEntries[id][i];
    }

    function claimable(uint256 entryId) external view returns (uint256) {
        Entry storage entry = _entry(entryId);
        if (entry.claimed) return 0;
        Pool storage pool = _pools[entry.pool];
        if (pool.phase == Phase.Cancelled || (pool.phase != Phase.Finalized && block.timestamp >= pool.refundAt)) return entry.paid;
        if (pool.phase == Phase.Finalized) return _entryOutcomes[_epochKey(entry.pool, pool.epoch)][entryId].returned;
        return 0;
    }

    function freeBonusReserve() public view returns (uint256) { return bonusReserveBalance - reservedBonus; }
    function accountedBalance() public view returns (uint256) { return escrowLiability + returnLiability + feeLiability + bonusReserveBalance; }
    function isSolvent() external view returns (bool) { return address(this).balance >= accountedBalance() && bonusReserveBalance >= reservedBonus; }
    function transferRate(uint256 rank, uint256 spots) external pure returns (uint256) { return RewardCurve.ratioWad(rank, spots); }

    function _round(uint256 roundId) private view returns (Round storage round) {
        round = _rounds[roundId];
        if (!round.exists) revert InvalidRound();
    }

    function _entry(uint256 entryId) private view returns (Entry storage entry) {
        entry = _entries[entryId];
        if (entry.payer == address(0)) revert InvalidEntry();
    }

    function _validPoolId(uint256 roundId, uint8 horizon) private view returns (bytes32) {
        if (horizon > 2) revert InvalidHorizon();
        _round(roundId);
        return poolId(roundId, horizon);
    }

    function _epochKey(bytes32 id, uint256 epoch) private pure returns (bytes32) { return keccak256(abi.encode(id, epoch)); }
    function _error(uint256 guess, uint256 actual) private pure returns (uint256) { return guess >= actual ? guess - actual : actual - guess; }
    function _min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }

    function _before(bytes32 id, uint256 left, uint256 right, uint256 leftError, uint256 rightError) private view returns (bool) {
        if (leftError != rightError) return leftError < rightError;
        Ticket storage a = _tickets[id][left];
        Ticket storage b = _tickets[id][right];
        Entry storage ea = _entries[a.entryId];
        Entry storage eb = _entries[b.entryId];
        if (ea.purchasedAt != eb.purchasedAt) return ea.purchasedAt < eb.purchasedAt;
        if (a.entryId != b.entryId) return a.entryId < b.entryId;
        return a.offset < b.offset;
    }

    function _window(uint64 start, uint8 horizon) private pure returns (uint64 from, uint64 to) {
        if (horizon == 0) return (start, start + 24 hours);
        if (horizon == 1) return (start + 24 hours, start + 48 hours);
        return (start + 144 hours, start + 168 hours);
    }

    function _notExpired(Pool storage pool) private view {
        if (block.timestamp >= pool.refundAt) revert SettlementExpired();
    }

    function _send(address payable recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    receive() external payable { revert BarePayment(); }
    fallback() external payable { revert BarePayment(); }
}
