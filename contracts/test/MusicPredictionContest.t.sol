// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MusicPredictionContest as Contest} from "../src/MusicPredictionContest.sol";
import {CurveReference} from "./fixtures/CurveReference.sol";
import {LegacyRewardCurve} from "./fixtures/LegacyRewardCurve.sol";

contract ClaimReceiver {
    Contest public immutable contest;
    bool public rejecting;
    bool public reentering;
    uint256 public targetEntry;
    uint256 public attempts;

    constructor(Contest target) { contest = target; }
    function configure(bool rejectTransfer, bool reenter, uint256 entry) external {
        rejecting = rejectTransfer; reentering = reenter; targetEntry = entry;
    }
    function claim(uint256 entry, address payable recipient) external { contest.claimEntry(entry, recipient); }
    receive() external payable {
        require(!rejecting, "receiver rejects transfer");
        if (reentering) {
            attempts++;
            try contest.claimEntry(targetEntry, payable(address(this))) {} catch {}
        }
    }
}

contract MusicPredictionContestTest is Test {
    Contest internal contest;
    address internal oracle;
    address internal artist;
    address internal platform;
    address internal alice;
    address internal bob;
    address internal carol;
    address internal dave;
    address internal eve;
    uint64 internal start;
    uint256 internal round;
    uint256 internal constant SPOT = 5e18;
    uint256 internal constant BUNDLE = 50e18;

    function setUp() public {
        vm.warp(2_000_000_000);
        oracle = makeAddr("oracle"); artist = makeAddr("artist"); platform = makeAddr("platform");
        alice = makeAddr("alice"); bob = makeAddr("bob"); carol = makeAddr("carol"); dave = makeAddr("dave"); eve = makeAddr("eve");
        contest = new Contest(address(this), oracle, platform);
        vm.deal(address(this), 1_000_000e18);
        for (uint256 i; i < 5; i++) contest.approveWallet(_actor(i), true);
        start = uint64((block.timestamp / 1 hours + 1) * 1 hours);
        round = contest.createRound(keccak256("animals"), "tiktok-music-123", artist, start);
    }

    function _actor(uint256 index) internal view returns (address) {
        if (index == 0) return alice;
        if (index == 1) return bob;
        if (index == 2) return carol;
        if (index == 3) return dave;
        return eve;
    }

    function _buy(address payer, uint256 guess, bool bundle, uint8 horizon) internal returns (uint256) {
        uint256 value = bundle ? BUNDLE : SPOT;
        vm.deal(payer, payer.balance + value);
        vm.prank(payer);
        return contest.enter{value: value}(round, horizon, guess);
    }

    function _end(uint8 horizon) internal view returns (uint256) {
        return uint256(start) + (horizon == 0 ? 24 hours : horizon == 1 ? 48 hours : 168 hours);
    }

    function _result(uint8 horizon, uint256 actual) internal {
        vm.warp(_end(horizon));
        vm.prank(oracle);
        contest.submitResult(round, horizon, actual, keccak256("sample oracle evidence"));
    }

    function _order(uint8 horizon, uint256[] memory ids) internal {
        for (uint256 offset; offset < ids.length; offset += 32) {
            uint256 length = ids.length - offset > 32 ? 32 : ids.length - offset;
            uint256[] memory batch = new uint256[](length);
            for (uint256 i; i < length; i++) batch[i] = ids[offset + i];
            vm.prank(oracle); contest.submitOrder(round, horizon, batch);
        }
    }

    function _drive(uint8 horizon, uint256 size) internal returns (uint256 maxGas) {
        uint256 guard;
        while (contest.getPool(round, horizon).phase != Contest.Phase.Finalized) {
            Contest.Phase phase = contest.getPool(round, horizon).phase;
            uint256 limit = phase == Contest.Phase.Allocation && size > 16 ? 16 : size;
            uint256 beforeGas = gasleft();
            contest.advanceSettlement(round, horizon, limit);
            uint256 used = beforeGas - gasleft();
            if (used > maxGas) maxGas = used;
            _solvent();
            require(++guard < 10_000, "settlement made no progress");
        }
    }

    function _settle(uint8 horizon, uint256 actual, uint256[] memory ids) internal {
        _result(horizon, actual); _order(horizon, ids); _drive(horizon, 32);
    }

    function _ids(uint256 count) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](count); for (uint256 i; i < count; i++) ids[i] = i;
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2); ids[0] = a; ids[1] = b;
    }

    function _solvent() internal view {
        assertTrue(contest.isSolvent());
        assertGe(address(contest).balance, contest.accountedBalance());
        assertLe(contest.reservedBonus(), contest.bonusReserveBalance());
    }

    function testPricesAndMeasurementWindows() public view {
        assertEq(contest.SPOT_PRICE(), SPOT); assertEq(contest.BUNDLE_PRICE(), BUNDLE);
        assertEq(contest.BUNDLE_RESERVE(), 2.5e18);
        for (uint8 h; h < 3; h++) {
            Contest.Pool memory p = contest.getPool(round, h);
            assertEq(p.windowStart, uint256(start) + (h == 0 ? 0 : h == 1 ? 24 hours : 144 hours));
            assertEq(p.windowEnd, _end(h)); assertEq(p.refundAt, _end(h) + 48 hours);
        }
    }

    function testOnlyAdministratorControlsConfiguration() public {
        vm.startPrank(alice);
        vm.expectRevert(); contest.approveWallet(bob, false);
        vm.expectRevert(); contest.setOracle(alice);
        vm.expectRevert(); contest.setExclusion(round, bob, true);
        vm.expectRevert(); contest.createRound(keccak256("other"), "music", artist, start);
        vm.stopPrank();
        vm.expectRevert(); contest.setOracle(address(0));
        vm.expectRevert(); contest.createRound(keccak256("bad"), "music", artist, start + 1);
        vm.expectRevert(); contest.createRound(keccak256("animals"), "other", artist, start);
    }

    function testEntryRequiresApprovedWalletAndExcludesArtistTeam() public {
        contest.approveWallet(artist, true);
        contest.setExclusion(round, bob, true);
        vm.warp(start);
        vm.deal(address(0xBAD), SPOT);
        vm.prank(address(0xBAD)); vm.expectRevert(); contest.enter{value: SPOT}(round, 0, 0);
        vm.deal(artist, SPOT);
        vm.prank(artist); vm.expectRevert(); contest.enter{value: SPOT}(round, 0, 0);
        vm.deal(bob, SPOT);
        vm.prank(bob); vm.expectRevert(); contest.enter{value: SPOT}(round, 0, 0);
        vm.expectRevert(); contest.setExclusion(round, alice, true);
        assertEq(contest.getPool(round, 0).spotCount, 0);
    }

    function testEntryTimeAndPaymentBoundaries() public {
        vm.deal(alice, 100e18);
        vm.prank(alice); vm.expectRevert(); contest.enter{value: SPOT}(round, 0, 0);
        vm.warp(start);
        for (uint256 i; i < 4; i++) {
            uint256 value = i == 0 ? 0 : i == 1 ? SPOT - 1 : i == 2 ? SPOT + 1 : 100e18;
            vm.prank(alice); vm.expectRevert(); contest.enter{value: value}(round, 0, 0);
        }
        vm.prank(alice); vm.expectRevert(); contest.enter{value: SPOT}(round, 3, 0);
        vm.prank(alice); vm.expectRevert(); contest.enter{value: SPOT}(999, 0, 0);
        _buy(alice, 0, false, 0);
        vm.warp(uint256(start) + 1 hours - 1); _buy(alice, type(uint256).max, false, 0);
        vm.warp(uint256(start) + 1 hours);
        vm.prank(alice); vm.expectRevert(); contest.enter{value: SPOT}(round, 0, 0);
        assertEq(contest.getPool(round, 0).spotCount, 2);
    }

    function testBundleRecordsTenIdenticalSpotsAndCountsPeopleOnce() public {
        contest.fundBonusReserve{value: 2.5e18}(); vm.warp(start);
        uint256 first = _buy(alice, 55_000, true, 0);
        uint256 second = _buy(alice, 55_001, false, 0);
        Contest.Entry memory entry = contest.getEntry(first);
        assertEq(entry.payer, alice); assertEq(entry.guess, 55_000); assertEq(entry.paid, BUNDLE);
        assertEq(entry.spots, 10); assertEq(entry.multiplierBps, 10_500); assertEq(entry.firstTicketId, 0);
        assertEq(contest.getEntry(second).firstTicketId, 10);
        for (uint256 i; i < 10; i++) {
            Contest.Ticket memory ticket = contest.getTicket(round, 0, i);
            assertEq(ticket.entryId, first); assertEq(ticket.offset, i);
        }
        Contest.Pool memory pool = contest.getPool(round, 0);
        assertEq(pool.spotCount, 11); assertEq(pool.entryCount, 2); assertEq(pool.peopleCount, 1);
        assertEq(pool.totalDeposits, 55e18); assertEq(pool.lockedBonus, 2.5e18); _solvent();
    }

    function testBundleRejectedWithoutReserveAndOtherPoolsCannotReuseEarmark() public {
        vm.warp(start);
        vm.deal(alice, BUNDLE);
        vm.prank(alice); vm.expectRevert(); contest.enter{value: BUNDLE}(round, 0, 0);
        assertEq(contest.getPool(round, 0).spotCount, 0);
        contest.fundBonusReserve{value: 2.5e18}();
        _buy(alice, 1, true, 0);
        vm.deal(bob, BUNDLE);
        vm.prank(bob); vm.expectRevert(); contest.enter{value: BUNDLE}(round, 1, 1);
        assertEq(contest.freeBonusReserve(), 0);
        contest.cancelPool(round, 0);
        _buy(bob, 1, true, 1);
        assertEq(contest.reservedBonus(), 2.5e18); _solvent();
    }

    function testFinalizingAndClaimingOnePoolPreservesOtherPoolReserveAndEscrow() public {
        contest.fundBonusReserve{value:5e18}();vm.warp(start);
        uint256 first=_buy(alice,100,true,0);for(uint256 i;i<10;i++)_buy(bob,200+i,false,0);
        uint256 second=_buy(carol,300,true,1);uint256 secondOther=_buy(dave,400,false,1);
        _settle(0,100,_ids(20));
        assertEq(contest.bonusReserveBalance(),5e18);assertEq(contest.reservedBonus(),2.5e18);
        assertEq(contest.freeBonusReserve(),2.5e18);assertEq(contest.escrowLiability(),55e18);
        vm.prank(alice);contest.claimEntry(first,payable(alice));_solvent();
        vm.expectRevert();contest.withdrawFreeReserve(2.5e18+1,payable(eve));
        for(uint256 id=2;id<=11;id++){vm.prank(bob);contest.claimEntry(id,payable(bob));}
        contest.cancelPool(round,1);
        vm.prank(carol);contest.claimEntry(second,payable(carol));
        vm.prank(dave);contest.claimEntry(secondOther,payable(dave));
        contest.withdrawFreeReserve(5e18,payable(eve));
        vm.prank(artist);contest.claimFees(payable(artist));
        assertEq(address(contest).balance,0);_solvent();
    }

    function testResultPermissionsWindowZeroAndImmutability() public {
        vm.warp(start); _buy(alice, 0, false, 0);
        vm.prank(oracle); vm.expectRevert(); contest.submitResult(round, 0, 0, bytes32(0));
        vm.warp(_end(0));
        vm.prank(alice); vm.expectRevert(); contest.submitResult(round, 0, 0, bytes32(0));
        vm.prank(oracle); contest.submitResult(round, 0, 0, bytes32(0));
        assertEq(contest.getPool(round, 0).actualViews, 0);
        vm.prank(oracle); vm.expectRevert(); contest.submitResult(round, 0, 1, bytes32(0));
    }

    function testExtremeViewValuesUseUnsignedAbsoluteErrorWithoutOverflow() public {
        vm.warp(start);_buy(alice,type(uint256).max,false,0);uint256 winner=_buy(bob,0,false,0);
        _settle(0,0,_two(1,0));assertEq(contest.claimable(winner),9.41e18);_solvent();
    }

    function testSingleWinnerAndLoserFeesClaimsAndRevocation() public {
        vm.warp(start); uint256 winner = _buy(alice, 100, false, 0); uint256 loser = _buy(bob, 110, false, 0);
        _settle(0, 100, _ids(2));
        assertEq(contest.claimable(winner), 9.41e18); assertEq(contest.claimable(loser), .5e18);
        assertEq(contest.feeCredits(artist), .09e18); assertEq(contest.feeCredits(platform), 0);
        assertEq(contest.returnLiability(), 9.91e18); assertEq(contest.feeLiability(), .09e18);
        contest.approveWallet(alice, false);
        uint256 before = alice.balance;
        vm.prank(alice); contest.claimEntry(winner, payable(alice));
        assertEq(alice.balance - before, 9.41e18);
        vm.prank(alice); vm.expectRevert(); contest.claimEntry(winner, payable(alice));
        vm.prank(bob); vm.expectRevert(); contest.claimEntry(winner, payable(bob));
        before = artist.balance; vm.prank(artist); contest.claimFees(payable(artist));
        assertEq(artist.balance - before, .09e18); _solvent();
    }

    function testFullyWinningBundleMatchesScaled96Point305Return() public {
        contest.fundBonusReserve{value: 2.5e18}(); vm.warp(start);
        uint256 winningBundle = _buy(alice, 100, true, 0);
        for (uint256 i; i < 10; i++) _buy(bob, 200 + i, false, 0);
        _settle(0, 100, _ids(20));
        Contest.EntryOutcome memory outcome = contest.getEntryOutcome(winningBundle);
        assertEq(outcome.mainRank, 1); assertEq(outcome.winningSpots, 10);
        assertEq(outcome.baseWinnings, 45e18); assertEq(outcome.bonus, 2.25e18);
        assertEq(outcome.artistFee, .945e18); assertEq(outcome.appFee, 0);
        assertEq(outcome.reserveContribution, 0); assertEq(outcome.returned, 96.305e18);
        assertEq(contest.getPool(round,0).subsidyUsed,0);
        for(uint256 id=2;id<=11;id++)assertEq(contest.claimable(id),.275e18);
        assertEq(contest.bonusReserveBalance(), 2.5e18); assertEq(contest.reservedBonus(), 0); _solvent();
    }

    function testSingleBundleCannotEarnReserveBonusAgainstItsOwnSpots() public {
        contest.fundBonusReserve{value:2.5e18}();vm.warp(start);
        uint256 id=_buy(alice,100,true,0);_settle(0,100,_ids(10));
        Contest.EntryOutcome memory outcome=contest.getEntryOutcome(id);
        assertEq(outcome.winningSpots,5);assertEq(outcome.losingSpots,5);
        assertEq(outcome.reserveContribution,0);assertEq(outcome.artistFee,.45e18);
        assertEq(outcome.bonus,0);assertEq(outcome.returned,49.55e18);
        assertEq(contest.freeBonusReserve(),2.5e18);_solvent();
    }

    function testSamePayerAcrossDistinctPurchasesAlsoHasNoBundleBonus() public {
        contest.fundBonusReserve{value:2.5e18}();vm.warp(start);
        uint256 first=_buy(alice,100,true,0);_buy(alice,200,false,0);_settle(0,100,_ids(11));
        Contest.EntryOutcome memory outcome=contest.getEntryOutcome(first);
        assertEq(outcome.bonus,0);assertEq(outcome.reserveContribution,0);
        assertEq(outcome.artistFee,.45e18);assertEq(outcome.returned,54.05e18);
        assertEq(contest.freeBonusReserve(),2.5e18);_solvent();
    }

    function testMixedBundlePairsOnlyRewardDifferentPayerMatches() public {
        contest.fundBonusReserve{value:2.5e18}();vm.warp(start);
        uint256 first=_buy(alice,100,true,0);_buy(bob,200,false,0);_settle(0,100,_ids(11));
        Contest.EntryOutcome memory outcome=contest.getEntryOutcome(first);
        assertEq(outcome.bonus,.225e18);assertEq(outcome.reserveContribution,0);
        assertEq(outcome.artistFee,.4545e18);assertEq(outcome.returned,54.2705e18);
        assertEq(contest.getTicketOutcome(round,0,0).bonus,.225e18);
        for(uint256 i=1;i<5;i++)assertEq(contest.getTicketOutcome(round,0,i).bonus,0);
        _solvent();
    }

    function testDenseAccuracyRanksAndEarlierBoundaryTie() public {
        vm.warp(start);
        _buy(alice, 99, false, 0); _buy(bob, 101, false, 0); _buy(carol, 99, false, 0); _buy(dave, 103, false, 0);
        _settle(0, 100, _ids(4));
        for (uint256 i; i < 3; i++) assertEq(contest.getTicketOutcome(round, 0, i).mainRank, 1);
        assertEq(contest.getTicketOutcome(round, 0, 3).mainRank, 2);
        assertTrue(contest.getTicketOutcome(round, 0, 0).winner);
        assertTrue(contest.getTicketOutcome(round, 0, 1).winner);
        assertFalse(contest.getTicketOutcome(round, 0, 2).winner);
    }

    function testSameTimestampUsesPurchaseIdAndBundleOffset() public {
        contest.fundBonusReserve{value: 2.5e18}(); vm.warp(start);
        _buy(alice, 100, true, 0); _buy(bob, 100, false, 0);
        _settle(0, 100, _ids(11));
        for (uint256 i; i < 11; i++) {
            Contest.TicketOutcome memory t = contest.getTicketOutcome(round, 0, i);
            assertEq(t.mainRank, 1);
            assertEq(t.winner, i < 5); assertEq(t.neutral, i == 5);
        }
        assertEq(contest.getTicketOutcome(round, 0, 6).timeRank, 1);
        assertEq(contest.getTicketOutcome(round, 0, 10).timeRank, 5);
    }

    function testBestWinnerIsFundedByWorstAccuracyNotLatestLoser() public {
        vm.warp(start);
        _buy(alice, 100, false, 0); _buy(bob, 101, false, 0);
        _buy(carol, 200, false, 0); vm.warp(uint256(start) + 1); _buy(dave, 102, false, 0);
        _settle(0, 100, _four(0, 1, 3, 2));
        assertEq(contest.getTicketOutcome(round, 0, 2).loss, 4.5e18);
        assertLt(contest.getTicketOutcome(round, 0, 3).loss, SPOT);
        assertEq(contest.getTicketOutcome(round, 0, 2).timeRank, 1);
        assertEq(contest.getTicketOutcome(round, 0, 3).timeRank, 2);
    }

    function _four(uint256 a,uint256 b,uint256 c,uint256 d) internal pure returns(uint256[] memory ids) {
        ids = new uint256[](4); ids[0]=a;ids[1]=b;ids[2]=c;ids[3]=d;
    }

    function testOddMiddleAndZeroOrSingleEntryHaveNoUnfundedWinnings() public {
        vm.warp(start);
        uint256 first = _buy(alice, 100, false, 0);
        uint256 middle = _buy(bob, 101, false, 0);
        _buy(carol, 102, false, 0);
        uint256 single = _buy(dave, 0, false, 1);
        _settle(0, 100, _ids(3));
        assertEq(contest.claimable(middle), SPOT); assertTrue(contest.getTicketOutcome(round, 0, 1).neutral);
        assertEq(contest.claimable(first), 9.41e18);
        _settle(1, 0, _ids(1)); assertEq(contest.claimable(single), SPOT);
        _settle(2, 0, _ids(0)); assertEq(contest.getPool(round, 2).totalReturns, 0); _solvent();
    }

    function testThirdDenseGroupPaysBothFees() public {
        vm.warp(start); for (uint256 i; i < 6; i++) _buy(_actor(i % 5), 100 + i, false, 0);
        _settle(0, 100, _ids(6));
        assertEq(contest.getTicketOutcome(round, 0, 0).appFee, 0);
        assertEq(contest.getTicketOutcome(round, 0, 1).appFee, 0);
        Contest.TicketOutcome memory third = contest.getTicketOutcome(round, 0, 2);
        assertEq(third.mainRank, 3); assertGt(third.appFee, 0); assertEq(third.appFee, third.artistFee);
        assertEq(third.appFee, (third.baseWinnings + third.bonus) / 50); _solvent();
    }

    function testOrderRejectsInvalidDuplicatesOutOfOrderAndUnauthorized() public {
        vm.warp(start); _buy(alice, 100, false, 0); _buy(bob, 101, false, 0);
        _result(0, 100);
        vm.prank(alice); vm.expectRevert(); contest.submitOrder(round, 0, _ids(2));
        vm.prank(oracle); vm.expectRevert(); contest.submitOrder(round, 0, new uint256[](0));
        vm.prank(oracle); vm.expectRevert(); contest.submitOrder(round, 0, _ids(33));
        vm.prank(oracle); vm.expectRevert(); contest.submitOrder(round, 0, _two(0, 2));
        vm.prank(oracle); vm.expectRevert(); contest.submitOrder(round, 0, _two(0, 0));
        vm.prank(oracle); vm.expectRevert(); contest.submitOrder(round, 0, _two(1, 0));
        assertEq(contest.getPool(round, 0).orderCount, 0);
    }

    function testIncompleteOrderCannotPayAndCanRestartWithoutStaleRanks() public {
        vm.warp(start); uint256 first = _buy(alice, 100, false, 0); _buy(bob, 101, false, 0);
        _result(0, 100);
        uint256[] memory one = new uint256[](1); one[0] = 1;
        vm.prank(oracle); contest.submitOrder(round, 0, one);
        assertEq(contest.claimable(first), 0);
        vm.expectRevert(); contest.advanceSettlement(round, 0, 1);
        uint256 epoch = contest.getPool(round, 0).epoch;
        vm.prank(oracle); contest.restartOrder(round, 0);
        assertGt(contest.getPool(round, 0).epoch, epoch); assertEq(contest.getPool(round, 0).orderCount, 0);
        _order(0, _ids(2)); _drive(0, 1);
        assertEq(contest.claimable(first), 9.41e18);
        vm.prank(oracle); vm.expectRevert(); contest.restartOrder(round, 0);
    }

    function testStagedCreditsCannotBeClaimedAndCancellationDiscardsThem() public {
        vm.warp(start); uint256 first = _buy(alice, 100, false, 0); _buy(bob, 101, false, 0); _buy(carol, 102, false, 0); _buy(dave, 103, false, 0);
        _result(0, 100); _order(0, _ids(4));
        while (contest.getPool(round, 0).phase == Contest.Phase.TimeRanks) contest.advanceSettlement(round, 0, 32);
        contest.advanceSettlement(round, 0, 1);
        assertEq(uint256(contest.getPool(round, 0).phase), uint256(Contest.Phase.Allocation));
        assertEq(contest.claimable(first), 0); assertEq(contest.feeCredits(artist), 0);
        vm.prank(alice); vm.expectRevert(); contest.claimEntry(first, payable(alice));
        contest.cancelPool(round, 0);
        assertEq(contest.claimable(first), SPOT); assertEq(contest.feeCredits(artist), 0);
        vm.expectRevert(); contest.advanceSettlement(round, 0, 1);
        vm.prank(alice); contest.claimEntry(first, payable(alice)); _solvent();
    }

    function testTimeoutRefundsAtBoundaryDoNotExpireAndStopLateResults() public {
        vm.warp(start); uint256 id = _buy(alice, 0, false, 0);
        vm.warp(_end(0) + 48 hours - 1); vm.expectRevert(); contest.activateRefunds(round, 0);
        vm.warp(_end(0) + 48 hours);
        vm.prank(oracle); vm.expectRevert(); contest.submitResult(round, 0, 0, bytes32(0));
        vm.prank(bob); contest.activateRefunds(round, 0);
        vm.warp(block.timestamp + 365 days);
        contest.approveWallet(alice, false);
        uint256 before = alice.balance; vm.prank(alice); contest.claimEntry(id, payable(alice));
        assertEq(alice.balance - before, SPOT); _solvent();
    }

    function testTimeoutAlsoCancelsInterruptedSettlementAndReleasesReserve() public {
        contest.fundBonusReserve{value: 2.5e18}(); vm.warp(start);
        uint256 id = _buy(alice, 100, true, 0); _buy(bob, 200, false, 0);
        _result(0, 100);
        vm.warp(_end(0) + 48 hours);
        contest.activateRefunds(round, 0);
        assertEq(contest.claimable(id), BUNDLE); assertEq(contest.freeBonusReserve(), 2.5e18);
        vm.expectRevert(); contest.submitOrder(round, 0, _ids(11));
        assertEq(contest.feeLiability(), 0); _solvent();
    }

    function testFinalizedPoolsCannotCancelOrRefundAtLaterTimeout() public {
        vm.warp(start); _buy(alice, 100, false, 0); _buy(bob, 101, false, 0); _settle(0, 100, _ids(2));
        vm.expectRevert(); contest.cancelPool(round, 0);
        vm.warp(_end(0) + 48 hours); vm.expectRevert(); contest.activateRefunds(round, 0);
    }

    function testTimeoutDuringAllocationDiscardsStagedFeesAndAutoRefundsOnClaim() public {
        vm.warp(start);
        uint256 first = _buy(alice, 100, false, 0);
        for (uint256 i=1;i<6;i++) _buy(_actor(i%5),100+i,false,0);
        _result(0,100); _order(0,_ids(6));
        contest.advanceSettlement(round,0,32);
        contest.advanceSettlement(round,0,1);
        assertGt(contest.getPool(round,0).artistFees,0);
        vm.warp(_end(0)+48 hours);
        vm.expectRevert(); contest.advanceSettlement(round,0,1);
        vm.prank(alice); contest.claimEntry(first,payable(alice));
        assertEq(uint256(contest.getPool(round,0).phase),uint256(Contest.Phase.Cancelled));
        assertEq(contest.getPool(round,0).artistFees,0);
        assertEq(contest.feeCredits(artist),0); _solvent();
    }

    function testProgressRequiresBoundedNonzeroWorkAndCannotRepeatFinalization() public {
        vm.warp(start); _buy(alice,100,false,0); _buy(bob,101,false,0);
        _result(0,100); _order(0,_ids(2));
        vm.expectRevert(); contest.advanceSettlement(round,0,0);
        vm.expectRevert(); contest.advanceSettlement(round,0,33);
        contest.advanceSettlement(round,0,32);
        vm.expectRevert(); contest.advanceSettlement(round,0,17);
        contest.advanceSettlement(round,0,16);
        uint256 artistCredit=contest.feeCredits(artist);
        vm.expectRevert(); contest.advanceSettlement(round,0,1);
        assertEq(contest.feeCredits(artist),artistCredit);
    }

    function testBatchBoundariesDoNotChangeAnyOutcome() public {
        contest.fundBonusReserve{value:5e18}();vm.warp(start);
        _buy(alice,99,true,0); _buy(bob,101,false,0); _buy(carol,100,true,0);
        _buy(dave,200,false,0); _buy(eve,102,false,0);
        _result(0,100);
        uint256[] memory ids=new uint256[](23);
        for(uint256 i;i<10;i++)ids[i]=i+11;
        for(uint256 i;i<11;i++)ids[i+10]=i;
        ids[21]=22;ids[22]=21;
        uint256 snapshot=vm.snapshotState();
        _order(0,ids);_drive(0,32);
        bytes32[] memory expected=new bytes32[](5);
        for(uint256 id=1;id<=5;id++)expected[id-1]=keccak256(abi.encode(contest.getEntryOutcome(id)));
        uint256 artistCredit=contest.feeCredits(artist);
        uint256 appCredit=contest.feeCredits(platform);
        uint256 reserve=contest.bonusReserveBalance();
        uint256 liability=contest.returnLiability();
        assertTrue(vm.revertToState(snapshot));
        for(uint256 i;i<ids.length;i++){
            uint256[] memory one=new uint256[](1);one[0]=ids[i];vm.prank(oracle);contest.submitOrder(round,0,one);
        }
        _drive(0,1);
        for(uint256 id=1;id<=5;id++)assertEq(keccak256(abi.encode(contest.getEntryOutcome(id))),expected[id-1]);
        assertEq(contest.feeCredits(artist),artistCredit);assertEq(contest.feeCredits(platform),appCredit);
        assertEq(contest.bonusReserveBalance(),reserve);assertEq(contest.returnLiability(),liability);_solvent();
    }

    function testCancellingOneHorizonDoesNotReleaseOtherPoolFunds() public {
        vm.warp(start);uint256 first=_buy(alice,100,false,0);uint256 other=_buy(bob,101,false,1);
        vm.prank(carol);vm.expectRevert();contest.cancelPool(round,0);
        contest.cancelPool(round,0);vm.prank(alice);contest.claimEntry(first,payable(alice));
        assertEq(contest.claimable(other),0);assertEq(contest.escrowLiability(),SPOT);
        assertEq(address(contest).balance,SPOT);_solvent();
    }

    function testFreeReserveWithdrawCannotSpendDepositsOrReservedBonus() public {
        contest.fundBonusReserve{value: 10e18}(); vm.warp(start);
        _buy(alice, 100, true, 0); _buy(bob, 101, false, 0);
        assertEq(contest.freeBonusReserve(), 7.5e18);
        vm.expectRevert(); contest.withdrawFreeReserve(7.5e18 + 1, payable(address(this)));
        vm.prank(alice); vm.expectRevert(); contest.withdrawFreeReserve(1, payable(alice));
        contest.withdrawFreeReserve(7.5e18, payable(eve));
        assertEq(address(contest).balance, 57.5e18); _solvent();
    }

    function testRejectingReceiverCanRetryAnotherRecipientAndCannotDoubleClaim() public {
        ClaimReceiver receiver = new ClaimReceiver(contest);
        contest.approveWallet(address(receiver), true); vm.warp(start);
        uint256 id = _buy(address(receiver), 100, false, 0); contest.cancelPool(round, 0);
        receiver.configure(true, false, id);
        vm.expectRevert(); receiver.claim(id, payable(address(receiver)));
        assertFalse(contest.getEntry(id).claimed); assertEq(contest.claimable(id), SPOT);
        uint256 before = alice.balance; receiver.claim(id, payable(alice)); assertEq(alice.balance - before, SPOT);
        vm.expectRevert(); receiver.claim(id, payable(alice)); _solvent();
    }

    function testReentrantReceiverReceivesOnlyOneClaim() public {
        ClaimReceiver receiver = new ClaimReceiver(contest);
        contest.approveWallet(address(receiver), true); vm.warp(start);
        uint256 id = _buy(address(receiver), 100, false, 0); contest.cancelPool(round, 0);
        receiver.configure(false, true, id);
        receiver.claim(id, payable(address(receiver)));
        assertEq(address(receiver).balance, SPOT); assertEq(receiver.attempts(), 1);
        assertEq(contest.claimable(id), 0); _solvent();
    }

    function testUnattributedTransfersRejected() public {
        (bool success,) = address(contest).call{value: SPOT}(""); assertFalse(success);
        (success,) = address(contest).call{value: SPOT}(hex"deadbeef"); assertFalse(success); _solvent();
    }

    function testCurveMatchesIndependentHighPrecisionReference() public view {
        (uint256[] memory counts,uint256[] memory ranks,uint256[] memory expected) = CurveReference.vectors();
        for (uint256 i; i < counts.length; i++) {
            // 1e-12 USDC at the5USDC transfer scale is far below displayed precision.
            assertApproxEqAbs(contest.transferRate(ranks[i], counts[i]), expected[i], 200_000);
        }
    }

    function testCurveUniformlyScalesThePreviousContractAtReferenceCoordinates() public view {
        (uint256[] memory counts,uint256[] memory ranks,) = CurveReference.vectors();
        for (uint256 i; i < counts.length; i++) {
            uint256 previous = LegacyRewardCurve.ratioWad(ranks[i], counts[i]);
            assertEq(contest.transferRate(ranks[i], counts[i]), previous * 9 / 10);
        }
    }

    function testCurveRejectsUndefinedRanks() public {
        vm.expectRevert();contest.transferRate(0,100);
        vm.expectRevert();contest.transferRate(1,0);
        vm.expectRevert();contest.transferRate(101,100);
    }

    function testFuzzCurveIsBoundedAndNonIncreasing(uint16 countSeed,uint16 rankSeed) public view {
        uint256 count = bound(countSeed, 1, 10_000); uint256 rank = bound(rankSeed, 1, count);
        uint256 rate = contest.transferRate(rank, count);
        assertLe(rate, .9e18); assertEq(contest.transferRate(1, count), .9e18);
        if (rank < count) assertGe(rate, contest.transferRate(rank + 1, count));
    }

    function testFuzzCancellationConservesDeposits(uint8 countSeed,uint256 guess) public {
        uint256 count = bound(countSeed, 1, 30); vm.warp(start);
        uint256[] memory ids = new uint256[](count);
        for (uint256 i; i < count; i++) ids[i] = _buy(_actor(i % 5), guess, false, 0);
        contest.cancelPool(round, 0); _solvent();
        for (uint256 i; i < count; i++) { vm.prank(_actor(i % 5)); contest.claimEntry(ids[i], payable(_actor(i % 5))); _solvent(); }
        assertEq(address(contest).balance, 0);
    }

    function testFuzzFinalizedPaymentsConserveFunds(uint256 seed,uint8 countSeed) public {
        uint256 count=bound(countSeed,2,20);vm.warp(start);
        uint256[] memory ids=_ids(count);uint256[] memory errors=new uint256[](count);
        for(uint256 i;i<count;i++){
            uint256 guess=90+uint256(keccak256(abi.encode(seed,i)))%21;
            errors[i]=guess>100?guess-100:100-guess;
            _buy(_actor(i%5),guess,false,0);
        }
        // Independent insertion sort is bounded by this test's maximum20tickets.
        for(uint256 i=1;i<count;i++){
            uint256 key=ids[i];uint256 j=i;
            while(j>0&&(errors[ids[j-1]]>errors[key]||(errors[ids[j-1]]==errors[key]&&ids[j-1]>key))){ids[j]=ids[j-1];j--;}
            ids[j]=key;
        }
        _settle(0,100,ids);
        uint256 totalReturned;
        for(uint256 id=1;id<=count;id++){
            Contest.Entry memory e=contest.getEntry(id);uint256 amount=contest.claimable(id);totalReturned+=amount;
            vm.prank(e.payer);contest.claimEntry(id,payable(e.payer));_solvent();
        }
        uint256 artistFees=contest.feeCredits(artist);uint256 appFees=contest.feeCredits(platform);
        assertEq(totalReturned+artistFees+appFees,count*SPOT);
        if(artistFees>0){vm.prank(artist);contest.claimFees(payable(artist));}
        if(appFees>0){vm.prank(platform);contest.claimFees(payable(platform));}
        assertEq(address(contest).balance,0);_solvent();
    }

    function testThousandSpotsUseBoundedTransactionsAndConserveFunds() public {
        contest.fundBonusReserve{value: 250e18}(); vm.warp(start);
        for (uint256 i; i < 100; i++) _buy(_actor(i % 5), 100 + i, true, 0);
        _result(0, 100);
        uint256[] memory ids = _ids(1000);
        uint256 maxOrderGas;
        for (uint256 offset; offset < 1000; offset += 32) {
            uint256 length = 1000-offset >32?32:1000-offset;
            uint256[] memory batch=new uint256[](length);for(uint256 j;j<length;j++)batch[j]=ids[offset+j];
            vm.prank(oracle);uint256 before=gasleft();contest.submitOrder(round,0,batch);uint256 used=before-gasleft();if(used>maxOrderGas)maxOrderGas=used;
            _solvent();
        }
        uint256 maxProgressGas = _drive(0, 32);
        Contest.Pool memory p = contest.getPool(round, 0);
        assertEq(p.spotCount, 1000); assertEq(p.pairCursor, 500);
        assertEq(p.totalReturns+p.artistFees+p.appFees,p.totalDeposits+p.subsidyUsed);
        assertLt(maxOrderGas, 5_000_000); assertLt(maxProgressGas, 5_000_000);
        emit log_named_uint("max_order_batch_gas", maxOrderGas);
        emit log_named_uint("max_progress_batch_gas", maxProgressGas);
        for (uint256 id=1;id<=100;id++) { Contest.Entry memory e=contest.getEntry(id);vm.prank(e.payer);contest.claimEntry(id,payable(e.payer));_solvent(); }
        assertEq(contest.returnLiability(), 0);
    }

    function testFourCreatesSeparateOrdinaryEntriesAtomically() public {
        vm.warp(start); vm.deal(alice, 20e18); vm.prank(alice);
        uint256[4] memory ids = contest.enterFour{value:20e18}(round, 0, 12345);
        for(uint256 i; i<4; ++i) {
            assertEq(ids[i], i+1);
            Contest.Entry memory e=contest.getEntry(ids[i]);
            assertEq(e.payer,alice); assertEq(e.guess,12345); assertEq(e.paid,SPOT);
            assertEq(e.spots,1); assertEq(e.multiplierBps,10000); assertEq(e.purchasedAt,start);
        }
        Contest.Pool memory p=contest.getPool(round,0);
        assertEq(p.entryCount,4); assertEq(p.spotCount,4); assertEq(p.peopleCount,1);
        assertEq(p.totalDeposits,20e18); assertEq(contest.escrowLiability(),20e18);
        assertEq(contest.reservedBonus(),0); assertTrue(contest.isSolvent());
    }

    function testFourRejectsInvalidPaymentsAndClosedOrExcludedAccounts() public {
        vm.warp(start); vm.deal(alice,100e18);
        vm.prank(alice); vm.expectRevert(Contest.InvalidPayment.selector); contest.enterFour{value:SPOT}(round,0,0);
        vm.prank(alice); vm.expectRevert(Contest.InvalidPayment.selector); contest.enter{value:20e18}(round,0,0);
        contest.approveWallet(alice,false);
        vm.prank(alice); vm.expectRevert(Contest.WalletNotApproved.selector); contest.enterFour{value:20e18}(round,0,0);
        contest.approveWallet(alice,true); vm.warp(start-1); contest.setExclusion(round,alice,true); vm.warp(start);
        vm.prank(alice); vm.expectRevert(Contest.ArtistExcluded.selector); contest.enterFour{value:20e18}(round,0,0);
        vm.warp(start-1); contest.setExclusion(round,alice,false); vm.warp(start+1 hours);
        vm.prank(alice); vm.expectRevert(Contest.EntriesClosed.selector); contest.enterFour{value:20e18}(round,0,0);
        assertEq(contest.nextEntryId(),1); assertEq(contest.escrowLiability(),0);
    }

    function testFourOutOfGasRollsBackEveryEntry() public {
        vm.warp(start); vm.deal(alice,20e18); vm.prank(alice);
        (bool ok,) = address(contest).call{value:20e18,gas:250000}(abi.encodeCall(contest.enterFour,(round,0,0)));
        assertFalse(ok); assertEq(contest.nextEntryId(),1); assertEq(contest.getPool(round,0).spotCount,0);
        assertEq(contest.escrowLiability(),0); assertEq(address(contest).balance,0); assertEq(alice.balance,20e18);
    }

    function testFourAllHorizonsAndRefunds() public {
        vm.warp(start); vm.deal(alice,60e18);
        for(uint8 h;h<3;++h) {
            vm.prank(alice); uint256[4] memory ids=contest.enterFour{value:20e18}(round,h,0);
            contest.cancelPool(round,h);
            for(uint256 i;i<4;++i){vm.prank(alice);contest.claimEntry(ids[i],payable(alice));}
        }
        assertEq(alice.balance,60e18); assertEq(contest.escrowLiability(),0); assertTrue(contest.isSolvent());
    }

    function testMixedFourEntrySettlementConservesFundsWithoutFourBonus() public {
        contest.fundBonusReserve{value:10e18}(); vm.warp(start);
        vm.deal(alice,20e18); vm.prank(alice);
        uint256[4] memory ids=contest.enterFour{value:20e18}(round,0,100);
        _buy(bob,200,true,0); _buy(carol,300,false,0);
        _settle(0,100,_ids(15));
        uint256 returned;
        for(uint256 entryId=1;entryId<7;++entryId){Contest.EntryOutcome memory o=contest.getEntryOutcome(entryId);returned+=o.returned;}
        Contest.Pool memory p=contest.getPool(round,0);
        assertEq(returned+p.artistFees+p.appFees,75e18+p.subsidyUsed);
        for(uint256 j;j<4;++j)assertEq(contest.getEntryOutcome(ids[j]).bonus,0);
        _solvent();
    }
}
