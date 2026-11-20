import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { encodeEventTopics, encodeAbiParameters, parseAbi } from 'viem';
import { checkEventHistory as checkHistory } from '../src/event-history.js';
import { createRpcReadGuard } from '../src/rpc-reads.js';
const checkEventHistory = (config, options) => checkHistory(config, {
  readGuard: createRpcReadGuard({ logIntervalMs: 0, pause: async () => {} }), ...options,
});

const C = '0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083';
const code = '0x123456';
const abi = parseAbi(['event ReserveFunded(address indexed funder, uint256 amount)']);
const config = { atomic: true, contract: C, deployment: { chainId: 5042002, creationBlock: 73100560, runtimeSha256: createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex') } };
const log = (n, block) => ({
  address: C, blockHash: '0x' + String(n + 1).repeat(64), blockNumber: BigInt(block),
  transactionHash: '0x' + String(n + 3).repeat(64), logIndex: n, transactionIndex: 0, removed: false,
  topics: encodeEventTopics({ abi, eventName: 'ReserveFunded', args: { funder: '0x170249f9ac07d25f97bc1957b68a0011543d07ad' } }),
  data: encodeAbiParameters([{ type: 'uint256' }], [2500000000000000000n]),
});
const logs = [log(0, 73100560), log(1, 73102042)];
const head = { number: 73102587n, hash: '0x' + 'a'.repeat(64) };
function chain() {
  const ranges = [];
  return {
    ranges,
    getChainId: async () => 5042002,
    getBlock: async () => head,
    getCode: async () => code,
    getLogs: async ({ fromBlock, toBlock }) => { ranges.push([fromBlock, toBlock]); return logs.filter(log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock); },
    getTransactionReceipt: async ({ hash }) => { const found = logs.find(log => log.transactionHash === hash); return { status: 'success', blockHash: found.blockHash, blockNumber: found.blockNumber, logs: [found] }; },
  };
}

test('event-history recovery and reconciliation against durable SQL storage', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const sql = await readFile(new URL('../supabase/003_quicknode_events.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  let rpcCalls = 0;
  const database = {
    async rpc(name, params) {
      rpcCalls++;
      try { const r = await db.query(`select public.${name}($1,$2,$3,$4) as result`, [params.p_nonce, params.p_hash, JSON.stringify(params.p_metadata), JSON.stringify(params.p_events)]); return { data: r.rows[0].result, error: null }; }
      catch (error) { return { data: null, error }; }
    },
    from(table) {
      assert.equal(table, 'music_chain_events');
      const filters = {};
      return {
        select() { return this; },
        eq(field, value) { filters[field] = value; return this; },
        lte(field, value) { filters[field] = value; return this; },
        order() { return this; },
        async range(offset, end) {
          const r = await db.query('select * from public.music_chain_events where chain_id=$1 and contract_address=$2 and block_number<=$3 order by block_number,log_index offset $4 limit $5', [filters.chain_id, filters.contract_address, filters.block_number, offset, end - offset + 1]);
          return { data: r.rows, error: null };
        },
      };
    },
  };
  await t.test('read-only check identifies missing data using bounded, gap-free chain ranges', async () => {
    const c = chain();
    const result = await checkEventHistory(config, { database, chain: c });
    assert.equal(result.chainEvents, 2); assert.equal(result.missing, 2); assert.equal(result.consistent, false);
    assert.equal(rpcCalls, 0);
    assert.deepEqual(c.ranges, [[73100560n, 73101559n], [73101560n, 73102559n], [73102560n, 73102587n]]);
  });
  await t.test('backfill recovers missing records; repeat after restart does not duplicate them', async () => {
    const first = await checkEventHistory(config, { database, chain: chain(), backfill: true });
    assert.equal(first.inserted, 2); assert.equal(first.consistent, true);
    const second = await checkEventHistory(config, { database, chain: chain(), backfill: true });
    assert.equal(second.inserted, 0); assert.equal(second.storedEvents, 2); assert.equal(second.consistent, true);
    assert.equal((await db.query('select count(*)::int as n from public.music_event_deliveries')).rows[0].n, 2);
    const check = await checkEventHistory(config, { database, chain: chain() });
    assert.equal(check.consistent, true); assert.equal(check.inserted, 0);
  });
  await t.test('repair also works if old delivery receipts survive a partial data restore', async () => {
    await db.exec('delete from public.music_chain_events where log_index=0');
    const before = await checkEventHistory(config, { database, chain: chain() });
    assert.equal(before.missing, 1);
    const repaired = await checkEventHistory(config, { database, chain: chain(), backfill: true });
    assert.equal(repaired.inserted, 1); assert.equal(repaired.consistent, true);
  });
  await t.test('one missing record is repaired after a database interruption', async () => {
    await db.exec('truncate public.music_chain_events, public.music_event_deliveries');
    const offline = { ...database, rpc: async () => ({ error: { message: 'offline' } }) };
    await assert.rejects(checkEventHistory(config, { database: offline, chain: chain(), backfill: true }), /EVENT_STORAGE_UNAVAILABLE/);
    assert.equal((await db.query('select count(*)::int as n from public.music_chain_events')).rows[0].n, 0);
    assert.equal((await checkEventHistory(config, { database, chain: chain(), backfill: true })).inserted, 2);
  });
  await t.test('wrong chain, code or active deployment prevents writes', async () => {
    const before = rpcCalls;
    await assert.rejects(checkEventHistory({ ...config, atomic: false }, { database, chain: chain(), backfill: true }), /EVENT_DEPLOYMENT_REQUIRED/);
    await assert.rejects(checkEventHistory(config, { database, chain: { ...chain(), getChainId: async () => 1 }, backfill: true }), /WRONG_CHAIN/);
    await assert.rejects(checkEventHistory(config, { database, chain: { ...chain(), getCode: async () => '0xdead' }, backfill: true }), /DEPLOYMENT_CODE_MISMATCH/);
    assert.equal(rpcCalls, before);
  });
  await t.test('temporary public RPC throttling retries; persistent throttling does not write', async () => {
    const before = rpcCalls, c = chain(); let calls = 0;
    const read = c.getLogs;
    c.getLogs = async args => { if (++calls <= 2) throw Object.assign(Error('limited'), { cause: { code: -32005 } }); return read(args); };
    assert.equal((await checkEventHistory(config, { database, chain: c })).consistent, true);
    assert.equal(calls, 5);
    const broken = { ...chain(), getLogs: async () => { throw Object.assign(Error('limited'), { code: -32005 }); } };
    await assert.rejects(checkEventHistory(config, { database, chain: broken, backfill: true }), /limited/);
    assert.equal(rpcCalls, before);
  });
  await t.test('RPC errors, malformed logs, failed receipts and changed snapshots never write', async () => {
    const before = rpcCalls;
    await assert.rejects(checkEventHistory(config, { database, chain: { ...chain(), getLogs: async () => { throw Error('RPC offline'); } }, backfill: true }), /RPC offline/);
    await assert.rejects(checkEventHistory(config, { database, chain: { ...chain(), getLogs: async () => [{ ...logs[0], removed: true }] }, backfill: true }), /INVALID_CHAIN_LOG/);
    await assert.rejects(checkEventHistory(config, { database, chain: { ...chain(), getTransactionReceipt: async () => ({ status: 'reverted', blockHash: logs[0].blockHash, blockNumber: logs[0].blockNumber, logs: [logs[0]] }) }, backfill: true }), /EVENT_RECEIPT_MISMATCH/);
    const c = chain(); c.getBlock = async args => args.blockTag ? head : { ...head, hash: '0x' + 'b'.repeat(64) };
    await assert.rejects(checkEventHistory(config, { database, chain: c, backfill: true }), /CHAIN_CHANGED_RETRY/);
    assert.equal(rpcCalls, before);
  });
  await t.test('conflicting stored data is reported and never overwritten', async () => {
    await db.exec("update public.music_chain_events set args='{}'::jsonb where log_index=0");
    const result = await checkEventHistory(config, { database, chain: chain() });
    assert.equal(result.conflicts, 1); assert.equal(result.consistent, false);
    // Clear only the receipt of the previous backfill in this TEST database to
    // force a second independent delivery through the conflict checks.
    await db.exec('truncate public.music_event_deliveries');
    await assert.rejects(checkEventHistory(config, { database, chain: chain(), backfill: true }), /EVENT_HISTORY_CONFLICT/);
    assert.deepEqual((await db.query('select args from public.music_chain_events where log_index=0')).rows[0].args, {});
  });
});
