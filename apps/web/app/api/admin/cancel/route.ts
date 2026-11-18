import { contracts, feeOverrides, publicClient, walletFor } from "@/lib/server/chain";
import { readCompetition } from "@/lib/server/competitions";
import { env } from "@/lib/server/env";
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from "@/lib/server/http";

// POST /api/admin/cancel   header: x-admin-secret
// body: { competitionId: number }
// Cancels an open competition and refunds every entrant. Useful for resetting a demo.
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson<{ competitionId?: unknown }>(request);
    const id = parseId(body.competitionId);

    const c = await readCompetition(id);
    if (!c) throw new HttpError(404, `Competition ${id} does not exist`, "not_found");
    if (c.phase === "settled" || c.phase === "cancelled") {
      throw new HttpError(409, `Competition is already ${c.phase}`, "not_open");
    }

    const oracle = walletFor(env.oraclePrivateKey());
    const { request: tx } = await publicClient().simulateContract({
      ...contracts.competition(),
      functionName: "cancel",
      args: [BigInt(id)],
      account: oracle.account,
      ...(await feeOverrides()),
    });
    const hash = await oracle.writeContract(tx);
    const receipt = await publicClient().waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new HttpError(502, "Cancel transaction reverted", "tx_failed");

    return json({ ok: true, txHash: hash, status: "Cancelled", refunded: c.numEntries });
  } catch (err) {
    return errorResponse(err);
  }
}
