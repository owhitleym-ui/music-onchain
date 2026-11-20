import {readFileSync} from 'node:fs';
import {MARKET_TYPES,marketTypesFor,validTypes} from '../../shared/market-schedule.js';
export const MARKETS_ABI=JSON.parse(readFileSync(new URL('../../contracts/abi/MusicPredictionMarketsV2.json',import.meta.url),'utf8'));
export const DAILY_ABI=JSON.parse(readFileSync(new URL('../../contracts/abi/MusicPredictionMarketsV3.json',import.meta.url),'utf8'));
export const MARKET_IDS=MARKET_TYPES.map(t=>t.id);
export const modelVersion=config=>config?.deployment?.marketModelVersion??1;
export const isV2=config=>modelVersion(config)===2;
export const isV3=config=>modelVersion(config)===3;
export const isScheduled=config=>[2,3].includes(modelVersion(config));
export const marketAbi=config=>isV3(config)?DAILY_ABI:MARKETS_ABI;
export const typesFor=(config,cadence)=>isScheduled(config)?(cadence?validTypes(cadence,modelVersion(config)):marketTypesFor(modelVersion(config))).map(t=>t.id):['24h','48h','week'];
export const typeIndex=(id,config)=>{
 const ids=config?typesFor(config):['24h','48h','week'].includes(id)?['24h','48h','week']:['next_hour','hour_plus_24'].includes(id)?marketTypesFor(2).map(t=>t.id):MARKET_IDS;
 const index=ids.indexOf(id);if(index<0)throw Error('INVALID_MARKET_TYPE');return index;
};
export const deploymentId=config=>config?.deployment?.deploymentId??(isScheduled(config)?'markets-v'+modelVersion(config):'atomic-v1');
