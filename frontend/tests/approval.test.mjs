import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalClient,createApprovalController } from '../approval.js';
import { createAccount } from '../account.js';

const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function fixture(t,{client=async()=>({status:'approved',walletAddress:A}),...options}={}) {
  let session={authenticated:true,userId:'user-a',address:A};const patches=[],calls=[];
  const controller=createApprovalController({getSession:()=>session,getToken:async()=>'session-token',
    client:async args=>{calls.push(args);return client(args);},onChange:p=>patches.push(p),pollMs:5,durationMs:100,timeoutMs:100,...options});
  t.after(()=>controller.dispose());
  return {controller,patches,calls,setSession:s=>{session=s;}};
}
test('approval client sends only a bearer token and empty body, never a browser-selected wallet',async()=>{
  let request;
  const client=createApprovalClient({fetcher:async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({status:'approved',walletAddress:A})};}});
  await client({token:'proof',method:'POST'});
  assert.equal(request.url,'/api/account/approval');assert.equal(request.headers.Authorization,'Bearer proof');assert.equal(request.body,'{}');assert.equal(request.cache,'no-store');
});
test('approval errors and malformed responses are recoverable and sanitized',async()=>{
  for(const fetcher of [async()=>{throw Error('raw private backend failure');},async()=>({ok:true,json:async()=>({result:'not an approval'})})]) {
    await assert.rejects(createApprovalClient({fetcher})({token:'proof'}),/temporarily unavailable/);
  }
  await assert.rejects(createApprovalClient({fetcher:async()=>({ok:false,json:async()=>({message:'Please sign in again.'})})})({token:'expired'}),/Please sign in again/);
});
test('a ready account automatically requests approval and publishes approved state',async t=>{
  const f=fixture(t);await f.controller.start();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'POST');assert.equal(f.patches.at(-1).approvalStatus,'approved');
});
test('parallel retries share one in-flight activation',async t=>{
  const d=deferred(),f=fixture(t,{client:()=>d.promise});
  const first=f.controller.start();await tick();
  const retry=f.controller.retry();await tick();assert.equal(f.calls.length,1);
  d.resolve({status:'approved',walletAddress:A});await Promise.all([first,retry]);
});
test('pending approval polls GET and never repeats the POST',async t=>{
  let count=0;
  const f=fixture(t,{client:async()=>({status:++count===1?'pending':'approved',walletAddress:A})});
  await f.controller.start();await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);assert.equal(f.patches.at(-1).approvalStatus,'approved');
});
test('the polling deadline stops background requests and offers manual retry',async t=>{
  let now=0;
  const f=fixture(t,{clock:()=>now,durationMs:10,client:async()=>{now=11;return {status:'pending',walletAddress:A};}});
  await f.controller.start();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.calls.length,1);assert.equal(f.patches.at(-1).approvalCanRetry,true);assert.equal(f.patches.at(-1).approvalStatus,'pending');
});
test('logout or account switching discards old pending responses and polling',async t=>{
  const d=deferred(),f=fixture(t,{client:()=>d.promise});
  const first=f.controller.start();await tick();f.controller.cancel();f.setSession({authenticated:false});
  d.resolve({status:'approved',walletAddress:A});await first;await tick();
  assert.equal(f.patches.some(p=>p.approvalStatus==='approved'),false);assert.equal(f.calls.length,1);
});
test('a response for another wallet is rejected and can never approve the displayed account',async t=>{
  const f=fixture(t,{client:async()=>({status:'approved',walletAddress:B})});await f.controller.start();
  assert.equal(f.patches.at(-1).approvalStatus,'error');assert.match(f.patches.at(-1).approvalError,/account changed/);
});
test('revoked accounts have no retry action while ordinary failures do',async t=>{
  const f=fixture(t,{client:async()=>({status:'revoked',walletAddress:A})});await f.controller.start();
  assert.equal(f.patches.at(-1).approvalStatus,'revoked');assert.equal(f.patches.at(-1).approvalCanRetry,false);
});
test('hung requests time out without blocking wallet balance or sign-out',async t=>{
  const f=fixture(t,{timeoutMs:10,client:()=>new Promise(()=>{})});await f.controller.start();
  assert.equal(f.patches.at(-1).approvalStatus,'error');assert.equal(f.patches.at(-1).approvalCanRetry,true);
});
test('account integration waits for linked wallet readiness and clears activation on logout',async t=>{
  const d=deferred();let calls=0;
  const account=createAccount({readBalance:async()=>0n,approvalClient:async()=>{calls++;return d.promise;}});
  t.after(()=>account.dispose());
  account.attachRuntime({getAccessToken:async()=>'proof',logout:async()=>account.updateSession({ready:true,authenticated:false})});
  const snapshot={ready:true,authenticated:true,userId:'user-a',email:'a@example.com',linkedWalletAddress:A};
  account.updateSession({...snapshot,walletsReady:false});await tick();assert.equal(calls,0);
  account.updateSession({...snapshot,walletsReady:true,address:A});await tick();assert.equal(calls,1);assert.equal(account.getState().balance,0n);
  await account.signOut();assert.equal(account.getState().approvalStatus,'idle');
  d.resolve({status:'approved',walletAddress:A});await tick();assert.equal(account.getState().approvalStatus,'idle');assert.equal(account.getState().authenticated,false);
});
