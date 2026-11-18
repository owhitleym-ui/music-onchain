import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

// Supabase is optional: without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY every read route
// falls back to reading the contract directly, and the webhook returns 503.
// The service-role key bypasses row-level security, so this module must stay server-only.

let _db: SupabaseClient | null | undefined;

export function db(): SupabaseClient | null {
  if (_db !== undefined) return _db;
  const url = env.supabaseUrl();
  const key = env.supabaseServiceRoleKey();
  _db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return _db;
}

/** Row shape of `chain_events` (see apps/web/db/schema.sql). */
export type ChainEventRow = {
  tx_hash: string;
  log_index: number;
  block_number: string;
  block_time: string | null;
  event_name: string;
  competition_id: number | null;
  args: Record<string, string>;
};
