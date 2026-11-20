import {account} from './account.js';
import {PAYMENT_OPTIONS,paymentOption} from './payments-options.js';
export {PAYMENT_OPTIONS,paymentOption} from './payments-options.js';
export function createPayments({session=account,fetcher=(...args)=>fetch(...args),newId=()=>crypto.randomUUID()}={}) {
 let state={catalog:null,pools:{},orders:[],loading:false,busy:false,error:'',historyError:'',catalogError:''};
 let generation=0,identity='',operation=null,polling=false;const listeners=new Set(),signatures=new Map();
 const emit=patch=>{state={...state,...patch};for(const f of listeners)f({...state});};
 const active=()=>{const a=session.getState();return a.authenticated&&a.address?a.userId+':'+a.address.toLowerCase():'';};
 async function request(path,{method='GET',body,key,auth=true}={}) {
  const epoch=generation;let token;if(auth){token=await session.getAccessToken();if(!token||epoch!==generation)throw Error('Please sign in again.');}
  const r=await fetcher(path,{method,headers:{...(auth?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{} )});
  const value=await r.json();if(epoch!==generation)throw Error('Your account changed. Please try again.');
  if(!r.ok)throw Error(value.message||'This purchase is unavailable. Please try again.');return value;
 }
 async function refreshCatalog(){try{const value=await request('/api/contests',{auth:false});if(typeof value.ready!=='boolean'||!Array.isArray(value.rounds))throw Error();emit({catalog:value,catalogError:''});}catch{emit({catalogError:'Test contest details are unavailable. Please refresh to try again.'});}}
 async function refreshOrders(){if(!identity)return;const epoch=generation;try{const v=await request('/api/purchases');if(epoch===generation&&Array.isArray(v.orders)){const changed=v.orders.some(o=>o.status==='confirmed'&&state.orders.find(x=>x.id===o.id)?.status!=='confirmed');emit({orders:v.orders,historyError:''});if(changed){void session.refreshBalance();void refreshPools();}}}catch(e){if(epoch===generation)emit({historyError:e.message});}}
 async function refreshPools(){if(!state.catalog?.ready)return;const epoch=generation;try{const next={};for(const r of state.catalog.rounds)for(const h of ['24h','48h','week']){const p=await request(`/api/contests/${r.id}/pools/${h}`,{auth:false});next[r.id+':'+h]=p;}if(epoch===generation)emit({pools:next});}catch{if(epoch===generation)emit({catalogError:'Some contest details could not be refreshed.'});}}
 async function refresh(){if(polling)return;polling=true;try{await refreshCatalog();await refreshPools();await refreshOrders();}finally{polling=false;}}
 function currentRound(requestedStart,now=Date.now()) {
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
 function changed(){const next=active();if(next!==identity){identity=next;generation++;operation=null;signatures.clear();emit({orders:[],busy:false,historyError:'',error:''});if(identity)void refreshOrders();}else emit({});}
 const unsubscribe=session.subscribe(changed);identity=active();
 return {getState:()=>({...state}),subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},refresh,refreshOrders,prepare,confirm,cancel,currentRound,
  start(){void refresh();},dispose(){generation++;unsubscribe();listeners.clear();signatures.clear();}};
}
export const payments=createPayments();
