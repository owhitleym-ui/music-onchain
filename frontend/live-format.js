export function liveCount(value) {
  if(value==null)return '—';
  if(typeof value==='string'&&/^\d+$/.test(value))return BigInt(value).toLocaleString('en-US');
  return new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value);
}
export function liveAverage(value) {
  if(value==null)return '—';
  const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if(!match)return '—';
  const fraction=(match[2]??'').replace(/0+$/,'');
  return BigInt(match[1]).toLocaleString('en-US')+(fraction?'.'+fraction:'');
}
export function freshness(snapshot,error='') {
  if(!snapshot)return error?'Live details unavailable. Please try again.':'Checking live details…';
  const date=new Date(snapshot.verifiedAt);
  const time=Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'America/Chicago'}).format(date)+' CT':'earlier';
  return snapshot.syncStatus==='current'?'Updated '+time:snapshot.syncStatus==='catching_up'?'Updating… Last verified '+time:'Last verified '+time+'. Refresh is temporarily unavailable.';
}
