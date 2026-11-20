import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import { decodeEventLog, parseAbi } from "npm:viem@2.58.1";

// Paste this ENTIRE file into the Supabase function editor.
// Keep the QuickNode stream paused until migration 003 and the secret are set.
// The Supabase gateway JWT check must be OFF for this signed webhook.
// POST requests are authenticated below using QuickNode's HMAC signature.
export const CONTRACT = "0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083";
const CHAIN_ID = 5042002;
const FIRST_BLOCK = 73100560n;
const MAX_BYTES = 1024 * 1024;
const MAX_EVENTS = 2000;
const HEX32 = /^0x[0-9a-f]{64}$/i;
const encoder = new TextEncoder();

const EVENT_ABI = parseAbi([
  "event EntryClaimed(uint256 indexed entryId, address indexed recipient, uint256 amount, bool refund)",
  "event EntryRecorded(uint256 indexed entryId, bytes32 indexed pool, address indexed payer, uint256 guess, uint256 paid, uint256 firstTicketId, uint8 spots, uint64 purchasedAt)",
  "event ExclusionChanged(uint256 indexed roundId, address indexed wallet, bool excluded)",
  "event FeesClaimed(address indexed beneficiary, address indexed recipient, uint256 amount)",
  "event OracleChanged(address indexed oracle)",
  "event OrderBatchAccepted(bytes32 indexed pool, uint256 epoch, uint256 verified, uint256 total)",
  "event OrderRestarted(bytes32 indexed pool, uint256 epoch)",
  "event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event PoolCancelled(bytes32 indexed pool, bool timedOut)",
  "event PoolFinalized(bytes32 indexed pool, uint256 totalReturns, uint256 artistFees, uint256 appFees, uint256 subsidy)",
  "event ReserveFunded(address indexed funder, uint256 amount)",
  "event ReserveWithdrawn(address indexed recipient, uint256 amount)",
  "event ResultSubmitted(bytes32 indexed pool, uint256 actualViews, bytes32 evidenceHash)",
  "event RoundCreated(uint256 indexed roundId, bytes32 indexed songId, string musicId, address indexed artist, uint64 start)",
  "event SettlementProgress(bytes32 indexed pool, uint8 phase, uint256 scanCursor, uint256 pairCursor)",
  "event WalletApproval(address indexed wallet, bool approved)",
]);

type JsonObject = Record<string, any>;
type EventRow = {
  block_number: string; block_hash: string; transaction_hash: string;
  log_index: number; event_name: string; args: JsonObject; raw_log: JsonObject;
};
type Delivery = { nonce: string; hash: string; metadata: JsonObject; events: EventRow[] };
type Options = {
  secret?: string;
  persist: (delivery: Delivery) => Promise<unknown>;
};

function jsonSafe(value: unknown): any {
  return JSON.parse(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v));
}

function unsigned(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) throw Error("BAD_INTEGER");
  return BigInt(value);
}

export function normalizeEvents(payload: JsonObject): { metadata: JsonObject; events: EventRow[] } {
  if (!payload || payload.schemaVersion !== 1 || payload.chainId !== CHAIN_ID ||
      typeof payload.contract !== "string" || payload.contract.toLowerCase() !== CONTRACT ||
      !Array.isArray(payload.logs) || payload.logs.length > MAX_EVENTS) throw Error("BAD_PAYLOAD");
  const metadata = payload.metadata ?? {};
  if (typeof metadata !== "object" || Array.isArray(metadata) ||
      (metadata.network !== undefined && metadata.network !== "arc-testnet")) throw Error("BAD_NETWORK");
  const events = payload.logs.map((log: JsonObject): EventRow => {
    if (!log || typeof log.address !== "string" || log.address.toLowerCase() !== CONTRACT ||
        typeof log.transactionHash !== "string" || !HEX32.test(log.transactionHash) ||
        typeof log.blockHash !== "string" || !HEX32.test(log.blockHash) ||
        !Array.isArray(log.topics) || !log.topics.length || log.topics.length > 4 ||
        !log.topics.every((topic: unknown) => typeof topic === "string" && HEX32.test(topic)) ||
        typeof log.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data) ||
        (log.removed !== undefined && log.removed !== false)) throw Error("BAD_LOG");
    const block = unsigned(log.blockNumber), index = unsigned(log.logIndex);
    if (block < FIRST_BLOCK || block > 18446744073709551615n || index > 2147483647n) throw Error("BAD_LOG_POSITION");
    const decoded = decodeEventLog({ abi: EVENT_ABI, data: log.data, topics: log.topics, strict: true });
    return {
      block_number: block.toString(), block_hash: log.blockHash.toLowerCase(),
      transaction_hash: log.transactionHash.toLowerCase(), log_index: Number(index),
      event_name: decoded.eventName, args: jsonSafe(decoded.args), raw_log: jsonSafe(log),
    };
  });
  return { metadata: jsonSafe(metadata), events };
}

