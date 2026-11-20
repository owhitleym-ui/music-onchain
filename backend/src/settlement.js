import {DEMO_SONG} from '../../shared/demo-song.js';
import {samePolicy} from './song-policy.js';
import {isScheduled,typesFor,modelVersion} from './market-model.js';
import {keccak256,toBytes,encodeFunctionData,decodeEventLog} from 'viem';
import {CONTEST_ABI,HORIZONS} from './contest-chain.js';
import {livePoolId} from './live-contests.js';
import {prepareSettlement} from '../../contracts/tools/prepare-settlement.mjs';
import {sameAddress} from './config.js';
import {AppError} from './errors.js';
const uint=v=>typeof v==='string'&&/^(0|[1-9]\d{0,77})$/.test(v)&&BigInt(v)<2n**256n;
const fail=code=>{throw new AppError(code);};
export const settlementKinds=['submit-result','submit-order','advance-settlement','restart-order','cancel-pool'];
export function settlementCall(job,config){
 const p=job.payload,HORIZONS=typesFor(config);
 if(!config.settlementEnabled)fail('SETTLEMENT_DISABLED');
 if(!p||!uint(p.roundId)||p.roundId==='0'||!HORIZONS.includes(p.horizon))fail('BAD_REQUEST');
 const args=[BigInt(p.roundId),HORIZONS.indexOf(p.horizon)];
 if(job.kind==='submit-result'){if(!config.chartexEnabled||!uint(p.actualViews)||!/^0x[0-9a-f]{64}$/.test(p.evidenceHash))fail('BAD_REQUEST');return {functionName:'submitResult',args:[...args,BigInt(p.actualViews),p.evidenceHash]};}
 if(job.kind==='cancel-pool'){if(typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>500)fail('BAD_REQUEST');return {functionName:'cancelPool',args};}
 if(!uint(p.epoch)||!uint(p.offset))fail('BAD_REQUEST');
 if(job.kind==='submit-order'){
  if(!Array.isArray(p.tickets)||p.tickets.length<1||p.tickets.length>32||!p.tickets.every(uint)||new Set(p.tickets).size!==p.tickets.length)fail('BAD_REQUEST');
  return {functionName:'submitOrder',args:[...args,p.tickets.map(BigInt)]};
 }
 if(job.kind==='restart-order')return {functionName:'restartOrder',args};
 if(job.kind==='advance-settlement'){
  if(![2,3].includes(p.phase)||p.steps!==(p.phase===2?32:16))fail('BAD_REQUEST');
  return {functionName:'advanceSettlement',args:[...args,BigInt(p.steps)]};
 }
 fail('BAD_REQUEST');
}
export function assertSettlementCurrent(job,pool){
 const p=job.payload;
 if(job.kind==='submit-result'){if(pool.phase!==0)fail('JOB_SUPERSEDED');return;}
 if(pool.phase>=4)fail('JOB_SUPERSEDED');
 if(job.kind==='cancel-pool')return;
 if(pool.epoch!==BigInt(p.epoch))fail('SETTLEMENT_REVIEW');
 if(job.kind==='submit-order'||job.kind==='restart-order'){
  if(pool.phase>1||pool.orderCount>BigInt(p.offset))fail('JOB_SUPERSEDED');
  if(pool.phase!==1||pool.orderCount!==BigInt(p.offset))fail('SETTLEMENT_REVIEW');
 }else{
  const cursor=pool.phase===2?pool.scanCursor:pool.pairCursor;
  if(pool.phase>p.phase||(pool.phase===p.phase&&cursor>BigInt(p.offset)))fail('JOB_SUPERSEDED');
  if(pool.phase!==p.phase||cursor!==BigInt(p.offset))fail('SETTLEMENT_REVIEW');
 }
}
export function verifySettlementReceipt(job,receipt,contract){
 const names={'submit-result':'ResultSubmitted','submit-order':'OrderBatchAccepted','advance-settlement':'SettlementProgress','restart-order':'OrderRestarted','cancel-pool':'PoolCancelled'};
 const pool=livePoolId(job.payload.roundId,job.payload.horizon);
 const matches=[];
 for(const log of receipt.logs){if(!sameAddress(log.address,contract))continue;try{const e=decodeEventLog({abi:CONTEST_ABI,topics:log.topics,data:log.data,strict:true});if(e.eventName===names[job.kind]&&e.args.pool.toLowerCase()===pool)matches.push(e.args);}catch{}}
 if(receipt.status!=='success'||matches.length!==1)fail('SETTLEMENT_REVIEW');
 const e=matches[0],p=job.payload;
 if(job.kind==='submit-result'&&(e.actualViews!==BigInt(p.actualViews)||e.evidenceHash!==p.evidenceHash))fail('SETTLEMENT_REVIEW');
 if(job.kind==='submit-order'&&(e.epoch!==BigInt(p.epoch)||e.verified!==BigInt(p.offset)+BigInt(p.tickets.length)))fail('SETTLEMENT_REVIEW');
 if(job.kind==='restart-order'&&e.epoch!==BigInt(p.epoch)+1n)fail('SETTLEMENT_REVIEW');
}

