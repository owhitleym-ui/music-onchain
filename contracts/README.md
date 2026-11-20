# Music prediction contest contracts — 90% curve

Current update: daily-only V3 uses tomorrow / day after tomorrow / seven days later in Austin time, 5% of losing stake for the artist, and 1% of matched stake for the platform (main ranks 1 and 2 exempt). See [daily markets](../DAILY-MARKETS.md). V3 requires a new deployment and migration 007; the older rules below are historical.


Current payment milestone: $5 / $20 / $50 support is implemented. The $20 option creates four separate ordinary entries atomically. Live payments require the new Remix deployment and activation; the existing account connection is retained until then. See [deployment and payment instructions](../ATOMIC-PAYMENTS.md).

Complete 5/20/50-USDC contest logic for Arc Testnet, written in Solidity 0.8.28 with the Cancun compilation target. This milestone includes source, automated tests, ABI, and an offline ordering helper. The previous 90%-curve revision was deployed at 0x003043208750D205F98AC1D9ae670d2d2A19797C on Arc Testnet; see `deployments/arc-testnet-curve90.json` for the verified live settings. The earlier 100%-curve deployment remains a separate contract. The frontend's live payments remain disabled until the new deployment is verified and activated, and the TikTok oracle is exercised with sample results rather than a live feed.

## Build and test

From the workspace root:

```sh
python3 contracts/setup-dependencies.py
python3 contracts/setup-tools.py
contracts/check.sh -vv
contracts/check.sh arc --isolate -vv
node --test frontend/tests/*.test.mjs contracts/tools/*.test.mjs
python3 contracts/export-abi.py
```

`setup-dependencies.py` downloads public archives at the exact Git revisions in `dependencies.lock.json`. Sources are cached in the system temporary directory and linked under `lib/`, avoiding synced-folder stalls. Run the installer again if the temporary cache is cleared. It refuses to replace an unrecognized dependency directory.

`setup-tools.py` is a project-local installer for macOS Apple Silicon, Python 3.12+, Xcode command-line tools, and curl. It verifies the official Solidity compiler and Arc Foundry archive checksums in `tools.lock.json`. The official Arc binary's libusb dependency is built locally. No shell profile, system wallet, or credentials are modified. Other platforms can install Solidity 0.8.28 and Arc Foundry from their official distributions, then use the same Foundry configuration. An installed ordinary `forge` is required for the standard test command.

The ABI is generated from the build artifact into `abi/MusicPredictionContest.json`. Regenerate it whenever the public contract changes. The current contract is not upgradeable; later changes require a new deployment.

For Remix, upload `../remix/MusicPredictionContest90Four.sol`, a single flattened file with pinned dependencies included. Select **MusicPredictionContest**. See `../remix/README.md` for compiler and constructor settings. Deployment is initiated and approved by the user through MetaMask. No deployment transaction was submitted while preparing this revision. The ABI adds enterFour and FOUR_SPOT_PRICE; a new deployment will have a new address, fresh approvals, fresh rounds, and a fresh reserve.

## Funds and rules

- `5e18` native units buy one spot; `50e18` buy ten identical spots. This is Arc's native USDC interface, not a six-decimal ERC-20 transfer. Use `msg.value`; no token allowance is needed.
- The ten-spot bundle has a 1.05 winning multiplier only when its matched losing spot belongs to a **different payer wallet**. Same-wallet pairs receive the base reward. This removes the lone-wallet self-bonus; it does not prove two different wallets belong to different people.
- Each bundle requires 2.5 USDC of free bonus reserve, committed to its pool. The winning transfer can consume less. Network fees are paid separately by callers.
- Dense ranks use absolute error; tie places use purchase time, purchase ID, and bundle offset. Top/bottom halves pair from the outside inward. An odd middle spot keeps its deposit. Losing time ranks are display metadata.
- Every original curve rate is scaled by 0.9, with downward rounding. First place now transfers 90% of the matched losing deposit before the conditional bonus and existing fees. Untransferred funds remain with the loser. The fixed 100-position curve samples `x=min(100,1+(rank-1)*100/N)`, with total logical spots N. Fractional coordinates allow pools above 100 spots. See `../payout-formula.md` for the full arithmetic and rounding rules.
- Artist/app fees are each 2% of gross winning transfers, including bonus. Dense main ranks 1 and 2 waive the app fee. Fees are calculated per winning spot and aggregated, including in a purchase containing both winners and losers.
- A first-rank 5-USDC spot returns 9.41 USDC after a 0.09-USDC artist fee; the matched loser receives 0.5 USDC back. A fully winning first-rank bundle against different wallets returns 96.305 USDC after its 0.945-USDC artist fee. A lone self-matched bundle instead returns 49.55 USDC, with no bonus or reserve spend. At the new cap, even a bonus-winning spot transfers at most 94.5% of its matched losing deposit, so no reserve is consumed. The existing 2.5-USDC bundle reserve admission requirement is retained.

## Public interface and lifecycle

Constructor arguments are `(initialOwner, initialOracle, appRecipient)`, all nonzero addresses. Ownership transfers require acceptance through OpenZeppelin Ownable2Step. The platform fee recipient is immutable.

### Administration and entry

`createRound(songId, musicId, artist, roundStart)` creates three separate horizon pools. `songId` is a nonzero bytes32 identifier; `musicId` is a nonempty UTF-8 identifier of at most 128 bytes. `roundStart` must be a **future whole UTC hour**, in seconds. Duplicate song/hour rounds are rejected. Source identifiers, artist recipient, and timing cannot be edited afterward.

