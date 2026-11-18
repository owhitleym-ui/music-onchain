# Contracts

The design is described in `docs/ARCHITECTURE.md`.

## Setup

```bash
# 1. Foundry (stock, for unit tests)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# 2. forge-std (lib/ is gitignored, so everyone installs it locally)
cd contracts
forge install foundry-rs/forge-std --no-git

# 3. Build and test
forge build
forge test -vv
```

Arc publishes **Arc Foundry** (`arc-forge`, `arc-cast`, `arc-anvil`), a fork of Foundry that reproduces Arc-specific behavior. Download it from https://github.com/circlefin/arc-foundry/releases. Use it for the final check (`arc-anvil --network arc`) and for deployment. Stock `forge test` is fine for the logic tests.

## Deploy to Arc testnet

1. Create a test key with `cast wallet new`. Use test keys only.
2. Fund it with USDC from https://faucet.circle.com (select Arc Testnet). On Arc, USDC is also the gas token.
3. Set the following in the repo-root `.env` (never commit it):
   ```
   ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.io
   DEPLOYER_PRIVATE_KEY=0x...
   ORACLE_ADDRESS=0x...
   ```
4. Deploy:
   ```bash
   source ../.env
   forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
   ```
   Copy the two printed addresses into `.env`.
5. Seed the demo songs and competitions (set `ARTIST_ADDRESS` and, optionally, `WINDOW_SECONDS` first):
   ```bash
   forge script script/Seed.s.sol --rpc-url arc_testnet --broadcast
   ```
6. Verify on the explorer (optional):
   ```bash
   forge verify-contract <ADDRESS> src/Competition.sol:Competition \
     --chain-id 5042002 --verifier blockscout \
     --verifier-url https://explorer.testnet.arc.io/api/
   ```
7. Export the ABIs for the frontend from `out/Competition.sol/Competition.json` and `out/SongRegistry.sol/SongRegistry.json`, using the `abi` field.
