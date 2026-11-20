import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {PGlite} from '@electric-sql/pglite';
import {encodeEventTopics,encodeAbiParameters} from 'viem';
import {CONTEST_ABI,SONG_ID} from '../src/contest-chain.js';
import {ORIGINAL_OWNER} from '../src/config.js';
import {createLiveStore} from '../src/live-store.js';
import {createLiveContests,livePoolId} from '../src/live-contests.js';
import {createHandler} from '../src/http.js';
import {AppError} from '../src/errors.js';

const C='0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083',A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
const unit=10n**18n,firstBlock=73100560n;
const safe=value=>JSON.parse(JSON.stringify(value,(_key,v)=>typeof v==='bigint'?v.toString():v));
const identity=wallet=>({userId:'did:privy:'+wallet.slice(-4),wallet});
const tx=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');

async function fixture(t) {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const name of ['003_quicknode_events.sql','004_live_contest_reads.sql'])await db.exec(await readFile(new URL('../supabase/'+name,import.meta.url),'utf8'));
 async function rpc(name,params){try{const args=Object.values(params).map(v=>v&&typeof v==='object'?JSON.stringify(v):v);const r=await db.query(`select public.${name}(${args.map((_v,i)=>'$'+(i+1)).join(',')}) as value`,args);return {data:r.rows[0].value,error:null};}catch(error){return {data:null,error};}}
 const store=createLiveStore({rpc},C),entries=new Map(),receipts=new Map();
 const start=BigInt(Math.floor(Date.now()/3600000)*3600),pool=livePoolId('1','24h');
 let clock=Date.now(),phase=0,timestamp=start+100n,offline=false,dbOffline=false,nonce=0;
 function event(name,args,block,hash,index=0){
  const abi=CONTEST_ABI.find(e=>e.type==='event'&&e.name===name);
  const topics=encodeEventTopics({abi:CONTEST_ABI,eventName:name,args});
  const plain=abi.inputs.filter(i=>!i.indexed),data=encodeAbiParameters(plain,plain.map(i=>args[i.name]));
  const raw={address:C,blockNumber:block,blockHash:tx(block),transactionHash:hash,logIndex:index,topics,data,removed:false};
  return {block_number:block.toString(),block_hash:tx(block),transaction_hash:hash,log_index:index,event_name:name,args:safe(args),raw_log:{...safe(raw),blockNumber:'0x'+block.toString(16),logIndex:'0x'+index.toString(16)}};
 }
 async function ingest(rows){const r=await rpc('music_ingest_chain_events',{p_nonce:'fixture:'+nonce++,p_hash:'a'.repeat(64),p_metadata:{},p_events:rows});if(r.error)throw r.error;}
 await ingest([event('RoundCreated',{roundId:1n,songId:SONG_ID,musicId:'demo:last-bus-home',artist:ORIGINAL_OWNER,start},firstBlock,tx(99999999))]);
 async function add({payer=A,guess=100n,spots=1,records=1,hash=tx(entries.size+1),persist=true}={}) {
  const block=firstBlock+BigInt(entries.size+2),rows=[],logs=[];
  let ticket=BigInt([...entries.values()].reduce((sum,e)=>sum+e.spots,0));
  for(let i=0;i<records;i++){
   const id=BigInt(entries.size+1),paid=BigInt(spots)*5n*unit;
   const value={roundId:1n,horizon:0,pool,payer,guess,paid,purchasedAt:start+10n,spots,multiplierBps:spots===10?10500:10000,firstTicketId:ticket,claimed:false};
   entries.set(id.toString(),value);
   const row=event('EntryRecorded',{entryId:id,pool,payer,guess,paid,firstTicketId:ticket,spots,purchasedAt:start+10n},block,hash,i);
   rows.push(row);logs.push({...row.raw_log,blockNumber:block,logIndex:i});ticket+=BigInt(spots);
  }
  receipts.set(hash,{status:'success',blockNumber:block,blockHash:tx(block),logs});
  if(persist)await ingest(rows);return rows;
 }
 const chain={
  verify:async()=>{if(offline)throw Error('RPC offline');},
  snapshot:async number=>{if(offline)throw Error('RPC offline');return {number:number??firstBlock+10000n,hash:tx(number??firstBlock+10000n),timestamp};},
  counters:async()=>({nextRoundId:2n,nextEntryId:BigInt(entries.size+1)}),
  readRound:async()=>({exists:true,songId:SONG_ID,musicId:'demo:last-bus-home',artist:ORIGINAL_OWNER,start}),
  readPool:async(_id,h)=>{
   const all=h==='24h'?[...entries.values()]:[],offset={'24h':0n,'48h':24n,week:144n}[h];
   return {phase,roundId:1n,horizon:0,windowStart:start+offset*3600n,windowEnd:start+(offset+24n)*3600n,refundAt:start+(offset+72n)*3600n,
    entryCount:BigInt(all.length),spotCount:all.reduce((n,e)=>n+BigInt(e.spots),0n),peopleCount:BigInt(new Set(all.map(e=>e.payer.toLowerCase())).size),totalDeposits:all.reduce((n,e)=>n+e.paid,0n)};
  },
  receipt:async hash=>receipts.get(hash),readEntry:async id=>entries.get(String(id)),
  readOutcome:async()=>({mainRank:1n,winningSpots:1n,losingSpots:0n,neutralSpots:0n,returned:941n*unit/100n,artistFee:9n*unit/100n,appFee:0n}),
  claimable:async id=>entries.get(String(id)).claimed?0n:phase===4?941n*unit/100n:entries.get(String(id)).paid,
 };
 const guardedStore={catalog:(...args)=>{if(dbOffline)throw new AppError('LIVE_DATA_UNAVAILABLE');return store.catalog(...args);},round:(...args)=>store.round(...args),entries:(...args)=>store.entries(...args)};
 const service=(overrides={})=>createLiveContests({config:{atomic:true,chainId:5042002,contract:C},store:{...guardedStore,...overrides},chain,clock:()=>clock,cacheMs:0});
 return {db,store,chain,service,entries,receipts,start,add,ingest,event,rpc,A,B,C,
  advance:()=>{clock+=20000;},setPhase:p=>{phase=p;},setTimestamp:t=>{timestamp=t;},setOffline:v=>{offline=v;},setDbOffline:v=>{dbOffline=v;}};
}

