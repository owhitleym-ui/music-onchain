import {createMarketScheduler} from '../src/market-scheduler.js';
import {createPurchaseService,createPaymentWorker} from '../src/purchases.js';
import {createClaimChain,createClaimService} from '../src/claims.js';
import {scheduleFor} from '../../shared/market-schedule.js';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,http,keccak256,toBytes} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {createContestChain,SONG_ID} from '../src/contest-chain.js';
import {DAILY_ABI} from '../src/market-model.js';
import {createArcChain} from '../src/chain.js';
import {createWorker} from '../src/worker.js';
import {createSettlementCoordinator,prepareResult} from '../src/settlement.js';
import {CHAIN_ID,sha256,ORIGINAL_OWNER} from '../src/config.js';

test('V3 actual bytecode: scheduler recovery, exact deadlines, typed purchases, sample settlement, independent claims and refunds',async t=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const node=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id',String(CHAIN_ID),'--silent','--timestamp','1795199400'],{stdio:'ignore'});t.after(()=>node.kill('SIGTERM'));
 const transport=http('http://127.0.0.1:'+port,{retryCount:0,timeout:2000}),client=createPublicClient({transport,cacheTime:0});
 for(let i=0;;i++){try{await client.getChainId();break;}catch(e){if(i>100)throw e;await new Promise(r=>setTimeout(r,30));}}
 const key=generatePrivateKey(),owner=privateKeyToAccount(key),oracle=privateKeyToAccount(generatePrivateKey()),artist={address:ORIGINAL_OWNER},a=privateKeyToAccount(generatePrivateKey()),b=privateKeyToAccount(generatePrivateKey());
 for(const account of [owner,oracle,artist,a,b])await client.request({method:'anvil_setBalance',params:[account.address,'0x'+(1000n*10n**18n).toString(16)]});
 await client.request({method:'anvil_impersonateAccount',params:[ORIGINAL_OWNER]});
 const wallets=new Map([owner,oracle,artist,a,b].map(account=>[account.address,createWalletClient({account:account.signTransaction?account:account.address,transport})]));
 const artifact=JSON.parse(await readFile(new URL('../../contracts/deployments/arc-testnet-markets-v3-artifact.json',import.meta.url),'utf8'));
 async function mine(hash){const receipt=await client.waitForTransactionReceipt({hash,pollingInterval:10});assert.equal(receipt.status,'success');return receipt;}
 const deployed=await mine(await wallets.get(owner.address).deployContract({abi:DAILY_ABI,bytecode:artifact.bytecode.object,args:[owner.address,oracle.address,artist.address],chain:null,gas:8000000n,gasPrice:20000000000n})),target=deployed.contractAddress;
 const write=(account,functionName,args=[],value=0n)=>wallets.get(account.address).writeContract({address:target,abi:DAILY_ABI,functionName,args,value,chain:null,gas:8000000n,gasPrice:20000000000n}).then(mine);
 const read=(functionName,args=[])=>client.readContract({address:target,abi:DAILY_ABI,functionName,args});
 const jump=async seconds=>{await client.request({method:'evm_setNextBlockTimestamp',params:[seconds]});await client.request({method:'evm_mine'});};
 const runtime=await client.getCode({address:target}),config={atomic:true,schedulerEnabled:true,settlementEnabled:true,privateKey:key,contract:target.toLowerCase(),chainId:CHAIN_ID,deployment:{marketModelVersion:3,deploymentId:'markets-v3',creationBlock:Number(deployed.blockNumber),runtimeSha256:sha256(Buffer.from(runtime.slice(2),'hex')),oracle:oracle.address}};
 const chain=createContestChain(config,{client}),adminChain=createArcChain(config,{client}),jobs=[];let seq=0;
 const admin={pendingSettlement:async()=>jobs.some(j=>!['confirmed','cancelled','reverted'].includes(j.state)),operator:async(kind,_wallet,signer,payload)=>{const previous=jobs.find(j=>j.kind===kind&&JSON.stringify(j.payload)===JSON.stringify(payload)&&!['confirmed','cancelled','reverted'].includes(j.state));if(previous)return previous;const job={id:String(++seq),kind,payload,signer_address:signer,chain_id:CHAIN_ID,contract_address:config.contract,state:'queued',nonce:null};jobs.push(job);return job;},claim:async()=>{const job=jobs.find(j=>!['confirmed','cancelled','reverted'].includes(j.state));return job?{job,fence:1,paused:false}:null;},renew:async()=>true,update:async(id,_worker,_fence,patch)=>{const row=jobs.find(j=>j.id===id);Object.assign(row,patch);if(patch.state==='submitted')row.broadcast_at=new Date().toISOString();return row;}};
 const worker=createWorker({store:admin,chain:adminChain});
 await write(owner,'approveWallet',[a.address,true]);await write(owner,'approveWallet',[b.address,true]);await write(owner,'fundBonusReserve',[],10n*10n**18n);
 const current=scheduleFor('day_plus_1',Number((await client.getBlock()).timestamp)*1000),start=current.entryStart/1000;
 const scheduler=createMarketScheduler({config,chain,admin,signer:owner.address.toLowerCase()});
 await scheduler.tick();await scheduler.tick();assert.equal(jobs.length,2);
 await client.request({method:'anvil_setBalance',params:[owner.address,'0x0']});await worker.tick();assert.equal(jobs[0].state,'blocked');
 await client.request({method:'anvil_setBalance',params:[owner.address,'0x'+(1000n*10n**18n).toString(16)]});
 for(let i=0;i<15&&jobs.some(j=>j.state!=='confirmed');i++)await worker.tick();
 assert.ok(jobs.every(j=>j.state==='confirmed'),JSON.stringify(jobs.map(j=>({kind:j.kind,state:j.state,error:j.error_code}))));
 await scheduler.tick();assert.equal(jobs.length,2);assert.equal(await read('roundFor',[SONG_ID,1,BigInt(start)]),1n);
 assert.equal(await read('roundFor',[SONG_ID,1,BigInt(current.entryEnd/1000)]),2n);
 jobs.splice(0);
 await write(a,'enter',[1n,0,100n],5n*10n**18n);const paymentRows=[],identity={userId:'did:privy:v2',wallet:a.address.toLowerCase()};
 const paymentStore={list:async()=>paymentRows,get:async id=>paymentRows.find(o=>o.id===id),byKey:async key=>paymentRows.find(o=>o.idempotency_key===key),
 create:async(i,key,request,transaction,expires,round)=>{const o={id:randomUUID(),idempotency_key:key,wallet_address:i.wallet,contract_address:config.contract,request,transaction,nonce:transaction.nonce,expires_at:expires,round,state:'awaiting_signature'};paymentRows.push(o);return o;},
 action:async(id,_i,_action,raw,hash)=>Object.assign(paymentRows.find(o=>o.id===id),{raw_transaction:raw,transaction_hash:hash,state:'prepared'}),
 claim:async()=>paymentRows.find(o=>['prepared','submitted','uncertain'].includes(o.state)),update:async(o,_worker,patch)=>Object.assign(o,patch)};
 const purchases=createPurchaseService({config,chain,store:paymentStore}),request={deploymentId:'markets-v3',roundId:'1',marketType:'day_plus_1',guess:'100',optionId:'four'};
 const quoted=await purchases.create(identity,request,randomUUID()),tx=quoted.transaction;
 const raw=await a.signTransaction({chainId:CHAIN_ID,to:tx.to,data:tx.data,value:BigInt(tx.value),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice),nonce:tx.nonce,type:'legacy'});
 await purchases.signed(quoted.id,identity,raw);const paymentWorker=createPaymentWorker({chain,store:paymentStore});await paymentWorker.tick();await paymentWorker.tick();
 assert.equal(paymentRows[0].state,'confirmed');assert.deepEqual(paymentRows[0].entry_ids,['2','3','4','5']);await write(b,'enter',[1n,0,120n],50n*10n**18n);
 const evidence=new Map(),store={save:async document=>{const hash=keccak256(toBytes(JSON.stringify(document)));evidence.set(hash,{document});return hash;},evidence:async hash=>evidence.get(hash),entries:async(_pool,block)=>{
  const ids=await client.readContract({address:target,abi:DAILY_ABI,functionName:'getPoolEntries',args:[1n,0,0n,100n],blockNumber:block});
  return Promise.all(ids.map(async id=>{const e=await chain.readEntry(id.toString(),block);return {id:id.toString(),guess:e.guess.toString(),spots:e.spots.toString(),firstTicketId:e.firstTicketId.toString(),purchasedAt:e.purchasedAt.toString(),paid:e.paid.toString()};}));
 }};
 await assert.rejects(prepareResult({config,chain,store,roundId:'1',horizon:'day_plus_1',actualViews:'120'}),/RESULT_WINDOW_CLOSED/);
 await jump(current.entryEnd/1000);await assert.rejects(chain.preflight(identity,request),/ROUND_CLOSED/);
 await assert.rejects(prepareResult({config,chain,store,roundId:'1',horizon:'day_plus_1',actualViews:'120'}),/RESULT_WINDOW_CLOSED/);
 await jump(current.windowEnd/1000);
 const prepared=await prepareResult({config,chain,store,roundId:'1',horizon:'day_plus_1',actualViews:'120'});assert.equal(prepared.from.toLowerCase(),oracle.address.toLowerCase());
 await mine(await wallets.get(oracle.address).sendTransaction({to:target,data:prepared.data,value:0n,chain:null,gas:1000000n,gasPrice:20000000000n}));
 await write(owner,'submitOrder',[1n,0,[5n]]);
 await admin.operator('restart-order',null,owner.address.toLowerCase(),{roundId:'1',horizon:'day_plus_1',epoch:'1',offset:'1'});for(let i=0;i<3;i++)await worker.tick();assert.equal((await read('getPool',[1n,0])).epoch,2n);
 const coordinator=createSettlementCoordinator({config,chain,store,admin,signer:owner.address.toLowerCase(),live:{catalog:async()=>({snapshot:{syncStatus:'current'},rounds:[{id:'1',cadence:'daily'}]})}});
 for(let i=0;i<40&&(await read('getPool',[1n,0])).phase!==4;i++){
  await coordinator.tick();for(let j=0;j<3;j++)await worker.tick();
  assert.ok(jobs.every(j=>!['blocked','uncertain','reverted'].includes(j.state)),JSON.stringify(jobs.map(j=>({kind:j.kind,state:j.state,error:j.error_code}))));
 }
 const pool=await read('getPool',[1n,0]);assert.equal(pool.phase,4);assert.equal(jobs.length,4);assert.ok((await read('getEntryOutcome',[6n])).bonus>0n);assert.ok(pool.subsidyUsed>0n);assert.equal(await read('freeBonusReserve'),10n*10n**18n-pool.subsidyUsed);assert.equal(pool.totalReturns+pool.artistFees+pool.appFees,pool.totalDeposits+pool.subsidyUsed);
 const claimChain=createClaimChain({config,chain,client});const claimQuote=await claimChain.preflight(identity,'2');assert.equal(claimQuote.round.horizon,'day_plus_1');
 const partial=await write(a,'claimEntry',[2n,a.address]);assert.ok(partial.gasUsed>0n);assert.equal((await read('getEntry',[2n])).claimed,true);assert.equal((await read('getEntry',[3n])).claimed,false);
 let collected=(await read('getEntryOutcome',[2n])).returned;
 for(const id of [1n,3n,4n,5n,6n]){const e=await read('getEntry',[id]);const account=e.payer.toLowerCase()===a.address.toLowerCase()?a:b;collected+=await read('claimable',[id]);await write(account,'claimEntry',[id,account.address]);}
 assert.equal(collected,pool.totalReturns);assert.equal(await read('returnLiability'),0n);
 const fees=await read('feeCredits',[artist.address]);assert.equal(fees,pool.artistFees+pool.appFees);await write(artist,'claimFees',[artist.address]);assert.equal(await read('feeCredits',[artist.address]),0n);assert.equal(await read('feeLiability'),0n);
 await assert.rejects(client.simulateContract({address:target,abi:DAILY_ABI,functionName:'claimEntry',args:[2n,a.address],account:a.address}));
 // Cancellation and timeout refunds on a freshly created daily round.
 const later=scheduleFor('day_plus_1',Number((await client.getBlock()).timestamp)*1000);
 const {creationPayload}=await import('../src/market-scheduler.js');
 const payload=creationPayload(later,[]);
 await write(owner,'createDailyRound',[SONG_ID,'demo:last-bus-home',artist.address,payload.times.map(BigInt),[]]);
 await write(a,'enter',[3n,0,1n],5n*10n**18n);
 await admin.operator('cancel-pool',null,owner.address.toLowerCase(),{roundId:'3',horizon:'day_plus_1',reason:'Disposable cancellation test'});
 for(let i=0;i<3;i++)await worker.tick();
 assert.equal(await read('claimable',[7n]),5n*10n**18n);await write(a,'claimEntry',[7n,a.address]);
 await write(a,'enterFour',[3n,1,1n],20n*10n**18n);await write(owner,'approveWallet',[a.address,false]);
 await jump(Number((await read('getPool',[3n,1])).refundAt));
 for(const id of [8n,9n,10n,11n]){assert.equal(await read('claimable',[id]),5n*10n**18n);await write(a,'claimEntry',[id,a.address]);}
 assert.equal((await read('getPool',[3n,1])).phase,5);assert.equal(await read('escrowLiability'),0n);assert.equal(await read('isSolvent'),true);assert.equal(await client.getBalance({address:target}),await read('accountedBalance'));
});
