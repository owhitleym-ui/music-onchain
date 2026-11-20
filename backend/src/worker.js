import { randomUUID } from 'node:crypto';
import { keccak256 } from 'viem';
import { AppError } from './errors.js';
import { ORIGINAL_OWNER, sameAddress } from './config.js';

export function createWorker({store,chain,log=()=>{},intervalMs=3000,now=Date.now}) {
  const id=randomUUID();
  let running=false,timer=null,stopped=false;
  let lastLog='';
  function note(code) {if(lastLog!==code){lastLog=code;log({event:'approval-worker',code});}}
  async function tick() {
    if(running||stopped)return;
    running=true;
    let job,fence,heartbeat,lost=false;
    const update=change=>store.update(job.id,id,fence,change);
    try {
      const claim=await store.claim(chain.signer,id);
      if(!claim)return;
      ({job,fence}=claim);
      heartbeat=setInterval(()=>void store.renew(chain.signer,id,fence).then(ok=>{if(!ok)lost=true;}).catch(()=>{lost=true;}),8000);
      heartbeat.unref?.();
      const lease=async()=>{if(lost||!await store.renew(chain.signer,id,fence))throw new AppError('LEASE_LOST');};
      if(job.transaction_hash) {
        if(keccak256(job.raw_transaction)!==job.transaction_hash)throw new AppError('NONCE_CONFLICT');
        await chain.validatePrepared(job);
        await chain.verifyDeployment();
        const receipt=await chain.receipt(job.transaction_hash);
        if(receipt) {
          if(receipt.status!=='success') {await update({state:'reverted',error_code:'TX_REVERTED',receipt_block:Number(receipt.blockNumber)});return;}
          let approved;
          if(job.kind==='approve'||job.kind==='revoke')approved=await chain.approved(job.wallet_address);
          else {
            const roles=await chain.owners();
            if(job.kind==='accept-owner'&&!sameAddress(roles.owner,chain.signer))throw new AppError('OWNER_NOT_READY');
            if(job.kind==='return-owner'&&!sameAddress(roles.pendingOwner,ORIGINAL_OWNER)&&!sameAddress(roles.owner,ORIGINAL_OWNER))throw new AppError('OWNER_NOT_READY');
          }
          await update({state:'confirmed',error_code:null,receipt_block:Number(receipt.blockNumber),...(approved===undefined?{}:{approved})});
          note('CONFIRMED');return;
        }
        const counts=await chain.nonces();
        if(counts.latest>Number(job.nonce)) {await update({state:'uncertain',error_code:'NONCE_CONFLICT'});note('NONCE_CONFLICT');return;}
        if(job.broadcast_at&&now()-Date.parse(job.broadcast_at)<15000)return;
        // A prepared transaction is the only transaction ever rebroadcast for this nonce.
        // Never replace it with a newly signed payload after an ambiguous response.
        await chain.authority(job);
        await lease();
        let hash;
        try {hash=await chain.broadcast(job.raw_transaction);}catch {
          if(!await chain.known(job.transaction_hash))throw new AppError('RPC_UNAVAILABLE');
          hash=job.transaction_hash;
        }
        if(hash.toLowerCase()!==job.transaction_hash)throw new AppError('NONCE_CONFLICT');
        await update({state:'submitted',error_code:null});note('SUBMITTED');return;
      }

      if(job.kind==='approve'&&job.nonce==null) {
        const approval=await store.approval(job.wallet_address);
        if(claim.paused||approval?.blocked) {await update({state:approval?.blocked?'cancelled':'blocked',error_code:approval?.blocked?'REVOKED':'OWNER_NOT_READY'});return;}
        const observed=await chain.inspect(job.wallet_address);
        if(!observed.approved&&(approval?.status==='approved'||(observed.revoked&&!approval?.reapproval_authorized))) {
          if(approval)await store.sync({userId:approval.privy_user_id,wallet:job.wallet_address},chain.signer,observed,false,20);
          await update({state:'cancelled',error_code:'REVOKED'});return;
        }
        if(observed.approved) {
          if(approval)await store.sync({userId:approval.privy_user_id,wallet:job.wallet_address},chain.signer,observed,false,20);
          await update({state:'cancelled',error_code:null});return;
        }
      }
      const quote=await chain.preflight(job);
      if(job.nonce==null) {
        const counts=await chain.nonces();
        job=await update({nonce:counts.pending,error_code:null});
      }
      await lease();
      const signed=await chain.sign(job,job.nonce,quote);
      await update({state:'prepared',raw_transaction:signed.raw,transaction_hash:signed.hash,error_code:null});
      // Broadcasting happens on the following tick, after this durable commit.
      note('PREPARED');
    } catch(error) {
      const code=error instanceof AppError?error.code:'RPC_UNAVAILABLE';
      if(job&&fence&&code!=='LEASE_LOST'&&code!=='DB_UNAVAILABLE') {
        try {await update({state:job.raw_transaction?'uncertain':'blocked',error_code:code});}catch{}
      }
      note(code);
    } finally {clearInterval(heartbeat);running=false;}
  }
  return {
    tick,
    start(){if(timer)return;stopped=false;timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();void tick();},
    stop(){stopped=true;clearInterval(timer);timer=null;},
    isRunning:()=>running,
  };
}