test('live reads: exact prices, spot-weighted predictions and actual empty pools',async t=>{
 const f=await fixture(t),live=f.service();
 assert.equal((await live.catalog()).rounds.length,1);
 const empty=(await live.round('1')).pools['24h'];assert.equal(empty.spotCount,'0');assert.equal(empty.averageGuess,null);assert.equal(empty.mode,null);
 await f.add();await f.add({guess:120n,records:4});await f.add({guess:150n,spots:10});live.invalidate();
 const result=await live.round('1'),p=result.pools['24h'];
 assert.equal(p.entryCount,'6');assert.equal(p.spotCount,'15');assert.equal(p.peopleCount,'1');assert.equal(p.totalDeposits,(75n*unit).toString());
 assert.equal(p.averageGuess,'138.67');assert.equal(p.mode,'150');assert.equal(p.modeSpots,'10');assert.equal(result.snapshot.syncStatus,'current');
 assert.equal(result.pools.week.spotCount,'0');
 await f.add({payer:B,guess:100n});live.invalidate();assert.equal((await live.round('1')).pools['24h'].peopleCount,'2');
 const mine=await live.entries(identity(A));assert.equal(mine.groups.length,3);assert.equal(mine.groups.find(g=>g.spotCount==='4').entries.length,4);
 assert.equal((await live.entries(identity(B))).groups.length,1);
});

test('SQL aggregation has no 1,000-record cap and keeps uint256 guesses exact',async t=>{
 const f=await fixture(t),rows=[];
 for(let i=0;i<1002;i++)rows.push(...await f.add({guess:2n**200n+BigInt(i%2),persist:false}));
 await f.ingest(rows);
 const p=(await f.service().round('1')).pools['24h'];
 assert.equal(p.entryCount,'1002');assert.equal(p.spotCount,'1002');assert.equal(p.mode,(2n**200n).toString());
 assert.equal(p.averageGuess,(2n**200n).toString()+'.50');assert.equal(p.average,null);
});

