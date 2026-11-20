# Remix deployment — atomic $20 edition

Use **MusicPredictionContest90Four.sol** for the new deployment. It is a single file containing the contract and pinned libraries, with no import downloads required. Select **MusicPredictionContest** from the contract dropdown. The older MusicPredictionContest90.sol and MusicPredictionContest.sol files describe the previous deployment and do not support atomic $20 payments.

The $20 `enterFour` function creates four separate ordinary $5 entry records in one transaction. Every record has the same guess and timestamp, a distinct entry ID, one spot and a 1.00 multiplier. All four entries and their payment succeed together or revert together. Network fees can still apply to a reverted transaction.

The existing $5 and $50 behavior, 90%-scaled ranking curve, same-wallet bonus restriction, fees, refunds and $2.50 reserve admission requirement for the $50 bundle are retained.

Use these exact compiler settings:

- Solidity **0.8.28+commit.7893614a**.
- Optimizer **enabled, 200 runs**.
- EVM **Cancun**.
- **viaIR disabled**.
- Browser Extension / MetaMask on **Arc Testnet (5042002)**.
- Deployment Value **0**.

Constructor:

| Argument | Address |
|---|---|
| initialOwner | `0x170249F9Ac07D25F97bC1957B68A0011543d07ad` |
| initialOracle | `0xcd61a22acf76623114583a1e0a031c18201baf51` |
| appRecipient | `0xcd61a22acf76623114583a1e0a031c18201baf51` |

The dedicated backend administrator owns the new contract immediately. MetaMask remains the oracle and app-fee recipient. Do not export either wallet's private key to deploy.

The flattened executable matches the tested multi-file source. There are zero compiler errors and three existing dependency shadowing warnings. See atomic-verification.json. Both 45 standard and 45 Arc runtime contract tests pass.

No atomic deployment has been submitted yet. After deploying, retain the address AND deployment transaction hash. Apply the Supabase migration and run the verification/activation command in [ATOMIC-PAYMENTS.md](../ATOMIC-PAYMENTS.md). Only after verification should the app target the new address. A new deployment starts with fresh approvals, rounds and reserve; old funds and records do not move automatically.

The previous 90%-curve contract is `0x003043208750D205F98AC1D9ae670d2d2A19797C`; it cannot accept the new atomic $20 method. Its deployment record and source remain available for reference.
