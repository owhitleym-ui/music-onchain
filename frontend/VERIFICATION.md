# Step 1 verification — November 19, 2026

## Step 6 — implemented and automatically verified; live acceptance pending

125 frontend checks pass, alongside 107 backend checks and a successful production build. Browser checks with simulated auth/API responses verify sample-result labels, four individual collection controls, explicit review before signing, one-entry collection, unsigned cancellation, access after buying permission is revoked, mobile/dark layouts and clearing private data on logout. Browser testing found and fixed a late confirmation reopening a dismissed dialog and an accessible table label causing mobile overflow.

Collection amounts, destination checks and calldata retain exact precision. Claims and purchases share account transaction serialization. Confirmed receipts refresh balance/history; other recipients are excluded from received amounts. The installed production build and real signed-out browser checks also pass; collection support is configured and automatic settlement is off. There are no live participant claims yet; live acceptance remains pending. No design-branch or hosting update was made. Earlier checkpoints below are historical.

## Step 5 — implemented and automatically verified; live acceptance pending

Last Bus Home now uses the live combined snapshot and private entry history. Other songs remain previews. Historical view data is explicitly simulated; crowd predictions are verified. Stale values remain visible with freshness notices. Payment confirmation and contest result states are independent; a $20 purchase appears once with four detailed records. Unverified private totals show dashes rather than zero returns. Exact money and large guesses are preserved.

119 frontend checks pass. Production build passes with the configured public Privy App ID. Headless browser checks cover desktop, narrow light/dark layouts, round selection, simulated/live labels, stale totals, preserved guess/focus, four-entry history, Escape dismissal and clearing private data on sign-out. Browser scenarios use simulated API/auth responses; they do not prove real payment acceptance.

The installed project's own production build passes, and a scan confirms none of the configured server credentials are in the output. A fresh signed-out browser using the real local backend verifies the current closed round, $0 totals, no fabricated crowd chart points, disabled entry input and sign-in protected private history. The app remains running at http://localhost:3000/. These live checks are read-only.

The live database/contract read-only checkpoint confirms round 1 closed and all pools empty. Real two-account $5/$20/$50 purchase and payout acceptance is still pending by user choice. No real payment, funding, GitHub push, hosted deployment, or friend-design-branch change was made for Step 5. Earlier sections below are historical.

## Implemented locally

- Privy app: Music Prediction Test, public ID cmwnr8etv005h0gjvwth61jyt.
- URL: http://localhost:3000/.
- Frontend suite: 90 checks passed, zero failed.
- Production build: passed with the pinned dependencies unchanged.
- Both the running transformed sign-in module and production JS contain the new public App ID; the old ID is absent.
- The page and sign-in component return HTTP 200.
- The native balance RPC returned a valid response and permits our local origin.
- Wallet setup waits for the SDK and matches the current profile. Retries refresh the user and reuse an existing wallet, with serialized creation attempts and stale-response protection.
- Consumer screens retain dollar amounts and omit wallet/network controls. Purchases remain paused; browser-local samples, follows and theme are preserved.
- No App Secret was requested, stored or used. No funding, Supabase, backend endpoints, QuickNode, contract payments, Git push or Vercel changes were added.

## Real browser acceptance

User-confirmed real checks with the new app: the email form opens; email-code sign-in completes; Settings shows the verified email and an actual balance; refreshing and signing out/signing back in restore that email and balance. Native Safari inspection timed out, so browser evidence is supplied by the user rather than direct agent inspection.

The user additionally confirmed that exactly one embedded Ethereum wallet remains linked in the new Privy dashboard after signing back in. The user verified light/dark mode, readable narrow layout, keyboard navigation and Escape dismissal of Settings.

**Step 1 is complete.** The real registration and restoration checks above were confirmed by the user in their browser and Privy dashboard. Automated tests use mocked SDK/session outcomes; they are recorded separately from this live acceptance evidence. Step 2 automatic funding has not started.


## Atomic $20 implementation — November 19, 2026

Implemented $5/$20/$50 entry options; $20 is one atomic payment creating four separate ordinary entry records, with identical guesses and no bonus. Added authenticated durable payment orders, signature verification, receipt/event reconciliation, account history, contract-scoped approval cutover, and a serialized test-round operator command.

Current automated evidence: 69 backend checks, 109 frontend checks, 13 contract-helper checks, 45 standard contract tests and 45 Arc-runtime contract tests pass. The production build passes and contains the new public Privy App ID without server-only secret configuration. The flattened Remix contract compiles with Solidity 0.8.28, optimizer 200, Cancun, viaIR false; its executable matches the tested multi-file source. Actual payment signing/receipts are exercised with disposable accounts on local Anvil; Arc runtime tests run separately. No real Privy payment or Arc Testnet purchase has been claimed as verified.

Not yet deployed: use remix/MusicPredictionContest90Four.sol and ATOMIC-PAYMENTS.md. Apply migration 002, deploy/verify the new contract, activate it, re-approve the user on that address, create a future hourly round, fund participant/reserve manually, and complete real $5/$20/$50 browser purchases. Live payments remain gated until activation. The previous contract, approvals, records and private configuration are retained. No push, Vercel changes, automatic funding, QuickNode, live music feed or teammate integration was performed.
