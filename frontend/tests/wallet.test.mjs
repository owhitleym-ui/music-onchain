import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const ARC = '0x4cef52';
const A = `0x${'1'.repeat(40)}`;
const B = `0x${'2'.repeat(40)}`;
const UNIT = 10n ** 18n;
const PREFERENCE = 'music-prediction-wallet-v1';
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let importNumber = 0;

class FakeProvider extends EventEmitter {
  isMetaMask = true;
  accounts = [A];
  chain = ARC;
  balance = 20n * UNIT;
  knownNetwork = true;
  calls = [];
  overrides = {};

  async request(request) {
    const { method, params } = request;
    this.calls.push(request);
    if (this.overrides[method]) return this.overrides[method](params);
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return this.accounts;
    if (method === 'eth_chainId') return this.chain;
    if (method === 'eth_getBalance') return `0x${this.balance.toString(16)}`;
    if (method === 'wallet_addEthereumChain') { this.knownNetwork = true; return null; }
    if (method === 'wallet_switchEthereumChain') {
      if (!this.knownNetwork) throw Object.assign(new Error('Unknown chain'), { code: 4902 });
      this.chain = params[0].chainId;
      this.emit('chainChanged', this.chain);
      return null;
    }
    throw new Error(`Unexpected wallet request: ${method}`);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate, message = 'Wallet state did not settle') {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => realSetTimeout(resolve, 1));
  }
  assert.fail(message);
}

