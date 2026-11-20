import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHandler } from '../src/http.js';
import { AppError } from '../src/errors.js';
import { A } from './fixtures.mjs';

async function fixture(t,options={}) {
  const calls=[];
  const handler=createHandler({authenticate:async header=>{if(header!=='Bearer valid')throw new AppError('AUTH_REQUIRED',401);return {userId:'did:privy:a',wallet:A};},
    approvalService:async(user,enqueue)=>{calls.push({user,enqueue});return {status:enqueue?'pending':'approved',walletAddress:A};},...options});
  const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  return {calls,request:(path='/api/account/approval',options={})=>fetch(url+path,{headers:{Authorization:'Bearer valid'},...options})};
}
test('authenticated POST requests approval; GET checks status without enqueuing',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request()).status,200);
  const post=await f.request(undefined,{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':'application/json'},body:'{}'});
  assert.equal(post.status,202);assert.equal((await post.json()).status,'pending');
  assert.deepEqual(f.calls.map(c=>c.enqueue),[false,true]);
  assert.equal(post.headers.get('cache-control'),'no-store');assert.equal(post.headers.get('access-control-allow-origin'),null);
});
test('missing authentication and hostile origins cannot reach approval service',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request(undefined,{headers:{}})).status,401);
  assert.equal((await f.request(undefined,{headers:{Authorization:'Bearer valid',Origin:'https://attacker.example'}})).status,403);
  assert.equal(f.calls.length,0);
});
test('client-supplied addresses, query parameters, invalid JSON and oversized bodies are rejected',async t=>{
  const f=await fixture(t);
  for(const body of [JSON.stringify({walletAddress:A}),'[]','null','broken',JSON.stringify({userId:'fake'}),'x'.repeat(1025)]) {
    const response=await f.request(undefined,{method:'POST',headers:{Authorization:'Bearer valid'},body});assert.ok([400,413].includes(response.status));
  }
  assert.equal((await f.request('/api/account/approval?wallet='+A)).status,400);assert.equal(f.calls.length,0);
});
test('only account endpoints exist; missing configuration is a recoverable service error',async t=>{
  const f=await fixture(t,{configured:false});
  assert.equal((await f.request('/api/admin/approve')).status,404);
  assert.equal((await f.request(undefined,{method:'DELETE'})).status,405);
  assert.equal((await f.request()).status,503);
  assert.deepEqual(await (await f.request('/api/health')).json(),{ready:false});
});
test('unexpected failures never expose backend secrets or transaction internals',async t=>{
  const f=await fixture(t,{approvalService:async()=>{throw Error('SECRET_PRIVATE_KEY=abc raw_transaction=abcdef');}});
  const response=await f.request();assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/SECRET_PRIVATE_KEY|raw_transaction|abcdef/);
});
test('request rate limits bound retries independently from status polling',async t=>{
  const f=await fixture(t);
  for(let i=0;i<10;i++)assert.equal((await f.request(undefined,{method:'POST'})).status,202);
  assert.equal((await f.request(undefined,{method:'POST'})).status,429);
  assert.equal((await f.request()).status,200);
});
