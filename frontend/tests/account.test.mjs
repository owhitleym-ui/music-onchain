import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, readAccountBalance } from '../account.js';
import { formatDollars, formatAccountDollars } from '../money.js';

const A = `0x${'a'.repeat(40)}`;
const B = `0x${'b'.repeat(40)}`;
const session = (address = A, userId = 'user-a', extra = {}) => ({ ready: true, authenticated: true, userId, email: `${userId}@example.com`, address, walletsReady: true, linkedWalletAddress: address, ...extra });
const signedOut = { ready: true, authenticated: false };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(t, options = {}) {
  const account = createAccount({ readBalance: async () => 20n * 10n ** 18n, ...options });
  const calls = { login: 0, logout: 0, create: 0 };
  const runtime = {
    login: async () => { calls.login++; },
    logout: async () => { calls.logout++; account.updateSession(signedOut); },
    ensureWallet: async () => { calls.create++; account.updateSession(session()); },
    getProvider: async () => ({ request: async () => [] }),
    getAccessToken: async () => 'sdk-managed-token',
  };
  account.attachRuntime(runtime);
  t.after(() => account.dispose());
  return { account, calls, runtime };
}

test('dollar formatting keeps integer precision, signs, cents, and rounding', () => {
  assert.equal(formatDollars(500), '$5');
  assert.equal(formatDollars(5000), '$50');
  assert.equal(formatDollars(105), '$1.05');
  assert.equal(formatDollars(-250), '−$2.50');
  assert.equal(formatAccountDollars(0n), '$0.00');
  assert.equal(formatAccountDollars(20n * 10n ** 18n), '$20.00');
  assert.equal(formatAccountDollars(1_005_000_000_000_000_000n), '$1.01');
  assert.equal(formatAccountDollars(12_345_678_901_234_567_890_000_000_000_000_000n), '$12,345,678,901,234,567.89');
  assert.throws(() => formatDollars(1.5), RangeError);
});

test('no configuration shows a genuine unavailable state, without a fake account', async t => {
  const { account } = fixture(t);
  account.setUnavailable();
  await account.signIn();
  assert.equal(account.getState().configured, false);
  assert.equal(account.getState().authenticated, false);
  assert.equal(account.getState().address, null);
  assert.match(account.getState().error, /not configured/);
});

test('sign-in waits for SDK readiness and repeated clicks do not open multiple dialogs', async t => {
  const { account, calls } = fixture(t);
  await account.signIn();
  assert.equal(calls.login, 0);
  account.updateSession(signedOut);
  await Promise.all([account.signIn(), account.signIn()]);
  assert.equal(calls.login, 1);
  assert.equal(account.getState().busy, 'login');
  account.updateSession(session());
  account.finishLogin();
  await tick();
  assert.equal(account.getState().email, 'user-a@example.com');
  assert.equal(account.getState().balance, 20n * 10n ** 18n);
  assert.equal(account.getState().busy, null);
});

test('cancelled login and rejected or expired email codes leave the account signed out and retryable', async t => {
  const { account, calls } = fixture(t);
  account.updateSession(signedOut);
  await account.signIn();
  account.failLogin('exited_auth_flow');
  assert.equal(account.getState().error, '');
  assert.equal(account.getState().authenticated, false);
  await account.signIn();
  account.failLogin('invalid_or_expired_code');
  assert.match(account.getState().error, /try again/);
  assert.equal(account.getState().busy, null);
  await account.signIn();
  assert.equal(calls.login, 3);
});

test('returning SDK session uses the original identity and address without creating a wallet', async t => {
  const first = fixture(t);
  first.account.updateSession(session());
  await tick();
  const restored = fixture(t);
  restored.account.updateSession(session());
  await tick();
  assert.equal(restored.account.getState().address, first.account.getState().address);
  assert.equal(restored.account.getState().userId, first.account.getState().userId);
  assert.equal(restored.calls.create, 0);
  assert.equal(restored.calls.login, 0);
});

test('zero balance is distinct from loading and errors; failed reads retry', async t => {
  let fail = true;
  const { account } = fixture(t, { readBalance: async () => { if (fail) throw Error('offline'); return 0n; } });
  account.updateSession(session());
  assert.equal(account.getState().balanceStatus, 'loading');
  await tick();
  assert.equal(account.getState().balanceStatus, 'error');
  assert.equal(account.getState().balance, null);
  fail = false;
  await account.refreshBalance();
  assert.equal(account.getState().balanceStatus, 'ready');
  assert.equal(account.getState().balance, 0n);
  assert.equal(account.getState().balanceError, '');
});

