import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const APP_ID = 'cmwnr8etv005h0gjvwth61jyt';
export const CHAIN_ID = 5042002;
export const CONTRACT = '0x003043208750d205f98ac1d9ae670d2d2a19797c';
export const ORIGINAL_OWNER = '0xcd61a22acf76623114583a1e0a031c18201baf51';
export const ORIGIN = 'http://localhost:3000';
export const address = value => typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value) ? value.toLowerCase() : null;
export const sameAddress = (a, b) => Boolean(address(a) && address(a) === address(b));
export const deployment = JSON.parse(readFileSync(new URL('../../contracts/deployments/arc-testnet-curve90.json', import.meta.url), 'utf8'));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function loadConfig(env = process.env) {
  const missing = ['PRIVY_APP_SECRET', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'ADMIN_PRIVATE_KEY'].filter(key => !env[key]?.trim());
  if (env.PRIVY_APP_ID && env.PRIVY_APP_ID !== APP_ID) throw new Error('Use the Music Prediction Test Privy application.');
  if (env.ADMIN_PRIVATE_KEY && !/^0x[\da-f]{64}$/i.test(env.ADMIN_PRIVATE_KEY)) throw new Error('The local administrator key is invalid.');
  const limit = Number(env.APPROVAL_HOURLY_LIMIT ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('APPROVAL_HOURLY_LIMIT must be between 1 and 1000.');
  const rpc = env.ARC_RPC_URL?.trim() || 'https://rpc.testnet.arc.io';
  if (new URL(rpc).protocol !== 'https:') throw new Error('The administrator requires an HTTPS Arc Testnet RPC.');
  const supabaseUrl = env.SUPABASE_URL?.trim();
  if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)) throw new Error('Use your Supabase Project URL.');
  let activeDeployment=deployment;
  const marketsV2=env.MUSIC_PAYMENT_DEPLOYMENT==='arc-testnet-markets-v2-live';
  const marketsV3=env.MUSIC_PAYMENT_DEPLOYMENT==='arc-testnet-markets-v3-live';
  const atomic=marketsV3||marketsV2||env.MUSIC_PAYMENT_DEPLOYMENT==='arc-testnet-atomic-live';
  if(env.MUSIC_PAYMENT_DEPLOYMENT && !atomic) throw new Error('Unknown payment deployment.');
  if(atomic) {
    activeDeployment=JSON.parse(readFileSync(new URL(marketsV3?'../../contracts/deployments/arc-testnet-markets-v3-live.json':marketsV2?'../../contracts/deployments/arc-testnet-markets-v2-live.json':'../../contracts/deployments/arc-testnet-atomic-live.json',import.meta.url),'utf8'));
    if(activeDeployment.chainId!==CHAIN_ID||!address(activeDeployment.address)||!activeDeployment.atomicFour||!Number.isSafeInteger(activeDeployment.creationBlock)||!activeDeployment.runtimeSha256) throw new Error('Unverified payment deployment.');
  }
  if(marketsV2&&(activeDeployment.marketModelVersion!==2||activeDeployment.deploymentId!=='markets-v2'))throw new Error('Unverified market schedule deployment.');
  if(marketsV3&&(activeDeployment.marketModelVersion!==3||activeDeployment.deploymentId!=='markets-v3'))throw new Error('Unverified daily deployment.');
  return {
    schedulerEnabled:marketsV3&&env.MUSIC_SCHEDULER_ENABLED==='true',
    chartexEnabled:marketsV3&&env.MUSIC_DATA_SOURCE==='chartex',
    chartexAppId:env.CHARTEX_APP_ID?.trim(),chartexAppToken:env.CHARTEX_APP_TOKEN?.trim(),
    expectedOracle:env.MUSIC_DATA_SOURCE==='chartex'?env.MUSIC_ORACLE_ADDRESS?.trim()?.toLowerCase():null,
    settlementEnabled:env.MUSIC_SETTLEMENT_ENABLED==='true',
    atomic, deployment:activeDeployment,
    appId: APP_ID, chainId: CHAIN_ID, contract: activeDeployment.address.toLowerCase(), originalOwner: ORIGINAL_OWNER,
    appSecret: env.PRIVY_APP_SECRET?.trim(), supabaseUrl, supabaseKey: env.SUPABASE_SECRET_KEY?.trim(),
    privateKey: env.ADMIN_PRIVATE_KEY?.trim(), rpc, hourlyLimit: limit, missing,
  };
}
