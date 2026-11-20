# Agreed seven-step roadmap

Agreed November 19, 2026. This is the sequence we will follow for our original music-prediction app.

## Working process

Handle one big step at a time: preparation and service setup with the user, then the user's request for a coding plan, then implementation and verification. Do not start the next step's coding during preparation. Reuse useful patterns from team references without merging Sean's or Olive's branches or changing our agreed contest rules. Future pushes include only our intended changes.

Project location: /Users/tj/Desktop/Hachathon. Original frontend: frontend/. Team reference checkout: _references/team-repository/. Local URL: http://localhost:3000/. Use the user's existing Supabase project. Consumer amounts use dollar symbols and clearly identify demo funds; underlying development targets Arc Testnet.

## 1. Account and wallet

Finish real Privy email registration, automatic embedded-wallet creation, session restoration and sign-out. Step 1 is complete: the user verified real email registration, one embedded Ethereum wallet, balance display, and recovery after refresh and sign-out/sign-in. Automated checks and the production build pass. The user chose to create a fresh Privy application for our frontend on November 19, 2026. The new public App ID is cmwnr8etv005h0gjvwth61jyt. Its public configuration was checked successfully. The user approved the Step 1 coding plan and requested implementation. The local frontend now uses this new App ID; automatic funding and later steps remain out of scope. The previous App ID cmwn0lgw002rb0gjy24cxkfpj is historical, not the target configuration. Allow http://localhost:3000 on the new app and verify the production origin separately when deploying. The browser uses the public App ID; no App Secret in frontend code.

Acceptance: register, verify email, confirm the account has an embedded Ethereum wallet, then sign out and sign back in to the same account and wallet. A newly created wallet may have zero balance.

## 2. Manual test funding

The user replaced automatic welcome funding with manual transfers on November 19, 2026. Send native Arc Testnet USDC to each user's Privy embedded wallet manually. No automatic grant backend or Supabase grant tables are needed for this milestone. The app continues to show the actual confirmed wallet balance as demo dollars.

Acceptance: a manually funded user's balance refreshes in account settings. Keep enough test tokens for the entry plus network fees; the 50-dollar bundle needs more than 50 tokens.

## 3. Contest setup and payments

The user deployed the new 90%-curve MusicPredictionContest revision on Arc Testnet at **0x003043208750D205F98AC1D9ae670d2d2A19797C**. Its first-place rate is verified as 900000000000000000 (90%) and its executable matches the prepared source. The actual deployment matches Solidity 0.8.28, optimizer 200, Cancun, viaIR false; 40 standard and 40 Arc isolated-runtime tests pass with these settings. See `contracts/deployments/arc-testnet-curve90.json`. The earlier 100%-curve contract at 0x622DE243e71358e258925Efa3968bdE5837acea9 is historical and remains separate. The user requested the new Solidity file on November 19, 2026; the user has now deployed it in Remix and the address/code have been verified. Configure approved participant wallets, artist/team exclusions, future hourly rounds and the bonus reserve. Connect the original frontend to payable enter(roundId,horizon,guess), using 5 or 50 native test USDC with 18-decimal units. Preserve the ten-spot bundle, fees and same-wallet bonus exclusion; multiply every original curve rate by 0.9 before bonus/fee calculations. First place is now 90% before bonuses and fees. Principal and full cancellation refunds are unchanged. Manual test funding must cover the selected purchase and network fees.

Acceptance: a confirmed 5-dollar entry creates one spot; a 50-dollar entry creates ten. Failed/rejected transactions do not create a false purchase record.

## 4. QuickNode and database

Deploy our own reachable backend webhook, verify QuickNode signatures, decode our contract events and save them in separate Supabase tables. Deduplicate deliveries and support backfill/reconciliation. Automatic welcome grants are omitted; manual funding does not depend on the contest event stream.

Acceptance: a confirmed contest event is stored once, including after retries and temporary database outages.

## 5. Live frontend

Replace sample contest totals, entries, crowd predictions and purchase history with actual backend/chain records. Show pending, confirmed, settling, claimable, claimed and refund states accurately. Do not attribute sample records to the authenticated user.

Acceptance: another participant's entry updates the screens; user history reflects actual transactions.

## 6. Results and payouts

