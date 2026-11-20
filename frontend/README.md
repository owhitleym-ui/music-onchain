# Music predictions — frontend design branch

This folder contains the original consumer app for the music-prediction project.
Use this frontend for the design handoff; the team app in `apps/web/` stays separate.

Start with [DESIGN-HANDOFF.md](DESIGN-HANDOFF.md) for the design scope, protected
login/payment behavior, local setup and pull-request instructions.

## Run

Requires Node 22.12 or newer.

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The example file contains a public Privy App ID only.
Visual work uses the existing sample screens. Actual approval, account history
and payments need the owner's separate local backend; never fake those states.

## Verify before submitting

```sh
npm run check:design
npm test
npm run build
```

Open your design pull request with **base: frontend-design**. Preserve the
current login, wallet, approval and payment modules. All consumer funds are
clearly labeled test/demo dollars. Real $5/$20/$50 on-chain checkout acceptance
remains a separate owner-run verification step.
