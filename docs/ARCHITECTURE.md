# Architecture

> This replaces the earlier "picks + artist advances" concept. The execution plan is in `docs/PLAN.md`, and exact numbers (fees, splits, windows) belong in `SPEC.md`.

## What we are building

Fans predict how a song will perform (for example, "YouTube views at window close") and pay a small fixed USDC entry fee. When the window closes, an admin or oracle submits the real number. The contract ranks predictions by accuracy, pays the closest entries from the pot, and sends a share to the artist in the same transaction. Users sign in with email and never see wallets, gas, or addresses.

**Design goal:** start as small as possible and stay easy to scale. Adding a song, a competition, or a new metric is a data change, not a redeploy.

## System diagram

```
             ┌─────────────────────────── apps/web (Next.js on Vercel) ───────────────────────────┐
  fan ──────▶│  UI pages ── Privy (email login + embedded wallet) ── viem (reads/writes)          │
  admin ────▶│  /api/admin/settle  ──(ORACLE key)──┐   /api/faucet ──(FAUCET key)──┐              │
             │  /api/streams/webhook ◀─────────────┼───────────────────────────────┼──────┐       │
             └─────────────────────────────────────┼───────────────────────────────┼──────┼───────┘
                                                   ▼                               ▼      │
                         ┌──────────────────── Arc testnet ─────────────────────────┐     │
                         │  SongRegistry      Competition (holds every pot)        │     │
                         │       ▲                 │  enter / settle / cancel       │     │
                         │       └── isBlocked ────┘  events ───────────────────────┼──▶ QuickNode Stream
                         │  USDC (ERC-20 @ 0x3600…0000, 6 decimals, also gas)      │
                         └─────────────────────────────────────────────────────────┘
```

## Contracts (`contracts/`, Foundry, Solidity ^0.8.24)

| Contract | Responsibility |
|---|---|
| `SongRegistry` | Approved songs, the artist payout address for each, and wallets blocked from entering (the artist plus flagged affiliates). Display metadata lives offchain at `metadataURI`. |
| `Competition` | **A single contract for every competition**, keyed by `id`. Takes entry fees, stores predictions, settles with the oracle's value, pays winners, the artist, and the platform, and refunds when the minimum entry count isn't met. |

### Competition lifecycle

```
createCompetition (owner) ──▶ Open ──enter()──▶ … ──closesAt──▶ settle(finalMetric) (oracle)
                                 │                                   ├─ entries ≥ min ─▶ Settled: winners + artist + platform paid
                                 └─ cancel() (owner/oracle) ─────────└─ entries < min ─▶ Cancelled: everyone refunded
```

### Rules the contract enforces
- Fixed `entryFee` in USDC, with 6 decimals (`1_000_000` = $1). One entry per wallet per competition.
- Entries are accepted only while `block.timestamp < closesAt`, and only up to `maxEntries` (hard cap 500).
- Wallets for which `registry.isBlocked(songId, wallet)` is true can't enter.
- **Ranking:** a smaller `|prediction − finalMetric|` ranks higher. Ties go to the earlier entry.
- **Split:** `payoutBps[rank]` for each winner, plus `artistBps`, plus `platformBps`, must add up to exactly 10,000. Rounding dust goes to the artist, so each pot empties exactly.
- `minEntries ≥ number of winners`, so every prize rank can always be filled.
- **Payments are pushed.** If one transfer fails (for example, an address on Arc's USDC blocklist), that amount is credited to `owed[addr]` and can be claimed with `withdraw()`. One bad recipient can't block settlement.

### Events (the QuickNode Stream filters on these)

| Event | Used for |
|---|---|
| `CompetitionCreated(id, songId, entryFee, closesAt, minEntries, maxEntries, metric)` | Discovery list |
| `EntrySubmitted(id, player, prediction, entryIndex)` | Live leaderboard, My Entries |
| `CompetitionSettled(id, finalMetric, pot)` | Switch the competition to results view |
| `WinnerPaid(id, player, rank, prediction, amount)` | Payout display |
| `ArtistPaid(id, artist, amount)` | Artist earnings |
| `CompetitionCancelled` / `Refunded` | Refund state |

**Onchain vs. offchain ranking:** the contract ranks only the paid winners. The full leaderboard is computed in the app from `EntrySubmitted` and `finalMetric`, using the same rule, which keeps settlement gas bounded.

## Application (`apps/web`)

| Piece | Notes |
|---|---|
| Auth and wallet | Privy email login with an embedded wallet. Configure Privy with the `arcTestnet` chain from `viem/chains`. |
| Contract access | viem. ABIs are exported from `contracts/out` into `apps/web/lib/abi/`, and addresses come from env. |
| Entering | Two transactions: `USDC.approve(Competition, fee)`, then `Competition.enter(id, prediction)`. Show them as one "Enter for $1" step. |
| Faucet | `/api/faucet` sends test USDC from a server-held faucet wallet, funded from faucet.circle.com. Rate-limit it to one drip per user. |
| Settlement | `/api/admin/settle` is protected by `ADMIN_SECRET` and calls `settle(id, metric)` with the oracle key. |
| Live updates | QuickNode Stream → `/api/streams/webhook`, checked with `QUICKNODE_STREAMS_WEBHOOK_SECRET`. The webhook updates leaderboard state, which the UI polls or subscribes to. If the stream is down, fall back to reading `getEntries(id)`. |
| Branding | The product name lives only in `apps/web/brand.config.ts`. |

## Arc specifics we depend on

| Item | Value |
|---|---|
| Chain ID | `5042002` |
| RPC / WSS | `https://rpc.testnet.arc.io` / `wss://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` (Blockscout) |
| USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000`, **6 decimals** |
| Native gas token | USDC with **18 decimals**. It's the same balance as the ERC-20. |
| Faucet | https://faucet.circle.com (select Arc Testnet) |

Gotchas, from Arc's EVM-differences docs:
- **Never mix `msg.value` (18 decimals) with ERC-20 USDC amounts (6 decimals).** Our contracts only use the ERC-20.
- Set `maxFeePerGas` to at least **20 gwei**. Transactions below that are silently dropped, with no error.
- Finality is deterministic and arrives in under a second, so one confirmation is final. The UI can show "Entry recorded" right away.
- `PREVRANDAO` is always 0. Don't use onchain randomness; we don't need any.
- Block timestamps have one-second granularity and are non-decreasing. That's fine for minute-scale windows.
- Avoid `SELFDESTRUCT`. Pay out explicitly.

## Scaling path (not built now)

The contracts already support these, so they only need app or ops work later:
- More songs and competitions: `addSong` plus `createCompetition`, with no redeploy.
- Different payout curves for each competition: `payoutBps` is per-competition config.
- Automated metrics: replace the admin route with a cron that fetches YouTube or Last.fm data and calls the same `settle`.
- Multiple oracles or a multisig: change `setOracle` to point at a multisig.

These would need contract changes:
- Larger competitions (more than 500 entries): move to offchain ranking with a Merkle-root claim.
- One-transaction entries: use the EIP-2612 `permit` or Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) instead of approve plus enter.

## Not building

- Automated YouTube or Last.fm ingestion (cut-list item; the admin route covers it)
- Artist dashboard beyond a simple earnings view
- Mainnet deployment, fiat on-ramps, cross-chain USDC (CCTP or Gateway)
- Token or share sales

## Legal posture

Testnet prototype using test USDC only. No real money changes hands. Paid prediction contests with real money may count as gambling or contests under local law, and a production version would need legal review.
