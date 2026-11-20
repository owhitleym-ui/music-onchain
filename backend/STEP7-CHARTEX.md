# Step 7 — local Chartex daily demo

Featured song: **Tennessee Orange — Megan Moroney**, Spotify `6DLbBlGIOjjEj0dNN25zhZ`. The new on-chain music identity is `chartex:spotify:6DLbBlGIOjjEj0dNN25zhZ`; the contract song ID hashes `tennessee-orange`. Existing Last Bus Home entries retain their original identities and claims/refunds.

## Setup

1. Apply **all** of `backend/supabase/008_chartex_demo.sql` in the existing Supabase project after migrations 001–007. It creates private, RLS-protected observations, collection leases, immutable rules and frozen result candidates; extends the existing fenced administrator queue. No public read policies are needed.
2. Save `CHARTEX_APP_ID` and `CHARTEX_APP_TOKEN` privately in `backend/.env.local`. Use the existing API Dashboard values, never frontend environment variables. Do not commit this file.
3. From `backend`, run `npm run chartex -- collect`. This imports the prior 30 named dates and song metadata. Missing/invalid counts stay missing; zero is valid. Both raw daily responses and their SHA-256 hashes are preserved.
4. Run `npm run chartex -- authorize-oracle`. This uses the existing durable transaction worker to set the current verified V3 contract's oracle to the backend administrator. It verifies the runtime, ownership, registered active deployment, receipt and oracle role. No contract redeployment or payout change.
5. Run `npm run chartex -- activate`. Activation requires migration, private credentials, saved data, oracle and indexed history. It writes local settings only: `MUSIC_DATA_SOURCE=chartex`, the verified `MUSIC_ORACLE_ADDRESS`, settlement and scheduler enabled.
6. Restart root `npm run dev`. Check `npm run chartex -- status`, `http://localhost:3001/api/health` and the featured song in the app. The scheduler creates new daily rounds and binds their three immutable metric policies. Purchases wait until those policies exist.

If a setup command fails, it prints a code without provider bodies, tokens or signed transactions. Fix the named prerequisite and retry; collection leases and administrator jobs survive restarts. `ORACLE_JOB_PENDING` means the existing queue must finish/reconcile before activation; do not send a replacement transaction manually.

## Collection and result rules

The collector checks its persisted schedule every minute and performs a provider refresh every six hours after success. Temporary failures retry after an hour and keep saved history. Browsers use only stored history (`GET /api/music/tennessee-orange/history`) and do not trigger Chartex requests.

Bidding uses America/Chicago calendar boundaries, including daylight saving. Target offsets are +1, +2 and +7 dates. The metric is **Chartex-reported daily TikTok views for that named date** across the song's matched sounds. Chartex’s reporting timezone is not verified as Austin; the UI does not claim an exact Austin counting window. Source docs: https://chartex.com/apidocs/songs/stats

Automatic results require two successful, matching valid whole-number observations at least six hours apart, both at least 24 hours after the scheduled target end. A revision or missing count restarts stability. Each pool's evidence freezes once and survives restarts and later revisions. Evidence identifies the song, target date, metric policy, response hashes and retrieval times. Later revisions update the chart only.

The durable administrator worker validates evidence and the on-chain role, simulates, persists the exact signed transaction, verifies its receipt, and resumes the existing settlement batches. Indexed events and receipts must agree before winnings appear claimable. Each player claims through their own wallet.

No new result broadcasts occur from one hour before the existing 48-hour refund deadline onward. Missing, invalid or unstable counts leave the pool unsettled; the existing timeout refund remains available. A nonce prepared before a prolonged outage is retained for reconciliation, never silently replaced.

`/api/health` exposes collection freshness/error codes and result/scheduler status. `npm run chartex -- status` also verifies the current owner and oracle. Keep the local backend running: this is an Arc Testnet demo, not a hosted automation.

## Demo disclosures

The $5/$20/$50 options, 5% artist allocation, 1% platform allocation with main-rank 1/2 exemption and reserve-funded bundle bonus are unchanged. The artist recipient is the existing **demo test wallet**, not Megan Moroney's wallet. No artist partnership or commercial data license is represented.

## Validation

Backend and frontend regression suites include access/quota/timeout failures, missing/zero/invalid data, revisions, private tables, immutable policies/candidates, request deduplication and cached source views. The disposable-chain test exercises oracle authorization, new song scheduling, stable evidence, result submission, settlement, accounting and independent claims. Existing daily boundary tests cover Austin midnight and daylight-saving days; legacy purchase/claim/refund suites remain applicable.
