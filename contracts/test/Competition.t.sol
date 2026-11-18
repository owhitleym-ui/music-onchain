// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Competition} from "../src/Competition.sol";
import {SongRegistry} from "../src/SongRegistry.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CompetitionTest is Test {
    MockUSDC usdc;
    SongRegistry registry;
    Competition comp;

    address owner = makeAddr("owner");
    address oracle = makeAddr("oracle");
    address treasury = makeAddr("treasury");
    address artist = makeAddr("artist");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");

    uint256 constant FEE = 5e6; // $5
    uint256 songId;

    function setUp() public {
        usdc = new MockUSDC();
        registry = new SongRegistry(owner);
        comp = new Competition(IERC20(address(usdc)), registry, owner, oracle, treasury);

        vm.prank(owner);
        songId = registry.addSong(artist, "/songs/1.json");

        address[5] memory players = [alice, bob, carol, dave, artist];
        for (uint256 i = 0; i < players.length; ++i) {
            usdc.mint(players[i], 100e6);
            vm.prank(players[i]);
            usdc.approve(address(comp), type(uint256).max);
        }
    }

    // ------------------------------------------------------------- helpers

    /// Default split: 50% / 20% / 10% to top 3, 15% artist, 5% platform.
    function _config(uint32 minEntries) internal view returns (Competition.Config memory cfg) {
        uint16[] memory payout = new uint16[](3);
        payout[0] = 5000;
        payout[1] = 2000;
        payout[2] = 1000;
        cfg = Competition.Config({
            songId: songId,
            entryFee: FEE,
            closesAt: uint64(block.timestamp + 1 hours),
            minEntries: minEntries,
            maxEntries: 100,
            artistBps: 1500,
            platformBps: 500,
            payoutBps: payout,
            metric: "YouTube views at close"
        });
    }

    function _create(uint32 minEntries) internal returns (uint256 id) {
        vm.prank(owner);
        id = comp.createCompetition(_config(minEntries));
    }

    function _enter(uint256 id, address who, uint256 prediction) internal {
        vm.prank(who);
        comp.enter(id, prediction);
    }

    // ------------------------------------------------------------- create

    function test_create_storesConfig() public {
        uint256 id = _create(3);
        (Competition.Config memory cfg, Competition.Status status,,,) = comp.getCompetition(id);
        assertEq(cfg.entryFee, FEE);
        assertEq(cfg.payoutBps.length, 3);
        assertEq(uint8(status), uint8(Competition.Status.Open));
    }

    function test_create_revertsWhenBpsDontSumTo100() public {
        Competition.Config memory cfg = _config(3);
        cfg.artistBps = 1000;
        vm.prank(owner);
        vm.expectRevert(Competition.InvalidConfig.selector);
        comp.createCompetition(cfg);
    }

    function test_create_revertsWhenMinEntriesBelowWinnerCount() public {
        Competition.Config memory cfg = _config(2);
        vm.prank(owner);
        vm.expectRevert(Competition.InvalidConfig.selector);
        comp.createCompetition(cfg);
    }

    function test_create_onlyOwner() public {
        Competition.Config memory cfg = _config(3);
        vm.expectRevert(Competition.NotOwner.selector);
        comp.createCompetition(cfg);
    }

    // -------------------------------------------------------------- enter

    function test_enter_takesFeeAndRecordsEntry() public {
        uint256 id = _create(3);
        _enter(id, alice, 1000);

        assertEq(usdc.balanceOf(address(comp)), FEE);
        assertTrue(comp.hasEntered(id, alice));
        Competition.Entry[] memory entries = comp.getEntries(id);
        assertEq(entries.length, 1);
        assertEq(entries[0].player, alice);
        assertEq(entries[0].prediction, 1000);
    }

    function test_enter_revertsOnSecondEntry() public {
        uint256 id = _create(3);
        _enter(id, alice, 1000);
        vm.prank(alice);
        vm.expectRevert(Competition.AlreadyEntered.selector);
        comp.enter(id, 2000);
    }

    function test_enter_blocksArtist() public {
        uint256 id = _create(3);
        vm.prank(artist);
        vm.expectRevert(Competition.ArtistAffiliated.selector);
        comp.enter(id, 1000);
    }

    function test_enter_blocksAffiliate() public {
        uint256 id = _create(3);
        vm.prank(owner);
        registry.setAffiliate(songId, bob, true);
        vm.prank(bob);
        vm.expectRevert(Competition.ArtistAffiliated.selector);
        comp.enter(id, 1000);
    }

    function test_enter_revertsAfterClose() public {
        uint256 id = _create(3);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        vm.expectRevert(Competition.EntriesClosed.selector);
        comp.enter(id, 1000);
    }

    function test_enter_revertsWhenFull() public {
        Competition.Config memory cfg = _config(3);
        cfg.maxEntries = 3;
        vm.prank(owner);
        uint256 id = comp.createCompetition(cfg);
        _enter(id, alice, 1);
        _enter(id, bob, 2);
        _enter(id, carol, 3);
        vm.prank(dave);
        vm.expectRevert(Competition.CompetitionFull.selector);
        comp.enter(id, 4);
    }

    // ------------------------------------------------------------- settle

    function test_settle_paysClosestAndArtist() public {
        uint256 id = _create(3);
        _enter(id, alice, 900); // err 100 -> rank 2
        _enter(id, bob, 1010); // err 10  -> rank 1
        _enter(id, carol, 1500); // err 500 -> rank 3
        _enter(id, dave, 5000); // err 4000 -> no prize

        vm.warp(block.timestamp + 1 hours);
        vm.prank(oracle);
        comp.settle(id, 1000);

        uint256 pot = 4 * FEE; // $20
        assertEq(usdc.balanceOf(bob), 100e6 - FEE + (pot * 5000) / 10_000);
        assertEq(usdc.balanceOf(alice), 100e6 - FEE + (pot * 2000) / 10_000);
        assertEq(usdc.balanceOf(carol), 100e6 - FEE + (pot * 1000) / 10_000);
        assertEq(usdc.balanceOf(dave), 100e6 - FEE);
        assertEq(usdc.balanceOf(treasury), (pot * 500) / 10_000);
        assertEq(usdc.balanceOf(artist), 100e6 + (pot * 1500) / 10_000);
        assertEq(usdc.balanceOf(address(comp)), 0);

        (, Competition.Status status,, uint256 finalMetric,) = comp.getCompetition(id);
        assertEq(uint8(status), uint8(Competition.Status.Settled));
        assertEq(finalMetric, 1000);
    }

    function test_settle_tieGoesToEarlierEntry() public {
        uint256 id = _create(3);
        _enter(id, alice, 1100); // err 100, entered first
        _enter(id, bob, 900); // err 100, entered second
        _enter(id, carol, 2000);

        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(true, true, false, true);
        emit Competition.WinnerPaid(id, alice, 1, 1100, (3 * FEE * 5000) / 10_000);
        vm.prank(oracle);
        comp.settle(id, 1000);
    }

    function test_settle_onlyOracle() public {
        uint256 id = _create(3);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(Competition.NotOracle.selector);
        comp.settle(id, 1000);
    }

    function test_settle_revertsWhileOpen() public {
        uint256 id = _create(3);
        vm.prank(oracle);
        vm.expectRevert(Competition.StillOpen.selector);
        comp.settle(id, 1000);
    }

    function test_settle_revertsTwice() public {
        uint256 id = _create(3);
        _enter(id, alice, 1);
        _enter(id, bob, 2);
        _enter(id, carol, 3);
        vm.warp(block.timestamp + 1 hours);
        vm.startPrank(oracle);
        comp.settle(id, 1000);
        vm.expectRevert(Competition.NotOpen.selector);
        comp.settle(id, 1000);
        vm.stopPrank();
    }

    function test_settle_refundsBelowMinimum() public {
        uint256 id = _create(4);
        _enter(id, alice, 1);
        _enter(id, bob, 2);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(oracle);
        comp.settle(id, 1000);

        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(bob), 100e6);
        assertEq(usdc.balanceOf(address(comp)), 0);
        (, Competition.Status status,,,) = comp.getCompetition(id);
        assertEq(uint8(status), uint8(Competition.Status.Cancelled));
    }

    function test_settle_blockedWinnerIsDeferredNotFatal() public {
        uint256 id = _create(3);
        _enter(id, alice, 1000); // exact -> rank 1
        _enter(id, bob, 1);
        _enter(id, carol, 2);
        usdc.setBlocked(alice, true);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(oracle);
        comp.settle(id, 1000);

        uint256 prize = (3 * FEE * 5000) / 10_000;
        assertEq(comp.owed(alice), prize);
        assertGt(usdc.balanceOf(artist), 100e6); // artist still paid

        usdc.setBlocked(alice, false);
        vm.prank(alice);
        comp.withdraw();
        assertEq(comp.owed(alice), 0);
        assertEq(usdc.balanceOf(alice), 100e6 - FEE + prize);
    }

    // ------------------------------------------------------------- cancel

    function test_cancel_refundsEveryone() public {
        uint256 id = _create(3);
        _enter(id, alice, 1);
        _enter(id, bob, 2);
        vm.prank(owner);
        comp.cancel(id);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(bob), 100e6);
    }

    function test_cancel_onlyOwnerOrOracle() public {
        uint256 id = _create(3);
        vm.prank(alice);
        vm.expectRevert(Competition.NotOwner.selector);
        comp.cancel(id);
    }
}
