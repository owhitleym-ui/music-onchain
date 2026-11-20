import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../src/worker.js';
import { createApprovalService } from '../src/service.js';
import { AppError } from '../src/errors.js';
import { ORIGINAL_OWNER } from '../src/config.js';
import { database,fakeChain,identity,S,A,B } from './fixtures.mjs';

const env=await database();
test.after(()=>env.db.close());test.beforeEach(()=>env.reset());
async function fixture(extra={}) {
  const chain=fakeChain(),store=extra.store??env.store;
  const service=createApprovalService({store,chain});
  const worker=createWorker({store,chain,...extra});
  await service(identity(),true);
  return {chain,store,worker,service};
}
async function drive(worker,n=3){for(let i=0;i<n;i++)await worker.tick();}

test('approval is prepared durably before broadcast and needs a successful receipt plus chain state',async()=>{
  const {worker,chain,service}=await fixture();
  await worker.tick();
  let tx=(await env.rows())[0];assert.equal(tx.state,'prepared');assert.ok(tx.raw_transaction);assert.ok(tx.transaction_hash);assert.equal(chain.sent.length,0);
  await worker.tick();assert.equal(chain.sent.length,1);assert.equal((await env.rows())[0].state,'submitted');
  await worker.tick();assert.equal((await env.rows())[0].state,'confirmed');
  assert.equal((await service(identity())).status,'approved');
  await service(identity(),true);await drive(worker);assert.equal(chain.sent.length,1);
});
test('different users share serialized nonces without duplicate jobs',async()=>{
  const {worker,chain,service}=await fixture();
  await service(identity(B,'did:privy:fan-b'),true);
  await drive(worker,6);
  assert.deepEqual((await env.rows()).map(row=>row.nonce),[0,1]);assert.equal(chain.sent.length,2);
});
test('a restart after prepare resumes the same signed transaction',async()=>{
  const {worker,chain}=await fixture();await worker.tick();
  const saved=(await env.rows())[0];await env.expireLease();
  const restarted=createWorker({store:env.store,chain});await drive(restarted,2);
  assert.equal(chain.sent[0],saved.raw_transaction);assert.equal((await env.rows())[0].nonce,saved.nonce);
});
test('lost response after broadcast does not cause a second approval',async()=>{
  const {worker,chain}=await fixture();const send=chain.broadcast;
  chain.broadcast=async raw=>{await send(raw);throw Error('response lost');};
  await drive(worker);
  assert.equal(chain.sent.length,1);assert.equal((await env.rows())[0].state,'confirmed');
});
test('database failure after prepare commit is recovered without changing the signed payload',async()=>{
  let lose=true;
  const store={...env.store,async update(...args){const result=await env.store.update(...args);if(lose&&args[3].state==='prepared'){lose=false;throw new AppError('DB_UNAVAILABLE');}return result;}};
  const {worker,chain}=await fixture({store});await worker.tick();
  const saved=(await env.rows())[0].raw_transaction;assert.ok(saved);assert.equal(chain.sent.length,0);
  await drive(worker,2);assert.equal(chain.sent[0],saved);assert.equal((await env.rows())[0].state,'confirmed');
});
test('database failure before prepare commit sends nothing and preserves the reserved nonce',async()=>{
  let lose=true;
  const store={...env.store,async update(...args){if(lose&&args[3].state==='prepared'){lose=false;throw new AppError('DB_UNAVAILABLE');}return env.store.update(...args);}};
  const {worker,chain}=await fixture({store});await worker.tick();assert.equal(chain.sent.length,0);assert.equal((await env.rows())[0].nonce,0);
  await drive(worker);assert.equal(chain.sent.length,1);assert.equal((await env.rows())[0].nonce,0);
});
test('unavailable database prevents signing and sending',async()=>{
  const chain=fakeChain();let signs=0;chain.sign=async()=>{signs++;};
  const store={...env.store,claim:async()=>{throw new AppError('DB_UNAVAILABLE');}};
  await createWorker({store,chain}).tick();assert.equal(signs,0);assert.equal(chain.sent.length,0);
});
test('insufficient administrator funds and wrong ownership block without reserving a nonce',async()=>{
  const {worker,chain,service}=await fixture();chain.balanceValue=0n;
  await worker.tick();assert.equal((await env.rows())[0].error_code,'NO_GAS');assert.equal((await env.rows())[0].nonce,null);
  chain.balanceValue=1n;chain.owner=ORIGINAL_OWNER;await service(identity(),true);await worker.tick();
  assert.equal((await env.rows())[0].error_code,'OWNER_NOT_READY');assert.equal(chain.sent.length,0);
  chain.owner=S;await service(identity(),true);await drive(worker);assert.equal((await service(identity())).status,'approved');
});
test('losing ownership after preparing does not broadcast an approval',async()=>{
  const {worker,chain}=await fixture();await worker.tick();chain.owner=ORIGINAL_OWNER;await worker.tick();
  assert.equal(chain.sent.length,0);assert.ok((await env.rows())[0].raw_transaction);
});
test('a revocation between registration and signing is detected rather than overwritten',async()=>{
  const {worker,chain,service}=await fixture();chain.revokedSet.add(A);
  await worker.tick();assert.equal(chain.sent.length,0);assert.equal((await service(identity(),true)).status,'revoked');
});
test('a reserved nonce interrupted before signing restarts with the same nonce',async()=>{
  const {worker,chain}=await fixture();let failed=false;const sign=chain.sign;
  chain.sign=async(...args)=>{if(!failed){failed=true;throw Error('interrupted signing');}return sign(...args);};
  await worker.tick();assert.equal((await env.rows())[0].nonce,0);assert.equal(chain.sent.length,0);
  await drive(worker);assert.equal(chain.sent.length,1);assert.equal((await env.rows())[0].nonce,0);
});
test('RPC errors after preparation preserve the signed transaction for retry',async()=>{
  let now=Date.now();const {worker,chain}=await fixture({now:()=>now});await worker.tick();
  const prepared=(await env.rows())[0].raw_transaction;const broadcast=chain.broadcast;
  chain.broadcast=async()=>{throw Error('network offline');};await worker.tick();
  assert.equal((await env.rows())[0].raw_transaction,prepared);assert.equal((await env.rows())[0].state,'uncertain');
  chain.broadcast=broadcast;now+=20000;await drive(worker,2);assert.equal(chain.sent[0],prepared);assert.equal((await env.rows())[0].state,'confirmed');
});
test('failed receipts are not treated as approved; explicit retry uses a new nonce',async()=>{
  const {worker,chain,service}=await fixture();chain.autoMine=false;
  await drive(worker,2);chain.mine(chain.sent[0],false);await worker.tick();
  assert.equal((await service(identity())).status,'error');assert.equal((await env.rows())[0].state,'reverted');
  chain.autoMine=true;await service(identity(),true);await drive(worker);
  assert.equal(chain.sent.length,2);assert.equal((await service(identity())).status,'approved');
});
test('unknown consumed nonces remain uncertain and do not create replacement approvals',async()=>{
  const {worker,chain}=await fixture();await worker.tick();chain.latest=1;
  await drive(worker,3);const tx=(await env.rows())[0];assert.equal(tx.state,'uncertain');assert.equal(tx.error_code,'NONCE_CONFLICT');assert.equal(chain.sent.length,0);
});
test('revocation remains disabled across login; operator re-enable restores it',async()=>{
  const {worker,chain,service}=await fixture();await drive(worker);
  await env.store.operator('revoke',A,S);await drive(worker);
  assert.equal((await service(identity(),true)).status,'revoked');assert.equal(chain.sent.length,2);
  await env.store.operator('reenable',A,S);await drive(worker);
  assert.equal((await service(identity())).status,'approved');assert.equal(chain.sent.length,3);
});
test('ownership acceptance and recovery use the same worker and preserve other roles',async()=>{
  const chain=fakeChain();chain.owner=ORIGINAL_OWNER;chain.pendingOwner=S;
  await env.store.operator('accept-owner',null,S);
  const worker=createWorker({store:env.store,chain});await drive(worker);
  assert.equal(chain.owner,S);
  await env.store.operator('return-owner',null,S);await drive(worker);
  assert.equal(chain.pendingOwner,ORIGINAL_OWNER);assert.equal(chain.owner,S);
  assert.equal((await env.store.signer(S)).paused,true);
  assert.deepEqual((await env.rows()).map(r=>r.nonce),[0,1]);
});
test('worker diagnostics contain codes only and omit raw errors, keys and signed payloads',async()=>{
  const events=[];const chain=fakeChain();
  const worker=createWorker({store:{claim:async()=>{throw Error('SECRET_VALUE raw signed transaction');}},chain,log:e=>events.push(e)});
  await worker.tick();assert.equal(events.length,1);assert.doesNotMatch(JSON.stringify(events),/SECRET_VALUE|signed transaction/);
});
