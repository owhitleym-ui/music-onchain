import { extractLogs, decodeBody, verifyQuickNodeSignature } from "@/lib/quicknode-signature";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { decodeCompetitionLogs, storeEvents } from "@/lib/server/events";
import { errorResponse, json } from "@/lib/server/http";

// POST /api/streams/webhook
// Destination for the QuickNode Stream (Arc Testnet, filtered to the Competition contract).
// 1. verify X-QN-Signature over nonce + timestamp + body (un-gzipped)
// 2. decode every Competition log with the ABI
// 3. upsert into chain_events (idempotent on tx_hash + log_index, so retries are safe)
export async function POST(request: Request) {
  try {
    const raw = Buffer.from(await request.arrayBuffer());
    const payload = decodeBody(raw, request.headers.get("content-encoding"));

    const check = verifyQuickNodeSignature({
      secret: env.quicknodeWebhookSecret(),
      nonce: request.headers.get("x-qn-nonce"),
      timestamp: request.headers.get("x-qn-timestamp"),
      signature: request.headers.get("x-qn-signature"),
      payload,
    });
    if (!check.ok) return json({ ok: false, error: check.reason }, { status: check.status });

    let body: unknown;
    try {
      body = JSON.parse(payload);
    } catch {
      return json({ ok: false, error: "body is not JSON" }, { status: 400 });
    }

    const logs = extractLogs(body);
    const rows = decodeCompetitionLogs(logs);

    if (!db()) {
      // Signature was fine but there's nowhere to store it. A 503 makes QuickNode retry later.
      return json(
        { ok: false, error: "database not configured", logs: logs.length, events: rows.map((r) => r.event_name) },
        { status: 503 },
      );
    }

    const stored = await storeEvents(rows);
    return json({ ok: true, logs: logs.length, stored, events: rows.map((r) => r.event_name) });
  } catch (err) {
    return errorResponse(err);
  }
}
