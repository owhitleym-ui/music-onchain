# Project Plan

This is the execution plan for the hackathon build. Use it to keep scope, ownership, and decisions consistent. Contract interfaces, fee amounts, and exact data shapes go in `SPEC.md` (to be created, see §2). If this plan and `SPEC.md` disagree, update one of them so they match before writing code.

**Submission deadline:** Thursday night (Devpost).
**Strategy:** Build a small, complete, polished product rather than a large unfinished one.

---

## 0. Alignment with existing docs (resolved)

The earlier "picks + artist advances" concept has been replaced:
- `docs/ARCHITECTURE.md` is rewritten for prediction competitions.
- `.cursor/rules/project.mdc` now allows fixed entry fees and points to this plan.
- `.env.example` uses Arc testnet values plus `SONG_REGISTRY` / `COMPETITION` addresses.
- `README.md` still needs its rewrite (§7).

The team should still confirm this direction before merging into `main`.

---

## 1. Product scope (locked)

Build only the features needed to demonstrate the core experience.

### 01. Song discovery
- Display **three preloaded songs**.
- For each song, show the artist, prediction metric, competition window, and prize pool.
- Users can select a competition.

### 02. Prediction entry
- Email login through **Privy**.
- Embedded wallet creation, with no seed phrase.
- Test USDC faucet.
- Submit a prediction for a fixed fee.
- Confirmation that the entry was recorded.

### 03. Leaderboard and rankings
- Display participant predictions.
- Rank entries by accuracy after settlement.
- Show each participant's position and payout.
- Update the leaderboard through **QuickNode Streams**.

### 04. Settlement and artist earnings
- An admin submits the final metric.
- The smart contract calculates rankings.
- The contract distributes winner payouts and the artist share.
- Display artist earnings (optional, see Cut list §9).

### Carried-over UX rules (still apply)
- Hide crypto in the UI: show dollars, never raw addresses or gas.
- The product name lives in **one place only**: `apps/web/brand.config.ts`.
- Testnet only. Label the product as a prototype.

---

## 2. Technical foundation

Set up one shared specification before building features, so Cursor and Claude don't produce pieces that don't fit together.

- [ ] Finalize the product name and branding, and record them in `apps/web/brand.config.ts`.
- [ ] Create `SPEC.md` with feature requirements, contract interfaces, fee structure, and application flow (see the open questions below).
- [ ] Export approved design screens into the repo (proposed: `docs/designs/`).
- [x] Set up the Next.js project and shared GitHub repo (`apps/web`, Next.js 16 App Router, React 19, Tailwind 4, TypeScript).
- [ ] Configure the Arc testnet, Foundry (`contracts/`, Solidity ^0.8.24), and test USDC. Base contracts exist; see `contracts/README.md`.
- [ ] Configure Privy authentication.
- [ ] Finalize the environment variables and `.env.example`.
- [ ] Confirm ownership of contracts, frontend, and backend (§8).

**Deliverable:** A working project foundation with agreed interfaces and a single source of truth for AI-assisted development.

### Stack and layout

| Area | Location | Tooling |
|---|---|---|
| Frontend + API routes | `apps/web` | Next.js App Router, TypeScript, Tailwind. Deployed on Vercel with root directory `apps/web` |
| Smart contracts | `contracts/` | Foundry, Solidity ^0.8.24 |
| Docs | `docs/`, root `SPEC.md` | Markdown |
| Chain | Arc testnet | Test USDC |
| Auth / wallets | Privy | Email login, embedded wallets |
| Events | QuickNode Streams | Webhook to the API route |

> This version of Next.js has breaking changes compared with older versions. Read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before writing frontend code.

### Environment variables (target)

Never hardcode keys or addresses. Read everything from env. Use test keys only.

