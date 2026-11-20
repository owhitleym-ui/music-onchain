import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareSettlement } from './prepare-settlement.mjs';

const entry = (id, firstTicketId, guess, purchasedAt = '100', spots = 1) => ({ id, firstTicketId, guess, purchasedAt, spots });

test('orders by absolute error, time, purchase ID, and spot offset', () => {
  const result = prepareSettlement({ actualViews: '100', entries: [
    entry('3', '2', '90', '101'), entry('2', '1', '110', '100'), entry('1', '0', '90', '100'), entry('4', '3', '100', '102'),
  ] });
  assert.deepEqual(result.orderedTicketIds, ['3', '0', '1', '2']);
});

test('a bundle expands to ten identical spots and is split into bounded batches', () => {
  const entries = Array.from({ length: 105 }, (_, i) => entry(String(i + 1), String(i * 10), String(i), '100', 10));
  const result = prepareSettlement({ actualViews: '0', entries });
  assert.equal(result.spotCount, 1050);
  assert.equal(result.batches.length, 33);
  assert.equal(result.batches.at(-1).length, 26);
  assert.deepEqual(result.orderedTicketIds.slice(0, 12), Array.from({ length: 12 }, (_, i) => String(i)));
  assert.ok(result.batches.every(batch => batch.length <= 32));
});

test('uses exact integer arithmetic above JavaScript safe-integer range', () => {
  const base = 1n << 200n;
  const result = prepareSettlement({ actualViews: String(base), entries: [entry('1', '0', String(base + 1n)), entry('2', '1', String(base))] });
  assert.deepEqual(result.orderedTicketIds, ['1', '0']);
});

test('empty pools and custom smaller batches are supported', () => {
  assert.deepEqual(prepareSettlement({ actualViews: '0', entries: [] }), { spotCount: 0, orderedTicketIds: [], batches: [] });
  assert.deepEqual(prepareSettlement({ actualViews: '0', entries: [entry('1', '0', '1'), entry('2', '1', '0')] }, 1).batches, [['1'], ['0']]);
});

test('rejects duplicate IDs, gaps, overlapping bundles, unsafe numbers, and invalid counts', () => {
  const make = entries => ({ actualViews: '0', entries });
  assert.throws(() => prepareSettlement(make([entry('1', '0', '0'), entry('1', '1', '0')])), /Duplicate entry/);
  assert.throws(() => prepareSettlement(make([entry('1', '1', '0')])), /without gaps/);
  assert.throws(() => prepareSettlement(make([entry('1', '0', '0', '0', 10), entry('2', '9', '0')])), /overlapping/);
  assert.throws(() => prepareSettlement(make([entry('1', '0', Number.MAX_SAFE_INTEGER + 1)])), /safe integer/);
  assert.throws(() => prepareSettlement(make([entry('1', '0', '-1')])), /nonnegative/);
  assert.throws(() => prepareSettlement(make([entry('1', '0', '0', '0', 2)])), /1 or 10/);
  assert.throws(() => prepareSettlement(make([entry('1', '0', String(1n << 256n))])), /uint256/);
  assert.throws(() => prepareSettlement(make([]), 33), /1 to 32/);
});

test('command-line helper reads a sample input and emits decimal-string calldata batches', () => {
  const script=fileURLToPath(new URL('./prepare-settlement.mjs',import.meta.url));
  const example=fileURLToPath(new URL('./settlement-input.example.json',import.meta.url));
  const run=spawnSync(process.execPath,[script,example],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.deepEqual(JSON.parse(run.stdout),{spotCount:4,orderedTicketIds:['3','0','1','2'],batches:[['3','0','1','2']]});
  const invalid=spawnSync(process.execPath,[script],{encoding:'utf8'});
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);
});
