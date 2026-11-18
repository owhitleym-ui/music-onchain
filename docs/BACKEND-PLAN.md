# Backend Plan

Owner: Sean. Scope: everything in `apps/web/app/api/`, server-only code in `apps/web/lib/server/`, the QuickNode Stream, the test wallets, and the README/Devpost write-up.

This plan builds on Olive's `SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/PLAN.md` on the `olive-testing` branch. If anything here conflicts with `SPEC.md`, update `SPEC.md` first.

---

## 1. What the backend is responsible for

| Job | Why it's needed | Route |
|---|---|---|
| Fund new users with test USDC | On Arc, USDC is both the entry fee and the gas. A new embedded wallet can't do anything until it has some. | `POST /api/faucet` |
| Settle competitions | Only the oracle key can call `settle(id, finalMetric)`. That key must stay on the server. | `POST /api/admin/settle` |
| Ingest contract events | QuickNode Stream pushes `Competition` events here. This powers the live leaderboard and qualifies for the QuickNode bounty. | `POST /api/streams/webhook` |
| Serve leaderboard data | One place that ranks entries with the same rule as the contract, so the UI never recomputes it differently. | `GET /api/competitions/[id]/leaderboard` |
| Serve competition list | Merges onchain state (`getCompetition`) with song metadata (`/songs/N.json`). | `GET /api/competitions` |
| Serve a user's entries | Powers "My Entries". | `GET /api/me/entries?address=` |
| (Optional) Pre-fill the real view count | Saves the admin from looking it up by hand. First thing to cut. | `GET /api/admin/youtube?videoId=` |

**Not the backend's job:** login UI, wallet creation, and the `approve` → `enter` transactions. Those happen in the browser through Privy (Olive).

---

## 2. Verified facts this plan depends on

| Fact | Source |
|---|---|
| QuickNode Streams supports **Arc Testnet** for Block, Transactions, **Logs**, Receipts and Traces datasets | QuickNode Streams supported-chains page |
| Stream webhooks carry `X-QN-Nonce`, `X-QN-Timestamp`, `X-QN-Signature`. The signature is hex HMAC-SHA256 of `nonce + timestamp + payload`, keyed with the Stream's security token. If the body is gzipped, verify against the decoded JSON. | QuickNode guide "Validating incoming Streams webhook messages" |
| Arc testnet chain ID `5042002`. Both `https://rpc.testnet.arc.io` and `https://rpc.testnet.arc.network` respond. Base fee is 20 gwei. Block gas limit 30M. | Queried the RPC directly |
| USDC ERC-20 at `0x3600000000000000000000000000000000000000`, 6 decimals. Native gas balance uses 18 decimals but is the same balance. Set `maxFeePerGas` ≥ 20 gwei or transactions are dropped silently. | `docs/ARCHITECTURE.md` (from Arc docs) |
| Arc has deterministic, sub-second finality, so there are no reorgs to handle | `docs/ARCHITECTURE.md` |

**Still to check before coding:**
- `apps/web` has no `node_modules` yet. Run `npm install`, then read the route-handler guide in `node_modules/next/dist/docs/` (required by `apps/web/AGENTS.md`). This is Next.js 16, so confirm how route params and runtimes work there rather than assuming.
- Whether the installed `viem` exports `arcTestnet` from `viem/chains`. If not, define the chain with `defineChain`.
- Which Privy server SDK to use for verifying access tokens, and its current package name.

---

## 3. File layout

```
apps/web/
├── app/api/
│   ├── faucet/route.ts                       POST  drip test USDC to the signed-in user
│   ├── admin/settle/route.ts                 POST  settle(id, metric) with the oracle key
│   ├── admin/youtube/route.ts                GET   optional: current view count
│   ├── streams/webhook/route.ts              POST  QuickNode Stream receiver
│   ├── competitions/route.ts                 GET   list
│   ├── competitions/[id]/leaderboard/route.ts GET  ranked entries + payouts
│   └── me/entries/route.ts                   GET   a wallet's entries
├── app/admin/page.tsx                        simple settle form (password + metric + button)
├── lib/
│   ├── abi/Competition.ts, SongRegistry.ts, erc20.ts   exported from contracts/out
│   ├── ranking.ts                            shared rank rule (also usable by the UI)
│   └── server/                               never imported by client components
│       ├── env.ts                            reads + validates server env vars
│       ├── chain.ts                          viem public client + wallet clients (oracle, faucet)
│       ├── db.ts                             Supabase client (service role)
│       ├── quicknode.ts                      signature verification + log decoding
│       └── auth.ts                           Privy access-token verification
└── public/songs/1.json, 2.json, 3.json       song metadata referenced by metadataURI
```

---

## 4. Data storage

Vercel functions don't keep memory between requests, so events need a real store. Use **Supabase Postgres** (free tier).

