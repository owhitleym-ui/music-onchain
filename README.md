# AmpRamp

Full project snapshot, including Step 5 live contest data integration. Arc Testnet prototype using test funds. Real two-account purchases and payout acceptance remain pending.

## Layout

- `frontend/`: consumer app, email login, payments, live contest totals and private history.
- `backend/`: authenticated APIs, account approval, payment processing, live reads and tests.
- `contracts/`: Solidity source, ABI, deployment records, tooling and tests.
- `supabase/`: QuickNode event receiver. Database migrations are in `backend/supabase/`.
- `remix/`: deployment sources and verification artifacts.

## Run locally

Requires Node 22.12 or newer.

```sh
npm --prefix backend ci
npm --prefix frontend ci
cp backend/.env.example backend/.env.local
cp frontend/.env.example frontend/.env.local
# Configure private backend credentials locally, then:
npm run dev
```

Open http://localhost:3000/. Backend listens on 127.0.0.1:3001. Apply database migrations in order when setting up a new database. Credentials, installed dependencies, generated build output and local backups are excluded from Git.

See [project notes](docs/music-prediction-project.md), [roadmap](PROJECT-ROADMAP.md), [backend verification](backend/VERIFICATION.md), [frontend verification](frontend/VERIFICATION.md), and [QuickNode setup](QUICKNODE-SETUP.md). The separate `frontend-design` branch remains the design collaboration baseline; review functional integration before merging design changes.
