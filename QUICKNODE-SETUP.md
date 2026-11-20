# QuickNode event receiver — setup checkpoint

The local app remains at http://localhost:3000. This hosted Supabase function
receives blockchain events; it does not sign transactions or hold wallet keys.
Live QuickNode delivery and database storage are now verified. The stream is Active, as confirmed by the user. The remaining app screens are Step 5.

## Files

- `supabase/functions/music-quicknode-events/index.ts`: self-contained file for
  the Supabase dashboard editor. Replace the whole default sample with it.
- `backend/supabase/003_quicknode_events.sql`: run once in a new SQL query named
  `003 — QuickNode Event Storage` in project `dnobgwmuvdqhnraagvnq`.
- `supabase/config.toml`: disables the platform JWT check for this function only;
  dashboard deployments need the equivalent function setting switched off.
- `backend/test/quicknode-events.test.mjs`: tests the actual pasteable file and
  migration, including signatures, retries, outages, atomic writes and access.

## Dashboard setup

1. Keep the QuickNode stream unstarted. In Supabase, name the function
   `music-quicknode-events` and replace its `index.ts` with our whole file.
2. Run migration 003 once in the Supabase SQL editor. It adds two tables and one
   backend-only function, preserving approval and payment data. Expect
   “Success. No rows returned.” Do not rerun migrations 001 or 002.
3. Deploy the function and disable **Verify JWT with legacy secret** for this
   function. QuickNode uses its HMAC signature in place of a Supabase user JWT.
   Do not send a Supabase server key in QuickNode headers.
4. Privately copy this Stream's **security token** from QuickNode Settings to
   Supabase Edge Functions → Secrets, named `QUICKNODE_STREAM_SECRET`. This is
   the Stream token, not the RPC endpoint authentication token. The receiver
   stays unavailable until this token is configured (at least 32 characters).
   If QuickNode generates it only after creation, create the stream, pause it
   immediately, set the secret, then resume after the database is ready.
5. Set the QuickNode webhook destination to
   `https://dnobgwmuvdqhnraagvnq.supabase.co/functions/v1/music-quicknode-events`.
   Use **Logs**, **Compression: None**, and the tested JavaScript filter below.
   Set the actual Stream range start to **73100560**, not just the preview block.
   Start with small batches (batch messages off) and allow retries.
6. Observe a real signed delivery in function logs and query the event tables.
   Repeated history backfills must increase delivery records without duplicating
   existing events. If a connection test sends an unsigned POST, rejection is
   expected: do not remove signature checks to make an unsigned probe pass.

The database server credentials are supplied privately by Supabase at runtime.
No credentials are embedded in the code. Failed database writes return 503 so
QuickNode can retry. Signed historical retries are accepted: nonce records and
per-event keys provide durable deduplication without dropping delayed retries.
Conflicting/removed events stop ingestion for operator reconciliation, rather
than silently overwriting history. Conflicting reorg records require operator review; automatic destructive repair is not performed.
The local commands below provide independent RPC backfill and reconciliation.

This receiver does not yet connect the local app's RPC reads to the QuickNode
endpoint and does not replace frontend totals with indexed data (Step 5).

## Tested QuickNode filter

```js
function main(stream) {
  const contract = "0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083";
  const logs = stream.data.flat(Infinity).filter(log =>
    typeof log?.address === "string" &&
    log.address.toLowerCase() === contract
  );
  return logs.length ? {
    schemaVersion: 1, chainId: 5042002, contract,
    metadata: stream.metadata ?? {}, logs
  } : null;
}
```

Implementation references: [QuickNode signature format](https://www.quicknode.com/guides/quicknode-products/streams/validating-incoming-streams-webhook-messages),
[webhook delivery/retries](https://www.quicknode.com/docs/streams/destinations/webhooks),
[Supabase function authentication](https://supabase.com/docs/guides/functions/auth),
[Supabase private environment variables](https://supabase.com/docs/guides/functions/secrets).


## Verified live checkpoint — November 19, 2026

Migration 003 is installed, the receiver is deployed with gateway JWT checking
off, the Stream security token is stored privately in Supabase, and the user
confirmed the QuickNode stream is Active. Four actual QuickNode event deliveries
were saved and independently matched to successful Arc transaction receipts:
OwnershipTransferred, WalletApproval, RoundCreated, and ReserveFunded.

A full contract-history replay through block 73114615 found 4 chain events and
4 stored events: 0 missing, 0 conflicting, 0 extra, and 0 newly inserted by the
replay. No participant payment was signed or broadcast by these checks.

## Local operator commands

From `/Users/tj/Desktop/Hachathon/backend`:

```sh
npm run events -- check
npm run events -- backfill
```

`check` compares the current atomic deployment's entire history with Supabase,
without writing. `backfill` verifies the chain ID, deployed code and successful
receipts, then replays those records through the same SQL conflict checks and
unique event keys. Existing records stay stored once. A later invocation can
resume after a failed batch or database outage; committed records deduplicate.
Both commands return a failing exit status on unresolved missing/conflicting
history. Transient public RPC throttling uses the existing paced retry guard.
No wallet private key is used to sign a transaction by these commands.

The recovery command currently uses `ARC_RPC_URL` from the private backend
settings (the public Arc endpoint at this checkpoint). Normal event delivery is
QuickNode Streams → Supabase Edge Function → Supabase database. QuickNode's RPC
endpoint token has not been copied into local settings.

Step 5 (reading indexed market data in consumer screens) has not started.
The real $5/$20/$50 participant-purchase acceptance tests in Step 3 are still
pending; having an Active event stream does not complete those tests. Round 1's
original entry window was 7–8 PM Central Time on November 19 and is now closed.
