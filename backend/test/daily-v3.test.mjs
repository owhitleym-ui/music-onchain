import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleFor,austinDate,austinMidnight,addCalendarDays,desiredRounds,dailyBoundaries,assertSchedule,MARKET_TYPES} from '../../shared/market-schedule.js';
import {creationPayload,creationCall,createMarketScheduler} from '../src/market-scheduler.js';
import {normalizeMarketPurchase} from '../src/purchases.js';
import {canonicalEvidence} from '../src/settlement.js';
import {typesFor,typeIndex} from '../src/market-model.js';
import {createMarkets} from '../src/markets.js';
import {createLiveContests,livePoolId} from '../src/live-contests.js';
import {SONG_ID} from '../src/contest-chain.js';
import {ORIGINAL_OWNER} from '../src/config.js';
import {retireHourly} from '../src/retire-hourly.js';
const C='0x'+'c'.repeat(40),A='0x'+'a'.repeat(40),config={atomic:true,chainId:5042002,contract:C,schedulerEnabled:true,deployment:{marketModelVersion:3,deploymentId:'markets-v3'}};

test('daily offsets remain calendar dates across DST, leap day and year boundaries',()=>{
 for(const date of ['2026-03-01','2026-03-06','2026-03-07','2026-03-08','2026-10-25','2026-10-30','2026-10-31','2026-11-01','2028-02-28','2026-12-31']){
  const start=austinMidnight(date);
  for(const type of MARKET_TYPES){
   const s=scheduleFor(type.id,start+3600000,3);
   assert.equal(s.entryStart,start);assert.equal(s.entryEnd,austinMidnight(addCalendarDays(date,1)));
   assert.equal(austinDate(s.windowStart),addCalendarDays(date,type.offsetDays));
   assert.equal(s.windowEnd,austinMidnight(addCalendarDays(date,type.offsetDays+1)));
   assert.ok([23,24,25].includes(s.durationHours));assert.deepEqual(assertSchedule(s,3),s);
   assert.equal(scheduleFor(type.id,s.entryEnd,3).entryStart,s.entryEnd);
  }
  const rounds=desiredRounds(start+7200000);assert.equal(rounds.length,2);assert.ok(rounds.every(s=>s.cadence==='daily'));
  assert.equal(rounds[1].entryStart,rounds[0].entryEnd);
 }
 assert.equal(scheduleFor('day_plus_1',austinMidnight('2026-03-07')).durationHours,23);
 assert.equal(scheduleFor('day_plus_2',austinMidnight('2026-10-30')).durationHours,25);
});
test('daily operator payload is bound to all six exact midnights and rejects hourly creation',()=>{
 const start=austinMidnight('2026-11-20'),s=scheduleFor('day_plus_1',start),payload=creationPayload(s,[A]);
 const call=creationCall({kind:'create-daily',payload},config);assert.equal(call.functionName,'createDailyRound');
 assert.deepEqual(call.args[3],dailyBoundaries(start).map(t=>BigInt(t/1000)));
 assert.throws(()=>creationCall({kind:'create-hourly',payload},config),/BAD_REQUEST/);
 assert.throws(()=>creationCall({kind:'create-daily',payload:{...payload,times:payload.times.map((v,i)=>v+(i===4?3600:0))}},config),/BAD_REQUEST/);
 assert.throws(()=>creationCall({kind:'create-daily',payload:{...payload,start:payload.start+1}},config),/BAD_REQUEST/);
});
test('V3 market indexes and sample evidence never relabel V2 hourly data',()=>{
 assert.deepEqual(typesFor(config),['day_plus_1','day_plus_2','day_plus_7']);
 const v2={deployment:{marketModelVersion:2,deploymentId:'markets-v2'}};
 assert.deepEqual(typesFor(v2),['next_hour','hour_plus_24','day_plus_7']);
 assert.equal(typeIndex('day_plus_2',config),1);assert.throws(()=>typeIndex('next_hour',config));
 const body={deploymentId:'markets-v3',roundId:'1',marketType:'day_plus_1',guess:'100',optionId:'four'};
 assert.deepEqual(normalizeMarketPurchase(body,config),body);
 for(const marketType of ['next_hour','hour_plus_24','24h'])assert.throws(()=>normalizeMarketPurchase({...body,marketType},config),/MARKET_CHANGED/);
 assert.throws(()=>normalizeMarketPurchase({...body,deploymentId:'markets-v2'},config),/MARKET_CHANGED/);
 const doc={version:3,source:'sample',chainId:5042002,contract:C,roundId:'1',horizon:'day_plus_1',musicId:'demo:last-bus-home',windowStart:'100',windowEnd:'200',actualViews:'123'};
 assert.deepEqual(canonicalEvidence(doc),doc);assert.throws(()=>canonicalEvidence({...doc,version:2}),/BAD_REQUEST/);
});
test('V2 scheduler creates no further rounds',async()=>{
 let calls=0;const s=createMarketScheduler({config:{...config,deployment:{marketModelVersion:2}},chain:{verify:async()=>calls++},admin:{operator:async()=>calls++},signer:A});
 await s.tick();assert.equal(calls,0);
});
test('hourly retirement previews without mutation and queues only unfinished hourly pools',async()=>{
 const jobs=[],chain={verify:async()=>{},snapshot:async()=>({number:5n}),rounds:async()=>[{id:'1',cadence:'hourly'},{id:'2',cadence:'daily'}],readPool:async(_id,horizon)=>({phase:horizon==='next_hour'?0:4,entryCount:1n,totalDeposits:5000000000000000000n})};
 const admin={operator:async(kind,_wallet,signer,payload)=>{jobs.push({kind,signer,payload});return {id:'job-1'};}};
 const preview=await retireHourly({chain,admin,signer:A});assert.equal(preview.pools.length,1);assert.equal(jobs.length,0);
 const queued=await retireHourly({chain,admin,signer:A,execute:true});assert.equal(queued.pools[0].jobId,'job-1');assert.equal(jobs[0].payload.horizon,'next_hour');assert.match(jobs[0].payload.reason,/Full entry refunds/);
});
test('daily catalog verifies every indexed window against chain and blocks corrupted data',async()=>{
 const now=austinMidnight('2026-11-20')+3600000,start=austinMidnight('2026-11-20'),end=austinMidnight('2026-11-21');let corrupt=false;
 const row={id:'1',songId:SONG_ID,musicId:'demo:last-bus-home',artist:ORIGINAL_OWNER,startSeconds:String(start/1000),deadlineSeconds:String(end/1000),cadence:'daily'};
 const chain={verify:async()=>{},snapshot:async()=>({number:10n,timestamp:BigInt(now/1000)}),counters:async()=>({nextRoundId:2n,nextEntryId:1n}),readRound:async()=>({...row,exists:true,start:BigInt(start/1000),deadline:BigInt(end/1000),cadence:1}),readPool:async(_id,type)=>{const s=scheduleFor(type,start,3);return {windowStart:BigInt(s.windowStart/1000),windowEnd:BigInt(s.windowEnd/1000),refundAt:BigInt(s.refundAt/1000),phase:0,entryCount:0n,spotCount:0n,peopleCount:0n,totalDeposits:0n};}};
 const store={catalog:async()=>({roundCount:'1',maxRoundId:'1',entryCount:'0',rounds:[row]}),round:async(_b,pools)=>Object.fromEntries(Object.keys(pools).map(h=>[h,{entryCount:'0',spotCount:'0',peopleCount:'0',totalDeposits:'0'}])),schedule:async(id,index)=>{const type=MARKET_TYPES[index].id,s=scheduleFor(type,start);return {pool:livePoolId(id,type,config),windowStart:String(s.windowStart/1000+(corrupt?1:0)),windowEnd:String(s.windowEnd/1000),refundAt:String(s.refundAt/1000)};}};
 const live=createLiveContests({config,chain,store,clock:()=>now,cacheMs:0}),api=createMarkets({config,live,deployments:[config]});
 const c=await api.catalog();assert.equal(c.marketModelVersion,3);assert.equal(c.markets.length,3);assert.deepEqual(c.markets.map(m=>m.marketType),MARKET_TYPES.map(t=>t.id));
 assert.equal((await api.detail('markets-v3','1','day_plus_2')).windowStart,austinMidnight('2026-11-22'));
 await assert.rejects(api.detail('markets-v3','1','next_hour'),/ROUND_UNAVAILABLE/);
 corrupt=true;const stale=await live.round('1');assert.equal(stale.snapshot.syncStatus,'catching_up');
});
