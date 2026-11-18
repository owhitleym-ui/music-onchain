# music-onchain (working name)

Fans prove they found small artists early, lenders fund artist advances, and a contract splits USDC royalties and shuts itself off when the advance is repaid. Crypto is invisible to users. Hackathon prototype, testnet only, not financial advice.

## Music prediction frontend

The interactive music prediction demo is in [frontend](frontend/README.md). It includes Discover, Support Artist, My Purchases, sample results, and simulated USDC purchases.

Run it locally from the repository root.

```sh
python3 -m http.server 5173 --bind 127.0.0.1 --directory frontend
```

Open http://127.0.0.1:5173/.

## Layout

- `apps/web` — Next.js app deployed on Vercel, root directory `apps/web`
- `contracts/` — Foundry Solidity project, not yet added
- `docs/` — notes

## Setup

```
cd apps/web && npm install && npm run dev
```

## Rules

- Never commit `.env` or private keys.
- Work on branches and open pull requests once the team has cloned.
- Product name will live in one config file.

## License

MIT