test('changing account discards an earlier account’s pending balance', async t => {
  const old = deferred();
  const { account } = fixture(t, { readBalance: address => address === A ? old.promise : Promise.resolve(7n) });
  account.updateSession(session());
  await tick();
  account.updateSession(session(B, 'user-b'));
  assert.equal(account.getState().balance, null);
  await tick();
  old.resolve(900n);
  await tick();
  assert.equal(account.getState().address, B);
  assert.equal(account.getState().balance, 7n);
});

test('signing out immediately clears identity and balance, including late responses', async t => {
  const old = deferred();
  const { account } = fixture(t, { readBalance: () => old.promise });
  account.updateSession(session());
  await tick();
  await account.signOut();
  old.resolve(999n);
  await tick();
  assert.equal(account.getState().authenticated, false);
  assert.equal(account.getState().email, null);
  assert.equal(account.getState().balance, null);
  assert.equal(await account.getAccessToken(), null);
  await assert.rejects(account.getProvider(), /Sign in/);
});

test('a session expiry clears balances and prevents access to the old provider', async t => {
  const { account } = fixture(t);
  account.updateSession(session());
  await tick();
  account.updateSession(signedOut);
  assert.equal(account.getState().balance, null);
  assert.equal(account.getState().authenticated, false);
  await assert.rejects(account.getProvider(), /Sign in/);
});

test('wallet creation timeout and failure are recoverable without starting another account', async t => {
  const { account, calls, runtime } = fixture(t, { setupTimeoutMs: 15 });
  account.updateSession(session(null));
  assert.equal(account.getState().setupStatus, 'creating');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(account.getState().setupStatus, 'error');
  runtime.ensureWallet = async () => { calls.create++; throw Error('network'); };
  await account.retrySetup();
  assert.equal(account.getState().setupStatus, 'error');
  runtime.ensureWallet = async () => { calls.create++; return { address: A }; };
  await account.retrySetup();
  assert.equal(account.getState().address, null, 'a returned creation address is not a connected SDK session');
  assert.equal(account.getState().setupStatus, 'creating');
  account.updateSession(session());
  await tick();
  assert.equal(account.getState().setupStatus, 'ready');
  assert.equal(account.getState().userId, 'user-a');
  assert.equal(account.getState().address, A);
  assert.equal(calls.create, 2);
});

test('a balance timeout is bounded and a concurrent refresh is deduplicated', async t => {
  let calls = 0;
  const { account } = fixture(t, { timeoutMs: 15, readBalance: () => { calls++; return new Promise(() => {}); } });
  account.updateSession(session());
  await account.refreshBalance();
  assert.equal(calls, 1);
  assert.equal(account.getState().balanceStatus, 'error');
});

test('a provider resolved after switching accounts is rejected', async t => {
  const pending = deferred();
  const { account, runtime } = fixture(t);
  account.updateSession(session());
  runtime.getProvider = () => pending.promise;
  const request = account.getProvider();
  account.updateSession(session(B, 'user-b'));
  pending.resolve({});
  await assert.rejects(request, /account changed/);
});

test('a stale SDK snapshot cannot restore a successfully signed-out account', async t => {
  const { account, runtime } = fixture(t);
  account.updateSession(session());
  runtime.logout = async () => {};
  await account.signOut();
  account.updateSession(session());
  assert.equal(account.getState().authenticated, false);
  assert.equal(account.getState().balance, null);
  account.updateSession(signedOut);
  account.updateSession(session());
  assert.equal(account.getState().authenticated, true, 'a later genuine login is accepted');
});

test('access tokens resolved after account changes are discarded', async t => {
  const pending = deferred();
  const { account, runtime } = fixture(t);
  account.updateSession(session());
  runtime.getAccessToken = () => pending.promise;
  const result = account.getAccessToken();
  account.updateSession(session(B, 'user-b'));
  pending.resolve('previous-user-token');
  assert.equal(await result, null);
});

test('failed sign-out restores the session without reusing the previous balance', async t => {
  const { account, runtime } = fixture(t);
  account.updateSession(session());
  await tick();
  runtime.logout = async () => { throw Error('offline'); };
  await account.signOut();
  assert.equal(account.getState().authenticated, true);
  assert.match(account.getState().error, /Sign-out didn’t finish/);
  assert.equal(account.getState().balance, null);
  await tick();
  assert.equal(account.getState().balanceStatus, 'ready');
});

test('native balance RPC rejects malformed, error and HTTP failure responses', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const fixture of [{ error: { message: 'oops' } }, { result: 'banana' }, { result: null }]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => fixture });
    await assert.rejects(readAccountBalance(A), /Invalid balance/);
  }
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(readAccountBalance(A), /unavailable/);
  globalThis.fetch = async (_, options) => {
    const rpc = JSON.parse(options.body);
    assert.equal(rpc.method, 'eth_getBalance');
    assert.deepEqual(rpc.params, [A, 'latest']);
    return { ok: true, json: async () => ({ result: '0x0' }) };
  };
  assert.equal(await readAccountBalance(A), 0n);
});


