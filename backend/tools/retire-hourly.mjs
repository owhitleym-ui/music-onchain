import {readFile} from 'node:fs/promises';
import {loadConfig} from '../src/config.js';
import {supabaseStore} from '../src/store.js';
import {createContestChain} from '../src/contest-chain.js';
import {createArcChain} from '../src/chain.js';
import {createWorker} from '../src/worker.js';
import {retireHourly} from '../src/retire-hourly.js';

try{
 const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--execute'))throw Error('Use npm run retire-hourly [-- --execute].');
 const base=loadConfig(),d=JSON.parse(await readFile(new URL('../../contracts/deployments/arc-testnet-markets-v2-live.json',import.meta.url),'utf8'));
 const config={...base,atomic:true,deployment:d,contract:d.address.toLowerCase(),schedulerEnabled:false,settlementEnabled:true};
 const chain=createContestChain(config),admin=supabaseStore(config),signerChain=createArcChain(config),execute=args.includes('--execute');
 const report=await retireHourly({chain,admin,signer:signerChain.signer,execute});
 if(execute){
  const worker=createWorker({store:admin,chain:signerChain});
  for(let i=0;i<Math.max(10,report.pools.length*4);i++){
   const states=await Promise.all(report.pools.map(p=>admin.job(p.jobId)));
   if(states.every(j=>j.state==='confirmed'))break;
   if(states.some(j=>['uncertain','reverted'].includes(j.state)))throw Error('Cancellation needs review; rerun preview. No entry funds were moved.');
   await worker.tick();
  }
  for(const p of report.pools){const job=await admin.job(p.jobId);p.status=job.state;}
  if(report.pools.some(p=>p.status!=='confirmed'))throw Error('Cancellation needs review; rerun preview. Queued work remains saved for recovery.');
 }
 console.log(JSON.stringify({...report,note:execute?'Cancelled pools allow participants to claim full entry refunds; this does not collect their money.':'Preview only. Disable scheduling and restart the backend before --execute.'},null,2));
}catch(e){console.error(e.message?.startsWith('Use ')||e.message?.startsWith('Cancellation needs')?e.message:'Hourly retirement stopped. Check database/RPC availability and the existing owner role.');process.exitCode=1;}
