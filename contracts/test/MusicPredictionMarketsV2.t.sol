// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {MusicPredictionMarketsV2 as Markets} from "../src/MusicPredictionMarketsV2.sol";

contract MusicPredictionMarketsV2Test is Test {
    Markets m;
    address oracle=address(0x100);
    address artist=address(0x200);
    address alice=address(0x300);
    address bob=address(0x400);
    uint64 constant START=200 days;
    bytes32 constant SONG=keccak256("last-bus-home");
    function setUp() public {
        vm.warp(START-1 hours);
        m=new Markets(address(this),oracle,artist);
        m.approveWallet(alice,true);m.approveWallet(bob,true);
        vm.deal(alice,1000 ether);vm.deal(bob,1000 ether);vm.deal(address(this),100 ether);
        m.fundBonusReserve{value:10 ether}();
    }
    function hourly() internal returns(uint256){return m.createHourlyRound(SONG,"demo:last-bus-home",artist,START,new address[](0));}
    function daily(uint64 day) internal returns(uint256){
        uint64[4] memory times=[day+6 hours,day+1 days+6 hours,day+7 days+6 hours,day+8 days+6 hours];
        return m.createDailyRound(SONG,"demo:last-bus-home",artist,times,new address[](0));
    }
    function testHourlyWindowsAndDeadline() public {
        uint256 r=hourly();Markets.Round memory round=m.getRound(r);
        assertEq(round.deadline,START+1 hours);assertEq(round.cadence,0);
        assertEq(m.getPool(r,0).windowStart,START+1 hours);assertEq(m.getPool(r,0).windowEnd,START+2 hours);
        assertEq(m.getPool(r,1).windowStart,START+24 hours);assertEq(m.getPool(r,1).windowEnd,START+25 hours);
        vm.expectRevert();m.getPool(r,2);
        vm.warp(START);vm.prank(alice);m.enter{value:5 ether}(r,0,123);
        vm.warp(START+1 hours-1);vm.prank(alice);m.enter{value:5 ether}(r,1,456);
        vm.warp(START+1 hours);vm.prank(alice);vm.expectRevert();m.enter{value:5 ether}(r,0,123);
    }
    function testLateCurrentPeriodAndInitialExclusions() public {
        vm.warp(START+30 minutes);address[] memory excluded=new address[](1);excluded[0]=bob;
        uint256 r=m.createHourlyRound(SONG,"demo:last-bus-home",artist,START,excluded);
        vm.prank(alice);m.enter{value:5 ether}(r,0,123);
        vm.prank(bob);vm.expectRevert();m.enter{value:5 ether}(r,0,123);
        vm.expectRevert();m.setExclusion(r,alice,true);
        vm.warp(START+1 hours);vm.expectRevert();hourly();
    }
    function testDailyBiddingAndFollowingWeekTargets() public {
        uint256 r=daily(START);Markets.Round memory round=m.getRound(r);
        assertEq(round.start,START+6 hours);assertEq(round.deadline,START+30 hours);assertEq(round.cadence,1);
        vm.expectRevert();m.getPool(r,0);vm.expectRevert();m.getPool(r,1);
        assertEq(m.getPool(r,2).windowStart,START+7 days+6 hours);assertEq(m.getPool(r,2).windowEnd,START+8 days+6 hours);
        vm.warp(START+29 hours);vm.prank(alice);m.enter{value:5 ether}(r,2,123);
        vm.warp(START+30 hours);vm.prank(alice);vm.expectRevert();m.enter{value:5 ether}(r,2,123);
    }
    function testMidnightHourlyAndDailyDoNotCollide() public {
        uint256 d=daily(START);uint256 h=m.createHourlyRound(SONG,"demo:last-bus-home",artist,START+6 hours,new address[](0));
        assertEq(m.roundFor(SONG,1,START+6 hours),d);assertEq(m.roundFor(SONG,0,START+6 hours),h);assertTrue(d!=h);
        vm.expectRevert();daily(START);
    }
    function testDailyClockChangeDurations() public {
        uint64[4] memory spring=[START+6 hours,START+1 days+5 hours,START+7 days+5 hours,START+8 days+5 hours];
        uint256 r=m.createDailyRound(SONG,"spring",artist,spring,new address[](0));assertEq(m.getRound(r).deadline-m.getRound(r).start,23 hours);
        uint64[4] memory fall=[START+1 days+5 hours,START+2 days+6 hours,START+8 days+6 hours,START+9 days+6 hours];
        r=m.createDailyRound(SONG,"fall",artist,fall,new address[](0));assertEq(m.getRound(r).deadline-m.getRound(r).start,25 hours);
    }
    function testInvalidSchedulesAndUnprivilegedCreation() public {
        vm.prank(alice);vm.expectRevert();hourly();
        vm.expectRevert();m.createHourlyRound(SONG,"bad",artist,START+1,new address[](0));
        uint64[4] memory bad=[START,START+1 days,START+7 days,START+8 days];vm.expectRevert();m.createDailyRound(SONG,"bad",artist,bad,new address[](0));
        bad=[START+6 hours,START+30 hours,START+6 days+6 hours,START+7 days+6 hours];vm.expectRevert();m.createDailyRound(SONG,"bad",artist,bad,new address[](0));
    }
    function testResultCannotSettleAtBiddingCloseAndIndividualClaimsWork() public {
        uint256 r=hourly();vm.warp(START);vm.prank(alice);uint256[4] memory ids=m.enterFour{value:20 ether}(r,0,100);
        assertEq(m.getPool(r,0).entryCount,4);assertEq(m.getPool(r,0).spotCount,4);
        vm.warp(START+1 hours);vm.prank(oracle);vm.expectRevert();m.submitResult(r,0,100,bytes32(uint256(1)));
        vm.warp(START+2 hours);vm.prank(oracle);m.submitResult(r,0,100,bytes32(uint256(1)));
        uint256[] memory order=new uint256[](4);for(uint256 i;i<4;i++)order[i]=i;
        m.submitOrder(r,0,order);m.advanceSettlement(r,0,32);m.advanceSettlement(r,0,16);
        vm.prank(alice);m.claimEntry(ids[0],payable(alice));assertTrue(m.getEntry(ids[0]).claimed);assertFalse(m.getEntry(ids[1]).claimed);
        for(uint256 i=1;i<4;i++){vm.prank(alice);m.claimEntry(ids[i],payable(alice));}
        assertEq(m.returnLiability(),0);assertTrue(m.isSolvent());
    }
    function testPricesBonusFeesAndFullCancellationRefundsUnchanged() public {
        assertEq(m.SPOT_PRICE(),5 ether);assertEq(m.FOUR_SPOT_PRICE(),20 ether);assertEq(m.BUNDLE_PRICE(),50 ether);assertEq(m.transferRate(1,4),.9 ether);
        uint256 r=hourly();vm.warp(START);vm.prank(alice);uint256 id=m.enter{value:50 ether}(r,1,100);
        assertEq(m.getEntry(id).spots,10);assertEq(m.getEntry(id).multiplierBps,10500);m.cancelPool(r,1);
        assertEq(m.claimable(id),50 ether);vm.prank(alice);m.claimEntry(id,payable(alice));assertTrue(m.isSolvent());
    }
}
