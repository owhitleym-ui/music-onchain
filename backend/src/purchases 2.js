import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {OPTIONS, HORIZONS} from './contest-chain.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function publicOrder(o) {
  return {id:o.id,request:o.request,round:o.round,status:o.state,createdAt:o.created_at,expiresAt:o.expires_at,entryIds:o.entry_ids,networkFee:o.network_fee,errorCode:o.error_code,
    transactionHash:o.transaction_hash,contract:o.contract_address,...(o.state==='awaiting_signature'?{transaction:o.transaction}:{} )};
}
export function normalizePurchase(body) {
  if(!body||typeof body.guess!=='string'||typeof body.roundId!=='string'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='guess,horizon,optionId,roundId'||!/^\d{1,78}$/.test(body.guess)||!/^\d{1,78}$/.test(body.roundId)||!HORIZONS.includes(body.horizon)||!Object.hasOwn(OPTIONS,body.optionId)||BigInt(body.guess)>(1n<<256n)-1n||BigInt(body.roundId)===0n||BigInt(body.roundId)>(1n<<256n)-1n)throw new AppError('BAD_REQUEST',400);
  return {roundId:BigInt(body.roundId).toString(),horizon:body.horizon,guess:BigInt(body.guess).toString(),optionId:body.optionId};
}
export function createPurchaseService({store,chain,config}) {
  async function get(id,identity){if(!uuid.test(id))throw new AppError('BAD_REQUEST',400);const o=await store.get(id,identity);if(!o)throw new AppError('ORDER_NOT_FOUND',404);return o;}
  return {
    async catalog(){if(!config.atomic)return {ready:false,message:'Test purchases are waiting for the new payment setup.',rounds:[]};await chain.verify();return {ready:true,chainId:config.chainId,contract:config.contract,rounds:await chain.rounds()};},
    pool:(id,horizon)=>chain.pool(id,horizon),
    async list(identity){if(!config.atomic)return {orders:[]};return {orders:(await store.list(identity)).map(publicOrder)};},
    async get(id,identity){return publicOrder(await get(id,identity));},
    async create(identity,body,key){if(!config.atomic)throw new AppError('PAYMENTS_NOT_READY',409);if(!uuid.test(key??''))throw new AppError('BAD_REQUEST',400);const request=normalizePurchase(body);
      // Resolve exact retries before balance/nonce checks, including after confirmation.
      const prior=await store.byKey(key,identity);
      if(prior){if(prior.contract_address!==config.contract||JSON.stringify(normalizePurchase(prior.request))!==JSON.stringify(request))throw new AppError('ORDER_CONFLICT',409);return publicOrder(prior);}
      const q=await chain.preflight(identity,request);
      return publicOrder(await store.create(identity,key,request,q.transaction,q.expiresAt,q.round));
    },
    async signed(id,identity,raw){if(typeof raw!=='string'||!/^0x[0-9a-f]+$/i.test(raw)||raw.length>20000)throw new AppError('BAD_SIGNATURE',400);
      const order=await get(id,identity),hash=await chain.validate(order,raw);
      if(!order.raw_transaction)await chain.preflight(identity,order.request);
      return publicOrder(await store.action(id,identity,'signed',raw.toLowerCase(),hash));
    },
    async cancel(id,identity){await get(id,identity);return publicOrder(await store.action(id,identity,'cancel'));},
  };
}
export function createPaymentWorker({store,chain,intervalMs=2000,now=Date.now}) {
  const id=randomUUID();let running=false,timer;
  async function tick(){if(running)return;running=true;let order;try {
    order=await store.claim(id);if(!order)return;
    await chain.verify();const hash=await chain.validate(order,order.raw_transaction);
    if(hash!==order.transaction_hash)throw new AppError('PAYMENT_MISMATCH');
    const receipt=await chain.receipt(hash);
    if(receipt){const network_fee=(receipt.gasUsed*receipt.effectiveGasPrice).toString();
      if(receipt.status!=='success'){await store.update(order,id,{state:'failed',error_code:'PAYMENT_REVERTED',receipt_block:Number(receipt.blockNumber),network_fee});return;}
      const entry_ids=await chain.verifyReceipt(order,receipt);
      await store.update(order,id,{state:'confirmed',entry_ids,receipt_block:Number(receipt.blockNumber),network_fee});return;
    }
    if(await chain.latestNonce(order.wallet_address)>Number(order.nonce))throw new AppError('PAYMENT_MISMATCH');
    if(order.broadcast_at&&now()-Date.parse(order.broadcast_at)<15000){await store.update(order,id,{state:order.state});return;}
    if(!await chain.canBroadcast(order)){
      // An expired signature is still valid on-chain. Never release its nonce automatically.
      await store.update(order,id,{state:'uncertain',error_code:'PAYMENT_UNCERTAIN'});return;
    }
    let returned;try{returned=await chain.broadcast(order.raw_transaction);}catch(e){if(!await chain.known(hash))throw e;returned=hash;}
    if(returned.toLowerCase()!==hash)throw new AppError('PAYMENT_MISMATCH');
    await store.update(order,id,{state:'submitted'});
  }catch(e){if(order)try{await store.update(order,id,{state:'uncertain',error_code:e instanceof AppError?e.code:'PAYMENT_UNCERTAIN'});}catch{}}finally{running=false;}}
  return {tick,start(){timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();void tick();},stop(){clearInterval(timer);}};
}
