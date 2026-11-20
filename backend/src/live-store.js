import {AppError} from './errors.js';

export function createLiveStore(client,contract) {
  async function read(name,args) {
    let result;
    try { result=await client.rpc('music_live_'+name,{p_contract:contract,...args}); }
    catch { throw new AppError('LIVE_DATA_UNAVAILABLE'); }
    if(result.error||!result.data)throw new AppError('LIVE_DATA_UNAVAILABLE');
    return result.data;
  }
  return {
    catalog:block=>read('catalog',{p_block:String(block)}),
    round:(block,pools)=>read('round',{p_block:String(block),p_pools:pools}),
    entries:(wallet,block,cursor)=>read('account_entries',{p_wallet:wallet,p_block:String(block),p_cursor:cursor,p_limit:10}),
  };
}