```
# Chain
CHAIN_RPC_URL=
CHAIN_ID=
NEXT_PUBLIC_CHAIN_RPC_URL=
NEXT_PUBLIC_CHAIN_ID=
NEXT_PUBLIC_EXPLORER_URL=

# Keys (TEST KEYS ONLY)
DEPLOYER_PRIVATE_KEY=
ORACLE_PRIVATE_KEY=

# Deployed addresses
NEXT_PUBLIC_USDC_ADDRESS=
NEXT_PUBLIC_SONG_REGISTRY_ADDRESS=
NEXT_PUBLIC_COMPETITION_ADDRESS=

# Services
NEXT_PUBLIC_PRIVY_APP_ID=
QUICKNODE_STREAMS_WEBHOOK_SECRET=
ADMIN_SECRET=                           # proposed: protects the admin result route
CRON_SECRET=
YOUTUBE_API_KEY=                        # optional, automated metric is on the cut list
LASTFM_API_KEY=                         # optional
```

### Open questions to settle in SPEC.md
These need answers before contract work starts. Don't guess them in code.
- Product name.
- Prediction metric for each song (for example, YouTube views at window close) and its units.
- Entry fee amount in USDC.
- Entry limits: maximum per wallet and maximum per competition.
- Minimum entries before a competition runs, and how refunds work below that.
- Prize split: the winners' share, the artist's share, and any platform share.
- Number of paid winners and the payout curve.
- Accuracy formula (absolute difference?) and how ties are broken (earliest entry?).
- How artist-affiliated wallets are identified and blocked.
- Competition window lengths, including the short window for the demo.
- Who the oracle and admin addresses are, and whether they are the same key.

---

## 3. Smart contracts (critical path)

**Owner:** Sean. **Tool:** Claude Code for Solidity and tests.

- [ ] `SongRegistry`: approved songs and artist payout addresses.
- [ ] `Competition`: fixed entry fees and entry limits.
- [ ] Prediction submission and storage.
- [ ] Final metric submission by the authorized oracle.
- [ ] Ranking by prediction accuracy.
- [ ] Winner payouts and artist revenue distribution.
- [ ] Refunds when the minimum number of entries isn't reached.
- [ ] Block artist-affiliated wallets from entering.
- [ ] Foundry tests written and passing, with **a test for every state change**.
- [ ] Deploy to the Arc testnet.
- [ ] Export ABIs and deployed addresses to the frontend.

Keep the contracts small. Emit events for entry, settlement, and payout, because QuickNode Streams (§5) depends on them.

**Deliverable:** Deployed contracts that support entry, settlement, ranking, and payouts.

---

## 4. Application (frontend)

**Owner:** Olive. **Tool:** Cursor, following the approved designs.

- [ ] Reusable UI components and navigation.
- [ ] Song discovery and competition pages.
- [ ] Prediction entry and confirmation.
- [ ] Privy email authentication and embedded wallets. **Verify the login screens end to end.**
- [ ] Test USDC faucet.
- [ ] Contract reads and writes against the deployed contracts.
- [ ] My Entries.
- [ ] Leaderboard and ranking displays.
- [ ] Artist earnings view (optional).
- [ ] Loading, success, and error states.
- [ ] Mobile-responsive layout (required by the definition of done).

**Deliverable:** A deployed app where users can log in, enter competitions, and view their entries.

---

## 5. Backend, oracle, and QuickNode

**Owner:** Person C.

Keep the oracle simple. The goal is reliable settlement, not complex data infrastructure.

- [ ] API route that submits the final competition metric.
- [ ] Admin-only result submission route.
- [ ] Settlement trigger and contract interaction.
- [ ] One QuickNode Stream for `Competition` contract events.
- [ ] Stream webhook connected to leaderboard updates, verified with `QUICKNODE_STREAMS_WEBHOOK_SECRET`.
- [ ] Check that contract events show up in the app.

**Deliverable:** A working settlement process and a leaderboard that updates live.

---

## 6. Integration and end-to-end testing (highest priority)

A feature isn't finished until it works with the others.