async function environment({ provider = new FakeProvider(), eip6963 = false, remember = false } = {}) {
  const names = ['window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new EventTarget();
  const document = new EventTarget();
  document.hidden = false;
  const saved = new Map(remember ? [[PREFERENCE, 'true']] : []);
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const timeouts = new Set();
  const intervals = [];
  if (provider && !eip6963) window.ethereum = provider;
  if (provider && eip6963) {
    window.addEventListener('eip6963:requestProvider', () => {
      const event = new Event('eip6963:announceProvider');
      event.detail = { info: { rdns: 'io.metamask', name: 'MetaMask', uuid: 'test-provider' }, provider };
      window.dispatchEvent(event);
    });
  }
  globalThis.window = window;
  globalThis.document = document;
  globalThis.localStorage = window.localStorage = storage;
  globalThis.setTimeout = (fn, delay, ...args) => {
    const timer = realSetTimeout(() => { timeouts.delete(timer); fn(...args); }, delay);
    timeouts.add(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => { timeouts.delete(timer); realClearTimeout(timer); };
  // Interval callbacks can be triggered deterministically without waiting 30 seconds.
  globalThis.setInterval = (fn, delay) => { const timer = { fn, delay, unref() {} }; intervals.push(timer); return timer; };
  globalThis.clearInterval = () => {};
  const module = await import(`../wallet.js?wallet-test=${++importNumber}`);
  module.wallet.init();
  return {
    ...module, provider, window, document, saved, intervals,
    cleanup() {
      module.wallet.disconnect();
      for (const timer of timeouts) realClearTimeout(timer);
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

async function scenario(options, run) {
  const env = await environment(options);
  try {
    await run(env);
    if (env.provider) assert.equal(env.provider.calls.some(({ method }) => /send|sign|approve/i.test(method)), false, 'Read-only connection requested a payment or signature');
  } finally { env.cleanup(); }
}

test('wallet connection and balance behavior', async t => {
  await t.test('legacy discovery connects only after an explicit request', () => scenario({}, async ({ wallet, provider, saved }) => {
    assert.equal(wallet.getState().available, true);
    assert.equal(provider.calls.length, 0);
    await wallet.connect();
    assert.equal(wallet.getState().status, 'connected');
    assert.equal(wallet.getState().address, A);
    assert.equal(wallet.getState().chainId, ARC);
    assert.equal(wallet.getState().balance, 20n * UNIT);
    assert.equal(wallet.getState().busy, null);
    assert.equal(saved.get(PREFERENCE), 'true');
    assert.deepEqual([...saved.keys()], [PREFERENCE], 'Only a connection preference should be saved');
    assert.equal(provider.calls.filter(call => call.method === 'eth_requestAccounts').length, 1);
  }));

  await t.test('EIP-6963 selects MetaMask even when a different wallet is injected', () => scenario({ eip6963: true }, async ({ wallet, window, provider }) => {
    window.ethereum = { isMetaMask: false, request() { throw new Error('Wrong wallet selected'); } };
    await wallet.connect();
    assert.equal(wallet.getState().address, A);
    assert.equal(provider.calls[0].method, 'eth_requestAccounts');
  }));

  await t.test('missing MetaMask leaves a useful disconnected state', () => scenario({ provider: null }, async ({ wallet }) => {
    await wallet.connect();
    assert.equal(wallet.getState().available, false);
    assert.equal(wallet.getState().status, 'disconnected');
    assert.match(wallet.getState().error, /not found|installed/i);
  }));

  for (const code of [4001, -32002]) {
    await t.test(`connection error ${code} supports a later retry`, () => scenario({}, async ({ wallet, provider }) => {
      provider.overrides.eth_requestAccounts = () => { throw { code }; };
      await wallet.connect();
      assert.equal(wallet.getState().status, 'disconnected');
      assert.equal(wallet.getState().balance, null);
      assert.match(wallet.getState().error, code === 4001 ? /cancelled/i : /already open/i);
      delete provider.overrides.eth_requestAccounts;
      await wallet.connect();
      assert.equal(wallet.getState().balance, 20n * UNIT);
    }));
  }

  await t.test('duplicate connect clicks create just one approval request', () => scenario({}, async ({ wallet, provider }) => {
    const approval = deferred();
    provider.overrides.eth_requestAccounts = () => approval.promise;
    const first = wallet.connect();
    assert.equal(wallet.getState().status, 'connecting');
    await wallet.connect();
    assert.equal(provider.calls.filter(call => call.method === 'eth_requestAccounts').length, 1);
    approval.resolve([A]);
    await first;
    assert.equal(wallet.getState().balance, 20n * UNIT);
  }));

  await t.test('other networks withhold balance until an explicit switch', () => scenario({}, async ({ wallet, provider }) => {
    provider.chain = '0x1';
    await wallet.connect();
    assert.equal(wallet.getState().balance, null);
    assert.equal(provider.calls.some(call => call.method === 'eth_getBalance'), false);
    assert.equal(provider.calls.some(call => call.method === 'wallet_switchEthereumChain'), false);
    await wallet.switchToArc();
    assert.equal(wallet.getState().chainId, ARC);
    assert.equal(wallet.getState().balance, 20n * UNIT);
  }));

  await t.test('unknown Arc network is added with native USDC then selected', () => scenario({}, async ({ wallet, provider }) => {
    provider.chain = '0x1';
    provider.knownNetwork = false;
    await wallet.connect();
    await wallet.switchToArc();
    const config = provider.calls.find(call => call.method === 'wallet_addEthereumChain').params[0];
    assert.equal(config.chainId, ARC);
    assert.equal(config.nativeCurrency.symbol, 'USDC');
    assert.equal(config.nativeCurrency.decimals, 18);
    assert.deepEqual(config.rpcUrls, ['https://rpc.testnet.arc.io']);
    assert.equal(wallet.getState().balance, 20n * UNIT);
  }));

  await t.test('rejected network switch preserves accurate network and permits retry', () => scenario({}, async ({ wallet, provider }) => {
    provider.chain = '0x1';
    await wallet.connect();
    provider.overrides.wallet_switchEthereumChain = () => { throw { code: 4001 }; };
    await wallet.switchToArc();
    assert.equal(wallet.getState().chainId, '0x1');
    assert.equal(wallet.getState().balance, null);
    assert.match(wallet.getState().error, /cancelled/i);
    delete provider.overrides.wallet_switchEthereumChain;
    await wallet.switchToArc();
    assert.equal(wallet.getState().balance, 20n * UNIT);
  }));

  await t.test('zero balance is ready; a failed read is unavailable and retry recovers', () => scenario({}, async ({ wallet, provider }) => {
    provider.balance = 0n;
    await wallet.connect();
    assert.equal(wallet.getState().balanceStatus, 'ready');
    assert.equal(wallet.getState().balance, 0n);
    provider.overrides.eth_getBalance = () => { throw new Error('RPC unavailable'); };
    await wallet.refresh();
    assert.equal(wallet.getState().balanceStatus, 'error');
    assert.equal(wallet.getState().balance, null);
    delete provider.overrides.eth_getBalance;
    await wallet.refresh();
    assert.equal(wallet.getState().balanceStatus, 'ready');
  }));

  await t.test('account change removes old balance and ignores its delayed response', () => scenario({}, async ({ wallet, provider }) => {
    await wallet.connect();
    const stale = deferred();
    provider.overrides.eth_getBalance = ([address]) => address === A ? stale.promise : `0x${(7n * UNIT).toString(16)}`;
    const pendingRead = wallet.refresh();
    await until(() => provider.calls.filter(call => call.method === 'eth_getBalance').length === 2);
    provider.accounts = [B];
    provider.emit('accountsChanged', [B]);
    assert.equal(wallet.getState().address, B);
    assert.equal(wallet.getState().balance, null);
    await until(() => wallet.getState().balance === 7n * UNIT);
    stale.resolve(`0x${(20n * UNIT).toString(16)}`);
    await pendingRead;
    assert.equal(wallet.getState().address, B);
    assert.equal(wallet.getState().balance, 7n * UNIT);
  }));

  await t.test('network change removes an in-flight Arc balance', () => scenario({}, async ({ wallet, provider }) => {
    await wallet.connect();
    const stale = deferred();
    provider.overrides.eth_getBalance = () => stale.promise;
    const pendingRead = wallet.refresh();
    await until(() => provider.calls.filter(call => call.method === 'eth_getBalance').length === 2);
    provider.chain = '0x1';
    provider.emit('chainChanged', '0x1');
    assert.equal(wallet.getState().balance, null);
    stale.resolve(`0x${(20n * UNIT).toString(16)}`);
    await pendingRead;
    await until(() => wallet.getState().busy === null);
    assert.equal(wallet.getState().chainId, '0x1');
    assert.equal(wallet.getState().balance, null);
  }));

  await t.test('disconnect ignores an in-flight balance response and remembers the choice', () => scenario({}, async ({ wallet, provider, saved }) => {
    await wallet.connect();
    const stale = deferred();
    provider.overrides.eth_getBalance = () => stale.promise;
    const pendingRead = wallet.refresh();
    await until(() => provider.calls.filter(call => call.method === 'eth_getBalance').length === 2);
    wallet.disconnect();
    stale.resolve(`0x${(20n * UNIT).toString(16)}`);
    await pendingRead;
    assert.equal(wallet.getState().status, 'disconnected');
    assert.equal(wallet.getState().address, null);
    assert.equal(wallet.getState().balance, null);
    assert.equal(saved.get(PREFERENCE), 'false');
    assert.equal(provider.calls.some(call => call.method === 'wallet_revokePermissions'), false);
    provider.emit('accountsChanged', [B]);
    assert.equal(wallet.getState().address, null, 'Wallet events must not reconnect after an app disconnect');
  }));

  await t.test('disconnect during approval prevents its late completion from reconnecting', () => scenario({}, async ({ wallet, provider, saved }) => {
    const approval = deferred();
    provider.overrides.eth_requestAccounts = () => approval.promise;
    const connecting = wallet.connect();
    wallet.disconnect();
    approval.resolve([A]);
    await connecting;
    assert.equal(wallet.getState().status, 'disconnected');
    assert.equal(wallet.getState().address, null);
    assert.equal(wallet.getState().balance, null);
    assert.equal(saved.get(PREFERENCE), 'false');
  }));

  await t.test('remembered connection restores silently without approval', () => scenario({ remember: true }, async ({ wallet, provider }) => {
    await until(() => wallet.getState().balanceStatus === 'ready');
    assert.equal(wallet.getState().balance, 20n * UNIT);
    assert.equal(provider.calls.some(call => call.method === 'eth_requestAccounts'), false);
  }));

  await t.test('revoked permissions cannot be restored from a remembered preference', () => {
    const provider = new FakeProvider();
    provider.accounts = [];
    return scenario({ provider, remember: true }, async ({ wallet, provider }) => {
      await until(() => wallet.getState().busy === null);
      assert.equal(wallet.getState().status, 'disconnected');
      assert.equal(wallet.getState().balance, null);
      assert.equal(provider.calls.some(call => call.method === 'eth_requestAccounts'), false);
    });
  });

  await t.test('visible open panel polls and tab focus refreshes', () => scenario({}, async ({ wallet, provider, window, document, intervals }) => {
    await wallet.connect();
    wallet.setPanelOpen(true);
    await until(() => wallet.getState().busy === null);
    provider.balance = 19n * UNIT;
    const timer = intervals.find(interval => interval.delay === 30000);
    assert.ok(timer);
    timer.fn();
    await until(() => wallet.getState().balance === 19n * UNIT);
    document.hidden = true;
    provider.balance = 18n * UNIT;
    timer.fn();
    assert.equal(wallet.getState().balance, 19n * UNIT);
    document.hidden = false;
    window.dispatchEvent(new Event('focus'));
    await until(() => wallet.getState().balance === 18n * UNIT);
    wallet.setPanelOpen(false);
    provider.balance = 17n * UNIT;
    timer.fn();
    assert.equal(wallet.getState().balance, 18n * UNIT);
    document.dispatchEvent(new Event('visibilitychange'));
    await until(() => wallet.getState().balance === 17n * UNIT);
  }));

  await t.test('native values retain integer precision and display up to six decimals', () => scenario({}, async ({ formatUSDC }) => {
    assert.equal(formatUSDC(20n * UNIT), '20 USDC');
    assert.equal(formatUSDC(0n), '0 USDC');
    assert.equal(formatUSDC(20123456789123456789n), '20.123456 USDC');
    assert.equal(formatUSDC(1000000000000n), '0.000001 USDC');
    assert.equal(formatUSDC(1234567890123456789n * UNIT), '1,234,567,890,123,456,789 USDC');
  }));
});

test('paused purchases cannot mutate the existing sample state', async () => {
  const { createInitialState, buyPrediction, PURCHASES_PAUSED } = await import('../store.js');
  const state = createInitialState();
  const before = structuredClone(state);
  assert.throws(() => buyPrediction(state, { costCents: 500 }), { message: PURCHASES_PAUSED });
  assert.deepEqual(state, before);
});
