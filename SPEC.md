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

## Backend API

Status: **implemented by Sean on `sean/backend`, pending team review.** Runbook: `docs/BACKEND.md`.

Every amount comes back as `{ "usd": "5.00", "raw": "5000000" }` (raw = 6-decimal USDC). Show `usd`. Players are named `"Fan 3F9A"` or `"You"`, never by address. Errors are `{ "ok": false, "error": "<code>", "message": "<readable>" }`.

| Route | Who calls it | Request | Response |
|---|---|---|---|
| `GET /api/competitions` | Home page | none | `{ ok, competitions: Summary[] }` |
| `GET /api/competitions/:id/leaderboard?viewer=0x…` | Competition page, poll every 2–3 s | `viewer` = signed-in wallet (marks "You") | `{ ok, source: "stream" \| "chain", competition: Summary, entries: Entry[], artistEarned? }` |
| `GET /api/me/entries?address=0x…` | My Entries | wallet address | `{ ok, entries: { competition, entryIndex, prediction, rank, error, payout, refund }[] }` |
| `GET /api/activity?limit=20` | Optional live feed | none | `{ ok, available, items: { competitionId, at, text, event, txHash }[] }` |
| `GET /api/me/balance?address=0x…` | Header balance, pre-entry check | wallet address | `{ ok, balance }` |
| `POST /api/faucet` | "Get test USDC" button | header `Authorization: Bearer <Privy access token>` | `{ ok, alreadyFunded, txHash, amount, balance }` |
| `POST /api/admin/settle` | `/admin` page | header `x-admin-secret`; body `{ competitionId, finalMetric }` | `{ ok, txHash, status: "Settled" \| "Cancelled" }` |
| `POST /api/admin/cancel` | `/admin` page | header `x-admin-secret`; body `{ competitionId }` | `{ ok, txHash, status, refunded }` |
| `GET /api/admin/status` | `/admin` page | header `x-admin-secret` | wallet balances, database state, all competitions |
| `GET /api/admin/youtube?videoId=` | `/admin` page (optional) | header `x-admin-secret` | `{ ok, viewCount }` |
| `POST /api/streams/webhook` | QuickNode Stream | signed by QuickNode | `{ ok, stored }` |

`Summary`: `id, songId, title, artist, artworkUrl, song (display data from apps/web/lib/songs.ts), metric, phase ("open" | "closed" | "settled" | "cancelled"), closesAt, secondsLeft, entryFee, pot, numEntries, minEntries, maxEntries, finalMetric, prizes { winners[], artist, platform }, split`. `phase: "closed"` means entries are closed and the result hasn't been submitted yet. Prizes are projected from the current pot while open, actual once settled.

`Entry`: `entryIndex, name, isYou, prediction, rank, error, payout, refund`. While open, entries are in entry order and `rank`/`payout` are null. Once settled they're ranked with the contract's rule. If cancelled, every entry has a `refund`.

The browser still sends `approve` and `enter` itself through the Privy wallet. The backend never holds user keys.

## Still open
- The three demo songs (title, artist, YouTube link, artist payout wallet). Song display data lives in `apps/web/lib/songs.ts`, keyed by `metadataURI`.
- The product name
- The faucet drip amount. Proposed: **$10** (`FAUCET_DRIP_USDC`), enough for two entries plus gas. A wallet can enter each of the 3 demo competitions once, so $15 would cover all three.
