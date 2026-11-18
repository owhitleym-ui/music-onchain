import { connection } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { money } from "@/lib/money";
import { contracts, publicClient } from "@/lib/server/chain";
import { readAllCompetitions } from "@/lib/server/competitions";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { errorResponse, json, requireAdmin } from "@/lib/server/http";
import { competitionSummary } from "@/lib/server/views";

// GET /api/admin/status   header: x-admin-secret
// Ops check before a demo: wallet balances, whether the database is connected, all competitions.
export async function GET(request: Request) {
  await connection(); // request-time only; never prerender
  try {
    requireAdmin(request);
    const client = publicClient();
    const balanceOf = (address: `0x${string}`) =>
      client.readContract({ ...contracts.usdc(), functionName: "balanceOf", args: [address] });

    const wallets: Record<string, { address: string; balance: ReturnType<typeof money> } | { error: string }> = {};
    for (const [label, key] of [
      ["oracle", () => env.oraclePrivateKey()],
      ["faucet", () => env.faucetPrivateKey()],
    ] as const) {
      try {
        const address = privateKeyToAccount(key()).address;
        wallets[label] = { address, balance: money(await balanceOf(address)) };
      } catch (e) {
        wallets[label] = { error: e instanceof Error ? e.message : "unavailable" };
      }
    }

    const [blockNumber, competitions] = await Promise.all([client.getBlockNumber(), readAllCompetitions()]);
    return json({
      ok: true,
      chainId: env.chainId(),
      blockNumber: blockNumber.toString(),
      competitionAddress: env.competitionAddress(),
      database: db() ? "connected" : "not configured (reads fall back to the chain)",
      faucetDrip: env.faucetDripUsd(),
      wallets,
      competitions: competitions.map((c) => competitionSummary(c)),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
