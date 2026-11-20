import {keccak256,toBytes} from 'viem';
import {activeSong,songForMusicId,DEMO_SONG} from '../../shared/demo-song.js';
import {austinDate,addCalendarDays,MARKET_TYPES} from '../../shared/market-schedule.js';
import {ORIGINAL_OWNER,sameAddress} from './config.js';
export const songHash = song => keccak256(toBytes(song.id));
export const activeSongHash = config => songHash(activeSong(config));
export function roundSong(row){const song=songForMusicId(row.musicId);return song&&row.songId?.toLowerCase()===songHash(song)&&sameAddress(row.artist,ORIGINAL_OWNER)?song:null;}
export function resultPolicy(row,type){
 const t=MARKET_TYPES.find(t=>t.id===type);
 if(!t||roundSong({...row,songId:row.songId??songHash(DEMO_SONG)})?.id!==DEMO_SONG.id)throw Error('BAD_RESULT_POLICY');
 return {version:1,source:'chartex',songId:DEMO_SONG.id,musicId:DEMO_SONG.musicId,spotifyId:DEMO_SONG.spotifyId,metric:DEMO_SONG.metric,targetDate:addCalendarDays(austinDate(row.start),t.offsetDays),reportingTimeZone:'provider-defined',biddingTimeZone:'America/Chicago',delayHours:24,stabilityHours:6,cutoffHoursBeforeRefund:1};
}

export const samePolicy=(a,b)=>Boolean(a&&b&&JSON.stringify(a,Object.keys(a).sort())===JSON.stringify(b,Object.keys(b).sort()));
