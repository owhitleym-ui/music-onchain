import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {keccak256,toBytes} from 'viem';
import {canonicalEvidence,createSettlementStore,createSettlementCoordinator,settlementCall,assertSettlementCurrent,prepareResult} from '../src/settlement.js';
import {createLiveStore} from '../src/live-store.js';
import {createClaimService} from '../src/claims.js';
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083',S='0x'+'1'.repeat(40);
const identity={userId:'did:privy:one',wallet:A};
test('migration 005 preserves old orders and serializes purchases with claims',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const file of ['001_account_approvals','002_atomic_payments','003_quicknode_events','004_live_contest_reads'])await db.exec(await readFile(new URL('../supabase/'+file+'.sql',import.meta.url),'utf8'));
 const rpc=async(name,args=[])=>{const r=await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v));return r.rows[0].value;};
 const legacy=await rpc('music_purchase_create',['did:privy:legacy',B,C,randomUUID(),{roundId:'1',horizon:'24h',guess:'1',optionId:'single'},{nonce:0},new Date(Date.now()+120000).toISOString(),{}]);
 await db.exec(await readFile(new URL('../supabase/005_results_and_claims.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select action_kind from music_purchase_orders where id=$1',[legacy.id])).rows[0].action_kind,'purchase');
 const expires=new Date(Date.now()+120000).toISOString(),q={nonce:0,value:'0'},request={entryId:'1'};
 const make=key=>rpc('music_wallet_action_create',[identity.userId,A,C,key,request,q,expires,{amount:'5000000000000000000'},'claim_entry']);
 const key=randomUUID(),claim=await make(key);assert.equal(claim.action_kind,'claim_entry');assert.equal((await make(key)).id,claim.id);
 await assert.rejects(rpc('music_purchase_create',[identity.userId,A,C,randomUUID(),{roundId:'1',guess:'4',horizon:'24h',optionId:'single'},q,expires,{}]),/ORDER_PENDING/);
 await assert.rejects(rpc('music_wallet_action_create',[identity.userId,A,C,key,request,q,expires,{},'purchase']),/ORDER_CONFLICT/);
 await assert.rejects(db.query("update music_purchase_orders set action_kind='purchase' where id=$1",[claim.id]),/ACTION_IMMUTABLE/);
 await assert.rejects(rpc('music_purchase_action',[claim.id,'did:privy:other',B,C,'signed','0x12','0x'+'1'.repeat(64)]),/ORDER_NOT_FOUND/);
 await rpc('music_purchase_action',[claim.id,identity.userId,A,C,'signed','0x12','0x'+'1'.repeat(64)]);
 const worker=randomUUID(),leased=await rpc('music_purchase_claim',[worker,C]);assert.equal(leased.id,claim.id);
 await assert.rejects(rpc('music_purchase_update',[claim.id,randomUUID(),leased.lease_version,{state:'confirmed'}]),/LEASE_LOST/);
 await rpc('music_purchase_update',[claim.id,worker,leased.lease_version,{state:'confirmed',result:{amount:'5000000000000000000',recipient:A},receipt_block:73100562}]);
 const later=await rpc('music_purchase_create',[identity.userId,A,C,randomUUID(),{roundId:'1',guess:'4',horizon:'24h',optionId:'single'},{nonce:1},expires,{}]);assert.equal(later.action_kind,'purchase');
 const payload={roundId:'1',horizon:'24h',epoch:'1',offset:'0',tickets:['0']};
 const job=await rpc('music_v2_operator_job',['submit-order',null,S,C,payload]);assert.equal(job.kind,'submit-order');assert.equal((await rpc('music_v2_operator_job',['submit-order',null,S,C,payload])).id,job.id);
 assert.equal(await rpc('music_step6_status'),1);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const name of ['music_result_evidence','music_purchase_orders','music_chain_events'])await assert.rejects(db.exec('select * from public.'+name),/permission denied/);
  await assert.rejects(rpc('music_step6_status'),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');await rpc('music_step6_status');
 await db.query('insert into music_result_evidence(evidence_hash,contract_address,document) values($1,$2,$3)', ['0x'+'2'.repeat(64),C,{source:'sample'}]);
 await assert.rejects(db.exec('update music_result_evidence set document=document'),/permission denied/);
 await db.exec('reset role');
 const pool='0x'+'3'.repeat(64),hash='0x'+'4'.repeat(64),events=Array.from({length:1002},(_,i)=>({block_number:'73100562',block_hash:hash,transaction_hash:'0x'+BigInt(i+1).toString(16).padStart(64,'0'),log_index:0,event_name:'EntryRecorded',args:{entryId:String(i+1),pool,payer:A,guess:'123',spots:'1',paid:'5000000000000000000',purchasedAt:'100',firstTicketId:String(i)},raw_log:{topics:[],data:'0x'}}));
 await rpc('music_ingest_chain_events',['large-settlement-page','a'.repeat(64),{},events]);
 const pages=[],reader=createSettlementStore({rpc:async(name,args)=>{pages.push(args.p_after);return {data:await rpc(name,Object.values(args)),error:null};}},C);
 const all=await reader.entries(pool,73100562n);assert.equal(all.length,1002);assert.equal(all.at(-1).firstTicketId,'1001');assert.deepEqual(pages,['0','500','1000']);
});

