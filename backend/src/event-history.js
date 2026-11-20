import {marketAbi,isScheduled} from './market-model.js';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createPublicClient, decodeEventLog, http } from 'viem';
import { createRpcReadGuard } from './rpc-reads.js';

const ABI = JSON.parse(readFileSync(new URL('../../contracts/abi/MusicPredictionContest.json', import.meta.url), 'utf8'));
const CONTRACT = '0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083';
const safe = value => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v));
const hex32 = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : value;
const fingerprint = row => JSON.stringify(canonical({
  block_number: String(row.block_number), block_hash: row.block_hash,
  transaction_hash: row.transaction_hash, log_index: row.log_index,
  event_name: row.event_name, args: row.args,
  topics: row.raw_log.topics.map(topic => topic.toLowerCase()),
  data: row.raw_log.data.toLowerCase(),
}));
const id = row => row.transaction_hash + ':' + row.log_index;
const fail = code => { throw new Error(code); };

function decode(log, start, end, CONTRACT, ABI) {
  if (log.address?.toLowerCase() !== CONTRACT || log.removed ||
      !hex32(log.blockHash) || !hex32(log.transactionHash) ||
      typeof log.blockNumber !== 'bigint' || log.blockNumber < start || log.blockNumber > end ||
      !Number.isSafeInteger(log.logIndex) || log.logIndex < 0) fail('INVALID_CHAIN_LOG');
  let event;
  try { event = decodeEventLog({ abi: ABI, topics: log.topics, data: log.data, strict: true }); }
  catch { fail('INVALID_CHAIN_EVENT'); }
  return {
    contract_address:CONTRACT,block_number: log.blockNumber.toString(), block_hash: log.blockHash.toLowerCase(),
    transaction_hash: log.transactionHash.toLowerCase(), log_index: log.logIndex,
    event_name: event.eventName, args: safe(event.args),
    raw_log: { ...safe(log), blockNumber: '0x' + log.blockNumber.toString(16), logIndex: '0x' + log.logIndex.toString(16) },
  };
}

export async function checkEventHistory(config, { database, chain, backfill = false, readGuard = createRpcReadGuard() } = {}) {
  const target=config.contract,first=BigInt(config.deployment.creationBlock),abi=isScheduled(config)?marketAbi(config):ABI;
  if (!config.atomic || (!isScheduled(config)&&(config.contract !== CONTRACT||config.deployment.creationBlock!==73100560)) || config.deployment.chainId !== 5042002) fail('EVENT_DEPLOYMENT_REQUIRED');
  chain ??= createPublicClient({ transport: http(config.rpc, { timeout: 12000, retryCount: 1 }), cacheTime: 0 });
  if (await readGuard.read(() => chain.getChainId()) !== 5042002) fail('WRONG_CHAIN');
  const snapshot = await readGuard.read(() => chain.getBlock({ blockTag: 'latest' }));
  if (snapshot.number == null || !hex32(snapshot.hash) || snapshot.number < first) fail('INVALID_CHAIN_SNAPSHOT');
  const code = await readGuard.read(() => chain.getCode({ address: target, blockNumber: snapshot.number }));
  if (!code || createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex') !== config.deployment.runtimeSha256) fail('DEPLOYMENT_CODE_MISMATCH');
  const events = [], seen = new Set();
  for (let fromBlock = first; fromBlock <= snapshot.number; fromBlock += 1000n) {
    const toBlock = fromBlock + 999n < snapshot.number ? fromBlock + 999n : snapshot.number;
    const logs = await readGuard.logs(() => chain.getLogs({ address: target, fromBlock, toBlock }));
    for (const log of logs) {
      const row = decode(log, fromBlock, toBlock,target,abi);
      if (seen.has(id(row))) fail('DUPLICATE_CHAIN_LOG');
      seen.add(id(row)); events.push(row);
    }
  }
  // Verify each event's actual successful receipt, not only a provider log list.
  const receipts = new Map();
  for (const row of events) {
    let receipt = receipts.get(row.transaction_hash);
    if (!receipt) {
      receipt = await readGuard.read(() => chain.getTransactionReceipt({ hash: row.transaction_hash }));
      receipts.set(row.transaction_hash, receipt);
    }
    const log = receipt.logs.find(log => log.address.toLowerCase() === target && log.logIndex === row.log_index);
    if (receipt.status !== 'success' || receipt.blockHash.toLowerCase() !== row.block_hash ||
        receipt.blockNumber !== BigInt(row.block_number) || !log || fingerprint(decode(log, first, snapshot.number,target,abi)) !== fingerprint(row)) fail('EVENT_RECEIPT_MISMATCH');
  }
  // Snapshot must still be canonical before any backfill writes.
  const current = await readGuard.read(() => chain.getBlock({ blockNumber: snapshot.number }));
  if (current.hash !== snapshot.hash) fail('CHAIN_CHANGED_RETRY');
  let inserted = 0;
  if (backfill) {
    // Batch through the SAME transaction, conflict checks and deduplication as
    // the signed webhook. Never overwrite/delete a conflicting historical log.
    const run = randomUUID();
    for (let offset = 0; offset < events.length; offset += 500) {
      const batch = events.slice(offset, offset + 500);
      const hash = createHash('sha256').update(JSON.stringify(canonical(batch))).digest('hex');
      const { data, error } = await database.rpc('music_ingest_chain_events', {
        p_nonce: 'rpc-backfill:' + run + ':' + offset, p_hash: hash,
        p_metadata: { source: 'operator-rpc-backfill', chainId: 5042002, contract: target, throughBlock: snapshot.number.toString(), snapshotHash: snapshot.hash },
        p_events: batch,
      });
      if (error?.message?.includes('EVENT_CONFLICT')) fail('EVENT_HISTORY_CONFLICT');
      if (error || !data || !Number.isSafeInteger(data.inserted) || data.inserted < 0) fail('EVENT_STORAGE_UNAVAILABLE');
      inserted += data.inserted;
    }
  }
  const stored = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await database.from('music_chain_events').select('*')
      .eq('chain_id', 5042002).eq('contract_address', target)
      .lte('block_number', snapshot.number.toString())
      .order('block_number').order('log_index').range(offset, offset + 499);
    if (error || !Array.isArray(data)) fail('EVENT_STORAGE_UNAVAILABLE');
    stored.push(...data);
    if (data.length < 500) break;
  }
  const indexed = new Map(stored.map(row => [id(row), row]));
  let missing = 0, conflicts = 0;
  for (const row of events) {
    const existing = indexed.get(id(row));
    if (!existing) missing++;
    else if (fingerprint(row) !== fingerprint(existing)) conflicts++;
  }
  const extra = stored.filter(row => !seen.has(id(row))).length;
  return {
    chainId: 5042002, contract: target, throughBlock: snapshot.number.toString(),
    chainEvents: events.length, storedEvents: stored.length,
    missing, conflicts, extra, inserted,
    consistent: missing === 0 && conflicts === 0 && extra === 0,
  };
}
