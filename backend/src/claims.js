import {createPublicClient,http,encodeFunctionData,decodeEventLog} from 'viem';
import {CONTEST_ABI,HORIZONS} from './contest-chain.js';
import {sameAddress} from './config.js';
import {AppError} from './errors.js';
import {createRpcReadGuard} from './rpc-reads.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entryId=id=>typeof id==='string'&&/^[1-9]\d{0,77}$/.test(id)&&BigInt(id)<2n**256n;
export const publicClaim=o=>({id:o.id,entryId:o.request.entryId,status:o.state,contract:o.contract_address,createdAt:o.created_at,expiresAt:o.expires_at,quote:o.round,result:o.result??null,networkFee:o.network_fee??null,transactionHash:o.transaction_hash,errorCode:o.error_code,...(o.state==='awaiting_signature'?{transaction:o.transaction}:{})});

export function createClaimChain({config,chain,client=createPublicClient({transport:http(config.rpc,{retryCount:0,timeout:10000}),cacheTime:0})}) {
 const guard=createRpcReadGuard(),abi=chain.abi??CONTEST_ABI,horizons=chain.horizons??HORIZONS;
 async function eligible(identity,id,block=undefined){
  if(!entryId(id))throw new AppError('BAD_REQUEST',400);
  await chain.verify();const snapshot=await chain.snapshot(block),entry=await chain.readEntry(id,snapshot.number);
  if(!sameAddress(entry.payer,identity.wallet))throw new AppError('CLAIM_NOT_FOUND',404);
  if(entry.claimed)throw new AppError('CLAIM_ALREADY_COLLECTED',409);
  const horizon=horizons[entry.horizon],pool=await chain.readPool(entry.roundId.toString(),horizon,snapshot.number);
  const amount=await chain.claimable(id,snapshot.number);
  if(amount<=0n)throw new AppError('CLAIM_NOT_AVAILABLE',409);
  const refund=pool.phase===5||(pool.phase!==4&&snapshot.timestamp>=pool.refundAt);
  return {entry,pool,amount,refund,snapshot,horizon};
 }
 return {
  eligible,
  async preflight(identity,id){
   const e=await eligible(identity,id),call={address:config.contract,abi,functionName:'claimEntry',args:[BigInt(id),identity.wallet],account:identity.wallet,value:0n};
   await guard.read(()=>client.simulateContract(call));
   const [estimated,suggested,balance,latest,pending]=await Promise.all([guard.read(()=>client.estimateContractGas(call)),guard.read(()=>client.getGasPrice()),guard.read(()=>client.getBalance({address:identity.wallet})),guard.read(()=>client.getTransactionCount({address:identity.wallet,blockTag:'latest'})),guard.read(()=>client.getTransactionCount({address:identity.wallet,blockTag:'pending'}))]);
   if(latest!==pending)throw new AppError('ORDER_PENDING',409);
   const gas=estimated*120n/100n+10000n,gasPrice=suggested*120n/100n>20000000000n?suggested*120n/100n:20000000000n;
   if(balance<gas*gasPrice)throw new AppError('INSUFFICIENT_BALANCE',409);
   return {transaction:JSON.parse(JSON.stringify({chainId:config.chainId,to:config.contract,from:identity.wallet,value:'0',data:encodeFunctionData(call),nonce:pending,gas,gasPrice,type:'legacy'},(_k,v)=>typeof v==='bigint'?v.toString():v)),expiresAt:new Date(Date.now()+120000).toISOString(),round:{entryId:id,roundId:e.entry.roundId.toString(),horizon:e.horizon,amount:e.amount.toString(),refund:e.refund,asOfBlock:e.snapshot.number.toString(),recipient:identity.wallet}};
  },
  async verifyReceipt(order,receipt){
   if(receipt.status!=='success'||!sameAddress(receipt.to,config.contract)||!sameAddress(receipt.from,order.wallet_address))throw new AppError('PAYMENT_MISMATCH');
   const canonical=await chain.snapshot(receipt.blockNumber);if(canonical.hash?.toLowerCase()!==receipt.blockHash?.toLowerCase())throw new AppError('PAYMENT_MISMATCH');
   const events=[];
   for(const log of receipt.logs){if(!sameAddress(log.address,config.contract))continue;try{const event=decodeEventLog({abi,topics:log.topics,data:log.data,strict:true});if(event.eventName==='EntryClaimed')events.push(event.args);}catch{}}
   if(events.length!==1)throw new AppError('PAYMENT_MISMATCH');
   const event=events[0],id=order.request.entryId,entry=await chain.readEntry(id,receipt.blockNumber),pool=await chain.readPool(entry.roundId.toString(),horizons[entry.horizon],receipt.blockNumber);
   const refund=pool.phase===5,amount=refund?entry.paid:(await chain.readOutcome(id,receipt.blockNumber)).returned;
   if(event.entryId!==BigInt(id)||!sameAddress(event.recipient,order.wallet_address)||!sameAddress(entry.payer,order.wallet_address)||!entry.claimed||event.amount!==amount||event.refund!==refund||await chain.claimable(id,receipt.blockNumber)!==0n)throw new AppError('PAYMENT_MISMATCH');
   return {entryId:id,amount:amount.toString(),refund,recipient:event.recipient.toLowerCase(),transactionHash:receipt.transactionHash??order.transaction_hash,block:receipt.blockNumber.toString(),blockHash:receipt.blockHash};
  },
  async canBroadcast(order){try{await eligible({wallet:order.wallet_address},order.request.entryId);return true;}catch{return false;}},
 };
}

export function createClaimService({store,chain,claims,ready=true}){
 const check=()=>{if(!ready)throw new AppError('CLAIMS_NOT_READY',503);};
 async function get(id,identity){check();if(!uuid.test(id))throw new AppError('BAD_REQUEST',400);const o=await store.get(id,identity);if(!o||(o.action_kind??'purchase')!=='claim_entry')throw new AppError('CLAIM_NOT_FOUND',404);return o;}
 return {
  async list(identity){check();return {claims:(await store.list(identity)).map(publicClaim)};},
  async get(id,identity){return publicClaim(await get(id,identity));},
  async create(identity,body,key){
   check();if(!body||Object.keys(body).join(',')!=='entryId'||!entryId(body.entryId)||!uuid.test(key))throw new AppError('BAD_REQUEST',400);
   const prior=await store.byKey(key,identity);if(prior){if(prior.action_kind!=='claim_entry'||prior.request.entryId!==body.entryId)throw new AppError('ORDER_CONFLICT',409);return publicClaim(prior);}
   const q=await claims.preflight(identity,body.entryId);return publicClaim(await store.create(identity,key,body,q.transaction,q.expiresAt,q.round));
  },
  async signed(id,identity,raw){const o=await get(id,identity);if(typeof raw!=='string'||!/^0x[0-9a-f]+$/i.test(raw)||raw.length>20000)throw new AppError('BAD_SIGNATURE',400);const hash=await chain.validate(o,raw);if(!o.raw_transaction)await claims.preflight(identity,o.request.entryId);return publicClaim(await store.action(id,identity,'signed',raw.toLowerCase(),hash));},
  async cancel(id,identity){await get(id,identity);return publicClaim(await store.action(id,identity,'cancel'));},
 };
}
