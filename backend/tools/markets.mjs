import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {createPublicClient,http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {loadConfig,address,sameAddress,sha256,ORIGINAL_OWNER,CHAIN_ID} from '../src/config.js';
import {supabaseStore} from '../src/store.js';
import {checkEventHistory} from '../src/event-history.js';
const [command,target,txHash,...extra]=process.argv.slice(2);
const file=new URL('../../contracts/deployments/arc-testnet-markets-v3-live.json',import.meta.url);
const strip=hex=>hex.slice(0,-4-parseInt(hex.slice(-4),16)*2);
async function privateSettings(values){
 const url=new URL('../.env.local',import.meta.url),tmp=new URL('../.env.local.markets-tmp',import.meta.url);let env=await readFile(url,'utf8');
 for(const [key,value] of Object.entries(values))env=env.replace(new RegExp('^'+key+'=.*\\n?','gm'),'').trimEnd()+'\n'+key+'='+value+'\n';
 await writeFile(tmp,env,{mode:0o600});await chmod(tmp,0o600);await rename(tmp,url);
}
try{
 if(!['register','activate','scheduler-on','scheduler-off'].includes(command)||extra.length)throw Error('Use: npm run markets -- register ADDRESS DEPLOYMENT_TX | activate ADDRESS DEPLOYMENT_TX | scheduler-on | scheduler-off');
 const config=loadConfig(),admin=supabaseStore(config),signer=privateKeyToAccount(config.privateKey).address.toLowerCase();
 const schema=command==='scheduler-off'?null:await admin.client.rpc('music_market_schema_status');if(schema&&(schema.error||schema.data!==3))throw Error('Apply 007_daily_markets.sql first.');
 if(command==='scheduler-off'){
  await privateSettings({MUSIC_SCHEDULER_ENABLED:'false'});console.log('Market scheduling disabled. Restart the backend.');
 }else if(command==='scheduler-on'){
  if(target||txHash||config.deployment.marketModelVersion!==3)throw Error('Activate the verified V3 deployment first.');
  const r=await admin.client.from('music_deployments').select('active').eq('contract_address',config.contract).single();if(r.error||!r.data.active)throw Error('V3 is not the registered active deployment.');
  await privateSettings({MUSIC_SCHEDULER_ENABLED:'true'});console.log('Local scheduler enabled. Restart npm run dev. It runs only while this computer and backend are on.');
 }else{
  if(!address(target)||!/^0x[0-9a-f]{64}$/i.test(txHash??''))throw Error('Supply the new address and its deployment transaction.');
  const artifact=JSON.parse(await readFile(new URL('../../contracts/deployments/arc-testnet-markets-v3-artifact.json',import.meta.url),'utf8'));
  for(const [name,hash] of Object.entries(artifact.sourceSha256))if(sha256(await readFile(new URL('../../contracts/'+name,import.meta.url)))!==hash)throw Error('Rebuild the reviewed artifact; source changed.');
  const client=createPublicClient({transport:http(config.rpc,{timeout:10000,retryCount:1}),cacheTime:0});if(await client.getChainId()!==CHAIN_ID)throw Error('Select Arc Testnet.');
  const receipt=await client.getTransactionReceipt({hash:txHash});if(receipt.status!=='success'||!sameAddress(receipt.contractAddress,target))throw Error('Deployment receipt does not match this address.');
  let template=artifact.deployedBytecode.object.replace(/^0x/,'');for(const refs of Object.values(artifact.deployedBytecode.immutableReferences??{}))for(const r of refs){if(r.length!==32)throw Error('Unexpected immutable layout.');template=template.slice(0,r.start*2)+ORIGINAL_OWNER.slice(2).padStart(64,'0')+template.slice((r.start+r.length)*2);}
  const code=await client.getCode({address:target});if(!code||strip(code.slice(2))!==strip(template))throw Error('Deployed runtime differs from the reviewed V3 artifact.');
  const read=(functionName,args=[])=>client.readContract({address:target,abi:artifact.abi,functionName,args});
  const roles=await Promise.all(['owner','oracle','platformRecipient'].map(n=>read(n)));if(!sameAddress(roles[0],signer)||!sameAddress(roles[1],ORIGINAL_OWNER)||!sameAddress(roles[2],ORIGINAL_OWNER))throw Error('Constructor roles do not match.');
  const prices=await Promise.all(['SPOT_PRICE','FOUR_SPOT_PRICE','BUNDLE_PRICE'].map(n=>read(n)));if(prices.some((n,i)=>n!==[5n,20n,50n][i]*10n**18n)||await read('MARKET_MODEL_VERSION')!==3n||await read('transferRate',[1n,4n])!==900000000000000000n||await read('ARTIST_FEE_BPS')!==500n||await read('APP_FEE_BPS')!==100n)throw Error('Unexpected market model, prices or curve.');
  const manifest={deploymentId:'markets-v3',marketModelVersion:3,chainId:CHAIN_ID,address:target.toLowerCase(),atomicFour:true,creationBlock:Number(receipt.blockNumber),deploymentTransaction:txHash,runtimeSha256:sha256(Buffer.from(code.slice(2),'hex')),compiler:'0.8.28',optimizer:{enabled:true,runs:200},evmVersion:'cancun',viaIR:false,owner:signer,oracle:ORIGINAL_OWNER,platformRecipient:ORIGINAL_OWNER,initialExcluded:[signer],verifiedAt:new Date().toISOString()};
  const v3={...config,atomic:true,contract:manifest.address,deployment:manifest};
  if(command==='activate'){
   const saved=JSON.parse(await readFile(file,'utf8'));if(saved.address!==manifest.address||saved.runtimeSha256!==manifest.runtimeSha256)throw Error('Register this exact deployment first.');
   const history=await checkEventHistory(v3,{database:admin.client});if(!history.consistent)throw Error('Complete V3 event backfill and reconciliation first.');
   if(await read('freeBonusReserve')<2500000000000000000n)throw Error('Manually fund at least 2.50 test USDC into the new bonus reserve first.');
  }
  const r=await admin.client.rpc('music_register_market_deployment',{p_id:'markets-v3',p_address:manifest.address,p_block:manifest.creationBlock,p_hash:manifest.runtimeSha256,p_manifest:manifest,p_activate:command==='activate'});if(r.error)throw Error('Registry refused the change. Reconcile old unsigned quotes, signed participant actions and administrator jobs before activation.');
  await writeFile(file,JSON.stringify(manifest,null,2)+'\n');
  if(command==='activate'){await privateSettings({MUSIC_PAYMENT_DEPLOYMENT:'arc-testnet-markets-v3-live',MUSIC_SCHEDULER_ENABLED:'false',MUSIC_SETTLEMENT_ENABLED:'false'});console.log('Verified V3 activated. Restart the app, sign in for new approvals, then enable the local scheduler with npm run markets -- scheduler-on.');}
  else console.log('Verified V3 registered without changing the active deployment. Update the signed event receiver/filter, then run npm run events -- backfill markets-v3.');
 }
}catch(e){const known=new Set(["Use: npm run markets -- register ADDRESS DEPLOYMENT_TX | activate ADDRESS DEPLOYMENT_TX | scheduler-on | scheduler-off", "Apply 007_daily_markets.sql first.", "Activate the verified V3 deployment first.", "V3 is not the registered active deployment.", "Supply the new address and its deployment transaction.", "Rebuild the reviewed artifact; source changed.", "Select Arc Testnet.", "Deployment receipt does not match this address.", "Unexpected immutable layout.", "Deployed runtime differs from the reviewed V3 artifact.", "Constructor roles do not match.", "Unexpected market model, prices or curve.", "Register this exact deployment first.", "Complete V3 event backfill and reconciliation first.", "Manually fund at least 2.50 test USDC into the new bonus reserve first.", "Registry refused the change. Reconcile old unsigned quotes, signed participant actions and administrator jobs before activation."]);console.error(known.has(e.message)?e.message:'Market setup stopped. Check the public deployment details, database migration and local settings.');process.exitCode=1;}
