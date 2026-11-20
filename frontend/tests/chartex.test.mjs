import test from 'node:test';import assert from 'node:assert/strict';
import {historyChart,historyPanel} from '../music-data.js';
import {renderMarket,resolveMarket} from '../market-ui.js';
import {songs,artists} from '../data.js';
import {scheduleFor} from '../../shared/market-schedule.js';
test('real history shows exact zero and missing values, with gaps and no simulated fallback',()=>{
 const data={days:[{date:'2026-11-01',views:'100',metrics:{}},{date:'2026-11-02',views:null},{date:'2026-11-03',views:'0',metrics:{'tiktok-creates':-4}}],lastSuccess:'2026-11-04T06:00:00Z',status:'stale',latestAvailable:{date:'2026-11-03',views:'0'}};
 const markup=historyPanel(data,30);assert.match(markup,/0 views/);assert.match(markup,/Last saved figures/);assert.match(markup,/-4/);assert.match(markup,/provider’s counting timezone|Chartex’s reporting day/);assert.equal((historyChart(data).match(/\bM(?=\s*[-\d.])/g)||[]).length,2);assert.doesNotMatch(markup,/Simulated/);assert.match(historyPanel(null),/not available yet/);
});
test('featured song market uses source dates, clear test beneficiary and matching song identity',()=>{
 const now=Date.parse('2026-11-20T18:00:00Z'),s=scheduleFor('day_plus_1',now),song=songs.find(s=>s.id==='tennessee-orange');const m={...s,songId:song.id,marketType:'day_plus_1',id:'markets-v3:3:day_plus_1',roundId:'3',open:true,snapshot:{syncStatus:'current'},policy:{targetDate:'2026-11-21'}};
 const state={marketCatalog:{ready:true,marketModelVersion:3,featuredSong:{id:song.id},markets:[m],rounds:[]},marketDetails:{}};
 const context={song,marketType:'day_plus_1'},markup=renderMarket({context,payments:{getState:()=>state,serverNow:()=>now},ui:{guess:'',historyDays:30},artist:artists.find(a=>a.id===song.artistId),cover:()=>'',followButton:()=>''});
 assert.match(markup,/Chartex result date/);assert.match(markup,/2026-11-21/);assert.match(markup,/not Megan Moroney/);assert.doesNotMatch(markup,/Whole Austin calendar day|Simulated daily/);assert.equal(resolveMarket({...context,song:{id:'animals'}},state,now),null);
});
test('purchase review preserves the real song identity and fixed source date',async()=>{
 const {orderModal}=await import('../payment-ui.js');const s=scheduleFor('day_plus_1',Date.parse('2026-11-20T18:00:00Z'));
 const o={request:{optionId:'single',marketType:'day_plus_1',roundId:'3',deploymentId:'markets-v3',guess:'42'},round:{id:'3',songId:'tennessee-orange',start:s.entryStart,deadline:s.entryEnd,policy:{source:'chartex',targetDate:'2026-11-21'}},status:'awaiting_signature',expiresAt:new Date(Date.now()+10000).toISOString()};
 const {body}=orderModal(o,{confirm:true});assert.match(body,/Tennessee Orange/);assert.match(body,/Megan Moroney/);assert.match(body,/Chartex target date/);assert.match(body,/2026-11-21/);assert.doesNotMatch(body,/Last Bus Home|Views measured/);
});
