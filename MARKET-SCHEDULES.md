# Hourly and daily prediction markets (V2)

Current update: daily-only V3 uses tomorrow / day after tomorrow / seven days later in Austin time, 5% of losing stake for the artist, and 1% of matched stake for the platform (main ranks 1 and 2 exempt). See [daily markets](DAILY-MARKETS.md). V3 requires a new deployment and migration 007; the older rules below are historical.


## Verified live activation — November 20, 2026

The new `markets-v2` deployment is active on Arc Testnet at `0x869645d675ce22527ea37112b2c8e640f4cd2919`. Its deployment transaction is `0x9ccccfde8a45b00448b81970ac7202f9f145f8f6e91ad5f08545630f1acb9f31`. The 2.50 test USDC reserve funding was verified, migration 006 is installed, and the registry retains `atomic-v1` as inactive for old history and claims.

The local scheduler is enabled. Its first three hourly rounds (IDs 1–3) and two daily rounds (IDs 4–5) were confirmed, and QuickNode delivered their `RoundCreated` / `MarketScheduled` events to Supabase. Live browser checks verified all three current markets with bidding open, the correct hourly/daily measurement periods, and the mobile layout. No participant login or purchase was performed during activation.

Automatic settlement remains disabled. Music counts remain explicitly simulated; sample results still require the existing oracle account. Sign in and finish fresh account approval before a purchase on the new deployment. Run `npm run dev` in the project root to keep the local app and scheduler running while this computer is on.


Implemented schedules use shared worldwide pools. Display settings can show Austin, device time or UTC; they never move a pool's boundaries.

| Market | Bidding | Views counted |
| --- | --- | --- |
| Next hour | Each whole hour, e.g. 12:00–13:00 | Following hour, 13:00–14:00 |
| 24 hours later | Each whole hour, e.g. Monday 12:00–13:00 | Tuesday 12:00–13:00 (exactly 24 elapsed hours after bidding starts) |
| 7 days later | Each Austin calendar day, midnight to midnight | Whole Austin day seven calendar dates later, Monday to following Monday |

Daily boundaries use `America/Chicago`. A clock-change day has 23 or 25 hours; the screen displays its actual duration. Hourly targets always contain exactly one elapsed hour, including repeated local hours. Bidding is start-inclusive/end-exclusive. Closing bidding never finalizes the result: an oracle result is accepted only after the target period ends. Existing 48-hour result/refund grace remains unchanged.

The local scheduler checks every 15 seconds while the backend runs. It ensures the current plus next two hourly rounds, and current plus next daily rounds. Hourly rounds contain only types 0/1; daily rounds contain only type 2. If opened at 12:30, the current round still closes at 13:00. Already-created rounds follow their fixed on-chain deadlines while the computer is off. Missing periods while offline are skipped, and the current remaining period is created on restart. No paid hosting or external scheduler is configured.

## What remains the same

$5 buys one spot; $20 creates four independent $5 entries in one atomic payment; $50 buys ten identical spots with the existing conditional maximum 5% reward bonus. The 90% reward curve, tie ordering, fees, reserve admission, artist/team exclusions, partial claims, cancellation and timeout refunds are retained. Initial exclusions are part of round creation, so a late-created round cannot open before its team exclusions are installed.

Last Bus Home is the only song enabled for test purchases. Other songs are previews. Music history is explicitly simulated, with views-per-hour charts for hourly targets and views-per-day charts for daily targets. Real music API capture remains a later milestone. Manual sample result preparation uses the existing oracle account; automatic settlement stays off at activation.

## Live activation checklist

The current contract cannot be upgraded. The old deployment and its 24h/48h/seventh-day interpretation remain intact. The default new market screen stays in preparation until the new deployment is verified. Previous account purchases and browser samples keep their original periods, and the history selector retains access to legacy claims.

