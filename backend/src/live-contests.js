import {createHash} from 'node:crypto';
import {encodeAbiParameters,keccak256,decodeEventLog} from 'viem';
import {CONTEST_ABI,HORIZONS,SONG_ID} from './contest-chain.js';
import {ORIGINAL_OWNER,sameAddress} from './config.js';
import {AppError} from './errors.js';

const uint=value=>typeof value==='string'&&/^\d{1,78}$/.test(value)&&BigInt(value)<2n**256n;
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const millis=seconds=>{const n=Number(BigInt(seconds)*1000n);if(!Number.isSafeInteger(n)||!Number.isFinite(new Date(n).getTime()))throw new AppError('LIVE_DATA_UNAVAILABLE');return n;};
const ownerKey=identity=>createHash('sha256').update(identity.userId+':'+identity.wallet.toLowerCase()).digest('hex');
export const livePoolId=(id,horizon)=>keccak256(encodeAbiParameters([{type:'uint256'},{type:'uint8'}],[BigInt(id),HORIZONS.indexOf(horizon)]));
const unavailable=()=>new AppError('LIVE_DATA_UNAVAILABLE');
const updating=()=>new AppError('LIVE_DATA_UPDATING');
const entryStatus=(entry,pool,block)=>entry.claimed?(pool.phase===5?'refunded':'claimed')
  :pool.phase===5||(pool.phase!==4&&block.timestamp>=pool.refundAt)?'refundable'
  :pool.phase===4?'claimable':pool.phase>0?'settling':'awaiting_result';

