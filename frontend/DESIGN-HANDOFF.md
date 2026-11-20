# Design handoff

This is Tianjian's original music-prediction consumer frontend, published as a
reviewable snapshot on `frontend-design`. It is separate from `apps/web/`.
The source and tests come from the working local project; the server, server
credentials and wallet private keys are not included.

## What to improve

Improve the visual design and mobile layout of Discover, Support Artist,
My Purchases, Settings and their dialogs. Keep the existing behavior. Start in
`styles.css`. Visual markup is in `app.js` and `payment-ui.js`; icons and charts
are in `icons.js` and `chart.js`. `index.html` contains the app/dialog roots.

Those JavaScript files also contain behavior, so edit rendering carefully:
retain existing data-action attributes, data IDs, input IDs, root containers,
form handlers, focus restoration, Escape handling, disabled states and labels
needed for financial decisions. Keep entry cost, estimated fee, total, guess,
measurement window and spot count in payment confirmation. Status must stay
separate from contest results. Preserve light/dark themes and narrow layouts.

The consumer must continue to show dollars and “Demo — no real money.”
Sample history remains separate from account purchases. Reset demo and logout
must not erase real payment history or revoke approval.

## Protected integration

`design/protected-files.json` records the reviewed checksums of the login,
wallet, activation, payment, pricing, storage, setup and test files. The design
guard fails if these change. It is an accidental-change check, not a substitute
for reviewing UI edits and testing real account/payment flows after integration.
Do not regenerate the manifest or weaken checks to make a redesign pass.

In particular, keep these behaviors:

- Privy email login and restoration select the user's existing embedded wallet.
- Approval comes from the authenticated backend and deployed contract.
- $5 buys one spot; $20 atomically buys four separate $5 entries with the same
  guess and no bonus; $50 keeps the existing ten-spot bundle behavior.
- Signing, confirmation, idempotency, per-account history, pending-order recovery
  and stale-response handling on logout/account switching remain intact.
- Prices, contract addresses, chain ID, API routes and dependency versions stay
  unchanged. Do not replace this app with a different frontend framework.

## Start a design preview

Requires Node 22.12 or newer. From the repository root:

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. `.env.example` contains only the public Privy App ID.
No private server key is needed for visual work. Browsing, existing sample data,
themes and layout work without the local backend. Privy may open its login UI,
but approval and real account payment/history requests require the owner's
backend at `127.0.0.1:3001`. Its absence must remain an honest unavailable state.
Do not add mock approval or payment success to the actual account flow.

The existing automated tests mock the services and run without backend secrets.
They do not prove that real registration and on-chain payments succeeded.

## Collaborate and return changes

```sh
git fetch origin
git switch frontend-design
git pull --ff-only origin frontend-design
git switch -c design/visual-refresh
```

Change only this `frontend/` folder for the redesign. Run:

```sh
npm run check:design
npm test
npm run build
```

Commit and push `design/visual-refresh`, then open a pull request with
**base: frontend-design**. Contributors without push access can use a fork
and target the same base branch. Include screenshots of desktop/mobile and light/dark
views, plus the checks you ran. Do not overwrite the owner's whole local folder
or merge straight into `main`. Functional changes and any changes to tests or
protected files need separate integration review.

The owner can keep developing the backend independently. Live-data changes in
Step 5 may also touch `app.js` and `payment-ui.js`; integrate those changes by
reviewing the diff against the original design snapshot and resolve conflicts
without replacing the latest account/payment behavior.
