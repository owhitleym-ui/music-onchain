// Blockchain access for API routes (viem): one shared read client, wallet clients for the
// server-held keys (oracle, faucet), Arc's gas-price floor, and the contract addresses + ABIs.
// Works against Arc testnet (CHAIN_ID=5042002) or local anvil (CHAIN_ID=31337).
import "server-only";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseGwei,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, foundry } from "viem/chains";
import { competitionAbi } from "@/lib/abi/Competition";
import { songRegistryAbi } from "@/lib/abi/SongRegistry";
import { env } from "./env";

// Arc silently drops transactions with maxFeePerGas below 20 gwei (docs/ARCHITECTURE.md).
const ARC_MIN_MAX_FEE = parseGwei("25");

export function chain(): Chain {
  const id = env.chainId();
  if (id === arcTestnet.id) return { ...arcTestnet, rpcUrls: { default: { http: [env.rpcUrl()] } } };
  if (id === foundry.id) return { ...foundry, rpcUrls: { default: { http: [env.rpcUrl()] } } };
  throw new Error(`Unsupported CHAIN_ID ${id}. Use 5042002 (Arc testnet) or 31337 (local anvil).`);
}

let _public: PublicClient | undefined;
export function publicClient(): PublicClient {
  // Arc has sub-second finality, so check receipts every second (viem's default is 4s).
  _public ??= createPublicClient({ chain: chain(), transport: http(env.rpcUrl()), pollingInterval: 1_000 }) as PublicClient;
  return _public;
}

export function walletFor(privateKey: Hex) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: chain(),
    transport: http(env.rpcUrl()),
  });
}

/** Fee overrides that respect Arc's 20 gwei floor. Local anvil uses viem's defaults. */
export async function feeOverrides() {
  if (env.chainId() !== arcTestnet.id) return {};
  const fees = await publicClient().estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas > ARC_MIN_MAX_FEE ? fees.maxFeePerGas : ARC_MIN_MAX_FEE;
  return { maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

export const contracts = {
  competition: () => ({ address: env.competitionAddress(), abi: competitionAbi }) as const,
  songRegistry: () => ({ address: env.songRegistryAddress(), abi: songRegistryAbi }) as const,
  usdc: () => ({ address: env.usdcAddress(), abi: erc20Abi }) as const,
};
