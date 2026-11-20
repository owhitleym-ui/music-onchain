import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';

// Execute the actual pasteable file, substituting only npm: import specifiers.
const file = new URL('../../supabase/functions/music-quicknode-events/index.ts', import.meta.url);
let source = await readFile(file, 'utf8');
source = source.replace('npm:@supabase/supabase-js@2.119.2', import.meta.resolve('@supabase/supabase-js'))
  .replace('npm:viem@2.58.1', import.meta.resolve('viem'));
const { CONTRACT, createHandler, normalizeEvents } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const secret = 'test-only-stream-secret-not-a-real-key-123456789';
const abi = parseAbi(['event ReserveFunded(address indexed funder, uint256 amount)']);
const funder = '0x170249f9ac07d25f97bc1957b68a0011543d07ad';
const log = () => ({
  address: CONTRACT, blockNumber: '0x' + (73102587).toString(16), blockHash: '0x' + '1'.repeat(64),
  transactionHash: '0x' + '2'.repeat(64), logIndex: '0x0', removed: false,
  topics: encodeEventTopics({ abi, eventName: 'ReserveFunded', args: { funder } }),
  data: encodeAbiParameters([{ type: 'uint256' }], [2500000000000000000n]),
});
const payload = () => ({ schemaVersion: 1, chainId: 5042002, contract: CONTRACT, metadata: { network: 'arc-testnet' }, logs: [log()] });
function signed(value = payload(), options = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const nonce = options.nonce ?? 'fixture-nonce', timestamp = options.timestamp ?? '1795136400';
  const signature = createHmac('sha256', options.secret ?? secret).update(nonce + timestamp + body).digest('hex');
  return new Request('https://example.test/receiver', { method: 'POST', body, headers: {
    'content-type': 'application/json', 'x-qn-nonce': nonce, 'x-qn-timestamp': timestamp,
    'x-qn-signature': signature, ...options.headers,
  } });
}

test('valid signed contract log decodes and commits before acknowledgment', async () => {
  let finish, called;
  const handler = createHandler({ secret, persist: delivery => { called = delivery; return new Promise(resolve => { finish = resolve; }); } });
  let complete = false;
  const pending = handler(signed()).then(r => { complete = true; return r; });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(complete, false);
  assert.equal(called.events[0].event_name, 'ReserveFunded');
  assert.equal(called.events[0].args.amount, '2500000000000000000');
  assert.equal(called.events[0].block_number, '73102587');
  assert.equal(called.hash, createHash('sha256').update(JSON.stringify(payload())).digest('hex'));
  finish({ inserted: 1 });
  assert.equal((await pending).status, 200);
});

