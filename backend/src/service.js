import { AppError, publicError } from './errors.js';

export function createApprovalService({store,chain,hourlyLimit=20}) {
  return async (identity, enqueue=false) => {
    const previous=await store.approval(identity.wallet);
    let observed;
    try {observed=await chain.inspect(identity.wallet);}catch(error){throw error instanceof AppError?error:new AppError('RPC_UNAVAILABLE');}
    if (previous?.confirmed_block && observed.block<Number(previous.confirmed_block)) throw new AppError('RPC_UNAVAILABLE');
    const {approval,transaction}=await store.sync(identity,chain.signer,observed,enqueue,hourlyLimit);
    if (approval.status==='revoked') return {status:'revoked',walletAddress:identity.wallet,message:'Account activation has been disabled. Please contact the organizer.'};
    if (observed.approved && approval.status==='approved') return {status:'approved',walletAddress:identity.wallet};
    if (transaction && ['blocked','reverted','uncertain'].includes(transaction.state)) return {...publicError(new AppError(transaction.error_code ?? 'TX_REVERTED')),walletAddress:identity.wallet};
    return {status:'pending',walletAddress:identity.wallet,retryAfterMs:2000};
  };
}