test('pending logout blocks a fresh login even after a signed-out SDK snapshot', async t => {
  const pending = deferred();
  const { account, runtime, calls } = fixture(t);
  account.updateSession(session());
  runtime.logout = () => pending.promise;
  const logout = account.signOut();
  account.updateSession(signedOut);
  assert.equal(account.getState().busy, 'logout');
  await account.signIn();
  assert.equal(calls.login, 0);
  pending.resolve();
  await logout;
  await account.signIn();
  assert.equal(calls.login, 1);
});

test('wallet restoration waits for SDK wallet readiness and reuses the original wallet', async t => {
  const { account, calls } = fixture(t);
  account.updateSession(session(A, 'user-a', { walletsReady: false }));
  assert.equal(account.getState().setupStatus, 'restoring');
  assert.equal(account.getState().address, null);
  assert.equal(account.getState().balanceStatus, 'idle');
  account.updateSession(session());
  await tick();
  assert.equal(account.getState().setupStatus, 'ready');
  assert.equal(account.getState().address, A);
  assert.equal(calls.create, 0);
});

test('an address belonging to a different linked profile never becomes ready', async t => {
  const { account } = fixture(t);
  account.updateSession(session(A, 'user-b', { linkedWalletAddress: B }));
  assert.equal(account.getState().address, null);
  assert.equal(account.getState().balance, null);
  assert.equal(account.getState().setupStatus, 'restoring');
  await assert.rejects(account.getProvider(), /Sign in/);
});

test('parallel setup retries call ensureWallet once and await a usable SDK snapshot', async t => {
  const pending = deferred();
  const { account, runtime } = fixture(t);
  let calls = 0;
  runtime.ensureWallet = () => { calls++; return pending.promise; };
  account.updateSession(session(null));
  const first = account.retrySetup();
  const second = account.retrySetup();
  assert.equal(calls, 1);
  pending.resolve({ address: A });
  await Promise.all([first, second]);
  assert.equal(account.getState().address, null);
  assert.equal(account.getState().busy, 'setup');
  account.updateSession(session());
  await tick();
  assert.equal(account.getState().address, A);
  assert.equal(account.getState().busy, null);
});

test('sign-out invalidates outstanding setup and its callback guard', async t => {
  const pending = deferred();
  const { account, runtime } = fixture(t);
  let check;
  runtime.ensureWallet = ({ isCurrent }) => { check = isCurrent; return pending.promise; };
  account.updateSession(session(null));
  const setup = account.retrySetup();
  assert.equal(check(), true);
  await account.signOut();
  assert.equal(check(), false);
  pending.resolve({ created: true });
  await setup;
  assert.equal(account.getState().authenticated, false);
  assert.equal(account.getState().address, null);
});

test('switching users ignores an old setup failure', async t => {
  const pending = deferred();
  const { account, runtime } = fixture(t);
  runtime.ensureWallet = () => pending.promise;
  account.updateSession(session(null));
  const setup = account.retrySetup();
  account.updateSession(session(B, 'user-b'));
  pending.reject(Error('old setup failed'));
  await setup;
  await tick();
  assert.equal(account.getState().userId, 'user-b');
  assert.equal(account.getState().error, '');
  assert.equal(account.getState().balanceStatus, 'ready');
});

test('setup timeout cannot start another creation while the first request is unresolved', async t => {
  const pending = deferred();
  const { account, runtime } = fixture(t, { setupTimeoutMs: 15 });
  let calls = 0;
  runtime.ensureWallet = () => { calls++; return pending.promise; };
  account.updateSession(session(null));
  const setup = account.retrySetup();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(account.getState().setupStatus, 'error');
  assert.equal(account.getState().busy, 'setup');
  await account.retrySetup();
  assert.equal(calls, 1);
  pending.resolve();
  await setup;
  assert.equal(account.getState().busy, null);
});

test('SDK loading after a session change clears old account details immediately', async t => {
  const { account } = fixture(t);
  account.updateSession(session());
  await tick();
  account.updateSession({ ready: false });
  assert.equal(account.getState().ready, false);
  assert.equal(account.getState().authenticated, false);
  assert.equal(account.getState().address, null);
  assert.equal(account.getState().balance, null);
});

test('closing the Privy dialog cancels a pending login even without an error callback', async t => {
  const { account } = fixture(t);
  account.updateSession(signedOut);
  await account.signIn();
  account.updateSession({ ...signedOut, dialogOpen: true });
  account.updateSession({ ...signedOut, dialogOpen: false });
  assert.equal(account.getState().busy, null);
  assert.equal(account.getState().error, '');
  assert.equal(account.getState().authenticated, false);
});
