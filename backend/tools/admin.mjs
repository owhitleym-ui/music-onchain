import { formatUnits,keccak256,toBytes,createPublicClient,http } from 'viem';
import { loadConfig,address,CONTRACT,ORIGINAL_OWNER } from '../src/config.js';
import { createArcChain } from '../src/chain.js';
import { supabaseStore } from '../src/store.js';

const [command='status',argument,transactionHash]=process.argv.slice(2);
if(command==='activate-contract'){const {activateContract}=await import('./activate-contract.mjs');await activateContract(argument,transactionHash);process.exit(process.exitCode??0);}
if(!['status','accept-ownership','revoke','reenable','return-ownership','create-round'].includes(command)) {
  console.error('Commands: status | accept-ownership | revoke ADDRESS | reenable ADDRESS | return-ownership | create-round | activate-contract ADDRESS DEPLOYMENT_TX');process.exit(1);
}
try {
  const config=loadConfig();
  if(!config.privateKey){console.log('Run npm run setup first.');process.exitCode=1;}
  else {
    const chain=createArcChain(config);
    await chain.verifyDeployment();
    if(command==='status') {
      const roles=await chain.owners();
      console.log(JSON.stringify({contract:config.contract,administrator:chain.signer,...roles,testTokenBalance:formatUnits(await chain.balance(),18),missingSettings:config.missing},null,2));
      if(config.supabaseUrl&&config.supabaseKey) {
        try {const row=await supabaseStore(config).signer(chain.signer);console.log('Approval database: reachable. Worker paused: '+Boolean(row?.paused));}
        catch{console.log('Approval database: unavailable or migration not applied.');process.exitCode=1;}
      }
    } else {
      if(config.missing.length)throw new Error('CONFIG_REQUIRED');
      const wallet=['revoke','reenable'].includes(command)?address(argument):null;
      if(['revoke','reenable'].includes(command)&&!wallet)throw new Error('BAD_REQUEST');
      const kind=command==='accept-ownership'?'accept-owner':command==='return-ownership'?'return-owner':command;
      const store=supabaseStore(config);
      let payload={};
      if(kind==='create-round'){
        if(!config.atomic)throw Error('Activate the new contract first.');
        const publicClient=createPublicClient({transport:http(config.rpc)});
        const block=await publicClient.getBlock();
        payload={songId:keccak256(toBytes('last-bus-home')),musicId:'demo:last-bus-home',artist:ORIGINAL_OWNER,start:Math.ceil((Number(block.timestamp)+120)/3600)*3600};
        console.log('Creating Last Bus Home test round at '+new Date(payload.start*1000).toISOString()+'.');
      }
      const job=await store.operator(kind,wallet,chain.signer,payload);
      console.log('Queued administrator action: '+command+'. Request: '+job.id);
      console.log('The local backend must be running; it submits this through the shared transaction worker.');
      const deadline=Date.now()+60000;
      let complete=false;
      while(Date.now()<deadline) {
        const current=await store.job(job.id);
        if(current?.state==='confirmed') {
          complete=true;console.log('Confirmed. Transaction: '+current.transaction_hash);
          if(kind==='return-owner')console.log('Now use the original MetaMask account '+ORIGINAL_OWNER+' to call acceptOwnership in Remix. Automatic approvals are paused.');
          break;
        }
        if(['blocked','reverted','uncertain','cancelled'].includes(current?.state)) {console.log('Action needs attention. Status: '+current.state+'. Code: '+(current.error_code??'NONE'));process.exitCode=1;complete=true;break;}
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      if(!complete)console.log('Still pending. The saved request will be reconciled by the backend; do not create a replacement wallet or transaction.');
    }
  }
} catch {console.error('Administrator command could not finish. Check local settings, database migration, funding and ownership using npm run admin -- status. No private settings were printed.');process.exitCode=1;}
