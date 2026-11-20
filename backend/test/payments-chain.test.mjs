import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createPublicClient,createWalletClient,http} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {createContestChain,CONTEST_ABI,SONG_ID} from '../src/contest-chain.js';
import {createPurchaseService,createPaymentWorker,normalizePurchase} from '../src/purchases.js';
import {ORIGINAL_OWNER,CHAIN_ID,sha256} from '../src/config.js';

test('actual atomic bytecode: payment signatures, receipts, four records, recovery and weighted guesses',async t=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const process=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id',String(CHAIN_ID),'--silent'],{stdio:'ignore'});t.after(()=>process.kill('SIGTERM'));
 const transport=http('http://127.0.0.1:'+port,{retryCount:0,timeout:2000});const client=createPublicClient({transport,cacheTime:0});
 for(let i=0;;i++){try{await client.getChainId();break;}catch(e){if(i>100)throw e;await new Promise(r=>setTimeout(r,40));}}
 await client.request({method:'anvil_impersonateAccount',params:[ORIGINAL_OWNER]});await client.request({method:'anvil_setBalance',params:[ORIGINAL_OWNER,'0x'+(10000n*10n**18n).toString(16)]});
 const owner=createWalletClient({account:ORIGINAL_OWNER,transport});const artifact=JSON.parse(await readFile(new URL('../../contracts/deployments/arc-testnet-atomic-artifact.json',import.meta.url),'utf8'));
 async function mine(hash){return client.waitForTransactionReceipt({hash,pollingInterval:10});}
 const deployed=await mine(await owner.deployContract({abi:CONTEST_ABI,bytecode:artifact.bytecode.object,args:[ORIGINAL_OWNER,ORIGINAL_OWNER,ORIGINAL_OWNER],chain:null,gas:6500000n,gasPrice:20000000000n}));
 const target=deployed.contractAddress,participant=privateKeyToAccount(generatePrivateKey()),identity={userId:'did:privy:buyer',wallet:participant.address.toLowerCase()};
 await client.request({method:'anvil_setBalance',params:[participant.address,'0x'+(500n*10n**18n).toString(16)]});
 const checked=async hash=>{const receipt=await mine(hash);assert.equal(receipt.status,'success','local fixture transaction reverted');return receipt;};
 const write=(functionName,args=[],value=0n)=>owner.writeContract({address:target,abi:CONTEST_ABI,functionName,args,value,chain:null,gas:8000000n,gasPrice:20000000000n}).then(checked);
 await write('approveWallet',[participant.address,true]);await write('fundBonusReserve',[],10n*10n**18n);
 const start=(Number((await client.getBlock()).timestamp)/3600|0)*3600+3600;
 await write('createRound',[SONG_ID,'demo:last-bus-home',ORIGINAL_OWNER,BigInt(start)]);await client.request({method:'evm_setNextBlockTimestamp',params:[start+10]});await client.request({method:'evm_mine'});
 const runtime=await client.getCode({address:target});const config={atomic:true,contract:target.toLowerCase(),chainId:CHAIN_ID,deployment:{creationBlock:Number(deployed.blockNumber),runtimeSha256:sha256(Buffer.from(runtime.slice(2),'hex'))}};
 const chain=createContestChain(config,{client}),rows=[];
 const store={list:async()=>rows,get:async id=>rows.find(x=>x.id===id),byKey:async key=>rows.find(x=>x.idempotency_key===key),
 create:async(i,key,request,transaction,expires)=>{const o={id:randomUUID(),idempotency_key:key,privy_user_id:i.userId,wallet_address:i.wallet,contract_address:config.contract,request,transaction,nonce:transaction.nonce,expires_at:expires,created_at:new Date().toISOString(),state:'awaiting_signature',entry_ids:[]};rows.push(o);return o;},
 action:async(id,i,a,raw,hash)=>{const o=rows.find(x=>x.id===id);Object.assign(o,{raw_transaction:raw,transaction_hash:hash,state:'prepared'});return o;},
 claim:async()=>{const o=rows.find(x=>['prepared','submitted','uncertain'].includes(x.state));if(o)o.lease_version=(o.lease_version??0)+1;return o;},
 update:async(o,w,patch)=>{Object.assign(o,patch);if(patch.state==='submitted')o.broadcast_at=new Date().toISOString();return o;}};
 const service=createPurchaseService({store,chain,config});let worker=createPaymentWorker({store,chain});
 const rawFor=(order,change={})=>{const x=order.transaction;return participant.signTransaction({chainId:CHAIN_ID,to:x.to,data:x.data,value:BigInt(x.value),nonce:x.nonce,gas:BigInt(x.gas),gasPrice:BigInt(x.gasPrice),type:'legacy',...change});};
 await t.test('backend validates malformed prices, horizons and predictions',async()=>{
  for(const bad of [{roundId:'1',horizon:'24h',guess:'-1',optionId:'four'},{roundId:'1',horizon:'24h',guess:'1.2',optionId:'four'},{roundId:'1',horizon:'24h',guess:'1',optionId:'evil'},{roundId:'1',horizon:'wrong',guess:'1',optionId:'four'}])assert.throws(()=>normalizePurchase(bad));
 });
 for(const[optionId,guess,records]of [['single','100',1],['four','120',4],['bundle','150',1]])await t.test(optionId+' creates exactly the intended entry records',async()=>{
  const key=randomUUID(),body={roundId:'1',horizon:'24h',guess,optionId};const order=await service.create(identity,body,key);
  assert.equal((await service.create(identity,{...body},key)).id,order.id);
  await assert.rejects(service.signed(order.id,identity,await rawFor(order,{value:1n})),/BAD_SIGNATURE/);
  const raw=await rawFor(order);await service.signed(order.id,identity,raw);
  // A worker restart after the durable save recovers the original authorization.
  worker=createPaymentWorker({store,chain});await worker.tick();await worker.tick();
  const result=await service.get(order.id,identity);assert.equal(result.status,'confirmed');assert.equal(result.entryIds.length,records);
  const hash=result.transactionHash;await service.signed(order.id,identity,raw);await worker.tick();assert.equal((await service.get(order.id,identity)).transactionHash,hash);
 });
 await t.test('totals and four identical guesses are counted by spots',async()=>{
  chain.invalidate();const pool=await chain.pool('1','24h');assert.equal(pool.spotCount,'15');assert.equal(pool.peopleCount,'1');assert.equal(pool.totalDeposits,'75000000000000000000');assert.equal(pool.average,2080/15);assert.equal(pool.mode,'150');assert.equal(pool.modeSpots,10);
  for(const id of rows[1].entry_ids){const e=await client.readContract({address:target,abi:CONTEST_ABI,functionName:'getEntry',args:[BigInt(id)]});assert.equal(e.spots,1);assert.equal(e.multiplierBps,10000);assert.equal(e.paid,5n*10n**18n);}
 });
 await t.test('tampered receipts never create false successful purchases',async()=>{
  const receipt=await client.getTransactionReceipt({hash:rows[1].transaction_hash});
  await assert.rejects(chain.verifyReceipt(rows[1],{...receipt,logs:receipt.logs.slice(0,1)}),/PAYMENT_MISMATCH/);
 });
 await t.test('insufficient balance including gas and closed rounds are rejected',async()=>{
  await client.request({method:'anvil_setBalance',params:[participant.address,'0x'+(20n*10n**18n).toString(16)]});
  await assert.rejects(chain.preflight(identity,{roundId:'1',horizon:'24h',guess:'1',optionId:'four'}),/INSUFFICIENT_BALANCE/);
  await client.request({method:'evm_setNextBlockTimestamp',params:[start+3600]});await client.request({method:'evm_mine'});
  await assert.rejects(chain.preflight(identity,{roundId:'1',horizon:'24h',guess:'1',optionId:'four'}),/ROUND_CLOSED/);
 });
 await t.test('live-read adapters follow real local settlement, claims and cancellation refunds',async()=>{
  const before=await chain.snapshot(),counts=await chain.counters(before.number);
  assert.equal(counts.nextRoundId,2n);assert.equal(counts.nextEntryId,7n);
  assert.equal((await chain.readRound('1',before.number)).start,BigInt(start));
  assert.equal((await chain.readPool('1','24h',before.number)).spotCount,15n);
  const id=rows[1].entry_ids[0];
  assert.equal((await chain.readEntry(id,before.number)).claimed,false);
  assert.equal(await chain.claimable(id,before.number),0n);
  await assert.rejects(chain.readOutcome(id,before.number));
  await client.request({method:'evm_setNextBlockTimestamp',params:[start+86400]});await client.request({method:'evm_mine'});
  await write('submitResult',[1n,0,120n,'0x'+'2'.repeat(64)]);
  await write('submitOrder',[1n,0,[1n,2n,3n,4n,0n,...Array.from({length:10},(_,i)=>BigInt(i+5))]]);
  await write('advanceSettlement',[1n,0,16n]);await write('advanceSettlement',[1n,0,16n]);
  const finalized=await chain.snapshot();assert.equal((await chain.readPool('1','24h',finalized.number)).phase,4);
  const outcome=await chain.readOutcome(id,finalized.number);assert.ok(outcome.returned>0n);
  assert.equal(await chain.claimable(id,finalized.number),outcome.returned);
  const fan=createWalletClient({account:participant,transport});
  const fanWrite=(functionName,args,value=0n)=>fan.writeContract({address:target,abi:CONTEST_ABI,functionName,args,value,chain:null,gas:2000000n,gasPrice:20000000000n}).then(checked);
  await fanWrite('claimEntry',[BigInt(id),participant.address]);
  const claimed=await chain.snapshot();assert.equal((await chain.readEntry(id,claimed.number)).claimed,true);assert.equal(await chain.claimable(id,claimed.number),0n);
  const nextStart=Math.ceil((Number(claimed.timestamp)+120)/3600)*3600;
  await write('createRound',[SONG_ID,'demo:last-bus-home',ORIGINAL_OWNER,BigInt(nextStart)]);
  await client.request({method:'evm_setNextBlockTimestamp',params:[nextStart+10]});await client.request({method:'evm_mine'});
  await fanWrite('enter',[2n,0,200n],5n*10n**18n);await write('cancelPool',[2n,0]);
  const cancelled=await chain.snapshot();assert.equal((await chain.readPool('2','24h',cancelled.number)).phase,5);assert.equal(await chain.claimable('7',cancelled.number),5n*10n**18n);
  await fanWrite('claimEntry',[7n,participant.address]);const refunded=await chain.snapshot();assert.equal((await chain.readEntry('7',refunded.number)).claimed,true);assert.equal(await chain.claimable('7',refunded.number),0n);
 });
});
