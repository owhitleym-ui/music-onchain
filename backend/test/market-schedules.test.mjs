import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleFor,austinMidnight,desiredRounds,assertSchedule,HOUR,DAY,marketKey} from '../../shared/market-schedule.js';
import {createMarketScheduler,creationCall} from '../src/market-scheduler.js';
import {normalizeMarketPurchase} from '../src/purchases.js';
import {canonicalEvidence} from '../src/settlement.js';
import {SONG_ID} from '../src/contest-chain.js';
const S='0x'+'a'.repeat(40),C='0x'+'c'.repeat(40),config={schedulerEnabled:true,deployment:{marketModelVersion:2,deploymentId:'markets-v2'}};
test('hourly bidding and target periods are independent, exact and exclusive',()=>{
 const now=Date.parse('2026-11-20T18:30:00Z'),a=scheduleFor('next_hour',now),b=scheduleFor('hour_plus_24',now);
 assert.equal(a.entryStart,Date.parse('2026-11-20T18:00:00Z'));assert.equal(a.entryEnd,a.entryStart+HOUR);
 assert.equal(a.windowStart,a.entryEnd);assert.equal(a.windowEnd,a.entryEnd+HOUR);
 assert.equal(b.windowStart,a.entryStart+DAY);assert.equal(b.windowEnd,b.windowStart+HOUR);
 assert.equal(scheduleFor('next_hour',a.entryEnd).entryStart,a.entryEnd);
 assert.throws(()=>assertSchedule({...a,windowStart:a.entryStart}),/SCHEDULE_MISMATCH/);
});
test('Austin calendar dates handle leap years, both DST boundaries and repeated hours',()=>{
 for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25],['2028-02-29',24]]){
  const start=austinMidnight(date),s=scheduleFor('day_plus_7',start);assert.equal((s.entryEnd-start)/HOUR,hours);
  const before=scheduleFor('day_plus_7',start-7*DAY);assert.ok([23,24,25].includes(before.durationHours));
 }
 const spring=scheduleFor('day_plus_7',austinMidnight('2026-03-01'));assert.equal(spring.durationHours,23);assert.equal(spring.windowStart,austinMidnight('2026-03-08'));
 const fall=scheduleFor('day_plus_7',austinMidnight('2026-10-25'));assert.equal(fall.durationHours,25);assert.equal(fall.windowEnd,austinMidnight('2026-11-02'));
 const a=scheduleFor('next_hour',Date.parse('2026-11-01T06:30Z')),b=scheduleFor('next_hour',Date.parse('2026-11-01T07:30Z'));assert.equal(b.entryStart-a.entryStart,HOUR);
 assert.equal(scheduleFor('hour_plus_24',Date.parse('2026-03-08T07:30Z')).windowStart,Date.parse('2026-03-09T07:00Z'));
});
test('daily scheduler resumes the current Austin day and queues the next day without hourly rounds',async()=>{
 let now=Date.parse('2026-11-20T18:30Z'),queued=new Map(),existing=new Set(),calls=0,active=true;const config2={...config,deployment:{marketModelVersion:3,deploymentId:'markets-v3'}};
 const chain={verify:async()=>{},snapshot:async()=>({number:1n,timestamp:BigInt(now/1000)}),readContract:async(_name,args)=>existing.has(args[1]+':'+args[2])?1n:0n};
 const admin={operator:async(kind,_wallet,_signer,payload)=>{calls++;queued.set(kind+':'+payload.start,payload);creationCall({kind,payload},config2);}};
 const scheduler=createMarketScheduler({config:config2,chain,admin,signer:S,assertActive:async()=>{if(!active)throw Error('inactive');}});
 await scheduler.tick();assert.equal(queued.size,2);assert.equal([...queued.values()].filter(p=>p.deadline-p.start===3600).length,0);
 const schedule=scheduleFor('day_plus_1',now);const current=[...queued.values()].find(p=>p.start===schedule.entryStart/1000);assert.equal(current.deadline,schedule.entryEnd/1000);assert.deepEqual(current.excluded,[S]);
 await scheduler.tick();assert.equal(queued.size,2);assert.equal(calls,4); // DB operator deduplicates these exact jobs.
 for(const s of desiredRounds(now))existing.add((s.cadence==='hourly'?0:1)+':'+s.entryStart/1000);
 await scheduler.tick();assert.equal(calls,4);
 now=schedule.entryEnd;await scheduler.tick();assert.equal(queued.size,3);assert.equal(calls,5);
 active=false;await scheduler.tick();assert.equal(calls,5);assert.ok(scheduler.status().error);
 config2.schedulerEnabled=false;await scheduler.tick();assert.equal(calls,5);
});
test('new purchase/evidence identity never aliases a legacy type or another deployment',()=>{
 const request={deploymentId:'markets-v2',roundId:'1',marketType:'next_hour',guess:'0',optionId:'four'};
 assert.deepEqual(normalizeMarketPurchase(request,config),request);
 assert.throws(()=>normalizeMarketPurchase({...request,deploymentId:'atomic-v1'},config),/MARKET_CHANGED/);
 assert.throws(()=>normalizeMarketPurchase({...request,marketType:'24h'},config),/MARKET_CHANGED/);
 assert.notEqual(marketKey('atomic-v1','1','next_hour'),marketKey('markets-v2','1','next_hour'));
 const doc={version:2,source:'sample',chainId:5042002,contract:C,roundId:'1',horizon:'next_hour',musicId:'demo:last-bus-home',windowStart:'100',windowEnd:'200',actualViews:'0'};
 assert.deepEqual(canonicalEvidence(doc),doc);assert.throws(()=>canonicalEvidence({...doc,version:1}),/BAD_REQUEST/);
});
