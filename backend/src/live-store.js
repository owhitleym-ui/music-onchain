import {AppError} from './errors.js';

export function createLiveStore(client,contract,{step6=false,verifyClaims=step6,modelVersion=1}={}) {
  async function read(name,args) {
    let result;
    try { result=await client.rpc((name==='catalog'&&modelVersion>=2?'music_market_catalog':'music_live_'+name),{p_contract:contract,...args}); }
    catch { throw new AppError('LIVE_DATA_UNAVAILABLE'); }
    if(result.error||!result.data)throw new AppError('LIVE_DATA_UNAVAILABLE');
    return result.data;
  }
  return {
    ...(step6?{
      evidence:async hash=>{const r=await client.from('music_result_evidence').select('document').eq('contract_address',contract).eq('evidence_hash',hash).maybeSingle();if(r.error)throw new AppError('LIVE_DATA_UNAVAILABLE');return r.data?.document??null;},

    }:{}),
    ...(verifyClaims?{
      claimRecords:async ids=>{if(!ids.length)return [];if(!step6){const r=await client.from('music_chain_events').select('args,transaction_hash,block_number,block_hash').eq('contract_address',contract).eq('event_name','EntryClaimed').in('args->>entryId',ids);if(r.error)throw new AppError('LIVE_DATA_UNAVAILABLE');return r.data.map(e=>({entryId:e.args.entryId,amount:e.args.amount,refund:e.args.refund,recipient:e.args.recipient,transactionHash:e.transaction_hash,block:String(e.block_number),blockHash:e.block_hash}));}const rows=await client.rpc('music_claim_records',{p_contract:contract,p_entries:ids});if(rows.error)throw new AppError('LIVE_DATA_UNAVAILABLE');const saved=await client.from('music_purchase_orders').select('result').eq('contract_address',contract).eq('action_kind','claim_entry').eq('state','confirmed').in('request->>entryId',ids);if(saved.error)throw new AppError('LIVE_DATA_UNAVAILABLE');const records=[...rows.data];for(const row of saved.data){if(row.result&&!records.some(r=>r.entryId===row.result.entryId))records.push(row.result);}return records;},
    }:{}),
    schedule:async(round,type,block)=>{const r=await client.rpc('music_market_schedule',{p_contract:contract,p_round:round,p_type:type,p_block:String(block)});if(r.error)throw new AppError('LIVE_DATA_UNAVAILABLE');return r.data;},
    catalog:block=>read('catalog',{p_block:String(block)}),
    round:(block,pools)=>read('round',{p_block:String(block),p_pools:pools}),
    entries:(wallet,block,cursor)=>read('account_entries',{p_wallet:wallet,p_block:String(block),p_cursor:cursor,p_limit:10}),
  };
}