test('last verified totals survive indexing delays and outages; no samples or false zeroes',async t=>{
 const f=await fixture(t),live=f.service();await f.add();
 const before=await live.round('1');const delayed=await f.add({payer:B,persist:false});
 assert.equal((await live.round('1')).snapshot.syncStatus,'catching_up');assert.equal((await live.round('1')).pools['24h'].spotCount,'1');
 await assert.rejects(f.service().round('1'),{code:'LIVE_DATA_UPDATING'});
 await f.ingest(delayed);live.invalidate();assert.equal((await live.round('1')).pools['24h'].spotCount,'2');
 f.setDbOffline(true);assert.equal((await live.round('1')).snapshot.syncStatus,'unavailable');
 assert.equal((await live.round('1')).pools['24h'].spotCount,'2');
 f.setDbOffline(false);f.setOffline(true);f.advance();assert.equal((await live.round('1')).snapshot.chainAvailable,false);
 f.setOffline(false);f.advance();assert.equal((await live.round('1')).snapshot.syncStatus,'current');
 assert.ok(before.snapshot.verifiedAt);
});

test('upcoming and closed entry windows do not depend on a fabricated current hour',async t=>{
 const f=await fixture(t);f.setTimestamp(f.start-1n);assert.equal((await f.service().catalog()).rounds[0].entryStatus,'upcoming');
 assert.equal((await f.service().round('1')).pools['24h'].open,false);
 f.setTimestamp(f.start);assert.equal((await f.service().round('1')).pools['24h'].open,true);
 f.setTimestamp(f.start+3600n);assert.equal((await f.service().catalog()).rounds[0].entryStatus,'closed');assert.equal((await f.service().round('1')).pools['24h'].open,false);
 await assert.rejects(f.service().round('2'),{status:404});
});

test('history separates lifecycle status, claims, partial claims and actual received amounts',async t=>{
 const f=await fixture(t);await f.add({records:4});const live=f.service(),who=identity(A);
 assert.equal((await live.entries(who)).groups[0].contestStatus,'awaiting_result');
 f.setPhase(1);live.invalidate();assert.equal((await live.entries(who)).groups[0].contestStatus,'settling');
 f.setPhase(4);live.invalidate();const claimable=(await live.entries(who)).groups[0];
 assert.equal(claimable.contestStatus,'claimable');assert.equal(claimable.receivedAmount,'0');assert.equal(claimable.claimableAmount,(3764n*unit/100n).toString());
 f.entries.get('1').claimed=true;live.invalidate();const partial=(await live.entries(who)).groups[0];
 assert.equal(partial.contestStatus,'partially_claimed');assert.equal(partial.receivedAmount,(941n*unit/100n).toString());assert.equal(partial.realizedNet,(441n*unit/100n).toString());
 for(const e of f.entries.values())e.claimed=true;live.invalidate();assert.equal((await live.entries(who)).groups[0].contestStatus,'claimed');
 for(const e of f.entries.values())e.claimed=false;f.setPhase(5);live.invalidate();assert.equal((await live.entries(who)).groups[0].contestStatus,'refundable');
 for(const e of f.entries.values())e.claimed=true;live.invalidate();const refund=(await live.entries(who)).groups[0];assert.equal(refund.contestStatus,'refunded');assert.equal(refund.realizedNet,'0');
 f.setPhase(0);for(const e of f.entries.values())e.claimed=false;f.setTimestamp(f.start+72n*3600n);live.invalidate();assert.equal((await live.entries(who)).groups[0].contestStatus,'refundable');
});

