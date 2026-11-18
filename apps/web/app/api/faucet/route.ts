import { getAddress, isAddress, parseEther, type Address } from "viem";
import { foundry } from "viem/chains";
import { money, parseUsd } from "@/lib/money";
import { requirePrivyUser } from "@/lib/server/auth";
import { contracts, feeOverrides, publicClient, walletFor } from "@/lib/server/chain";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { errorResponse, HttpError, json, readJson } from "@/lib/server/http";

// POST /api/faucet   header: Authorization: Bearer <Privy access token>
// Sends FAUCET_DRIP_USDC test USDC (default $10) to the signed-in user's embedded wallet, once.
// On Arc, USDC is also the gas token, so this one transfer covers both entry fees and gas.
// Testnet only: in a real product this button becomes a card on-ramp.

// Fallback de-duplication when Supabase isn't configured (per server instance only).
const dripped = new Set<string>();

async function identify(request: Request): Promise<{ userId: string; address: Address }> {
  if (env.faucetAllowUnauthenticated()) {
    // Local development without Privy: accept { address } in the body.
    const body = await readJson<{ address?: string }>(request.clone()).catch(() => ({}) as { address?: string });
    if (body.address && isAddress(body.address)) {
      const address = getAddress(body.address);
      return { userId: `dev:${address}`, address };
    }
  }
  return requirePrivyUser(request);
}

async function sendDrip(to: Address, amount: bigint) {
  const faucet = walletFor(env.faucetPrivateKey());
  const attempt = async () => {
    const { request } = await publicClient().simulateContract({
      ...contracts.usdc(),
      functionName: "transfer",
      args: [to, amount],
      account: faucet.account,
      ...(await feeOverrides()),
    });
    return faucet.writeContract(request);
  };
  let hash;
  try {
    hash = await attempt();
  } catch (err) {
    // Two drips at the same moment can race for the same nonce. Retry once.
    if (err instanceof Error && /nonce|replacement/i.test(err.message)) hash = await attempt();
    else throw err;
  }
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new HttpError(502, "Faucet transfer reverted", "tx_failed");

  // Local anvil only: gas there is paid in ETH, not USDC, so a brand-new wallet also needs a
  // little ETH to send approve/enter. On Arc this never runs because USDC is the gas token.
  if (env.chainId() === foundry.id) {
    const ethHash = await faucet.sendTransaction({ to, value: parseEther("0.05") });
    await publicClient().waitForTransactionReceipt({ hash: ethHash });
  }
  return hash;
}

export async function POST(request: Request) {
  try {
    const { userId, address } = await identify(request);
    const amount = parseUsd(env.faucetDripUsd());
    const client = publicClient();
    const balanceOf = () =>
      client.readContract({ ...contracts.usdc(), functionName: "balanceOf", args: [address] });

    const store = db();
    if (store) {
      // Claim the drip first so two parallel requests can't both send.
      const { error } = await store
        .from("faucet_drips")
        .insert({ privy_user_id: userId, address, amount: amount.toString() });
      if (error) {
        if (error.code !== "23505") throw new Error(`faucet_drips insert failed: ${error.message}`);
        const { data } = await store
          .from("faucet_drips")
          .select("tx_hash")
          .or(`privy_user_id.eq."${userId}",address.eq."${address}"`)
          .maybeSingle();
        return json({ ok: true, alreadyFunded: true, txHash: data?.tx_hash ?? null, balance: money(await balanceOf()) });
      }
      try {
        const txHash = await sendDrip(address, amount);
        await store.from("faucet_drips").update({ tx_hash: txHash }).eq("privy_user_id", userId);
        return json({ ok: true, alreadyFunded: false, txHash, amount: money(amount), balance: money(await balanceOf()) });
      } catch (err) {
        // Release the claim so the user can retry.
        await store.from("faucet_drips").delete().eq("privy_user_id", userId);
        throw err;
      }
    }

    // No database: one drip per address per instance, and skip anyone already holding a drip's worth.
    const current = await balanceOf();
    if (dripped.has(address) || current >= amount) {
      return json({ ok: true, alreadyFunded: true, txHash: null, balance: money(current) });
    }
    dripped.add(address);
    try {
      const txHash = await sendDrip(address, amount);
      return json({ ok: true, alreadyFunded: false, txHash, amount: money(amount), balance: money(await balanceOf()) });
    } catch (err) {
      dripped.delete(address);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
