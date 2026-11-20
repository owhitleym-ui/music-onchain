# Step 6 — Sample results, settlement and collections

Current update: daily-only V3 uses tomorrow / day after tomorrow / seven days later in Austin time, 5% of losing stake for the artist, and 1% of matched stake for the platform (main ranks 1 and 2 exempt). See [daily markets](DAILY-MARKETS.md). V3 requires a new deployment and migration 007; the older rules below are historical.


Implemented and automatically verified; live purchase and payout acceptance remains pending. The deployed contract and financial rules are unchanged. Music-view history and result counts are explicitly simulated until Step 7.

## Setup

Apply `backend/supabase/005_results_and_claims.sql` once after migrations 001–004 in the existing Supabase SQL Editor. Restart the local app with `npm run dev`. `/api/health` reports `claimsConfigured=true` when the migration is available. Existing purchases/approvals remain usable if it is missing; collections report setup unavailable.

Automatic settlement defaults to OFF. Keep `MUSIC_SETTLEMENT_ENABLED=false` (or absent) in the private backend environment during automated verification. No MetaMask private key is needed or requested. Never commit private environment files.

## Prepare a sample result

From `backend/`:

```sh
npm run results -- status ROUND_ID 24h
npm run results -- prepare ROUND_ID 24h SAMPLE_VIEW_COUNT
```

Use `24h`, `48h`, or `week` for the horizon. The exact windows are the first day, second day, and seventh day. A result can be prepared only after its measurement window ends and before the 48-hour refund grace deadline. Arc requires actual elapsed time; local tests advance disposable chain time.

`prepare` saves immutable sample evidence and prints the exact `submitResult` arguments/calldata, expected oracle and zero transaction value. Review that prepared submission in Remix and confirm it with the existing MetaMask oracle. The command does not sign or broadcast. Results are immutable on the contract. Evidence digests are audit references, not proof that the sample count came from a music provider.

For a later authorized live test, set `MUSIC_SETTLEMENT_ENABLED=true` privately and restart the backend. The opted-in coordinator verifies the saved evidence and complete indexed entries before queuing settlement batches. It shares the existing fenced administrator worker, signs durably before broadcast, and resumes from verified onchain progress. Batch limits are 32 ordered tickets, 32 scanned spots, and 16 allocation pairs. It submits one outstanding settlement action at a time and stops at terminal phases or the refund deadline. Unexpected progress requires inspection rather than a guessed replacement transaction.

Explicit operator actions, available only with settlement opted in:

```sh
npm run results -- restart ROUND_ID HORIZON
npm run results -- cancel ROUND_ID HORIZON "Reason for cancellation"
```

Restarting applies only to an incomplete ordering phase. Reserved/signed nonces must be reconciled before subsequent work. Unsigned superseded actions are cancelled safely; signed transactions are never silently replaced. Disabling settlement holds any existing administrator settlement work for later reconciliation.

## Collect participant returns

My Purchases → entry details displays a separate Collect return / Collect refund button for each eligible entry. The $20 option contains four independent ordinary entries; $50 has one entry with ten spots. The review shows expected funds, maximum estimated network fee, and destination as your own account. Confirming authorizes only that entry. Cancelled unsigned reviews do not transfer funds.

Participants need enough test balance for network fees. Buying permission is not required to collect an existing entry. Cancelled pools return full entry principal; fees remain additional. After a timeout, the first claim activates refunds in the same transaction. Claims are saved in the existing wallet transaction ledger, so purchases and claims cannot compete for the same nonce. Refresh/sign-out does not discard signed pending work.

Available amounts are distinct from received amounts. A receipt and canonical block are checked before marking money received. External claims are included when indexed; funds directed elsewhere are labeled and excluded from received/net totals. During indexing delay, the last verified snapshot is retained.

## Artist/app fees

```sh
npm run results -- fees
npm run results -- fees BENEFICIARY_ADDRESS
```

These commands read fee credits and prepare an unsigned `claimFees(beneficiary)` call for the beneficiary to confirm in MetaMask/Remix. Artist and app credits accumulate by wallet. The current project uses the same wallet for both, so collect the combined credit once. There is no new artist dashboard or backend signing key for that wallet.

## Verification

The backend and frontend suites cover migration compatibility/permissions, result evidence, more than 1,000 settlement records, multi-batch ordering, claim authorization, shared nonce serialization, private history, fee display and sign-out behavior. Disposable Anvil runs the recorded bytecode through sample result submission, signed resumable settlement, partial/final participant claims, combined beneficiary fees, owner cancellation and timeout refunds. Funds and liabilities reconcile throughout.

The original local project is the implementation target. No GitHub push, hosting change, live funding, role change, live result submission or live payout is part of this implementation. Real two-account $5/$20/$50 purchases and later Arc settlement/claims remain acceptance work.
