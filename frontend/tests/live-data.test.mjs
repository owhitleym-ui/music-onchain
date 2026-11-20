import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayments} from '../payments.js';
import {accountRows,accountPurchaseMarkup,entryModal,nativeDollars} from '../payment-ui.js';
import {liveCount,liveAverage,freshness} from '../live-format.js';
import {renderChart} from '../chart.js';

const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40);
const pause=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const snapshot={syncStatus:'current',asOfBlock:'100',verifiedAt:'2026-11-20T01:00:00Z',chainAvailable:true};
function fixture(){
 let state={authenticated:true,userId:'did:privy:a',address:A,approvalStatus:'approved'},listener;
 let now=Date.now(),failRound=false,groups=[],nextCursor=null,holdEntries=null,holdRound=null,orders=[],historyBlock='100';
 const calls=[];
 const start=Math.floor(now/3600000)*3600000;
 const rounds=[{id:'1',start,deadline:start+3600000,artist:'artist'},{id:'2',start:start+3600000,deadline:start+7200000,artist:'artist'}];
 const pools=id=>Object.fromEntries(['24h','48h','week'].map(h=>[h,{roundId:id,horizon:h,open:true,spotCount:'4',peopleCount:'1',entryCount:'4',totalDeposits:'20000000000000000000',averageGuess:'123.00',mode:'123',modeSpots:'4',windowStart:start,windowEnd:start+86400000}]));
 const session={getState:()=>state,subscribe:f=>{listener=f;return()=>{};},getAccessToken:async()=>state.authenticated?'token-'+state.userId:null,refreshBalance:async()=>{}};
 const fetcher=async(path,options={})=>{
  calls.push({path,options});let value;
  if(path==='/api/contests')value={ready:true,chainId:5042002,contract:C,rounds,snapshot};
  else if(/^\/api\/contests\/\d+$/.test(path)){
   const id=path.split('/').at(-1);if(holdRound)await holdRound.promise;
   if(failRound)throw Error('offline');value={round:rounds.find(r=>r.id===id),pools:pools(id),snapshot};
  }else if(path==='/api/purchases')value={orders};
  else if(path.startsWith('/api/account/entries')){
   if(holdEntries)await holdEntries.promise;
   value={groups,nextCursor,indexComplete:true,historyAsOfBlock:historyBlock,snapshot,summary:{scope:'shown'}};
  }else throw Error('Unexpected URL '+path);
  return {ok:true,json:async()=>value};
 };
 const payments=createPayments({session,fetcher,clock:()=>now,requestTimeoutMs:100});
 return {payments,calls,start,rounds,change(next){state=next;listener();},advance(ms){now+=ms;},fail(value){failRound=value;},groups(value,cursor=null){groups=value;nextCursor=cursor;},historyBlock(value){historyBlock=value;},hold(value){holdEntries=value;},holdRound(value){holdRound=value;},orders(value){orders=value;}};
}

test('one selected-round response updates all horizons; duplicate refreshes are coalesced',async()=>{
 const f=fixture();await Promise.all([f.payments.refresh(),f.payments.refresh()]);
 assert.equal(f.calls.filter(c=>c.path==='/api/contests/1').length,1);
 assert.ok(!f.calls.some(c=>c.path.includes('/pools/')));
 assert.equal(f.payments.getState().pools['1:24h'].spotCount,'4');
 f.fail(true);await f.payments.refresh();
 assert.equal(f.payments.getState().pools['1:24h'].totalDeposits,'20000000000000000000');
 assert.equal(f.payments.getState().roundSnapshots['1'].syncStatus,'unavailable');
 f.fail(false);await f.payments.refresh();assert.equal(f.payments.getState().roundSnapshots['1'].syncStatus,'current');f.payments.dispose();
});

test('old round responses cannot replace a later round selection',async()=>{
 const f=fixture();await f.payments.refresh();const wait=deferred();f.holdRound(wait);
 f.payments.selectRound('1');await pause();f.payments.selectRound('2');wait.resolve();await pause();await pause();
 assert.equal(f.payments.getState().pools['2:24h'].roundId,'2');f.payments.dispose();
});

test('public totals poll at five seconds, account history at ten and pending orders at two',async()=>{
 const f=fixture();await f.payments.refresh();f.calls.length=0;
 f.advance(4999);await f.payments.poll();assert.equal(f.calls.length,0);
 f.advance(1);await f.payments.poll();assert.ok(f.calls.some(c=>c.path==='/api/contests'));assert.ok(!f.calls.some(c=>c.path==='/api/account/entries'));
 f.orders([{id:'pending',status:'submitted'}]);await f.payments.refreshOrders();f.calls.length=0;f.advance(1999);await f.payments.poll();assert.ok(!f.calls.some(c=>c.path==='/api/purchases'));
 f.advance(1);await f.payments.poll();assert.ok(f.calls.some(c=>c.path==='/api/purchases'));
 f.advance(3000);await f.payments.poll();assert.ok(f.calls.some(c=>c.path==='/api/account/entries'));f.payments.dispose();
});

test('logout or account switching during history requests clears and discards private responses',async()=>{
 for(const next of [{authenticated:false},{authenticated:true,userId:'did:privy:b',address:B,approvalStatus:'approved'}]){
  const f=fixture();await f.payments.refresh();const wait=deferred();f.hold(wait);f.groups([{id:'private-old-account'}]);
  const pending=f.payments.refreshEntries();await pause();f.change(next);f.hold(null);f.groups([]);wait.resolve();await pending;await pause();
  assert.deepEqual(f.payments.getState().entryGroups,[]);f.payments.dispose();
 }
});