test('history uses account-bound cursors, retains whole transactions and hides partial indexed $20 groups',async t=>{
 const f=await fixture(t);for(let i=0;i<12;i++)await f.add();const live=f.service(),who=identity(A);
 const first=await live.entries(who);assert.equal(first.groups.length,10);assert.ok(first.nextCursor);
 const last=await live.entries(who,first.nextCursor);assert.equal(last.groups.length,2);assert.equal(last.nextCursor,null);
 assert.equal(new Set([...first.groups,...last.groups].map(g=>g.transactionHash)).size,12);
 await assert.rejects(live.entries(identity(B),first.nextCursor),{status:400});
 await assert.rejects(live.entries(who,'invalid'),{status:400});
 const rows=await f.add({records:4,persist:false});await f.ingest(rows.slice(0,2));live.invalidate();
 const pending=await live.entries(who);assert.equal(pending.snapshot.syncStatus,'catching_up');assert.ok(!pending.groups.some(g=>g.transactionHash===rows[0].transaction_hash));
 await f.ingest(rows.slice(2));live.invalidate();assert.equal((await live.entries(who)).groups[0].entries.length,4);
});

test('read views/functions are backend-only, and HTTP routes derive the account server-side',async t=>{
 const f=await fixture(t);await f.add();
 for(const role of ['anon','authenticated']){
  await f.db.exec('set role '+role);
  for(const view of ['music_live_rounds','music_live_entries','music_live_claims'])await assert.rejects(f.db.query('select * from public.'+view),/permission denied/);
  assert.ok((await f.rpc('music_live_catalog',{p_contract:C,p_block:'73110560'})).error);
  await f.db.exec('reset role');
 }
 await f.db.exec('set role service_role');assert.equal((await f.store.catalog(73110560n)).rounds.length,1);await f.db.exec('reset role');
 const live=f.service();
 const server=createServer(createHandler({contests:live,purchases:{catalog:()=>live.catalog()},authenticate:async token=>{if(token==='Bearer a')return identity(A);if(token==='Bearer b')return identity(B);throw new AppError('AUTH_REQUIRED',401);}}));
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());const root='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(root+'/api/contests/1')).status,200);
 assert.equal((await fetch(root+'/api/contests/1/pools/24h')).status,200);
 assert.equal((await fetch(root+'/api/account/entries')).status,401);
 const req=(path,token='a',method='GET')=>fetch(root+path,{method,headers:{Authorization:'Bearer '+token}});
 assert.equal((await (await req('/api/account/entries')).json()).groups.length,1);
 assert.equal((await (await req('/api/account/entries','b')).json()).groups.length,0);
 assert.equal((await req('/api/account/entries?wallet='+A)).status,400);
 assert.equal((await req('/api/account/entries?cursor=x&cursor=y')).status,400);
 assert.equal((await req('/api/account/entries','a','POST')).status,405);
 assert.equal((await req('/api/admin/settle','a','POST')).status,404);
});


test('verified collection receipts distinguish this account from other recipients and retain history during indexing lag',async t=>{
 const f=await fixture(t);await f.add();f.setPhase(4);const entry=f.entries.get('1'),amount=941n*unit/100n;
 let records=[];const live=f.service({claimRecords:async()=>records});
 const initial=await live.entries(identity(A));assert.equal(initial.groups[0].claimableAmount,amount.toString());
 entry.claimed=true;f.advance();const lag=await live.entries(identity(A));assert.equal(lag.snapshot.syncStatus,'catching_up');assert.equal(lag.groups[0].receivedAmount,'0');
 const block=73100600n,hash=tx(7654321);const row=f.event('EntryClaimed',{entryId:1n,recipient:B,amount,refund:false},block,hash);
 f.receipts.set(hash,{status:'success',blockNumber:block,blockHash:tx(block),logs:[row.raw_log]});
 records=[{entryId:'1',amount:amount.toString(),refund:false,recipient:B,transactionHash:hash,block:block.toString(),blockHash:tx(block)}];
 f.advance();const other=await live.entries(identity(A));assert.equal(other.snapshot.syncStatus,'current');assert.equal(other.groups[0].contestStatus,'collected_elsewhere');assert.equal(other.groups[0].receivedAmount,'0');assert.equal(other.groups[0].realizedNet,'0');
 records[0].amount='1';f.advance();const bad=await live.entries(identity(A));assert.equal(bad.snapshot.syncStatus,'unavailable');assert.equal(bad.groups[0].receivedAmount,'0');
});
