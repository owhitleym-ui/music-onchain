import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaymentWorker} from '../src/purchases.js';
const hash='0x'+'a'.repeat(64);
function fixture(){const order={id:'order',state:'prepared',raw_transaction:'0x12',transaction_hash:hash,nonce:0,wallet_address:'wallet',lease_version:1};let sends=0,received=false,lost=false,dbDown=false;
 const store={claim:async()=>['prepared','submitted','uncertain'].includes(order.state)?{...order}:null,update:async(o,w,p)=>{if(dbDown)throw Error('database down');Object.assign(order,p);if(p.state==='submitted')order.broadcast_at=new Date().toISOString();}};
 const chain={verify:async()=>{},validate:async()=>hash,receipt:async()=>received?{status:'success',gasUsed:2n,effectiveGasPrice:3n,blockNumber:5n}:null,verifyReceipt:async()=>['1','2','3','4'],latestNonce:async()=>0,canBroadcast:async()=>true,known:async()=>sends>0,broadcast:async raw=>{assert.equal(raw,'0x12');sends++;if(lost)throw Error('response lost');return hash;}};
 return {order,chain,store,worker:()=>createPaymentWorker({chain,store}),sends:()=>sends,mine:()=>received=true,lose:()=>lost=true,db:val=>dbDown=val};
}
test('lost broadcast responses reconcile the saved transaction without creating a replacement',async()=>{const f=fixture();f.lose();await f.worker().tick();assert.equal(f.order.state,'submitted');f.mine();await f.worker().tick();assert.equal(f.order.state,'confirmed');assert.equal(f.sends(),1);});
test('database failure after broadcast recovers the existing receipt after restart',async()=>{const f=fixture();f.db(true);await f.worker().tick();assert.equal(f.sends(),1);assert.equal(f.order.raw_transaction,'0x12');f.db(false);f.mine();await f.worker().tick();assert.equal(f.order.state,'confirmed');assert.equal(f.sends(),1);});
test('database unavailable before claiming never submits a payment',async()=>{const f=fixture();f.store.claim=async()=>{throw Error('offline');};await f.worker().tick();assert.equal(f.sends(),0);});
test('a missing receipt and consumed nonce stay uncertain rather than allowing another charge',async()=>{const f=fixture();f.chain.latestNonce=async()=>1;await f.worker().tick();assert.equal(f.order.state,'uncertain');assert.equal(f.sends(),0);});
test('reverted receipt records network fee and no entry records',async()=>{const f=fixture();f.chain.receipt=async()=>({status:'reverted',gasUsed:2n,effectiveGasPrice:3n,blockNumber:5n});await f.worker().tick();assert.equal(f.order.state,'failed');assert.equal(f.order.network_fee,'6');assert.equal(f.order.entry_ids,undefined);});
