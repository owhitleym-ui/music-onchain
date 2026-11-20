# Music predictions — consumer frontend

Current milestone: Last Bus Home reads verified contest totals and account entries through the local backend and QuickNode/Supabase event history. The atomic contract is active. Music-view history remains clearly simulated; other songs remain previews. Real two-account $5 / $20 / $50 purchase acceptance is still pending. The $20 option creates four ordinary entries together. See [deployment and payment instructions](../ATOMIC-PAYMENTS.md).

The live round selector uses recorded rounds, including closed and upcoming rounds. Public totals refresh every five seconds, private history every ten seconds, and pending payments every two seconds. Returning to the tab refreshes immediately. During delays or outages, the app retains its last verified values with a freshness notice. Sample totals never substitute for live pools. Money and large predictions retain decimal precision.

My Purchases groups entries by transaction, shows all four records for a $20 purchase, and separates payment confirmation from contest results. Available returns are separate from money received. Net results exclude unclaimed/unsettled entries and network fees. Pages contain ten purchase groups; summaries cover the shown purchases. Account changes clear private history. No payout or settlement action is exposed.

Our original Discover, Support Artist and My Purchases screens, with email accounts supplied by Privy. This app is separate from the team's Next.js frontend and backend. It does not import Olive's Competition contract or Sean's APIs.

## Run locally

Requires Node 22.12 or newer.

```sh
cd /Users/tj/Desktop/Hachathon/frontend
npm ci
cd ..
npm run dev
```

Open **http://localhost:3000/**. This is the origin already allowed in the current Privy app. Browser-local sample data is separate for each host and port; any earlier 5173 demo records stay at that old origin.

Build a static production version with `npm run build`; its output is `dist/`. `npm run preview` serves that build. This milestone does not publish it or send payments. A plain Python static server cannot transform the Privy React integration.

## Configure Privy

The new **Music Prediction Test** public App ID, `cmwnr8etv005h0gjvwth61jyt`, is configured in ignored `.env.local`. For another checkout, copy `.env.example` to `.env.local`; it contains this same public test App ID. Restart the server after changing it. The earlier Privy app is not used or migrated.

In the same application's Privy dashboard:

1. Under **User management → Authentication**, enable **Email** login.
2. Under **App settings → Basics → Domains and clients**, allow `http://localhost:3000`. The new app also allows the planned Vercel origin, but this milestone is local only.
3. The SDK requests automatic Ethereum wallet creation with `createOnLogin: "users-without-wallets"`. The dashboard default being off does not alone prove SDK-driven creation is disabled; verify the actual login flow. No wallet-creation dashboard switch is required by this implementation.

**No Privy App Secret belongs in the frontend.** Only the public App ID is used. The local backend now verifies Privy access tokens and retrieves linked wallets before requesting contest-entry approval. Client-side state grants no administrative privilege. Privy App Secrets and Supabase server keys belong only in `backend/.env.local`.

Privy manages verified email accounts, sessions and embedded-wallet keys. Sign up / Log in opens its email-code dialog. A new email registers an account; returning users recover the same account and wallet. We collect no identity documents or passwords. There is no fake/local-wallet fallback. Without configuration, browsing still works and sign-in is shown as unavailable.

The small React bridge in `auth.jsx` adapts the team's focused Privy onboarding pattern to our JavaScript app. It waits for both login and wallet readiness. `privy-session.js` selects only a connected wallet linked to the current user and provides the guarded `ensureWallet` action: refresh the user, reuse an existing wallet, or create one only when none exists. A creation response alone never marks setup complete. Repeated retries share one setup operation, and its result is ignored after logout or an account change. An interrupted restoration can be retried or reloaded without deliberately creating another wallet. Page rendering, charts, sample data and contest rules remain ours. `account.js` exposes account state, subscriptions, sign-in/out, balance refresh and internal provider/token access for later integration. Raw SDK errors, addresses and network controls are absent from consumer screens.

## Dollars, balances and samples

The UI shows **$5** for one spot and **$50** for ten identical spots. The 1.05 maximum multiplier, same-account bonus exclusion, transfer curve, fee exemptions and 2% artist/app fees are unchanged.

Settings → Account shows the embedded account's native Arc Testnet balance formatted as dollars, with **Demo dollars · no cash value**. Balances remain BigInt until cent rounding. Refresh runs manually, on account changes, on returning to the tab, and every 30 seconds while Settings is visible. This is not a bank-dollar balance and is separate from the sample portfolio.

Sample purchases remain disabled at UI and store boundaries. Last Bus Home uses the active atomic contract and verified opening/deadline checks; its prepare/review/sign/confirm payment flow is preserved. Sign-in requests account approval through the authenticated backend. Settings displays checking/pending, approved, revoked, and retryable errors separately from balance and wallet setup. Missing setup never fakes approval. No automatic funding or payout controls are added.

Sample history, follows and theme remain browser-local. History is visibly marked as samples, not the signed-in user's transactions. The `music-prediction-demo-v1` key and version-2 price migration are preserved. Reset demo affects samples and appearance only; sign-out leaves them intact.

The old MetaMask module and deployment helper remain source files for prior administrative tools and regression tests. They are not imported by the consumer app or emitted as production entry points.

## Checks

```sh
npm test
npm run build
```

The current suite has 109 passing checks, including SDK-session adapter behavior, wallet restoration readiness, current-user wallet matching, guarded creation, overlapping retries, account lifecycle and stale responses, native balance reads, dollar formatting, price migration, paused purchases, DOM-level account screens and dialog focus, plus existing administrative helper regressions. DOM tests do not replace visual browser checks.

Manual acceptance:

- Complete email registration and inspect the new user in Privy's dashboard.
- Refresh, sign out and sign back in; verify the same account and wallet.
- Try an invalid/expired code, cancel the dialog, and retry.
- Compare the account balance with the same embedded account on the testnet. New accounts normally start at zero.
- Check keyboard navigation and light/dark layouts on desktop and a narrow window.
- Confirm that prediction purchases remain unavailable.

## Step 1 acceptance status

Step 1 is complete: the local code uses the new App ID, all 90 automated checks pass, and the production build contains the new ID without the old ID. In real browser tests the user confirmed email-code registration, verified email and balance display, restoration after refresh and sign-out/sign-in, exactly one linked embedded Ethereum wallet in the Privy dashboard, readable light/dark and narrow layouts, and keyboard/Escape behavior. A new wallet with a $0.00 balance is valid; the user replaced Step 2 with manual test funding. Automatic account approval is a separate Step 3 preparation milestone; it does not fund accounts. No GitHub or Vercel changes were made.

## Local account activation

From the project root, `npm run dev` starts Vite and the loopback-only approval backend. `npm run dev` inside `frontend/` still starts only Vite, so run the root command for activation. See `../backend/README.md` for private setup and the isolated Supabase migration.

`approval.js` handles authenticated POST requests and GET polling every two seconds for up to one minute; manual retry resumes server-side work. `account.js` exposes independent `approvalStatus`, `approvalError`, `approvalCanRetry`, `refreshApproval()` and `retryApproval()`. Logout/account switching invalidates pending responses. Already-approved returning users do not need another approval transaction. Reset demo never changes onchain approval.

Consumer screens show account activation wording, not addresses or network controls. The new account can have zero balance and still be approved because the administrator pays its network fee. Account approval alone does not enable purchases. The new atomic contract must be deployed and activated before Last Bus Home test purchases become available. Existing browser-local data and frontend dependencies are preserved.
