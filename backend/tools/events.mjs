import {readFileSync} from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import { checkEventHistory } from '../src/event-history.js';

const command = process.argv[2] ?? 'check';
if (!['check', 'backfill'].includes(command) || process.argv.length > 4 || (process.argv[3]&&!['markets-v2','markets-v3'].includes(process.argv[3]))) {
  console.error('Commands: check | backfill');
  process.exitCode = 1;
} else {
  try {
    let config = loadConfig();
    if(['markets-v2','markets-v3'].includes(process.argv[3])){const d=JSON.parse(readFileSync(new URL('../../contracts/deployments/arc-testnet-'+process.argv[3]+'-live.json',import.meta.url),'utf8'));config={...config,atomic:true,contract:d.address,deployment:d};}
    if (!config.supabaseUrl || !config.supabaseKey) throw Error('SETTINGS_REQUIRED');
    const database = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) },
    });
    const result = await checkEventHistory(config, { database, backfill: command === 'backfill' });
    console.log(JSON.stringify(result, null, 2));
    if (!result.consistent) {
      console.error('Event history needs attention. Backfill can restore missing records; conflicts require review.');
      process.exitCode = 1;
    }
  } catch (error) {
    const known = new Set(['EVENT_DEPLOYMENT_REQUIRED', 'WRONG_CHAIN', 'INVALID_CHAIN_SNAPSHOT', 'DEPLOYMENT_CODE_MISMATCH', 'INVALID_CHAIN_LOG', 'INVALID_CHAIN_EVENT', 'DUPLICATE_CHAIN_LOG', 'EVENT_RECEIPT_MISMATCH', 'CHAIN_CHANGED_RETRY', 'EVENT_STORAGE_UNAVAILABLE', 'EVENT_HISTORY_CONFLICT', 'SETTINGS_REQUIRED']);
    console.error('Event history check stopped: ' + (known.has(error?.message) ? error.message : 'DATABASE_OR_RPC_UNAVAILABLE') + '. No transactions were signed or sent.');
    process.exitCode = 1;
  }
}
