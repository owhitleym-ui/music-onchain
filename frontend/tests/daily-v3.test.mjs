import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createPayments,purchaseCallData} from '../payments.js';
import {resolveMarket,renderMarket,marketLink} from '../market-ui.js';
import {scheduleFor,HOUR,marketKey} from '../../shared/market-schedule.js';
import {orderModal,entryModal} from '../payment-ui.js';
const C='0x'+'c'.repeat(40),A='0x'+'a'.repeat(40),id='10000000-0000-4000-8000-000000000001';
const snapshot={syncStatus:'current',asOfBlock:'10',verifiedAt:new Date().toISOString()};
function fixture(){
 let now=Date.parse('2026-11-20T18:30Z'),signed=0,orders=[],listener;const calls=[];
 const s=scheduleFor('day_plus_1',now),market={...s,id:marketKey('markets-v3','1','day_plus_1'),deploymentId:'markets-v3',roundId:'1',marketType:'day_plus_1',entryStart:s.entryStart,entryEnd:s.entryEnd,roundStart:s.entryStart,deadline:s.entryEnd,open:true,spotCount:'0',peopleCount:'0',totalDeposits:'0',snapshot};
 const catalog={marketModelVersion:3,ready:true,contract:C,deploymentId:'markets-v3',markets:[market],rounds:[{id:'1',start:s.entryStart,deadline:s.entryEnd,cadence:'daily'}],deployments:[{id:'markets-v3',contract:C,modelVersion:3,active:true},{id:'atomic-v1',contract:'0x'+'b'.repeat(40),modelVersion:1}]};
 const session={getState:()=>({authenticated:true,userId:'did:privy:test',address:A,approvalStatus:'approved'}),subscribe:f=>{listener=f;return()=>{};},getAccessToken:async()=>'token',refreshBalance:async()=>{},signTransaction:async()=>{signed++;return '0x12';}};
 const fetcher=async(path,options={})=>{calls.push(path);let value;
  if(path==='/api/markets')value=catalog;
  else if(path.startsWith('/api/markets/'))value={...market,open:now<s.entryEnd};
  else if(path==='/api/contests')value={ready:false,rounds:[],contract:'0x'+'b'.repeat(40)};
  else if(path.startsWith('/api/account/entries'))value={groups:[],snapshot};
  else if(path==='/api/claims')value={claims:[]};
  else if(path==='/api/purchases'&&options.method==='POST'){const request=JSON.parse(options.body);value={id,request,contract:C,status:'awaiting_signature',createdAt:new Date(now).toISOString(),expiresAt:new Date(s.entryEnd).toISOString(),round:{id:'1',start:s.entryStart,deadline:s.entryEnd},transaction:{chainId:5042002,from:A,to:C,value:'20000000000000000000',gas:'900000',gasPrice:'20000000000',nonce:0,data:purchaseCallData(request)}};orders=[value];}
  else if(path==='/api/purchases')value={orders};
  else if(path==='/api/purchases/'+id)value=orders[0];
  else if(path.endsWith('/signed'))value=orders[0]={...orders[0],status:'submitted'};else throw Error(path);
  return {ok:true,json:async()=>value};};
 const payments=createPayments({session,fetcher,clock:()=>now,newId:()=>id});return {payments,market,catalog,calls,get signed(){return signed;},jump:()=>now=s.entryEnd,body:{deploymentId:'markets-v3',roundId:'1',marketType:'day_plus_1',guess:'123',optionId:'four'}};
}
test('typed purchases use exact new market identity and explicit signing; deadline blocks stale quotes',async()=>{
 const f=fixture();await f.payments.refresh();const q=await f.payments.prepare(f.body);assert.equal(f.signed,0);await f.payments.confirm(q.id);assert.equal(f.signed,1);f.payments.dispose();
 const g=fixture();await g.payments.refresh();const old=await g.payments.prepare(g.body);g.jump();await assert.rejects(g.payments.confirm(old.id),/closed/);assert.equal(g.signed,0);g.payments.dispose();
});
test('current following and pinned historical markets stay separate; display zone never changes purchase identity',()=>{
 const f=fixture(),context={marketType:'day_plus_1'},state={marketCatalog:f.catalog,marketDetails:{}};
 assert.equal(resolveMarket(context,state,f.market.entryStart),f.market);assert.equal(resolveMarket(context,state,f.market.entryEnd),null);
 const pinned={marketType:'day_plus_1',pinnedMarket:true,deploymentId:'markets-v3',liveRoundId:'1'};assert.equal(resolveMarket(pinned,state,f.market.entryEnd),f.market);
 assert.match(marketLink('last-bus-home','day_plus_7'),/marketType=day_plus_7/);assert.doesNotMatch(marketLink(),/horizon=/);
});
test('daily review shows Austin target dates; legacy review retains original targets',()=>{
 const start=Date.parse('2026-11-20T18:00Z'),base={id,status:'confirmed',createdAt:new Date(start).toISOString(),request:{roundId:'1',marketType:'day_plus_1',optionId:'four',guess:'12'},round:{start,deadline:start+HOUR},entryIds:[]};
 const next=orderModal(base,{});assert.match(next.body,/Tomorrow/);assert.match(next.body,/Nov 21, 2026/);assert.match(next.body,/Nov 22, 2026/);assert.match(next.body,/12:00 AM CST/);
 const old=orderModal({...base,request:{roundId:'1',horizon:'24h',optionId:'four',guess:'12'}},{});assert.match(old.body,/24h/);assert.doesNotMatch(old.body,/Tomorrow/);
});
test('daily previews label simulated units and keep purchase inputs disabled',()=>{
 const w=new Window();globalThis.localStorage=w.localStorage;
 const f=fixture(),args={context:{song:{id:'preview',title:'Preview',dailyViews:24000},marketType:'day_plus_1'},payments:{getState:()=>({marketCatalog:{ready:false},marketDetails:{}}),serverNow:()=>f.market.entryStart},ui:{amount:500,guess:'',formError:''},artist:{name:'Artist'},cover:()=>'',followButton:()=>''};
 const dailyTomorrow=renderMarket(args);assert.match(dailyTomorrow,/views per day/);assert.match(dailyTomorrow,/This song is a preview/);assert.match(dailyTomorrow,/id="prediction-guess"[^>]*disabled/);assert.doesNotMatch(dailyTomorrow,/Hourly bidding|1-hour count/);
 const daily=renderMarket({...args,context:{...args.context,marketType:'day_plus_7'}});assert.match(daily,/views per day/);assert.match(daily,/Whole Austin calendar day/);assert.match(daily,/midnight in Austin/);
 delete globalThis.localStorage;w.happyDOM.abort();
});