```sql
-- Raw decoded events from the Stream. Idempotent on (tx_hash, log_index).
create table chain_events (
  tx_hash        text    not null,
  log_index      int     not null,
  block_number   bigint  not null,
  block_time     timestamptz,
  event_name     text    not null,      -- EntrySubmitted, CompetitionSettled, WinnerPaid, ...
  competition_id bigint,
  args           jsonb   not null,      -- decoded event args, bigints as strings
  received_at    timestamptz default now(),
  primary key (tx_hash, log_index)
);
create index on chain_events (competition_id, event_name);

-- One drip per Privy user and per wallet.
create table faucet_drips (
  privy_user_id  text primary key,
  address        text unique not null,
  tx_hash        text not null,
  amount         numeric not null,
  created_at     timestamptz default now()
);
```

Leaderboard and "My Entries" are queries over `chain_events`. There's no separate entries table to keep in sync.

**Fallback:** if the Stream or database is down, the leaderboard route reads `getEntries(id)` and `getCompetition(id)` straight from the contract and ranks them with the same function. The response includes `"source": "stream"` or `"source": "chain"` so you can tell which one served it.

---

## 5. Route details

All request and response shapes below go into `SPEC.md` so Olive builds against the same contract. Amounts are returned as **dollar strings** (`"5.00"`) as well as raw 6-decimal integers, because the UI shows dollars only.

### `POST /api/faucet`
- **Auth:** `Authorization: Bearer <Privy access token>`. Verify it server-side and get the Privy user ID and their embedded wallet address from Privy. Don't trust an address sent in the body.
- **Rules:** one drip per Privy user and per address (enforced by `faucet_drips`). Drip amount from `FAUCET_DRIP_USDC` (proposed $20).
- **Action:** `USDC.transfer(address, amount)` from the faucet wallet with `maxFeePerGas` ≥ 20 gwei. Wait for the receipt (sub-second on Arc), then insert the row.
- **If verified-user allowlisting is added to the contract:** call `setVerified(address, true)` here too, from the owner key.
- **Response:** `{ ok, txHash, amount: "20.00", alreadyFunded }`. If they already got a drip, return `alreadyFunded: true` instead of an error, so the UI stays simple.
- **Ops:** a route or script that reports the faucet wallet balance, so it doesn't run dry mid-demo.

### `POST /api/admin/settle`
- **Auth:** `x-admin-secret` header must equal `ADMIN_SECRET` (constant-time compare).
- **Body:** `{ competitionId, finalMetric }`.
- **Checks before sending:** read `getCompetition(id)`. Return a clear error if it isn't Open, or if the close/resolve time hasn't passed. Then `simulateContract` so reverts surface as readable errors instead of a failed transaction.
- **Action:** `settle(id, finalMetric)` from the oracle key. Return `{ ok, txHash, status: "Settled" | "Cancelled" }`. Cancelled means it was below the minimum entries and everyone was refunded.
- **Admin page** (`/admin`): a password field, a competition dropdown, a number input (pre-filled from YouTube if that route exists), and a Settle button. Also a Cancel button that calls a matching `/api/admin/cancel`, for demo resets.

### `POST /api/streams/webhook`
1. Read the **raw** body. Gunzip if `content-encoding: gzip`.
2. Verify `X-QN-Signature` = hex HMAC-SHA256(`nonce + timestamp + body`, `QUICKNODE_STREAMS_WEBHOOK_SECRET`) with a constant-time compare. Reject if the timestamp is more than 5 minutes old. Return 400 for missing headers, 401 for a bad signature.
3. Decode each log with viem `decodeEventLog` and the Competition ABI. Skip logs from any other address.
4. Upsert into `chain_events` (duplicates are ignored, so redelivery is safe).
5. Return 200 quickly. QuickNode retries on failure.

### `GET /api/competitions`
For each competition ID: `getCompetition(id)` from the chain, plus the song JSON from `/public/songs/N.json`. Returns title, artist name, artwork, metric label, entry fee, pot, entries count, status, close/resolve times. Cache for a few seconds.

### `GET /api/competitions/[id]/leaderboard`
- **Before settlement:** entries in entry order (prediction, entry time, whether it's the caller's).
- **After settlement:** entries ranked with `lib/ranking.ts`, with the error from the final metric and payouts joined in from `WinnerPaid` events. Also returns `artistPaid` from `ArtistPaid`.
- **Ranking rule** (must match `Competition.sol` exactly): smaller `|prediction − finalMetric|` ranks higher; ties go to the lower `entryIndex`. Unit-test this against the same cases as the Foundry tie test.
- **Live updates:** the UI polls this every 2–3 seconds. Simpler than websockets and fast enough for the demo.
- **Display:** show players as short names or "You", never raw addresses (project rule: crypto stays invisible).

### `GET /api/me/entries?address=`
`EntrySubmitted` rows for that player, joined with each competition's status and any payout or refund.

### `GET /api/admin/youtube?videoId=` (optional)
YouTube Data API `videos?part=statistics&id=…` → `viewCount`. Admin-secret protected. Only used to pre-fill the settle form; the admin still confirms the number.

---

## 6. QuickNode Stream setup

