import {MARKET_TYPES,MARKET_TYPES_V2,scheduleFor,formatMarketTime,displayZone} from '../shared/market-schedule.js';
import {paymentOption} from './payments-options.js';
import {formatDollars} from './money.js';
import {liveCount,freshness} from './live-format.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function nativeDollars(units,{up=false}={}) {
 const value=BigInt(units),negative=value<0n,amount=negative?-value:value;
 const rounded=up?((amount+999999999999n)/1000000000000n)*1000000000000n:amount;
 const whole=rounded/1000000000000000000n,fraction=(rounded%1000000000000000000n).toString().padStart(18,'0').replace(/0+$/,'');
 return (negative?'−':'')+'$'+whole.toLocaleString('en-US')+(fraction?'.'+fraction:'');
}
const oldDate=ms=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'}).format(ms)+' CT';
const date=ms=>{let setting='austin';try{setting=localStorage.getItem('music-display-zone')??setting;}catch{}return formatMarketTime(ms,displayZone(setting));};
const typeLabel=id=>[...MARKET_TYPES,...MARKET_TYPES_V2].find(t=>t.id===id)?.label??id;
const label={awaiting_signature:'Awaiting confirmation',prepared:'Processing payment',submitted:'Processing payment',uncertain:'Checking payment — do not pay again',confirmed:'Entry confirmed · awaiting result details',failed:'Payment failed',cancelled:'Cancelled',expired:'Confirmation expired'};
export function paymentStatus(order){return order.status==='awaiting_signature'&&Date.now()>=Date.parse(order.expiresAt)?'Confirmation expired':label[order.status]??'Checking payment';}
const contestLabels={awaiting_result:'Awaiting result',settling:'Result being calculated',claimable:'Ready to claim',partially_claimed:'Partly received',claimed:'Return received',refundable:'Refund available',refunded:'Refund received',partially_collected_elsewhere:'Partly collected to another account',collected_mixed:'Collected · multiple destinations',collected_elsewhere:'Collected to another account',refunded_elsewhere:'Refunded to another account'};
export function accountRows({orders=[],entryGroups=[],catalog,entriesVerifiedThrough}) {
 const groups=new Set(entryGroups.map(g=>g.contract+':'+g.transactionHash));
 const pending=orders.filter(o=>{
  if(groups.has(o.contract+':'+o.transactionHash))return false;
  if(o.status==='confirmed'&&o.contract===catalog?.contract&&o.receiptBlock!=null&&entriesVerifiedThrough!=null&&BigInt(o.receiptBlock)<=BigInt(entriesVerifiedThrough))return false;
  return true;
 });
 return [
  ...pending.map(order=>({kind:'order',id:order.id,time:Date.parse(order.createdAt),order})),
  ...entryGroups.map(group=>({kind:'entry',id:group.id,time:group.purchasedAt,group})),
 ].sort((a,b)=>b.time-a.time||a.id.localeCompare(b.id));
}
function orderTitle(order,state) {
 const round=order.round??state.marketCatalog?.rounds?.find(r=>String(r.id)===String(order.request.roundId)&&(!order.request.deploymentId||r.deploymentId===order.request.deploymentId))??(!order.request.marketType?state.catalog?.rounds?.find(r=>String(r.id)===String(order.request.roundId)):null);
 const song=round?.songId??round?.policy?.songId??order.request.songId;
 return song==='tennessee-orange'?'Tennessee Orange':song==='last-bus-home'?'Last Bus Home':order.request.deploymentId==='markets-v3'?'Contest entry':'Last Bus Home';
}
function accountView(rows,state,view) {
 const filtered=rows.filter(row=>view.status==='payments'?row.kind==='order':view.status==='claimable'?row.kind==='entry'&&['claimable','partially_claimed'].includes(row.group.contestStatus):view.status==='refundable'?row.kind==='entry'&&['refundable','partially_refunded'].includes(row.group.contestStatus):view.status==='received'?row.kind==='entry'&&BigInt(row.group.receivedAmount??0)>0n:true);
 const title=row=>row.kind==='order'?orderTitle(row.order,state):row.group.entries[0]?.songId==='tennessee-orange'?'Tennessee Orange':'Last Bus Home';
 const cost=row=>row.kind==='order'?BigInt(paymentOption(row.order.request.optionId).costCents)*10n**16n:BigInt(row.group.totalPaid??0);
 return filtered.sort((a,b)=>view.sort==='oldest'?a.time-b.time:view.sort==='song'?title(a).localeCompare(title(b))||b.time-a.time:view.sort==='amount'?(cost(a)===cost(b)?b.time-a.time:cost(a)>cost(b)?-1:1):b.time-a.time);
}

