// Public (browser-visible) configuration. Next.js inlines NEXT_PUBLIC_* values at build time,
// and only when they are referenced literally like below, so don't refactor these into a loop.
// Nothing secret belongs here: every value ships to every visitor.
import { getAddress, type Address, type Chain } from "viem";
import { arcTestnet, foundry } from "viem/chains";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "5042002");
const rpcUrl = process.env.NEXT_PUBLIC_CHAIN_RPC_URL ?? "https://rpc.testnet.arc.io";

function address(value: string | undefined, fallback?: string): Address | null {
  const v = value || fallback;
  return v ? getAddress(v) : null;
}

/** Arc testnet in production; local anvil (31337) for development. */
export const chain: Chain =
  chainId === foundry.id
    ? { ...foundry, rpcUrls: { default: { http: [rpcUrl] } } }
    : { ...arcTestnet, rpcUrls: { default: { http: [rpcUrl] } } };

export const config = {
  chainId,
  rpcUrl,
  isArc: chainId === arcTestnet.id,
  usdc: address(process.env.NEXT_PUBLIC_USDC_ADDRESS, "0x3600000000000000000000000000000000000000")!,
  competition: address(process.env.NEXT_PUBLIC_COMPETITION_ADDRESS),
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.testnet.arc.io",
  /** Empty = no Privy app yet; the app falls back to a local test wallet (see lib/client/wallet.tsx). */
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
};
