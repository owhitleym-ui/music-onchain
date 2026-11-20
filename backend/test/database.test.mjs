import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database,identity,S,A,B } from './fixtures.mjs';

const env=await database();
test.after(()=>env.db.close());
test.beforeEach(()=>env.reset());
const observe={approved:false,revoked:false};

test('migration preserves existing tables and restricts all approval data/functions to the server role',async()=>{
  assert.equal((await env.db.query('select value from public.team_existing_table')).rows[0].value,'keep me');
  const tables=await env.db.query("select relname,relrowsecurity from pg_class where relname in ('music_account_approvals','music_admin_signers','music_admin_transactions')");
  assert.equal(tables.rows.length,3);assert.ok(tables.rows.every(row=>row.relrowsecurity));
  for(const role of ['anon','authenticated']) {
    await env.db.exec('set role '+role);
    await assert.rejects(env.db.query('select * from public.music_account_approvals'),/permission denied/);
    await assert.rejects(env.db.query("select public.music_claim_job($1,$2)",[S,randomUUID()]),/permission denied/);
    await env.db.exec('reset role');
  }
  await env.db.exec('set role service_role');
  assert.ok(await env.store.sync(identity(),S,observe,true,20));
  await env.db.exec('reset role');
});

test('repeated and concurrent requests create one account and one queued approval',async()=>{
  const results=await Promise.all(Array.from({length:8},()=>env.store.sync(identity(),S,observe,true,20)));
  assert.equal(new Set(results.map(r=>r.transaction.id)).size,1);
  assert.equal((await env.rows('music_account_approvals')).length,1);
  assert.equal((await env.rows()).length,1);
});

test('an already-approved account consumes no transaction or hourly allowance',async()=>{
  const r=await env.store.sync(identity(),S,{approved:true,revoked:false},true,1);
  assert.equal(r.approval.status,'approved');assert.equal(r.transaction,null);
  await env.store.sync(identity(B,'did:privy:b'),S,observe,true,1);
  assert.equal((await env.rows()).length,1);
});

test('hourly limit applies to new wallets, not polling or repeated requests',async()=>{
  await env.store.sync(identity(),S,observe,true,1);
  for(let i=0;i<3;i++)await env.store.sync(identity(),S,observe,true,1);
  await assert.rejects(env.store.sync(identity(B,'did:privy:b'),S,observe,true,1),{code:'RATE_LIMITED'});
  await env.store.sync(identity(B,'did:privy:b'),S,observe,false,1);
  assert.equal((await env.rows()).length,1);
});

test('a wallet cannot be claimed by a second Privy identity',async()=>{
  await env.store.sync(identity(),S,observe,true,20);
  await assert.rejects(env.store.sync(identity(A,'did:privy:other'),S,observe,true,20),{code:'ACCOUNT_UNAVAILABLE'});
});

test('historical revocations and later onchain revocations require operator re-enabling',async()=>{
  let r=await env.store.sync(identity(),S,{approved:false,revoked:true},true,20);
  assert.equal(r.approval.status,'revoked');assert.equal(r.transaction,null);
  await env.store.operator('reenable',A,S);
  r=await env.store.sync(identity(),S,{approved:false,revoked:true},true,20);
  assert.equal(r.approval.status,'pending');assert.ok(r.transaction);
  await env.store.sync(identity(B,'did:privy:b'),S,{approved:true,revoked:false},true,20);
  r=await env.store.sync(identity(B,'did:privy:b'),S,observe,true,20);
  assert.equal(r.approval.status,'revoked');assert.equal(r.transaction,null);
});

test('signer lease prevents two workers claiming simultaneously and fences stale updates',async()=>{
  await env.store.sync(identity(),S,observe,true,20);
  const a=randomUUID(),b=randomUUID();
  const first=await env.store.claim(S,a);
  assert.equal(await env.store.claim(S,b),null);
  await env.expireLease();
  const next=await env.store.claim(S,b);
  assert.ok(next.fence>first.fence);
  await assert.rejects(env.store.update(first.job.id,a,first.fence,{nonce:0}),{code:'LEASE_LOST'});
  assert.equal(await env.store.renew(S,a,first.fence),false);
});

test('nonce reservations survive interruption and signed payloads cannot be replaced',async()=>{
  const r=await env.store.sync(identity(),S,observe,true,20),worker=randomUUID();
  let claimed=await env.store.claim(S,worker);
  let tx=await env.store.update(r.transaction.id,worker,claimed.fence,{nonce:4});
  assert.equal(tx.nonce,4);
  await env.store.update(tx.id,worker,claimed.fence,{state:'prepared',raw_transaction:'0x1234',transaction_hash:'0x'+'1'.repeat(64)});
  await assert.rejects(env.store.update(tx.id,worker,claimed.fence,{raw_transaction:'0x5678'}),/DB_UNAVAILABLE/);
  await env.expireLease();
  claimed=await env.store.claim(S,randomUUID());
  assert.equal(claimed.job.nonce,4);assert.equal(claimed.job.raw_transaction,'0x1234');
});

test('operator revocation blocks immediately and cancels only unsigned unreserved work',async()=>{
  await env.store.sync(identity(),S,observe,true,20);
  const revoke=await env.store.operator('revoke',A,S);
  assert.equal(revoke.kind,'revoke');
  assert.equal((await env.store.approval(A)).blocked,true);
  assert.equal((await env.rows()).find(row=>row.kind==='approve').state,'cancelled');
  const r=await env.store.sync(identity(),S,observe,true,20);
  assert.equal(r.approval.status,'revoked');
});

test('returning ownership pauses new approvals without changing existing approvals',async()=>{
  await env.store.sync(identity(),S,{approved:true,revoked:false},true,20);
  await env.store.operator('return-owner',null,S);
  await assert.rejects(env.store.sync(identity(B,'did:privy:b'),S,observe,true,20),{code:'OWNER_NOT_READY'});
  const r=await env.store.sync(identity(),S,{approved:true,revoked:false},false,20);
  assert.equal(r.approval.status,'approved');
});
