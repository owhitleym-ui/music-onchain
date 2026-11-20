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
const date=ms=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'}).format(ms)+' CT';
const label={awaiting_signature:'Awaiting confirmation',prepared:'Processing payment',submitted:'Processing payment',uncertain:'Checking payment — do not pay again',confirmed:'Entry confirmed · awaiting result details',failed:'Payment failed',cancelled:'Cancelled',expired:'Confirmation expired'};
export function paymentStatus(order){return order.status==='awaiting_signature'&&Date.now()>=Date.parse(order.expiresAt)?'Confirmation expired':label[order.status]??'Checking payment';}
const contestLabels={awaiting_result:'Awaiting result',settling:'Result being calculated',claimable:'Ready to claim',partially_claimed:'Partly received',claimed:'Return received',refundable:'Refund available',refunded:'Refund received'};
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
export function accountPurchaseMarkup(current,state) {
 const {orders=[],entryGroups=[],historyError,busy,entriesError,entriesLoading,entriesSnapshot,entriesNextCursor,entriesPage=1}=state;
 if(!current.authenticated)return '<section class="panel live-purchases"><h2 class="panel-title">Your account purchases</h2><p>Sign in to see your test purchases.</p><button class="button secondary" data-action="account-login">Sign up / Log in</button></section>';
 const rows=accountRows(state),sum=key=>entryGroups.reduce((n,g)=>n+BigInt(g[key]??0),0n);
 const verified=Boolean(entriesSnapshot),amount=key=>verified?nativeDollars(sum(key)):'—';
 const artists=new Set(entryGroups.flatMap(g=>g.entries.map(e=>e.artistKey)));
 for(const row of rows)if(row.kind==='order'&&row.order.status==='confirmed')artists.add(state.catalog?.rounds?.find(r=>r.id===row.order.request.roundId)?.artist??'last-bus-home');
 const list=rows.map(row=>{
  if(row.kind==='entry'){
   const g=row.group,e=g.entries[0],title=e?.songId==='last-bus-home'?'Last Bus Home':'Contest entry';
   return `<button class="live-order button secondary" data-action="entry-detail" data-id="${esc(g.id)}"><span><strong>${title} · ${nativeDollars(g.totalPaid)}</strong><span class="subline">${liveCount(g.spotCount)} spots · ${g.entries.every(x=>x.guess===e.guess)?liveCount(e.guess)+' views':'Multiple guesses'} · ${esc(e.horizon)}<br/>${date(g.purchasedAt)}</span></span><span class="status-chip">${esc(contestLabels[g.contestStatus]??'Checking result')}</span></button>`;
  }
  const o=row.order,p=paymentOption(o.request.optionId),archived=o.contract&&state.catalog?.contract&&o.contract!==state.catalog.contract;
  return `<button class="live-order button secondary" data-action="live-detail" data-id="${esc(o.id)}"><span><strong>Last Bus Home · ${formatDollars(p.costCents)}</strong><span class="subline">${p.spots} spots · ${liveCount(o.request.guess)} views · ${esc(o.request.horizon)}<br/>${date(Date.parse(o.createdAt))}${archived?'<br/>Previous contest version':''}</span></span><span class="status-chip">${esc(paymentStatus(o))}</span></button>`;
 }).join('');
 return `<section class="panel live-purchases"><div class="section-heading"><h2 class="panel-title">Your account purchases</h2><button class="button secondary small" data-action="payments-refresh" ${busy?'disabled':''}>Refresh</button></div>
 <p class="fine-print">Shown purchases: ${verified?artists.size:'—'} ${artists.size===1?'artist':'artists'} supported · Received ${amount('receivedAmount')} · Available ${amount('claimableAmount')} · Net received result ${amount('realizedNet')} before network fees.</p><p class="fine-print">Entry payments and contest results are separate. Unclaimed and unsettled entries are excluded from the net result.</p>
 <p class="live-freshness" role="status">${esc(freshness(entriesSnapshot,entriesError))}${entriesLoading?' · Refreshing…':''}</p>
 ${historyError||entriesError?`<p class="error-message" role="alert">${esc(historyError||entriesError)}</p>`:''}
 ${rows.length?`<div class="live-order-list">${list}</div>`:entriesLoading?'<p>Loading your account purchases…</p>':entriesError&&!verified?'<p>Your entry history is unavailable. Refresh to try again.</p>':'<p>No account purchases yet. Confirmed entries and saved payment requests will appear here.</p>'}
 ${entriesPage>1||entriesNextCursor?`<div class="history-pagination"><button class="button secondary small" data-action="entries-previous" ${entriesPage<=1||entriesLoading?'disabled':''}>Previous</button><span>Entry history · Page ${entriesPage}</span><button class="button secondary small" data-action="entries-next" ${!entriesNextCursor||entriesLoading?'disabled':''}>Next</button></div>`:''}</section>`;
}
export function entryModal(group,{orders=[],snapshot}={}) {
 if(!group)return {title:'Entry details unavailable',body:'<p>Refresh My Purchases to check these entries.</p>',footer:'<button class="button primary" data-action="close-modal">Done</button>'};
 const order=orders.find(o=>o.transactionHash===group.transactionHash&&o.contract===group.contract);
 const rows=[['Entry cost',nativeDollars(group.totalPaid)],['Spots',liveCount(group.spotCount)],['Payment status','Entry confirmed'],['Contest status',contestLabels[group.contestStatus]??'Checking result'],['Available to claim',nativeDollars(group.claimableAmount)],['Received',nativeDollars(group.receivedAmount)],['Net received result · before network fees',nativeDollars(group.realizedNet)]];
 if(order?.networkFee!=null)rows.push(['Network fee paid',nativeDollars(order.networkFee)]);
 const four=group.entries.length===4&&group.entries.every(e=>e.spots==='1'&&e.paid==='5000000000000000000'&&e.guess===group.entries[0].guess);
 const records=group.entries.map(e=>`<section class="entry-record"><h3>Entry #${esc(e.entryId)}</h3><dl class="detail-list"><div><dt>Guess</dt><dd>${liveCount(e.guess)} views</dd></div><div><dt>Entry cost</dt><dd>${nativeDollars(e.paid)}</dd></div><div><dt>Spots</dt><dd>${liveCount(e.spots)}</dd></div><div><dt>Reward multiplier</dt><dd>${e.multiplierBps===10000?'1.00 · no bonus':'Up to 1.05'}</dd></div><div><dt>Views measured</dt><dd>${date(e.windowStart)} → ${date(e.windowEnd)}</dd></div><div><dt>Result</dt><dd>${esc(contestLabels[e.status]??'Checking result')}</dd></div>${e.outcome?`<div><dt>Main rank</dt><dd>${liveCount(e.outcome.mainRank)}</dd></div><div><dt>Final return</dt><dd>${nativeDollars(e.outcome.returned)}</dd></div><div><dt>Artist fee</dt><dd>${nativeDollars(e.outcome.artistFee)}</dd></div><div><dt>App fee</dt><dd>${nativeDollars(e.outcome.appFee)}</dd></div>`:''}</dl></section>`).join('');
 return {title:'Your test entry details',body:`<dl class="detail-list">${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${four?'<div class="info-box">Four separate $5 entries. Same guess. No bonus. All four were purchased together.</div>':''}${records}<p class="fine-print">${esc(freshness(snapshot))}</p><p class="fine-print">Demo — no real money. Available returns have not been received yet. Network fees are separate.</p>`,footer:'<button class="button primary" data-action="close-modal">Done</button>'};
}
export function orderModal(order,{rounds,error,busy,confirm=false}) {
 if(!order)return {title:'Purchase unavailable',body:'<p>Refresh My Purchases to check this payment.</p>',footer:'<button class="button primary" data-action="close-modal">Done</button>'};
 const option=paymentOption(order.request.optionId),round=order.round??rounds?.find(r=>r.id===order.request.roundId),h=order.request.horizon;
 const start=round?round.start+({'24h':0,'48h':24,week:144}[h])*3600000:null;
 const rows=[['Song','Last Bus Home'],['Prediction window',h==='week'?'1 week':h],...(round?[['Round',date(round.start)],['Views measured',date(start)+' → '+date(start+86400000)],['Entry deadline',date(round.deadline)]]:[]),['Your guess',esc(order.request.guess)+' views'],['Entry cost',formatDollars(option.costCents)],['Spots',option.spots],['Reward multiplier',option.multiplier===1?'1.00 · no bonus':'Up to 1.05'],['Payment status',paymentStatus(order)]];
 if(order.transaction){const fee=BigInt(order.transaction.gas)*BigInt(order.transaction.gasPrice);rows.push(['Network fee · up to',nativeDollars(fee,{up:true})],['Total · up to',nativeDollars(BigInt(order.transaction.value)+fee,{up:true})]);}
 else if(order.networkFee!=null)rows.push(['Network fee paid',nativeDollars(order.networkFee,{up:true})]);
 const canConfirm=confirm&&order.status==='awaiting_signature'&&Date.now()<Date.parse(order.expiresAt);
 return {title:canConfirm?'Confirm your test purchase':'Test purchase details',body:`<dl class="detail-list">${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${option.id==='four'?'<div class="info-box">Four separate $5 entries. Same guess. No bonus. All four are purchased together.</div>':''}${order.entryIds?.length?`<div class="breakdown-section"><h3>Entry records</h3><ul>${order.entryIds.map(id=>`<li>Entry #${esc(id)} · ${option.id==='bundle'?'10 spots · $50':'1 spot · $5'} · ${esc(order.request.guess)} views</li>`).join('')}</ul></div>`:''}${error?`<p class="error-message" role="alert">${esc(error)}</p>`:''}<p class="fine-print">Demo — no real money. Network fees are additional and may apply even if a submitted payment fails. A confirmed payment is separate from its contest result.</p>`,footer:`${order.status==='awaiting_signature'?`<button class="button secondary" data-action="payment-cancel" data-id="${esc(order.id)}" ${busy?'disabled':''}>Cancel purchase</button>`:''}${canConfirm?`<button class="button primary" data-action="payment-confirm" data-id="${esc(order.id)}" ${busy?'disabled':''}>${busy?'Preparing payment…':'Confirm '+formatDollars(option.costCents)+' purchase'}</button>`:'<button class="button primary" data-action="close-modal">Done</button>'}`};
}
