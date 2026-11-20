# Verification — November 18, 2026

## Completed checks

- Solidity 0.8.28+commit.7893614a; Cancun target; optimizer 200; via IR.
- Standard Foundry: **39 tests passed**, including 3 fuzz tests with 256 runs each.
- Arc Foundry v0.8.0-4: **39 tests passed** with `--network arc --isolate`, using independent EVM transaction contexts.
- Frontend and wallet behavior: **29 Node checks passed**.
- Offline ordering helper: **6 Node checks passed**, including CLI operation and 1,050-spot ordering.
- Curve: **31 independent 80-digit Decimal reference vectors**, plus boundedness/monotonicity fuzzing up to 10,000 spots. Fixed-point ratio tolerance is 200,000 WAD units, corresponding to at most 1e-12 USDC on a 5-USDC base transfer.
- A complete **1,000-spot settlement** verifies conservation, bounded progression, and purchase claims.
- Local browser: 5/50 options, ten identical bundle spots, conditional bonus explanation, 280-USDC total for 56 sample spots, 101.45-USDC bundle return, 55.30-USDC sample net profit, and disabled purchases observed.

## Gas and bytecode

Measured on the 1,000-spot Arc isolated-runtime test:

| Operation | Largest measured call |
| --- | ---: |
| Order batch, at most 32 spots | 3,293,595 gas |
| Settlement progression, at most 16 pairs or 32 scans | 3,731,333 gas |

These are scenario measurements, not mathematical upper bounds for every input. The test asserts each stays below 5,000,000 gas. The whole 1,000-spot test is many calls, not one network transaction. Caller gas is separate from contest escrow.

Optimized deployed contract bytecode: **18,128 bytes**, below the standard 24,576-byte limit. Constructor bytecode: **18,505 bytes**. The compile is not evidence of a deployment.

## Covered behavior

Eligibility/exclusions; future hourly timing; all measurement windows; exact native values; multi-spot counts; dense accuracy ties and midpoint chronology; reversed accuracy pairing; zero/one/odd totals; fee exemptions; bonus-only-on-different-wallet matches; limited reserve; concurrent pool isolation; invalid/missing/duplicate/restarted order batches; batch-size independence; no premature claims; cancellation and 48-hour timeout during partial allocation; permanent finalized claims; failed/reentrant/double claims; ledger solvency; and no bare value transfers.

A lone 50-USDC bundle returns **49.5 USDC**, earns no bonus, and consumes no app reserve. Fully winning first-rank bundles funded by different wallets return **101.45 USDC**. Distinct wallets do not establish distinct human identity; eligibility administration remains a trusted boundary.

## Remaining integration boundaries

No deployment, live TikTok connection, background keeper, registration/identity provider, or website payments have been connected. The oracle number and wallet approvals are trusted inputs; onchain checks validate ordering and money rules. Source and tests have been reviewed during implementation but have not received an independent audit.
