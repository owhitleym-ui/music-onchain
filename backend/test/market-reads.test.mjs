import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveContests,livePoolId} from '../src/live-contests.js';
import {createMarkets} from '../src/markets.js';
import {scheduleFor} from '../../shared/market-schedule.js';
import {SONG_ID} from '../src/contest-chain.js';
import {ORIGINAL_OWNER} from '../src/config.js';
const C='0x'+'b'.repeat(40),config={atomic:true,chainId:5042002,contract:C,deployment:{marketModelVersion:2,deploymentId:'markets-v2'}};
function fixture(){
 const now=Date.parse('2026-11-20T18:30Z'),hour=scheduleFor('next_hour',now),daily=scheduleFor('day_plus_7',now);
 const rows=[hour,daily].map((s,i)=>({id:String(i+1),songId:SONG_ID,musicId:'demo:last-bus-home',artist:ORIGINAL_OWNER,startSeconds:String(s.entryStart/1000),deadlineSeconds:String(s.entryEnd/1000),cadence:s.cadence}));
 const seen=[];let corrupt=false;
 const chain={verify:async()=>{},snapshot:async()=>({number:1n,timestamp:BigInt(now/1000)}),counters:async()=>({nextRoundId:3n,nextEntryId:1n}),readRound:async id=>{const r=rows[Number(id)-1];return {...r,exists:true,start:BigInt(r.startSeconds),deadline:BigInt(r.deadlineSeconds),cadence:r.cadence==='hourly'?0:1};},readPool:async(id,type)=>{
  seen.push(id+':'+type);const s=scheduleFor(type,Number(rows[Number(id)-1].startSeconds)*1000);return {windowStart:BigInt(s.windowStart/1000),windowEnd:BigInt(s.windowEnd/1000),refundAt:BigInt(s.refundAt/1000),phase:0,entryCount:0n,spotCount:0n,peopleCount:0n,totalDeposits:0n};}};
 const store={catalog:async()=>({roundCount:'2',maxRoundId:'2',entryCount:'0',rounds:rows}),round:async(_block,pools)=>Object.fromEntries(Object.keys(pools).map(h=>[h,{entryCount:'0',spotCount:'0',peopleCount:'0',totalDeposits:'0',averageGuess:null,mode:null}])),schedule:async(id,index)=>{const type=['next_hour','hour_plus_24','day_plus_7'][index],s=scheduleFor(type,Number(rows[Number(id)-1].startSeconds)*1000);return {pool:livePoolId(id,type),windowStart:String(s.windowStart/1000+(corrupt?1:0)),windowEnd:String(s.windowEnd/1000),refundAt:String(s.refundAt/1000)};}};
 const live=createLiveContests({config,chain,store,clock:()=>now,cacheMs:0});return {live,chain,store,seen,corrupt:()=>corrupt=true};
}
test('indexed V2 reads require exact schedule evidence and only fetch pools valid for that cadence',async()=>{
 const f=fixture(),hourly=await f.live.round('1'),daily=await f.live.round('2');
 assert.deepEqual(Object.keys(hourly.pools),['next_hour','hour_plus_24']);assert.deepEqual(Object.keys(daily.pools),['day_plus_7']);
 assert.equal(hourly.round.deadline-hourly.round.start,3600000);assert.equal(daily.round.deadline-daily.round.start,86400000);
 assert.equal(hourly.pools.next_hour.windowEnd-hourly.pools.next_hour.windowStart,3600000);
 assert.deepEqual(f.seen,['1:next_hour','1:hour_plus_24','2:day_plus_7']);
 f.corrupt();const stale=await f.live.round('1');assert.equal(stale.snapshot.syncStatus,'catching_up');assert.equal(stale.pools.next_hour.spotCount,'0');
 const g=fixture();g.corrupt();await assert.rejects(g.live.round('1'),/LIVE_DATA_UPDATING/);
});
test('market API is deployment scoped; old deployments remain explicitly unready for the new schedule',async()=>{
 const f=fixture(),api=createMarkets({config,live:f.live,deployments:[config]});
 const c=await api.catalog();assert.equal(c.marketModelVersion,3);assert.equal(c.ready,false);assert.equal(c.timeZone,'America/Chicago');assert.equal(c.markets.length,0);
 assert.equal((await api.detail('markets-v2','1','next_hour')).id,'markets-v2:1:next_hour');
 await assert.rejects(api.detail('atomic-v1','1','next_hour'),/ROUND_UNAVAILABLE/);await assert.rejects(api.detail('markets-v2','2','next_hour'),/ROUND_UNAVAILABLE/);
 const old=await createMarkets({config:{...config,deployment:{}},live:null,deployments:[config]}).catalog();assert.equal(old.ready,false);assert.equal(old.markets.length,0);
});
