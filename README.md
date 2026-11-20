# Music predictions — our working project

Current update: daily-only V3 uses tomorrow / day after tomorrow / seven days later in Austin time, 5% of losing stake for the artist, and 1% of matched stake for the platform (main ranks 1 and 2 exempt). See [daily markets](DAILY-MARKETS.md). V3 requires a new deployment and migration 007; the older rules below are historical.


Current payment milestone: $5 / $20 / $50 support is implemented. The $20 option creates four separate ordinary entries atomically. Live payments require the new Remix deployment and activation; the existing account connection is retained until then. See [deployment and payment instructions](ATOMIC-PAYMENTS.md).

Project: `/Users/tj/Desktop/Hachathon`. The existing spelling is intentional.

## Start the local app

Node 22.12+ is required. Install dependencies with `npm ci` in both `frontend/` and `backend/`, then start **both** services from the project root:

```sh
cd /Users/tj/Desktop/Hachathon
npm run dev
```

Open **http://localhost:3000/**. The API runs only on `127.0.0.1:3001`; Vite proxies it. Ctrl+C stops both. If account activation has not been privately configured, email login and balance display remain available, and activation shows an honest retryable unavailable state.

- `frontend/`: our original consumer screens, Privy email accounts, and automatic account activation status. Prices and demo balances use dollar symbols. Live purchases remain disabled until the new atomic contract is verified and activated.
- `backend/`: our new local Privy verification and onchain account-approval worker. Setup, Supabase migration, administrator commands, and ownership recovery are documented in `backend/README.md`.
- `contracts/`, `remix/`, `payout-formula.md`: our contest source and verified deployment. The previous 90%-curve address is `0x003043208750D205F98AC1D9ae670d2d2A19797C` on Arc Testnet.
- `_references/team-repository/`: a separate team reference checkout. Sean's backend and Olive's contracts are not dependencies of this app.

User test funding remains manual. Automatic funding, QuickNode, public hosting and the real music feed remain outside this milestone. Account activation and contest payments are separate features; payment setup is documented in ATOMIC-PAYMENTS.md. Creating a Privy account verifies email; it is not identity-document verification.

## Checks and live setup

`npm test` runs backend and frontend checks. Backend tests start temporary loopback servers and a local Anvil chain; install Foundry's `anvil` or set `MUSIC_TEST_ANVIL`. No live service credentials are used by the tests. `npm run build` builds the consumer frontend.

The original Privy account and automatic approval flow were verified live. The new atomic payment code is implemented and tested locally, but its new deployment and real browser payment acceptance are pending. Follow ATOMIC-PAYMENTS.md; do not describe test payments as live-verified yet.

## Publishing only our changes

This workspace remains separate from the team reference checkout. No push, merge, or hosted deployment is performed by this milestone.

For a future push, use a separate checkout based on our `codex/music-prediction-frontend` branch. Copy only intended original frontend/backend sources, the root startup package, migration, and supporting docs. Review and stage explicit paths. Exclude `.env*` except `.env.example`, dependencies, build output, reference checkouts, private keys, and local state. Do not merge `sean/backend` or `olive-testing`.

Publishing the static frontend alone does not host the backend. A later deployment needs an explicit backend hosting plan; the local signer service is not a Vercel function.