test('sample evidence binds the exact period and produces only an unsigned oracle call',async()=>{
 const config={chainId:5042002,contract:C,deployment:{oracle:A}},pool={phase:0,windowStart:100n,windowEnd:200n,refundAt:300n};let saved;
 const chain={verify:async()=>{},snapshot:async()=>({number:1n,timestamp:200n}),readRound:async()=>({musicId:'demo:last-bus-home'}),readPool:async()=>pool,readContract:async()=>A};
 const store={save:async d=>{saved=d;return keccak256(toBytes(JSON.stringify(d)));}};
 const prepared=await prepareResult({config,chain,store,roundId:'1',horizon:'24h',actualViews:'0'});
 assert.equal(saved.source,'sample');assert.equal(saved.windowEnd,'200');assert.equal(prepared.value,'0');assert.equal(prepared.from,A);assert.equal(prepared.arguments[2],'0');assert.match(prepared.data,/^0x/);
 pool.phase=4;await assert.rejects(prepareResult({config,chain,store,roundId:'1',horizon:'24h',actualViews:'123'}),/RESULT_WINDOW_CLOSED/);
 assert.throws(()=>canonicalEvidence({...saved,source:'real'}),/BAD_REQUEST/);
});

test('settlement coordinator uses complete ordering, bounded batches, resumable progress and opt-in',async()=>{
 const evidence=canonicalEvidence({version:1,source:'sample',chainId:5042002,contract:C,roundId:'1',horizon:'24h',musicId:'demo:last-bus-home',windowStart:'100',windowEnd:'200',actualViews:'120'});
 const pool={phase:1,epoch:1n,orderCount:0n,lastTicket:0n,windowStart:100n,windowEnd:200n,refundAt:300n,entryCount:2n,spotCount:11n,totalDeposits:55n,actualViews:120n,evidenceHash:keccak256(toBytes(JSON.stringify(evidence))),scanCursor:0n,pairCursor:0n};
 const jobs=[],notes=[];let pending=false;
 const args={config:{contract:C,settlementEnabled:false},chain:{snapshot:async()=>({number:2n,timestamp:201n}),readPool:async()=>pool},live:{catalog:async()=>({snapshot:{syncStatus:'current'},rounds:[{id:'1'}]})},store:{evidence:async()=>({document:evidence}),entries:async()=>[{id:'1',firstTicketId:'0',guess:'100',spots:'1',paid:'5',purchasedAt:'101'},{id:'2',firstTicketId:'1',guess:'120',spots:'10',paid:'50',purchasedAt:'102'}]},admin:{pendingSettlement:async()=>pending,operator:async(...a)=>jobs.push(a)},signer:S,log:e=>notes.push(e)};
 const tick=async()=>{const c=createSettlementCoordinator(args);await c.tick();};
 await tick();assert.equal(jobs.length,0);args.config.settlementEnabled=true;await tick();assert.equal(jobs[0][0],'submit-order');assert.deepEqual(jobs[0][3].tickets,['1','2','3','4','5','6','7','8','9','10','0']);
 pending=true;await tick();assert.equal(jobs.length,1);pending=false;
 pool.orderCount=1n;pool.lastTicket=0n;await tick();assert.equal(jobs.length,1);assert.equal(notes.at(-1).code,'SETTLEMENT_REVIEW');
 pool.phase=1;pool.orderCount=0n;pool.entryCount=33n;pool.spotCount=33n;pool.totalDeposits=165n;
 args.store.entries=async()=>Array.from({length:33},(_,i)=>({id:String(i+1),firstTicketId:String(i),guess:'120',spots:'1',paid:'5',purchasedAt:String(i+101)}));
 await tick();assert.equal(jobs.at(-1)[3].tickets.length,32);pool.orderCount=32n;pool.lastTicket=31n;await tick();assert.deepEqual(jobs.at(-1)[3].tickets,['32']);assert.equal(jobs.at(-1)[3].offset,'32');
 pool.phase=2;await tick();assert.equal(jobs.at(-1)[3].steps,32);
 pool.phase=3;await tick();assert.equal(jobs.at(-1)[3].steps,16);
 pool.phase=4;const count=jobs.length;await tick();assert.equal(jobs.length,count);
 assert.throws(()=>settlementCall({kind:'advance-settlement',payload:{roundId:'1',horizon:'24h',epoch:'1',offset:'0',phase:3,steps:32}},args.config),/BAD_REQUEST/);
 assert.throws(()=>assertSettlementCurrent({kind:'submit-order',payload:{epoch:'1',offset:'0'}},{...pool,phase:2,orderCount:11n}),/JOB_SUPERSEDED/);
});

