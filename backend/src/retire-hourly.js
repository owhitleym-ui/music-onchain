import {AppError} from './errors.js';

// Preview by default. Cancellation never changes stored prices, guesses, or payment history.
export async function retireHourly({chain,admin,signer,execute=false}) {
 await chain.verify();
 const rounds=(await chain.rounds()).filter(r=>r.cadence==='hourly');
 const snapshot=await chain.snapshot(),pools=[];
 for(const round of rounds)for(const horizon of ['next_hour','hour_plus_24']){
  const pool=await chain.readPool(round.id,horizon,snapshot.number);
  if(pool.phase>=4)continue;
  pools.push({roundId:round.id,horizon,entryCount:pool.entryCount.toString(),totalDeposits:pool.totalDeposits.toString()});
 }
 if(execute){
  if(!admin||!signer)throw new AppError('BAD_REQUEST');
  for(const p of pools){
   const job=await admin.operator('cancel-pool',null,signer,{roundId:p.roundId,horizon:p.horizon,reason:'Retiring hourly test markets for daily V3. Full entry refunds.'});
   p.jobId=job.id;
  }
 }
 return {contract:chain.target??null,throughBlock:snapshot.number.toString(),execute,pools};
}
