import {activeSong} from '../../shared/demo-song.js';
import {activeSongHash,roundSong} from './song-policy.js';
import {decodeEventLog} from 'viem';
import {desiredRounds,scheduleFor,assertSchedule,dailyBoundaries,MARKET_TYPES} from '../../shared/market-schedule.js';
import {MARKETS_ABI,isV2,isV3,marketAbi} from './market-model.js';
import {SONG_ID} from './contest-chain.js';
import {ORIGINAL_OWNER,address,sameAddress} from './config.js';
import {AppError} from './errors.js';
export function creationPayload(schedule,excluded=[],version=3,config={}){
 return {songId:activeSongHash(config),musicId:activeSong(config).musicId,artist:ORIGINAL_OWNER,start:schedule.entryStart/1000,deadline:schedule.entryEnd/1000,...(version===3?{modelVersion:3,times:dailyBoundaries(schedule.entryStart).map(t=>t/1000)}:{targetStart:schedule.windowStart/1000,targetEnd:schedule.windowEnd/1000}),excluded:[...new Set(excluded.map(address))].sort()};
}
export function creationCall(job,config){
 const p=job.payload,cadence=job.kind==='create-hourly'?'hourly':job.kind==='create-daily'?'daily':null;
 if(isV3(config)){
  if(cadence!=='daily'||p?.modelVersion!==3||!roundSong(p)||!sameAddress(p.artist,ORIGINAL_OWNER)||!Array.isArray(p.excluded)||p.excluded.length>32||p.excluded.some(x=>!address(x))||new Set(p.excluded).size!==p.excluded.length||!Array.isArray(p.times)||p.times.length!==6||!p.times.every(Number.isSafeInteger))throw new AppError('BAD_REQUEST');
  const expected=dailyBoundaries(p.start*1000).map(t=>t/1000);
  if(expected[0]!==p.start||expected[1]!==p.deadline||expected.some((n,i)=>n!==p.times[i]))throw new AppError('BAD_REQUEST');
  return {functionName:'createDailyRound',args:[p.songId,p.musicId,p.artist,p.times.map(BigInt),p.excluded]};
 }
 if(!isV2(config)||!cadence||p?.songId!==SONG_ID||p.musicId!=='demo:last-bus-home'||!sameAddress(p.artist,ORIGINAL_OWNER)||!Array.isArray(p.excluded)||p.excluded.length>32||p.excluded.some(x=>!address(x))||new Set(p.excluded).size!==p.excluded.length)throw new AppError('BAD_REQUEST');
 const s=scheduleFor(cadence==='hourly'?'next_hour':'day_plus_7',p.start*1000);
 if(s.entryStart!==p.start*1000||s.entryEnd!==p.deadline*1000||s.windowStart!==p.targetStart*1000||s.windowEnd!==p.targetEnd*1000)throw new AppError('BAD_REQUEST');
 return {functionName:cadence==='hourly'?'createHourlyRound':'createDailyRound',args:[p.songId,p.musicId,p.artist,cadence==='hourly'?BigInt(p.start):[p.start,p.deadline,p.targetStart,p.targetEnd].map(BigInt),p.excluded]};
}
export function verifyCreationReceipt(job,receipt,target,config={deployment:{marketModelVersion:2}}){
 const p=job.payload,events=[];
 for(const l of receipt.logs){if(!sameAddress(l.address,target))continue;try{events.push(decodeEventLog({abi:marketAbi(config),topics:l.topics,data:l.data,strict:true}));}catch{}}
 const rounds=events.filter(e=>e.eventName==='RoundCreated'),markets=events.filter(e=>e.eventName==='MarketScheduled');
 const cadence=job.kind==='create-hourly'?'hourly':'daily',r=rounds[0]?.args;
 if(receipt.status!=='success'||rounds.length!==1||!r||r.songId!==p.songId||r.musicId!==p.musicId||!sameAddress(r.artist,p.artist)||Number(r.start)!==p.start||Number(r.deadline)!==p.deadline||Number(r.cadence)!==(cadence==='hourly'?0:1)||markets.length!==(isV3(config)?3:cadence==='hourly'?2:1))throw new AppError('PAYMENT_MISMATCH');
 const expected=isV3(config)?MARKET_TYPES.map(t=>t.id):cadence==='hourly'?['next_hour','hour_plus_24']:['day_plus_7'];
 for(const [i,type] of expected.entries()){
  const e=markets.find(e=>Number(e.args.marketType)===(isV3(config)||cadence==='hourly'?i:2))?.args;
  if(!e||e.roundId!==r.roundId)throw new AppError('PAYMENT_MISMATCH');
  try{assertSchedule({marketType:type,entryStart:p.start*1000,entryEnd:p.deadline*1000,windowStart:Number(e.windowStart)*1000,windowEnd:Number(e.windowEnd)*1000,refundAt:Number(e.refundAt)*1000});}catch{throw new AppError('PAYMENT_MISMATCH');}
 }
}
export function createMarketScheduler({config,chain,admin,signer,assertActive=async()=>{},bindRound=async()=>{},intervalMs=15000,log=()=>{}}){
 let running=false,timer=null,status={enabled:Boolean(config.schedulerEnabled),lastChecked:null,error:null};
 async function tick(){if(running||!config.schedulerEnabled||!isV3(config))return;running=true;try{
  await assertActive();await chain.verify();
  const block=await chain.snapshot(),now=Number(block.timestamp)*1000;
  for(const s of desiredRounds(now)){
   const id=await chain.readContract('roundFor',[activeSongHash(config),s.cadence==='hourly'?0:1,BigInt(s.entryStart/1000)],block.number);
   if(id!==0n){await bindRound(id.toString());continue;}
   // Queue identity includes exact boundaries and exclusions; durable operator dedup handles repeated ticks.
   const payload=creationPayload(s,config.deployment.initialExcluded??[signer],3,config);
   await admin.operator(s.cadence==='hourly'?'create-hourly':'create-daily',null,signer,payload);
  }
  status={...status,lastChecked:new Date().toISOString(),error:null};
 }catch(e){status={...status,error:e instanceof AppError?e.code:'RPC_UNAVAILABLE'};log({event:'market-scheduler',code:status.error});}finally{running=false;}}
 return {tick,status:()=>({...status}),start(){if(!config.schedulerEnabled||timer)return;timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();void tick();},stop(){clearInterval(timer);timer=null;}};
}