1. Apply `backend/supabase/006_market_schedules.sql` once in the existing Supabase project's SQL Editor, after 005. All added tables/functions restrict browser access. This initially registers the existing contract as active and changes no on-chain state.
2. In Remix, upload `remix/MusicPredictionMarketsV2.sol` and select **MusicPredictionMarketsV2**. Use Solidity **0.8.28**, optimizer **enabled / 200**, EVM **Cancun**, **viaIR off**. Constructor: initial owner `0x170249f9ac07d25f97bc1957b68a0011543d07ad`, oracle `0xcd61a22acf76623114583a1e0a031c18201baf51`, app recipient `0xcd61a22acf76623114583a1e0a031c18201baf51`. Value **0**. Review and deploy with MetaMask on **Arc Testnet 5042002**. No private key export is needed.
3. From `backend/`, run `npm run markets -- register NEW_ADDRESS DEPLOYMENT_TRANSACTION_HASH`. This verifies the deployment receipt, exact runtime excluding compiler metadata, immutable app recipient, source hashes, model version, prices, curve and roles. It records a public manifest and a non-active registry entry. It does not deploy or transfer funds.
4. Replace the Supabase `music-quicknode-events` function with `supabase/functions/music-quicknode-events/index.ts`. Keep its existing HMAC secret and JWT gateway setting off. Update the QuickNode Logs filter from `backend/quicknode-market-filter.js`, inserting the verified V2 address alongside the old address. Keep compression None and its existing custom headers. The receiver reads the private registry, recognizes both ABIs and applies each contract's own first block. Run `npm run events -- backfill markets-v2`, then `npm run events -- check markets-v2` to confirm no missing/conflicting logs. The old deployment continues to be accepted for legacy claims.
5. Manually call the new contract's `fundBonusReserve` with at least **2.50 test USDC** to enable a ten-spot bundle, and ensure the existing local administrator has test gas funds. This is separate from participant payments. Finish or cancel old unsigned reviews and reconcile signed participant/admin actions. Existing entries/results/claim funds remain at their old address.
6. Run `npm run markets -- activate NEW_ADDRESS DEPLOYMENT_TRANSACTION_HASH`. Activation verifies event completeness and reserve readiness, refuses outstanding old work, atomically changes the private registry's active contract, then saves the local deployment setting with scheduler and settlement off. Restart `npm run dev`. Sign in to obtain fresh account approval on the new contract.
7. Run `npm run markets -- scheduler-on` from `backend/` and restart the app. Confirm `/api/health` reports market model 2, schema ready and scheduler enabled. Open Last Bus Home: current hourly and daily markets should appear with separate bidding and count periods. Readiness requires both indexed events and current chain verification; missing data is never displayed as a fabricated zero.
8. For a measured period that has ended, `npm run results -- prepare ROUND next_hour|hour_plus_24|day_plus_7 SAMPLE_COUNT` prepares an unsigned sample oracle call. Review that call in the oracle MetaMask account. Settlement can subsequently be enabled explicitly with the existing `MUSIC_SETTLEMENT_ENABLED=true` control and funded local worker; it is not enabled by this rollout. Existing results tooling also retains legacy types when the old deployment is selected. Do not repoint a saved action to another contract.

If activation stops between registry update and local settings save, keep purchases paused, rerun activation with the same verified address/hash, and restart. Registry checks make a stale server refuse new purchases. Old claims do not require the active-purchase flag. Do not restore an old active flag while V2 has signed activity.

## Code and verification

`shared/market-schedule.js` is the common schedule policy. `MusicPredictionMarketsV2.sol` adds explicit deadlines, hourly/daily uniqueness and `MarketScheduled` events while retaining the old financial methods. The trusted scheduling owner publishes daily UTC boundaries; the contract checks their shape and calendar-day offsets, and the backend independently verifies exact Austin boundaries before allowing purchases. Daily timezone rules are therefore part of the verified application policy, not an on-chain timezone database.

`GET /api/markets` returns definitions and verified current/upcoming markets. `GET /api/markets/:deploymentId/:roundId/:marketType` serves a selected market, including historical markets. Purchase bodies use `{deploymentId, roundId, marketType, guess, optionId}`; old/new horizon indexes are never relabeled. Private history can select a known deployment, and claims with overlapping entry IDs resolve by deployment. Signed actions are always checked against the stored destination, calldata, value and owner.

Rebuild/check locally:

```sh
cd contracts
forge test --offline --use .tools/solc-0.8.28
cd ..
python3 contracts/export-markets-v2.py
python3 contracts/verify-markets-v2.py
npm test
npm run build
```

V2 runtime is 23,685 bytes, below the 24,576-byte deployment limit. The exported ABI and flattened Remix source are compiled and checked for identical runtime apart from source metadata. Tests cover both old and new financial behavior, exact boundaries, DST, indexing/registry isolation, scheduler retries and funding recovery, signed purchases, settlement and refunds on disposable Anvil, plus frontend review, rollover and timezone behavior. No test submits a live blockchain transaction.
