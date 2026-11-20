import { AppError } from './errors.js';

export function createPurchaseStore(client, contract, {kind='purchase',step6=false}={}) {
  const fail = error => {
    const code=['MARKET_CHANGED','ORDER_PENDING','ORDER_CONFLICT','ORDER_NOT_FOUND','ORDER_EXPIRED','LEASE_LOST'].find(c=>error?.message?.includes(c));
    throw new AppError(code??'PAYMENTS_UNAVAILABLE',code==='ORDER_NOT_FOUND'?404:code?409:503);
  };
  async function rpc(name,args) {let r;try{r=await client.rpc('music_purchase_'+name,args);}catch(e){fail(e);}if(r.error)fail(r.error);return r.data;}
  async function select(query) {let r;try{r=await query;}catch(e){fail(e);}if(r.error)fail(r.error);return Array.isArray(r.data)?r.data.filter(o=>(o.action_kind??'purchase')===kind):r.data&&(r.data.action_kind??'purchase')!==kind?null:r.data;}
  const typed=query=>{const q=step6?query.eq('action_kind',kind):query;return kind==='claim_entry'?q.eq('contract_address',contract):q;};
  return {
    list:identity=>select(typed(client.from('music_purchase_orders').select('*')).eq('privy_user_id',identity.userId).eq('wallet_address',identity.wallet).order('created_at',{ascending:false}).limit(100)),
    byKey:(key,identity)=>select(typed(client.from('music_purchase_orders').select('*')).eq('privy_user_id',identity.userId).eq('wallet_address',identity.wallet).eq('idempotency_key',key).maybeSingle()),
    get:(id,identity)=>select(typed(client.from('music_purchase_orders').select('*')).eq('id',id).eq('privy_user_id',identity.userId).eq('wallet_address',identity.wallet).eq('contract_address',contract).maybeSingle()),
    create:(identity,key,request,tx,expires,round)=>kind==='claim_entry'?select(client.rpc('music_wallet_action_create',{p_user:identity.userId,p_wallet:identity.wallet,p_contract:contract,p_key:key,p_request:request,p_tx:tx,p_expires:expires,p_round:round,p_kind:kind})):rpc('create',{p_user:identity.userId,p_wallet:identity.wallet,p_contract:contract,p_key:key,p_request:request,p_tx:tx,p_expires:expires,p_round:round}),
    action:(id,identity,action,raw=null,hash=null)=>rpc('action',{p_id:id,p_user:identity.userId,p_wallet:identity.wallet,p_contract:contract,p_action:action,p_raw:raw,p_hash:hash}),
    claim:worker=>rpc('claim',{p_worker:worker,p_contract:contract}),
    update:(order,worker,change)=>rpc('update',{p_id:order.id,p_worker:worker,p_fence:order.lease_version,p_change:change}),
  };
}