test('entry pagination replaces pages and keeps the previous cursor for returning',async()=>{
 const f=fixture();f.groups([{id:'first'}],'next-page');await f.payments.refresh();
 f.groups([{id:'second'}]);f.historyBlock('99');await f.payments.nextEntries();assert.equal(f.payments.getState().entriesPage,2);assert.equal(f.payments.getState().entryGroups[0].id,'second');assert.equal(f.payments.getState().entriesVerifiedThrough,'100');
 f.groups([{id:'first'}],'next-page');await f.payments.previousEntries();assert.equal(f.payments.getState().entriesPage,1);assert.equal(f.payments.getState().entryGroups[0].id,'first');f.payments.dispose();
});

test('request deadlines cover a response body that never finishes',async()=>{
 let listener;
 const session={getState:()=>({authenticated:false}),subscribe:f=>{listener=f;return()=>{};}};
 const p=createPayments({session,requestTimeoutMs:5,fetcher:async()=>({ok:true,json:()=>new Promise(()=>{})})});
 const keepAlive=setTimeout(()=>{},30);await p.refresh();clearTimeout(keepAlive);
 assert.match(p.getState().catalogError,/unavailable/);p.dispose();assert.ok(listener);
});

function group(){return {id:'group',transactionHash:'hash',contract:C,purchasedAt:Date.now(),contestStatus:'claimable',totalPaid:'20000000000000000000',spotCount:'4',receivedAmount:'0',claimableAmount:'37640000000000000000',realizedNet:'0',entries:Array.from({length:4},(_,i)=>({entryId:String(i+1),roundId:'1',horizon:'24h',songId:'last-bus-home',artistKey:'maya-lane',guess:'123',paid:'5000000000000000000',spots:'1',multiplierBps:10000,windowStart:Date.now(),windowEnd:Date.now()+86400000,status:'claimable',outcome:{mainRank:'1',returned:'9410000000000000000',artistFee:'90000000000000000',appFee:'0'}}))};}
test('$20 entries and matching order render once, with four individual records and independent result state',()=>{
 const g=group(),order={id:'order',contract:C,transactionHash:'hash',status:'confirmed',createdAt:new Date().toISOString(),receiptBlock:'99',request:{roundId:'1',optionId:'four',horizon:'24h',guess:'123'}};
 const state={orders:[order],entryGroups:[g],catalog:{contract:C},entriesVerifiedThrough:'100',entriesSnapshot:snapshot};
 assert.equal(accountRows(state).length,1);
 const markup=accountPurchaseMarkup({authenticated:true},state);assert.equal((markup.match(/data-action="entry-detail"/g)||[]).length,1);assert.match(markup,/Ready to claim/);assert.doesNotMatch(markup,/Return received/);
 const modal=entryModal(g,{orders:[order],snapshot});assert.equal((modal.body.match(/class="entry-record"/g)||[]).length,4);assert.match(modal.body,/Four separate \$5 entries/);assert.match(modal.body,/1.00 · no bonus/);assert.match(modal.body,/Available returns have not been received/);
 assert.doesNotMatch(markup+modal.body,/0x[a-f0-9]{40}|USDC|MetaMask/i);
 const outsidePage={...state,entryGroups:[]};assert.equal(accountRows(outsidePage).length,0);
 const indexing={...outsidePage,entriesVerifiedThrough:'98'};assert.equal(accountRows(indexing).length,1);
});

test('money and guesses retain precision and return labels never treat unclaimed funds as received',()=>{
 assert.equal(nativeDollars(-1n),'−$0.000000000000000001');assert.equal(nativeDollars(1n,{up:true}),'$0.000001');
 const huge=(2n**200n).toString();assert.equal(liveCount(huge),BigInt(huge).toLocaleString('en-US'));assert.ok(liveAverage(huge+'.50').endsWith('.5'));
 const g=group();g.contestStatus='partially_claimed';g.receivedAmount='9410000000000000000';g.claimableAmount='28230000000000000000';g.realizedNet='4410000000000000000';
 assert.match(accountPurchaseMarkup({authenticated:true},{orders:[],entryGroups:[g],entriesSnapshot:snapshot}),/Partly received/);
 assert.match(freshness({...snapshot,syncStatus:'catching_up'}),/Updating/);
});

test('unverified private history shows unavailable amounts instead of invented zero returns',()=>{
 const markup=accountPurchaseMarkup({authenticated:true},{orders:[],entryGroups:[],entriesError:'Please try again.'});
 assert.match(markup,/Received —/);assert.match(markup,/Your entry history is unavailable/);assert.doesNotMatch(markup,/Received \$0|No account purchases yet/);
});

test('chart handles exact large averages, contains finite coordinates, and labels simulated history',()=>{
 const start=Date.now(),horizons=[{id:'24h',label:'24h',endHours:24}],value=(2n**200n).toString()+'.50';
 const svg=renderChart({history:[{time:start-86400000,views:100},{time:start,views:200}],roundStart:start,horizons,selectedHorizon:'24h',summaries:{'24h':{spotCount:'4',averageGuess:value,average:null}},live:true});
 assert.doesNotMatch(svg,/NaN|Infinity/);assert.match(svg,/simulated historical views/);assert.match(svg,/actual average guesses/);assert.match(svg,new RegExp(BigInt(value.split('.')[0]).toLocaleString('en-US').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 const grids=[...svg.matchAll(/y1="([^"]+)" y2="([^"]+)" class="chart-grid"/g)];assert.ok(grids.every(m=>Number(m[1])>=35&&Number(m[1])<=300));
});
