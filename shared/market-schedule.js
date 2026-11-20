export const HOUR=3600000;
export const DAY=24*HOUR;
export const AUSTIN_ZONE='America/Chicago';
export const SCHEDULE_VERSION=3;
export const MARKET_TYPES=Object.freeze([
 {id:'day_plus_1',index:0,cadence:'daily',offsetDays:1,label:'Tomorrow',countLabel:'Daily count'},
 {id:'day_plus_2',index:1,cadence:'daily',offsetDays:2,label:'Day after tomorrow',countLabel:'Daily count'},
 {id:'day_plus_7',index:2,cadence:'daily',offsetDays:7,label:'7 days later',countLabel:'Daily count'},
]);
// Historical deployments retain their original index and schedule meanings.
export const MARKET_TYPES_V2=Object.freeze([
 {id:'next_hour',index:0,cadence:'hourly',label:'Next hour',countLabel:'1h count'},
 {id:'hour_plus_24',index:1,cadence:'hourly',label:'24 hours later',countLabel:'1h count'},
 {id:'day_plus_7',index:2,cadence:'daily',label:'7 days later',countLabel:'Daily count'},
]);
export const marketTypesFor=version=>version===2?MARKET_TYPES_V2:version===3?MARKET_TYPES:[];
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:AUSTIN_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
const parts=time=>Object.fromEntries(calendar.formatToParts(time).map(p=>[p.type,p.value]));
export function marketType(id,version){const type=(version==null?[...MARKET_TYPES,...MARKET_TYPES_V2]:marketTypesFor(version)).find(t=>t.id===id);if(!type)throw Error('INVALID_MARKET_TYPE');return type;}
export function austinDate(time){const p=parts(time);return `${p.year}-${p.month}-${p.day}`;}
export function addCalendarDays(date,days){const t=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(t)||!Number.isSafeInteger(days))throw Error('INVALID_DATE');return new Date(t+days*DAY).toISOString().slice(0,10);}
export function austinMidnight(date){
 const day=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(day)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('INVALID_DATE');
 for(const offset of [5,6]){const time=day+offset*HOUR,p=parts(time);if(`${p.year}-${p.month}-${p.day}`===date&&p.hour==='00')return time;}
 throw Error('UNSUPPORTED_AUSTIN_DATE');
}
export function scheduleFor(id,now=Date.now(),version){
 const type=marketType(id,version);if(!Number.isSafeInteger(now))throw Error('INVALID_TIME');
 let entryStart,entryEnd,windowStart,windowEnd;
 if(type.cadence==='hourly'){
  entryStart=Math.floor(now/HOUR)*HOUR;entryEnd=entryStart+HOUR;
  windowStart=type.index===0?entryEnd:entryStart+DAY;windowEnd=windowStart+HOUR;
 }else{
  const date=austinDate(now);entryStart=austinMidnight(date);entryEnd=austinMidnight(addCalendarDays(date,1));
  const offset=type.offsetDays??7;
  windowStart=austinMidnight(addCalendarDays(date,offset));windowEnd=austinMidnight(addCalendarDays(date,offset+1));
 }
 return {marketType:id,cadence:type.cadence,entryStart,entryEnd,windowStart,windowEnd,refundAt:windowEnd+2*DAY,durationHours:(windowEnd-windowStart)/HOUR};
}
export function assertSchedule(value,version){
 const expected=scheduleFor(value.marketType,value.entryStart,version);
 for(const key of ['entryStart','entryEnd','windowStart','windowEnd','refundAt'])if(value[key]!==expected[key])throw Error('SCHEDULE_MISMATCH');
 return expected;
}
export function desiredRounds(now=Date.now(),version=3){
 if(version===3){const daily=scheduleFor('day_plus_1',now,3);return [daily,scheduleFor('day_plus_1',daily.entryEnd,3)];}
 const hour=scheduleFor('next_hour',now),daily=scheduleFor('day_plus_7',now);
 return [0,1,2].map(n=>({cadence:'hourly',...scheduleFor('next_hour',hour.entryStart+n*HOUR)})).concat([daily,scheduleFor('day_plus_7',daily.entryEnd)]);
}
export function validTypes(cadence,version=3){return marketTypesFor(version).filter(t=>t.cadence===cadence);}
export function dailyBoundaries(start){const date=austinDate(start);return [0,1,2,3,7,8].map(n=>austinMidnight(addCalendarDays(date,n)));}
export function marketKey(deploymentId,roundId,type){marketType(type);if(!/^[A-Za-z0-9_-]+$/.test(deploymentId)||!/^\d+$/.test(String(roundId)))throw Error('INVALID_MARKET');return `${deploymentId}:${roundId}:${type}`;}
export function displayZone(setting='austin'){
 if(setting==='utc')return 'UTC';if(setting==='device'){try{return new Intl.DateTimeFormat().resolvedOptions().timeZone||AUSTIN_ZONE;}catch{}}
 return AUSTIN_ZONE;
}
export function formatMarketTime(time,zone=AUSTIN_ZONE){return new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(time);}
export function marketPhase(schedule,now){return now<schedule.entryStart?'upcoming':now<schedule.entryEnd?'open':'closed';}
