# Daily prediction markets — V3

Live testnet activation verified November 20, 2026: V3 is active at `0xe3afdbf235e902de46418535f25ca4e23f9fdf92`, deployment transaction `0x7d7079328be4aacf77052a047ab0dbd0c1c1e79dbb3f725135a1eb9361c5dbfb`, creation block 73174808. Migration 007 is installed, the 2.50 test-USDC reserve is verified, QuickNode indexed V3 events, and daily rounds 1 and 2 are confirmed. Real backend/browser checks show all three current pools open for November 21, November 22, and November 27 in Austin. Eight unfinished V2 hourly pools are cancelled; the prior $5 test entry is fully refundable. The local scheduler is enabled and healthy while the backend runs. Music counts remain simulated and automatic settlement stays off. Fresh account approval is required on V3.

## Calendar and entries

Austin is `America/Chicago`. One bidding round runs from local midnight to the next local midnight, start-inclusive and end-exclusive. Each round has three independent pools:

| Market ID / index | Label | Counting day relative to the bidding date |
| --- | --- | --- |
| `day_plus_1` / 0 | Tomorrow | +1 calendar date |
| `day_plus_2` / 1 | Day after tomorrow | +2 calendar dates |
| `day_plus_7` / 2 | 7 days later | +7 calendar dates |

Bidding on November 20 measures November 21, November 22, or November 27, each midnight-to-midnight in Austin. A calendar day is 23, 24, or 25 elapsed hours around daylight saving changes. A display timezone preference never moves these boundaries. Bidding for all three closes together at the next Austin midnight. Closing bidding does not settle any result. The existing result/refund deadline is 48 elapsed hours after the counting day ends.

The local scheduler checks every 15 seconds while the backend runs and creates only the current and next daily bidding rounds. Late startup creates the remaining part of the current day. It does not reopen missed periods. It does not run while the laptop/backend is off.

$5 buys one spot. $20 buys four separate ordinary entries sharing one guess in one atomic payment. $50 buys ten identical spots with the existing conditional maximum 5% bonus and same-wallet exclusion.

## Artist and platform allocation

The saved 90% curve now sets the matched loser's **total deduction**. Every losing spot pays 5% of its original $5 stake ($0.25) to the artist, included inside that deduction. The remaining deduction funds its matched winner. The platform receives 1% of the original matched stake ($0.05) from winner proceeds, except dense main ranks 1 and 2, which pay no platform fee. Winners pay no additional artist fee. Neutral middle spots keep their entire stake. Ties, entry ordering, and rank matching are unchanged.

Per spot, all operations use integer native units and round down:

```
curve_deduction = floor(5 USDC * curve_rate)
artist_fee = 0.25 USDC
winner_base = curve_deduction - artist_fee
bonus = floor(winner_base / 20) for an eligible bundle; otherwise 0
platform_fee = 0 for main ranks 1 and 2; otherwise 0.05 USDC
winner_return = 5 USDC + winner_base + bonus - platform_fee
loser_return = 5 USDC - curve_deduction
reserve_consumed = bonus
```

Without a bonus, the strongest pair allocates 85% ($4.25) to the first-place winner and 5% ($0.25) to the artist: 90% ($4.50) total deducted from last place. Returns are $9.25 for the winner and $0.50 for the loser. For a non-exempt winner whose curve deduction is 60%, the split is 54 points to the winner, 5 points to the artist, and 1 point to the platform.

Bundle bonuses come entirely from the bonus reserve and never increase the loser's curve deduction. A fully winning first-rank $50 bundle earns $42.50 base plus $2.125 bonus, returns $94.625, credits $2.50 to the artist, and consumes $2.125 reserve. Each bundle retains the existing $2.50 reserve admission requirement. Fees and outcomes are recorded against the account that pays them; a loser's `loss` records the winner-funded portion and `artistFee` its artist portion, so entry return accounting remains additive.

Participant returns + artist fees + platform fees = deposits + consumed reserve. Cancellation/timeout refunds return the full original payment without fees. Older deployments keep their original fee rules and evidence.

## Deploy and activate on Arc Testnet

