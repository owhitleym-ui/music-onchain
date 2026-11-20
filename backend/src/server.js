import {createContestChain} from './contest-chain.js';
import {createPurchaseStore} from './purchase-store.js';
import {createPurchaseService,createPaymentWorker} from './purchases.js';
import {createLiveStore} from './live-store.js';
import {createLiveContests} from './live-contests.js';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createHandler } from './http.js';
import { privyAuthenticator } from './auth.js';
import { supabaseStore } from './store.js';
import { createArcChain } from './chain.js';
import { createApprovalService } from './service.js';
import { createWorker } from './worker.js';

let config;
try {config=loadConfig();}catch{console.error('Backend configuration is invalid. Run npm run setup in backend/.');process.exit(1);}
const configured=config.missing.length===0;
let handler,worker,paymentWorker;
if(configured) {
  try {
    const store=supabaseStore(config),chain=createArcChain(config);
    const authenticate=privyAuthenticator(config);
    const approvalService=createApprovalService({store,chain,hourlyLimit:config.hourlyLimit});
    const contestChain=createContestChain(config),purchaseStore=createPurchaseStore(store.client,config.contract);
    const purchases=createPurchaseService({store:purchaseStore,chain:contestChain,config});
    const contests=config.atomic?createLiveContests({config,store:createLiveStore(store.client,config.contract),chain:contestChain}):null;
    if(config.atomic)paymentWorker=createPaymentWorker({store:purchaseStore,chain:contestChain,onConfirmed:()=>contests?.invalidate()});
    handler=createHandler({authenticate,approvalService,purchases,contests,health:async()=>({ready:true,paymentsConfigured:config.atomic,liveReadsConfigured:Boolean(contests)})});
    worker=createWorker({store,chain,log:event=>console.log(JSON.stringify(event))});
  } catch {console.error('Backend configuration could not be loaded. Run npm run setup in backend/.');process.exit(1);}
} else {
  handler=createHandler({configured:false});
  console.log('Account activation needs local setup. Browsing, login and balances still work. Run npm run setup in backend/.');
}
const server=createServer(handler);
server.requestTimeout=20000;
server.headersTimeout=15000;
server.on('error',()=>{console.error('Cannot open the local backend on port 3001. Stop the other backend before restarting.');process.exitCode=1;worker?.stop();paymentWorker?.stop();});
server.listen(3001,'127.0.0.1',()=>{console.log('Account backend: http://127.0.0.1:3001');worker?.start();paymentWorker?.start();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{worker?.stop();paymentWorker?.stop();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();});
