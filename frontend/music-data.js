const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=value=>typeof value==='string'&&/^\d+$/.test(value)?BigInt(value):Number.isSafeInteger(value)&&value>=0?BigInt(value):null;
export const exactCount=value=>{const n=count(value);return n===null?'—':Intl.NumberFormat('en-US').format(n);};
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const dayOffset=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function historyRows(data,days) {
 const source=(data?.days??[]).filter(row=>validDate(row.date));
 const byDate=new Map(source.map(row=>[row.date,row]));
 const dates=[...byDate.keys()].sort(),end=validDate(data?.endDate)?data.endDate:dates.at(-1);
 if(!end)return [];
 const earliest=validDate(data?.startDate)?data.startDate:dates[0]??end;
 const start=[earliest,dayOffset(end,1-([3,7,30].includes(days)?days:30))].sort().at(-1);
 const rows=[];
 for(let date=start;date<=end;date=dayOffset(date,1)){
  const row=byDate.get(date),views=count(row?.views);
  rows.push({...row,date,views:views===null?null:views.toString()});
 }
 return rows;
}
const pointLabel=row=>`${row.date}: ${exactCount(row.views)} TikTok views reported by Chartex`;
const shortDate=date=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(Date.parse(date+'T00:00:00Z'));
export function historyChart(data,days=30) {
 const rows=historyRows(data,days),values=rows.map(row=>count(row.views)).filter(n=>n!==null);
 if(!values.length)return '<p class="info-box" role="status">Daily view history is not available yet. Missing counts are shown as gaps.</p>';
 const highest=values.reduce((a,b)=>a>b?a:b,0n),step=(highest+3n)/4n||1n,top=step*4n;
 const left=70,right=695,upper=20,bottom=210;
 const x=i=>left+i*(right-left)/Math.max(1,rows.length-1);
 const y=value=>bottom-Number(count(value)*1000000n/top)/1000000*(bottom-upper);
 let path='',previous=false;
 rows.forEach((row,i)=>{if(row.views===null){previous=false;return;}path+=`${previous?'L':'M'}${x(i)} ${y(row.views)} `;previous=true;});
 const grids=Array.from({length:5},(_,i)=>{const value=step*BigInt(i),at=bottom-i*(bottom-upper)/4;return `<line x1="${left}" x2="${right}" y1="${at}" y2="${at}" class="chart-grid"/><text x="${left-12}" y="${at+4}" text-anchor="end" class="chart-axis">${esc(Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value))}</text>`;}).join('');
 const labels=[...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])].map(i=>`<text x="${x(i)}" y="244" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}" class="chart-axis">${esc(shortDate(rows[i].date))}</text>`).join('');
 return `<div class="history-chart-wrap"><svg class="market-chart history-chart" viewBox="0 0 720 260" role="group" aria-labelledby="chartex-chart-title chartex-chart-description"><title id="chartex-chart-title">${rows.length} dates of Chartex-reported daily TikTok views</title><desc id="chartex-chart-description">Stored historical counts only. Missing or invalid dates are gaps. Focus a point for its exact date and count.</desc>${grids}<path class="history-line" d="${path}" fill="none" stroke="var(--blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${rows.map((row,i)=>row.views===null?'':`<g id="chartex-point-${row.date}" class="history-point" role="img" tabindex="0" aria-label="${esc(pointLabel(row))}" data-history-date="${row.date}" data-history-label="${esc(pointLabel(row))}"><title>${esc(pointLabel(row))}</title><circle cx="${x(i)}" cy="${y(row.views)}" r="12" fill="transparent"/><circle class="history-dot" cx="${x(i)}" cy="${y(row.views)}" r="4" fill="var(--surface)" stroke="var(--blue)" stroke-width="2"/></g>`).join('')}${labels}</svg></div>`;
}
export function historyPanel(data,days=30,selectedDate=null) {
 const rows=historyRows(data,days),selected=rows.find(row=>row.date===selectedDate&&row.views!==null),latest=data?.latestAvailable;
 const latestValid=count(latest?.views)!==null&&validDate(latest?.date);
 const update=new Date(data?.lastSuccess??'');
 const updated=Number.isFinite(update.getTime())?new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago',timeZoneName:'short'}).format(update):null;
 const metrics=[['TikTok views','tiktok-video-views'],['Video-use change','tiktok-creates'],['Likes','tiktok-video-likes'],['Comments','tiktok-video-comments'],['Shares','tiktok-video-shares'],['Saves','tiktok-video-saves'],['Spotify streams','spotify-streams'],['YouTube views','youtube-views'],['Instagram reels','instagram-reels'],['Shazams','shazam-counts']];
 const fmt=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US'):'—';
 return `<section class="panel chart-panel chartex-history"><div class="panel-heading"><div><h2 class="panel-title">Follow the momentum</h2><p class="muted chart-subtitle">Chartex-reported daily TikTok views</p></div><div class="segmented-control chart-controls" aria-label="Historical chart range">${[3,7,30].map(n=>`<button id="chartex-range-${n}" type="button" data-action="history-days" data-days="${n}" class="${days===n?'active':''}" aria-pressed="${days===n}">${n}D</button>`).join('')}</div></div>${historyChart(data,days)}<p class="history-readout" aria-live="polite">${selected?esc(pointLabel(selected)):'Hover or focus a point for its exact count.'}</p><div class="history-source"><span>Source: <strong>Chartex</strong></span><span>${latestValid?`Latest available: <strong>${exactCount(latest.views)} views</strong> · ${esc(latest.date)}`:'Waiting for the first available count.'}</span></div><p class="fine-print history-update" role="status">${data?.status==='stale'?'Updates are temporarily unavailable. Last saved figures are shown. ':''}${updated?'Last successful update: '+esc(updated)+'.':'No successful update available yet.'}</p><p class="fine-print">Dates follow Chartex’s reporting day; exact Austin counting boundaries have not been verified. Later revisions can update this chart; settled results remain fixed.</p><details class="history-numbers"><summary>View daily numbers and other available metrics</summary><div class="table-container"><table class="history-data-table"><thead><tr><th scope="col">Date</th>${metrics.map(([label])=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${esc(row.date)}</th>${metrics.map(([,key])=>`<td>${key==='tiktok-video-views'?exactCount(row.views):fmt(row.metrics?.[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="fine-print">Other metrics do not decide winners. Video-use changes can be negative. Missing values are not zero.</p></details></section>`;
}
