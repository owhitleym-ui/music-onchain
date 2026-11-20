import {DEMO_SONG} from '../../shared/demo-song.js';
import {createChartexStore,createChartexCollector,createChartexResults,createResultValidator} from './chartex.js';
import {roundSong} from './song-policy.js';
import {readFileSync} from 'node:fs';
import {isScheduled,isV3,modelVersion,deploymentId} from './market-model.js';
import {createMarkets} from './markets.js';
import {createMarketScheduler} from './market-scheduler.js';
import {createDeploymentRouter} from './deployment-router.js';
import {AppError} from './errors.js';
import {createClaimChain,createClaimService} from './claims.js';
import {createSettlementStore,createSettlementCoordinator} from './settlement.js';
import {createContestChain} from './contest-chain.js';
import {createPurchaseStore} from './purchase-store.js';
import {createPurchaseService,createPaymentWorker} from './purchases.js';
import {createLiveStore} from './live-store.js';
import {createLiveContests} from './live-contests.js';
import { createServer } from 'node:http';
import { sameAddress,loadConfig } from './config.js';
import { createHandler } from './http.js';
import { privyAuthenticator } from './auth.js';
import { supabaseStore } from './store.js';
import { createArcChain } from './chain.js';
import { createApprovalService } from './service.js';
import { createWorker } from './worker.js';