- [ ] Deploy the complete app to Vercel.
- [ ] Seed a demo competition with a short window.
- [ ] Prepopulate realistic participant entries.
- [ ] Test new-user login and wallet creation.
- [ ] Test receiving test USDC.
- [ ] Submit a prediction and verify it onchain.
- [ ] Submit the final metric and run settlement.
- [ ] Verify rankings and payout calculations.
- [ ] Verify the artist payment.
- [ ] Verify QuickNode leaderboard updates.
- [ ] Run the whole demo from a fresh user session **at least twice**.
- [ ] Fix critical bugs, then **freeze features**.

**Deliverable:** A repeatable end-to-end demo on the deployed app.

---

## 7. Submission materials

Start these early. Don't leave them for the last few hours.

- [ ] Rewrite `README.md` with:
  - [ ] Product overview and problem statement
  - [ ] Architecture and technology stack
  - [ ] How Arc is used
  - [ ] Contract addresses
  - [ ] QuickNode Stream configuration
  - [ ] Setup and deployment instructions
  - [ ] Security and anti-manipulation considerations
- [ ] Remove API keys, secrets, and private env files. Check the git history too, not just the current files.
- [ ] Make the GitHub repo public.
- [ ] Check that `.env.example` is complete.
- [ ] Record a 2–3 minute demo video (Olive).
- [ ] Prepare the Devpost description and written responses.
- [ ] Select the **Consumer Applications**, **Arc**, and **QuickNode** categories.
- [ ] Submit and check every attachment and link.

---

## 8. Team responsibilities

Keep ownership separate to avoid merge conflicts.

| Owner | Area | Main deliverables | Directories |
|---|---|---|---|
| Sean | Smart contracts | Solidity, tests, deployment, ABIs | `contracts/` |
| Olive | Frontend | UI, Privy, wallet integration, app screens, demo video, verified login screens | `apps/web/app`, `apps/web/components` |
| Person C (TBD) | Backend and submission | API, oracle, QuickNode, README | `apps/web/app/api`, `README.md` |

**Shared:**
- Agree on `SPEC.md` before implementation.
- Review interfaces before integrating components.
- Commit working changes often.
- Report blockers immediately.
- Test the complete app together.

### Git workflow
- `main` is the team branch. Work on personal or feature branches and merge through pull requests.
- Olive's personal branch is `olive-testing`. Bring in team changes with `git fetch && git merge origin/main`.
- Never commit `.env` or private keys.

---

## 9. Cut list

If time runs short, remove features **in this order**:

1. **Artist earnings page.** The contract still pays the artist; only the separate display goes.
2. **Automated YouTube metric retrieval.** Use the admin result-submission route instead.
3. **Advanced QuickNode functionality.** Prioritize one working Stream and webhook.
4. **UI complexity.** Use seeded data and simplify secondary screens.
5. **Optional animations and visual polish.** Keep usability and a consistent design.

**Never cut:**
- The deployed app
- Wallet login and prediction entry
- Smart contract settlement
- Correct payout calculations
- A repeatable demo

---

## 10. Definition of done

The project is ready to submit when all of these are true:

- [ ] A new user can sign in with email.
- [ ] A wallet is created without a seed phrase.
- [ ] The user can receive test USDC.
- [ ] The user can submit a prediction and see the recorded entry.
- [ ] The admin can submit the final metric.
- [ ] The contract calculates rankings and distributes payouts correctly.
- [ ] The artist receives the designated share.
- [ ] The leaderboard receives QuickNode event updates.
- [ ] The deployed app works on mobile.
- [ ] The README, public repo, and demo video are ready.
- [ ] The Devpost submission is complete.

---

## Working principles

1. **Build vertically, not horizontally.** Get one complete journey working (login → entry → settlement → payout) before polishing screens. A working flow is worth more than five polished screens that aren't connected.
2. **Keep AI coding tightly constrained.** Give Cursor and Claude the same `SPEC.md`. Keep each one inside its assigned directories. After each task, have it report the files it changed, the tests it ran, and any open issues.
3. **Protect integration time.** AI-generated contracts, APIs, and UI won't automatically fit together, so set aside real time for integration and testing.
4. **The artist earnings UI and automated YouTube metrics are not core.** The contract's artist payment and an admin-submitted metric are enough to demonstrate settlement.
