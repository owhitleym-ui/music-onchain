#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const UINT256_MAX = (1n << 256n) - 1n;

function integer(value, field) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer or decimal string.`);
  if (!['number', 'string', 'bigint'].includes(typeof value) || !/^(0|[1-9]\d*)$/.test(String(value))) throw new Error(`${field} must be a nonnegative integer.`);
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) throw new Error(`${field} exceeds uint256.`);
  return parsed;
}

function compare(a, b) {
  for (const key of ['error', 'purchasedAt', 'entryId', 'offset']) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

/** Prepare candidate ordering only. The contract independently validates it. */
export function prepareSettlement(input, batchSize = 32) {
  if (!input || !Array.isArray(input.entries)) throw new Error('Input must contain an entries array.');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 32) throw new Error('Batch size must be from 1 to 32.');
  const actual = integer(input.actualViews, 'actualViews');
  const entryIds = new Set();
  const ticketIds = new Set();
  const tickets = [];
  for (const entry of input.entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Every entry must be an object.');
    const entryId = integer(entry.id, 'entry.id');
    const first = integer(entry.firstTicketId, 'entry.firstTicketId');
    const spots = integer(entry.spots, 'entry.spots');
    const guess = integer(entry.guess, 'entry.guess');
    const purchasedAt = integer(entry.purchasedAt, 'entry.purchasedAt');
    if (entryId === 0n) throw new Error('Entry IDs start at 1.');
    if (entryIds.has(String(entryId))) throw new Error('Duplicate entry ID.');
    entryIds.add(String(entryId));
    if (spots !== 1n && spots !== 10n) throw new Error('Each entry must contain 1 or 10 spots.');
    for (let offset = 0n; offset < spots; offset++) {
      const ticketId = first + offset;
      if (ticketId > UINT256_MAX || ticketIds.has(String(ticketId))) throw new Error('Invalid or overlapping ticket IDs.');
      ticketIds.add(String(ticketId));
      tickets.push({ ticketId, entryId, purchasedAt, offset, error: guess > actual ? guess - actual : actual - guess });
    }
  }
  // Completeness requires local IDs 0..N-1, regardless of input entry order.
  for (let id = 0; id < tickets.length; id++) if (!ticketIds.has(String(id))) throw new Error('Ticket IDs must cover 0 through spotCount-1 without gaps.');
  tickets.sort(compare);
  const orderedTicketIds = tickets.map(ticket => String(ticket.ticketId));
  const batches = [];
  for (let index = 0; index < orderedTicketIds.length; index += batchSize) batches.push(orderedTicketIds.slice(index, index + batchSize));
  return { spotCount: tickets.length, orderedTicketIds, batches };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node contracts/tools/prepare-settlement.mjs input.json');
    const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify(prepareSettlement(input), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
