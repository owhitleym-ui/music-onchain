// Verifies QuickNode Streams webhook deliveries.
// Scheme (QuickNode guide "Validating incoming Streams webhook messages"):
//   X-QN-Signature = hex( HMAC-SHA256( key = stream security token, msg = nonce + timestamp + payload ) )
// where payload is the decoded (un-gzipped) JSON body as UTF-8.
// Dependency-free (node built-ins only) so `node --test` can import it directly.
import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";

export type SignatureCheck =
  | { ok: true }
  | { ok: false; status: 400 | 401; reason: string };

export function decodeBody(raw: Buffer, contentEncoding: string | null): string {
  const gzipped =
    contentEncoding?.toLowerCase().includes("gzip") || (raw[0] === 0x1f && raw[1] === 0x8b);
  return (gzipped ? gunzipSync(raw) : raw).toString("utf8");
}

export function signPayload(secret: string, nonce: string, timestamp: string, payload: string): string {
  return createHmac("sha256", secret).update(nonce + timestamp + payload, "utf8").digest("hex");
}

export function verifyQuickNodeSignature(opts: {
  secret: string;
  nonce: string | null;
  timestamp: string | null;
  signature: string | null;
  payload: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const { secret, nonce, timestamp, signature, payload } = opts;
  if (!nonce || !timestamp || !signature) {
    return { ok: false, status: 400, reason: "missing X-QN-Nonce, X-QN-Timestamp or X-QN-Signature" };
  }

  // Replay protection: QuickNode doesn't enforce a window, so we do.
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, status: 400, reason: "bad timestamp" };
  // Accept seconds or milliseconds.
  const tsSeconds = ts > 1e12 ? Math.floor(ts / 1000) : ts;
  if (Math.abs(now - tsSeconds) > tolerance) {
    return { ok: false, status: 401, reason: "timestamp outside tolerance" };
  }

  const expected = Buffer.from(signPayload(secret, nonce, timestamp, payload), "hex");
  const given = Buffer.from(signature.trim().toLowerCase(), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, reason: "signature mismatch" };
  }
  return { ok: true };
}

export type RawLog = {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp?: number;
};

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.length > 0) return Number(BigInt(v));
  return undefined;
}

/**
 * Pulls every EVM log out of a Streams payload. QuickNode's shape depends on the dataset
 * (Logs vs Block with Receipts) and any filter function, so instead of assuming one layout
 * we walk the JSON and collect anything that looks like a log.
 */
export function extractLogs(payload: unknown): RawLog[] {
  const found: RawLog[] = [];
  const seen = new Set<unknown>();

  const visit = (node: unknown, inheritedTimestamp?: number) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) visit(child, inheritedTimestamp);
      return;
    }
    const obj = node as Record<string, unknown>;
    const ts = toNumber(obj.timestamp) ?? inheritedTimestamp;
    if (
      typeof obj.address === "string" &&
      Array.isArray(obj.topics) &&
      typeof obj.data === "string" &&
      typeof obj.transactionHash === "string" &&
      obj.logIndex !== undefined &&
      obj.blockNumber !== undefined
    ) {
      found.push({
        address: obj.address,
        topics: obj.topics as string[],
        data: obj.data,
        transactionHash: obj.transactionHash,
        logIndex: toNumber(obj.logIndex) ?? 0,
        blockNumber: BigInt(obj.blockNumber as string | number),
        blockTimestamp: toNumber(obj.blockTimestamp) ?? ts,
      });
      return;
    }
    for (const value of Object.values(obj)) visit(value, ts);
  };

  visit(payload);
  return found;
}
