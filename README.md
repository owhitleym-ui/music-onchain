# music-onchain (working name)

Fans predict how many views a song gets. Closer guesses win, the top half is paid on a curve,
losing entries only lose part of their stake, and every entry pays the artist. Runs on Arc
testnet with test USDC only: no real money.

## Layout

- `frontend/`: consumer app (Vite + React, Privy email login with embedded wallets). See
  `frontend/README.md` and `frontend/DESIGN-HANDOFF.md`.
- Backend API (`/api/...`): not in this repo yet. The frontend expects it at `/api`
  (proxied to `127.0.0.1:3001` in local development).

## Run locally

Requires Node 22.12 or newer.

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev     # http://localhost:3000
```

## Deploy (Vercel)

- Root Directory: `frontend` (framework: Vite, output: `dist`)
- Environment variable: `VITE_PRIVY_APP_ID` (public Privy App ID)

## Rules

- Never commit `.env` files or private keys.
- Work on branches and open pull requests into `main`.

## License

MIT
