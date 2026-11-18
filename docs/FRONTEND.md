# Frontend

The app in `apps/web` is TJ's design (PR "Add interactive music prediction frontend demo", branch `codex/music-prediction-frontend`) ported into Next.js and connected to the real contract and backend. TJ's stylesheet is copied unchanged into `app/predict.css`, so the screens look the same.

## Decision: contract rules win

TJ's demo and Olive's contract had different game rules. The team chose to keep the contract's rules and TJ's design:

| | TJ's demo | Now (matches `Competition.sol`) |
|---|---|---|
| Entry | $10 spot, or $100 bundle of 10 | One fixed-price entry per wallet per competition |
| Windows | 24h / 48h / 1 week per hourly round | One window per competition, closing at `closesAt` |
| Payout | 100-rank transfer curve, partial losses | Top 3 split the pool 40/20/10, artist 25%, platform 5% |
| Too few players | n/a | Below `minEntries`, everyone is refunded |
| Data | Simulated in localStorage | Contract + backend API; chart history is still sample data |

Removed because the contract can't support them: the $100 bundle, the horizon tabs, the 100-rank curve, and "Reset demo". Kept as browser-only conveniences: following artists and light/dark theme.

## Every button and what it calls

| Screen | Button / element | What happens |
|---|---|---|
| Header | **Sign in** | Privy email login, which creates an embedded wallet (no seed phrase). Without `NEXT_PUBLIC_PRIVY_APP_ID`, creates a local test wallet instead (development only) |
| Header | Balance button | `GET /api/me/balance` (polled every 10s) |
| Header menu | **Get test USDC** | `POST /api/faucet` with the Privy token |
| Header menu | **Sign out** | Privy logout (or forgets the local test wallet) |
| Header | Theme toggle | Browser only |
| Discover | Song cards, pool, entries, status | `GET /api/competitions` (polled every 5s) |
| Discover | Search, genre filter, "Only artists I follow" | Browser only |
| Any | **Follow artist** | Browser only (localStorage) |
| Competition | Chart | Sample history from `lib/client/history.ts`, plus the real crowd average, your guess and the final result |
| Competition | Live entries / Final results table, sidebar stats | `GET /api/competitions/:id/leaderboard` (polled every 3s; filled by the QuickNode Stream when it's set up) |
| Competition | **How rewards work** | Rules for the contract's actual split, read from the competition's config |
| Competition | **Review prediction** | Opens the review dialog (or Privy sign-in if signed out) |
| Review dialog | **Confirm $5 prediction** | 1. `POST /api/faucet` if the balance is short  2. `USDC.approve` (skipped if already approved)  3. `Competition.enter`, signed by the fan's wallet in the browser (`lib/client/enter.ts`) |
| Competition | Live activity | `GET /api/activity`, shown only when Supabase is configured |
| My Purchases | Stats, table, status, net profit | `GET /api/me/entries` (polled every 5s) |
| My Purchases | Row → breakdown dialog | Same data, no extra call |
| `/admin` | **Load** | `GET /api/admin/status` |
| `/admin` | **Settle** | `POST /api/admin/settle` |
| `/admin` | **Cancel + refund** | `POST /api/admin/cancel` |
| `/admin` | **From YouTube** | `GET /api/admin/youtube` |

## Where things live

| Path | Purpose |
|---|---|
| `app/layout.tsx`, `app/providers.tsx` | Layout, header, wallet/balance/toast providers |
| `app/page.tsx` | Discover |
| `app/compete/[id]/page.tsx` | Competition page, review dialog, entry flow |
| `app/entries/page.tsx` | My Purchases |
| `app/admin/page.tsx` | Admin console |
| `components/` | Header, icons, modal/toast, song cover, chart, rules dialog |
| `lib/client/wallet.tsx` | Privy wallet, or the local test wallet when Privy isn't configured |
| `lib/client/enter.ts` | approve + enter transactions, contract errors in plain English |
| `lib/client/api.ts`, `types.ts` | Fetch helpers, polling hook, API response types |
| `lib/songs.ts` | Song display data (TJ's fictional artists) keyed by the contract's `metadataURI` |
| `brand.config.ts` | Product name (the only place it's set) |

## Verified locally (anvil, November 18)

Signed in with the local test wallet, got test USDC from the faucet automatically, approved and entered from the review dialog, saw the entry in the live table, settled from `/admin`, saw the ranked results with payouts ($8 to 1st on a $20 pool), and saw "Won, +$3.00" on My Purchases. The layout fits a 375px phone screen with no sideways scrolling.

**Not verified yet:** Privy login (needs the app ID), Arc testnet, and the QuickNode-fed "Live via QuickNode Stream" state.