export function createSettlementStore(client,contract){
 const read=async request=>{const r=await request;if(r.error)fail('LIVE_DATA_UNAVAILABLE');return r.data;};
 return {
  evidence:hash=>read(client.from('music_result_evidence').select('document,evidence_hash').eq('contract_address',contract).eq('evidence_hash',hash).maybeSingle()),
  async save(document){const hash=keccak256(toBytes(JSON.stringify(document)));const previous=await this.evidence(hash);if(previous){if(JSON.stringify(previous.document)!==JSON.stringify(document)&&keccak256(toBytes(JSON.stringify(canonicalEvidence(previous.document))))!==hash)fail('SETTLEMENT_REVIEW');return hash;}
   const r=await client.from('music_result_evidence').insert({evidence_hash:hash,contract_address:contract,document});if(r.error&&r.error.code!=='23505')fail('LIVE_DATA_UNAVAILABLE');return hash;},
  async entries(pool,block){const entries=[];let after='0';for(;;){const page=await read(client.rpc('music_settlement_entries',{p_contract:contract,p_pool:pool,p_block:block.toString(),p_after:after}));if(!Array.isArray(page))fail('LIVE_DATA_UNAVAILABLE');entries.push(...page);if(page.length<500)return entries;const next=page.at(-1).id;if(BigInt(next)<=BigInt(after))fail('SETTLEMENT_REVIEW');after=next;}},
 };
}
export function canonicalEvidence(d){
 if(![1,2,3].includes(d?.version)||!['sample','chartex'].includes(d.source)||d.chainId!==5042002||!/^0x[0-9a-f]{40}$/.test(d.contract)||!uint(d.roundId)||!(d.version>=2?typesFor({deployment:{marketModelVersion:d.version}}):HORIZONS).includes(d.horizon)||!uint(d.actualViews)||!uint(d.windowStart)||!uint(d.windowEnd)||typeof d.musicId!=='string')fail('BAD_REQUEST');
 const base={version:d.version,source:d.source,chainId:d.chainId,contract:d.contract,roundId:d.roundId,horizon:d.horizon,musicId:d.musicId,windowStart:d.windowStart,windowEnd:d.windowEnd,actualViews:d.actualViews};
 if(d.source==='sample')return base;
 if(d.version!==3||d.musicId!==DEMO_SONG.musicId||d.policy?.source!=='chartex'||d.policy?.spotifyId!==DEMO_SONG.spotifyId||d.policy?.metric!==DEMO_SONG.metric||!/^\d{4}-\d{2}-\d{2}$/.test(d.policy.targetDate)||!Number.isFinite(Date.parse(d.frozenAt))||!Array.isArray(d.observations)||d.observations.length!==2)fail('BAD_REQUEST');
 const policy={version:1,source:'chartex',songId:DEMO_SONG.id,musicId:DEMO_SONG.musicId,spotifyId:DEMO_SONG.spotifyId,metric:DEMO_SONG.metric,targetDate:d.policy.targetDate,reportingTimeZone:'provider-defined',biddingTimeZone:'America/Chicago',delayHours:24,stabilityHours:6,cutoffHoursBeforeRefund:1};
 if(!samePolicy(policy,d.policy))fail('BAD_REQUEST');
 const observations=d.observations.map(o=>{if(!/^[0-9a-f-]{36}$/i.test(o.collectionId)||!Number.isFinite(Date.parse(o.observedAt))||!/^[0-9a-f]{64}$/.test(o.responseHash))fail('BAD_REQUEST');return {collectionId:o.collectionId,observedAt:o.observedAt,responseHash:o.responseHash};});
 const first=Date.parse(observations[0].observedAt),last=Date.parse(observations[1].observedAt),end=Number(d.windowEnd)*1000;
 if(first<end+24*3600000||last-first<6*3600000||Date.parse(d.frozenAt)<last||Date.parse(d.frozenAt)>=end+47*3600000||observations[0].collectionId===observations[1].collectionId)fail('BAD_REQUEST');
 return {...base,policy,frozenAt:d.frozenAt,observations};
}
export async function prepareResult({config,chain,store,roundId,horizon,actualViews}){
 const HORIZONS=typesFor(config),abi=chain.abi??CONTEST_ABI;
 if(!uint(roundId)||roundId==='0'||!HORIZONS.includes(horizon)||!uint(actualViews))fail('BAD_REQUEST');
 await chain.verify();const block=await chain.snapshot(),round=await chain.readRound(roundId,block.number),pool=await chain.readPool(roundId,horizon,block.number);
 if(round.musicId===DEMO_SONG.musicId)fail('SETTLEMENT_REVIEW');
 if(pool.phase!==0||block.timestamp<pool.windowEnd||block.timestamp>=pool.refundAt)fail('RESULT_WINDOW_CLOSED');
 const oracle=await chain.readContract('oracle',[],block.number);
 if(!sameAddress(oracle,config.deployment.oracle))fail('SETTLEMENT_REVIEW');
 const document=canonicalEvidence({version:modelVersion(config),source:'sample',chainId:config.chainId,contract:config.contract,roundId,horizon,musicId:round.musicId,windowStart:pool.windowStart.toString(),windowEnd:pool.windowEnd.toString(),actualViews});
 const evidenceHash=await store.save(document),args=[BigInt(roundId),HORIZONS.indexOf(horizon),BigInt(actualViews),evidenceHash];
 return {label:'SAMPLE RESULT — manually supplied test count',document,evidenceHash,from:oracle,to:config.contract,value:'0',functionName:'submitResult',arguments:[roundId,HORIZONS.indexOf(horizon),actualViews,evidenceHash],data:encodeFunctionData({abi,functionName:'submitResult',args}),instruction:'Confirm these exact arguments using the existing oracle account in MetaMask/Remix. This command does not sign or broadcast.'};
}

