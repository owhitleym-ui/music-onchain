# Atomic $20 entries and local test payments

Current update: daily-only V3 uses tomorrow / day after tomorrow / seven days later in Austin time, 5% of losing stake for the artist, and 1% of matched stake for the platform (main ranks 1 and 2 exempt). See [daily markets](DAILY-MARKETS.md). V3 requires a new deployment and migration 007; the older rules below are historical.


The code supports $5 / one ordinary spot, $20 / four separate ordinary entry records in one atomic transaction, and $50 / ten spots with the existing conditional 1.05 multiplier. The $20 option has no discount or bonus. Failed on-chain transactions can still cost network fees.

The new contract has NOT been deployed. Live payments stay disabled until the deployment has been verified and activated. The existing account, balance and automatic approval connection remain on the previously deployed contract until that cutover.

## Start

```sh
cd /Users/tj/Desktop/Hachathon
npm run dev
```

Open http://localhost:3000/. Only Last Bus Home will accept test payments. Other songs remain previews. All music statistics are simulated in this milestone. Account purchase records are separate from browser-local sample records; Reset demo cannot erase account payments.

## Deployment and activation, in order

1. Apply `backend/supabase/002_atomic_payments.sql` in the same Supabase project's SQL Editor. Migration 001 must already be installed. This preserves existing approval/signing records and team tables, adds contract-scoped approval functions and the backend-only payment journal, and grants no browser access. Apply 002 only once.
2. In Remix, upload `remix/MusicPredictionContest90Four.sol`. Select Solidity **0.8.28**, optimizer **enabled / 200 runs**, EVM **Cancun**, **via IR disabled**. Select **MusicPredictionContest**, not a helper library. Use Browser Extension / MetaMask on Arc Testnet. Leave deployment Value at zero.
3. Deploy with these constructor arguments:
   - `initialOwner`: `0x170249F9Ac07D25F97bC1957B68A0011543d07ad`
   - `initialOracle`: `0xcd61a22acf76623114583a1e0a031c18201baf51`
   - `appRecipient`: `0xcd61a22acf76623114583a1e0a031c18201baf51`
   The existing dedicated backend administrator owns the new contract immediately. No new administrator key is generated and no ownership-transfer transaction is needed. MetaMask remains oracle and app-fee recipient.
4. Keep the new contract address and its deployment transaction hash. With the local services stopped, run:

   ```sh
   cd /Users/tj/Desktop/Hachathon/backend
   npm run admin -- activate-contract NEW_CONTRACT_ADDRESS DEPLOYMENT_TRANSACTION_HASH
   ```

   This verifies deployed executable code against the reviewed artifact, chain, receipt, roles, prices, 90% curve, database migration and absence of unfinished orders/admin actions. It records the verified deployment and updates only the ignored local backend configuration. It does not deploy a contract or move funds. Previous deployments remain separate.
5. Restart the root `npm run dev`. Sign in; the backend must approve the account on the NEW contract. Old approvals cannot stand in for new approvals. Previously blocked accounts remain blocked unless explicitly re-enabled by the operator.
6. In another Terminal, create an hourly test round:

   ```sh
   cd /Users/tj/Desktop/Hachathon/backend
   npm run admin -- create-round
   ```

   The existing serialized administrator worker creates the next whole-hour round with at least two minutes of lead time. It uses `demo:last-bus-home` and the original MetaMask address as the test artist-fee recipient. The app displays Central Time; the contract uses UTC seconds. Entries open only during the round's first hour. Create another round with the same command when needed.
7. Manually fund the participant. A $20 balance alone does not cover a $20 purchase plus gas. Testing all three prices requires $75 plus quoted network fees. No automatic funding has been added.
8. Before testing $50, fund the NEW contract's bonus reserve through Remix's `fundBonusReserve`, with at least 2.5 native test USDC. In wei that is `2500000000000000000`. Use that function rather than a bare transfer. Reset Remix Value to zero afterward. Each accepted bundle reserves another 2.5 until settlement/cancellation releases it; $5 and $20 do not require a bonus reserve.

## What the payment code does

The authenticated backend derives the participant address from Privy. It checks the deployed code, round, approval, exclusion, reserve, exact price and balance including the maximum quoted gas cost. The app shows an explicit confirmation before Privy signs. Privy retains the private key. Only the signed transaction goes to the backend.

The backend validates the sender, chain, contract, nonce, value, calldata and gas against the saved quote. It durably saves the signed transaction/hash before broadcasting. Repeated uploads reuse that transaction. Database uniqueness and one active order per participant prevent simultaneous purchases from different tabs. A pending or uncertain payment blocks another order until reconciled; do not pay again to work around it.

A successful receipt and matching stored contract entries are required for confirmation. A $20 receipt must contain four distinct EntryRecorded events, each corresponding to an ordinary $5 entry with the same guess and a 1.00 multiplier. The app groups these records under one purchase. Payment confirmation is distinct from a contest result or payout.

Unsigned confirmations expire after at most two minutes or at the round deadline. They can be cancelled or replaced after expiry. Signed unresolved transactions never expire into permission for a replacement charge. A consumed nonce without a verifiable matching receipt, an unexpected receipt, or a closed round with an unresolved transaction remains flagged for organizer review.

## Interfaces

Public reads: `GET /api/contests`, `GET /api/contests/:roundId/pools/:horizon`.

Authenticated: `POST /api/purchases` with an `Idempotency-Key` UUID and `{roundId, horizon, guess, optionId}`; `GET /api/purchases`; `GET /api/purchases/:id`; `POST /api/purchases/:id/signed` with `{signedTransaction}`; `DELETE /api/purchases/:id` for unsigned orders.

`roundId` and `guess` are decimal strings. Horizon is `24h`, `48h`, or `week`. Option is `single`, `four`, or `bundle`. Financial values and transaction quantities remain integer strings across JSON. No arbitrary wallet address, contract, amount or administrative transaction can be chosen through these endpoints.

Crowd averages and modes count spots, including ten votes for a $50 bundle and four votes for a $20 order. Reads use consistent block snapshots. Public crowd calculations are bounded to 1,000 entries per pool; beyond that, totals remain visible and crowd statistics are omitted rather than fabricated. QuickNode/indexing will replace this local polling approach later.

## Remaining live verification

After activation and round opening, complete $5, $20 and $50 purchases. Verify the four $20 entry IDs, account balance, pool totals, history after reload and sign-out/sign-in, and absence of duplicate transactions. Check the real Privy signing flow, keyboard navigation, themes and a narrow window. These checks require the user's new Remix deployment and browser authorization; local automated tests do not claim to replace them.

Results/settlement/claims, the real music feed, QuickNode, automatic funding, public hosting, pushes and team branch integration are not part of this change.