function reply(status: number, body: JsonObject): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: Request): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw Error("TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); throw Error("TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function createHandler({ secret, persist }: Options): (request: Request) => Promise<Response> {
  // Refuse ingestion if the private Stream security token is not configured.
  const configured = typeof secret === "string" && secret.length >= 32 && secret.length <= 1024;
  return async (request: Request): Promise<Response> => {
    if (request.method === "GET") return reply(configured ? 200 : 503, {
      service: "music-quicknode-events", configured,
    });
    if (request.method !== "POST") return reply(405, { error: "POST_REQUIRED" });
    if (!configured) return reply(503, { error: "STREAM_SECRET_NOT_CONFIGURED" });
    const encoding = request.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") return reply(415, { error: "SELECT_NO_COMPRESSION" });
    const nonce = request.headers.get("x-qn-nonce") ?? "";
    const timestamp = request.headers.get("x-qn-timestamp") ?? "";
    const signature = request.headers.get("x-qn-signature") ?? "";
    if (!/^[\x21-\x7e]{1,256}$/.test(nonce) || !/^\d{10,13}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) {
      return reply(401, { error: "INVALID_SIGNATURE_HEADERS" });
    }
    let body: Uint8Array;
    let text: string;
    try {
      body = await readBody(request);
      text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch (error) {
      return reply(error instanceof Error && error.message === "TOO_LARGE" ? 413 : 400, { error: "INVALID_BODY" });
    }
    try {
      const key = await crypto.subtle.importKey("raw", encoder.encode(secret!), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      const supplied = Uint8Array.from(signature.match(/../g)!, hex => parseInt(hex, 16));
      const valid = await crypto.subtle.verify("HMAC", key, supplied, encoder.encode(nonce + timestamp + text));
      if (!valid) return reply(401, { error: "INVALID_SIGNATURE" });
    } catch { return reply(503, { error: "VERIFICATION_UNAVAILABLE" }); }
    let normalized: ReturnType<typeof normalizeEvents>;
    try { normalized = normalizeEvents(JSON.parse(text)); }
    catch { return reply(422, { error: "INVALID_CONTRACT_EVENTS" }); }
    // Old, correctly signed retries remain valid. Permanent nonce + event keys
    // prevent replayed deliveries from changing state or duplicating events.
    try {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
      const result = await persist({ nonce, hash, ...normalized });
      return reply(200, { received: true, result });
    } catch {
      // QuickNode must retry: never acknowledge data that was not committed.
      return reply(503, { error: "EVENT_STORAGE_UNAVAILABLE" });
    }
  };
}

// Supabase supplies its own server credentials; never paste keys into this file.
if (typeof Deno !== "undefined") {
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    try { key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default; }
    catch { /* No server credential means fail closed. */ }
  }
  const url = Deno.env.get("SUPABASE_URL");
  const database = url && key ? createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  }) : null;
  Deno.serve(createHandler({
    secret: database ? Deno.env.get("QUICKNODE_STREAM_SECRET") : undefined,
    persist: async ({ nonce, hash, metadata, events }) => {
      if (!database) throw Error("SERVER_NOT_CONFIGURED");
      const { data, error } = await database.rpc("music_ingest_chain_events", {
        p_nonce: nonce, p_hash: hash, p_metadata: metadata, p_events: events,
      });
      if (error) throw Error("EVENT_STORAGE_UNAVAILABLE");
      return data;
    },
  }));
}
