# Music contest settlement specification — 90% curve

This is the 5/20/50-USDC contract specification. The curve sets the base percentage transferred from a matched losing spot. It is not a direct share of the whole prize pool.

## Entries and ranking

5 native USDC buys one spot. The new `enterFour` interface accepts exactly 20 native USDC and atomically creates four separate ordinary 5-USDC entries with the same payer, guess, round, horizon and timestamp. Their entry IDs are distinct, each has one spot and a 1.00 multiplier, and none receives the bundle bonus. All four records and the payment revert together on failure. 50 USDC buys ten identical spots under one purchase, each with a 1.05 winning multiplier when its matched losing spot belongs to a different wallet. Same-wallet pairs receive no bonus. Arc native amounts use 18 decimals. Network fees are separate from deposits.

Hourly rounds accept entries during hours 0–1. Their independently settled measurement windows are hours 0–24, 24–48, and 144–168. Contract timestamps are UTC seconds; the frontend displays Central Time.

Sort each pool's N logical spots by absolute prediction error, purchase timestamp, purchase ID, and bundle spot offset, all ascending. Equal errors share dense main ranks: 1, 1, 2, 3. These additional ordering keys decide which tied places win at the midpoint without changing their shared rank.

The first floor(N/2) places win and the last floor(N/2) lose. An odd middle spot keeps its principal without fees or bonus. Empty pools have no allocations; a lone spot gets its principal back. Losing spots additionally have chronological time ranks for display; those ranks do not change accuracy-based funding pairs.

## Curve sampling

For a winning spot's shared main rank r and total spot count N:

```text
x = min(100, 1 + (r - 1) * 100 / N)
w = 0.40 - 0.20 * (x - 1) / 99
transfer_percent = 0.9 * (w * (101 - x) + (1 - w) * 100 * 0.5^(x - 1))
base_transfer = 5 USDC * transfer_percent / 100
```

| Total spots | First three main-rank coordinates | Transfer at main rank 2 |
| ---: | --- | ---: |
| 25 | 1, 5, 9 | 37.28227273% |
| 50 | 1, 3, 5 | 48.51454545% |
| 100 | 1, 2, 3 | 62.55090909% |
| 200 | 1, 1.5, 2 | 73.97759407% |

Every original curve rate is multiplied by 0.9, rounded down in 18-decimal fixed point before the monetary calculation. First place is 90% of a matched loser’s deposit before the existing bundle bonus and fees. The reduction remains with the matched losing entry; it is not a new artist or platform fee. Principal for winning and neutral spots, cancellation refunds, rankings, and existing fee percentages are unchanged.

The curve remains fixed over positions 1–100. Smaller pools skip points; larger pools use fractional coordinates, capped at 100. Shared main ranks use the same coordinate. N includes all spots, not only winners or distinct accuracy groups.

Use deterministic 18-decimal fixed-point arithmetic, downward rounding at monetary operations, and pinned PRBMath v4 for fractional exponentials. Integer exponents use exact binary halving. Contract arithmetic is authoritative; displayed percentages are rounded illustrations. Base transfers are checked against an 80-digit Decimal reference with tolerance at most 0.000000000001 USDC.

## Transfers, fees, and reserve

Pair the strongest winning place with the least accurate losing place, then continue inward. For each pair:

```text
winner_multiplier = 1.05 for a bundle winner matched to a different payer; otherwise 1
gross_winnings = floor(base_transfer * winner_multiplier)
loser_transfer = min(gross_winnings, 5 USDC)
reserve_contribution = gross_winnings - loser_transfer
artist_fee = floor(gross_winnings * 2 / 100)
app_fee = 0 for main ranks 1 and 2; otherwise floor(gross_winnings * 2 / 100)
winner_return = 5 USDC + gross_winnings - artist_fee - app_fee
loser_return = 5 USDC - loser_transfer
```

Fees apply per winning spot to gross winnings including bonus, rather than principal or the net outcome of a mixed winning/losing bundle. Aggregate per-spot returns into the purchase claim. Losing and neutral spots pay no additional fees.

Each accepted 50-USDC bundle earmarks 2.5 USDC of prefunded app reserve. This conservative existing reserve requirement is retained. At the new 90% maximum curve rate, the 1.05 bundle multiplier reaches at most 94.5% of a losing deposit, so settlement consumes no reserve under these fixed rules. Insufficient free reserve blocks new bundles. Earmarks are isolated across pools. Actual subsidies consume reserve; unused commitments are released at cancellation or finalization.

A first-rank single spot receives 5 principal + 4.5 gross winnings - 0.09 artist fee = **9.41 USDC**; its matched loser receives **0.5 USDC**. The app fee is zero at ranks 1 and 2.

A fully winning first-rank bundle matched against other wallets has 50 principal, 45 base winnings, 2.25 bonus, 0.945 artist fee, no app fee, and **96.305 USDC returned**. Matched losers fund 47.25 and retain 2.75 in total; no reserve is consumed. A lone 50-USDC bundle instead has five self-matched winning spots and five losing spots, receives no bonus, pays 0.45 USDC artist fees, and receives 49.55 USDC back. It cannot farm the reserve by competing with itself.

## Settlement and refunds

An authorized oracle supplies a final count and evidence digest after the measurement window. A digest provides an audit reference; it does not prove TikTok supplied the number. Live TikTok data is not connected yet. Accepted results are immutable.

A helper proposes spot order in bounded batches. The contract checks IDs, uniqueness, global accuracy/tie ordering, and complete coverage, then independently calculates all ranks and financial allocations. Incomplete ordering can restart under a new epoch. Old staged data becomes unreachable.

Credits remain staged until the entire pool finalizes. Finalization requires:

**Participant returns + artist fees + app fees = deposits + consumed bonus reserve.**

Administrators can cancel unfinalized pools. Anyone can activate full refunds if a pool remains unfinalized 48 hours after its measurement window ends. At that deadline, result processing and finalization are blocked. Cancellation ignores staged payouts, releases reserve commitments, and makes original deposits refundable. Finalized claims and refunds do not expire. Revoking wallet approval does not affect existing claims.

Claims update accounting before external transfers and have reentrancy protection. Failed transfers roll back the claim. Administrators can withdraw only uncommitted bonus reserve, never participant escrow or outstanding return/fee liabilities.

## Frontend examples

Sample records remain separate from wallet funds. The v1→v2 migration halves monetary entry/result fields, rounds sample amounts to cents, and recomputes fees and returns. Contract settlements retain native precision. All source prices are 5/50 USDC; a bundle still contains ten spots.

The browser sample records are historical demos and have not been resettled by this contract revision. Purchases remain paused until the new deployment is connected during Step 3.
