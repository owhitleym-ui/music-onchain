import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcReadGuard } from '../src/rpc-reads.js';
import { createArcChain } from '../src/chain.js';
import { S,A } from './fixtures.mjs';
import { sha256 } from '../src/config.js';

function clocked() {
  let now=0;
  const delays=[];
  return {delays,clock:()=>now,pause:async ms=>{delays.push(ms);now+=ms;}};
}

test('read retries use bounded backoff for throttling and inconsistent Arc head responses',async()=>{
  for(const code of [-32005,-32014,429]) {
    const time=clocked(),guard=createRpcReadGuard(time);let calls=0;
    assert.equal(await guard.read(async()=>{if(++calls<3)throw {cause:{code}};return 'ok';}),'ok');
    assert.equal(calls,3);assert.deepEqual(time.delays,[700,1400]);
  }
});
test('persistent provider errors fail closed after four attempts; unrelated errors are not retried',async()=>{
  const time=clocked(),guard=createRpcReadGuard(time);let calls=0;
  await assert.rejects(guard.read(async()=>{calls++;throw Object.assign(Error('limited'),{code:-32005});}));
  assert.equal(calls,4);assert.deepEqual(time.delays,[700,1400,2800]);
  calls=0;await assert.rejects(guard.read(async()=>{calls++;throw Error('bad request');}));assert.equal(calls,1);
});
test('log requests including retries are serialized and spaced, and failures do not poison the queue',async()=>{
  const time=clocked(),guard=createRpcReadGuard(time),started=[];let active=0;
  await Promise.all([0,1,2].map(id=>guard.logs(async()=>{assert.equal(active++,0);started.push(time.clock());await Promise.resolve();active--;return id;})));
  assert.deepEqual(started,[0,1100,2200]);
  await assert.rejects(guard.logs(async()=>{throw Error('no history');}));
  assert.equal(await guard.logs(async()=>true),true);
});

function clientFixture({failLogAt=0,events=[]}={}) {
  let block=12500n,approved=false,calls=0;const ranges=[];
  const client={getChainId:async()=>5042002,getCode:async()=>'0x1234',getBlockNumber:async()=>block,
    readContract:async()=>approved,
    getLogs:async request=>{
      calls++;ranges.push([request.fromBlock,request.toBlock]);
      if(failLogAt===calls)throw Error('scan unavailable');
      return events.filter(e=>e.blockNumber>=request.fromBlock&&e.blockNumber<=request.toBlock);
    },
  };
  const chain=createArcChain({}, {client,account:{address:S},runtimeHash:sha256(Buffer.from('1234','hex')),creationBlock:1n,readGuard:createRpcReadGuard({...clocked(),logIntervalMs:0})});
  return {chain,ranges,setBlock:value=>{block=value;},setApproved:value=>{approved=value;}};
}
test('completed history scans are reused; only subsequent blocks are queried and new revocations are detected',async()=>{
  const events=[],f=clientFixture({events});
  assert.equal((await f.chain.inspect(A)).revoked,false);assert.equal(f.ranges.length,3);
  await f.chain.inspect(A);assert.equal(f.ranges.length,3);
  f.setBlock(12505n);events.push({blockNumber:12503n,args:{approved:false}});
  assert.equal((await f.chain.inspect(A)).revoked,true);assert.deepEqual(f.ranges.at(-1),[12501n,12505n]);
  f.setBlock(12507n);assert.equal((await f.chain.inspect(A)).revoked,true);
});
test('failed scans do not populate the history cache, and simultaneous account checks share one scan',async()=>{
  const f=clientFixture({failLogAt:2});
  await assert.rejects(f.chain.inspect(A));assert.equal(f.ranges.length,2);
  await Promise.all([f.chain.inspect(A),f.chain.inspect(A)]);
  assert.equal(f.ranges.length,5);
  await f.chain.inspect(A);assert.equal(f.ranges.length,5);
});
test('approved accounts skip historical logs while still checking live state for later revocation',async()=>{
  const f=clientFixture();f.setApproved(true);await f.chain.inspect(A);assert.equal(f.ranges.length,0);
  f.setApproved(false);f.setBlock(12501n);await f.chain.inspect(A);assert.deepEqual(f.ranges.at(-1),[12501n,12501n]);
});
