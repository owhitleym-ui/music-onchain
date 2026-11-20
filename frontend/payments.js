import {account} from './account.js';
import {PAYMENT_OPTIONS,paymentOption} from './payments-options.js';
export {PAYMENT_OPTIONS,paymentOption} from './payments-options.js';
export function createPayments({session=account,fetcher=(...args)=>fetch(...args),newId=()=>crypto.randomUUID(),clock=Date.now,requestTimeoutMs=12000}={}) {
 let state={catalog:null,pools:{},roundSnapshots:{},orders:[],entryGroups:[],entriesNextCursor:null,entriesPage:1,entriesSnapshot:null,entriesVerifiedThrough:null,entriesSummary:null,entriesLoading:false,entriesError:'',loading:false,busy:false,error:'',historyError:'',catalogError:''};
 let generation=0,identity='',operation=null,polling=false,selectedRoundId=null,disposed=false,entryCursor=null,previousCursors=[],pagePending=false;
 let lastMarket=0,lastOrders=0,lastEntries=0,serverOffset=0,lastClockBlock=null,pageGeneration=0;
 const listeners=new Set(),signatures=new Map(),requests=new Map(),controllers=new Set();
 const emit=patch=>{if(disposed)return;state={...state,...patch};for(const f of listeners)f({...state});};
 const active=()=>{const a=session.getState();return a.authenticated&&a.address?a.userId+':'+a.address.toLowerCase():'';};
 async function request(path,{method='GET',body,key,auth=true}={}) {
  const epoch=generation;let token;if(auth){token=await session.getAccessToken();if(!token||epoch!==generation)throw Error('Please sign in again.');}
  const controller=new AbortController();controllers.add(controller);let timer;
  try {
   const {response,value}=await Promise.race([
    Promise.resolve(fetcher(path,{method,signal:controller.signal,headers:{...(auth?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{} )})).then(async response=>({response,value:await response.json()})),
    new Promise((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('The request is taking longer than expected. Please try again.'));},requestTimeoutMs);timer.unref?.();}),
   ]);
   if(disposed||(auth&&epoch!==generation))throw Error('Your account changed. Please try again.');
   if(!response.ok)throw Error(value.message||'This purchase is unavailable. Please try again.');return value;
  } finally {clearTimeout(timer);controllers.delete(controller);}
 }
 function coalesce(key,fn){if(requests.has(key))return requests.get(key);const pending=Promise.resolve().then(fn).finally(()=>{if(requests.get(key)===pending)requests.delete(key);});requests.set(key,pending);return pending;}
 const stale=snapshot=>snapshot?{...snapshot,syncStatus:'unavailable',chainAvailable:false}:null;
 async function refreshCatalog(){return coalesce('catalog',async()=>{try{
  const value=await request('/api/contests',{auth:false});if(typeof value.ready!=='boolean'||!Array.isArray(value.rounds))throw Error();
  const changed=state.catalog?.contract&&value.contract&&state.catalog.contract!==value.contract;
  if(value.snapshot?.syncStatus==='current'&&value.snapshot.asOfBlock!==lastClockBlock&&Number.isSafeInteger(value.serverTime)){serverOffset=value.serverTime-clock();lastClockBlock=value.snapshot.asOfBlock;}
  emit({catalog:value,catalogError:'',...(changed?{pools:{},roundSnapshots:{}}:{})});
 }catch{emit({catalog:state.catalog?{...state.catalog,snapshot:stale(state.catalog.snapshot)}:null,catalogError:'Live contest details are unavailable. Last verified values are shown.'});}});}
 async function refreshPools(){
  if(!state.catalog?.ready)return;
  const round=state.catalog.rounds.find(r=>r.id===selectedRoundId)||currentRound();if(!round)return;
  const id=round.id,contract=state.catalog.contract;
  return coalesce('round:'+id,async()=>{try{
   const value=await request('/api/contests/'+id,{auth:false});
   if(value.round?.id!==id||!value.pools||!['24h','48h','week'].every(h=>value.pools[h]&&typeof value.pools[h].spotCount==='string'))throw Error();
   if(state.catalog?.contract!==contract||id!==(selectedRoundId??currentRound()?.id))return;
   const next={...state.pools};for(const h of ['24h','48h','week'])next[id+':'+h]=value.pools[h];
   emit({pools:next,roundSnapshots:{...state.roundSnapshots,[id]:value.snapshot},catalogError:''});
  }catch{
   if(state.catalog?.contract===contract)emit({roundSnapshots:{...state.roundSnapshots,[id]:stale(state.roundSnapshots[id])},catalogError:'Live contest details are unavailable. Last verified values are shown.'});
  }});
 }
 async function refreshOrders(){if(!identity)return;const epoch=generation;lastOrders=clock();return coalesce('orders:'+epoch,async()=>{try{
  const v=await request('/api/purchases');if(epoch===generation&&Array.isArray(v.orders)){const changed=v.orders.some(o=>o.status==='confirmed'&&state.orders.find(x=>x.id===o.id)?.status!=='confirmed');emit({orders:v.orders,historyError:''});if(changed){void session.refreshBalance();void refreshPools();void refreshEntries();}}
 }catch(e){if(epoch===generation)emit({historyError:e.message});}});}
 async function refreshEntries({cursor=entryCursor,stack=previousCursors,pageChange=false}={}) {
  if(!identity||(!pageChange&&pagePending))return;
  const epoch=generation;lastEntries=clock();
  if(pageChange){pagePending=true;pageGeneration++;}
  const pageEpoch=pageGeneration;
  return coalesce('entries:'+epoch+':'+(cursor??''),async()=>{emit({entriesLoading:true});try{
   const value=await request('/api/account/entries'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
   if(!Array.isArray(value.groups))throw Error('Entry details are unavailable. Please try again.');
   if(epoch!==generation||pageEpoch!==pageGeneration)return;
   if(!pageChange&&cursor!==entryCursor)return;
   entryCursor=cursor;previousCursors=[...stack];
   const incomingBlock=value.indexComplete?(value.historyAsOfBlock??value.snapshot?.asOfBlock):null;
   const verifiedBlock=incomingBlock&&(!state.entriesVerifiedThrough||BigInt(incomingBlock)>BigInt(state.entriesVerifiedThrough))?incomingBlock:state.entriesVerifiedThrough;
   emit({entryGroups:value.groups,entriesNextCursor:value.nextCursor??null,entriesPage:previousCursors.length+1,entriesSnapshot:value.snapshot,entriesVerifiedThrough:verifiedBlock,entriesSummary:value.summary,entriesError:''});
  }catch(e){if(epoch===generation&&pageEpoch===pageGeneration)emit({entriesError:e.message,entriesSnapshot:stale(state.entriesSnapshot)});}
  finally{if(epoch===generation&&pageEpoch===pageGeneration){pagePending=false;emit({entriesLoading:false});}}});
 }
 async function refresh(){if(polling)return;polling=true;lastMarket=clock();try{await refreshCatalog();await refreshPools();await Promise.all([refreshOrders(),refreshEntries()]);}finally{polling=false;}}
 async function poll(){if(disposed)return;const now=clock(),pending=state.orders.some(o=>['awaiting_signature','prepared','submitted','uncertain'].includes(o.status));const tasks=[];
  if(now-lastMarket>=5000){lastMarket=now;tasks.push(refreshCatalog().then(refreshPools));}
  if(identity&&now-lastOrders>=(pending?2000:10000))tasks.push(refreshOrders());
  if(identity&&now-lastEntries>=10000)tasks.push(refreshEntries());
  await Promise.all(tasks);
 }
 function currentRound(requestedStart,now=clock()+serverOffset) {
  const rounds=state.catalog?.rounds??[];
  const exact=rounds.find(r=>r.start===requestedStart);if(exact)return exact;
  return rounds.find(r=>r.start<=now&&now<r.deadline)||rounds.find(r=>r.start>now)||rounds.at(-1)||null;
 }
 function run(fn){
  if(operation)return operation;
  const epoch=generation;emit({busy:true,error:''});
  const pending=Promise.resolve().then(()=>epoch===generation?fn():null).catch(e=>{
    if(epoch!==generation)return null;
    emit({error:e.message||'The purchase could not finish. Check My Purchases before trying again.'});throw e;
  }).finally(()=>{if(operation===pending){operation=null;emit({busy:false});}});
  operation=pending;return pending;
 }
 function assertSession(){const a=session.getState();if(!active())throw Error('Sign in and finish account setup first.');if(a.approvalStatus!=='approved')throw Error('Finish activating your account before purchasing.');}
 async function prepare(body){return run(async()=>{assertSession();const epoch=generation,key=newId();const order=await request('/api/purchases',{method:'POST',body,key});if(epoch!==generation)return null;emit({orders:[order,...state.orders.filter(o=>o.id!==order.id)]});return order;});}
 async function confirm(id){return run(async()=>{assertSession();const epoch=generation;let order=await request('/api/purchases/'+id);if(!['awaiting_signature'].includes(order.status)){await refreshOrders();return order;}
  const option=paymentOption(order.request.optionId),tx=order.transaction,a=session.getState();
  if(!option||!tx||tx.chainId!==5042002||tx.to.toLowerCase()!==state.catalog?.contract?.toLowerCase()||tx.from.toLowerCase()!==a.address.toLowerCase()||BigInt(tx.value)!==BigInt(option.costCents)*10n**16n)throw Error('The payment details changed. Please start again.');
  let raw=signatures.get(id);if(!raw){raw=await session.signTransaction(tx);if(epoch!==generation)return null;signatures.set(id,raw);}
  try{order=await request('/api/purchases/'+id+'/signed',{method:'POST',body:{signedTransaction:raw}});signatures.delete(id);}
  catch(e){await refreshOrders();throw e;}
  if(epoch===generation){emit({orders:[order,...state.orders.filter(o=>o.id!==id)]});await refreshOrders();}return order;
 });}
 async function cancel(id){return run(async()=>{const v=await request('/api/purchases/'+id,{method:'DELETE'});signatures.delete(id);await refreshOrders();return v;});}
 function changed(){const next=active();if(next!==identity){identity=next;generation++;pageGeneration++;operation=null;signatures.clear();entryCursor=null;previousCursors=[];pagePending=false;emit({orders:[],entryGroups:[],entriesNextCursor:null,entriesPage:1,entriesSnapshot:null,entriesVerifiedThrough:null,entriesSummary:null,entriesError:'',entriesLoading:false,busy:false,historyError:'',error:''});if(identity){void refreshOrders();void refreshEntries();}}else emit({});}
 const unsubscribe=session.subscribe(changed);identity=active();
 return {getState:()=>({...state}),subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},refresh,refreshOrders,refreshEntries,prepare,confirm,cancel,currentRound,poll,serverNow:()=>clock()+serverOffset,
  selectRound(id){if(id===selectedRoundId)return;selectedRoundId=id;void refreshPools();},
  nextEntries(){if(!state.entriesNextCursor||pagePending)return;return refreshEntries({cursor:state.entriesNextCursor,stack:[...previousCursors,entryCursor],pageChange:true});},
  previousEntries(){if(!previousCursors.length||pagePending)return;return refreshEntries({cursor:previousCursors.at(-1),stack:previousCursors.slice(0,-1),pageChange:true});},
  start(){void refresh();},dispose(){disposed=true;generation++;unsubscribe();listeners.clear();signatures.clear();for(const controller of controllers)controller.abort();controllers.clear();}};
}
export const payments=createPayments();
