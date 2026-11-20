import {createHash,randomUUID} from 'node:crypto';
import {DEMO_SONG} from '../../shared/demo-song.js';
import {austinDate,addCalendarDays,MARKET_TYPES,HOUR} from '../../shared/market-schedule.js';
import {resultPolicy,roundSong,samePolicy} from './song-policy.js';
import {AppError} from './errors.js';
import {canonicalEvidence} from './settlement.js';
import {keccak256,toBytes} from 'viem';

export const SIX_HOURS=6*HOUR;
export const responseHash=raw=>createHash('sha256').update(raw).digest('hex');
export const count=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
export const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const fail=code=>{throw new AppError(code);};
export function parseDaily(raw,start,end){
 let body;try{body=JSON.parse(raw);}catch{fail('CHARTEX_INVALID_DATA');}
 if(body?.data?.song_name?.toLowerCase()!==DEMO_SONG.title.toLowerCase()||!Array.isArray(body.data.statistics)||body.data.statistics.length>31)fail('CHARTEX_INVALID_DATA');
 const seen=new Set(),rows=[];
 for(const row of body.data.statistics){
  if(!row||!validDate(row.date)||row.date<start||row.date>end||seen.has(row.date))fail('CHARTEX_INVALID_DATA');seen.add(row.date);
  rows.push({date:row.date,views:count(row[DEMO_SONG.metric]),metrics:row});
 }
 for(let date=start;date<=end;date=addCalendarDays(date,1))if(!seen.has(date))rows.push({date,views:null,metrics:{}});
 rows.sort((a,b)=>a.date.localeCompare(b.date));
 return {body,rows};
}
export function createChartexClient(config,{fetcher=fetch,clock=Date.now}={}){
 async function get(route){
  if(!config.chartexAppId||!config.chartexAppToken)fail('CHARTEX_CREDENTIALS_REQUIRED');
  let r;try{r=await fetcher('https://api.chartex.com/external/v1/'+route,{headers:{'X-APP-ID':config.chartexAppId,'X-APP-TOKEN':config.chartexAppToken,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('CHARTEX_UNAVAILABLE');}
  if(!r.ok)fail(r.status===401||r.status===403?'CHARTEX_ACCESS_REQUIRED':r.status===429?'CHARTEX_RATE_LIMITED':'CHARTEX_UNAVAILABLE');
  const raw=await r.text();if(raw.length>2000000||[config.chartexAppId,config.chartexAppToken].some(secret=>secret&&raw.includes(secret)))fail('CHARTEX_INVALID_DATA');
  return {raw,hash:responseHash(raw),fetchedAt:new Date(clock()).toISOString(),route};
 }
 return {
  async history(start,end){const response=await get(`songs/${DEMO_SONG.spotifyId}/spotify/stats/all/?mode=daily&start_date=${start}&end_date=${end}`);return {...response,...parseDaily(response.raw,start,end),start,end};},
  async metadata(){const r=await get(`songs/?sort_platform=tiktok&sort_column=all_time&search=Tennessee%20Orange&limit=100`);let body;try{body=JSON.parse(r.raw);}catch{fail('CHARTEX_INVALID_DATA');}const song=body?.data?.items?.find(s=>s.spotify_id===DEMO_SONG.spotifyId&&s.artists==='Megan Moroney');if(!song)fail('CHARTEX_INVALID_DATA');return {...r,song};},
 };
}
export function createChartexStore(client,contract){
 async function query(q){const r=await q;if(r.error)fail('CHARTEX_DATABASE_UNAVAILABLE');return r.data;}
 const state=()=>query(client.from('music_data_state').select('*').eq('song_id',DEMO_SONG.id).maybeSingle());
 return {
  state,
  claim:worker=>query(client.rpc('music_data_claim',{p_song:DEMO_SONG.id,p_worker:worker})),
  finish:(worker,result,error=null)=>query(client.rpc('music_data_finish',{p_song:DEMO_SONG.id,p_worker:worker,p_result:result,p_error:error})),
  metadata:()=>query(client.from('music_song_metadata').select('document').eq('song_id',DEMO_SONG.id).maybeSingle()),
  async saveMetadata(result){await query(client.from('music_song_metadata').upsert({song_id:DEMO_SONG.id,document:result.song,raw_response:result.raw,response_hash:result.hash,fetched_at:result.fetchedAt}));},
  observations:(date,since)=>query(client.from('music_daily_observations').select('views,metrics,observed_at,response_hash,collection_id').eq('song_id',DEMO_SONG.id).eq('report_date',date).gte('observed_at',new Date(since).toISOString()).order('observed_at',{ascending:false}).limit(100)),
  async bind(row){for(const t of MARKET_TYPES){const policy=resultPolicy(row,t.id);await query(client.rpc('music_bind_result_policy',{p_contract:contract,p_round:row.id,p_type:t.id,p_policy:policy}));}},
  async policy(round,type){return (await query(client.from('music_round_rules').select('policy').eq('contract_address',contract).eq('round_id',round).eq('market_type',type).maybeSingle()))?.policy??null;},
  async candidate(round,type){return query(client.from('music_result_candidates').select('evidence_hash,document').eq('contract_address',contract).eq('round_id',round).eq('market_type',type).maybeSingle());},
  async freeze(round,type,hash,document){return query(client.rpc('music_freeze_result',{p_contract:contract,p_round:round,p_type:type,p_hash:hash,p_document:document}));},
  async assertPolicy(row,type){if(row.songId!==DEMO_SONG.id||!samePolicy(await this.policy(row.id,type),resultPolicy({...row,songId:undefined},type)))fail('RESULT_POLICY_UNAVAILABLE');return this.policy(row.id,type);},
  async publicHistory(now=Date.now()){
   const end=addCalendarDays(austinDate(now),-1),start=addCalendarDays(end,-29);
   const [status,meta,collections]=await Promise.all([state(),this.metadata(),query(client.from('music_data_collections').select('id,fetched_at').eq('song_id',DEMO_SONG.id).order('fetched_at',{ascending:false}).limit(1))]);
   const latest=collections?.[0];let observations=[];
   if(latest)observations=await query(client.from('music_daily_observations').select('report_date,views,metrics').eq('collection_id',latest.id).gte('report_date',start).lte('report_date',end).order('report_date'));
   const byDate=new Map(observations.map(r=>[r.report_date,r]));
   const days=Array.from({length:30},(_,i)=>{const date=addCalendarDays(start,i),row=byDate.get(date);return {date,views:row?.views==null?null:String(row.views),metrics:row?.metrics??null};});
   return {song:DEMO_SONG,metadata:meta?.document??null,source:'chartex',metric:DEMO_SONG.metric,reportingTimeZone:'provider-defined',startDate:start,endDate:end,days,lastSuccess:status?.last_success??null,nextRefresh:status?.next_attempt??null,status:!latest?'unavailable':status?.error_code||now-Date.parse(status?.last_success??0)>7*HOUR?'stale':'current',errorCode:status?.error_code??null,latestAvailable:days.filter(d=>d.views!==null).at(-1)??null};
  },
 };
}
export function stableObservation(rows,eligibleAt){
 const ordered=rows.filter(r=>Date.parse(r.observed_at)>=eligibleAt).sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at));
 const latest=ordered[0];if(!latest||latest.views==null||!/^\d+$/.test(String(latest.views)))return null;
 // Every intervening observation must agree; a revision restarts stability.
 for(const row of ordered.slice(1)){
  if(row.views==null||String(row.views)!==String(latest.views))return null;
  if(Date.parse(latest.observed_at)-Date.parse(row.observed_at)>=SIX_HOURS)return [row,latest];
 }
 return null;
}
export function createResultValidator({config,chain,data,evidence}){
 return async job=>{
  const saved=await evidence.evidence(job.payload.evidenceHash),d=canonicalEvidence(saved?.document);
  if(d.source!=='chartex'||keccak256(toBytes(JSON.stringify(d)))!==job.payload.evidenceHash||d.contract!==config.contract||d.roundId!==job.payload.roundId||d.horizon!==job.payload.horizon||d.actualViews!==job.payload.actualViews)fail('SETTLEMENT_REVIEW');
  const block=await chain.snapshot(),r=await chain.readRound(d.roundId,block.number),p=await chain.readPool(d.roundId,d.horizon,block.number);
  if(roundSong(r)?.id!==DEMO_SONG.id||r.musicId!==d.musicId||p.windowStart.toString()!==d.windowStart||p.windowEnd.toString()!==d.windowEnd)fail('SETTLEMENT_REVIEW');
  if(!samePolicy(await data.policy(d.roundId,d.horizon),d.policy))fail('SETTLEMENT_REVIEW');
  const rows=await data.observations(d.policy.targetDate,Number(p.windowEnd)*1000+24*HOUR);
  for(const o of d.observations)if(!rows.some(r=>r.collection_id===o.collectionId&&r.response_hash===o.responseHash&&new Date(r.observed_at).toISOString()===new Date(o.observedAt).toISOString()&&String(r.views)===d.actualViews))fail('SETTLEMENT_REVIEW');
 };
}
export function createChartexCollector({config,store,client=createChartexClient(config),clock=Date.now,intervalMs=60000,log=()=>{}}){
 let running=false,timer;const worker=randomUUID();
 async function tick(){if(running||!config.chartexEnabled)return;running=true;let claimed=false;try{
  if(!config.chartexAppId||!config.chartexAppToken)fail('CHARTEX_CREDENTIALS_REQUIRED');
  if(!await store.claim(worker))return;claimed=true;
  const end=addCalendarDays(austinDate(clock()),-1),start=addCalendarDays(end,-29),result=await client.history(start,end);
  if(!await store.metadata())await store.saveMetadata(await client.metadata());
  await store.finish(worker,result);claimed=false;
 }catch(e){const code=e instanceof AppError?e.code:'CHARTEX_UNAVAILABLE';if(claimed)try{await store.finish(worker,null,code);}catch{}log({event:'chartex-collector',code});}finally{running=false;}}
 return {tick,start(){if(timer||!config.chartexEnabled)return;timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();void tick();},stop(){clearInterval(timer);timer=null;}};
}
export function createChartexResults({config,chain,live,data,evidence,admin,signer,clock=Date.now,intervalMs=60000,log=()=>{}}){
 let running=false,timer,status={enabled:Boolean(config.chartexEnabled&&config.settlementEnabled),lastChecked:null,error:null,action:'waiting',pools:[]};
 async function tick(){if(running||!config.chartexEnabled||!config.settlementEnabled)return;running=true;try{
  status={...status,lastChecked:new Date(clock()).toISOString(),error:null};
  if(await admin.pendingSettlement(signer)){status.action='waiting_for_worker';return;}
  status.action='checking';status.pools=[];
  const catalog=await live.catalog();if(catalog.snapshot?.syncStatus!=='current')fail('LIVE_DATA_UPDATING');
  const block=await chain.snapshot(),now=Number(block.timestamp)*1000;
  for(const row of catalog.rounds.filter(r=>r.songId===DEMO_SONG.id))for(const t of MARKET_TYPES){
   const p=await chain.readPool(row.id,t.id,block.number),end=Number(p.windowEnd)*1000,refund=Number(p.refundAt)*1000;
   const poolStatus={roundId:row.id,marketType:t.id,status:p.phase>=4?'complete':p.phase!==0?'settling':now>=refund-HOUR?'refund_cutoff':now<end+24*HOUR?'waiting_delay':'waiting_stability',eligibleAt:new Date(end+24*HOUR).toISOString(),cutoffAt:new Date(refund-HOUR).toISOString()};status.pools.push(poolStatus);
   if(p.phase!==0||now<end+24*HOUR||now>=refund-HOUR)continue;
   const policy=await data.policy(row.id,t.id);if(!samePolicy(policy,resultPolicy({...row,songId:undefined},t.id)))fail('RESULT_POLICY_UNAVAILABLE');
   let frozen=await data.candidate(row.id,t.id);
   if(!frozen){
   const observations=await data.observations(policy.targetDate,end+24*HOUR),pair=stableObservation(observations.filter(r=>Date.parse(r.observed_at)<=now),end+24*HOUR);if(!pair)continue;
   const document=canonicalEvidence({version:3,source:'chartex',chainId:config.chainId,contract:config.contract,roundId:row.id,horizon:t.id,musicId:row.musicId,windowStart:p.windowStart.toString(),windowEnd:p.windowEnd.toString(),actualViews:String(pair[1].views),policy,frozenAt:new Date(now).toISOString(),observations:pair.map(o=>({collectionId:o.collection_id,observedAt:o.observed_at,responseHash:o.response_hash}))});
   const evidenceHash=await evidence.save(document);
   frozen=await data.freeze(row.id,t.id,evidenceHash,document);
   }
   const document=canonicalEvidence(frozen.document),evidenceHash=frozen.evidence_hash;
   if(keccak256(toBytes(JSON.stringify(document)))!==evidenceHash)fail('SETTLEMENT_REVIEW');
   await evidence.save(document);
   await admin.operator('submit-result',null,signer,{roundId:row.id,horizon:t.id,actualViews:document.actualViews,evidenceHash});
   poolStatus.status='result_queued';status.action='result_queued';
   status={...status,lastChecked:new Date(clock()).toISOString(),error:null};return;
  }
  status={...status,lastChecked:new Date(clock()).toISOString(),error:null};
 }catch(e){status={...status,error:e instanceof AppError?e.code:'CHARTEX_RESULT_UNAVAILABLE'};log({event:'chartex-result',code:status.error});}finally{running=false;}}
 return {tick,status:()=>({...status,pools:status.pools.map(p=>({...p}))}),start(){if(timer)return;timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();void tick();},stop(){clearInterval(timer);timer=null;}};
}
