import {readFileSync} from 'node:fs';
import {createPublicClient,http,encodeFunctionData,decodeEventLog,keccak256,toBytes,parseTransaction,recoverTransactionAddress} from 'viem';
import {CHAIN_ID,ORIGINAL_OWNER,sameAddress,sha256} from './config.js';
import {createRpcReadGuard} from './rpc-reads.js';
import {AppError} from './errors.js';

export const CONTEST_ABI=JSON.parse(readFileSync(new URL('../../contracts/abi/MusicPredictionContest.json',import.meta.url),'utf8'));
export const SONG_ID=keccak256(toBytes('last-bus-home'));
export const HORIZONS=['24h','48h','week'];
export const OPTIONS=Object.freeze({single:{costCents:500,spots:1,records:1,multiplier:1,method:'enter'},four:{costCents:2000,spots:4,records:4,multiplier:1,method:'enterFour'},bundle:{costCents:5000,spots:10,records:1,multiplier:1.05,method:'enter'}});
export const jsonSafe=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const absent=e=>/TransactionReceiptNotFoundError|TransactionNotFoundError/.test(e?.name??'');

export function createContestChain(config,{client}={}) {
  client??=createPublicClient({transport:http(config.rpc,{timeout:10000,retryCount:0}),cacheTime:0});
  const guard=createRpcReadGuard();const target=config.contract;
  let roundsCache=null,roundsUntil=0,pendingRounds=null;const pools=new Map();
  const read=(functionName,args=[],blockNumber)=>guard.read(()=>client.readContract({address:target,abi:CONTEST_ABI,functionName,args,...(blockNumber==null?{}:{blockNumber})}));
  async function verify() {
    if(!config.atomic)throw new AppError('PAYMENTS_NOT_READY',409);
    if(await guard.read(()=>client.getChainId())!==CHAIN_ID)throw new AppError('PAYMENTS_UNAVAILABLE');
    const code=await guard.read(()=>client.getCode({address:target}));
    if(!code||sha256(Buffer.from(code.slice(2),'hex'))!==config.deployment.runtimeSha256)throw new AppError('PAYMENTS_UNAVAILABLE');
    const [spot,four,bundle,rate]=await Promise.all([read('SPOT_PRICE'),read('FOUR_SPOT_PRICE'),read('BUNDLE_PRICE'),read('transferRate',[1n,4n])]);
    if(spot!==5n*10n**18n||four!==20n*10n**18n||bundle!==50n*10n**18n||rate!==900000000000000000n)throw new AppError('PAYMENTS_UNAVAILABLE');
  }
  async function rounds() {
    if(roundsCache&&Date.now()<roundsUntil)return roundsCache;
    if(pendingRounds)return pendingRounds;
    pendingRounds=(async()=>{
      await verify();const block=await guard.read(()=>client.getBlock({blockTag:'latest'}));
      const event=CONTEST_ABI.find(x=>x.type==='event'&&x.name==='RoundCreated');const all=[];
      for(let start=BigInt(config.deployment.creationBlock);start<=block.number;start+=5000n){
        const end=start+4999n<block.number?start+4999n:block.number;
        all.push(...await guard.logs(()=>client.getLogs({address:target,event,args:{songId:SONG_ID},fromBlock:start,toBlock:end,strict:true})));
      }
      roundsCache=all.map(l=>({id:l.args.roundId.toString(),songId:'last-bus-home',musicId:l.args.musicId,start:Number(l.args.start)*1000,deadline:(Number(l.args.start)+3600)*1000,artist:l.args.artist})).filter(r=>r.musicId==='demo:last-bus-home'&&sameAddress(r.artist,ORIGINAL_OWNER)).sort((a,b)=>a.start-b.start);
      roundsUntil=Date.now()+10000;return roundsCache;
    })().finally(()=>pendingRounds=null);return pendingRounds;
  }
  async function pool(roundId,horizon) {
    if(!HORIZONS.includes(horizon)||!/^\d+$/.test(String(roundId)))throw new AppError('BAD_REQUEST',400);
    const round=(await rounds()).find(r=>r.id===String(roundId));if(!round)throw new AppError('ROUND_UNAVAILABLE',404);
    const key=roundId+':'+horizon;const cached=pools.get(key);if(cached&&cached.until>Date.now())return cached.value;
    const block=await guard.read(()=>client.getBlock({blockTag:'latest'}));const h=HORIZONS.indexOf(horizon);
    const p=await read('getPool',[BigInt(roundId),h],block.number);const entries=[];
    // Bound public snapshot work; larger pools retain totals and explicitly omit crowd statistics.
    const statsComplete=p.entryCount<=1000n;
    if(statsComplete)for(let offset=0n;offset<p.entryCount;offset+=100n){
      const ids=await read('getPoolEntries',[BigInt(roundId),h,offset,100n],block.number);
      for(const id of ids)entries.push(await read('getEntry',[id],block.number));
    }
    const counts=new Map();let sum=0n;
    for(const e of entries){sum+=e.guess*BigInt(e.spots);counts.set(e.guess.toString(),(counts.get(e.guess.toString())??0)+e.spots);}
    const popular=[...counts].sort((a,b)=>b[1]-a[1]||(BigInt(a[0])<BigInt(b[0])?-1:1));
    const value={roundId:String(roundId),horizon,roundStart:round.start,deadline:round.deadline,windowStart:Number(p.windowStart)*1000,windowEnd:Number(p.windowEnd)*1000,serverTime:Number(block.timestamp)*1000,phase:p.phase,open:p.phase===0&&block.timestamp>=BigInt(round.start/1000)&&block.timestamp<BigInt(round.deadline/1000),spotCount:p.spotCount.toString(),peopleCount:p.peopleCount.toString(),totalDeposits:p.totalDeposits.toString(),statsComplete,average:statsComplete&&p.spotCount?Number(sum)/Number(p.spotCount):null,mode:popular[0]?.[0]??null,modeSpots:popular[0]?.[1]??0,block:block.number.toString()};
    pools.set(key,{value,until:Date.now()+5000});return value;
  }
  async function preflight(identity,request) {
    await verify();const {roundId,horizon,guess,optionId}=request;const option=OPTIONS[optionId];
    if(!option||!HORIZONS.includes(horizon)||!/^\d{1,78}$/.test(String(guess))||BigInt(guess)>(1n<<256n)-1n)throw new AppError('BAD_REQUEST',400);
    const round=(await rounds()).find(r=>r.id===roundId);if(!round)throw new AppError('ROUND_UNAVAILABLE',409);
    const block=await guard.read(()=>client.getBlock({blockTag:'latest'}));
    const p=await read('getPool',[BigInt(roundId),HORIZONS.indexOf(horizon)],block.number);
    if(p.phase!==0||Number(block.timestamp)*1000<round.start||Number(block.timestamp)*1000>=round.deadline)throw new AppError('ROUND_CLOSED',409);
    if(!await read('walletApproved',[identity.wallet],block.number))throw new AppError('APPROVAL_REQUIRED',409);
    if(sameAddress(round.artist,identity.wallet)||await read('excluded',[BigInt(roundId),identity.wallet],block.number))throw new AppError('ARTIST_EXCLUDED',403);
    if(optionId==='bundle'&&await read('freeBonusReserve',[],block.number)<2500000000000000000n)throw new AppError('RESERVE_UNAVAILABLE',409);
    const value=BigInt(option.costCents)*10n**16n,args=[BigInt(roundId),HORIZONS.indexOf(horizon),BigInt(guess)];
    const call={address:target,abi:CONTEST_ABI,functionName:option.method,args,account:identity.wallet,value};
    await guard.read(()=>client.simulateContract(call));
    const estimated=await guard.read(()=>client.estimateContractGas(call));const suggested=await guard.read(()=>client.getGasPrice());
    const gas=estimated*120n/100n+10000n,gasPrice=suggested*120n/100n>20000000000n?suggested*120n/100n:20000000000n;
    const balance=await guard.read(()=>client.getBalance({address:identity.wallet}));if(balance<value+gas*gasPrice)throw new AppError('INSUFFICIENT_BALANCE',409);
    const latest=await guard.read(()=>client.getTransactionCount({address:identity.wallet,blockTag:'latest'}));
    const nonce=await guard.read(()=>client.getTransactionCount({address:identity.wallet,blockTag:'pending'}));if(nonce!==latest)throw new AppError('ORDER_PENDING',409);
    return {transaction:jsonSafe({chainId:CHAIN_ID,to:target,from:identity.wallet,nonce,value,gas,gasPrice,data:encodeFunctionData({abi:CONTEST_ABI,functionName:option.method,args}),type:'legacy'}),expiresAt:new Date(Math.min(Date.now()+120000,round.deadline)).toISOString(),round};
  }
  async function validate(order,raw) {
    let tx,sender;try{tx=parseTransaction(raw);sender=await recoverTransactionAddress({serializedTransaction:raw});}catch{throw new AppError('BAD_SIGNATURE',400);}
    const expected=order.transaction;
    if(tx.type!=='legacy'||tx.chainId!==CHAIN_ID||!sameAddress(sender,order.wallet_address)||!sameAddress(tx.to,target)||!sameAddress(order.contract_address,target)||tx.data!==expected.data||tx.nonce!==Number(expected.nonce)||tx.value!==BigInt(expected.value)||tx.gas!==BigInt(expected.gas)||tx.gasPrice!==BigInt(expected.gasPrice))throw new AppError('BAD_SIGNATURE',400);
    return keccak256(raw);
  }
  async function verifyReceipt(order,receipt) {
    if(!sameAddress(receipt.to,target)||!sameAddress(receipt.from,order.wallet_address))throw new AppError('PAYMENT_MISMATCH');
    const option=OPTIONS[order.request.optionId];const events=[];
    for(const log of receipt.logs){if(!sameAddress(log.address,target))continue;try{const e=decodeEventLog({abi:CONTEST_ABI,topics:log.topics,data:log.data,strict:true});if(e.eventName==='EntryRecorded')events.push(e.args);}catch{}}
    if(events.length!==option.records||new Set(events.map(e=>e.entryId.toString())).size!==option.records)throw new AppError('PAYMENT_MISMATCH');
    const expectedPaid=BigInt(option.costCents)*10n**16n/BigInt(option.records);
    for(const e of events){const stored=await read('getEntry',[e.entryId],receipt.blockNumber);
      if(!sameAddress(e.payer,order.wallet_address)||e.guess!==BigInt(order.request.guess)||e.paid!==expectedPaid||e.spots!==option.spots/option.records||stored.roundId!==BigInt(order.request.roundId)||stored.horizon!==HORIZONS.indexOf(order.request.horizon)||!sameAddress(stored.payer,order.wallet_address)||stored.guess!==e.guess||stored.paid!==e.paid||stored.spots!==e.spots||stored.multiplierBps!==(option.multiplier===1?10000:10500)||stored.pool!==e.pool)throw new AppError('PAYMENT_MISMATCH');
    }
    pools.clear();return events.map(e=>e.entryId.toString());
  }
  return {verify,rounds,pool,preflight,validate,verifyReceipt,invalidate:()=>{pools.clear();roundsUntil=0;},
    async receipt(hash){try{return await guard.read(()=>client.getTransactionReceipt({hash}));}catch(e){if(absent(e))return null;throw e;}},
    async known(hash){try{await guard.read(()=>client.getTransaction({hash}));return true;}catch(e){if(absent(e))return false;throw e;}},
    canBroadcast:async order=>(await pool(order.request.roundId,order.request.horizon)).open,
    latestNonce:wallet=>guard.read(()=>client.getTransactionCount({address:wallet,blockTag:'latest'})),
    broadcast:raw=>client.sendRawTransaction({serializedTransaction:raw}),
  };
}
