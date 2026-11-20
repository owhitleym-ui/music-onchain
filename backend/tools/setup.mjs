import { existsSync,readFileSync,writeFileSync,renameSync,chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';

console.log('Starting private account setup…');
const [{generatePrivateKey,privateKeyToAccount},{APP_ID}] = await Promise.all([
  import('viem/accounts'), import('../src/config.js'),
]);

async function main() {

const path=fileURLToPath(new URL('../.env.local',import.meta.url));
const values={PRIVY_APP_ID:APP_ID,PRIVY_APP_SECRET:'',SUPABASE_URL:'https://dnobgwmuvdqhnraagvnq.supabase.co',SUPABASE_SECRET_KEY:'',ARC_RPC_URL:'https://rpc.testnet.arc.io',ADMIN_PRIVATE_KEY:'',APPROVAL_HOURLY_LIMIT:'20',MUSIC_PAYMENT_DEPLOYMENT:''};
if(existsSync(path))for(const line of readFileSync(path,'utf8').split('\n')) {
  const match=/^([A-Z_]+)=(.*)$/.exec(line);
  if(match&&Object.hasOwn(values,match[1])) {
    try {values[match[1]]=match[2].startsWith('"')?JSON.parse(match[2]):match[2];}catch{console.error('Existing local configuration could not be read. It was not overwritten.');process.exit(1);}
  }
}
if(!values.ADMIN_PRIVATE_KEY)values.ADMIN_PRIVATE_KEY=generatePrivateKey();
let account;try{account=privateKeyToAccount(values.ADMIN_PRIVATE_KEY);}catch{console.error('The existing administrator key is invalid. It was not replaced.');process.exit(1);}
const urlIndex=process.argv.indexOf('--url');
if(urlIndex!==-1)values.SUPABASE_URL=process.argv[urlIndex+1]??'';
if(!process.argv.includes('--init')) {
  if(!process.stdin.isTTY||!process.stdout.isTTY){console.error('Run npm run setup directly in your Terminal to enter keys privately. Use -- --init only to create the administrator and an empty configuration.');process.exit(1);}
  let muted=false;
  const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
  Object.defineProperty(output,'columns',{get:()=>process.stdout.columns??80});
  const rl=createInterface({input:process.stdin,output,terminal:true});
  const cancelled=new AbortController();
  rl.on('SIGINT',()=>cancelled.abort());
  async function ask(label,key,secret=false) {
    // Put labels on their own line: readline can redraw its input line without
    // erasing the question, even in Terminal with a custom hidden-input stream.
    process.stdout.write('\n'+label+(values[key]?' [Enter keeps existing value]':'')+'\n');
    if(!secret&&values[key])process.stdout.write('Saved value: '+values[key]+'\n');
    const question=rl.question('> ',{signal:cancelled.signal});
    muted=secret;
    const reply=await question;
    muted=false;
    if(secret)process.stdout.write('\n');
    if(reply.trim())values[key]=reply.trim();
  }
  try {
    await ask('Supabase Project URL','SUPABASE_URL');
    await ask('Supabase server secret key (hidden)','SUPABASE_SECRET_KEY',true);
    await ask('Privy read-only App Secret (hidden)','PRIVY_APP_SECRET',true);
  } catch(error) {
    if(cancelled.signal.aborted||error?.code==='ABORT_ERR') {
      muted=false;
      console.log('\nSetup cancelled. Saved settings are unchanged.');
      process.exitCode=130;
      return;
    }
    throw error;
  } finally {muted=false;rl.close();}
}
if(values.SUPABASE_URL&&!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(values.SUPABASE_URL)) {console.error('Use the Project URL https://your-project.supabase.co. Configuration was not overwritten.');process.exit(1);}
values.PRIVY_APP_ID=APP_ID;
const contents='# Server-only configuration. Never copy this file into frontend/ or share it.\n'+Object.entries(values).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n';
writeFileSync(path+'.pending',contents,{mode:0o600});chmodSync(path+'.pending',0o600);renameSync(path+'.pending',path);chmodSync(path,0o600);
console.log('Local configuration saved with owner-only file permissions.');
console.log('Dedicated TEST administrator public address: '+account.address);
console.log('Keep the local configuration file private and backed up. The original MetaMask key was not used.');
console.log('No transaction was sent and contract ownership has not changed.');
}

try {await main();}catch {
  console.error('Setup could not finish. Your private values were not printed. Please restart npm run setup.');
  process.exitCode=1;
}
