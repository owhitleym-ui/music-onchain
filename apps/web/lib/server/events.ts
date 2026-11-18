// Contract events delivered by the QuickNode Stream: decode raw logs with the Competition ABI,
// store them in Supabase (`chain_events`), and query them back for the leaderboard and feeds.
import "server-only";
import { decodeEventLog, getAddress, type Hex } from "viem";
import { competitionAbi } from "@/lib/abi/Competition";
import type { RawLog } from "@/lib/quicknode-signature";
import { db, type ChainEventRow } from "./db";
import { env } from "./env";

/** Decodes Competition logs into `chain_events` rows. Logs from other contracts are skipped. */
export function decodeCompetitionLogs(logs: RawLog[]): ChainEventRow[] {
  const competition = env.competitionAddress().toLowerCase();
  const rows: ChainEventRow[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== competition) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: competitionAbi,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data as Hex,
      });
    } catch {
      continue; // not one of our events (or an ABI mismatch after a redeploy)
    }
    const args: Record<string, string> = {};
    for (const [k, v] of Object.entries((decoded.args ?? {}) as Record<string, unknown>)) {
      args[k] = typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? getAddress(v) : String(v);
    }
    rows.push({
      tx_hash: log.transactionHash.toLowerCase(),
      log_index: log.logIndex,
      block_number: log.blockNumber.toString(),
      block_time: log.blockTimestamp ? new Date(log.blockTimestamp * 1000).toISOString() : null,
      event_name: decoded.eventName,
      competition_id: args.id !== undefined ? Number(args.id) : null,
      args,
    });
  }
  return rows;
}

export async function storeEvents(rows: ChainEventRow[]) {
  const client = db();
  if (!client) throw new Error("Supabase is not configured");
  if (rows.length === 0) return 0;
  const { error } = await client
    .from("chain_events")
    .upsert(rows, { onConflict: "tx_hash,log_index", ignoreDuplicates: true });
  if (error) throw new Error(`chain_events upsert failed: ${error.message}`);
  return rows.length;
}

export async function eventsForCompetition(id: number): Promise<ChainEventRow[] | null> {
  const client = db();
  if (!client) return null;
  const { data, error } = await client
    .from("chain_events")
    .select("*")
    .eq("competition_id", id)
    .order("block_number", { ascending: true })
    .order("log_index", { ascending: true });
  if (error) {
    console.error("chain_events read failed", error.message);
    return null;
  }
  return data as ChainEventRow[];
}

export async function eventsForPlayer(address: string): Promise<ChainEventRow[] | null> {
  const client = db();
  if (!client) return null;
  const { data, error } = await client
    .from("chain_events")
    .select("*")
    .eq("args->>player", getAddress(address))
    .order("block_number", { ascending: true })
    .order("log_index", { ascending: true });
  if (error) {
    console.error("chain_events read failed", error.message);
    return null;
  }
  return data as ChainEventRow[];
}

export async function recentEvents(limit: number): Promise<ChainEventRow[] | null> {
  const client = db();
  if (!client) return null;
  const { data, error } = await client
    .from("chain_events")
    .select("*")
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("chain_events read failed", error.message);
    return null;
  }
  return data as ChainEventRow[];
}
