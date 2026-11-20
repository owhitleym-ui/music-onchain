import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {createPublicClient,http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {loadConfig,address,sameAddress,CHAIN_ID,ORIGINAL_OWNER,sha256} from '../src/config.js';
import {supabaseStore} from '../src/store.js';
const strip=hex=>hex.slice(0,-4-parseInt(hex.slice(-4),16)*2);
export async function activateContract(target,transactionHash){
 try{
  if(!address(target)||!/^0x[0-9a-f]{64}$/i.test(transactionHash??''))throw Error('Use activate-contract ADDRESS DEPLOYMENT_TX_HASH.');
  const config=loadConfig(),signer=privateKeyToAccount(config.privateKey).address;
  const client=createPublicClient({transport:http(config.rpc,{retryCount:2,timeout:10000})});
  if(await client.getChainId()!==CHAIN_ID)throw Error('Select Arc Testnet.');
  const artifact=JSON.parse(await readFile(new URL('../../contracts/deployments/arc-testnet-atomic-artifact.json',import.meta.url),'utf8'));
  for(const [name,hash] of Object.entries(artifact.sourceSha256)){if(sha256(await readFile(new URL('../../contracts/'+name,import.meta.url)))!==hash)throw Error('The source differs from the reviewed artifact. Rebuild before activation.');}
  const receipt=await client.getTransactionReceipt({hash:transactionHash});
  if(receipt.status!=='success'||!sameAddress(receipt.contractAddress,target))throw Error('The deployment transaction does not match this address.');
  let template=artifact.deployedBytecode.object.replace(/^0x/,'');
  for(const refs of Object.values(artifact.deployedBytecode.immutableReferences??{}))for(const ref of refs){
    if(ref.length!==32)throw Error('Unexpected immutable layout.');
    const value=ORIGINAL_OWNER.slice(2).padStart(64,'0');template=template.slice(0,ref.start*2)+value+template.slice((ref.start+ref.length)*2);
  }
  const code=await client.getCode({address:target});
  if(!code||strip(code.slice(2))!==strip(template))throw Error('The deployed code does not match the reviewed atomic contract.');
  const read=(functionName,args=[])=>client.readContract({address:target,abi:artifact.abi,functionName,args});
  const roles=await Promise.all(['owner','oracle','platformRecipient'].map(name=>read(name)));
  if(!sameAddress(roles[0],signer)||!sameAddress(roles[1],ORIGINAL_OWNER)||!sameAddress(roles[2],ORIGINAL_OWNER))throw Error('Constructor roles do not match the agreed administrator setup.');
  const prices=await Promise.all(['SPOT_PRICE','FOUR_SPOT_PRICE','BUNDLE_PRICE'].map(name=>read(name)));
  if(prices.some((p,i)=>p!==[5n,20n,50n][i]*10n**18n)||await read('transferRate',[1n,4n])!==900000000000000000n)throw Error('Unexpected prices or reward curve.');
  const store=supabaseStore(config);
  const pending=await store.client.from('music_admin_transactions').select('id').eq('signer_address',signer.toLowerCase()).not('state','in','(confirmed,reverted,cancelled)').limit(1);
  if(pending.error||pending.data.length)throw Error('Finish outstanding administrator actions before switching contracts.');
  const schema=await store.client.from('music_purchase_orders').select('id').not('state','in','(confirmed,failed,cancelled,expired)').limit(1);
  if(schema.error)throw Error('Apply migration 002_atomic_payments.sql before activation.');
  if(schema.data.length)throw Error('Finish outstanding participant purchases before switching contracts.');
  const manifest={chainId:CHAIN_ID,address:target.toLowerCase(),atomicFour:true,creationBlock:Number(receipt.blockNumber),deploymentTransaction:transactionHash,runtimeSha256:sha256(Buffer.from(code.slice(2),'hex')),compiler:'0.8.28',optimizer:{enabled:true,runs:200},evmVersion:'cancun',viaIR:false,owner:signer.toLowerCase(),oracle:ORIGINAL_OWNER,platformRecipient:ORIGINAL_OWNER,verifiedAt:new Date().toISOString()};
  await writeFile(new URL('../../contracts/deployments/arc-testnet-atomic-live.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
  const envUrl=new URL('../.env.local',import.meta.url),temporary=new URL('../.env.local.atomic-tmp',import.meta.url);
  let env=await readFile(envUrl,'utf8');env=env.replace(/^MUSIC_PAYMENT_DEPLOYMENT=.*\n?/gm,'').trimEnd()+'\nMUSIC_PAYMENT_DEPLOYMENT=arc-testnet-atomic-live\n';
  await writeFile(temporary,env,{mode:0o600});await chmod(temporary,0o600);await rename(temporary,envUrl);
  console.log('Verified atomic contract: '+target+'\nConfiguration saved privately. Restart npm run dev, sign in for approval on the new contract, then run npm run admin -- create-round.');
 }catch(e){console.error(e.message?.startsWith('The ')||e.message?.startsWith('Use ')||e.message?.startsWith('Apply ')||e.message?.startsWith('Finish ')||e.message?.startsWith('Constructor ')||e.message?.startsWith('Unexpected ')?e.message:'Contract activation could not finish. Check the address, deployment transaction, database migration, and local settings.');process.exitCode=1;}
}
