import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayments} from '../payments.js';
import {paymentOption,PAYMENT_OPTIONS} from '../payments-options.js';
import {nativeDollars,orderModal} from '../payment-ui.js';
const address='0x'+'a'.repeat(40),target='0x'+'c'.repeat(40),orderId='10000000-0000-4000-8000-000000000001';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){let a={authenticated:true,userId:'did:privy:one',address,approvalStatus:'approved'},listener;let signCalls=0,createCalls=0,signedCalls=0,failSigned=false,orders=[],hold=null;
 const session={getState:()=>a,subscribe:f=>{listener=f;return()=>{};},getAccessToken:async()=>a.authenticated?'token':null,refreshBalance:async()=>{},signTransaction:async()=>{signCalls++;if(hold)await hold;return '0x1212';}};
 const fetcher=async(url,options={})=>{let value;
  if(url==='/api/contests')value={ready:true,contract:target,rounds:[]};
  else if(url==='/api/purchases'&&options.method==='POST'){createCalls++;const request=JSON.parse(options.body);value={id:orderId,request,status:'awaiting_signature',expiresAt:new Date(Date.now()+120000).toISOString(),createdAt:new Date().toISOString(),entryIds:[],transaction:{chainId:5042002,from:address,to:target,value:'20000000000000000000',gas:'900000',gasPrice:'20000000000',nonce:0,data:'0x12'}};orders=[value];}
  else if(url.endsWith('/signed')){signedCalls++;if(failSigned)throw Error('Disconnected');orders=[{...orders[0],status:'confirmed',entryIds:['1','2','3','4']}];value=orders[0];}
  else if(url=== '/api/purchases/'+orderId)value=orders[0];
  else value={orders};
  return {ok:true,json:async()=>value};
 };
 const p=createPayments({session,fetcher,newId:()=>orderId});
 return {p,stats:()=>({signCalls,createCalls,signedCalls}),change(next){a=next;listener();},setHold(v){hold=v;},failSigned(v){failSigned=v;}};
}
const body={roundId:'1',horizon:'24h',guess:'12345',optionId:'four'};
test('three price options explicitly distinguish ordinary four entries from the bonus bundle',()=>{
 assert.deepEqual(PAYMENT_OPTIONS.map(p=>[p.costCents,p.spots,p.multiplier,p.method]),[[500,1,1,'enter'],[2000,4,1,'enterFour'],[5000,10,1.05,'enter']]);assert.equal(paymentOption(2000).id,'four');
 assert.equal(nativeDollars(1n,{up:true}),'$0.000001');
});
test('double clicks share one preparation and one signature; confirmed entries survive refresh',async()=>{
 const f=fixture();await f.p.refresh();const [x,y]=await Promise.all([f.p.prepare(body),f.p.prepare(body)]);assert.equal(x.id,y.id);assert.equal(f.stats().createCalls,1);
 await Promise.all([f.p.confirm(x.id),f.p.confirm(x.id)]);assert.equal(f.stats().signCalls,1);assert.equal(f.stats().signedCalls,1);assert.equal(f.p.getState().orders[0].entryIds.length,4);
 await f.p.refreshOrders();assert.equal(f.p.getState().orders[0].status,'confirmed');f.p.dispose();
});
test('interrupted signed upload retries the same authorization without signing again',async()=>{
 const f=fixture();await f.p.refresh();const o=await f.p.prepare(body);f.failSigned(true);await assert.rejects(f.p.confirm(o.id));f.failSigned(false);await f.p.confirm(o.id);assert.equal(f.stats().signCalls,1);assert.equal(f.stats().signedCalls,2);f.p.dispose();
});
test('logout while signing discards the old account response and never submits it',async()=>{
 const f=fixture();await f.p.refresh();const o=await f.p.prepare(body);let release;f.setHold(new Promise(r=>release=r));const pending=f.p.confirm(o.id);await tick();f.change({authenticated:false});release();await pending;assert.equal(f.stats().signedCalls,0);assert.deepEqual(f.p.getState().orders,[]);f.p.dispose();
});
test('confirmation states all-or-nothing terms and four entry records without a bonus',()=>{
 const order={id:orderId,request:body,status:'confirmed',entryIds:['1','2','3','4'],createdAt:new Date().toISOString()};const content=orderModal(order,{rounds:[]});assert.match(content.body,/Four separate \$5 entries/);assert.match(content.body,/1.00 · no bonus/);assert.equal((content.body.match(/<li>/g)||[]).length,4);
});
test('an account change before the first async step cannot prepare an order for the new account',async()=>{const f=fixture();await f.p.refresh();const pending=f.p.prepare(body);f.change({authenticated:true,userId:'did:privy:two',address:'0x'+'b'.repeat(40),approvalStatus:'approved'});await pending;assert.equal(f.stats().createCalls,0);f.p.dispose();});