1. Run `npm run markets -- scheduler-off` in `backend/` and restart the original backend. New code also refuses to schedule V2 hourly rounds. Preview retirement with `npm run retire-hourly`; `npm run retire-hourly -- --execute` queues and processes cancellation of unfinished V2 hourly pools. This makes full test-entry refunds claimable and never collects them for participants. Keep QuickNode indexing the old addresses.
2. Run `backend/supabase/007_daily_markets.sql` in the existing Supabase SQL Editor after 006. It adds model 3 while retaining old events, purchases, approvals and claims. No new credentials are required.
3. Deploy `remix/MusicPredictionMarketsV3.sol` in Remix, selecting **MusicPredictionMarketsV3**. Compiler **0.8.28**, optimizer **on / 200**, EVM **Cancun**, **viaIR off**, transaction Value **0**. Constructor: owner `0x170249f9ac07d25f97bc1957b68a0011543d07ad`, oracle `0xcd61a22acf76623114583a1e0a031c18201baf51`, app recipient `0xcd61a22acf76623114583a1e0a031c18201baf51`.
4. Run `npm run markets -- register NEW_ADDRESS DEPLOYMENT_TX` in `backend/`. Registration checks deployed runtime, constructor roles, model 3, prices, artist fee 500 bps and platform fee 100 bps; then saves the verified `arc-testnet-markets-v3-live.json` manifest without activating it. A placeholder address is never treated as a live deployment.
5. Update the Supabase `music-quicknode-events` function with the prepared source, preserving its secret and JWT gateway OFF. Add the verified V3 address alongside the two existing addresses in `backend/quicknode-market-filter.js`, then save that QuickNode filter. Run `npm run events -- backfill markets-v3` and `npm run events -- check markets-v3`.
6. Fund the new contract's `fundBonusReserve` with at least 2.50 native test USDC. Existing reserve/funds do not move automatically between contracts. Reconcile outstanding old signed/admin work; activation refuses unresolved work.
7. Run `npm run markets -- activate NEW_ADDRESS DEPLOYMENT_TX`, then `npm run markets -- scheduler-on` and restart the app with root `npm run dev`. Sign in for approval on the new contract. Confirm `/api/health` reports model 3 and all three daily pools show the correct target dates.
8. After a counting day ends, `npm run results -- prepare ROUND day_plus_1|day_plus_2|day_plus_7 SAMPLE_COUNT` prepares an unsigned, clearly labelled sample result for the existing oracle account. Automatic settlement remains separately opt-in. Real provider data, licensing and Austin-day coverage are a later milestone.

## Interfaces and verification

Existing endpoints remain: `GET /api/markets`, `GET /api/markets/:deploymentId/:roundId/:marketType`, and purchases `{deploymentId, roundId, marketType, guess, optionId}`. V3 uses `markets-v3`; indexes are resolved by the pinned deployment version. Historical claims and actions remain scoped by original contract and entry ID. The frontend shows preparation until the verified V3 deployment is active.

The contract accepts six UTC timestamps for Austin calendar offsets 0, 1, 2, 3, 7 and 8. It checks the calendar offsets and permitted midnight shape; the backend independently checks exact Austin timezone rules before scheduling or admitting a purchase. On-chain timezone interpretation remains a trusted-owner policy, not a timezone database.

Rebuild and check with the pinned tools:

```
cd contracts
forge test --offline --use .tools/solc-0.8.28
cd ..
python3 contracts/export-markets-v3.py
python3 contracts/verify-markets-v3.py
npm test
npm run build
```

The implementation is confined to the original Hackathon project. `final_hack`, GitHub, Vercel, and real music-provider subscriptions are outside this update.

## Verification completed

124 backend tests, 134 frontend tests and 63 Solidity tests pass (321 total), including the V3 lifecycle on a disposable chain and 256 fuzz runs for losing-position accounting. The installed frontend builds successfully. The flattened Remix file has identical ABI and executable runtime to the reviewed artifact; runtime size is 23,255 bytes. Desktop/mobile browser checks pass against the original backend, with three daily choices, correct fee wording, explicit sample/preparation states, and hourly scheduling disabled. No V3 deployment, production push, or migration execution was performed during local implementation.
