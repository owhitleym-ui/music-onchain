# Backend runbook

How to run, configure, and test the backend in `apps/web`. The design is in `docs/BACKEND-PLAN.md`, the API contract is in `SPEC.md` under "Backend API", and which frontend button calls which route is in `docs/FRONTEND.md`.

## What's here

| Path | What it does |
|---|---|
| `app/api/faucet` | Sends test USDC to a Privy-verified user, once |
| `app/api/admin/{settle,cancel,status,youtube}` | Oracle actions and ops checks, behind `ADMIN_SECRET` |
| `app/api/streams/webhook` | QuickNode Stream receiver: verifies the signature, decodes Competition logs, stores them |
| `app/api/competitions`, `…/[id]/leaderboard`, `me/entries`, `activity` | Read routes for the UI |
| `app/admin/page.tsx` | Admin console (settle, cancel, balances). Not linked from the public UI |
| `lib/server/*` | Server-only code: env, viem clients, Privy auth, Supabase, event decoding, response shapes |
| `lib/ranking.ts`, `lib/money.ts` | Ranking/payout math (mirrors `Competition.sol`) and dollar formatting |
| `lib/quicknode-signature.ts` | Webhook HMAC check and log extraction |
| `lib/abi/*` | Generated from `contracts/out` by `npm run abi` |
| `lib/songs.ts` | Song display data keyed by `metadataURI`. **Placeholders until the team picks songs** |
| `db/schema.sql` | Supabase tables |
| `quicknode/filter.js` | Stream filter function to paste into QuickNode |

## After any contract change

```bash
cd contracts && forge build
cd ../apps/web && npm run abi && npx tsc --noEmit
```

If `Competition.Config` changes (for example adding `resolvesAt`), update the field mapping in `readCompetition` (`lib/server/competitions.ts`) and the phase logic in `phaseOf`. Everything else reads from there.

## Local end-to-end (no Privy, no Supabase, no QuickNode)

1. Start anvil: `anvil` (or the `anvil` entry in `.claude/launch.json`).
2. Deploy and seed: `cd contracts && forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast`
3. Create `apps/web/.env.local` (gitignored) with `CHAIN_ID=31337`, `CHAIN_RPC_URL=http://127.0.0.1:8545`, the three printed addresses, anvil's public dev keys for `ORACLE_PRIVATE_KEY` (account #0, the local oracle) and `FAUCET_PRIVATE_KEY` (account #1, pre-funded with mock USDC), `ADMIN_SECRET`, `QUICKNODE_STREAMS_WEBHOOK_SECRET`, and `FAUCET_ALLOW_UNAUTHENTICATED=true`.
4. `cd apps/web && npm run dev`, then:
   ```bash
   curl -s localhost:3000/api/competitions
   curl -s -X POST localhost:3000/api/faucet -H 'content-type: application/json' -d '{"address":"0x…"}'
   # enter with cast: approve(Competition, 5000000) on USDC, then enter(id, prediction)
   cast rpc evm_increaseTime 1000 && cast rpc evm_mine   # skip past closesAt
   curl -s -X POST localhost:3000/api/admin/settle -H 'x-admin-secret: …' -H 'content-type: application/json' -d '{"competitionId":1,"finalMetric":"1010000"}'
   curl -s 'localhost:3000/api/competitions/1/leaderboard?viewer=0x…'
   ```
5. Unit tests: `npm test` (Node's built-in runner; covers ranking, payouts, money, webhook signatures).

## Arc testnet setup

1. **Wallets.** Create three test keys with `cast wallet new`: deployer/owner, oracle, faucet. Fund all three at https://faucet.circle.com (Arc Testnet). The faucet wallet needs the most: `FAUCET_DRIP_USDC` × expected users.
2. **Deploy.** `contracts/README.md` → `Deploy.s.sol` with `ORACLE_ADDRESS` = the oracle key's address, then `Seed.s.sol`. Note the Competition deployment block for `COMPETITION_DEPLOY_BLOCK`.
3. **Supabase.** Create a project, run `db/schema.sql` in the SQL editor, copy the URL and service-role key.
4. **Privy.** From the Privy dashboard: app ID (`NEXT_PUBLIC_PRIVY_APP_ID`) and app secret (`PRIVY_APP_SECRET`). Olive configures the client side.
5. **Vercel env.** Set every variable from `.env.example` that applies, with `CHAIN_ID=5042002`. Never set `FAUCET_ALLOW_UNAUTHENTICATED` in production (it's ignored there anyway).
6. **QuickNode Stream** (after the app is deployed, so the webhook URL exists):

   | Setting | Value |
   |---|---|
   | Network | Arc Testnet |
   | Dataset | Logs |
   | Filter | `quicknode/filter.js`, with the Competition address filled in. Keeps only Competition logs; skips empty batches |
   | Start block | `COMPETITION_DEPLOY_BLOCK` (backfills history) |
   | Destination | Webhook → `https://<domain>/api/streams/webhook` |
   | Security token | Copy into `QUICKNODE_STREAMS_WEBHOOK_SECRET` |

   **Why:** the leaderboard and activity feed read events the Stream pushed, instead of every page load polling the RPC. The webhook verifies QuickNode's HMAC signature (`nonce + timestamp + body`), rejects deliveries more than 5 minutes old, and upserts on `(tx_hash, log_index)` so retries never double-count.
7. **Check.** Open `/admin`, enter the secret, click Load. Both wallets should show balances and the database should say "connected". After the first test entry, `GET /api/competitions/1/leaderboard` should report `"source": "stream"`.

## How reads stay correct

- The leaderboard uses Stream events only when the database has at least as many entries as the contract reports. Otherwise it reads `getEntries` directly and says `"source": "chain"`. A slow or broken Stream never shows a wrong leaderboard.
- Phase (`open` / `closed`) uses the latest block's timestamp, the same clock the contract checks.
- Ranking uses `lib/ranking.ts`, which mirrors the contract (smallest error wins, ties go to the earlier entry). After settlement, payouts come from the `WinnerPaid` events when available.

## Verified so far (local anvil, November 18)

- Faucet: first drip sends $10; a second request returns `alreadyFunded`; no auth returns 401.
- Settle: refused while open, with a wrong secret, and twice; succeeds after close. Balances matched the split (1st $8, 2nd $4, 3rd $2, artist $5, platform $1 on a $20 pot).
- Settling below `minEntries` cancels and refunds; manual cancel works.
- Leaderboard: open, settled (ranked with payouts), and cancelled (refunds) all correct.
- Webhook: correctly signed plain and gzipped bodies accepted; bad signature, stale timestamp, and missing headers rejected; all 20 real events decoded.

**Not yet verified:** Privy token verification (needs the real app ID and secret), Supabase writes and the `"stream"` read path, a real QuickNode delivery, and anything on Arc testnet.
