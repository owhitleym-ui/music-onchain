import {AppError} from './errors.js';
// Resolve saved actions by authenticated owner AND pinned contract, never by entry/round number alone.
export function createDeploymentRouter({client,services,activeId}){
 const active=services.get(activeId);
 const choose=id=>{const s=services.get(id);if(!s)throw new AppError('ROUND_UNAVAILABLE',404);return s;};
 async function ownerService(id,identity){
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new AppError('BAD_REQUEST',400);
  const r=await client.from('music_purchase_orders').select('contract_address').eq('id',id).eq('privy_user_id',identity.userId).eq('wallet_address',identity.wallet).maybeSingle();
  if(r.error)throw new AppError('PAYMENTS_UNAVAILABLE');
  const s=[...services.values()].find(s=>s.config.contract===r.data?.contract_address);if(!s)throw new AppError('ORDER_NOT_FOUND',404);return s;
 }
 const saved=(kind,method)=>async(id,identity,...rest)=>(await ownerService(id,identity))[kind][method](id,identity,...rest);
 return {
  purchases:{...active.purchases,get:saved('purchases','get'),signed:saved('purchases','signed'),cancel:saved('purchases','cancel')},
  claims:{
   async list(identity){const all=await Promise.all([...services].map(async([id,s])=>{const v=await s.claims.list(identity);return v.claims.map(c=>({...c,deploymentId:id}));}));return {claims:all.flat().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))};},
   async create(identity,body,key){
    const id=body?.deploymentId??(activeId==='atomic-v1'?'atomic-v1':null);if(!id)throw new AppError('MARKET_CHANGED',409);
    if(Object.keys(body).some(k=>!['deploymentId','entryId'].includes(k)))throw new AppError('BAD_REQUEST',400);
    return {...await choose(id).claims.create(identity,{entryId:body.entryId},key),deploymentId:id};
   },get:saved('claims','get'),signed:saved('claims','signed'),cancel:saved('claims','cancel'),
  },
  entries:(identity,cursor,id=activeId)=>choose(id).live.entries(identity,cursor),
 };
}