test('missing secret, missing authentication, forged signatures and modified payloads cannot persist', async () => {
  let calls = 0; const persist = async () => { calls++; };
  assert.equal((await createHandler({ persist })(signed())).status, 503);
  const handler = createHandler({ secret, persist });
  assert.equal((await handler(new Request('https://example.test', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await handler(signed(payload(), { secret: 'attacker' }))).status, 401);
  assert.equal((await handler(signed(payload(), { headers: { 'x-qn-signature': '00' } }))).status, 401);
  const request = signed(); const headers = Object.fromEntries(request.headers);
  assert.equal((await handler(new Request(request.url, { method: 'POST', headers, body: JSON.stringify({ ...payload(), logs: [] }) }))).status, 401);
  assert.equal(calls, 0);
});

test('old correctly signed delivery remains recoverable after an extended database outage', async () => {
  let calls = 0;
  const response = await createHandler({ secret, persist: async () => { calls++; } })(signed(payload(), { timestamp: '1700000000' }));
  assert.equal(response.status, 200); assert.equal(calls, 1);
});

test('database failures return retryable error and never expose credentials or database messages', async () => {
  const response = await createHandler({ secret, persist: async () => { throw Error('private SQL connection ' + secret); } })(signed());
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'EVENT_STORAGE_UNAVAILABLE');
});

test('wrong chain, deployment, network, old blocks, removed logs and malformed ABI fail closed', async () => {
  let calls = 0;
  const handler = createHandler({ secret, persist: async () => { calls++; } });
  const invalid = [
    { ...payload(), chainId: 1 }, { ...payload(), schemaVersion: 3 },
    { ...payload(), contract: '0x' + 'a'.repeat(40) }, { ...payload(), metadata: { network: 'ethereum-mainnet' } },
    { ...payload(), logs: [{ ...log(), address: '0x' + 'a'.repeat(40) }] },
    { ...payload(), logs: [{ ...log(), blockNumber: '73100559' }] },
    { ...payload(), logs: [{ ...log(), removed: true }] },
    { ...payload(), logs: [{ ...log(), data: '0x12' }] },
    { ...payload(), logs: [{ ...log(), topics: ['0x' + '0'.repeat(64)] }] },
    { ...payload(), logs: [{ ...log(), transactionHash: '0x12' }] },
    { ...payload(), logs: [{ ...log(), logIndex: '-1' }] },
    { ...payload(), logs: [{ ...log(), blockNumber: '18446744073709551616' }] },
    { ...payload(), logs: Array(2001).fill(log()) },
    { ...payload(), metadata: [] }, null, '{invalid-json',
  ];
  for (const value of invalid) assert.equal((await handler(signed(value))).status, 422);
  assert.equal(calls, 0);
});

test('large bodies, broken request streams, invalid UTF8 and unsupported compression are rejected', async () => {
  const handler = createHandler({ secret, persist: async () => assert.fail('must not persist') });
  assert.equal((await handler(signed('x'.repeat(1024 * 1024 + 1)))).status, 413);
  assert.equal((await handler(signed(payload(), { headers: { 'content-encoding': 'gzip' } }))).status, 415);
  const request = signed();
  const stream = new ReadableStream({ start(controller) { controller.error(Error('interrupted')); } });
  assert.equal((await handler(new Request(request.url, { method: 'POST', headers: request.headers, body: stream, duplex: 'half' }))).status, 400);
  assert.equal((await handler(new Request(request.url, { method: 'POST', headers: request.headers, body: new Uint8Array([255]) }))).status, 400);
});

test('only informational health is public; unsupported methods cannot write', async () => {
  const handler = createHandler({ secret, persist: async () => assert.fail('must not persist') });
  assert.equal((await handler(new Request('https://example.test'))).status, 200);
  assert.equal((await handler(new Request('https://example.test', { method: 'DELETE' }))).status, 405);
  assert.equal((await createHandler({ persist: async () => {} })(new Request('https://example.test'))).status, 503);
});

test('event migration provides durable deduplication, rollback and server-only access', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table public.team_existing_table(value text); insert into public.team_existing_table values (\'keep me\');');
  await db.exec(await readFile(new URL('../supabase/003_quicknode_events.sql', import.meta.url), 'utf8'));
  const events = normalizeEvents(payload()).events;
  const ingest = async (nonce, hash = 'a'.repeat(64), rows = events) => {
    const result = await db.query('select public.music_ingest_chain_events($1,$2,$3,$4) as value', [nonce, hash, '{}', JSON.stringify(rows)]);
    return result.rows[0].value;
  };
  const count = async name => (await db.query(`select count(*)::int as n from public.${name}`)).rows[0].n;
  await t.test('retries, concurrent deliveries and overlapping backfills store one event', async () => {
    assert.deepEqual(await ingest('one'), { duplicate: false, inserted: 1 });
    assert.deepEqual(await ingest('one'), { duplicate: true, inserted: 0 });
    const repeated = await Promise.all(Array.from({ length: 6 }, (_, i) => ingest('parallel-' + i)));
    assert.ok(repeated.every(r => r.inserted === 0));
    assert.equal(await count('music_chain_events'), 1);
    assert.equal(await count('music_event_deliveries'), 7);
  });
  await t.test('nonce conflicts and changed historical events require reconciliation', async () => {
    await assert.rejects(ingest('one', 'b'.repeat(64)), /DELIVERY_CONFLICT/);
    await assert.rejects(ingest('conflict', undefined, [{ ...events[0], block_hash: '0x' + 'f'.repeat(64) }]), /EVENT_CONFLICT/);
    await assert.rejects(ingest('conflict-args', undefined, [{ ...events[0], args: { amount: '0' } }]), /EVENT_CONFLICT/);
    assert.equal(await count('music_event_deliveries'), 7);
  });
  await t.test('all-or-nothing batch writes survive interruption, restart and same-delivery recovery', async () => {
    const other = { ...events[0], transaction_hash: '0x' + '3'.repeat(64) };
    await assert.rejects(ingest('retry-after-failure', undefined, [other, { ...other, log_index: -1 }]), /check constraint/);
    assert.equal(await count('music_chain_events'), 1);
    let offline = true;
    const handler = createHandler({ secret, persist: async d => { if (offline) throw Error('offline'); return ingest(d.nonce, d.hash, d.events); } });
    assert.equal((await handler(signed(payload(), { nonce: 'outage' }))).status, 503);
    offline = false;
    // A fresh handler models a new process with no in-memory deduplication.
    const restarted = createHandler({ secret, persist: d => ingest(d.nonce, d.hash, d.events) });
    assert.equal((await restarted(signed(payload(), { nonce: 'outage' }))).status, 200);
    assert.equal((await restarted(signed(payload(), { nonce: 'outage' }))).status, 200);
    assert.equal(await count('music_chain_events'), 1);
    assert.deepEqual(await ingest('retry-after-failure', undefined, [other]), { duplicate: false, inserted: 1 });
  });
  await t.test('both browser roles are denied reads, writes and ingestion', async () => {
    const rows = await db.query("select relname, relrowsecurity from pg_class where relname in ('music_chain_events','music_event_deliveries')");
    assert.equal(rows.rows.length, 2); assert.ok(rows.rows.every(x => x.relrowsecurity));
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(db.query('select * from public.music_chain_events'), /permission denied/);
      await assert.rejects(db.query('select * from public.music_event_deliveries'), /permission denied/);
      await assert.rejects(ingest('browser'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await ingest('server')).inserted, 0);
    await assert.rejects(db.exec('delete from public.music_chain_events'), /permission denied/);
    await db.exec('reset role');
    assert.equal((await db.query('select * from public.team_existing_table')).rows[0].value, 'keep me');
  });
});

