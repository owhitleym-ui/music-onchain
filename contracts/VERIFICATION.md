# Verification — November 19, 2026 — 90% curve

- Only production logic changed: `RewardCurve.ratioWad` returns `floor(previous_ratio * 9 / 10)`.
- Solidity 0.8.28+commit.7893614a; Cancun; optimizer enabled, 200 runs; via IR.
- Standard Foundry: **40 passed, 0 failed**, including 3 fuzz tests with 256 runs each.
- Arc Foundry v0.8.0-4 (`--network arc --isolate`): **40 passed, 0 failed**.
- Existing frontend, wallet/account, deployment-export, and ordering-helper checks: **103 passed, 0 failed**.
- 31 independent 80-digit Decimal vectors updated to the 90% curve, including pools below/at/above 100 spots.
- A separate preserved legacy-curve fixture verifies exact 9/10 scaling across all reference coordinates.
- Refunds retain full deposits. Neutral spots retain full principal. Fees still use gross winnings; main ranks 1/2 still waive the app fee.
- Single first-rank winner: 9.41 returned, loser: 0.5 returned, artist: 0.09, app: 0.
- Fully winning independent bundle: base 45, bonus 2.25, artist 0.945, return 96.305; losing spots retain 2.75; reserve consumption 0.
- Same-wallet bonuses remain disabled. A lone bundle returns 49.55 after 0.45 artist fees.
- Conservation, concurrent pools, claim protections, interrupted settlement, cancellation and timeout checks pass, including the 1,000-spot scenario.

## Exact Remix delivery

`remix/MusicPredictionContest90.sol` contains the full contract and pinned dependency sources, with no external imports. `remix/MusicPredictionContest.sol` is an identical convenience copy. The previous flattened source is retained under `remix/archive/`.

SHA256: `d156c0f1f6574bbf80f4dec2b3019426ea83784c5b2c1f70c3d4b57f26b1e97c`.

The delivered file compiles with both viaIR enabled and disabled. With viaIR enabled, its ABI and executable runtime match the tested multi-file version after removing compiler metadata. The three compiler warnings are dependency declaration-shadowing warnings already present in the original flattened source. There are no compiler errors.

| Compiler mode | Runtime bytes | Creation bytes |
| --- | ---: | ---: |
| viaIR true (tested settings) | 18,242 | 18,619 |
| viaIR false (compile checked) | 21,149 | 21,592 |

Both are below the 24,576-byte runtime size limit.

Arc isolated-runtime 1,000-spot scenario: largest order batch 3,293,595 gas; largest settlement-progress call 3,733,493 gas. These are scenario measurements, not universal bounds.

The user subsequently deployed this revision in Remix. See the verified deployment checkpoint below. No payment transactions or frontend account/data changes were performed by the agent. Automated verification is not an independent audit. Testnet remains the target. Frontend sample payout examples remain historical until Step 3 integration. The earlier 100% verification record is archived in `VERIFICATION-100pct-2026-11-18.md`.

## Live Arc deployment — November 19, 2026

Address: **0x003043208750D205F98AC1D9ae670d2d2A19797C**. Read-only RPC checks at block 73,067,979 confirm Arc Testnet chain 5042002, first-place rate 900000000000000000, 5/50 native prices, and matching administrator/oracle/platform roles at 0xcd61a22acf76623114583a1e0a031c18201baf51.

The actual deployed executable matches the prepared source compiled with **viaIR false**, Solidity 0.8.28, optimizer 200, Cancun (21,149 runtime bytes), after filling the platform-recipient immutable and excluding compiler metadata. Retesting with those actual settings passed **40 standard tests and 40 Arc isolated-runtime tests**. The original project default and public browser deployment artifact retain their reviewed viaIR true build; use the deployment-specific record/artifact under `contracts/deployments/` when checking the live address.

The new deployment began with no entries or rounds (next IDs both 1). No approvals, rounds, reserves, claims, or funds were copied from the older address. Frontend payments remain paused. These verification calls sent no transaction.


## Atomic $20 implementation — November 19, 2026

Implemented $5/$20/$50 entry options; $20 is one atomic payment creating four separate ordinary entry records, with identical guesses and no bonus. Added authenticated durable payment orders, signature verification, receipt/event reconciliation, account history, contract-scoped approval cutover, and a serialized test-round operator command.

Current automated evidence: 69 backend checks, 109 frontend checks, 13 contract-helper checks, 45 standard contract tests and 45 Arc-runtime contract tests pass. The production build passes and contains the new public Privy App ID without server-only secret configuration. The flattened Remix contract compiles with Solidity 0.8.28, optimizer 200, Cancun, viaIR false; its executable matches the tested multi-file source. Actual payment signing/receipts are exercised with disposable accounts on local Anvil; Arc runtime tests run separately. No real Privy payment or Arc Testnet purchase has been claimed as verified.

Not yet deployed: use remix/MusicPredictionContest90Four.sol and ATOMIC-PAYMENTS.md. Apply migration 002, deploy/verify the new contract, activate it, re-approve the user on that address, create a future hourly round, fund participant/reserve manually, and complete real $5/$20/$50 browser purchases. Live payments remain gated until activation. The previous contract, approvals, records and private configuration are retained. No push, Vercel changes, automatic funding, QuickNode, live music feed or teammate integration was performed.
