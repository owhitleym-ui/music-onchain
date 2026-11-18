# SPEC

This is the single source of truth for numbers and interfaces. `docs/PLAN.md` covers scope and ownership, and `docs/ARCHITECTURE.md` covers how the pieces fit. To change anything here, update this file first, then the code.

Status: **proposed by Olive, pending team review.**

## Competition parameters

| Parameter | Value | Contract field |
|---|---|---|
| Entry fee | **$5 USDC** | `entryFee = 5_000_000` (6 decimals) |
| Entries per wallet | 1 | enforced |
| Winners | **Top 3** | `payoutBps.length = 3` |
| Winner shares | **40% / 20% / 10%** | `payoutBps = [4000, 2000, 1000]` |
| Artist share | **25%**, plus rounding dust | `artistBps = 2500` |
| Platform share | **5%** to the treasury | `platformBps = 500` |
| Minimum entries | **3**; below this, everyone is refunded in full | `minEntries = 3` |
| Maximum entries | **100** (contract hard cap 500) | `maxEntries = 100` |
| Demo window | **15 minutes** | `closesAt = now + 900` |
| Product window (UI copy) | 7 days | `closesAt = now + 604800` |
| Metric | **YouTube view count at close**, entered by the admin | `metric = "YouTube views at close"` |
| Ranking | Smaller \|prediction − actual\| ranks higher | — |
| Ties | The earlier entry wins | — |
| Blocked wallets | The artist payout wallet, plus wallets the admin flags | `SongRegistry.isBlocked` |
| Settlement | One oracle key held by the backend via `/api/admin/settle` | `Competition.settle` |

Example with 10 entries: the pot is $50. First place gets $20, second $10, third $5, the artist $12.50, and the platform $2.50.

### Considered: top 5
This is supported without contract changes (up to 10 winners). For example, `[3000, 1800, 1200, 600, 400]` plus artist 2500 and platform 500. It would need `minEntries ≥ 5`, and with small fields almost everyone wins, so prizes stop meaning much. **Use it only for competitions expected to reach 20 or more entries.**

## Contracts

The source is in `contracts/src/`, and the full event list is in `docs/ARCHITECTURE.md`.

```solidity
// Competition (fans)
function enter(uint256 id, uint256 prediction) external;          // needs USDC approve(entryFee) first
function withdraw() external;                                       // claims deferred payouts

// Competition (oracle / owner)
function createCompetition(Config calldata cfg) external returns (uint256 id);
function settle(uint256 id, uint256 finalMetric) external;          // after closesAt
function cancel(uint256 id) external;                               // refunds everyone

// Competition (views)
function getCompetition(uint256 id) external view
    returns (Config memory, Status, uint256 pot, uint256 finalMetric, uint256 numEntries);
function getEntries(uint256 id) external view returns (Entry[] memory);
function hasEntered(uint256 id, address player) external view returns (bool);
function owed(address account) external view returns (uint256);

// SongRegistry
function getSong(uint256 songId) external view returns (Song memory);   // artist, active, metadataURI
function isBlocked(uint256 songId, address wallet) external view returns (bool);
```

`Status`: `0 None`, `1 Open`, `2 Settled`, `3 Cancelled`.

## Application flow

1. **Discover:** the home page shows three song cards (title, artist, metric, time left, prize pool = `pot`).
2. **Sign in:** Privy email login creates an embedded wallet with no seed phrase.
3. **Fund:** the "Get test USDC" button calls `/api/faucet`, which sends test USDC.
4. **Enter:** the user types a prediction and taps "Enter for $5". This sends `approve`, then `enter`, and the UI shows one progress step.
5. **Confirm:** "Entry recorded" appears right away (Arc finality is under a second).
6. **Live:** the leaderboard updates from QuickNode Stream events.
7. **Settle:** the admin submits the real view count, and the contract pays out in the same transaction.
8. **Results:** final ranks, payouts, and the artist's earnings are shown.

## Still open
- The three demo songs (title, artist, YouTube link, artist payout wallet)
- The product name
- The faucet drip amount (proposed: $20, enough for 4 entries)
