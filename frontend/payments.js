import {marketKey,MARKET_TYPES,MARKET_TYPES_V2} from '../shared/market-schedule.js';
import {account} from './account.js';
import {PAYMENT_OPTIONS,paymentOption} from './payments-options.js';
export {PAYMENT_OPTIONS,paymentOption} from './payments-options.js';
export function createPayments({session=account,fetcher=(...args)=>fetch(...args),newId=()=>crypto.randomUUID(),clock=Date.now,requestTimeoutMs=12000}={}) {
 let state={musicData:null,musicDataError:false,marketCatalog:null,marketDetails:{},marketError:'',historyDeploymentId:null,claims:[],claimsReady:false,claimsError:'',catalog:null,pools:{},roundSnapshots:{},orders:[],entryGroups:[],entriesNextCursor:null,entriesPage:1,entriesSnapshot:null,entriesVerifiedThrough:null,entriesSummary:null,entriesLoading:false,entriesError:'',loading:false,busy:false,error:'',historyError:'',catalogError:''};
 let marketSelection=null,historySelection=null;
 let generation=0,identity='',operation=null,polling=false,selectedRoundId=null,disposed=false,entryCursor=null,previousCursors=[],pagePending=false;
 let lastMusic=0,lastMarket=0,lastOrders=0,lastEntries=0,lastClaims=0,serverOffset=0,lastClockBlock=null,pageGeneration=0;
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
 async function refreshMarkets(){return coalesce('markets',async()=>{try{
  const value=await request('/api/markets',{auth:false});
  if(![2,3].includes(value.marketModelVersion)||typeof value.ready!=='boolean'||!Array.isArray(value.markets))throw Error();
  if(value.snapshot?.syncStatus==='current'&&Number.isSafeInteger(value.serverTime)&&value.snapshot.asOfBlock!==lastClockBlock){serverOffset=value.serverTime-clock();lastClockBlock=value.snapshot.asOfBlock;}
  emit({marketCatalog:value,marketError:''});
  if(value.featuredSong?.source==='chartex'&&clock()-lastMusic>=60000){lastMusic=clock();void refreshMusic();}
  if(!historySelection&&value.deploymentId&&state.historyDeploymentId!==value.deploymentId)selectHistory(value.deploymentId);
 }catch{emit({marketError:'Scheduled market details are unavailable. Refresh to try again.'});}});}
 async function refreshMusic(){try{const value=await request('/api/music/tennessee-orange/history',{auth:false});if(value.song?.id!=='tennessee-orange'||!Array.isArray(value.days))throw Error();emit({musicData:value,musicDataError:false});}catch{emit({musicDataError:true,musicData:state.musicData?{...state.musicData,status:'stale'}:null});}}
 async function refreshMarket(){
  if(!marketSelection)return;const selected={...marketSelection},key=marketKey(selected.deploymentId,selected.roundId,selected.marketType);
  return coalesce('market:'+key,async()=>{try{
   const m=await request('/api/markets/'+selected.deploymentId+'/'+selected.roundId+'/'+selected.marketType,{auth:false});
   if(m.id!==key||m.marketType!==selected.marketType||!m.snapshot||typeof m.spotCount!=='string')throw Error();
   emit({marketDetails:{...state.marketDetails,[key]:m},marketError:''});
  }catch{const old=state.marketDetails[key];emit({marketError:'Selected market details cannot refresh.',...(old?{marketDetails:{...state.marketDetails,[key]:{...old,snapshot:stale(old.snapshot)}}}:{})});}});
 }
 function selectHistory(id,explicit=false){
  if(explicit)historySelection=id;
  if(state.historyDeploymentId===id)return;
  pageGeneration++;entryCursor=null;previousCursors=[];pagePending=false;
  emit({historyDeploymentId:id,entryGroups:[],entriesPage:1,entriesNextCursor:null,entriesVerifiedThrough:null,entriesSnapshot:null,entriesSummary:null,entriesLoading:false,entriesError:''});
  if(identity)void refreshEntries();
 }
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
  const epoch=generation,entryDeployment=state.historyDeploymentId;lastEntries=clock();
  if(pageChange){pagePending=true;pageGeneration++;}
  const pageEpoch=pageGeneration;
  return coalesce('entries:'+epoch+':'+(entryDeployment??'')+':'+(cursor??''),async()=>{emit({entriesLoading:true});try{
   const params=new URLSearchParams();if(cursor)params.set('cursor',cursor);if(entryDeployment)params.set('deploymentId',entryDeployment);
   const value=await request('/api/account/entries'+(params.size?'?'+params.toString():''));
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
 async function refreshClaims(){if(!identity)return;const epoch=generation;lastClaims=clock();return coalesce('claims:'+epoch,async()=>{try{
  const v=await request('/api/claims');if(!Array.isArray(v.claims))throw Error();if(epoch!==generation)return;
  const confirmed=v.claims.some(c=>c.status==='confirmed'&&state.claims.find(old=>old.id===c.id)?.status!=='confirmed');
  emit({claims:v.claims,claimsReady:true,claimsError:''});if(confirmed){void session.refreshBalance();void refreshEntries();void refreshPools();}
 }catch{if(epoch===generation)emit({claimsReady:false,claimsError:'Collection is temporarily unavailable. Your entries are unchanged.'});}});}
 async function prepareClaim(entryId,deploymentId=state.historyDeploymentId){return run(async()=>{
  if(!active())throw Error('Sign in and finish account setup first.');
  const epoch=generation,prior=state.claims.find(c=>c.entryId===entryId&&(!deploymentId||c.deploymentId===deploymentId||c.contract===state.marketCatalog?.deployments?.find(d=>d.id===deploymentId)?.contract)&&['awaiting_signature','prepared','submitted','uncertain'].includes(c.status)&&(c.status!=='awaiting_signature'||Date.parse(c.expiresAt)>clock()));
  const claim=prior??await request('/api/claims',{method:'POST',body:{entryId,...(deploymentId?{deploymentId}:{})},key:newId()});
  if(epoch!==generation)return null;emit({claims:[claim,...state.claims.filter(c=>c.id!==claim.id)]});return claim;
 });}
 async function confirmClaim(id){return run(async()=>{
  if(!active())throw Error('Sign in and finish account setup first.');const epoch=generation;
  let claim=await request('/api/claims/'+id);if(claim.status!=='awaiting_signature'){await refreshClaims();return claim;}
  const tx=claim.transaction,a=session.getState();
  if(!tx||tx.chainId!==5042002||tx.to.toLowerCase()!==(claim.contract??state.catalog?.contract)?.toLowerCase()||!knownContract(claim.contract??state.catalog?.contract)||tx.from.toLowerCase()!==a.address.toLowerCase()||BigInt(tx.value)!==0n||tx.data.toLowerCase()!==claimCallData(claim.entryId,a.address)||claim.quote?.recipient?.toLowerCase()!==a.address.toLowerCase())throw Error('The collection details changed. Please review this entry again.');
  let raw=signatures.get('claim:'+id);if(!raw){raw=await session.signTransaction(tx);if(epoch!==generation)return null;signatures.set('claim:'+id,raw);}
  try{claim=await request('/api/claims/'+id+'/signed',{method:'POST',body:{signedTransaction:raw}});signatures.delete('claim:'+id);}catch(e){await refreshClaims();throw e;}
  if(epoch===generation){emit({claims:[claim,...state.claims.filter(c=>c.id!==id)]});await refreshClaims();if(claim.status==='confirmed'&&epoch===generation)await Promise.all([session.refreshBalance(),refreshEntries(),refreshPools()]);}return claim;
 });}
 async function cancelClaim(id){return run(async()=>{const v=await request('/api/claims/'+id,{method:'DELETE'});signatures.delete('claim:'+id);await refreshClaims();return v;});}
 async function refresh(){if(polling)return;polling=true;lastMarket=clock();try{await Promise.all([refreshCatalog(),refreshMarkets()]);await Promise.all([refreshPools(),refreshMarket()]);await Promise.all([refreshOrders(),refreshEntries(),refreshClaims()]);}finally{polling=false;}}
 async function poll(){if(disposed)return;const now=clock(),pending=state.claims.some(c=>['awaiting_signature','prepared','submitted','uncertain'].includes(c.status))||state.orders.some(o=>['awaiting_signature','prepared','submitted','uncertain'].includes(o.status));const tasks=[];
  if(now-lastMarket>=5000){lastMarket=now;tasks.push(Promise.all([refreshCatalog().then(refreshPools),refreshMarkets().then(refreshMarket)]));}
  if(identity&&now-lastOrders>=(pending?2000:10000))tasks.push(refreshOrders());
  if(identity&&now-lastEntries>=10000)tasks.push(refreshEntries());
  if(identity&&now-lastClaims>=(pending?2000:10000))tasks.push(refreshClaims());
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
 async function prepare(body){return run(async()=>{assertSession();if(body.marketType)await assertMarket(body);const epoch=generation,key=newId();const order=await request('/api/purchases',{method:'POST',body,key});if(epoch!==generation)return null;emit({orders:[order,...state.orders.filter(o=>o.id!==order.id)]});return order;});}
 async function confirm(id){return run(async()=>{assertSession();const epoch=generation;let order=await request('/api/purchases/'+id);if(!['awaiting_signature'].includes(order.status)){await refreshOrders();return order;}
  if(order.request.marketType)await assertMarket(order.request);
  const option=paymentOption(order.request.optionId),tx=order.transaction,a=session.getState();
  if(!option||!tx||tx.chainId!==5042002||tx.to.toLowerCase()!==(order.request.marketType?state.marketCatalog?.contract:state.catalog?.contract)?.toLowerCase()||tx.from.toLowerCase()!==a.address.toLowerCase()||BigInt(tx.value)!==BigInt(option.costCents)*10n**16n)throw Error('The payment details changed. Please start again.');
  if(order.request.marketType&&tx.data.toLowerCase()!==purchaseCallData(order.request).toLowerCase())throw Error('The market payment changed. Please review it again.');
  let raw=signatures.get(id);if(!raw){raw=await session.signTransaction(tx);if(epoch!==generation)return null;signatures.set(id,raw);}
  try{order=await request('/api/purchases/'+id+'/signed',{method:'POST',body:{signedTransaction:raw}});signatures.delete(id);}
  catch(e){await refreshOrders();throw e;}
  if(epoch===generation){emit({orders:[order,...state.orders.filter(o=>o.id!==id)]});await refreshOrders();}return order;
 });}
 async function cancel(id){return run(async()=>{const v=await request('/api/purchases/'+id,{method:'DELETE'});signatures.delete(id);await refreshOrders();return v;});}
 function knownContract(contract){return contract?.toLowerCase()===state.catalog?.contract?.toLowerCase()||state.marketCatalog?.deployments?.some(d=>d.contract.toLowerCase()===contract?.toLowerCase());}
 async function assertMarket(body){
  const c=state.marketCatalog;if(!c?.ready||body.deploymentId!==c.deploymentId)throw Error('This market changed. Refresh and review the current period.');
  const m=await request('/api/markets/'+body.deploymentId+'/'+body.roundId+'/'+body.marketType,{auth:false});
  if(m.id!==marketKey(body.deploymentId,body.roundId,body.marketType)||m.snapshot?.syncStatus!=='current'||!m.open||clock()+serverOffset<m.entryStart||clock()+serverOffset>=m.entryEnd)throw Error('Bidding is closed for this period. Choose the current market.');
 }
 function changed(){const next=active();if(next!==identity){identity=next;generation++;pageGeneration++;operation=null;signatures.clear();entryCursor=null;previousCursors=[];pagePending=false;emit({claims:[],claimsReady:false,claimsError:'',orders:[],entryGroups:[],entriesNextCursor:null,entriesPage:1,entriesSnapshot:null,entriesVerifiedThrough:null,entriesSummary:null,entriesError:'',entriesLoading:false,busy:false,historyError:'',error:''});if(identity){void refreshOrders();void refreshEntries();void refreshClaims();}}else emit({});}
 const unsubscribe=session.subscribe(changed);identity=active();
 return {getState:()=>({...state}),subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},refresh,refreshMusic,refreshOrders,refreshEntries,refreshClaims,prepareClaim,confirmClaim,cancelClaim,prepare,confirm,cancel,currentRound,poll,refreshMarkets,selectHistory:id=>selectHistory(id,true),
  selectMarket(value){const a=value?marketKey(value.deploymentId,value.roundId,value.marketType):null,b=marketSelection?marketKey(marketSelection.deploymentId,marketSelection.roundId,marketSelection.marketType):null;if(a===b)return;marketSelection=value;void refreshMarket();},serverNow:()=>clock()+serverOffset,
  selectRound(id){if(id===selectedRoundId)return;selectedRoundId=id;void refreshPools();},
  nextEntries(){if(!state.entriesNextCursor||pagePending)return;return refreshEntries({cursor:state.entriesNextCursor,stack:[...previousCursors,entryCursor],pageChange:true});},
  previousEntries(){if(!previousCursors.length||pagePending)return;return refreshEntries({cursor:previousCursors.at(-1),stack:previousCursors.slice(0,-1),pageChange:true});},
  start(){void refresh();},dispose(){disposed=true;generation++;unsubscribe();listeners.clear();signatures.clear();for(const controller of controllers)controller.abort();controllers.clear();}};
}
export function claimCallData(entryId,wallet){
 if(!/^[1-9]\d{0,77}$/.test(entryId)||BigInt(entryId)>=2n**256n||!/^0x[0-9a-f]{40}$/i.test(wallet))throw Error('Invalid collection details.');
 return '0x8872b734'+BigInt(entryId).toString(16).padStart(64,'0')+wallet.slice(2).toLowerCase().padStart(64,'0');
}
export function purchaseCallData(body){
 const types=body.deploymentId==='markets-v2'?MARKET_TYPES_V2:MARKET_TYPES;const index=types.findIndex(t=>t.id===body.marketType);if(index<0||!/^\d{1,78}$/.test(body.roundId)||!/^\d{1,78}$/.test(body.guess)||!['single','four','bundle'].includes(body.optionId))throw Error('Invalid market payment.');
 return (body.optionId==='four'?'0x9c9964b0':'0x9ad6c260')+[body.roundId,String(index),body.guess].map(v=>BigInt(v).toString(16).padStart(64,'0')).join('');
}
export const payments=createPayments();
