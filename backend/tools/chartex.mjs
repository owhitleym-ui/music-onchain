import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {createPublicClient,http} from 'viem';
import {loadConfig,sameAddress} from '../src/config.js';
import {supabaseStore} from '../src/store.js';
import {createArcChain} from '../src/chain.js';
import {createWorker} from '../src/worker.js';
import {createChartexStore,createChartexCollector} from '../src/chartex.js';
import {DAILY_ABI} from '../src/market-model.js';
import {checkEventHistory} from '../src/event-history.js';
const command=process.argv[2]??'status';
const allowed=new Set(['SCHEMA_REQUIRED','PRIVATE_CREDENTIALS_REQUIRED','V3_REQUIRED','ACTIVE_DEPLOYMENT_REQUIRED','OWNER_NOT_READY','ORACLE_NOT_READY','DATA_REQUIRED','EVENT_HISTORY_REQUIRED','ORACLE_JOB_PENDING']);
const fail=code=>{throw Error(code);};
async function settings(values){const file=new URL('../.env.local',import.meta.url),tmp=new URL('../.env.local.chartex-tmp',import.meta.url);let s=await readFile(file,'utf8');for(const [k,v]of Object.entries(values))s=s.replace(new RegExp('^'+k+'=.*\\n?','gm'),'').trimEnd()+'\n'+k+'='+v+'\n';await writeFile(tmp,s,{mode:0o600});await chmod(tmp,0o600);await rename(tmp,file);}
try{
 if(!['status','collect','authorize-oracle','activate'].includes(command)||process.argv.length>3)throw Error('USAGE');
 const config={...loadConfig(),chartexEnabled:true},admin=supabaseStore(config),data=createChartexStore(admin.client,config.contract);
 if(config.deployment.marketModelVersion!==3)fail('V3_REQUIRED');
 const schema=await admin.client.rpc('music_step7_status');if(schema.error||schema.data!==1)fail('SCHEMA_REQUIRED');
 const client=createPublicClient({transport:http(config.rpc,{timeout:10000,retryCount:0}),cacheTime:0}),chain=createArcChain(config,{client});await chain.verifyDeployment();
 const oracle=await client.readContract({address:config.contract,abi:DAILY_ABI,functionName:'oracle'}),owners=await chain.owners();
 if(command==='status'){
  const history=await data.publicHistory();console.log(JSON.stringify({song:history.song.title,credentialsConfigured:Boolean(config.chartexAppId&&config.chartexAppToken),schemaReady:true,oracleReady:sameAddress(oracle,chain.signer),ownerReady:sameAddress(owners.owner,chain.signer),lastSuccess:history.lastSuccess,nextRefresh:history.nextRefresh,availableDates:history.days.filter(d=>d.views!==null).length,enabled:loadConfig().chartexEnabled},null,2));
 }else{
  if(!config.chartexAppId||!config.chartexAppToken)fail('PRIVATE_CREDENTIALS_REQUIRED');
  await createChartexCollector({config,store:data,log:e=>console.log(JSON.stringify(e))}).tick();
  const history=await data.publicHistory();if(!history.lastSuccess||history.status!=='current'||!history.latestAvailable)fail('DATA_REQUIRED');
  if(command==='collect')console.log(JSON.stringify({savedDates:history.days.filter(d=>d.views!==null).length,lastSuccess:history.lastSuccess}));
  else{
   if(!sameAddress(owners.owner,chain.signer))fail('OWNER_NOT_READY');
   const registry=await admin.client.from('music_deployments').select('active,runtime_sha256').eq('contract_address',config.contract).single();if(registry.error||!registry.data.active||registry.data.runtime_sha256!==config.deployment.runtimeSha256)fail('ACTIVE_DEPLOYMENT_REQUIRED');
   if(command==='authorize-oracle'&&!sameAddress(oracle,chain.signer)){
    const job=await admin.operator('set-oracle',null,chain.signer,{oracle:chain.signer}),worker=createWorker({store:admin,chain});
    for(let i=0;i<15;i++){await worker.tick();const saved=await admin.client.from('music_admin_transactions').select('state,error_code').eq('id',job.id).single();if(saved.data?.state==='confirmed')break;if(i===14)fail('ORACLE_JOB_PENDING');await new Promise(r=>setTimeout(r,1000));}
   }
   const current=await client.readContract({address:config.contract,abi:DAILY_ABI,functionName:'oracle'});if(!sameAddress(current,chain.signer))fail('ORACLE_NOT_READY');
   if(command==='activate'){
    const events=await checkEventHistory(config,{database:admin.client,backfill:true});if(!events.consistent)fail('EVENT_HISTORY_REQUIRED');
    await settings({MUSIC_DATA_SOURCE:'chartex',MUSIC_ORACLE_ADDRESS:chain.signer,MUSIC_SETTLEMENT_ENABLED:'true',MUSIC_SCHEDULER_ENABLED:'true'});
    console.log('Chartex demo enabled locally. Restart npm run dev. Daily rounds and fixed metric policies are created by the local scheduler.');
   }else console.log('Backend oracle verified. Run npm run chartex -- activate to enable locally.');
  }
 }
}catch(e){console.error(allowed.has(e.message)?e.message:'Chartex setup stopped. Check private settings, database availability and the Arc Testnet connection.');process.exitCode=1;}
