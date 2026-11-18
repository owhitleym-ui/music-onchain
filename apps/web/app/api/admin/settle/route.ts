import { contracts, feeOverrides, publicClient, walletFor } from "@/lib/server/chain";
import { readCompetition } from "@/lib/server/competitions";
import { env } from "@/lib/server/env";
import { errorResponse, HttpError, json, parseId, parseUint, readJson, requireAdmin } from "@/lib/server/http";

// POST /api/admin/settle   header: x-admin-secret
// body: { competitionId: number, finalMetric: number | string }
// Submits the real metric with the oracle key. If the competition has fewer than
// minEntries, the contract cancels it and refunds everyone instead.
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson<{ competitionId?: unknown; finalMetric?: unknown }>(request);
    const id = parseId(body.competitionId);
    const finalMetric = parseUint(body.finalMetric, "finalMetric");

    const before = await readCompetition(id);
    if (!before) throw new HttpError(404, `Competition ${id} does not exist`, "not_found");
    if (before.phase === "open") {
      throw new HttpError(409, `Entries are still open until ${new Date(before.closesAt * 1000).toISOString()}`, "still_open");
    }
    if (before.phase !== "closed") throw new HttpError(409, `Competition is already ${before.phase}`, "not_open");

    const oracle = walletFor(env.oraclePrivateKey());
    // Simulate first so reverts come back as readable errors instead of a failed transaction.
    const { request: tx } = await publicClient().simulateContract({
      ...contracts.competition(),
      functionName: "settle",
      args: [BigInt(id), finalMetric],
      account: oracle.account,
      ...(await feeOverrides()),
    });
    const hash = await oracle.writeContract(tx);
    const receipt = await publicClient().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new HttpError(502, "Settle transaction reverted", "tx_failed");

    const after = await readCompetition(id);
    return json({
      ok: true,
      txHash: hash,
      status: after?.status ?? "Settled", // "Settled", or "Cancelled" when below minEntries
      numEntries: before.numEntries,
      minEntries: before.minEntries,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