Start with clearly identified sample results. Implement oracle submission, resumable ordering/settlement, participant claims, artist/app fee claims, cancellations and timeout refunds. Finalized/claimable is distinct from money received. The deployed Arc measurement windows require real elapsed time (earliest is 24 hours after a future hourly start); use a local chain with time advancement for fast full-lifecycle tests and start the Arc round early.

Acceptance: the complete contest lifecycle reconciles funds and supports successful claims and refunds.

## 7. Real music feed

Research provider access and metric feasibility early, then implement the real feed after the money lifecycle works. Define the exact song/music identifier and new-view count during each fixed measurement window. Preserve snapshots and result evidence. Do not silently substitute lifetime totals, BGM-use counts, or another platform's metric. TikTok Research API statistics may be delayed and must not be assumed real-time.

Acceptance: a contest receives and settles against the agreed real provider metric with preserved evidence.

## Current checkpoint

Step 1 COMPLETE: 90 automated checks and the production build pass. The user confirmed real email-code registration, verified email and balance display, restoration after refresh and sign-out/sign-in, exactly one linked embedded Ethereum wallet in the new Privy dashboard, and light/dark, narrow-layout and keyboard/Escape behavior. Step 2 automatic funding was dropped in favor of manual test transfers. The new 90%-curve contract is now deployed and verified at 0x003043208750D205F98AC1D9ae670d2d2A19797C. The user requested automatic approval of verified Privy embedded wallets. Its local backend and consumer activation flow are implemented with isolated Supabase records. The project URL is https://dnobgwmuvdqhnraagvnq.supabase.co. Live activation still needs privately entered server keys, the SQL migration, funding the dedicated test administrator, owner nomination in MetaMask and worker acceptance, then a real Privy login with onchain confirmation. Only after that: manual participant funding, round/reserve setup, and payment integration. Frontend purchases remain paused. The user retracted Vercel delivery: no push or deployment in Step 1. No automatic funding backend, Supabase migrations, QuickNode integration or payment enablement has been added.

## Step 1 preparation checkpoint — new Privy app

New public App ID: cmwnr8etv005h0gjvwth61jyt. User reports Email enabled and both origins added; public settings were queried to verify. Frontend configuration was switched during the approved Step 1 implementation. See frontend/VERIFICATION.md for the current real-test status. No App Secret was shared.

## Automatic account-approval checkpoint — November 19, 2026

Implementation is local only. The original frontend remains at localhost:3000; a separate Node backend listens on 127.0.0.1:3001 with a Vite /api proxy. It verifies Privy tokens/profiles, derives embedded Ethereum addresses server-side, and saves fenced/serialized administrator transactions before broadcast. The existing Supabase project holds only the three new prefixed approval/signing tables; no team tables or backend branches are integrated.

The dedicated administrator takes all owner permissions through the existing two-step ownership flow; oracle and app recipient remain the original MetaMask wallet. Ownership changes are a final user setup step after code/tests. No live ownership transfer or Arc approval has been sent during implementation. Frontend purchases stay paused and test funding stays manual. See backend/VERIFICATION.md for evidence and pending live checks.

Dedicated test administrator public address: 0x170249F9Ac07D25F97bC1957B68A0011543d07ad. Generated locally, key stored privately with 0600 permissions. No ownership change performed. Final local checks: 42 backend + 102 frontend passed, production build passed, root startup and proxy respond. Awaiting private settings and Supabase migration before live ownership/registration checks.

Current approval database target: https://dnobgwmuvdqhnraagvnq.supabase.co. The user explicitly selected this new project. Keep the Supabase implementation. Enter a replacement server secret privately using Terminal setup; no chat-posted secret was installed. The administrator wallet and contract address are unchanged.

## Live setup checkpoint — ownership accepted

The user saved replacement server settings privately. Privy server access was verified; the new Supabase project's approval tables are reachable after the user applied the migration. The user manually funded the dedicated administrator with 1 native Arc test USDC. The local services were restarted with ready=true.

The user nominated 0x170249F9Ac07D25F97bC1957B68A0011543d07ad via Remix. The backend accepted the nomination through the durable shared worker. Confirmed Arc transaction: 0xb4f009c68d6f7bdf0715e379500543e7a0c8586c49778278f757eefe774f7630. Read-only verification confirms that address is now owner of 0x003043208750D205F98AC1D9ae670d2d2A19797C. Oracle and platformRecipient remain 0xcd61a22acf76623114583a1e0a031c18201baf51.