test('V2 signed deliveries use registered addresses, deployment-specific blocks and versioned event signatures',async()=>{
 const V='0x'+'b'.repeat(40),abi=parseAbi(['event RoundCreated(uint256 indexed roundId, bytes32 indexed songId, string musicId, address indexed artist, uint64 start, uint64 deadline, uint8 cadence)']);
 const args={roundId:1n,songId:'0x'+'3'.repeat(64),musicId:'demo:last-bus-home',artist:funder,start:100n,deadline:3700n,cadence:0};
 const v2={...log(),address:V,blockNumber:'80000000',topics:encodeEventTopics({abi,eventName:'RoundCreated',args}),data:encodeAbiParameters([{type:'string'},{type:'uint64'},{type:'uint64'},{type:'uint8'}],['demo:last-bus-home',100n,3700n,0])};
 const deployments=async()=>[{contract_address:CONTRACT,model_version:1,creation_block:73100560},{contract_address:V,model_version:2,creation_block:80000000}];
 let saved;
 const h=createHandler({secret,deployments,persist:async delivery=>{saved=delivery;}}),body={schemaVersion:2,chainId:5042002,logs:[log(),v2]};
 assert.equal((await h(signed(body))).status,200);assert.equal(saved.events[0].contract_address,CONTRACT);assert.equal(saved.events[1].contract_address,V);assert.equal(saved.events[1].args.deadline,'3700');
 assert.equal((await h(signed({...body,logs:[{...v2,blockNumber:'79999999'}]}))).status,422);
 assert.equal((await h(signed({...body,logs:[{...v2,address:funder}]}))).status,422);
});
