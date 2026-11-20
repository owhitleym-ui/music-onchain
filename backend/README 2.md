# Local account activation backend

Current payment milestone: $5 / $20 / $50 support is implemented. The $20 option creates four separate ordinary entries atomically. Live payments require the new Remix deployment and activation; the existing account connection is retained until then. See [deployment and payment instructions](../ATOMIC-PAYMENTS.md).

This is our own backend for the original music frontend. It approves verified Privy embedded Ethereum wallets on the deployed 90%-curve contract. It does not send welcome funds, enter contests, or use Sean's backend or Olive's contracts.

- Website: **http://localhost:3000/**.
- API: **127.0.0.1:3001**, loopback only; Vite proxies `/api`.
- Privy app: `cmwnr8etv005h0gjvwth61jyt`.
- Supabase project: `https://dnobgwmuvdqhnraagvnq.supabase.co`.
- Arc Testnet 5042002 contract: `0x003043208750D205F98AC1D9ae670d2d2A19797C`.

## Private setup

Node 22.12+ is required. Install with `npm ci` in both `backend/` and `frontend/`. From the project root, **`npm run dev`** starts both processes. Stop older port-3000/3001 processes first. Ctrl+C stops both. Missing backend configuration is handled as unavailable activation; browsing, email login and balances still work.

Run these in your own Terminal, never paste keys into chat:

```sh
cd /Users/tj/Desktop/Hachathon/backend
npm run setup
```

The setup retains the generated test administrator and asks for the Supabase Project URL, Supabase **server secret key** (`sb_secret_...`), and a Privy **read-only App Secret** for Music Prediction Test. Secret input is hidden. Enter keeps an existing value. It writes `.env.local` with permissions 0600, outside the frontend. No secret uses a `VITE_` prefix. Never publish the file; keep a private backup of the administrator key. The MetaMask private key and seed phrase are neither needed nor used.

For Privy: App settings → Basics → API keys → New secret → Read-only. It is used only to look up the authenticated profile, not to sign from user wallets. For Supabase: obtain the Project URL through Connect and the server secret through Settings → API Keys. Do not use a publishable key for this backend.

Apply `supabase/001_account_approvals.sql` in the existing Supabase project's SQL Editor. It creates exactly three prefixed tables and five server-only functions. Existing team tables are untouched. Apply once; object name collisions abort the transaction rather than overwrite data. Browser roles have neither table privileges nor function execution; RLS is enabled. No Supabase login session is created for Privy users.

## Activate ownership only after checks pass

1. Run `npm run admin -- status` from `backend/`. It displays the administrator's **public** address and readiness. Send a small amount of native Arc Testnet USDC to that address for gas; **1 test USDC** is enough for the initial demo operations at ordinary fees, but always inspect the current status. Do not send funds to the contract for this approval setup.
2. In Remix, load the existing contract address above. In MetaMask use its current owner, `0xcd61a22acf76623114583a1e0a031c18201baf51`, on Arc Testnet.
3. Call `transferOwnership(newOwner)` with the dedicated administrator's public address, Value 0. Review and confirm in MetaMask. This nominates an owner; it does not finish the transfer.
4. Start `npm run dev` from the project root. In a second Terminal, run `npm run admin -- accept-ownership` from `backend/`. The shared worker signs acceptance, checks the receipt, and confirms the owner is the administrator. A blocked command can be retried after resolving funding/ownership.
5. Log in locally. Settings → Account shows **Activating your account…**, followed by **Account approved**. Approval gas is paid by the administrator; users can have a zero balance. Existing verified users are eligible too. Money remains manually funded and purchases stay disabled.

The new administrator has **all owner permissions** in this existing contract. The HTTP API exposes only the account's own approval status/request; it cannot create rounds, withdraw, change ownership, or approve arbitrary addresses. The original MetaMask address remains oracle and app-fee recipient. Email registration is authentication, not identity verification or a one-person guarantee.

## Operator commands

Run from `backend/` with the local backend running:

```sh
npm run admin -- status
npm run admin -- revoke 0xPARTICIPANT_ADDRESS
npm run admin -- reenable 0xPARTICIPANT_ADDRESS
npm run admin -- return-ownership
```

Revocation blocks new account activation immediately and queues onchain `approveWallet(address,false)`. Already signed transactions must be reconciled before subsequent nonces; they are not silently discarded. Explicit `reenable` clears that block and queues approval. Ordinary sign-in/retry cannot restore a revoked account. Revocations made in Remix before this backend existed are detected from contract history.

Returning ownership first pauses new approvals, then queues `transferOwnership` to the original MetaMask address through the same worker. After confirmation, use that original MetaMask account to call **`acceptOwnership()`** in Remix. This completes recovery. Do not call `renounceOwnership`. These tools submit only fixed zero-value administrative calls to this one contract on Arc Testnet.

The administrator must be used only by this worker. Manual transactions using its key would interfere with nonce tracking. A consumed nonce whose receipt cannot be reconciled is held as uncertain; it does not trigger a replacement transaction. Keep its key and database records intact for inspection rather than deleting rows or generating a new administrator.

## API and processing

Both `GET /api/account/approval` and `POST /api/account/approval` require a current Privy bearer token. POST has an empty body; user IDs, wallet addresses and contract addresses are derived/constant rather than accepted from the browser. GET observes status; POST creates/resumes an approval. Responses contain `status` (`pending`, `approved`, `revoked`, `error`), the internally matched `walletAddress`, optional retry timing, and consumer-safe errors. Tokens, signed transactions and server credentials are never returned.

Every access token is verified for our app. Authoritative user profiles are read from Privy with a brief cache; email verification, account status and embedded Ethereum wallet membership are checked. Wallet selection reuses the frontend's HD-index/address ordering. Browser state does not grant approval.

Supabase records account/wallet associations in `music_account_approvals`, transaction attempts in `music_admin_transactions`, and a fenced signer lease plus next nonce in `music_admin_signers`. Signed transaction bytes/hash are committed **before** sending. Expired-worker updates are rejected. Each worker resolves all reserved nonces before allocating another. Restarts use the same prepared transaction, never a freshly signed replacement after an uncertain broadcast. Receipts and onchain state must agree. Reverted transactions require explicit retry. Database outages stop submissions. A 20-new-accounts/hour limit is enforced atomically; polling and existing approvals do not use that allowance. Per-user HTTP limits bound repeated requests.

There are no scheduled cloud jobs, public webhooks, or admin HTTP routes. The local backend must stay running for processing. Frontend pending polling lasts one minute, then offers retry; the persisted worker continues independently. Shutdown/sign-out clears only the consumer state, not the ledger or approval.

## Checks

`npm test` in `backend/` runs token verification, database permissions and functions using an isolated embedded PostgreSQL runtime, HTTP tests, recovery/concurrency tests, and a real Solidity-bytecode lifecycle on local Anvil. The local-chain test requires `anvil` on PATH (or `MUSIC_TEST_ANVIL=/path/to/anvil`). It does **not** submit Arc transactions or use Supabase credentials. `npm test` and `npm run build` in `frontend/` check consumer integration and its production bundle.

Local automated tests are not proof of live onboarding. Live acceptance still requires the migration, private keys, administrator funding, ownership nomination/acceptance, real Privy login, and a confirmed Arc `walletApproved` read. See `VERIFICATION.md` for the current checkpoint.
