import {activeSong} from '../../shared/demo-song.js';
import {MARKET_TYPES,AUSTIN_ZONE,marketKey,marketTypesFor} from '../../shared/market-schedule.js';
import {isScheduled,isV3,modelVersion,typesFor,deploymentId} from './market-model.js';
import {AppError} from './errors.js';
export function createMarkets({config,live,deployments,services=new Map(),assertActive=async()=>{},data=null}){
 const base=()=>({featuredSong:activeSong(config),marketModelVersion:3,timeZone:AUSTIN_ZONE,types:MARKET_TYPES,deployments:deployments.map(d=>({id:deploymentId(d),contract:d.contract,modelVersion:modelVersion(d),active:d.contract===config.contract}))});
 return {
  async catalog(){
   if(!isV3(config))return {...base(),ready:false,markets:[],rounds:[],message:'The daily-only markets are being prepared. Previous purchases remain in My Purchases.'};
   await assertActive();const c=await live.catalog();
   const markets=[];
   // Descriptors contain on-chain/index-verified counts only. Never manufacture an empty live pool.
   for(const round of c.rounds.filter(r=>r.songId===activeSong(config).id&&r.entryStatus!=='closed').sort((a,b)=>a.start-b.start).slice(-20)){
    const detail=await live.round(round.id);
    for(const type of MARKET_TYPES){
     const pool=detail.pools[type.id];if(!pool)continue;
     const policy=config.chartexEnabled?await data?.policy(round.id,type.id):null;
     markets.push({...pool,songId:round.songId,policy,open:pool.open&&(!config.chartexEnabled||Boolean(policy)),id:marketKey(deploymentId(config),round.id,type.id),deploymentId:deploymentId(config),marketType:type.id,entryStart:round.start,entryEnd:round.deadline,snapshot:detail.snapshot});
    }
   }
   return {...base(),...c,rounds:c.rounds.filter(r=>r.songId===activeSong(config).id),deploymentId:deploymentId(config),markets};
  },
  async detail(deployment,round,type){
   const service=services.get(deployment),selected=service?.config??(deployment===deploymentId(config)?config:null),reader=service?.live??live;
   if(!selected||!isScheduled(selected)||!typesFor(selected).includes(type))throw new AppError('ROUND_UNAVAILABLE',404);
   const r=await reader.round(round),p=r.pools[type];if(!p)throw new AppError('ROUND_UNAVAILABLE',404);
   const policy=r.round.songId==='tennessee-orange'?await data?.policy(round,type):null;
   return {...p,songId:r.round.songId,policy,open:p.open&&(!config.chartexEnabled||r.round.songId===activeSong(config).id&&Boolean(policy)),id:marketKey(deployment,round,type),deploymentId:deployment,marketType:type,entryStart:r.round.start,entryEnd:r.round.deadline,snapshot:r.snapshot};
  },
 };
}
