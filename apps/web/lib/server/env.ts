import "server-only";
import { getAddress, type Address, type Hex } from "viem";

// Every value is read lazily so `next build` works without secrets, and a missing
// variable fails the one route that needs it with a clear message.

export class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(`Missing environment variable ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  chainId: () => Number(optional("CHAIN_ID") ?? optional("NEXT_PUBLIC_CHAIN_ID") ?? "5042002"),
  rpcUrl: () => optional("CHAIN_RPC_URL") ?? optional("NEXT_PUBLIC_CHAIN_RPC_URL") ?? "https://rpc.testnet.arc.io",

  usdcAddress: (): Address =>
    getAddress(optional("NEXT_PUBLIC_USDC_ADDRESS") ?? "0x3600000000000000000000000000000000000000"),
  competitionAddress: (): Address => getAddress(required("NEXT_PUBLIC_COMPETITION_ADDRESS")),
  songRegistryAddress: (): Address => getAddress(required("NEXT_PUBLIC_SONG_REGISTRY_ADDRESS")),
  competitionDeployBlock: (): bigint => BigInt(optional("COMPETITION_DEPLOY_BLOCK") ?? "0"),

  oraclePrivateKey: (): Hex => required("ORACLE_PRIVATE_KEY") as Hex,
  faucetPrivateKey: (): Hex => required("FAUCET_PRIVATE_KEY") as Hex,
  faucetDripUsd: () => optional("FAUCET_DRIP_USDC") ?? "10",
  // Local development only: lets /api/faucet accept { address } without a Privy token.
  faucetAllowUnauthenticated: () =>
    optional("FAUCET_ALLOW_UNAUTHENTICATED") === "true" && process.env.NODE_ENV !== "production",

  adminSecret: () => required("ADMIN_SECRET"),

  privyAppId: () => required("NEXT_PUBLIC_PRIVY_APP_ID"),
  privyAppSecret: () => required("PRIVY_APP_SECRET"),

  supabaseUrl: () => optional("SUPABASE_URL"),
  supabaseServiceRoleKey: () => optional("SUPABASE_SERVICE_ROLE_KEY"),

  quicknodeWebhookSecret: () => required("QUICKNODE_STREAMS_WEBHOOK_SECRET"),
  youtubeApiKey: () => required("YOUTUBE_API_KEY"),
};