test('daily V3 shows current target dates and fee rules without changing historical labels',()=>{
 const w=new Window();globalThis.localStorage=w.localStorage;
 const f=fixture(),args={context:{song:{id:'preview',title:'Preview',dailyViews:24000},marketType:'day_plus_2'},payments:{getState:()=>({marketCatalog:{ready:false},marketDetails:{}}),serverNow:()=>f.market.entryStart},ui:{amount:500,guess:'',formError:''},artist:{name:'Artist'},cover:()=>'',followButton:()=>''};
 const html=renderMarket(args);assert.match(html,/Tomorrow/);assert.match(html,/Day after tomorrow/);assert.match(html,/2026-11-21/);assert.match(html,/2026-11-22/);assert.match(html,/2026-11-27/);assert.match(html,/85% to the winner and 5% to the artist/);assert.match(html,/one percentage point/);
 const legacy=orderModal({id,status:'confirmed',createdAt:new Date(f.market.entryStart).toISOString(),request:{deploymentId:'markets-v2',roundId:'1',marketType:'next_hour',optionId:'single',guess:'1'},round:{start:Date.parse('2026-11-20T18:00Z'),deadline:Date.parse('2026-11-20T19:00Z')},entryIds:[]},{});
 assert.match(legacy.body,/Next hour/);assert.match(legacy.body,/1:00 PM CST/);assert.match(legacy.body,/2:00 PM CST/);
 delete globalThis.localStorage;w.happyDOM.abort();
});