Next required acceptance: real local Privy login, confirmed automatic wallet approval, refresh/sign-out/sign-in without an additional approval transaction. Purchases remain paused; manual test funding remains the plan. Automatic account approval is not yet marked complete.

## Latest checkpoint — automatic approval COMPLETE

Real local login shows Account approved. The user refreshed, signed out and signed back in with the same email and still sees Account approved. An independent chain/database check confirms true approval, one confirmed transaction and no second approval. Transaction: 0x4c85bbebd5cefc06a3d4ce8b6655874f3030b2cbcae63f701982d73e6eb88ba1 (Arc block 73090991).

Next: Step 3 purchase integration preparation. The participant wallet 0x86e574fcd545c8042c07b70d23dfa8d75cb30ef0 currently has zero test USDC. Manually fund it for a 5-dollar entry plus gas, then plan the contract-backed purchase flow, supported round setup, transaction status, and sample/live separation. No purchase coding is requested yet; follow the agreed preparation → coding plan → implementation process. The ten-spot bundle still needs 50 tokens plus gas and the existing 2.5-token contract reserve admission requirement.


## Atomic $20 payment checkpoint — implementation ready, deployment pending

The user selected live payment integration, one Last Bus Home test song, and all-or-nothing $20 payments producing four separate ordinary entry records. The new enterFour function and backend/frontend payment path are implemented and tested. $5 and $50 retain their existing behavior; $20 carries no discount, multiplier bonus or reserve reservation. All four records share one successful transaction and timestamp, with distinct entry IDs.

Automated checks pass: 69 backend, 109 frontend, 13 contract helpers, 45 standard contract tests, 45 Arc runtime tests, and the production build. The flattened Remix file matches the tested executable. Existing consumer accounts and old automatic approvals remain active until the explicit new-contract cutover. Manual funding remains the policy.

Next human step: upload remix/MusicPredictionContest90Four.sol in Remix, compile using 0.8.28 / optimizer 200 / Cancun / viaIR off, and deploy with the existing backend administrator as owner and original MetaMask address as oracle/app recipient. Migration 002 and the activation command are documented in ATOMIC-PAYMENTS.md. No new contract address is known yet, and real Privy payment acceptance is pending. Do not mark Step 3 complete or enable purchases against the old contract.


## Step 3 live checkpoint — atomic deployment activated, November 19, 2026

The user deployed the atomic contract at 0x0e45cF9200c27aF84Ba175a8f6723FFD8Dd8B083. Deployment receipt 0x625c3d03e7b396ab3167b85ddc2eb75cf65cf6549befd41e1c9773e709d42430 succeeded at block 73100560. Executable matches the reviewed atomic source; owner is the dedicated backend administrator, oracle/platformRecipient remain the original MetaMask address, native prices are 5/20/50, and the first-rank transfer rate is 90%. Verified manifest is contracts/deployments/arc-testnet-atomic-live.json.

Migration 002 is installed, including the corrected contract/payload operator INSERT and server-only purchase functions. Local services were restarted on the new contract. GET /api/health reports paymentsConfigured=true. A real create-round operator job completed through the durable administrator worker: transaction 0x5129b82c5dea3dc11c9d3650c0cb503b6fe3f2fa18585df54413da75d7065095. Last Bus Home round 1 starts November 19 at 7:00 PM Central Time, closes at 8:00 PM; UTC start 2026-11-20T01:00:00Z. Music identifier demo:last-bus-home is explicitly simulated.

Still required: refresh/sign in for approval on the NEW contract, manual participant funding for 75 plus fees (last checked 20), at least 2.5 reserve funding on the NEW contract before the 50 option, and real Privy-signed 5/20/50 purchases with receipt/entry/history verification. Step 3 is not complete. QuickNode remains Step 4.