let config;
try {config=loadConfig();}catch{console.error('Backend configuration is invalid. Run npm run setup in backend/.');process.exit(1);}
const configured=config.missing.length===0;
let handler,worker,paymentWorker,settlement,scheduler,collector,results;const paymentWorkers=[];
if(configured) {
  try {
    const store=supabaseStore(config);let validateResult;const chain=createArcChain(config,{validateResult:job=>validateResult?.(job)??Promise.reject(new AppError('SETTLEMENT_REVIEW'))});
    const data=config.chartexEnabled?createChartexStore(store.client,config.contract):null;
    if(data){const schema=await store.client.rpc('music_step7_status');if(schema.error||schema.data!==1)throw Error('STEP7_SCHEMA_REQUIRED');if(!config.chartexAppId||!config.chartexAppToken)throw Error('CHARTEX_CREDENTIALS_REQUIRED');if(!sameAddress(config.expectedOracle,chain.signer))throw Error('ORACLE_NOT_READY');}
    const authenticate=privyAuthenticator(config);
    const approvalService=createApprovalService({store,chain,hourlyLimit:config.hourlyLimit});
    const schema=await store.client.rpc('music_step6_status');
    const step6=!schema.error&&schema.data===1;
    config.settlementEnabled=Boolean(step6&&config.settlementEnabled);
    const marketSchema=await store.client.rpc('music_market_schema_status');
    const marketReady=!marketSchema.error&&marketSchema.data>=modelVersion(config);
    if(isScheduled(config)&&!marketReady)throw new Error('MARKET_SCHEMA_REQUIRED');
    const assertActive=async()=>{
      if(!marketReady)return;
      const r=await store.client.from('music_deployments').select('active,runtime_sha256').eq('contract_address',config.contract).maybeSingle();
      if(r.error||!r.data?.active||r.data.runtime_sha256!==config.deployment.runtimeSha256)throw new AppError('MARKET_CHANGED',409);
    };
    const historical=['arc-testnet-atomic-live.json','arc-testnet-markets-v2-live.json'].map(name=>JSON.parse(readFileSync(new URL('../../contracts/deployments/'+name,import.meta.url),'utf8'))).filter(d=>d.address.toLowerCase()!==config.contract&&((d.marketModelVersion??1)<modelVersion(config)));
    const configs=config.atomic?[config,...historical.map(deployment=>({...config,deployment,contract:deployment.address.toLowerCase(),chartexEnabled:false,expectedOracle:null,settlementEnabled:false,schedulerEnabled:false}))]:[config];
    const services=new Map();
    for(const d of configs){
      const cc=createContestChain(d,{assertPolicy:data&&d.contract===config.contract?(row,type)=>data.assertPolicy(row,type):undefined}),ps=createPurchaseStore(store.client,d.contract,{step6});
      if(d.contract===config.contract)ps.assertActive=async()=>{if(!isV3(config))throw new AppError('MARKET_CHANGED',409);await assertActive();};
      const claimChain=createClaimChain({config:d,chain:cc});
      const claims=createClaimService({store:createPurchaseStore(store.client,d.contract,{step6,kind:'claim_entry'}),chain:cc,claims:claimChain,ready:step6&&d.atomic});
      const purchases=createPurchaseService({store:ps,chain:cc,config:d});
      const live=d.atomic?createLiveContests({config:d,store:createLiveStore(store.client,d.contract,{step6,verifyClaims:true,modelVersion:modelVersion(d)}),chain:cc}):null;
      if(d.atomic)paymentWorkers.push(createPaymentWorker({store:ps,chain:cc,claims:claimChain,onConfirmed:()=>live?.invalidate()}));
      services.set(deploymentId(d),{config:d,chain:cc,claims,purchases,live});
    }
    const active=services.get(deploymentId(config));
    if(data&&!sameAddress(await active.chain.readContract('oracle'),chain.signer))throw Error('ORACLE_NOT_READY');
    const router=createDeploymentRouter({client:store.client,services,activeId:deploymentId(config)});
    const markets=createMarkets({config,live:active.live,deployments:configs,services,assertActive,data});
    const evidence=createSettlementStore(store.client,config.contract);
    if(data){validateResult=createResultValidator({config,chain:active.chain,data,evidence});collector=createChartexCollector({config,store:data,log:event=>console.log(JSON.stringify(event))});results=createChartexResults({config,chain:active.chain,live:active.live,data,evidence,admin:store,signer:chain.signer,log:event=>console.log(JSON.stringify(event))});}
    const legacyLive=services.get('atomic-v1')?.live;
    handler=createHandler({authenticate,approvalService,purchases:router.purchases,claims:router.claims,contests:legacyLive,markets,entriesByDeployment:router.entries,musicData:data,health:async()=>({ready:true,paymentsConfigured:config.atomic,liveReadsConfigured:Boolean(active.live),claimsConfigured:step6&&config.atomic,settlementEnabled:config.settlementEnabled,marketModelVersion:modelVersion(config),marketSchemaReady:marketReady,scheduler:scheduler?.status()??{enabled:false},chartex:data?{configured:Boolean(config.chartexAppId&&config.chartexAppToken),collection:await data.state(),results:results?.status()}:null})});
    if(step6&&active.live)settlement=createSettlementCoordinator({config,chain:active.chain,live:active.live,store:evidence,admin:store,signer:chain.signer,log:event=>console.log(JSON.stringify(event))});
    scheduler=createMarketScheduler({config,chain:active.chain,admin:store,signer:chain.signer,assertActive,bindRound:data?async id=>{const raw=await active.chain.readRound(id);if(roundSong(raw)?.id!==DEMO_SONG.id)throw new AppError('RESULT_POLICY_UNAVAILABLE');await data.bind({...raw,id,start:Number(raw.start)*1000});}:undefined,log:event=>console.log(JSON.stringify(event))});
    worker=createWorker({store,chain,log:event=>console.log(JSON.stringify(event))});
  } catch {console.error('Backend configuration could not be loaded. Run npm run setup in backend/.');process.exit(1);}
} else {
  handler=createHandler({configured:false});
  console.log('Account activation needs local setup. Browsing, login and balances still work. Run npm run setup in backend/.');
}
const server=createServer(handler);
server.requestTimeout=20000;
server.headersTimeout=15000;
server.on('error',()=>{console.error('Cannot open the local backend on port 3001. Stop the other backend before restarting.');process.exitCode=1;worker?.stop();for(const w of paymentWorkers)w.stop();settlement?.stop();scheduler?.stop();collector?.stop();results?.stop();});
server.listen(3001,'127.0.0.1',()=>{console.log('Account backend: http://127.0.0.1:3001');worker?.start();for(const w of paymentWorkers)w.start();settlement?.start();scheduler?.start();collector?.start();results?.start();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{worker?.stop();for(const w of paymentWorkers)w.stop();settlement?.stop();scheduler?.stop();collector?.stop();results?.stop();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();});