export function accountPurchaseMarkup(current,state,view={sort:'newest',status:'all'}) {
 const {orders=[],entryGroups=[],historyError,busy,entriesError,entriesLoading,entriesSnapshot,entriesNextCursor,entriesPage=1}=state;
 if(!current.authenticated)return '<section class="panel live-purchases"><h2 class="panel-title">Your account purchases</h2><p>Sign in to see your test purchases.</p><button class="button secondary" data-action="account-login">Sign up / Log in</button></section>';
 const historyContract=state.marketCatalog?.deployments?.find(d=>d.id===state.historyDeploymentId)?.contract;
 const rows=accountView(accountRows({...state,...(historyContract?{catalog:{...state.catalog,contract:historyContract}}:{})}),state,view),sum=key=>entryGroups.reduce((n,g)=>n+BigInt(g[key]??0),0n);
 const verified=Boolean(entriesSnapshot),amount=key=>verified?nativeDollars(sum(key)):'—';
 const artists=new Set(entryGroups.flatMap(g=>g.entries.map(e=>e.artistKey)));
 for(const row of rows)if(row.kind==='order'&&row.order.status==='confirmed')artists.add(state.catalog?.rounds?.find(r=>r.id===row.order.request.roundId)?.artist??'last-bus-home');
 const list=rows.map(row=>{
  if(row.kind==='entry'){
   const g=row.group,e=g.entries[0],title=e?.songId==='tennessee-orange'?'Tennessee Orange':e?.songId==='last-bus-home'?'Last Bus Home':'Contest entry';
   return `<article class="account-entry-card"><button class="live-order button secondary" data-action="entry-detail" data-id="${esc(g.id)}"><span><strong>${title} · ${nativeDollars(g.totalPaid)}</strong><span class="subline">${liveCount(g.spotCount)} spots · ${g.entries.every(x=>x.guess===e.guess)?liveCount(e.guess)+' views':'Multiple guesses'} · ${esc(typeLabel(e.marketType??e.horizon))}<br/>${date(g.purchasedAt)}</span></span><span class="status-chip">${esc(contestLabels[g.contestStatus]??'Checking result')}</span></button>${e?.result?`<p class="frozen-history-result">Frozen result: ${liveCount(e.result.actualViews)} views · ${esc(e.result.source)}${e.result.targetDate?' · '+esc(e.result.targetDate):''}</p>`:''}<div class="entry-collection-actions">${g.entries.map(entry=>{const action=entryCollectionMarkup({...entry,contract:g.contract,deploymentId:g.deploymentId},{claims:state.claims??[],claimsReady:Boolean(state.claimsReady&&entriesSnapshot?.syncStatus==='current'&&entriesSnapshot.chainAvailable!==false),busy,claimsError:state.claimsError});return action?`<div class="entry-collection-action"><span>Entry #${esc(entry.entryId)}</span>${action}</div>`:'';}).join('')}</div></article>`;
  }
  const o=row.order,p=paymentOption(o.request.optionId),archived=o.contract&&state.catalog?.contract&&o.contract!==state.catalog.contract;
  return `<button class="live-order button secondary" data-action="live-detail" data-id="${esc(o.id)}"><span><strong>${esc(orderTitle(o,state))} · ${formatDollars(p.costCents)}</strong><span class="subline">${p.spots} spots · ${liveCount(o.request.guess)} views · ${esc(typeLabel(o.request.marketType??o.request.horizon))}<br/>${date(Date.parse(o.createdAt))}${archived?'<br/>Previous contest version':''}</span></span><span class="status-chip">${esc(paymentStatus(o))}</span></button>`;
 }).join('');
 return `<section class="panel live-purchases"><div class="section-heading"><h2 class="panel-title">Your account purchases</h2><button class="button secondary small" data-action="payments-refresh" ${busy?'disabled':''}>Refresh</button></div>
 <div class="account-history-tools"><label class="field-label">Show loaded account records<select class="select-input" id="account-status">${[['all','All records'],['payments','Payment requests'],['claimable','Ready to collect'],['refundable','Refunds available'],['received','Returns received']].map(([value,label])=>`<option value="${value}" ${view.status===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field-label">Sort loaded account records<select class="select-input" id="account-sort">${[['newest','Newest first'],['oldest','Oldest first'],['song','Song A–Z'],['amount','Largest entry']].map(([value,label])=>`<option value="${value}" ${view.sort===value?'selected':''}>${label}</option>`).join('')}</select></label></div>
 ${state.marketCatalog?.deployments?.length?`<label class="field-label">Purchase history<select class="select-input" id="history-deployment">${state.marketCatalog.deployments.map(d=>`<option value="${esc(d.id)}" ${d.id===(state.historyDeploymentId??state.marketCatalog.deployments.find(d=>d.active)?.id)?'selected':''}>${d.modelVersion===3?'Daily markets · 5% artist support':d.modelVersion===2?'Previous hourly and daily markets':'Previous 24h / 48h / seventh-day contests'}</option>`).join('')}</select></label>`:''}<p class="fine-print">Loaded account entries: ${verified?artists.size:'—'} ${artists.size===1?'artist':'artists'} supported · Received ${amount('receivedAmount')} · Available ${amount('claimableAmount')} · Net received result ${amount('realizedNet')} before network fees.</p><p class="fine-print">Entry payments and contest results are separate. Unclaimed and unsettled entries are excluded from the net result.</p>
 <p class="live-freshness" role="status">${esc(freshness(entriesSnapshot,entriesError))}${entriesLoading?' · Refreshing…':''}</p>
 ${historyError||entriesError?`<p class="error-message" role="alert">${esc(historyError||entriesError)}</p>`:''}
 ${rows.length?`<div class="live-order-list">${list}</div>`:entriesLoading?'<p>Loading your account purchases…</p>':entriesError&&!verified?'<p>Your entry history is unavailable. Refresh to try again.</p>':'<p>No account purchases yet. Confirmed entries and saved payment requests will appear here.</p>'}
 ${entriesPage>1||entriesNextCursor?`<div class="history-pagination"><button class="button secondary small" data-action="entries-previous" ${entriesPage<=1||entriesLoading?'disabled':''}>Previous</button><span>Entry history · Page ${entriesPage}</span><button class="button secondary small" data-action="entries-next" ${!entriesNextCursor||entriesLoading?'disabled':''}>Next</button></div>`:''}</section>`;
}
export function entryModal(group,{orders=[],snapshot,claims=[],claimsReady=false,busy=false,claimsError=''}={}) {
 if(!group)return {title:'Entry details unavailable',body:'<p>Refresh My Purchases to check these entries.</p>',footer:'<button class="button primary" data-action="close-modal">Done</button>'};
 const order=orders.find(o=>o.transactionHash===group.transactionHash&&o.contract===group.contract);
 const rows=[['Entry cost',nativeDollars(group.totalPaid)],['Spots',liveCount(group.spotCount)],['Payment status','Entry confirmed'],['Contest status',contestLabels[group.contestStatus]??'Checking result'],['Available to claim',nativeDollars(group.claimableAmount)],['Received',nativeDollars(group.receivedAmount)],['Net received result · before network fees',nativeDollars(group.realizedNet)]];
 if(order?.networkFee!=null)rows.push(['Network fee paid',nativeDollars(order.networkFee)]);
 const four=group.entries.length===4&&group.entries.every(e=>e.spots==='1'&&e.paid==='5000000000000000000'&&e.guess===group.entries[0].guess);
 const records=group.entries.map(e=>`<section class="entry-record"><h3>Entry #${esc(e.entryId)}</h3><dl class="detail-list"><div><dt>Guess</dt><dd>${liveCount(e.guess)} views</dd></div><div><dt>Entry cost</dt><dd>${nativeDollars(e.paid)}</dd></div><div><dt>Spots</dt><dd>${liveCount(e.spots)}</dd></div><div><dt>Reward multiplier</dt><dd>${e.multiplierBps===10000?'1.00 · no bonus':'Up to 1.05'}</dd></div><div><dt>${e.songId==='tennessee-orange'?'Chartex target date':'Views measured'}</dt><dd>${e.songId==='tennessee-orange'?esc(e.result?.targetDate??e.policy?.targetDate??new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(e.windowStart)):date(e.windowStart)+' → '+date(e.windowEnd)}</dd></div>${e.result?`<div><dt>Frozen result</dt><dd>${liveCount(e.result.actualViews)} views · ${esc(e.result.source)}</dd></div>`:''}<div><dt>Result</dt><dd>${esc(contestLabels[e.status]??'Checking result')}</dd></div>${e.collection&&!e.collection.toThisAccount?'<div><dt>Destination</dt><dd>Collected to another account; excluded from received totals</dd></div>':''}${e.outcome?`<div><dt>Main rank</dt><dd>${liveCount(e.outcome.mainRank)}</dd></div><div><dt>Final return</dt><dd>${nativeDollars(e.outcome.returned)}</dd></div><div><dt>Artist fee</dt><dd>${nativeDollars(e.outcome.artistFee)}</dd></div><div><dt>App fee</dt><dd>${nativeDollars(e.outcome.appFee)}</dd></div>`:''}</dl>${entryCollectionMarkup({...e,deploymentId:group.deploymentId,contract:group.contract},{claims,claimsReady,busy,claimsError})}</section>`).join('');
 return {title:'Your test entry details',body:`<dl class="detail-list">${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${four?'<div class="info-box">Four separate $5 entries. Same guess. No bonus. All four were purchased together.</div>':''}${records}<p class="fine-print">${esc(freshness(snapshot))}</p><p class="fine-print">Demo — no real money. Available returns have not been received yet. Network fees are separate.</p>`,footer:'<button class="button primary" data-action="close-modal">Done</button>'};
}
export function orderModal(order,{rounds,error,busy,confirm=false}) {
 if(!order)return {title:'Purchase unavailable',body:'<p>Refresh My Purchases to check this payment.</p>',footer:'<button class="button primary" data-action="close-modal">Done</button>'};
 const option=paymentOption(order.request.optionId),round=order.round??rounds?.find(r=>r.id===order.request.roundId),h=order.request.horizon;
 const schedule=order.request.marketType&&round?scheduleFor(order.request.marketType,round.start):null;
 const start=schedule?schedule.windowStart:round?round.start+({'24h':0,'48h':24,week:144}[h])*3600000:null;
 const provider=round?.policy?.source==='chartex'||round?.songId==='tennessee-orange';
 const rows=[['Song',provider?'Tennessee Orange · Megan Moroney':'Last Bus Home'],['Prediction window',typeLabel(order.request.marketType??(h==='week'?'1 week':h))],...(round?[['Round',date(round.start)],[provider?'Chartex target date':'Views measured',provider?esc(round?.policy?.targetDate??'Checking date'):date(start)+' → '+date(schedule?.windowEnd??start+86400000)],['Entry deadline',date(round.deadline)]]:[]),['Your guess',esc(order.request.guess)+' views'],['Entry cost',formatDollars(option.costCents)],['Spots',option.spots],['Reward multiplier',option.multiplier===1?'1.00 · no bonus':'Up to 1.05'],['Payment status',paymentStatus(order)]];
 if(order.transaction){const fee=BigInt(order.transaction.gas)*BigInt(order.transaction.gasPrice);rows.push(['Network fee · up to',nativeDollars(fee,{up:true})],['Total · up to',nativeDollars(BigInt(order.transaction.value)+fee,{up:true})]);}
 else if(order.networkFee!=null)rows.push(['Network fee paid',nativeDollars(order.networkFee,{up:true})]);
 const canConfirm=confirm&&order.status==='awaiting_signature'&&Date.now()<Date.parse(order.expiresAt);
 return {title:canConfirm?'Confirm your test purchase':'Test purchase details',body:`<dl class="detail-list purchase-review">${rows.map(([k,v])=>`<div class="${k==='Entry cost'?'review-cost':k==='Network fee · up to'?'review-fee':k==='Total · up to'?'review-total':''}"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${provider?'<p class="fine-print">Result: Chartex-reported daily TikTok views for the named date. Artist allocation goes to a demo test wallet, not Megan Moroney.</p>':''}${order.request.deploymentId==='markets-v3'?'<p class="fine-print">Daily V3: losing spots contribute 5% of their stake to the artist inside the curve deduction. Bundle bonuses are reserve-funded. The platform takes 1% of the matched stake from winner proceeds, waived for main ranks 1 and 2.</p>':''}${option.id==='four'?'<div class="info-box">Four separate $5 entries. Same guess. No bonus. All four are purchased together.</div>':''}${order.entryIds?.length?`<div class="breakdown-section"><h3>Entry records</h3><ul>${order.entryIds.map(id=>`<li>Entry #${esc(id)} · ${option.id==='bundle'?'10 spots · $50':'1 spot · $5'} · ${esc(order.request.guess)} views</li>`).join('')}</ul></div>`:''}${error?`<p class="error-message" role="alert">${esc(error)}</p>`:''}<p class="fine-print">Demo — no real money. Network fees are additional and may apply even if a submitted payment fails. A confirmed payment is separate from its contest result.</p>`,footer:`${order.status==='awaiting_signature'?`<button class="button secondary" data-action="payment-cancel" data-id="${esc(order.id)}" ${busy?'disabled':''}>Cancel purchase</button>`:''}${canConfirm?`<button class="button primary" data-action="payment-confirm" data-id="${esc(order.id)}" ${busy?'disabled':''}>${busy?'Preparing payment…':'Confirm '+formatDollars(option.costCents)+' purchase'}</button>`:'<button class="button primary" data-action="close-modal">Done</button>'}`};
}

const claimLabels={awaiting_signature:'Awaiting your confirmation',prepared:'Collection processing',submitted:'Collection processing',uncertain:'Checking collection — do not submit again',confirmed:'Collection confirmed',failed:'Collection failed',cancelled:'Collection cancelled',expired:'Confirmation expired'};
export function entryCollectionMarkup(entry,{claims=[],claimsReady=false,busy=false,claimsError=''}={}){
 const active=claims.find(c=>c.entryId===entry.entryId&&(!entry.contract||c.contract===entry.contract)&&['awaiting_signature','prepared','submitted','uncertain'].includes(c.status));
 if(active)return `<button class="button secondary small" data-action="claim-detail" data-id="${esc(active.id)}">${esc(claimLabels[active.status])}</button>`;
 if(!['claimable','refundable'].includes(entry.status)||BigInt(entry.claimableAmount??0)<=0n)return '';
 return `<button class="button primary small" data-action="claim-prepare" data-entry-id="${esc(entry.entryId)}" ${entry.deploymentId?`data-deployment-id="${esc(entry.deploymentId)}"`:""} ${busy||!claimsReady?'disabled':''}>${entry.status==='refundable'?'Collect refund':'Collect return'}</button>${!claimsReady?`<p class="fine-print">${esc(claimsError||'Checking collection availability…')}</p>`:''}`;
}
export function claimModal(claim,{busy=false,error=''}={}){
 if(!claim)return {title:'Collection unavailable',body:'<p>Refresh your entry details and try again.</p>',footer:'<button class="button primary" data-action="close-modal">Done</button>'};
 const pending=claim.status==='awaiting_signature'&&Date.now()<Date.parse(claim.expiresAt),quote=claim.quote??{},tx=claim.transaction;
 const fee=tx?BigInt(tx.gas)*BigInt(tx.gasPrice):null;
 const rows=[['Entry',`#${esc(claim.entryId)}`],['Type',quote.refund?'Full entry refund':'Contest return'],['Destination','Your account'],['Status',esc(claimLabels[claim.status]??'Checking collection')]];
 if(claim.status==='confirmed'&&claim.result)rows.push(['Received',nativeDollars(claim.result.amount)]);
 else rows.push(['Expected amount',nativeDollars(quote.amount??'0')]);
 if(fee!=null){rows.push(['Network fee · up to',nativeDollars(fee,{up:true})]);rows.push(['Amount after maximum network fee',nativeDollars(BigInt(quote.amount??0)-fee)]);}
 if(claim.networkFee!=null)rows.push(['Network fee paid',nativeDollars(claim.networkFee)]);
 return {title:pending?(quote.refund?'Review your refund':'Review your return'):'Collection details',body:`<dl class="detail-list">${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${error?`<p class="error-message" role="alert">${esc(error)}</p>`:''}<p class="fine-print">Cancelling an unsigned request does not refund an entry. This collects only entry #${esc(claim.entryId)}. Other entries are unchanged. Network fees are paid from your account and may apply if a submitted transaction fails. Demo — no real money.</p>${claim.status==='uncertain'?'<p class="info-box">Your saved collection is being checked. Do not create another transaction.</p>':''}`,footer:`${claim.status==='awaiting_signature'?`<button class="button secondary" data-action="claim-cancel" data-id="${esc(claim.id)}" ${busy?'disabled':''}>Cancel request</button>`:''}${pending?`<button class="button primary" data-action="claim-confirm" data-id="${esc(claim.id)}" ${busy?'disabled':''}>${busy?'Preparing…':'Confirm collection'}</button>`:'<button class="button primary" data-action="close-modal">Done</button>'}`};
}
