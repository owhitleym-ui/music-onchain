import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayments,claimCallData} from '../payments.js';
import {entryModal,claimModal} from '../payment-ui.js';
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40),id='10000000-0000-4000-8000-000000000001';
const pause=()=>new Promise(r=>setImmediate(r));
function fixture(){
 let current={authenticated:true,userId:'did:privy:one',address:A,approvalStatus:'revoked'},listener,claims=[],signed=0,created=0,balance=0,bad=false,hold=null;
 const calls=[],start=Date.now()-90000000;
 const session={getState:()=>current,subscribe:f=>{listener=f;return()=>{};},getAccessToken:async()=>current.authenticated?'token':null,refreshBalance:async()=>balance++,signTransaction:async()=>{signed++;if(hold)await hold;return '0x12';}};
 const fetcher=async(path,o={})=>{
  calls.push({path,o});let value;
  if(path==='/api/contests')value={ready:true,contract:C,rounds:[{id:'1',start,deadline:start+3600000}]};
  else if(path==='/api/contests/1')value={round:{id:'1'},pools:Object.fromEntries(['24h','48h','week'].map(h=>[h,{spotCount:'4'}])),snapshot:{syncStatus:'current'}};
  else if(path==='/api/purchases')value={orders:[]};
  else if(path==='/api/account/entries')value={groups:[],snapshot:{syncStatus:'current'}};
  else if(path==='/api/claims'&&o.method==='POST'){
   created++;const entryId=JSON.parse(o.body).entryId;
   value={id,entryId,status:'awaiting_signature',expiresAt:new Date(Date.now()+120000).toISOString(),quote:{amount:'5000000000000000000',refund:true,recipient:A},transaction:{chainId:5042002,to:C,from:A,value:'0',gas:'100000',gasPrice:'20000000000',nonce:0,data:claimCallData(entryId,bad?B:A)}};claims=[value];
  }else if(path==='/api/claims')value={claims};
  else if(path==='/api/claims/'+id+'/signed'){claims=[{...claims[0],status:'confirmed',result:{amount:'5000000000000000000'}}];value=claims[0];}
  else if(path==='/api/claims/'+id&&o.method==='DELETE'){claims=[{...claims[0],status:'cancelled'}];value=claims[0];}
  else if(path==='/api/claims/'+id)value=claims[0];else throw Error(path);
  return {ok:true,json:async()=>value};
 };
 const payments=createPayments({session,fetcher,newId:()=>id});
 return {payments,calls,get signed(){return signed;},get created(){return created;},get balance(){return balance;},bad:()=>bad=true,hold:p=>hold=p,logout(){current={authenticated:false};listener();}};
}
test('each claim has explicit review, exact calldata, and can be collected after buying permission is revoked',async()=>{
 const f=fixture();await f.payments.refresh();const quote=await f.payments.prepareClaim('2');assert.equal(f.created,1);assert.equal(f.signed,0);assert.equal(quote.entryId,'2');
 await f.payments.confirmClaim(id);await pause();assert.equal(f.signed,1);assert.equal(f.payments.getState().claims[0].status,'confirmed');assert.ok(f.balance>0);
 await f.payments.confirmClaim(id);assert.equal(f.signed,1);f.payments.dispose();
});
test('claim signing rejects a changed recipient before requesting a signature',async()=>{
 const f=fixture();f.bad();await f.payments.refresh();await f.payments.prepareClaim('2');await assert.rejects(f.payments.confirmClaim(id),/details changed/);assert.equal(f.signed,0);f.payments.dispose();
});
test('logout during signing clears private claims and never submits the old account signature',async()=>{
 const f=fixture();await f.payments.refresh();await f.payments.prepareClaim('2');let release;f.hold(new Promise(r=>release=r));const pending=f.payments.confirmClaim(id);await pause();f.logout();release();await pending;
 assert.deepEqual(f.payments.getState().claims,[]);assert.equal(f.calls.filter(c=>c.path.endsWith('/signed')).length,0);f.payments.dispose();
});
test('cancelled unsigned collection is recoverable and never requests a signature',async()=>{
 const f=fixture();await f.payments.refresh();await f.payments.prepareClaim('2');await f.payments.cancelClaim(id);assert.equal(f.payments.getState().claims[0].status,'cancelled');assert.equal(f.signed,0);f.payments.dispose();
});
test('$20 details show four independent collection actions and one received entry stays separate',()=>{
 const entries=Array.from({length:4},(_,i)=>({entryId:String(i+1),guess:'123',paid:'5000000000000000000',spots:'1',multiplierBps:10000,windowStart:Date.now(),windowEnd:Date.now(),status:i===0?'claimed':'claimable',claimableAmount:i===0?'0':'9410000000000000000'}));
 const group={totalPaid:'20000000000000000000',spotCount:'4',receivedAmount:'9410000000000000000',claimableAmount:'28230000000000000000',realizedNet:'4410000000000000000',contestStatus:'partially_claimed',entries};
 const modal=entryModal(group,{claimsReady:true});assert.equal((modal.body.match(/data-action="claim-prepare"/g)||[]).length,3);assert.doesNotMatch(modal.body,/data-entry-id="1"/);assert.match(modal.body,/Four separate/);
});
test('collection review separates estimated returns and fees from confirmed received money',()=>{
 const c={id,entryId:'1',status:'awaiting_signature',expiresAt:new Date(Date.now()+120000).toISOString(),quote:{amount:'5000000000000000000',refund:true,recipient:A},transaction:{gas:'100000',gasPrice:'20000000000'}};
 const review=claimModal(c);assert.match(review.body,/Expected amount/);assert.match(review.body,/Network fee/);assert.doesNotMatch(review.body,/<dt>Received/);assert.match(review.footer,/Confirm collection/);assert.doesNotMatch(review.body,/0x[a-f0-9]{40}|MetaMask|USDC/);
 const done=claimModal({...c,status:'confirmed',transaction:undefined,result:{amount:'5000000000000000000'}});assert.match(done.body,/<dt>Received/);assert.doesNotMatch(done.footer,/Confirm collection/);
});
