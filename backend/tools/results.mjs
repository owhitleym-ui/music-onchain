import {encodeFunctionData} from 'viem';
import {loadConfig,address} from '../src/config.js';
import {supabaseStore} from '../src/store.js';
import {createContestChain,CONTEST_ABI,HORIZONS} from '../src/contest-chain.js';
import {createArcChain} from '../src/chain.js';
import {prepareResult,createSettlementStore} from '../src/settlement.js';
const [command,roundId,horizon,...rest]=process.argv.slice(2);
if(!['prepare','status','fees','cancel','restart'].includes(command)){
 console.log('Commands: prepare ROUND day_plus_1|day_plus_2|day_plus_7 SAMPLE_VIEWS (legacy V2: next_hour|hour_plus_24|day_plus_7; V1: 24h|48h|week) | status ROUND HORIZON | fees [BENEFICIARY] | cancel ROUND HORIZON REASON | restart ROUND HORIZON');
}else try{
 const config=loadConfig();if(config.missing.length)throw Error('CONFIG_REQUIRED');
 const HORIZONS=createContestChain(config).horizons,CONTEST_ABI=createContestChain(config).abi;
 const database=supabaseStore(config),chain=createContestChain(config),store=createSettlementStore(database.client,config.contract);
 await chain.verify();
 if(command==='prepare'){
  if(rest.length!==1)throw Error('BAD_REQUEST');
  console.log(JSON.stringify(await prepareResult({config,chain,store,roundId,horizon,actualViews:rest[0]}),null,2));
 }else if(command==='fees'){
  if(horizon||rest.length)throw Error('BAD_REQUEST');const beneficiary=address(roundId??config.deployment.platformRecipient);if(!beneficiary)throw Error('BAD_REQUEST');
  const credit=await chain.readContract('feeCredits',[beneficiary]);
  console.log(JSON.stringify({beneficiary,available:credit.toString(),note:'Fee credits are combined by beneficiary. If artist and app share this account, collect once.',...(credit>0n?{from:beneficiary,to:config.contract,value:'0',functionName:'claimFees',arguments:[beneficiary],data:encodeFunctionData({abi:CONTEST_ABI,functionName:'claimFees',args:[beneficiary]}),instruction:'Review and confirm in the beneficiary account using MetaMask/Remix. No transaction was signed or broadcast.'}:{})},null,2));
 }else{
  if(!/^[1-9]\d{0,77}$/.test(roundId??'')||!HORIZONS.includes(horizon))throw Error('BAD_REQUEST');
  const block=await chain.snapshot(),pool=await chain.readPool(roundId,horizon,block.number);
  if(command==='status'){
   if(rest.length)throw Error('BAD_REQUEST');const evidence=await store.evidence(pool.evidenceHash);
   console.log(JSON.stringify({block:block.number,pool,resultSource:evidence?.document.source??'unverified',settlementEnabled:config.settlementEnabled,isSolvent:await chain.readContract('isSolvent',[],block.number)},(_k,v)=>typeof v==='bigint'?v.toString():v,2));
  }else{
   if(!config.settlementEnabled)throw Error('SETTLEMENT_DISABLED');
   if(pool.phase>=4)throw Error('ALREADY_TERMINAL');
   const signer=createArcChain(config).signer;
   const payload=command==='cancel'?{roundId,horizon,reason:rest.join(' ')}:{roundId,horizon,epoch:pool.epoch.toString(),offset:pool.orderCount.toString()};
   if(command==='cancel'&&!payload.reason.trim())throw Error('BAD_REQUEST');
   if(command==='restart'&&(rest.length||pool.phase!==1))throw Error('BAD_REQUEST');
   const job=await database.operator(command==='cancel'?'cancel-pool':'restart-order',null,signer,payload);
   console.log(JSON.stringify({jobId:job.id,status:job.state,note:'Saved to the existing administrator queue; the opted-in local worker processes it.'}));
  }
 }
}catch(e){const codes=new Set(['BAD_REQUEST','CONFIG_REQUIRED','SETTLEMENT_DISABLED','ALREADY_TERMINAL','RESULT_WINDOW_CLOSED','SETTLEMENT_REVIEW']);console.error('Result tooling stopped: '+(codes.has(e.code??e.message)?(e.code??e.message):'DATABASE_OR_RPC_UNAVAILABLE')+'. No private settings were printed.');process.exitCode=1;}
