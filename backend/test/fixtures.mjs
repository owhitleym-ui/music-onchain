import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { keccak256 } from 'viem';
import { createStore } from '../src/store.js';
import { APP_ID, CONTRACT, CHAIN_ID, ORIGINAL_OWNER } from '../src/config.js';
import { AppError } from '../src/errors.js';

export const S='0x'+'1'.repeat(40),A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
export const identity=(wallet=A,userId='did:privy:fan-a')=>({appId:APP_ID,userId,wallet});
export const migration=()=>readFile(new URL('../supabase/001_account_approvals.sql',import.meta.url),'utf8');
export async function database() {
  const db=new PGlite();await db.waitReady;
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec('create table public.team_existing_table (value text); insert into public.team_existing_table values (\'keep me\');');
  await db.exec(await migration());
  const signatures={
    music_sync_approval:['p_user','p_wallet','p_signer','p_approved','p_revoked','p_enqueue','p_limit'],
    music_operator_job:['p_kind','p_wallet','p_signer'],music_claim_job:['p_signer','p_worker'],
    music_renew_lease:['p_signer','p_worker','p_fence'],music_update_job:['p_job','p_worker','p_fence','p_change'],
  };
  const client={
    async rpc(name,params) {
      try {
        const keys=signatures[name];if(!keys)throw Error('Unknown function');
        const values=keys.map(k=>typeof params[k]==='object'&&params[k]!==null?JSON.stringify(params[k]):params[k]);
        const result=await db.query('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') as value',values);
        return {data:result.rows[0].value,error:null};
      } catch(error){return {data:null,error:{message:error.message}};}
    },
    from(table) {
      if(!['music_account_approvals','music_admin_transactions','music_admin_signers'].includes(table))throw Error('Unexpected table');
      return {select:()=>{
        const filters=[];
        const query={eq(field,value){if(!['id','wallet_address','signer_address','contract_address'].includes(field))throw Error('Unexpected field');filters.push([field,value]);return query;},
          async maybeSingle(){try{const r=await db.query('select * from public.'+table+' where '+filters.map(([f],i)=>f+'=$'+(i+1)).join(' and '),filters.map(([,v])=>v));return {data:r.rows[0]??null,error:null};}catch(error){return {error:{message:error.message}};}}};
        return query;
      }};
    },
  };
  const store=createStore(client);
  return {db,client,store,
    async reset(){await db.exec('truncate public.music_admin_transactions,public.music_account_approvals,public.music_admin_signers cascade;');},
    async expireLease(){await db.exec("update public.music_admin_signers set lease_until=clock_timestamp()-interval '1 second';");},
    async rows(table='music_admin_transactions'){return (await db.query('select * from public.'+table+' order by created_at,id')).rows;},
  };
}

export function fakeChain() {
  const chain={signer:S,owner:S,pendingOwner:'0x'+'0'.repeat(40),balanceValue:10n**20n,
    approvedSet:new Set(),revokedSet:new Set(),sent:[],signed:new Map(),receipts:new Map(),latest:0,pending:0,autoMine:true,
    async verifyDeployment(){},async owners(){return {owner:chain.owner,pendingOwner:chain.pendingOwner};},
    async validatePrepared(){},
    async balance(){return chain.balanceValue;},
    async inspect(wallet){return {approved:chain.approvedSet.has(wallet),revoked:chain.revokedSet.has(wallet),block:100};},
    async approved(wallet){return chain.approvedSet.has(wallet);},
    async nonces(){return {latest:chain.latest,pending:chain.pending};},
    async authority(job){if(job.kind==='accept-owner'?chain.pendingOwner!==S:chain.owner!==S)throw new AppError('OWNER_NOT_READY');},
    async preflight(job){await chain.authority(job);if(chain.balanceValue<1n)throw new AppError('NO_GAS');return {gas:100000n,gasPrice:20000000000n,data:'0x1234'};},
    async sign(job,nonce){const raw='0x'+Buffer.from(JSON.stringify({id:job.id,nonce,kind:job.kind,wallet:job.wallet_address})).toString('hex');const hash=keccak256(raw);chain.signed.set(raw,{job,nonce,hash});return {raw,hash};},
    async known(hash){return chain.sent.some(raw=>keccak256(raw)===hash);},
    async receipt(hash){return chain.receipts.get(hash)??null;},
    async broadcast(raw){chain.sent.push(raw);const {nonce,hash}=chain.signed.get(raw)??{nonce:JSON.parse(Buffer.from(raw.slice(2),'hex')).nonce,hash:keccak256(raw)};chain.pending=Math.max(chain.pending,Number(nonce)+1);if(chain.autoMine)chain.mine(raw);return hash;},
    mine(raw,success=true){const data=JSON.parse(Buffer.from(raw.slice(2),'hex'));const hash=keccak256(raw);chain.latest=Math.max(chain.latest,Number(data.nonce)+1);chain.pending=Math.max(chain.pending,chain.latest);
      chain.receipts.set(hash,{status:success?'success':'reverted',blockNumber:100n});
      if(success){if(data.kind==='approve')chain.approvedSet.add(data.wallet);if(data.kind==='revoke'){chain.approvedSet.delete(data.wallet);chain.revokedSet.add(data.wallet);}if(data.kind==='accept-owner'){chain.owner=S;chain.pendingOwner='0x'+'0'.repeat(40);}if(data.kind==='return-owner')chain.pendingOwner=ORIGINAL_OWNER;}
    },
  };
  return chain;
}
export const jobFields=(extra={})=>({id:'test-job',kind:'approve',wallet_address:A,chain_id:CHAIN_ID,contract_address:CONTRACT,signer_address:S,...extra});
