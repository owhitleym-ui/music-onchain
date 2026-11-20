// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {MusicPredictionMarketsV3 as Markets} from "../src/MusicPredictionMarketsV3.sol";

contract MusicPredictionMarketsV3Test is Test {
    Markets m;
    address oracle=address(0x100);
    address artist=address(0x200);
    address app=address(0x250);
    address alice=address(0x300);
    address bob=address(0x400);
    uint64 constant DAY=200 days;
    bytes32 constant SONG=keccak256("last-bus-home");
    function setUp() public {
        vm.warp(DAY-1 hours);
        m=new Markets(address(this),oracle,app);
        m.approveWallet(alice,true);m.approveWallet(bob,true);
        vm.deal(alice,1000 ether);vm.deal(bob,1000 ether);vm.deal(address(this),100 ether);
        m.fundBonusReserve{value:10 ether}();
    }
    function times() internal pure returns(uint64[6] memory) {
        return [DAY+6 hours,DAY+1 days+6 hours,DAY+2 days+6 hours,DAY+3 days+6 hours,DAY+7 days+6 hours,DAY+8 days+6 hours];
    }
    function daily() internal returns(uint256) {return m.createDailyRound(SONG,"demo:last-bus-home",artist,times(),new address[](0));}
    function settle(uint256 r,uint8 h,uint256 actual) internal {
        vm.warp(m.getPool(r,h).windowEnd);vm.prank(oracle);m.submitResult(r,h,actual,bytes32(uint256(1)));
        uint256 n=m.getPool(r,h).spotCount;uint256[] memory order=new uint256[](n);
        for(uint256 i;i<n;i++)order[i]=i;
        m.submitOrder(r,h,order);
        while(m.getPool(r,h).phase!=Markets.Phase.Finalized)m.advanceSettlement(r,h,16);
    }
    function testThreeDailyWindowsAndNoHourlyEntrypoint() public {
        uint256 r=daily();uint64[6] memory t=times();
        assertEq(m.MARKET_MODEL_VERSION(),3);assertEq(m.ARTIST_FEE_BPS(),500);assertEq(m.APP_FEE_BPS(),100);
        assertEq(m.getRound(r).start,t[0]);assertEq(m.getRound(r).deadline,t[1]);
        assertEq(m.getPool(r,0).windowStart,t[1]);assertEq(m.getPool(r,0).windowEnd,t[2]);
        assertEq(m.getPool(r,1).windowStart,t[2]);assertEq(m.getPool(r,1).windowEnd,t[3]);
        assertEq(m.getPool(r,2).windowStart,t[4]);assertEq(m.getPool(r,2).windowEnd,t[5]);
        (bool ok,)=address(m).call(abi.encodeWithSignature("createHourlyRound(bytes32,string,address,uint64,address[])",SONG,"x",artist,t[0],new address[](0)));
        assertFalse(ok);vm.expectRevert();m.getPool(r,3);
    }
    function testBiddingBoundariesAndAllThreePaymentOptions() public {
        uint256 r=daily();uint64[6] memory t=times();
        vm.prank(alice);vm.expectRevert();m.enter{value:5 ether}(r,0,1);
        vm.warp(t[0]);vm.prank(alice);m.enter{value:5 ether}(r,0,1);
        vm.prank(alice);m.enterFour{value:20 ether}(r,1,1);
        vm.prank(bob);m.enter{value:50 ether}(r,2,1);
        assertEq(m.getPool(r,0).spotCount,1);assertEq(m.getPool(r,1).entryCount,4);assertEq(m.getPool(r,2).spotCount,10);
        vm.warp(t[1]);vm.prank(alice);vm.expectRevert();m.enter{value:5 ether}(r,0,1);
        vm.prank(oracle);vm.expectRevert();m.submitResult(r,0,1,bytes32(uint256(1)));
    }
    function testInvalidSchedulesDuplicatesAndExclusions() public {
        uint64[6] memory t=times();t[2]+=1;vm.expectRevert();m.createDailyRound(SONG,"bad",artist,t,new address[](0));
        t=times();t[4]-=1 days;vm.expectRevert();m.createDailyRound(SONG,"bad",artist,t,new address[](0));
        t=times();vm.prank(alice);vm.expectRevert();m.createDailyRound(SONG,"bad",artist,t,new address[](0));
        vm.warp(t[0]+12 hours);address[] memory excluded=new address[](1);excluded[0]=bob;
        uint256 r=m.createDailyRound(SONG,"late",artist,t,excluded);
        vm.prank(alice);m.enter{value:5 ether}(r,0,1);
        vm.prank(bob);vm.expectRevert();m.enter{value:5 ether}(r,0,1);
        vm.expectRevert();daily();
    }
    function testClockChangeDaysAndSharedMidnightBoundaries() public {
        uint64[6] memory spring=[DAY+6 hours,DAY+1 days+6 hours,DAY+2 days+5 hours,DAY+3 days+5 hours,DAY+7 days+5 hours,DAY+8 days+5 hours];
        uint256 r=m.createDailyRound(SONG,"spring",artist,spring,new address[](0));
        assertEq(m.getPool(r,0).windowEnd-m.getPool(r,0).windowStart,23 hours);
        uint64[6] memory fall=[DAY+1 days+5 hours,DAY+2 days+5 hours,DAY+3 days+6 hours,DAY+4 days+6 hours,DAY+8 days+6 hours,DAY+9 days+6 hours];
        r=m.createDailyRound(SONG,"fall",artist,fall,new address[](0));
        assertEq(m.getPool(r,0).windowEnd-m.getPool(r,0).windowStart,25 hours);
        assertEq(m.getPool(r,0).windowEnd,m.getPool(r,1).windowStart);
    }
    function testLastPlacePays85ToWinner5ToArtistAndKeeps10() public {
        uint256 r=daily();vm.warp(times()[0]);
        vm.prank(alice);m.enter{value:5 ether}(r,0,0);vm.prank(bob);m.enter{value:5 ether}(r,0,100);
        settle(r,0,0);
        Markets.EntryOutcome memory won=m.getEntryOutcome(1);Markets.EntryOutcome memory lost=m.getEntryOutcome(2);
        assertEq(won.baseWinnings,4.25 ether);assertEq(won.artistFee,0);assertEq(won.appFee,0);assertEq(won.returned,9.25 ether);
        assertEq(lost.loss,4.25 ether);assertEq(lost.artistFee,.25 ether);assertEq(lost.returned,.5 ether);
        assertEq(m.feeCredits(artist),.25 ether);assertEq(m.feeCredits(app),0);
        vm.prank(alice);m.claimEntry(1,payable(alice));vm.prank(bob);m.claimEntry(2,payable(bob));
        vm.prank(artist);m.claimFees(payable(artist));assertTrue(m.isSolvent());assertEq(m.accountedBalance(),10 ether);
    }
    function testBundleBonusUsesReserveWithoutIncreasingLoserDeduction() public {
        uint256 r=daily();vm.warp(times()[0]);
        vm.prank(alice);m.enter{value:50 ether}(r,1,0);vm.prank(bob);m.enter{value:50 ether}(r,1,100);
        settle(r,1,0);
        Markets.EntryOutcome memory won=m.getEntryOutcome(1);Markets.EntryOutcome memory lost=m.getEntryOutcome(2);
        assertEq(won.baseWinnings,42.5 ether);assertEq(won.bonus,2.125 ether);assertEq(won.returned,94.625 ether);
        assertEq(lost.loss,42.5 ether);assertEq(lost.artistFee,2.5 ether);assertEq(lost.returned,5 ether);
        Markets.Pool memory p=m.getPool(r,1);assertEq(p.subsidyUsed,2.125 ether);assertEq(m.bonusReserveBalance(),7.875 ether);
        assertEq(p.totalReturns+p.artistFees+p.appFees,p.totalDeposits+p.subsidyUsed);assertTrue(m.isSolvent());
    }
    function testPlatformFeeUsesStakeAndDenseRankExemptions() public {
        uint256 r=daily();vm.warp(times()[0]);
        uint256[8] memory guesses=[uint256(0),1,1,2,10,11,12,13];
        for(uint256 i;i<8;i++){address a=address(uint160(0x1000+i));m.approveWallet(a,true);vm.deal(a,5 ether);vm.prank(a);m.enter{value:5 ether}(r,0,guesses[i]);}
        settle(r,0,0);
        for(uint256 i=1;i<=3;i++)assertEq(m.getEntryOutcome(i).appFee,0);
        Markets.EntryOutcome memory third=m.getEntryOutcome(4);
        assertEq(third.mainRank,3);assertEq(third.appFee,.05 ether);assertEq(third.artistFee,0);
        uint256 deduction=5 ether*m.transferRate(3,8)/1 ether;
        assertEq(third.baseWinnings,deduction-.25 ether);
        assertEq(third.returned,5 ether+deduction-.25 ether-.05 ether);
        assertEq(m.feeCredits(app),.05 ether);assertEq(m.feeCredits(artist),1 ether);
    }
    function testFuzzAllLosingPositionsPayFivePercentAndAccountingBalances(uint8 size) public {
        uint256 n=bound(size,2,20);uint256 r=daily();vm.warp(times()[0]);
        for(uint256 i;i<n;i++){address a=address(uint160(0x1000+i));m.approveWallet(a,true);vm.deal(a,5 ether);vm.prank(a);m.enter{value:5 ether}(r,2,i);}
        settle(r,2,0);
        uint256 fees;for(uint256 i;i<n;i++){
            Markets.EntryOutcome memory o=m.getEntryOutcome(i+1);
            assertEq(o.returned,5 ether+o.baseWinnings+o.bonus-o.loss-o.artistFee-o.appFee);
            if(i<n/2){assertEq(o.artistFee,0);assertEq(o.appFee,i<2?0:.05 ether);}
            else if(n%2==1&&i==n/2){assertEq(o.artistFee,0);assertEq(o.returned,5 ether);}
            else {assertEq(o.artistFee,.25 ether);assertLe(o.loss+o.artistFee,4.5 ether);fees+=o.artistFee;}
        }
        Markets.Pool memory p=m.getPool(r,2);assertEq(fees,n/2*.25 ether);assertEq(p.artistFees,fees);
        assertEq(p.totalReturns+p.artistFees+p.appFees,p.totalDeposits+p.subsidyUsed);assertTrue(m.isSolvent());
    }
    function testSameAccountBonusExcluded() public {
        uint256 r=daily();vm.warp(times()[0]);vm.prank(alice);uint256 id=m.enter{value:50 ether}(r,0,0);
        vm.prank(alice);m.enter{value:50 ether}(r,0,100);settle(r,0,0);assertEq(m.getEntryOutcome(id).bonus,0);
        assertTrue(m.isSolvent());
    }
    function testCancellationRefundsEntirePayment() public {
        uint256 r=daily();vm.warp(times()[0]);vm.prank(bob);uint256 other=m.enter{value:50 ether}(r,1,1);m.cancelPool(r,1);
        assertEq(m.claimable(other),50 ether);assertEq(m.getPool(r,1).artistFees,0);vm.prank(bob);m.claimEntry(other,payable(bob));assertTrue(m.isSolvent());
    }
}
