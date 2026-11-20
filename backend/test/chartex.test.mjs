import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,toBytes} from 'viem';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {DEMO_SONG} from '../../shared/demo-song.js';
import {parseDaily,createChartexClient,stableObservation,createChartexCollector,createChartexResults,responseHash} from '../src/chartex.js';
import {canonicalEvidence,settlementCall} from '../src/settlement.js';
import {resultPolicy,songHash,samePolicy} from '../src/song-policy.js';
import {scheduleFor,HOUR} from '../../shared/market-schedule.js';
import {ORIGINAL_OWNER} from '../src/config.js';
const raw=rows=>JSON.stringify({data:{song_name:DEMO_SONG.title,statistics:rows}}),start='2026-11-01',end='2026-11-02';
test('Chartex keeps zero distinct from missing and signed video-use changes; rejects invalid identity/dates',()=>{
 const r=parseDaily(raw([{date:start,'tiktok-video-views':0,'tiktok-creates':-9},{date:end,'tiktok-video-views':null}]),start,end);
 assert.equal(r.rows[0].views,'0');assert.equal(r.rows[0].metrics['tiktok-creates'],-9);assert.equal(r.rows[1].views,null);assert.equal(parseDaily(raw([]),start,end).rows.length,2);assert.equal(parseDaily(raw([]),start,end).rows[0].views,null);
 for(const n of [-1,0.4,Number.MAX_SAFE_INTEGER+1,'4'])assert.equal(parseDaily(raw([{date:start,'tiktok-video-views':n}]),start,end).rows[0].views,null);
 for(const value of ['{}','not json',raw([{date:start},{date:start}]),raw([{date:'2026-02-30'}]),raw([{date:'2026-10-31'}])])assert.throws(()=>parseDaily(value,start,end));
});
test('credentials stay in headers; access/quota/timeout failures never expose secrets',async()=>{
 const config={chartexAppId:'id-private',chartexAppToken:'secret-private'};
 const c=createChartexClient(config,{fetcher:async(url,o)=>{assert.ok(!url.includes('secret-private'));assert.equal(o.headers['X-APP-TOKEN'],'secret-private');return new Response(raw([{date:start,'tiktok-video-views':14}]));}});
 assert.equal((await c.history(start,end)).rows[0].views,'14');
 for(const [status,code]of [[401,'CHARTEX_ACCESS_REQUIRED'],[403,'CHARTEX_ACCESS_REQUIRED'],[429,'CHARTEX_RATE_LIMITED'],[500,'CHARTEX_UNAVAILABLE']])await assert.rejects(createChartexClient(config,{fetcher:async()=>new Response('secret-private',{status})}).history(start,end),e=>e.code===code&&!e.message.includes('secret-private'));
 await assert.rejects(createChartexClient(config,{fetcher:async()=>{throw Error('secret-private');}}).history(start,end),/CHARTEX_UNAVAILABLE/);
 await assert.rejects(createChartexClient(config,{fetcher:async()=>new Response('secret-private')}).history(start,end),/CHARTEX_INVALID_DATA/);
});
test('stability waits six hours after the delay; any intervening revision/missing count resets it',()=>{
 const at=100*HOUR,r=(n,v='20')=>({observed_at:new Date(at+n*HOUR).toISOString(),views:v});
 for(const rows of [[r(-1),r(6)],[r(0),r(5)],[r(0),r(3,'21'),r(6)],[r(0),r(3,null),r(6)]])assert.equal(stableObservation(rows,at),null);
 assert.equal(stableObservation([r(0),r(6)],at).length,2);assert.equal(stableObservation([r(6,'0'),r(12,'0')],at)[1].views,'0');
});
test('collector lease prevents repeat requests and diagnostics omit raw provider failures',async()=>{
 let claimed=false,requests=0,saved=0;const logs=[];
 const store={claim:async()=>!claimed&&(claimed=true),metadata:async()=>({document:{}}),finish:async(_w,r)=>{if(r)saved++;}};
 const config={chartexEnabled:true,chartexAppId:'id',chartexAppToken:'secret'};
 const collector=createChartexCollector({config,store,client:{history:async()=>{requests++;return {}; }}});
 await collector.tick();await collector.tick();assert.equal(requests,1);assert.equal(saved,1);
 claimed=false;await createChartexCollector({config,store,client:{history:async()=>{throw Error('secret');}},log:x=>logs.push(x)}).tick();assert.equal(saved,1);assert.ok(!JSON.stringify(logs).includes('secret'));
});
test('results freeze validated observations once, reject missing counts and stop at the refund cutoff',async()=>{
 const s=scheduleFor('day_plus_1',Date.parse('2026-11-20T18:00:00Z')),r={id:'10',songId:DEMO_SONG.id,musicId:DEMO_SONG.musicId,artist:ORIGINAL_OWNER,start:s.entryStart,cadence:'daily'},policy=resultPolicy({...r,songId:undefined},'day_plus_1');
 let now=s.windowEnd+30*HOUR,jobs=[],saved=[],observations=[24,30].map(n=>({collection_id:randomUUID(),observed_at:new Date(s.windowEnd+n*HOUR).toISOString(),response_hash:'a'.repeat(64),views:'42'}));
 const pool={phase:0,windowStart:BigInt(s.windowStart/1000),windowEnd:BigInt(s.windowEnd/1000),refundAt:BigInt(s.refundAt/1000)},config={chartexEnabled:true,settlementEnabled:true,deployment:{marketModelVersion:3},chainId:5042002,contract:'0x'+'a'.repeat(40)};
 const coordinator=createChartexResults({config,chain:{snapshot:async()=>({number:1n,timestamp:BigInt(now/1000)}),readPool:async(_id,t)=>t==='day_plus_1'?pool:{...pool,phase:4}},live:{catalog:async()=>({snapshot:{syncStatus:'current'},rounds:[r]})},data:{candidate:async()=>null,freeze:async(_r,_t,h,d)=>({evidence_hash:h,document:d}),policy:async()=>policy,observations:async()=>observations},evidence:{save:async d=>{saved.push(d);return keccak256(toBytes(JSON.stringify(d))); }},admin:{pendingSettlement:async()=>jobs.length>0,operator:async(...args)=>jobs.push(args)},signer:'0x'+'c'.repeat(40),clock:()=>now});
 await coordinator.tick();await coordinator.tick();assert.equal(jobs.length,1);assert.equal(saved[0].source,'chartex');assert.equal(canonicalEvidence(saved[0]).actualViews,'42');assert.equal(settlementCall({kind:'submit-result',payload:jobs[0][3]},config).functionName,'submitResult');
 jobs=[];observations=[];await coordinator.tick();assert.equal(jobs.length,0);now=s.refundAt-HOUR;await coordinator.tick();assert.equal(jobs.length,0);assert.ok(samePolicy(policy,Object.fromEntries(Object.entries(policy).reverse())));
});
test('migration 008: observations remain private, leases survive retries and policies are immutable',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const f of ['001_account_approvals','002_atomic_payments','003_quicknode_events','004_live_contest_reads','005_results_and_claims','006_market_schedules','007_daily_markets','008_chartex_demo'])await db.exec(await readFile(new URL('../supabase/'+f+'.sql',import.meta.url),'utf8'));
 const rpc=async(n,a=[])=> (await db.query(`select public.${n}(${a.map((_,i)=>'$'+(i+1)).join(',')}) as v`,a.map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].v;
 const worker=randomUUID();assert.equal(await rpc('music_step7_status'),1);assert.equal(await rpc('music_data_claim',[DEMO_SONG.id,worker]),true);assert.equal(await rpc('music_data_claim',[DEMO_SONG.id,randomUUID()]),false);
 const body=raw([{date:start,'tiktok-video-views':0},{date:end,'tiktok-video-views':null}]);await rpc('music_data_finish',[DEMO_SONG.id,worker,{...parseDaily(body,start,end),raw:body,hash:responseHash(body),fetchedAt:new Date().toISOString(),start,end},null]);assert.equal(await rpc('music_data_claim',[DEMO_SONG.id,randomUUID()]),false);
 const rows=(await db.query('select views from music_daily_observations order by report_date')).rows;assert.equal(String(rows[0].views),'0');assert.equal(rows[1].views,null);
 const policy=resultPolicy({id:'1',songId:songHash(DEMO_SONG),musicId:DEMO_SONG.musicId,artist:ORIGINAL_OWNER,start:Date.parse('2026-11-20T06:00:00Z')},'day_plus_1'),address='0x'+'a'.repeat(40);
 assert.equal(await rpc('music_bind_result_policy',[address,'1','day_plus_1',policy]),true);assert.equal(await rpc('music_bind_result_policy',[address,'1','day_plus_1',policy]),true);await assert.rejects(rpc('music_bind_result_policy',[address,'1','day_plus_1',{...policy,targetDate:'2026-11-22'}]),/POLICY_IMMUTABLE/);
 const frozen={source:'chartex',contract:address,roundId:'1',horizon:'day_plus_1',policy,actualViews:'42'};
 const first=await rpc('music_freeze_result',[address,'1','day_plus_1','0x'+'a'.repeat(64),frozen]);const second=await rpc('music_freeze_result',[address,'1','day_plus_1','0x'+'b'.repeat(64),{...frozen,actualViews:'99'}]);assert.equal(first.evidence_hash,second.evidence_hash);assert.equal(second.document.actualViews,'42');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const table of ['music_data_collections','music_round_rules','music_daily_observations'])await assert.rejects(db.exec('select * from '+table),/permission denied/);await assert.rejects(rpc('music_step7_status'),/permission denied/);await db.exec('reset role');}
});
test('restart reuses a frozen result after a queue failure and later provider revision',async()=>{
 const s=scheduleFor('day_plus_1',Date.parse('2026-11-20T18:00:00Z')),r={id:'12',songId:DEMO_SONG.id,musicId:DEMO_SONG.musicId,artist:ORIGINAL_OWNER,start:s.entryStart,cadence:'daily'},policy=resultPolicy({...r,songId:undefined},'day_plus_1');
 const now=s.windowEnd+30*HOUR,config={chartexEnabled:true,settlementEnabled:true,deployment:{marketModelVersion:3},chainId:5042002,contract:'0x'+'a'.repeat(40)};
 const p={phase:0,windowStart:BigInt(s.windowStart/1000),windowEnd:BigInt(s.windowEnd/1000),refundAt:BigInt(s.refundAt/1000)};
 let frozen=null,failQueue=true,observationReads=0;const jobs=[];
 const args={config,chain:{snapshot:async()=>({number:1n,timestamp:BigInt(now/1000)}),readPool:async(_r,t)=>t==='day_plus_1'?p:{...p,phase:4}},live:{catalog:async()=>({snapshot:{syncStatus:'current'},rounds:[r]})},data:{policy:async()=>policy,candidate:async()=>frozen,freeze:async(_r,_t,h,d)=>(frozen??={evidence_hash:h,document:d}),observations:async()=>{observationReads++;return [24,30].map(h=>({collection_id:randomUUID(),observed_at:new Date(s.windowEnd+h*HOUR).toISOString(),response_hash:'a'.repeat(64),views:failQueue?'42':'99'}));}},evidence:{save:async d=>keccak256(toBytes(JSON.stringify(d)))},admin:{pendingSettlement:async()=>false,operator:async(...a)=>{if(failQueue)throw Error('transient');jobs.push(a);}},signer:'0x'+'c'.repeat(40)};
 await createChartexResults(args).tick();assert.ok(frozen);const hash=frozen.evidence_hash;failQueue=false;await createChartexResults(args).tick();assert.equal(observationReads,1);assert.equal(jobs[0][3].actualViews,'42');assert.equal(jobs[0][3].evidenceHash,hash);
});
test('Chartex target dates follow Austin midnight across both daylight-saving changes',()=>{
 for(const [at,dates]of [
  ['2026-11-01T04:59:59Z',['2026-11-01','2026-11-02','2026-11-07']],
  ['2026-11-01T05:00:00Z',['2026-11-02','2026-11-03','2026-11-08']],
  ['2027-03-14T05:59:59Z',['2027-03-14','2027-03-15','2027-03-20']],
  ['2027-03-14T06:00:00Z',['2027-03-15','2027-03-16','2027-03-21']]]){
  const s=scheduleFor('day_plus_1',Date.parse(at)),r={songId:songHash(DEMO_SONG),musicId:DEMO_SONG.musicId,artist:ORIGINAL_OWNER,start:s.entryStart};
  assert.deepEqual(['day_plus_1','day_plus_2','day_plus_7'].map(t=>resultPolicy(r,t).targetDate),dates);
 }
});
