import test from 'node:test';
import assert from 'node:assert/strict';
import { SPOT_PRICE_CENTS, BUNDLE_PRICE_CENTS, BUNDLE_SPOTS, BUNDLE_MULTIPLIER, ENTRY_PRICES_CENTS } from '../pricing.js';
import { currentRoundStart } from '../data.js';

const KEY = 'music-prediction-demo-v1';
const WALLET_KEY = 'music-prediction-wallet-v1';
const NOW = Date.parse('2026-11-18T18:12:00Z');
let imports = 0;
const clone = value => JSON.parse(JSON.stringify(value));

function storage(saved = new Map()) {
  return { saved, writes: 0, getItem(key) { return saved.get(key) ?? null; }, setItem(key, value) { this.writes++; saved.set(key, value); } };
}

async function withStore(localStorage, action) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, writable: true, configurable: true });
  try {
    const store = await import(`../store.js?pricing-test=${++imports}`);
    await action(store);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

function legacyState(store) {
  const state = store.createInitialState(NOW);
  state.version = 1;
  state.theme = 'dark';
  state.follows = ['maroon-5', 'maya-lane'];
  state.balanceCents = 87450;
  const oldAmounts = [
    [10000, 10000, 500, 210, 0, 0, 20290, 500],
    [1000, 695, 0, 14, 0, 0, 1681, 0],
    [1000, 300, 0, 6, 6, 0, 1288, 0],
    [1000, 0, 0, 0, 0, 200, 800, 0],
    [1000, 0, 0, 0, 0, 0, 1000, 0],
  ];
  state.purchases.forEach((purchase, index) => {
    const [cost, base, bonus, artist, app, loss, returned, reserve] = oldAmounts[index];
    purchase.costCents = cost;
    Object.assign(purchase.result, { baseWinningsCents: base, bonusCents: bonus, artistFeeCents: artist, appFeeCents: app, lossCents: loss, returnedCents: returned, appContributionCents: reserve });
  });
  const pending = clone(state.purchases[1]);
  pending.id = 'legacy-pending';
  pending.status = 'pending';
  pending.guess = 12345;
  delete pending.result;
  state.purchases.push(pending);
  return state;
}

test('entry pricing and browser demo compatibility', async t => {
  await t.test('one spot costs 5 and the ten-spot bundle costs 50 USDC', () => {
    assert.equal(SPOT_PRICE_CENTS, 500);
    assert.equal(BUNDLE_PRICE_CENTS, 5000);
    assert.equal(BUNDLE_PRICE_CENTS, SPOT_PRICE_CENTS * BUNDLE_SPOTS);
    assert.equal(BUNDLE_SPOTS, 10);
    assert.equal(BUNDLE_MULTIPLIER, 1.05);
    assert.deepEqual(ENTRY_PRICES_CENTS, [500, 2000, 5000]);
  });

  await t.test('fresh samples reconcile the new bundle and fee amounts', async () => {
    await withStore(storage(), store => {
      const state = store.createInitialState(NOW);
      assert.equal(state.version, 2);
      assert.equal(state.purchases[0].costCents, 5000);
      assert.equal(state.purchases[0].spots, 10);
      assert.equal(state.purchases[0].result.returnedCents, 10145);
      assert.equal(state.purchases[0].result.artistFeeCents, 105);
      assert.equal(state.purchases[0].result.appFeeCents, 0);
      assert.equal(state.purchases[0].result.appContributionCents, 250);
      assert.equal(store.getPortfolio(state).netProfitCents, 5530);
      for (const purchase of state.purchases) {
        const result = purchase.result;
        assert.equal(result.returnedCents, purchase.costCents + result.baseWinningsCents + result.bonusCents - result.lossCents - result.artistFeeCents - result.appFeeCents);
      }
    });
  });

  await t.test('v1 migration preserves records and wallet preferences while repricing once', async () => {
    const local = storage(new Map([[WALLET_KEY, 'true']]));
    await withStore(local, store => {
      const old = legacyState(store);
      local.saved.set(KEY, JSON.stringify(old));
      const migrated = store.loadState();
      assert.equal(migrated.version, 2);
      assert.equal(migrated.balanceCents, old.balanceCents);
      assert.equal(migrated.theme, old.theme);
      assert.deepEqual(migrated.follows, old.follows);
      for (let i = 0; i < old.purchases.length; i++) {
        for (const key of ['id', 'songId', 'horizon', 'roundStart', 'purchasedAt', 'guess', 'spots', 'multiplier', 'status']) {
          assert.equal(migrated.purchases[i][key], old.purchases[i][key]);
        }
        assert.equal(migrated.purchases[i].costCents, old.purchases[i].costCents / 2);
      }
      assert.deepEqual(migrated.purchases[0].result, store.createInitialState(NOW).purchases[0].result);
      assert.equal(migrated.purchases[1].result.baseWinningsCents, 348, 'half cents round up in demo samples');
      assert.equal(migrated.purchases[1].result.artistFeeCents, 7);
      assert.equal(migrated.purchases[1].result.returnedCents, 841);
      assert.equal(migrated.purchases[2].result.appFeeCents, 3);
      assert.equal(migrated.purchases.at(-1).result, undefined);
      assert.equal(local.saved.get(WALLET_KEY), 'true');
      assert.equal(JSON.parse(local.saved.get(KEY)).version, 2);
      assert.equal(local.writes, 1);
      assert.deepEqual(store.loadState(), migrated);
      assert.equal(local.writes, 1, 'an already migrated load must not reprice or write again');
    });
    await withStore(local, store => {
      assert.equal(store.loadState().purchases[0].costCents, 5000, 'a simulated page reload preserves new prices');
      assert.equal(local.writes, 1);
    });
  });

  await t.test('invalid legacy records are rejected before repricing', async () => {
    for (const corrupt of [
      value => { value.purchases[0].costCents = 7500; },
      value => { value.purchases[1].result.returnedCents += 1; },
      value => { value.purchases[1].guess = -1; },
      value => { value.purchases[1].id = value.purchases[0].id; },
      value => { value.purchases[0].spots = 1; },
      value => { value.version = 99; },
    ]) {
      const local = storage();
      await withStore(local, store => {
        const old = legacyState(store);
        corrupt(old);
        local.saved.set(KEY, JSON.stringify(old));
        const loaded = store.loadState();
        assert.equal(loaded.version, 2);
        assert.equal(loaded.purchases.length, 5);
        assert.equal(loaded.theme, 'light');
        assert.equal(local.writes, 0, 'malformed data should not be persisted as a migration');
      });
    }
  });

  await t.test('invalid JSON and unavailable storage use valid new-price samples', async () => {
    for (const local of [storage(new Map([[KEY, '{invalid json']])), { getItem() { throw Error('Storage denied'); }, setItem() { throw Error('Storage denied'); } }]) {
      await withStore(local, store => {
        const loaded = store.loadState();
        assert.equal(loaded.version, 2);
        assert.equal(loaded.purchases[0].costCents, 5000);
        assert.equal(store.getPortfolio(loaded).netProfitCents, 5530);
        store.setTheme(loaded, 'dark');
        assert.equal(store.loadState().theme, 'dark', 'memory fallback remains usable');
      });
    }
  });

  await t.test('failed migration persistence still keeps the migrated state in memory', async () => {
    const local = storage();
    await withStore(local, store => {
      local.saved.set(KEY, JSON.stringify(legacyState(store)));
      local.setItem = () => { throw Error('Quota exceeded'); };
      const migrated = store.loadState();
      assert.equal(migrated.version, 2);
      assert.equal(migrated.purchases[0].costCents, 5000);
      local.getItem = () => { throw Error('Storage unavailable'); };
      assert.deepEqual(store.loadState(), migrated);
    });
  });

  await t.test('crowd totals use 5-USDC spots and a bundle counts as ten guesses', async () => {
    await withStore(storage(), store => {
      const state = store.createInitialState(NOW);
      const roundStart = currentRoundStart(NOW);
      const before = store.getRoundSummary(state, 'animals', roundStart, '24h');
      state.purchases.push({ id: 'bundle-stat-check', songId: 'animals', roundStart, horizon: '24h', purchasedAt: roundStart + 1, guess: 123456, costCents: BUNDLE_PRICE_CENTS, spots: BUNDLE_SPOTS, multiplier: BUNDLE_MULTIPLIER, status: 'pending' });
      const after = store.getRoundSummary(state, 'animals', roundStart, '24h');
      assert.equal(after.spotCount, before.spotCount + 10);
      assert.equal(after.totalEnteredCents, before.totalEnteredCents + 5000);
      assert.equal(after.totalEnteredCents, after.spotCount * 500);
      assert.ok(Math.abs(after.average - (before.average * before.spotCount + 123456 * 10) / after.spotCount) < 1e-9);
      assert.equal(after.peopleCount, before.peopleCount + 1);
    });
  });

  await t.test('new prices do not enable purchases or mutate demo balances', async () => {
    await withStore(storage(), store => {
      const state = store.createInitialState(NOW);
      const before = clone(state);
      for (const costCents of ENTRY_PRICES_CENTS) assert.throws(() => store.buyPrediction(state, { costCents }), { message: store.PURCHASES_PAUSED });
      assert.deepEqual(state, before);
    });
  });
});