The real Privy participant was automatically approved on the NEW atomic contract after the app restart. Independent database/receipt checks confirm approved=true and confirmed transaction 0x1d679a96427ea34a2d8287ed30d3c0c1800642133d9d2d2e1110c0494407d88b at block 73102042, receipt success. Participant balance remains 20 native test USDC; new-contract bonus reserve remains zero. No new participant funding or prediction payment has occurred yet. Next: manual reserve/participant funding and real purchase tests once round 1 opens at 7 PM CT.


Reserve funding confirmed on the new atomic contract: 2.5 native test USDC, transaction 0x000cf108acff0a8da53f90697574580eba63df502b5860ba54bb84875901fbec at block 73102587. Read-only verification confirms bonusReserveBalance=freeBonusReserve=2.5, isSolvent=true, and the Privy participant remains approved. Participant currently holds 20; original MetaMask holds approximately 56.074 test USDC. Manual participant funding is still required for all three entry tests (75 plus network fees). No participant purchase has been sent. Round 1 remains scheduled for 7 PM CT on November 19.


Participant manual funding is complete for the three price tests: independently verified balance 76 native test USDC, approved=true, and free contract reserve 2.5 at 6:30 PM CT on November 19. Round 1 has zero entries and opens at 7 PM CT, closing at 8 PM. No participant prediction payment has been made. Next: user-authorized real Privy $5 purchase in Last Bus Home round 1, followed by atomic $20 and $50, with receipt/history/reload verification.


## Step 4 checkpoint — live event collection verified, November 19, 2026

The user deployed `music-quicknode-events` in the existing Supabase project,
turned gateway JWT verification off for the signed webhook, installed migration
003 with RLS enabled, saved the private Stream security token in Supabase, and
confirmed QuickNode is Active. Real historical delivery stored four atomic
contract events: ownership, wallet approval, round creation and reserve funding.
All four were independently matched to successful receipts. Full reconciliation
and a replay through block 73114615 found 4 chain events / 4 stored events,
0 missing, 0 conflicts, 0 extra and 0 newly inserted records. Delivery retries and
operator backfills use shared durable SQL deduplication. The local check/backfill
commands and outage/conflict tests are installed; see QUICKNODE-SETUP.md.

Step 4 event collection and recovery are complete for this deployment. The local
backend's RPC endpoint remains the public Arc endpoint; QuickNode is used for
Streams event delivery. Step 5 indexed-data frontend integration has not started.
Step 3 real $5/$20/$50 user purchases remain unverified. Round 1 closed at 8 PM
Central Time; any later payment tests need a new future hourly round. No new
round or participant payment was submitted by the Step 4 checks. No GitHub push,
frontend hosting change, real music feed or team-code integration was performed.


## Frontend design sharing — November 19, 2026

The user explicitly authorized pushing the original frontend to a separate
`frontend-design` branch in the existing team repository,
https://github.com/owhitleym-ui/music-onchain. The branch was pushed and its head
verified as 97586e0d115f764a8c6fae24d1f807b16a02c160. This new authorization is for
the frontend design handoff; backend/private settings and hosting are not part
of it. The original app remains in /Users/tj/Desktop/Hachathon and is unchanged.

The branch adds `frontend/` and `.github/workflows/frontend-design.yml` only.
Existing `apps/web/`, contracts and main were not modified. Login/payment code
and pinned dependencies match the original. The snapshot adds design handoff
instructions, agent scope instructions and a guard for 31 integration/config/test
files. A simulated login-file edit was rejected. All 109 frontend tests and a
production build passed with a fresh dependency installation. A staged-content
scan against the three configured server secrets and common credential formats
passed. Private env files, dependencies and generated builds are excluded.

Persistent checkout for reviewing and integrating the friend's work:
/Users/tj/Desktop/Hachathon/_publish/frontend-design (already ignored by the
original project's .gitignore). Friend instructions are in frontend/DESIGN-HANDOFF.md
on that branch: start from frontend-design, create design/visual-refresh, and
open a pull request targeting frontend-design. They should improve presentation
without changing authentication, approval, wallet signing, API calls, price rules,
payment recovery, protected tests or deployment settings. Guard/CI checks aid
review; they do not guarantee future UI changes preserve every behavior.

Do not copy the whole shared checkout over the original app. Compare future
design edits against the baseline commit above, preserve subsequent live-data
changes, run checks and perform account/payment acceptance before integration.
Step 5 has not started; real Step 3 payments are still pending.