test('claim authorization isolates accounts and never requires permission to purchase',async()=>{
 const row={id:randomUUID(),action_kind:'claim_entry',request:{entryId:'7'},state:'awaiting_signature',transaction:{},round:{amount:'5'}};let calls=0;
 const service=createClaimService({store:{get:async(_id,i)=>i.wallet===A?row:null,list:async()=>[row],byKey:async()=>null,create:async()=>row,action:async()=>row},chain:{validate:async()=>{calls++;return 'hash';}},claims:{preflight:async(i,id)=>{assert.equal(i.wallet,A);assert.equal(id,'7');return {transaction:{},round:{},expiresAt:'later'};}}});
 await assert.rejects(service.get(row.id,{userId:'did:privy:other',wallet:B}),/CLAIM_NOT_FOUND/);
 const prepared=await service.create(identity,{entryId:'7'},randomUUID());assert.equal(prepared.entryId,'7');assert.equal(calls,0);
 await assert.rejects(service.create(identity,{entryId:'7',recipient:B},randomUUID()),/BAD_REQUEST/);
 await assert.rejects(service.create(identity,{entryId:'7'}),/BAD_REQUEST/);
 await service.signed(row.id,identity,'0x12');assert.equal(calls,1);
});


test('temporary setup-read failures retain receipt verification through the original event ledger',async()=>{
 const event={args:{entryId:'1',amount:'5',recipient:A,refund:false},transaction_hash:'0x'+'1'.repeat(64),block_number:73100562,block_hash:'0x'+'2'.repeat(64)};
 const query={select(){return this;},eq(){return this;},in(){return this;},then(resolve){resolve({data:[event],error:null});}};
 const reader=createLiveStore({from:()=>query},C,{step6:false,verifyClaims:true});
 assert.deepEqual(await reader.claimRecords([]),[]);const [claim]=await reader.claimRecords(['1']);assert.equal(claim.recipient,A);assert.equal(claim.amount,'5');assert.equal(claim.block,'73100562');
});
