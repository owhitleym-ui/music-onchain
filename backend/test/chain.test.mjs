import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createPublicClient,createWalletClient,http,parseTransaction } from 'viem';
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts';
import { createArcChain,ABI } from '../src/chain.js';
import { createWorker } from '../src/worker.js';
import { createApprovalService } from '../src/service.js';
import { CHAIN_ID,CONTRACT,ORIGINAL_OWNER,sha256 } from '../src/config.js';
import { database,identity,A } from './fixtures.mjs';

test('real contract bytecode on local Anvil: ownership, zero-balance registration, approval, revocation, recovery and gas guards',async t=>{
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const executable=process.env.MUSIC_TEST_ANVIL??'anvil';
  const child=spawn(executable,['--host','127.0.0.1','--port',String(port),'--chain-id',String(CHAIN_ID),'--silent'],{stdio:'ignore'});
  let startError;child.on('error',error=>{startError=error;});
  t.after(()=>{if(!child.killed)child.kill('SIGTERM');});
  const definition={id:CHAIN_ID,name:'Local Arc contract test',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:{default:{http:['http://127.0.0.1:'+port]}}};
  const client=createPublicClient({chain:definition,transport:http('http://127.0.0.1:'+port,{retryCount:0,timeout:2000}),cacheTime:0});
  const deadline=Date.now()+10000;
  for(;;){if(startError)throw startError;try{await client.getChainId();break;}catch{if(Date.now()>deadline)throw Error('Local Anvil did not start.');await new Promise(resolve=>setTimeout(resolve,50));}}
  await client.request({method:'anvil_impersonateAccount',params:[ORIGINAL_OWNER]});
  await client.request({method:'anvil_setBalance',params:[ORIGINAL_OWNER,'0x'+(1000n*10n**18n).toString(16)]});
  const owner=createWalletClient({account:ORIGINAL_OWNER,chain:definition,transport:http('http://127.0.0.1:'+port)});
  const artifact=JSON.parse(await readFile(new URL('../../contracts/deployments/arc-testnet-curve90-artifact.json',import.meta.url),'utf8'));
  const receipt=await client.waitForTransactionReceipt({hash:await owner.deployContract({abi:artifact.abi,bytecode:'0x'+artifact.bytecode.object.replace(/^0x/,''),args:[ORIGINAL_OWNER,ORIGINAL_OWNER,ORIGINAL_OWNER],gas:6000000n,gasPrice:20000000000n}),pollingInterval:10});
  assert.equal(receipt.status,'success');const target=receipt.contractAddress;
  const key=generatePrivateKey(),administrator=privateKeyToAccount(key);
  const runtime=await client.getCode({address:target});
  const chain=createArcChain({privateKey:key},{client,account:administrator,contract:target,runtimeHash:sha256(Buffer.from(runtime.slice(2),'hex')),creationBlock:receipt.blockNumber});
  const env=await database();t.after(()=>env.db.close());
  const worker=createWorker({store:env.store,chain});
  const service=createApprovalService({store:env.store,chain});
  const drive=async(n=3)=>{for(let i=0;i<n;i++)await worker.tick();};
  const walletWrite=async(functionName,args=[])=>client.waitForTransactionReceipt({hash:await owner.writeContract({address:target,abi:ABI,functionName,args,gas:200000n,gasPrice:20000000000n}),pollingInterval:10});

  await chain.verifyDeployment();
  const fields={kind:'approve',wallet_address:A,chain_id:CHAIN_ID,contract_address:CONTRACT,signer_address:chain.signer};
  await assert.rejects(chain.preflight(fields),{code:'OWNER_NOT_READY'});
  await walletWrite('transferOwnership',[administrator.address]);
  await client.request({method:'anvil_setBalance',params:[administrator.address,'0x'+(10n*10n**18n).toString(16)]});
  await env.store.operator('accept-owner',null,chain.signer);await drive();
  assert.equal((await chain.owners()).owner,chain.signer);
  assert.equal((await env.rows())[0].state,'confirmed');

  await client.request({method:'anvil_setBalance',params:[administrator.address,'0x0']});
  await assert.rejects(chain.preflight(fields),{code:'NO_GAS'});
  await client.request({method:'anvil_setBalance',params:[administrator.address,'0x'+(10n*10n**18n).toString(16)]});
  assert.equal(await client.getBalance({address:A}),0n);
  assert.equal((await service(identity(),true)).status,'pending');
  await drive();assert.equal((await service(identity())).status,'approved');
  const approval=(await env.rows()).find(row=>row.kind==='approve');
  assert.equal(approval.state,'confirmed');
  const transaction=parseTransaction(approval.raw_transaction);
  assert.equal(transaction.to.toLowerCase(),target.toLowerCase());assert.equal(transaction.value??0n,0n);assert.equal(transaction.chainId,CHAIN_ID);
  await chain.validatePrepared(approval);
  await assert.rejects(chain.validatePrepared({...approval,wallet_address:'0x'+'b'.repeat(40)}),{code:'BAD_REQUEST'});
  const count=(await env.rows()).length;
  await service(identity(),true);await worker.tick();assert.equal((await env.rows()).length,count);

  await env.store.operator('revoke',A,chain.signer);await drive();
  assert.equal((await chain.inspect(A)).revoked,true);assert.equal((await service(identity(),true)).status,'revoked');
  await env.store.operator('reenable',A,chain.signer);await drive();assert.equal((await service(identity())).status,'approved');

  await env.store.operator('return-owner',null,chain.signer);await drive();
  assert.equal((await chain.owners()).pendingOwner,ORIGINAL_OWNER);
  await walletWrite('acceptOwnership');assert.equal((await chain.owners()).owner,ORIGINAL_OWNER);
  await assert.rejects(chain.preflight(fields),{code:'OWNER_NOT_READY'});
  for(const name of ['oracle','platformRecipient'])assert.equal((await client.readContract({address:target,abi:artifact.abi,functionName:name})).toLowerCase(),ORIGINAL_OWNER);
  await assert.rejects(chain.preflight({...fields,kind:'withdraw'}),{code:'BAD_REQUEST'});
  const bad=createArcChain({privateKey:key},{client,account:administrator,contract:target,runtimeHash:'wrong',creationBlock:receipt.blockNumber});
  await assert.rejects(bad.verifyDeployment(),{code:'RPC_UNAVAILABLE'});
  const wrongChain=createArcChain({privateKey:key},{client:{getChainId:async()=>1},account:administrator});
  await assert.rejects(wrongChain.verifyDeployment(),{code:'RPC_UNAVAILABLE'});
});