| Setting | Value |
|---|---|
| Network | Arc Testnet |
| Dataset | Logs (or Block with Receipts plus a filter function, if Logs filtering isn't enough) |
| Filter | Keep only logs where `address == NEXT_PUBLIC_COMPETITION_ADDRESS` and `topics[0]` is one of the Competition event signatures (`EntrySubmitted`, `CompetitionCreated`, `CompetitionSettled`, `WinnerPaid`, `ArtistPaid`, `PlatformPaid`, `CompetitionCancelled`, `Refunded`) |
| Start block | The Competition deployment block (backfills everything since deploy) |
| Destination | Webhook → `https://<production domain>/api/streams/webhook` |
| Security token | Copy into `QUICKNODE_STREAMS_WEBHOOK_SECRET` in Vercel |

The bounty requires the README to explain the network, dataset, filter logic, destination, and why. Copy this table into the README once it's final.

**Important:** every redeploy of `Competition.sol` changes the address, so the Stream filter and start block must be updated too.

---

## 7. Environment variables to add

Server-only variables never get the `NEXT_PUBLIC_` prefix. Add these to `.env.example` and to Vercel:

```
# Server keys (TEST KEYS ONLY)
ORACLE_PRIVATE_KEY=          # already listed
FAUCET_PRIVATE_KEY=          # already listed
FAUCET_DRIP_USDC=20

# Auth
PRIVY_APP_SECRET=            # server-side token verification
ADMIN_SECRET=                # already listed

# Data
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
COMPETITION_DEPLOY_BLOCK=    # Stream start block and chain-read fallback

# Services
QUICKNODE_STREAMS_WEBHOOK_SECRET=   # already listed
YOUTUBE_API_KEY=                    # already listed, optional
```

Use three separate test wallets: **deployer/owner**, **oracle**, **faucet**. If one key leaks, it can't do the others' jobs.

---

## 8. Build order

Each step is usable on its own, so the demo improves even if later steps don't get done.

1. **Setup:** `npm install` in `apps/web`, read the Next.js 16 route-handler docs, add `viem`, the Supabase client, and the Privy server SDK. Create `lib/server/env.ts` and `lib/server/chain.ts`.
2. **Wallets:** create the deployer, oracle, and faucet test keys. Fund them from faucet.circle.com (Arc Testnet).
3. **Admin settle route + `/admin` page.** Test it locally against `arc-anvil` or `DeployLocal.s.sol`, then against the testnet deployment.
4. **Faucet route**, including Privy token verification and the `faucet_drips` table.
5. **Leaderboard, competitions, and My Entries routes**, first using the chain-read fallback only. This unblocks Olive's screens right away.
6. **Supabase `chain_events` table + webhook route.** Test with a hand-signed sample payload via `curl` before connecting QuickNode.
7. **Create the QuickNode Stream** pointed at the deployed webhook. Enter a test prediction and watch the row appear.
8. **Switch the leaderboard to read from `chain_events`**, keeping the chain-read fallback.
9. **Optional:** YouTube pre-fill.
10. **README sections** for the backend, the Stream config, security notes, and env setup.

## 9. Testing

- **Unit (Node's built-in test runner, `npm test`; Vitest conflicts with the project's `@types/node`):** the ranking function (including ties and a player with several entries), webhook signature verification (valid, wrong secret, stale timestamp, gzipped body), and log decoding with a recorded payload.
- **Local integration:** run `DeployLocal.s.sol` against anvil and hit each route with `curl`.
- **Testnet end to end, twice from a fresh account:** log in → faucet → enter → wait for close → settle from `/admin` → check payouts on the explorer → check the leaderboard matches.

## 10. Security checklist

- [ ] No private key or secret is ever read in a client component or sent with a `NEXT_PUBLIC_` prefix.
- [ ] Faucet: Privy-verified user only, one drip per user and per address.
- [ ] Admin routes: `ADMIN_SECRET`, constant-time comparison.
- [ ] Webhook: HMAC verification, a timestamp window, and idempotent inserts.
- [ ] Oracle key can only settle and cancel. It isn't the owner.
- [ ] Before the repo goes public, scan the git history for keys.
- [ ] Document the limits honestly: one trusted oracle key, predictions visible onchain, and wallets can be created to get around the artist block.

## 11. Depends on other people

| Need | From | Why |
|---|---|---|
| Final contract ABI and deployed addresses | Contracts | The `resolvesAt` fix and multi-entry change will change the ABI and events |
| Privy app ID and dashboard access (for the app secret) | Olive | Faucet auth |
| Agreement on the API response shapes in `SPEC.md` | Olive | So the frontend and backend fit together |
| Song metadata (title, artist, artwork, YouTube ID) | Team | `public/songs/*.json` |

## 12. Cut order

If time runs short, cut in this order:
1. YouTube pre-fill (type the number by hand).
2. The `/admin` page (settle with a `curl` command instead).
3. "My Entries" route (the UI can filter the leaderboard).

**Never cut:** the faucet, the settle route, and the webhook writing to `chain_events`. The webhook is what qualifies for the QuickNode bounty.