export function createLiveContests({config,store,chain,clock=Date.now,cacheMs=5000}) {
  let baseCache=null,basePending=null,verifiedUntil=0,verification=null;
  let lastCatalog=null;
  const rounds=new Map(),pending=new Map(),accounts=new Map();
  const trim=map=>{while(map.size>100)map.delete(map.keys().next().value);};
  const metadata=(block,status='current',verifiedAt=clock())=>({syncStatus:status,asOfBlock:String(block.number),verifiedAt:new Date(verifiedAt).toISOString(),checkedAt:new Date(clock()).toISOString(),chainAvailable:true});
  async function verify() {
    if(clock()<verifiedUntil)return;
    verification??=chain.verify().then(()=>{verifiedUntil=clock()+60000;}).finally(()=>{verification=null;});
    await verification;
  }
  async function base() {
    if(baseCache&&baseCache.until>clock())return baseCache.value;
    if(basePending)return basePending;
    basePending=(async()=>{
      await verify();const block=await chain.snapshot();
      const [catalog,counters]=await Promise.all([store.catalog(block.number),chain.counters(block.number)]);
      if(BigInt(catalog.roundCount)!==counters.nextRoundId-1n||BigInt(catalog.maxRoundId)!==counters.nextRoundId-1n)throw updating();
      const all=catalog.rounds.map(row=>({...row,start:millis(row.startSeconds),deadline:millis(BigInt(row.startSeconds)+3600n)}));
      const featured=all.filter(row=>row.songId.toLowerCase()===SONG_ID&&row.musicId==='demo:last-bus-home'&&sameAddress(row.artist,ORIGINAL_OWNER));
      const value={block,all,featured,entriesComplete:BigInt(catalog.entryCount)===counters.nextEntryId-1n};
      baseCache={value,until:clock()+cacheMs};return value;
    })().finally(()=>{basePending=null;});
    return basePending;
  }
  const roundPublic=(row,block)=>({id:row.id,songId:'last-bus-home',musicId:row.musicId,artist:row.artist,start:row.start,deadline:row.deadline,
    entryStatus:Number(block.timestamp)*1000<row.start?'upcoming':Number(block.timestamp)*1000<row.deadline?'open':'closed'});
  function stale(previous,error) {
    if(!previous)throw error instanceof AppError?error:unavailable();
    const syncStatus=error?.code==='LIVE_DATA_UPDATING'?'catching_up':'unavailable';
    return {...previous,snapshot:{...previous.snapshot,syncStatus,checkedAt:new Date(clock()).toISOString(),chainAvailable:syncStatus==='catching_up'}};
  }
  async function catalog() {
    if(!config.atomic)return {ready:false,rounds:[],message:'Live test contests are not configured yet.'};
    try {
      const b=await base();
      lastCatalog={ready:true,chainId:config.chainId,contract:config.contract,rounds:b.featured.map(row=>roundPublic(row,b.block)),serverTime:Number(b.block.timestamp)*1000,snapshot:metadata(b.block)};
      return lastCatalog;
    } catch(error){return stale(lastCatalog,error);}
  }
  async function round(id) {
    if(!uint(id)||BigInt(id)===0n)throw new AppError('BAD_REQUEST',400);
    id=BigInt(id).toString();
    const cached=rounds.get(id);if(cached?.until>clock())return cached.value;
    if(pending.has(id))return pending.get(id);
    const promise=(async()=>{
      try {
        const b=await base(),row=b.featured.find(row=>row.id===id);
        if(!row)throw new AppError('ROUND_UNAVAILABLE',404);
        const poolIds=Object.fromEntries(HORIZONS.map(h=>[h,livePoolId(id,h)]));
        const [indexed,actual,storedRound]=await Promise.all([store.round(b.block.number,poolIds),Promise.all(HORIZONS.map(h=>chain.readPool(id,h,b.block.number))),chain.readRound(id,b.block.number)]);
        if(!storedRound.exists||storedRound.start!==BigInt(row.startSeconds)||storedRound.musicId!==row.musicId||!sameAddress(storedRound.artist,row.artist)||storedRound.songId.toLowerCase()!==row.songId.toLowerCase())throw updating();
        const pools={};
        for(let i=0;i<HORIZONS.length;i++) {
          const h=HORIZONS[i],p=actual[i],s=indexed[h];
          if(!s||!['entryCount','spotCount','peopleCount','totalDeposits'].every(key=>uint(s[key])&&BigInt(s[key])===p[key]))throw updating();
          const average=s.averageGuess==null?null:Number(s.averageGuess);
          pools[h]={...s,roundId:id,horizon:h,roundStart:row.start,deadline:row.deadline,
            windowStart:millis(p.windowStart),windowEnd:millis(p.windowEnd),refundAt:millis(p.refundAt),
            serverTime:Number(b.block.timestamp)*1000,phase:p.phase,open:p.phase===0&&b.block.timestamp>=BigInt(row.startSeconds)&&b.block.timestamp<BigInt(row.startSeconds)+3600n,
            statsComplete:true,average:average!=null&&average<=Number.MAX_SAFE_INTEGER?average:null,block:String(b.block.number)};
        }
        const value={round:roundPublic(row,b.block),pools,snapshot:metadata(b.block)};
        rounds.set(id,{value,until:clock()+cacheMs});trim(rounds);return value;
      } catch(error){if(error?.status===404)throw error;return stale(cached?.value,error);}
    })().finally(()=>pending.delete(id));pending.set(id,promise);return promise;
  }

  function decodeCursor(cursor,identity) {
    if(!cursor)return null;
    try {
      if(typeof cursor!=='string'||cursor.length>2048||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();
      const c=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
      if(!uint(c.block)||!uint(c.asOfBlock)||BigInt(c.block)>BigInt(c.asOfBlock)||!hash(c.hash)||c.contract!==config.contract||c.owner!==ownerKey(identity))throw Error();
      return c;
    } catch {throw new AppError('BAD_REQUEST',400);}
  }
  async function entries(identity,cursor=null) {
    const c=decodeCursor(cursor,identity),cacheKey=ownerKey(identity)+':'+(cursor??'');
    const cached=accounts.get(cacheKey);if(cached?.until>clock())return cached.value;
    if(pending.has(cacheKey))return pending.get(cacheKey);
    const promise=(async()=>{
      try {
        const b=await base();
        if(c&&BigInt(c.asOfBlock)>b.block.number)throw new AppError('BAD_REQUEST',400);
        const block=b.block,membershipBlock=c?BigInt(c.asOfBlock):block.number;
        const catalogAt=c?await store.catalog(membershipBlock):null;
        const countAt=c?await chain.counters(membershipBlock):null;
        let complete=c?BigInt(catalogAt.entryCount)===countAt.nextEntryId-1n:b.entriesComplete;
        const result=await store.entries(identity.wallet.toLowerCase(),membershipBlock,c?{block:c.block,hash:c.hash}:null);
        const source=result.groups.slice(0,10),groups=[],poolCache=new Map();
        const getPool=async(row,h)=>{const key=row.id+':'+h;if(!poolCache.has(key))poolCache.set(key,chain.readPool(row.id,h,block.number));return poolCache.get(key);};
        for(const group of source) {
          const receipt=await chain.receipt(group.transactionHash);
          if(!receipt||receipt.status!=='success'||receipt.blockNumber>block.number)throw updating();
          const expected=[];
          for(const log of receipt.logs) {
            if(!sameAddress(log.address,config.contract))continue;
            let e;try{e=decodeEventLog({abi:CONTEST_ABI,topics:log.topics,data:log.data,strict:true});}catch{continue;}
            if(e.eventName==='EntryRecorded'&&sameAddress(e.args.payer,identity.wallet))expected.push(e.args.entryId.toString());
          }
          const ids=group.entries.map(e=>e.entryId);
          if(expected.length!==ids.length||new Set(ids).size!==ids.length||!expected.every(id=>ids.includes(id))){complete=false;continue;}
          const records=[];
          for(const indexed of group.entries) {
            if(indexed.blockHash.toLowerCase()!==receipt.blockHash.toLowerCase()||BigInt(group.block)!==receipt.blockNumber)throw unavailable();
            const entry=await chain.readEntry(indexed.entryId,block.number);
            if(!sameAddress(entry.payer,identity.wallet)||entry.pool.toLowerCase()!==indexed.pool.toLowerCase()||entry.guess!==BigInt(indexed.guess)||entry.paid!==BigInt(indexed.paid)||BigInt(entry.spots)!==BigInt(indexed.spots)||entry.purchasedAt!==BigInt(indexed.purchasedAt))throw unavailable();
            const row=b.all.find(row=>row.id===entry.roundId.toString());
            if(!row||entry.horizon>2||livePoolId(row.id,HORIZONS[entry.horizon])!==entry.pool.toLowerCase())throw updating();
            const horizon=HORIZONS[entry.horizon],pool=await getPool(row,horizon),status=entryStatus(entry,pool,block);
            let outcome=null,claimable=0n,received=0n;
            if(pool.phase===4)outcome=await chain.readOutcome(indexed.entryId,block.number);
            if(entry.claimed){if(pool.phase!==4&&pool.phase!==5)throw unavailable();received=pool.phase===5?entry.paid:outcome.returned;}
            else if(status==='claimable'||status==='refundable')claimable=await chain.claimable(indexed.entryId,block.number);
            records.push({entryId:indexed.entryId,roundId:row.id,horizon,songId:row.musicId==='demo:last-bus-home'?'last-bus-home':null,
              artistKey:row.artist,guess:indexed.guess,paid:indexed.paid,spots:indexed.spots,multiplierBps:entry.multiplierBps,
              purchasedAt:millis(entry.purchasedAt),windowStart:millis(pool.windowStart),windowEnd:millis(pool.windowEnd),status,
              claimableAmount:claimable.toString(),receivedAmount:received.toString(),realizedNet:entry.claimed?(received-entry.paid).toString():'0',
              outcome:outcome?JSON.parse(JSON.stringify(outcome,(_key,v)=>typeof v==='bigint'?v.toString():v)):null});
          }
          const claimed=records.filter(e=>e.status==='claimed'||e.status==='refunded').length;
          const status=claimed&&claimed<records.length?'partially_claimed':records[0]?.status??'awaiting_result';
          const sum=key=>records.reduce((n,e)=>n+BigInt(e[key]),0n).toString();
          groups.push({id:group.transactionHash,transactionHash:group.transactionHash,contract:config.contract,chainId:config.chainId,
            purchasedAt:millis(group.purchasedAt),entries:records,contestStatus:status,totalPaid:sum('paid'),spotCount:sum('spots'),
            claimableAmount:sum('claimableAmount'),receivedAmount:sum('receivedAmount'),realizedNet:sum('realizedNet')});
        }
        const more=result.groups.length>10,last=source.at(-1);
        const nextCursor=more&&last?Buffer.from(JSON.stringify({block:last.block,hash:last.transactionHash,asOfBlock:String(membershipBlock),contract:config.contract,owner:ownerKey(identity)})).toString('base64url'):null;
        const sum=key=>groups.reduce((n,g)=>n+BigInt(g[key]),0n).toString();
        const value={groups,nextCursor,totalGroups:result.totalGroups,historyAsOfBlock:String(membershipBlock),indexComplete:complete,summary:{scope:'shown',receivedAmount:sum('receivedAmount'),claimableAmount:sum('claimableAmount'),realizedNet:sum('realizedNet')},snapshot:metadata(block,complete?'current':'catching_up')};
        accounts.set(cacheKey,{value,until:clock()+10000});trim(accounts);return value;
      }catch(error){if(error?.status===400)throw error;return stale(cached?.value,error);}
    })().finally(()=>pending.delete(cacheKey));pending.set(cacheKey,promise);return promise;
  }
  return {catalog,round,pool:async(id,horizon)=>{if(!HORIZONS.includes(horizon))throw new AppError('BAD_REQUEST',400);const r=await round(id);return {...r.pools[horizon],snapshot:r.snapshot};},entries,
    invalidate(){baseCache=null;for(const v of rounds.values())v.until=0;for(const v of accounts.values())v.until=0;}};
}