export function createSettlementCoordinator({config,chain,live,store,admin,signer,intervalMs=5000,log=()=>{}}){
 const HORIZONS=typesFor(config);
 let running=false,timer=null,index=0;
 async function tick(){if(running||!config.settlementEnabled)return;running=true;try{
  if(await admin.pendingSettlement?.(signer))return;
  const catalog=await live.catalog();if(catalog.snapshot?.syncStatus!=='current')fail('LIVE_DATA_UPDATING');
  const candidates=catalog.rounds.flatMap(r=>typesFor(config,r.cadence).map(h=>({r,h})));if(!candidates.length)return;
  const {r,h}=candidates[index++%candidates.length],block=await chain.snapshot(),p=await chain.readPool(r.id,h,block.number);
  if(p.phase===0||p.phase>=4||block.timestamp>=p.refundAt)return;
  const saved=await store.evidence(p.evidenceHash);if(!saved)fail('SETTLEMENT_REVIEW');
  const d=canonicalEvidence(saved.document);if(keccak256(toBytes(JSON.stringify(d)))!==p.evidenceHash||d.roundId!==r.id||d.horizon!==h||d.contract!==config.contract||BigInt(d.actualViews)!==p.actualViews||BigInt(d.windowStart)!==p.windowStart||BigInt(d.windowEnd)!==p.windowEnd)fail('SETTLEMENT_REVIEW');
  let payload={roundId:r.id,horizon:h,epoch:p.epoch.toString()},kind;
  if(p.phase===1){
   const entries=await store.entries(livePoolId(r.id,h),block.number);
   if(BigInt(entries.length)!==p.entryCount||entries.reduce((n,e)=>n+BigInt(e.paid),0n)!==p.totalDeposits)fail('LIVE_DATA_UPDATING');
   const sorted=prepareSettlement({actualViews:p.actualViews.toString(),entries});
   if(BigInt(sorted.spotCount)!==p.spotCount)fail('LIVE_DATA_UPDATING');
   const count=Number(p.orderCount);if(count&&BigInt(sorted.orderedTicketIds[count-1])!==p.lastTicket)fail('SETTLEMENT_REVIEW');
   kind='submit-order';payload={...payload,offset:p.orderCount.toString(),tickets:sorted.orderedTicketIds.slice(count,count+32)};
  }else{kind='advance-settlement';payload={...payload,phase:p.phase,offset:(p.phase===2?p.scanCursor:p.pairCursor).toString(),steps:p.phase===2?32:16};}
  await admin.operator(kind,null,signer,payload);
 }catch(e){log({event:'settlement',code:e instanceof AppError?e.code:'LIVE_DATA_UNAVAILABLE'});}finally{running=false;}}
 return {tick,start(){if(!config.settlementEnabled||timer)return;timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();void tick();},stop(){clearInterval(timer);timer=null;}};
}
