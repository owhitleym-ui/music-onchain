import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const C='0x'+'c'.repeat(40),D='0x'+'d'.repeat(40),A='0x'+'a'.repeat(40),S='0x'+'1'.repeat(40);
test('atomic-payment migration, isolation, durable orders and server-only access',async t=>{
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 t.after(()=>db.close());for(const n of ['001_account_approvals.sql','002_atomic_payments.sql'])await db.exec(await readFile(new URL('../supabase/'+n,import.meta.url),'utf8'));
 async function rpc(name,values){const r=await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as value`,values.map(x=>x&&typeof x==='object'?JSON.stringify(x):x));return r.rows[0].value;}
 let order,key;
 await t.test('same wallet approval is distinct for each deployment',async()=>{
  const one=await rpc('music_v2_sync_approval',['did:privy:one',A,S,true,false,false,20,C]);
  const two=await rpc('music_v2_sync_approval',['did:privy:one',A,S,false,false,true,20,D]);
  assert.equal(one.approval.status,'approved');assert.equal(two.approval.status,'pending');assert.equal(two.transaction.contract_address,D);
  const legacy=await rpc('music_sync_approval',['did:privy:one',A,S,true,false,false,20]);assert.equal(legacy.approval.contract_address,'0x003043208750d205f98ac1d9ae670d2d2a19797c');assert.notEqual(legacy.approval.id,two.approval.id);
  await db.exec('truncate public.music_admin_transactions,public.music_account_approvals,public.music_admin_signers cascade');
 });
 await t.test('revocation cannot be bypassed with a new deployment',async()=>{
  await rpc('music_v2_sync_approval',['did:privy:one',A,S,false,true,false,20,C]);
  const r=await rpc('music_v2_sync_approval',['did:privy:one',A,S,false,false,true,20,D]);assert.equal(r.approval.status,'revoked');assert.equal(r.transaction,null);
 });
 const request={roundId:'1',horizon:'24h',guess:'1234',optionId:'four'},tx={nonce:0,value:'20000000000000000000'};
 const create=(k=key,r=request,w=A,u='did:privy:one')=>rpc('music_purchase_create',[u,w,D,k,r,tx,new Date(Date.now()+120000).toISOString(),{id:'1',start:1000,deadline:3601000}]);
 await t.test('idempotency and concurrent active-order guard',async()=>{
  key=randomUUID();order=await create();assert.equal((await create()).id,order.id);
  await assert.rejects(create(key,{...request,guess:'9'}),/ORDER_CONFLICT/);
  await assert.rejects(create(randomUUID()),/ORDER_PENDING/);
 });
 await t.test('ownership checks and immutable signed payload',async()=>{
  await assert.rejects(rpc('music_purchase_action',[order.id,'did:privy:attacker',A,D,'signed','0x12','0x'+'1'.repeat(64)]),/ORDER_NOT_FOUND/);
  const prepared=await rpc('music_purchase_action',[order.id,'did:privy:one',A,D,'signed','0x12','0x'+'1'.repeat(64)]);assert.equal(prepared.state,'prepared');
  assert.equal((await rpc('music_purchase_action',[order.id,'did:privy:one',A,D,'signed','0x12','0x'+'1'.repeat(64)])).id,order.id);
  await assert.rejects(rpc('music_purchase_action',[order.id,'did:privy:one',A,D,'signed','0x13','0x'+'2'.repeat(64)]),/ORDER_CONFLICT/);
  await assert.rejects(rpc('music_purchase_action',[order.id,'did:privy:one',A,D,'cancel',null,null]),/ORDER_PENDING/);
 });
 await t.test('worker lease fences stale writes and preserves recovery data',async()=>{
  const worker=randomUUID(),job=await rpc('music_purchase_claim',[worker,D]);assert.equal(job.raw_transaction,'0x12');
  assert.equal(await rpc('music_purchase_claim',[randomUUID(),D]),null);
  await assert.rejects(rpc('music_purchase_update',[job.id,randomUUID(),job.lease_version,{state:'confirmed'}]),/LEASE_LOST/);
  await rpc('music_purchase_update',[job.id,worker,job.lease_version,{state:'confirmed',entry_ids:['1','2','3','4'],receipt_block:5,network_fee:'100'}]);
  tx.nonce=1;const next=await create(randomUUID());assert.notEqual(next.id,order.id);
  await rpc('music_purchase_action',[next.id,'did:privy:one',A,D,'cancel',null,null]);
 });
 await t.test('operator actions preserve the deployment and round payload, including legacy wrappers',async()=>{
  const payload={songId:'0x'+'2'.repeat(64),musicId:'demo:last-bus-home',artist:A,start:2000001600};
  const round=await rpc('music_v2_operator_job',['create-round',null,S,D,payload]);
  assert.equal(round.contract_address,D);assert.equal(round.kind,'create-round');assert.deepEqual(round.payload,payload);
  assert.equal((await rpc('music_v2_operator_job',['create-round',null,S,D,payload])).id,round.id,'repeated requests reuse the queued round');
  const old=await rpc('music_operator_job',['return-owner',null,S]);
  assert.equal(old.contract_address,'0x003043208750d205f98ac1d9ae670d2d2a19797c');assert.deepEqual(old.payload,{});
  const revoked=await rpc('music_v2_operator_job',['revoke',A,S,D,{}]);
  assert.equal(revoked.contract_address,D);assert.equal(revoked.kind,'revoke');assert.equal(revoked.wallet_address,A);
 });
 await t.test('RLS and function permissions deny browser roles',async()=>{
  await db.exec('set role anon');await assert.rejects(db.query('select * from music_purchase_orders'),/permission denied/);
  await assert.rejects(rpc('music_purchase_claim',[randomUUID(),D]),/permission denied/);await db.exec('reset role');
 });
});
