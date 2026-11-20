import { CONTRACT } from './config.js';
import { createClient } from '@supabase/supabase-js';
import { AppError } from './errors.js';

const known = new Set(['RATE_LIMITED','ACCOUNT_UNAVAILABLE','OWNER_NOT_READY','BAD_REQUEST','NONCE_CONFLICT','LEASE_LOST']);
export function databaseError(error) {
  const code = [...known].find(value => error?.message?.includes(value));
  return new AppError(code ?? 'DB_UNAVAILABLE', code === 'RATE_LIMITED' ? 429 : code === 'ACCOUNT_UNAVAILABLE' ? 403 : 503);
}

export function createStore(client, {contract=CONTRACT, atomic=false}={}) {
  const scope=atomic?{p_contract:contract}:{};
  const name=value=>atomic?'music_v2_'+value:'music_'+value;
  async function rpc(name, params) {
    let result;
    try { result = await client.rpc(name, params); } catch { throw new AppError('DB_UNAVAILABLE'); }
    if (result.error) throw databaseError(result.error);
    return result.data;
  }
  async function row(table, field, value, scoped=false) {
    let result;
    try { let q=client.from(table).select('*').eq(field,value); if(scoped)q=q.eq('contract_address',contract); result=await q.maybeSingle(); } catch { throw new AppError('DB_UNAVAILABLE'); }
    if (result.error) throw databaseError(result.error);
    return result.data;
  }
  return {
    client,
    async pendingSettlement(signer){const r=await client.from('music_admin_transactions').select('id').eq('signer_address',signer).in('kind',['submit-result','submit-order','advance-settlement','restart-order','cancel-pool']).or('state.in.(queued,prepared,submitted,uncertain),and(state.eq.blocked,nonce.not.is.null)').limit(1);if(r.error)throw new AppError('DB_UNAVAILABLE');return r.data.length>0;},
    approval: wallet => row('music_account_approvals','wallet_address',wallet,true),
    job: id => row('music_admin_transactions','id',id),
    signer: wallet => row('music_admin_signers','signer_address',wallet),
    sync: (identity, signer, observed, enqueue, limit) => rpc(name('sync_approval'), {
      ...scope,p_user:identity.userId,p_wallet:identity.wallet,p_signer:signer,
      p_approved:observed.approved,p_revoked:observed.revoked,p_enqueue:enqueue,p_limit:limit,
    }),
    operator: (kind, wallet, signer, payload={}) => rpc(name('operator_job'),{ ...scope,...(atomic?{p_payload:payload}:{}),p_kind:kind,p_wallet:wallet,p_signer:signer }),
    claim: (signer, worker) => rpc(name('claim_job'),{ ...scope,p_signer:signer,p_worker:worker }),
    renew: (signer, worker, fence) => rpc(name('renew_lease'),{ p_signer:signer,p_worker:worker,p_fence:fence }),
    update: (job, worker, fence, change) => rpc(name('update_job'),{ p_job:job,p_worker:worker,p_fence:fence,p_change:change }),
  };
}

export function supabaseStore(config) {
  return createStore(createClient(config.supabaseUrl,config.supabaseKey,{
    auth:{ persistSession:false,autoRefreshToken:false,detectSessionInUrl:false },
    global:{ fetch:(url,options={}) => fetch(url,{ ...options,signal:AbortSignal.timeout(10000) }) },
  }),{contract:config.contract,atomic:config.atomic});
}