Horizon enum values are **0 = 24h**, **1 = 48h**, **2 = seventh day**. Measurement offsets are 0–24h, 24–48h, and 144–168h. Entries are accepted from start inclusive to start+1h exclusive. Each `(round,horizon)` has its own totals, order, result, and funds.

`approveWallet(wallet, approved)` controls eligibility. `setExclusion(roundId,wallet,excluded)` freezes when that round starts; the artist wallet is always excluded from its round. Approvals are administrator attestations, not implemented identity verification. Revoking approval never revokes existing claims.

`enter(roundId,horizon,guess)` is payable and returns a global purchase ID, starting at 1. Guesses are uint256 nonnegative whole numbers. A purchase stores its payer and ten or one logical spots. Local ticket IDs start at 0 **within each horizon pool** and are assigned in entry order; do not confuse them with global purchase IDs. `EntryRecorded` identifies both.

### Result and batched settlement

1. The configured oracle calls `submitResult(roundId,horizon,actualViews,evidenceHash)` after the window ends and before the 48-hour grace deadline. Zero views is accepted. Results cannot be replaced.
2. The oracle or owner calls `submitOrder(roundId,horizon,ticketIds)` with at most 32 local IDs per batch. The contract checks ID range, uniqueness, accuracy ordering, all tie keys, and complete coverage. It assigns dense main ranks itself; a helper cannot choose payouts.
3. If the order is incomplete, the owner/oracle can call `restartOrder`. A new epoch isolates old scratch records without clearing arrays in an unbounded transaction. Reordering stops once all spots are verified.
4. Anyone can call `advanceSettlement(roundId,horizon,maxSteps)`. In `TimeRanks`, maxSteps is 1–32 examined spots. In `Allocation`, it is 1–16 funding pairs. Read `getPool().phase` before selecting the limit. Each call advances stored cursors; repeats cannot pay twice.
5. The final batch credits any odd middle spot and finalizes atomically. Only then are participant and fee claims available. Empty pools finalize immediately when a result is submitted; lone spots require the normal small progression.

Phases: `Open=0, Ordering=1, TimeRanks=2, Allocation=3, Finalized=4, Cancelled=5`. Open describes the stored phase, not whether wall-clock entries are still open.

The contract checks conservation before finalization:

```text
participant returns + artist fees + app fees = deposits + reserve subsidy consumed
```

The oracle is trusted to supply the correct external number. The evidence digest is an audit reference, not proof of API authenticity. No TikTok credentials/provider or continuously running worker is included. A future worker must capture the correct measurement boundaries, submit the result, and drive batches before the deadline. Large pools require more transactions and a funded operator; there is no claim that unbounded pools fit in one transaction.

### Claims, refunds, and reserve

- `claimEntry(entryId,recipient)` is called by the payer, aggregates all its spots, and sends to a chosen nonzero recipient. Rejected payments roll back the claim; a different recipient can be tried. Zero-return entries can be marked claimed without a value transfer.
- `claimFees(recipient)` claims the caller's accumulated artist/platform fees. Revoked wallet approval does not block either type of claim.
- `cancelPool(roundId,horizon)` lets the owner cancel any unfinalized pool. All original deposits become refundable and staged payouts/fees become inaccessible.
- `activateRefunds(roundId,horizon)` is permissionless at **windowEnd+48h**. At exactly that deadline results and settlement can no longer progress. A payer's `claimEntry` also activates a necessary timed-out refund automatically. Refunds and finalized returns never expire.
- `fundBonusReserve()` accepts a positive native-USDC contribution. `withdrawFreeReserve(amount,recipient)` is owner-only and limited to the uncommitted reserve ledger; it cannot spend deposits, staged payouts, or finalized liabilities. Contributions do not create a lender claim.
- `accountedBalance()` sums escrow, outstanding returns, fee liabilities, and bonus reserve. `isSolvent()` checks coverage and reserve commitments. Unsolicited forced balance excess remains outside this ledger and cannot be withdrawn through reserve functions.

Bare payments and unknown payable calls revert. Every external value transfer uses checks-effects-interactions with reentrancy protection.

Read methods include `getRound`, `getPool`, `getEntry`, `getTicket`, `getTicketOutcome`, `getEntryOutcome`, `claimable`, and `getPoolEntries` (up to 100 purchase IDs per page). Financial outcome getters require finalization. Events provide purchase, result, progress, reserve, cancellation, and claim records for a future indexer.

## Offline ordering helper

```sh
node contracts/tools/prepare-settlement.mjs contracts/tools/settlement-input.example.json
```

Input contains `actualViews` and `entries`, with each purchase's `id`, `firstTicketId`, `spots`, `guess`, and `purchasedAt` from one pool. Use decimal strings for large integers. Timestamps must use contract seconds. The helper expands bundles, validates contiguous local ticket coverage, sorts exact BigInt keys, and outputs decimal-string `orderedTicketIds` and `batches` of at most 32. It makes no network calls, submits no transactions, and computes no trusted payout allocations.

The example data is fictional. A future operator must compare input totals with onchain `spotCount/entryCount`; a self-consistent input file alone cannot prove every chain entry was exported. The contract's completeness checks remain authoritative.

`tools/generate-curve-reference.py` regenerates the Solidity test fixture using Python Decimal at 80-digit precision. No JavaScript floating-point math determines contract payouts.

## Verification and next milestone

`VERIFICATION.md` records the completed checks and measured gas. This implementation has automated verification, not an independent security audit. Testnet is the development target.

Next: walk through deployment to Arc Testnet using MetaMask, record/verify the deployed address and compiler configuration, fund the bonus reserve, approve test wallets, and connect the existing paused Pay flow. Private keys remain in the wallet. This milestone does not submit any blockchain transaction or require private-key export.
